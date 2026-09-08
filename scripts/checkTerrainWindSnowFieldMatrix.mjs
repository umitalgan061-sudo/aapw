#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  TERRAIN_WIND_SNOW_SURFACE_FABRIC_POLICY as P,
  SNOW_RELIEF_FAMILIES,
  buildTerrainWindSnowSurfaceFamilyMatrix,
  buildTerrainWindSnowSurfaceProbeLadder,
  resolveTerrainWindSnowSurfaceFabric,
  resolveTerrainWindSnowContinuity,
  resolveTerrainWindSnowToneHints,
  resolveTerrainWindSnowSurfaceFabricSafely,
  terrainWindSnowSurfaceFabricDigest,
} from '../src/3d/world/terrainWindSnowSurfaceFabric.js';

const finite = (v) => Number.isFinite(v);
const bounded = (v) => finite(v) && v >= -1e-9 && v <= 1 + 1e-9;
const gain = (v) => finite(v) && v >= P.minGain - 1e-9 && v <= P.maxGain + 1e-9;
const fields = ['slope','steepness','cliff','directional','crosswindNeutrality','foldStrength','ridgeShoulder','brokenRidge',
  'shelteredPocket','valleyContinuity','slopeTransition','windwardAlignment','leeAlignment','leeRetention','retention',
  'ridgeCrust','leePowder','continuity'];
const check = (fabric, label) => {
  assert(Object.isFrozen(fabric), `${label}: result must be frozen`);
  for (const key of fields) assert(bounded(fabric[key]), `${label}: ${key} out of [0,1]`);
  assert(gain(fabric.windwardGain), `${label}: windward gain out of policy`);
  assert(gain(fabric.leeGain), `${label}: lee gain out of policy`);
  assert(finite(fabric.materialTemperatureBias), `${label}: temperature bias non-finite`);
  assert(finite(fabric.materialBrightnessBias), `${label}: brightness bias non-finite`);
};

assert.equal(P.renderOnly, true);
assert.equal(P.heightAuthorityUnchanged, true);
assert.equal(P.hydrologyAuthorityUnchanged, true);
assert.equal(P.colliderAuthorityUnchanged, true);
assert.equal(P.placementAuthorityUnchanged, true);
assert.equal(P.secondHeightAuthority, false);
assert.equal(P.worldGridOverlay, false);
assert.equal(P.periodicStriping, false);
assert.equal(P.binaryMasking, false);

const baselineInput = { slopeDegrees: 28, aspectDot: 0.82, foldGradient: 0.12, leeRetention: 0.74 };
const baseline = resolveTerrainWindSnowSurfaceFabric(baselineInput);
check(baseline, 'baseline');
assert.equal(terrainWindSnowSurfaceFabricDigest(baseline), terrainWindSnowSurfaceFabricDigest(resolveTerrainWindSnowSurfaceFabric(baselineInput)));

const flat = resolveTerrainWindSnowSurfaceFabric({});
const crosswind = resolveTerrainWindSnowSurfaceFabric({ slopeDegrees: 34, aspectDot: 0, foldGradient: 0.18 });
const windward = resolveTerrainWindSnowSurfaceFabric({ slopeDegrees: 30, aspectDot: 0.92, foldGradient: 0.16 });
const lee = resolveTerrainWindSnowSurfaceFabric({ slopeDegrees: 30, aspectDot: -0.92, foldGradient: 0.16 });
[flat, crosswind, windward, lee].forEach((f, i) => check(f, `direction-${i}`));
assert.equal(flat.ridgeCrust, 0);
assert.equal(flat.leePowder, 0);
assert(crosswind.crosswindNeutrality > 0.99);
assert.equal(crosswind.windwardAlignment, 0);
assert.equal(crosswind.leeAlignment, 0);
assert(windward.ridgeCrust > lee.ridgeCrust);
assert(lee.leePowder > windward.leePowder);
assert(windward.materialTemperatureBias < lee.materialTemperatureBias);
assert(windward.materialBrightnessBias < lee.materialBrightnessBias);

