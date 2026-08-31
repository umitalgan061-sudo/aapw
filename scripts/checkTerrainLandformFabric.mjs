#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  TERRAIN_RELIEF_DETAIL_POLICY,
  terrainHillFabricSignal,
} from '../src/3d/world/terrainReliefDetail.js';

const P = TERRAIN_RELIEF_DETAIL_POLICY;
assert.equal(P.id, 'terrain-coast-warp-and-relief-detail-2026-08-26-v3-anisotropic-mountain-fabric');
assert.equal(P.revision, 4);
assert.equal(P.regionalAnisotropicHillFabric, true);
assert(P.hillFabricBlend >= 0.45 && P.hillFabricBlend <= 0.8);
assert(P.hillFabricAlongScale < 1);
assert(P.hillFabricAcrossScale > 1);
assert(P.hillFabricAcrossScale > P.hillFabricAlongScale * 1.5);
assert(P.hillFabricContrast > 1 && P.hillFabricContrast < 1.6);

const WORLD_WIDTH = 13296;
const WORLD_HEIGHT = 10341;
const values = [];
let eastWestEnergy = 0;
let northSouthEnergy = 0;
let maxMillimeterJump = 0;
const gradientQuadrants = new Set();
const stepX = 80 / WORLD_WIDTH;
const stepY = 80 / WORLD_HEIGHT;
const oneMmX = 0.001 / WORLD_WIDTH;

for (let y = 0; y < 120; y += 1) {
  for (let x = 0; x < 160; x += 1) {
    const nx = (x + 0.37) / 160;
    const ny = (y + 0.61) / 120;
    const value = terrainHillFabricSignal(nx, ny);
    assert(Number.isFinite(value));
    assert(value >= 0 && value <= 1, `hill fabric out of range: ${value}`);
    values.push(value);

    const east = terrainHillFabricSignal(nx + stepX, ny);
    const west = terrainHillFabricSignal(nx - stepX, ny);
    const north = terrainHillFabricSignal(nx, ny + stepY);
    const south = terrainHillFabricSignal(nx, ny - stepY);
    const gx = east - west;
    const gy = north - south;
    eastWestEnergy += Math.abs(gx);
    northSouthEnergy += Math.abs(gy);
    if ((x % 20) === 0 && (y % 15) === 0 && Math.hypot(gx, gy) > 1e-5) {
      const angle = Math.atan2(gy, gx);
      const quadrant = ((Math.floor((angle + Math.PI) / (Math.PI / 2)) % 4) + 4) % 4;
      gradientQuadrants.add(quadrant);
    }

    const millimeterEast = terrainHillFabricSignal(nx + oneMmX, ny);
    maxMillimeterJump = Math.max(maxMillimeterJump, Math.abs(millimeterEast - value));
  }
}

const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
const standardDeviation = Math.sqrt(variance);
const min = Math.min(...values);
const max = Math.max(...values);
assert(mean > 0.54 && mean < 0.70, `hill fabric mean drifted: ${mean}`);
assert(standardDeviation > 0.10 && standardDeviation < 0.22, `hill fabric contrast drifted: ${standardDeviation}`);
assert(min < 0.16, `hill fabric lacks valleys: ${min}`);
assert(max > 0.90, `hill fabric lacks ridge crests: ${max}`);
assert(maxMillimeterJump < 0.002, `hill fabric has a seam-scale discontinuity: ${maxMillimeterJump}`);
assert(gradientQuadrants.size === 4, `regional ridge direction collapsed to ${gradientQuadrants.size} quadrants`);

// A regional structural fabric must not become a world-wide X or Y stripe. Total derivative energy
// can differ locally, but full-map X/Y energy should remain of the same order.
const axisEnergyRatio = eastWestEnergy / northSouthEnergy;
assert(axisEnergyRatio > 0.65 && axisEnergyRatio < 1.55, `hill fabric axis bias: ${axisEnergyRatio}`);

// Spatial coherence: nearby samples should be substantially more similar than distant ones. The
// metric uses absolute differences rather than correlation so it stays stable across deterministic
// changes in ridge phase.
function meanDelta(separationMeters, count = 3000) {
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    const nx = ((i * 0.61803398875) + 0.117) % 0.88 + 0.06;
    const ny = ((i * 0.41421356237) + 0.283) % 0.88 + 0.06;
    const angle = ((i * 0.754877666) % 1) * Math.PI * 2;
    const dx = Math.cos(angle) * separationMeters / WORLD_WIDTH;
    const dy = Math.sin(angle) * separationMeters / WORLD_HEIGHT;
    total += Math.abs(terrainHillFabricSignal(nx + dx, ny + dy) - terrainHillFabricSignal(nx, ny));
  }
  return total / count;
}

const delta40 = meanDelta(40);
const delta240 = meanDelta(240);
const delta900 = meanDelta(900);
assert(delta40 < delta240 * 0.65, `40m fabric is not coherent enough: ${delta40}/${delta240}`);
assert(delta240 < delta900 * 1.25, `240m and 900m scales collapsed: ${delta240}/${delta900}`);
assert(delta900 > delta40 * 2.0, `fabric lacks regional scale separation: ${delta40}/${delta900}`);

// Invalid coordinates are deliberately sanitized so diagnostic calls cannot poison terrain QA.
for (const bad of [NaN, Infinity, -Infinity, undefined, null]) {
  const value = terrainHillFabricSignal(bad, bad);
  assert(Number.isFinite(value));
  assert(value >= 0 && value <= 1);
}

console.log('[checkTerrainLandformFabric] PASS');
console.log(JSON.stringify({
  policyId: P.id,
  revision: P.revision,
  mean,
  standardDeviation,
  min,
  max,
  axisEnergyRatio,
  gradientQuadrants: [...gradientQuadrants].sort(),
  meanDeltaMeters: { 40: delta40, 240: delta240, 900: delta900 },
  maxMillimeterJump,
}, null, 2));