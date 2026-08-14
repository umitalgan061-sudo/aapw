#!/usr/bin/env node
import assert from 'node:assert/strict';
import { sampleG70RockSnow } from '../godot/terrain-authoring/geocells/ne/g70_rock_snow.mjs';
import { sampleG70Relief } from '../godot/terrain-authoring/geocells/ne/g70_relief.mjs';
import { g70GuardBounds } from '../godot/terrain-authoring/geocells/ne/g70_hydrology.mjs';

const bounds = g70GuardBounds();
const core = { xMin: 7 / 8, xMax: 1, yMin: 0, yMax: 1 / 8 };
const N = 193;
let samples = 0;
let nonSea = 0;
let maxRock = 0;
let maxSnow = 0;
let maxMass = 0;
let maxBlend = 0;
let maxHeightMismatch = 0;
let minHeight = Infinity;
let maxHeight = -Infinity;

for (let y = 0; y < N; y += 1) {
  const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * y / (N - 1);
  for (let x = 0; x < N; x += 1) {
    const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * x / (N - 1);
    const s = sampleG70RockSnow(nx, ny);
    const r = sampleG70Relief(nx, ny);
    samples += 1;
    if (!s.water || s.body !== 'sea') nonSea += 1;
    maxRock = Math.max(maxRock, Math.abs(s.rockWeight));
    maxSnow = Math.max(maxSnow, Math.abs(s.snowWeight));
    maxMass = Math.max(maxMass, Math.abs(s.terrestrialSurfaceMass));
    maxBlend = Math.max(maxBlend, Math.abs(s.controlBlend));
    maxHeightMismatch = Math.max(maxHeightMismatch, Math.abs(s.heightMeters - r.heightMeters));
    minHeight = Math.min(minHeight, s.heightMeters);
    maxHeight = Math.max(maxHeight, s.heightMeters);
  }
}
assert.equal(samples, N * N);
assert.equal(nonSea, 0, 'fractional envelope invented non-sea semantics');
assert.equal(maxRock, 0, 'fractional envelope leaked rock');
assert.equal(maxSnow, 0, 'fractional envelope leaked snow');
assert.equal(maxMass, 0, 'fractional envelope leaked terrestrial material');
assert.equal(maxBlend, 0, 'fractional envelope leaked Terrain3D control blend');
assert.equal(maxHeightMismatch, 0, 'fractional envelope changed Relief height');
assert.ok(maxHeight < 0 && maxHeight - minHeight <= 0.000001, 'fractional envelope changed flat submerged Relief');

// Stress all four parcel edges. West/south cross qualified sea neighbours;
// north/east are world borders and must not acquire a fake material rim.
let edgeSamples = 0;
let maxEdgeRock = 0;
let maxEdgeSnow = 0;
let maxEdgeBlend = 0;
const guard = 1 / 1536;
for (let i = 0; i < 257; i += 1) {
  const t = i / 256;
  const x = core.xMin + (core.xMax - core.xMin) * t;
  const y = core.yMin + (core.yMax - core.yMin) * t;
  const points = [
    [core.xMin, y], [core.xMin - guard, y],
    [x, core.yMax], [x, core.yMax + guard],
    [core.xMax, y], [core.xMax - guard, y],
    [x, core.yMin], [x, core.yMin + guard],
  ];
  for (const [nx, ny] of points) {
    const s = sampleG70RockSnow(nx, ny);
    maxEdgeRock = Math.max(maxEdgeRock, Math.abs(s.rockWeight));
    maxEdgeSnow = Math.max(maxEdgeSnow, Math.abs(s.snowWeight));
    maxEdgeBlend = Math.max(maxEdgeBlend, Math.abs(s.controlBlend));
    edgeSamples += 1;
  }
}
assert.equal(edgeSamples, 2056);
assert.equal(maxEdgeRock, 0);
assert.equal(maxEdgeSnow, 0);
assert.equal(maxEdgeBlend, 0);

// The most dangerous semantic corner is the north-east world corner: latitude
// is maximally cold, yet canonical water still has absolute precedence.
const coldCornerPoints = [
  [1, 0], [1 - guard, 0], [1, guard], [1 - guard, guard],
  [0.999, 0.001], [0.995, 0.005],
];
for (const [nx, ny] of coldCornerPoints) {
  const s = sampleG70RockSnow(nx, ny);
  assert.equal(s.body, 'sea');
  assert.equal(s.landFactor, 0);
  assert.equal(s.rockWeight, 0);
  assert.equal(s.snowWeight, 0, `cold ocean corner invented snow at ${nx},${ny}`);
  assert.equal(s.terrestrialSurfaceMass, 0);
}

const metrics = {
  samples, edgeSamples, coldCornerSamples: coldCornerPoints.length,
  minHeight, maxHeight, maxRock, maxSnow, maxMass, maxBlend,
  maxHeightMismatch, maxEdgeRock, maxEdgeSnow, maxEdgeBlend,
};
console.log(`NE_G70_ROCK_SNOW_CONTROL_ENVELOPE=${JSON.stringify(metrics)}`);
console.log('NE_G70_ROCK_SNOW_CONTROL_ENVELOPE_OK');
