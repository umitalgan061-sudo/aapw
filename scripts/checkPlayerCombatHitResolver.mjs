import assert from 'node:assert/strict';
import { resolvePlayerCombatHits } from '../src/3d/gameplay/playerCombatHitResolver.js';

const attackWindow = Object.freeze({ active: true, serial: 7, comboStep: 2, reachMeters: 2, damageScale: 1.5, position: { x: 0, y: 1, z: 0 }, facing: { x: 0, z: 1 } });
const targets = [
  { id: 'b', position: { x: 0, y: 1, z: 1.2 }, hurtbox: { radius: 0.3, height: 1.8 } },
  { id: 'a', position: { x: 0.1, y: 1, z: 0.8 }, hurtbox: { radius: 0.3, height: 1.8 } },
  { id: 'behind', position: { x: 0, y: 1, z: -0.5 }, hurtbox: { radius: 0.3, height: 1.8 } },
  { id: 'high', position: { x: 0, y: 4, z: 1 }, hurtbox: { radius: 0.3, height: 1.8 } },
];

const hits = resolvePlayerCombatHits({ attackWindow, targets });
assert.deepEqual(hits.map((hit) => hit.targetId), ['a', 'b']);
assert.equal(hits[0].attackSerial, 7);
assert.equal(hits[0].comboStep, 2);
assert.equal(hits[0].appliedDamageScale, 1.5);
assert.equal(resolvePlayerCombatHits({ attackWindow: { ...attackWindow, active: false }, targets }).length, 0);
assert.deepEqual(resolvePlayerCombatHits({ attackWindow, targets: [...targets].reverse() }), hits);
assert.equal(resolvePlayerCombatHits({ attackWindow, targets, maxHits: 1 }).length, 1);
assert.equal(resolvePlayerCombatHits({ attackWindow, targets: null }).length, 0);
console.log('player combat hit resolver contract: ok');
