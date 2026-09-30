import assert from 'node:assert/strict';
import { resolvePlayerThirdPersonCameraPolicy, resolvePlayerThirdPersonCameraPosition, resolvePlayerThirdPersonCameraFrame, resolvePlayerThirdPersonCameraCollision, PLAYER_THIRD_PERSON_CAMERA_VERSION } from '../src/3d/gameplay/playerThirdPersonCameraPolicy.js';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/3d/gameplay/playerThirdPersonCameraPolicy.ts', import.meta.url), 'utf8');
assert.doesNotMatch(source, /@ts-nocheck/);
assert.doesNotMatch(source, /playerThirdPersonCameraPolicy\.legacy/);
assert.equal(PLAYER_THIRD_PERSON_CAMERA_VERSION, '2026-09-30-v2');

const idle = resolvePlayerThirdPersonCameraPolicy({ distance: 5.8, shoulderOffset: 0.85, movementSpeed: 0 });
assert.equal(idle.version, PLAYER_THIRD_PERSON_CAMERA_VERSION);
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

const frame = resolvePlayerThirdPersonCameraFrame(
  { yawRadians: Number.POSITIVE_INFINITY, lockOn: true, combatActive: true, movementSpeed: 7.5 },
  { x: 10, y: 3, z: -4 },
);
assert.equal(frame.version, PLAYER_THIRD_PERSON_CAMERA_VERSION);
assert.ok([frame.position.x, frame.position.y, frame.position.z, frame.lookAt.x, frame.lookAt.y, frame.lookAt.z].every(Number.isFinite));
assert.deepEqual(frame, resolvePlayerThirdPersonCameraFrame(
  { yawRadians: Number.POSITIVE_INFINITY, lockOn: true, combatActive: true, movementSpeed: 7.5 },
  { x: 10, y: 3, z: -4 },
));

const collision = resolvePlayerThirdPersonCameraCollision({ requestedDistance: 6, hitDistance: 3.2, collisionMargin: 0.25 });
assert.equal(collision.collided, true);
assert.ok(collision.resolvedDistance < collision.requestedDistance);
assert.ok(collision.resolvedDistance >= collision.minimumDistance);
