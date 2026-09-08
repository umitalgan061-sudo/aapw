import assert from 'node:assert/strict';
import { createDodgePlan, serializeDodgePlan } from '../src/3d/gameplay/playerDodgeDirector.js';

const base = { requested: true, direction: { x: 1, z: 0 }, elapsed: 0.12, state: { stamina: 60, maxStamina: 100 } };
const first = createDodgePlan(base);
const second = createDodgePlan(base);
assert.deepEqual(first, second);
assert.equal(first.accepted, true);
assert.equal(first.active, true);
assert.equal(first.direction.x, 1);
assert.equal(first.stamina.remaining, 42);
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.iframe), true);
assert.equal(serializeDodgePlan(first), serializeDodgePlan(second));

assert.equal(createDodgePlan({ ...base, state: { stamina: 2, maxStamina: 100 } }).reason, 'insufficient-stamina');
assert.equal(createDodgePlan({ ...base, direction: { x: 0, z: 0 } }).reason, 'missing-direction');
assert.equal(createDodgePlan({ ...base, state: { stamina: 60, maxStamina: 100, stunned: true } }).reason, 'stunned');
assert.equal(createDodgePlan({ ...base, elapsed: 0.01 }).active, false);
assert.equal(createDodgePlan({ ...base, elapsed: 9 }).progress, 1);
assert.equal(Number.isFinite(createDodgePlan({ elapsed: 'bad', direction: { x: 'bad', z: NaN } }).progress), true);

console.log('PLAYER_DODGE_DIRECTOR_OK');
