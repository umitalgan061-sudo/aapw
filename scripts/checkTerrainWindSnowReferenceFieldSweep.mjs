#!/usr/bin/env node
import assert from 'node:assert/strict';
import { terrainWindExposureFromNeighbours } from '../src/3d/world/terrainWindSnowExposure.js';
import { resolveTerrainWindSnowSurfaceFabric } from '../src/3d/world/terrainWindSnowSurfaceFabric.js';

const EPS = 1e-9;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const syntheticHeight = (x, z) => 100
  + Math.sin(x * 0.019) * 22
  + Math.cos(z * 0.014) * 31
  + Math.sin((x + z) * 0.006) * 18
  + Math.cos((x - z) * 0.011) * 9;
const sample = (x, z, step) => terrainWindExposureFromNeighbours(
  syntheticHeight(x - step, z), syntheticHeight(x + step, z),
  syntheticHeight(x, z - step), syntheticHeight(x, z + step), step,
);

const W = 31;
const step = 24;
const samples = [];
for (let z = -W; z <= W; z += 1) {
  for (let x = -W; x <= W; x += 1) {
    samples.push(sample(x * step, z * step, step));
  }
}
assert.equal(samples.length, (W * 2 + 1) ** 2);

let directional = 0;
let folded = 0;
let neutral = 0;
let strongRidge = 0;
let strongShelter = 0;
let minContinuity = 1;
let maxContinuity = 0;
const digest = new Set();
for (const [index, exposure] of samples.entries()) {
  for (const value of [exposure.slopeDegrees, exposure.foldGradient, exposure.aspectDot, exposure.windward, exposure.lee]) {
    assert(Number.isFinite(value), `sample ${index}: non-finite exposure`);
  }
  assert(exposure.windward >= 0 && exposure.windward <= 1);
  assert(exposure.lee >= 0 && exposure.lee <= 1);
  const fabric = resolveTerrainWindSnowSurfaceFabric({
    slopeDegrees: exposure.slopeDegrees,
    aspectDot: exposure.aspectDot,
    foldGradient: exposure.foldGradient,
    foldStrength: exposure.orographicFoldStrength,
    leeRetention: exposure.leeRetention,
  });
  for (const value of [fabric.continuity, fabric.ridgeCrust, fabric.leePowder, fabric.windwardGain, fabric.leeGain]) assert(Number.isFinite(value));
  assert(fabric.windwardGain >= 0.86 - EPS && fabric.windwardGain <= 1.14 + EPS);
  assert(fabric.leeGain >= 0.86 - EPS && fabric.leeGain <= 1.14 + EPS);
  minContinuity = Math.min(minContinuity, fabric.continuity);
  maxContinuity = Math.max(maxContinuity, fabric.continuity);
  if (Math.abs(exposure.aspectDot) < 0.08) neutral += 1;
  if (exposure.foldGradient > 0.025) folded += 1;
  if (exposure.windward > 0.12) directional += 1;
  if (fabric.ridgeCrust > 0.25) strongRidge += 1;
  if (fabric.leePowder > 0.25) strongShelter += 1;
  digest.add(`${fabric.ridgeCrust.toFixed(5)}:${fabric.leePowder.toFixed(5)}:${fabric.continuity.toFixed(5)}`);
}

assert(neutral > samples.length * 0.02, 'reference field lost a neutral crosswind population');
assert(folded > samples.length * 0.25, 'reference field does not exercise meaningful broken relief');
assert(directional > samples.length * 0.08, 'reference field does not exercise directional snow response');
assert(strongRidge > 0, 'reference field produced no exposed ridge crust population');
assert(strongShelter > 0, 'reference field produced no sheltered lee powder population');
assert(maxContinuity > minContinuity + 0.10, 'relief continuity collapsed to a near-constant field');
assert(digest.size > samples.length * 0.20, 'reference field shows excessive discretisation/tiling');

// Translation and scale invariance: the same local stencil shape must produce the same surface fabric
// regardless of its world offset. This is the seam-safety property used by chunked terrain rendering.
const stencilA = terrainWindExposureFromNeighbours(82, 118, 97, 103, 12);
const stencilB = terrainWindExposureFromNeighbours(182, 218, 197, 203, 12);
assert(Math.abs(stencilA.slopeDegrees - stencilB.slopeDegrees) < EPS);
assert(Math.abs(stencilA.aspectDot - stencilB.aspectDot) < EPS);
assert(Math.abs(stencilA.foldGradient - stencilB.foldGradient) < EPS);
assert(Math.abs(stencilA.windward - stencilB.windward) < EPS);
assert(Math.abs(stencilA.lee - stencilB.lee) < EPS);

// Mirror fixtures: reversing the gradient should exchange windward/lee dominance rather than creating
// a second geography. This checks directional response symmetry without modifying canonical heights.
const mirrorA = terrainWindExposureFromNeighbours(80, 120, 92, 108, 10);
const mirrorB = terrainWindExposureFromNeighbours(120, 80, 108, 92, 10);
assert(Math.abs(mirrorA.slopeDegrees - mirrorB.slopeDegrees) < EPS);
assert(Math.abs(mirrorA.aspectDot + mirrorB.aspectDot) < 0.04);
assert(mirrorA.windward > mirrorA.lee);
assert(mirrorB.lee > mirrorB.windward);

// Crosswind fixture: strong relief is still allowed, but exactly tangent terrain must not acquire a
// fabricated directional signal from contour turning.
const cross = terrainWindExposureFromNeighbours(90, 110, 110, 90, 10);
assert(Math.abs(cross.aspectDot) < EPS);
assert.equal(cross.windward, 0);
assert.equal(cross.lee, 0);
assert(cross.surfaceFabric.crosswindNeutrality > 0.99);

console.log('[checkTerrainWindSnowReferenceFieldSweep] PASS', JSON.stringify({
  samples: samples.length,
  neutral, folded, directional, strongRidge, strongShelter,
  continuityRange: [minContinuity, maxContinuity],
  uniqueSurfaceStates: digest.size,
}));
