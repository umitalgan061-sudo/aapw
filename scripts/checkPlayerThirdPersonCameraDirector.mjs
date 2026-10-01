import assert from 'node:assert/strict';
import { projectThirdPersonCamera, serializeThirdPersonCamera } from '../src/3d/gameplay/playerThirdPersonCameraDirector.js';

const base = projectThirdPersonCamera({ target: { x: 2, y: 1.4, z: -3 }, facing: { x: 0, z: 1 }, velocity: { x: 1, z: 0 }, speed: 6 });
assert.equal(base.mode, 'follow');
assert.equal(base.finite, true);
assert.ok(base.camera.y > base.target.y);
assert.equal(serializeThirdPersonCamera(base), serializeThirdPersonCamera(projectThirdPersonCamera({ target: { x: 2, y: 1.4, z: -3 }, facing: { x: 0, z: 1 }, velocity: { x: 1, z: 0 }, speed: 6 })));
assert.equal(Object.isFrozen(base), true);
assert.equal(Object.isFrozen(base.camera), true);

const aim = projectThirdPersonCamera({ mode: 'aim', target: {}, facing: { x: 9, z: 0 }, distance: 99, collisionDistance: 1.2, pitch: -9, fov: 5, lockOn: { valid: true } });
assert.equal(aim.mode, 'aim');
assert.equal(aim.distance, 1.6);
assert.equal(aim.collisionClamped, true);
assert.equal(aim.lockOn, true);
assert.equal(aim.fov, 35);
assert.ok(aim.pitch >= -0.9);

const malformed = projectThirdPersonCamera({ target: { x: NaN, y: Infinity, z: 'bad' }, facing: { x: NaN }, speed: Infinity, distance: -1, collisionDistance: NaN });
for (const value of [malformed.target.x, malformed.target.y, malformed.target.z, malformed.distance, malformed.fov]) assert.equal(Number.isFinite(value), true);
assert.equal(malformed.mode, 'follow');

console.log('player-third-person-camera-director: ok');
