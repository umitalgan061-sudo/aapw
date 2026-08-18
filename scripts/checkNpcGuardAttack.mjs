#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const livingWorldSource = fs.readFileSync(new URL('../src/3d/gameplay/livingWorldSpawner.js', import.meta.url), 'utf8');

function extractFunction(name) {
  const marker = livingWorldSource.indexOf(`function ${name}`);
  const exportMarker = livingWorldSource.indexOf(`export function ${name}`);
  const start = exportMarker >= 0 ? exportMarker : marker;
  assert.ok(start >= 0, `${name} must exist`);
  const openParen = livingWorldSource.indexOf('(', start);
  let parenDepth = 0;
  let closeParen = -1;
  for (let i = openParen; i < livingWorldSource.length; i += 1) {
    if (livingWorldSource[i] === '(') parenDepth += 1;
    else if (livingWorldSource[i] === ')' && --parenDepth === 0) { closeParen = i; break; }
  }
  const brace = livingWorldSource.indexOf('{', closeParen);
  let depth = 0;
  let end = -1;
  for (let i = brace; i < livingWorldSource.length; i += 1) {
    if (livingWorldSource[i] === '{') depth += 1;
    else if (livingWorldSource[i] === '}' && --depth === 0) { end = i + 1; break; }
  }
  return livingWorldSource.slice(start, end).replace(/^export\s+/, '');
}

const defaultsMatch = livingWorldSource.match(/export const NPC_GUARD_ATTACK_DEFAULTS = Object\.freeze\((\{[\s\S]*?\})\);/);
assert.ok(defaultsMatch, 'guard attack defaults must exist');
const NPC_GUARD_ATTACK_DEFAULTS = new Function(`return (${defaultsMatch[1]});`)();
const wrapNpcWithCombatDamage = new Function(`
  const NPC_GUARD_ATTACK_DEFAULTS = ${JSON.stringify(NPC_GUARD_ATTACK_DEFAULTS)};
  ${extractFunction('finitePositive')}
  ${extractFunction('wrapNpcWithCombatDamage')}
  return wrapNpcWithCombatDamage;
`)();

function makeNpc(name, intent = 'combat') {
  return {
    object3D: { name, userData: { npcPerception: { intent, lineOfSight: true }, combatStanceBlend: 1 } },
    update() {},
    dispose() {},
  };
}

const events = [];
const fakeNpc = makeNpc('contract-guard', 'chase');
fakeNpc.object3D.userData.combatStanceBlend = 0;
const wrapped = wrapNpcWithCombatDamage(fakeNpc, {
  eventsBus: { emit: (name, payload) => events.push({ name, payload }) },
  damageEventName: 'player:damaged',
});

for (let i = 0; i < 120; i += 1) wrapped.update(1 / 60, { x: 0, z: 8 });
assert.equal(events.length, 0, 'chase must never damage before combat engage');
fakeNpc.object3D.userData.npcPerception = { intent: 'investigate', lineOfSight: true };
fakeNpc.object3D.userData.combatStanceBlend = 1;
for (let i = 0; i < 120; i += 1) wrapped.update(1 / 60, { x: 0, z: 2 });
assert.equal(events.length, 0, 'investigation/hearing/assist states must never damage');
fakeNpc.object3D.userData.npcPerception = { intent: 'combat', lineOfSight: false };
for (let i = 0; i < 120; i += 1) wrapped.update(1 / 60, { x: 0, z: 2 });
assert.equal(events.length, 0, 'combat without LOS must not deal damage');
fakeNpc.object3D.userData.npcPerception = { intent: 'combat', lineOfSight: true };
for (let i = 0; i < 18; i += 1) wrapped.update(1 / 60, { x: 0, z: 2 });
assert.equal(events.length, 0, 'windup must telegraph before damage');
for (let i = 0; i < 12; i += 1) wrapped.update(1 / 60, { x: 0, z: 2 });
assert.equal(events.length, 1, 'first completed windup must emit exactly one damage event');
assert.deepEqual(events[0], { name: 'player:damaged', payload: { amount: NPC_GUARD_ATTACK_DEFAULTS.damage, sourceId: 'contract-guard' } });
const afterFirst = events.length;
for (let i = 0; i < 50; i += 1) wrapped.update(1 / 60, { x: 0, z: 2 });
assert.equal(events.length, afterFirst, 'cooldown must prevent frame-rate damage spam');
for (let i = 0; i < 60; i += 1) wrapped.update(1 / 60, { x: 0, z: 2 });
assert.ok(events.length >= 2, 'guard must re-arm after bounded cooldown while combat remains valid');
fakeNpc.object3D.userData.npcPerception = { intent: 'patrol', lineOfSight: true };
wrapped.update(1 / 60, { x: 100, z: 100 });
assert.notEqual(fakeNpc.object3D.userData.npcAttack.phase, 'windup', 'leaving combat must cancel pending windup');