let previousFold = 0;
for (const foldGradient of [0, 0.005, 0.01, 0.025, 0.05, 0.09, 0.14, 0.20, 0.30]) {
  const result = resolveTerrainWindSnowSurfaceFabric({ slopeDegrees: 30, aspectDot: 0.8, foldGradient });
  check(result, `fold-${foldGradient}`);
  assert(result.foldStrength >= previousFold);
  previousFold = result.foldStrength;
}

let previousSlope = 0;
for (const slopeDegrees of [0, 2, 4, 8, 12, 18, 24, 30, 38, 46, 58, 72, 90]) {
  const result = resolveTerrainWindSnowSurfaceFabric({ slopeDegrees, aspectDot: 0.78, foldGradient: 0.10 });
  check(result, `slope-${slopeDegrees}`);
  assert(result.slope >= previousSlope);
  previousSlope = result.slope;
}

const familyRows = buildTerrainWindSnowSurfaceFamilyMatrix({ directions: 24, aspectMagnitude: 0.82 });
assert.equal(familyRows.length, SNOW_RELIEF_FAMILIES.length * 24);
for (const family of SNOW_RELIEF_FAMILIES) {
  const rows = familyRows.filter((row) => row.family === family.id);
  assert.equal(rows.length, 24);
  assert(new Set(rows.map((row) => row.digest)).size >= 8, `${family.id}: directional output collapsed`);
  rows.forEach((row) => {
    check(row.fabric, `${row.family}-${row.index}`);
    assert(row.aspectDot >= -1 && row.aspectDot <= 1);
  });
}

const ladder = buildTerrainWindSnowSurfaceProbeLadder({
  slopes: [0, 8, 18, 30, 46, 62],
  folds: [0, 0.02, 0.08, 0.16, 0.24],
  aspects: [-1, -0.55, 0, 0.55, 1],
});
assert.equal(ladder.length, 150);
assert(new Set(ladder.map((row) => row.digest)).size > 45, 'probe ladder is too periodic/collapsed');
for (const row of ladder) {
  assert(bounded(row.continuity));
  assert(gain(row.windwardGain));
  assert(gain(row.leeGain));
}

for (const slope of [0, 10, 22, 34, 50, 70]) {
  for (const aspect of [-1, -0.5, 0, 0.5, 1]) {
    const fabric = resolveTerrainWindSnowSurfaceFabric({ slopeDegrees: slope, aspectDot: aspect, foldGradient: 0.08 });
    check(fabric, `cartesian-${slope}-${aspect}`);
    assert(bounded(resolveTerrainWindSnowContinuity({ slopeDegrees: slope, aspectDot: aspect, foldGradient: 0.08 })));
    const hints = resolveTerrainWindSnowToneHints({ slopeDegrees: slope, aspectDot: aspect, foldGradient: 0.08 });
    ['packedBias','accumulatedBias','cooling','warming','continuity'].forEach((key) => assert(bounded(hints[key])));
    assert(hints.brightness >= -1 && hints.brightness <= 1);
  }
}

for (const malformed of [
  { slopeDegrees: NaN, aspectDot: Infinity, foldGradient: -Infinity, leeRetention: NaN },
  { slopeDegrees: 'x', aspectDot: 'x', foldGradient: {}, leeRetention: [] },
  { slopeDegrees: -50, aspectDot: 50, foldGradient: -10, leeRetention: 5 },
]) check(resolveTerrainWindSnowSurfaceFabricSafely(malformed), 'safe-input');

console.log('[checkTerrainWindSnowFieldMatrix] PASS', JSON.stringify({
  policy: P.id,
  familyRows: familyRows.length,
  probeRows: ladder.length,
  uniqueProbeDigests: new Set(ladder.map((row) => row.digest)).size,
}));
