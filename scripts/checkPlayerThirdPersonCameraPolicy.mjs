import assert from 'node:assert/strict';
import { resolvePlayerThirdPersonCameraPolicy, resolvePlayerThirdPersonCameraPosition } from '../src/3d/gameplay/playerThirdPersonCameraPolicy.js';

const idle = resolvePlayerThirdPersonCameraPolicy({ distance: 5.8, shoulderOffset: 0.85, movementSpeed: 0 });
assert.equal(idle.locomotion, 'idle');
assert.equal(idle.combatActive, false);

const sprintLock = resolvePlayerThirdPersonCameraPolicy({ distance: 5.8, shoulderOffset: 0.85, movementSpeed: 8.2, combatActive: true, lockOn: true });
assert.equal(sprintLock.locomotion, 'sprint');
assert.equal(sprintLock.lockOn, true);
assert.ok(sprintLock.distance < idle.distance);
assert.ok(Math.abs(sprintLock.shoulderOffset) < Math.abs(idle.shoulderOffset));

const malformed = resolvePlayerThirdPersonCameraPolicy({ distance: Infinity, pitchRadians: NaN, shoulderOffset: -99 });
assert.ok(malformed.distance >= 2.5 && malformed.distance <= 12);
assert.equal(malformed.shoulderOffset, -1.5);
assert.equal(Number.isFinite(malformed.pitchRadians), true);

const positionA = resolvePlayerThirdPersonCameraPosition(idle, { x: 10, y: 3, z: -4 });
const positionB = resolvePlayerThirdPersonCameraPosition(idle, { x: 10, y: 3, z: -4 });
assert.deepEqual(positionA, positionB);
assert.ok(positionA.y > 3);

console.log('player third-person camera policy contract: PASS');