const groupEvents = [];
const attackChannel = { holders: new Map() };
const firstNpc = makeNpc('guard-a');
const secondNpc = makeNpc('guard-b');
const first = wrapNpcWithCombatDamage(firstNpc, {
  eventsBus: { emit: (name, payload) => groupEvents.push({ name, payload }) },
  damageEventName: 'player:damaged',
  attackChannel,
  attackGroupId: 'stannis',
  attackerId: 'guard-a',
});
const second = wrapNpcWithCombatDamage(secondNpc, {
  eventsBus: { emit: (name, payload) => groupEvents.push({ name, payload }) },
  damageEventName: 'player:damaged',
  attackChannel,
  attackGroupId: 'stannis',
  attackerId: 'guard-b',
});

first.update(1 / 60, { x: 0, z: 2 });
second.update(1 / 60, { x: 0, z: 2 });
assert.equal(firstNpc.object3D.userData.npcAttack.phase, 'windup', 'first same-settlement guard must acquire the attack slot');
assert.equal(firstNpc.object3D.userData.npcAttack.ownsAttackSlot, true);
assert.equal(secondNpc.object3D.userData.npcAttack.phase, 'hold', 'second same-settlement guard must hold instead of stacking windup');
assert.equal(secondNpc.object3D.userData.npcAttack.ownsAttackSlot, false);
assert.equal(attackChannel.holders.size, 1, 'one settlement may expose only one active attack slot');

for (let i = 0; i < 30; i += 1) {
  first.update(1 / 60, { x: 0, z: 2 });
  second.update(1 / 60, { x: 0, z: 2 });
}
assert.equal(groupEvents.filter((entry) => entry.payload.sourceId === 'guard-a').length, 1, 'slot holder must emit one bounded hit');
assert.equal(groupEvents.filter((entry) => entry.payload.sourceId === 'guard-b').length, 0, 'blocked guard must not damage during the first holder windup');
assert.equal(firstNpc.object3D.userData.npcAttack.ownsAttackSlot, false, 'hit must release the shared slot');

for (let i = 0; i < 35; i += 1) {
  first.update(1 / 60, { x: 0, z: 2 });
  second.update(1 / 60, { x: 0, z: 2 });
}
assert.ok(groupEvents.some((entry) => entry.payload.sourceId === 'guard-b'), 'waiting teammate must acquire a later turn after the first guard yields');
assert.ok(NPC_GUARD_ATTACK_DEFAULTS.yieldSeconds >= 0.2 && NPC_GUARD_ATTACK_DEFAULTS.yieldSeconds <= 1.5, 'attack yield must remain bounded');

secondNpc.object3D.userData.npcPerception = { intent: 'patrol', lineOfSight: true };
second.update(1 / 60, { x: 100, z: 100 });
second.dispose();
first.dispose();
assert.equal(attackChannel.holders.size, 0, 'disengage/dispose must not leak settlement attack slots');

assert.match(livingWorldSource, /damageEventName:\s*EVENTS\.PLAYER_DAMAGED/, 'shipped wiring must reuse canonical player damage event');
assert.match(livingWorldSource, /const guardAttackChannel = \{ holders: new Map\(\) \}/, 'configured guards must share one bounded attack channel');
assert.match(livingWorldSource, /attackGroupId: npcSeatById\.get\(npc\.object3D\.name\)/, 'attack arbitration must use canonical settlement seat identity');
assert.equal(livingWorldSource.includes('createHealthState'), false, 'NPC wiring must not duplicate player health');
assert.equal(livingWorldSource.includes('npcCombatAdapter.js'), false, 'guard attack must not add an uncached runtime dependency');

console.log('NPC_GUARD_ATTACK_PASS', JSON.stringify({
  damage: NPC_GUARD_ATTACK_DEFAULTS.damage,
  windupSeconds: NPC_GUARD_ATTACK_DEFAULTS.windupSeconds,
  cooldownSeconds: NPC_GUARD_ATTACK_DEFAULTS.cooldownSeconds,
  yieldSeconds: NPC_GUARD_ATTACK_DEFAULTS.yieldSeconds,
  chaseCannotDamage: true,
  investigateCannotDamage: true,
  lineOfSightRequired: true,
  sameSettlementSingleSlot: true,
  teammateTurnover: true,
  slotCleanup: true,
  canonicalDamageEvent: true,
  offlineDependencyAdded: false,
}));
