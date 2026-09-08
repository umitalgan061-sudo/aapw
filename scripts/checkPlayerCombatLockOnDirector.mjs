import assert from 'node:assert/strict';
import { createPlayerCombatLockOnDirector, serializePlayerCombatLockOnState } from '../src/3d/gameplay/playerCombatLockOnDirector.js';

const director = createPlayerCombatLockOnDirector({ maxDistance: 12, coneDegrees: 100, hysteresis: 1.5 });
const input = {
  forward: { x: 0, z: 1 },
  currentTargetId: 'near',
  candidates: [
    { id: 'far', position: { x: 0.1, z: 9 }, priority: 0 },
    { id: 'near', position: { x: 0.2, z: 4 }, priority: 0 },
    { id: 'side', position: { x: 8, z: 0 }, priority: 100 },
    { id: 'dead', position: { x: 0, z: 2 }, alive: false },
  ],
};
const first = director.evaluate(input);
const second = director.evaluate(input);
assert.equal(first.locked, true);
assert.equal(first.targetId, 'near');
assert.equal(first.candidateCount, 2);
assert.deepEqual(first, second);
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.candidates), true);
assert.equal(director.evaluate({ forward: { x: 0, z: 1 }, candidates: [{ id: 'behind', position: { x: 0, z: -4 } }] }).locked, false);
assert.equal(director.evaluate({ forward: { x: 0, z: 1 }, candidates: null }).locked, false);
assert.equal(serializePlayerCombatLockOnState(first), serializePlayerCombatLockOnState(second));
console.log('player combat lock-on director: PASS');
