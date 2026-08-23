#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  DRAGON_TERRAIN_LOOKAHEAD_METERS,
  DRAGON_TERRAIN_PROBE_SPACING_METERS,
  alignDiveOrientation,
  applyCirclePose,
  applyDiveOffset,
  clampAltitudeAboveGround,
} from '../src/3d/gameplay/dragonFlightMath.js';

function fakeDragon() {
  return {
    position: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
    rotation: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
    userData: {},
  };
}
function poseSnapshot(d) { return { position: { x: d.position.x, y: d.position.y, z: d.position.z }, rotation: { x: d.rotation.x, y: d.rotation.y, z: d.rotation.z } }; }
function angleDistance(a, b) { return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))); }

const center = { x: 0, y: 80, z: 0 };
const dragon = fakeDragon();
applyCirclePose(dragon, center, 20, 0, 0.2);
const patrolPitch = dragon.rotation.x;
const patrolYaw = dragon.rotation.y;
const circleX = dragon.position.x;
const circleZ = dragon.position.z;
applyDiveOffset(dragon, { playerX: 30, playerZ: -10, centerY: center.y, diveDropMeters: 24, lateralPullFraction: 0.7, diveBlend: 1 });
const committedDx = dragon.position.x - circleX;
const committedDz = dragon.position.z - circleZ;
const committedHorizontal = Math.hypot(committedDx, committedDz);
const committedYaw = Math.atan2(committedDx, committedDz);
const committedPitch = Math.atan2(center.y - dragon.position.y, committedHorizontal);
assert.ok(angleDistance(dragon.rotation.y, committedYaw) < 1e-10);
assert.ok(angleDistance(dragon.rotation.x, committedPitch) < 1e-10);
assert.equal(dragon.rotation.z, 0.2);

const half = fakeDragon();
applyCirclePose(half, center, 20, 0, 0.2);
applyDiveOffset(half, { playerX: 30, playerZ: -10, centerY: center.y, diveDropMeters: 24, lateralPullFraction: 0.7, diveBlend: 0.5 });
const halfDx = half.position.x - circleX;
const halfDz = half.position.z - circleZ;
const halfTargetYaw = Math.atan2(halfDx, halfDz);
const halfTargetPitch = Math.atan2(center.y - half.position.y, Math.hypot(halfDx, halfDz));
assert.ok(angleDistance(half.rotation.y, halfTargetYaw) < angleDistance(patrolYaw, halfTargetYaw));
assert.ok(half.rotation.x > patrolPitch && half.rotation.x < halfTargetPitch);

const calm = fakeDragon();
applyCirclePose(calm, center, 20, 0, 0.2);
applyDiveOffset(calm, { playerX: 30, playerZ: -10, centerY: center.y, diveDropMeters: 24, lateralPullFraction: 0.7, diveBlend: 0 });
assert.equal(calm.rotation.x, patrolPitch);
assert.equal(calm.rotation.y, patrolYaw);
assert.equal(calm.position.x, circleX);
assert.equal(calm.position.z, circleZ);

const vertical = fakeDragon();
applyCirclePose(vertical, center, 20, 0, 0.2);
applyDiveOffset(vertical, { playerX: vertical.position.x, playerZ: vertical.position.z, centerY: center.y, diveDropMeters: 24, lateralPullFraction: 1, diveBlend: 1 });
assert.ok(angleDistance(vertical.rotation.x, Math.PI / 2) < 1e-10);
assert.equal(vertical.rotation.y, patrolYaw);

const clamped = fakeDragon();
applyCirclePose(clamped, center, 20, 0, 0.2);
const clampOrigin = { x: clamped.position.x, y: clamped.position.y, z: clamped.position.z, pitch: clamped.rotation.x, yaw: clamped.rotation.y };
applyDiveOffset(clamped, { playerX: 30, playerZ: -10, centerY: center.y, diveDropMeters: 24, lateralPullFraction: 0.7, diveBlend: 1 });
clampAltitudeAboveGround(clamped, () => 65, 10, 0);
alignDiveOrientation(clamped, clampOrigin.x, clampOrigin.y, clampOrigin.z, clampOrigin.pitch, clampOrigin.yaw, 1);
const clampedHorizontal = Math.hypot(clamped.position.x - clampOrigin.x, clamped.position.z - clampOrigin.z);
const clampedPitch = Math.atan2(clampOrigin.y - clamped.position.y, clampedHorizontal);
assert.equal(clamped.position.y, 75);
assert.ok(angleDistance(clamped.rotation.x, clampedPitch) < 1e-10);
assert.ok(clamped.rotation.x < committedPitch);

