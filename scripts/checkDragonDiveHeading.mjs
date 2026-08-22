#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  alignDiveOrientation,
  applyCirclePose,
  applyDiveOffset,
  clampAltitudeAboveGround,
} from '../src/3d/gameplay/dragonFlightMath.js';

function fakeDragon() {
  return {
    position: {
      x: 0, y: 0, z: 0,
      set(x, y, z) { this.x = x; this.y = y; this.z = z; },
    },
    rotation: {
      x: 0, y: 0, z: 0,
      set(x, y, z) { this.x = x; this.y = y; this.z = z; },
    },
  };
}

function poseSnapshot(dragon) {
  return {
    position: { x: dragon.position.x, y: dragon.position.y, z: dragon.position.z },
    rotation: { x: dragon.rotation.x, y: dragon.rotation.y, z: dragon.rotation.z },
  };
}

function angleDistance(a, b) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

const center = { x: 0, y: 80, z: 0 };
const dragon = fakeDragon();
applyCirclePose(dragon, center, 20, 0, 0.2);
const patrolPitch = dragon.rotation.x;
const patrolYaw = dragon.rotation.y;
const circleX = dragon.position.x;
const circleZ = dragon.position.z;

applyDiveOffset(dragon, {
  playerX: 30,
  playerZ: -10,
  centerY: center.y,
  diveDropMeters: 24,
  lateralPullFraction: 0.7,
  diveBlend: 1,
});
const committedDx = dragon.position.x - circleX;
const committedDz = dragon.position.z - circleZ;
const committedHorizontal = Math.hypot(committedDx, committedDz);
const committedYaw = Math.atan2(committedDx, committedDz);
const committedPitch = Math.atan2(center.y - dragon.position.y, committedHorizontal);
assert.ok(angleDistance(dragon.rotation.y, committedYaw) < 1e-10,
  'fully committed dive must face the actual horizontal swoop vector');
assert.ok(angleDistance(dragon.rotation.x, committedPitch) < 1e-10,
  'fully committed dive must pitch down along the actual 3D swoop vector');
assert.ok(dragon.rotation.x > 0,
  'committed descending dive must have a visible nose-down pitch');
assert.equal(dragon.rotation.z, 0.2, 'dive orientation must preserve authored bank/roll');

const half = fakeDragon();
applyCirclePose(half, center, 20, 0, 0.2);
applyDiveOffset(half, {
  playerX: 30,
  playerZ: -10,
  centerY: center.y,
  diveDropMeters: 24,
  lateralPullFraction: 0.7,
  diveBlend: 0.5,
});
const halfDx = half.position.x - circleX;
const halfDz = half.position.z - circleZ;
const halfTargetYaw = Math.atan2(halfDx, halfDz);
const halfTargetPitch = Math.atan2(center.y - half.position.y, Math.hypot(halfDx, halfDz));
assert.ok(angleDistance(half.rotation.y, halfTargetYaw) < angleDistance(patrolYaw, halfTargetYaw),
  'partial dive must turn toward the swoop instead of retaining patrol tangent');
assert.ok(angleDistance(half.rotation.y, patrolYaw) > 0,
  'partial dive heading must make measurable yaw progress');
assert.ok(half.rotation.x > patrolPitch && half.rotation.x < halfTargetPitch,
  'partial dive pitch must progress toward the path angle without snapping');

const calm = fakeDragon();
applyCirclePose(calm, center, 20, 0, 0.2);
applyDiveOffset(calm, {
  playerX: 30,
  playerZ: -10,
  centerY: center.y,
  diveDropMeters: 24,
  lateralPullFraction: 0.7,
  diveBlend: 0,
});
assert.equal(calm.rotation.x, patrolPitch, 'zero dive blend must preserve exact circle pitch');
assert.equal(calm.rotation.y, patrolYaw, 'zero dive blend must preserve exact circle heading');
assert.equal(calm.position.x, circleX, 'zero dive blend must preserve exact circle X');
assert.equal(calm.position.z, circleZ, 'zero dive blend must preserve exact circle Z');

const vertical = fakeDragon();
applyCirclePose(vertical, center, 20, 0, 0.2);
const verticalCircleX = vertical.position.x;
const verticalCircleZ = vertical.position.z;
applyDiveOffset(vertical, {
  playerX: verticalCircleX,
  playerZ: verticalCircleZ,
  centerY: center.y,
  diveDropMeters: 24,
  lateralPullFraction: 1,
  diveBlend: 1,
});
assert.ok(angleDistance(vertical.rotation.x, Math.PI / 2) < 1e-10,
  'purely vertical committed dive must pitch straight down instead of retaining patrol pitch');
assert.equal(vertical.rotation.y, patrolYaw,
  'purely vertical dive has no horizontal heading and must preserve authored yaw');

const clamped = fakeDragon();
applyCirclePose(clamped, center, 20, 0, 0.2);
const clampOriginX = clamped.position.x;
const clampOriginY = clamped.position.y;
const clampOriginZ = clamped.position.z;
const clampOriginPitch = clamped.rotation.x;
const clampOriginYaw = clamped.rotation.y;
applyDiveOffset(clamped, {
  playerX: 30,
  playerZ: -10,
  centerY: center.y,
  diveDropMeters: 24,
  lateralPullFraction: 0.7,
  diveBlend: 1,
});
clampAltitudeAboveGround(clamped, () => 65, 10);
alignDiveOrientation(
  clamped,
  clampOriginX,
  clampOriginY,
  clampOriginZ,
  clampOriginPitch,
  clampOriginYaw,
  1,
);
const clampedHorizontal = Math.hypot(clamped.position.x - clampOriginX, clamped.position.z - clampOriginZ);
const clampedPitch = Math.atan2(clampOriginY - clamped.position.y, clampedHorizontal);
assert.equal(clamped.position.y, 75, 'terrain safety fixture must clamp the rendered dive altitude');
assert.ok(angleDistance(clamped.rotation.x, clampedPitch) < 1e-10,
  'post-clamp pitch must follow the actual rendered 3D path rather than the unclamped target');
assert.ok(clamped.rotation.x < committedPitch,
  'terrain clamp that shortens the descent must visibly flatten the final dive pitch');

const repeat = fakeDragon();
applyCirclePose(repeat, center, 20, 0, 0.2);
applyDiveOffset(repeat, {
  playerX: 30,
  playerZ: -10,
  centerY: center.y,
  diveDropMeters: 24,
  lateralPullFraction: 0.7,
  diveBlend: 1,
});
assert.deepEqual(poseSnapshot(repeat), poseSnapshot(dragon),
  'dive position, yaw and pitch must remain deterministic');

console.log('DRAGON_DIVE_HEADING_PASS', JSON.stringify({
  patrolYaw,
  committedYaw: dragon.rotation.y,
  committedPitch: dragon.rotation.x,
  halfYaw: half.rotation.y,
  halfPitch: half.rotation.x,
  verticalPitch: vertical.rotation.x,
  clampedPitch: clamped.rotation.x,
  bankPreserved: dragon.rotation.z,
  deterministic: true,
}));
