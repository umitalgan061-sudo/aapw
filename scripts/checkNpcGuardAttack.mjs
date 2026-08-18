#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { wrapNpcWithCombatDamage, NPC_GUARD_ATTACK_DEFAULTS } from '../src/3d/gameplay/npcCombatAdapter.js';

const livingWorldSource = fs.readFileSync(new URL('../src/3d/gameplay/livingWorldSpawner.js', import.meta.url), 'utf8');
const events = [];
const fakeNpc = {
  object3D: {
    name: 'contract-guard',
    userData: {
      npcPerception: { intent: 'chase', lineOfSight: true },
      combatStanceBlend: 0,
    },
  },
  update() {},
  dispose() {},
};
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
assert.deepEqual(events[0], {
  name: 'player:damaged',
  payload: { amount: NPC_GUARD_ATTACK_DEFAULTS.damage, sourceId: 'contract-guard' },
});

const afterFirst = events.length;
for (let i = 0; i < 50; i += 1) wrapped.update(1 / 60, { x: 0, z: 2 });
assert.equal(events.length, afterFirst, 'cooldown must prevent frame-rate damage spam');
for (let i = 0; i < 60; i += 1) wrapped.update(1 / 60, { x: 0, z: 2 });
assert.ok(events.length >= 2, 'guard must re-arm after bounded cooldown while combat remains valid');

fakeNpc.object3D.userData.npcPerception = { intent: 'patrol', lineOfSight: true };
wrapped.update(1 / 60, { x: 100, z: 100 });
assert.notEqual(fakeNpc.object3D.userData.npcAttack.phase, 'windup', 'leaving combat must cancel any pending windup');
assert.ok(fakeNpc.object3D.userData.npcAttack.cooldownRemaining <= NPC_GUARD_ATTACK_DEFAULTS.cooldownSeconds);

assert.match(livingWorldSource, /wrapNpcWithCombatDamage/,
  'shipped living-world spawn must wire the guard combat adapter');
assert.match(livingWorldSource, /damageEventName:\s*EVENTS\.PLAYER_DAMAGED/,
  'guard attack adapter must reuse the canonical player damage event contract');
assert.equal(livingWorldSource.includes('createHealthState'), false,
  'living-world NPC wiring must not own or duplicate player health');

console.log('NPC_GUARD_ATTACK_PASS', JSON.stringify({
  damage: NPC_GUARD_ATTACK_DEFAULTS.damage,
  windupSeconds: NPC_GUARD_ATTACK_DEFAULTS.windupSeconds,
  cooldownSeconds: NPC_GUARD_ATTACK_DEFAULTS.cooldownSeconds,
  chaseCannotDamage: true,
  investigateCannotDamage: true,
  lineOfSightRequired: true,
  canonicalDamageEvent: true,
}));
