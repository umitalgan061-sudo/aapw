#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/3d/gameplay/livingWorldSpawner.js', import.meta.url), 'utf8');

function extractFunction(name) {
  const marker = source.indexOf(`function ${name}`);
  const exportMarker = source.indexOf(`export function ${name}`);
  const start = exportMarker >= 0 ? exportMarker : marker;
  assert.ok(start >= 0, `${name} must exist`);
  const openParen = source.indexOf('(', start);
  let parenDepth = 0;
  let closeParen = -1;
  for (let i = openParen; i < source.length; i += 1) {
    if (source[i] === '(') parenDepth += 1;
    else if (source[i] === ')' && --parenDepth === 0) { closeParen = i; break; }
  }
  const brace = source.indexOf('{', closeParen);
  let depth = 0;
  let end = -1;
  for (let i = brace; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}' && --depth === 0) { end = i + 1; break; }
  }
  assert.ok(closeParen > openParen && end > brace, `${name} must have a complete body`);
  return source.slice(start, end).replace(/^export\s+/, '');
}

function parseFrozenObject(name) {
  const match = source.match(new RegExp(`export const ${name} = Object\\.freeze\\((\\{[\\s\\S]*?\\})\\);`));
  assert.ok(match, `${name} must remain an explicit frozen object`);
  return new Function(`return (${match[1]});`)();
}

const attackDefaults = parseFrozenObject('NPC_GUARD_ATTACK_DEFAULTS');
const leashDefaults = parseFrozenObject('NPC_GUARD_LEASH_DEFAULTS');
const finitePositive = extractFunction('finitePositive');
const wrapNpcWithHomeLeash = new Function(`
  const NPC_GUARD_LEASH_DEFAULTS = ${JSON.stringify(leashDefaults)};
  ${finitePositive}
  ${extractFunction('wrapNpcWithHomeLeash')}
  return wrapNpcWithHomeLeash;
`)();
const wrapNpcWithCombatDamage = new Function(`
  const NPC_GUARD_ATTACK_DEFAULTS = ${JSON.stringify(attackDefaults)};
  ${finitePositive}
  ${extractFunction('wrapNpcWithCombatDamage')}
  return wrapNpcWithCombatDamage;
`)();

function makeGuard(id, homeX = 0) {
  const object3D = {
    name: id,
    position: { x: homeX, z: 0 },
    userData: {
      npcPerception: { intent: 'combat', reason: 'vision', lineOfSight: true, heard: false, assisted: false },
      combatStanceBlend: 1,
    },
  };
  let disposed = false;
  const npc = {
    object3D,
    displayName: id,
    update(_delta, playerPosition) {
      if (!playerPosition) {
        const dx = homeX - object3D.position.x;
        const distance = Math.abs(dx);
        if (distance > 0) object3D.position.x += Math.sign(dx) * Math.min(6, distance);
        return;
      }
      object3D.userData.npcPerception = {
        intent: 'combat',
        reason: 'vision',
        lineOfSight: true,
        heard: false,
        assisted: false,
      };
      object3D.userData.combatStanceBlend = 1;
    },
    dispose() { disposed = true; },
  };
  return { npc, get disposed() { return disposed; } };
}

function wrapGuard(fixture, id, attackChannel, events) {
  const leashed = wrapNpcWithHomeLeash(fixture.npc);
  return wrapNpcWithCombatDamage(leashed, {
    eventsBus: { emit: (name, payload) => events.push({ name, payload }) },
    damageEventName: 'player:damaged',
    attackChannel,
    attackGroupId: 'stannis',
    attackerId: id,
  });
}

const events = [];
const attackChannel = { holders: new Map() };
const firstFixture = makeGuard('guard-a');
const secondFixture = makeGuard('guard-b');
const first = wrapGuard(firstFixture, 'guard-a', attackChannel, events);
const second = wrapGuard(secondFixture, 'guard-b', attackChannel, events);

first.update(1 / 60, { x: 2, z: 0 });
assert.equal(first.object3D.userData.npcAttack.phase, 'windup', 'engaged guard must acquire a real windup');
assert.equal(first.object3D.userData.npcAttack.ownsAttackSlot, true, 'first guard must own the settlement attack slot');
assert.equal(attackChannel.holders.get('stannis'), 'guard-a');
assert.equal(events.length, 0, 'windup must remain damage-free before completion');

second.update(1 / 60, { x: 2, z: 0 });
assert.equal(second.object3D.userData.npcAttack.phase, 'hold', 'teammate must wait while the first guard owns the slot');
assert.equal(second.object3D.userData.npcAttack.ownsAttackSlot, false);

first.object3D.position.x = leashDefaults.leashRadiusMeters + 1;
first.update(1 / 60, { x: leashDefaults.leashRadiusMeters + 4, z: 0 });
assert.equal(first.object3D.userData.npcLeash.returning, true, 'crossing the authored leash must enter return');
assert.equal(first.object3D.userData.npcPerception.intent, 'return', 'leash wrapper must invalidate combat intent before damage arbitration');
assert.equal(first.object3D.userData.npcPerception.lineOfSight, false, 'return must invalidate stale combat LOS');
assert.equal(first.object3D.userData.npcAttack.ownsAttackSlot, false, 'return must release the shared attack slot immediately');
assert.notEqual(first.object3D.userData.npcAttack.phase, 'windup', 'return must cancel the pending windup');
assert.equal(attackChannel.holders.has('stannis'), false, 'returning holder must not strand a settlement attack slot');
assert.equal(events.length, 0, 'leash return must not leak stale windup damage');

second.update(1 / 60, { x: 2, z: 0 });
assert.equal(second.object3D.userData.npcAttack.phase, 'windup', 'waiting teammate must acquire the yielded slot on its next eligible tick');
assert.equal(second.object3D.userData.npcAttack.ownsAttackSlot, true);
assert.equal(attackChannel.holders.get('stannis'), 'guard-b');

for (let i = 0; i < 8; i += 1) first.update(1 / 60, { x: leashDefaults.leashRadiusMeters + 4, z: 0 });
assert.equal(first.object3D.userData.npcLeash.returning, true, 'far player must keep the displaced guard in return mode');
assert.equal(events.some((entry) => entry.payload?.sourceId === 'guard-a'), false, 'returning guard must remain damage-free');

second.dispose();
first.dispose();
assert.equal(attackChannel.holders.size, 0, 'dispose after handoff must leave no shared attack-slot leak');
assert.equal(firstFixture.disposed, true);
assert.equal(secondFixture.disposed, true);

assert.match(source, /const leashAwareNpc = wrapNpcWithHomeLeash\(npc\);\s*return wrapNpcWithCombatDamage\(leashAwareNpc,/,
  'shipped configured guards must apply leash before combat damage arbitration');
assert.equal(source.includes('EditorMaterialStudio'), false, 'living-world runtime must not import editor material UI');

console.log('NPC_GUARD_LEASH_ATTACK_SLOT_HANDOFF_PASS', JSON.stringify({
  leashRadiusMeters: leashDefaults.leashRadiusMeters,
  rejoinRadiusMeters: leashDefaults.rejoinRadiusMeters,
  staleDamageEvents: 0,
  returnCancelsWindup: true,
  returnReleasesSlot: true,
  teammateAcquiresYieldedSlot: true,
  finalSlotLeaks: attackChannel.holders.size,
}));