const ridge = fakeDragon();
ridge.position.set(0, 18, 0);
ridge.rotation.set(0, Math.PI / 2, 0);
const sampled = [];
clampAltitudeAboveGround(ridge, (x, z) => {
  sampled.push([x, z]);
  return x >= 2.75 && x <= 3.25 ? 14 : 0;
}, 10);
const expectedSegments = Math.ceil(DRAGON_TERRAIN_LOOKAHEAD_METERS / DRAGON_TERRAIN_PROBE_SPACING_METERS);
assert.equal(sampled.length, expectedSegments + 1, 'terrain sweep must stay bounded to current plus evenly subdivided forward probes');
assert.deepEqual(sampled[0], [0, 0]);
assert.ok(sampled.some(([x]) => Math.abs(x - 3) < 1e-10), 'subdivision must sample a narrow ridge between the old 0/6/12m point probes');
assert.equal(ridge.position.y, 24, 'narrow ridge inside swept strip must raise the rendered dragon');
for (let i = 2; i < sampled.length; i += 1) {
  assert.ok(sampled[i][0] > sampled[i - 1][0], 'lookahead probes must progress monotonically along heading fallback');
  assert.ok(sampled[i][0] - sampled[i - 1][0] <= DRAGON_TERRAIN_PROBE_SPACING_METERS + 1e-10, 'probe spacing must remain bounded');
}
assert.ok(Math.abs(sampled.at(-1)[0] - DRAGON_TERRAIN_LOOKAHEAD_METERS) < 1e-10, 'sweep must include full lookahead endpoint');

const motionRidge = fakeDragon();
motionRidge.position.set(0, 18, 4);
motionRidge.rotation.set(0, Math.PI / 2, 0);
motionRidge.userData.dragonPreviousRenderedX = 0;
motionRidge.userData.dragonPreviousRenderedZ = 0;
const motionSamples = [];
clampAltitudeAboveGround(motionRidge, (x, z) => {
  motionSamples.push([x, z]);
  return Math.abs(x) < 1e-10 && z >= 6.75 && z <= 7.25 ? 16 : 0;
}, 10);
assert.ok(motionSamples.some(([x, z]) => Math.abs(x) < 1e-10 && Math.abs(z - 7) < 1e-10), 'terrain sweep must follow actual rendered +Z motion even when yaw faces +X');
assert.ok(motionSamples.slice(1).every(([x]) => Math.abs(x) < 1e-10), 'yaw must not steer lookahead away from a valid retained motion vector');
assert.equal(motionRidge.position.y, 26, 'ridge on the real rendered trajectory must raise the dragon before crossing it');

const pointOnly = fakeDragon();
pointOnly.position.set(0, 18, 0);
pointOnly.rotation.set(0, Math.PI / 2, 0);
let pointOnlySamples = 0;
clampAltitudeAboveGround(pointOnly, () => { pointOnlySamples += 1; return 0; }, 10, 0);
assert.equal(pointOnlySamples, 1);
assert.equal(pointOnly.position.y, 18);

const repeat = fakeDragon();
applyCirclePose(repeat, center, 20, 0, 0.2);
applyDiveOffset(repeat, { playerX: 30, playerZ: -10, centerY: center.y, diveDropMeters: 24, lateralPullFraction: 0.7, diveBlend: 1 });
assert.deepEqual(poseSnapshot(repeat), poseSnapshot(dragon));

console.log('DRAGON_DIVE_HEADING_PASS', JSON.stringify({ patrolYaw, committedYaw: dragon.rotation.y, committedPitch: dragon.rotation.x, clampedPitch: clamped.rotation.x, terrainLookaheadMeters: DRAGON_TERRAIN_LOOKAHEAD_METERS, probeSpacingMeters: DRAGON_TERRAIN_PROBE_SPACING_METERS, terrainLookaheadSamples: sampled.length, motionDirectedSamples: motionSamples.length, bankPreserved: dragon.rotation.z, deterministic: true }));
