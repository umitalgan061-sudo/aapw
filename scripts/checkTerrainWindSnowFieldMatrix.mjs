#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  TERRAIN_WIND_SNOW_SURFACE_FABRIC_POLICY,
  SNOW_RELIEF_FAMILIES,
  buildTerrainWindSnowSurfaceFamilyMatrix,
  buildTerrainWindSnowSurfaceProbeLadder,
  resolveTerrainWindSnowContinuity,
  resolveTerrainWindSnowSurfaceFabric,
  resolveTerrainWindSnowSurfaceFabricSafely,
  resolveTerrainWindSnowToneHints,
  sanitizeTerrainWindSnowSurfaceFabricInput,
  summarizeTerrainWindSnowSurfaceFabric,
  terrainWindSnowSurfaceFabricDigest,
} from '../src/3d/world/terrainWindSnowSurfaceFabric.js';

const EPS = 1e-9;
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const signed = (value) => Math.max(-1, Math.min(1, value));
const approx = (a, b, tolerance = 1e-9) => Math.abs(a - b) <= tolerance;
const finite = (value) => Number.isFinite(value);
const bounded = (value) => finite(value) && value >= -EPS && value <= 1 + EPS;
const between = (value, low, high) => finite(value) && value >= low - EPS && value <= high + EPS;

assert.equal(TERRAIN_WIND_SNOW_SURFACE_FABRIC_POLICY.renderOnly, true);
assert.equal(TERRAIN_WIND_SNOW_SURFACE_FABRIC_POLICY.heightAuthorityUnchanged, true);
assert.equal(TERRAIN_WIND_SNOW_SURFACE_FABRIC_POLICY.hydrologyAuthorityUnchanged, true);
assert.equal(TERRAIN_WIND_SNOW_SURFACE_FABRIC_POLICY.colliderAuthorityUnchanged, true);
assert.equal(TERRAIN_WIND_SNOW_SURFACE_FABRIC_POLICY.placementAuthorityUnchanged, true);
assert.equal(TERRAIN_WIND_SNOW_SURFACE_FABRIC_POLICY.secondHeightAuthority, false);
assert.equal(TERRAIN_WIND_SNOW_SURFACE_FABRIC_POLICY.worldGridOverlay, false);
assert.equal(TERRAIN_WIND_SNOW_SURFACE_FABRIC_POLICY.periodicStriping, false);
assert.equal(TERRAIN_WIND_SNOW_SURFACE_FABRIC_POLICY.binaryMasking, false);
assert(TERRAIN_WIND_SNOW_SURFACE_FABRIC_POLICY.minGain < 1);
assert(TERRAIN_WIND_SNOW_SURFACE_FABRIC_POLICY.maxGain > 1);
assert(TERRAIN_WIND_SNOW_SURFACE_FABRIC_POLICY.minGain >= 0);
assert(TERRAIN_WIND_SNOW_SURFACE_FABRIC_POLICY.maxGain <= 2);

const normalizedKeys = [
  'slope',
  'steepness',
  'cliff',
  'directional',
  'crosswindNeutrality',
  'foldStrength',
  'ridgeShoulder',
  'brokenRidge',
  'shelteredPocket',
  'valleyContinuity',
  'slopeTransition',
  'windwardAlignment',
  'leeAlignment',
  'leeRetention',
  'windwardGain',
  'leeGain',
  'retention',
  'ridgeCrust',
  'leePowder',
  'continuity',
  'materialTemperatureBias',
  'materialBrightnessBias',
];

function validateFabric(fabric, label = 'fabric') {
  assert(fabric && typeof fabric === 'object', `${label}: fabric missing`);
  for (const key of normalizedKeys) assert(finite(fabric[key]), `${label}: ${key} must be finite`);
  for (const key of normalizedKeys.slice(0, -2)) {
    if (key === 'windwardGain' || key === 'leeGain') continue;
    assert(bounded(fabric[key]), `${label}: ${key} out of range`);
  }
  assert(between(fabric.windwardGain, TERRAIN_WIND_SNOW_SURFACE_FABRIC_POLICY.minGain, TERRAIN_WIND_SNOW_SURFACE_FABRIC_POLICY.maxGain),
    `${label}: windward gain out of policy bounds`);
  assert(between(fabric.leeGain, TERRAIN_WIND_SNOW_SURFACE_FABRIC_POLICY.minGain, TERRAIN_WIND_SNOW_SURFACE_FABRIC_POLICY.maxGain),
    `${label}: lee gain out of policy bounds`);
  assert(between(fabric.materialTemperatureBias, -1, 1), `${label}: temperature bias out of signed bounds`);
  assert(between(fabric.materialBrightnessBias, -1, 1), `${label}: brightness bias out of signed bounds`);
  assert(Object.isFrozen(fabric), `${label}: result must be immutable`);
}

function validateHints(hints, label = 'hints') {
  assert(hints && typeof hints === 'object', `${label}: missing`);
  for (const key of ['packedBias', 'accumulatedBias', 'cooling', 'warming', 'continuity']) {
    assert(bounded(hints[key]), `${label}: ${key} out of range`);
  }
  assert(between(hints.brightness, -1, 1), `${label}: brightness out of range`);
  assert(Object.isFrozen(hints), `${label}: hints must be immutable`);
}

function validateSummary(summary, label = 'summary') {
  assert(summary && typeof summary === 'object', `${label}: missing`);
  for (const key of ['continuity', 'ridgeCrust', 'leePowder', 'crosswindNeutrality']) {
    assert(bounded(summary[key]), `${label}: ${key} out of range`);
  }
  for (const key of ['windwardGain', 'leeGain']) assert(finite(summary[key]), `${label}: ${key} non-finite`);
  assert(between(summary.materialTemperatureBias, -1, 1), `${label}: temp bias out of range`);
  assert(between(summary.materialBrightnessBias, -1, 1), `${label}: brightness out of range`);
  assert(Object.isFrozen(summary), `${label}: summary must be immutable`);
}

const baseline = resolveTerrainWindSnowSurfaceFabric({
  slopeDegrees: 12,
  aspectDot: 0.71,
  foldGradient: 0.08,
});
validateFabric(baseline, 'baseline');
assert.equal(terrainWindSnowSurfaceFabricDigest(baseline), terrainWindSnowSurfaceFabricDigest(baseline));
assert.equal(terrainWindSnowSurfaceFabricDigest(baseline).split('|').length, normalizedKeys.length);

const repeated = Array.from({ length: 40 }, () => resolveTerrainWindSnowSurfaceFabric({
  slopeDegrees: 12,
  aspectDot: 0.71,
  foldGradient: 0.08,
}));
for (const sample of repeated) {
  validateFabric(sample, 'repeated');
  assert.equal(terrainWindSnowSurfaceFabricDigest(sample), terrainWindSnowSurfaceFabricDigest(baseline));
}

const neutral = resolveTerrainWindSnowSurfaceFabric({ slopeDegrees: 0, aspectDot: 0, foldGradient: 0 });
validateFabric(neutral, 'neutral');
assert.equal(neutral.foldStrength, 0);
assert.equal(neutral.ridgeShoulder, 0);
assert.equal(neutral.brokenRidge, 0);
assert.equal(neutral.shelteredPocket, 0);
assert.equal(neutral.valleyContinuity, 0);
assert.equal(neutral.cliff, 0);
assert(neutral.crosswindNeutrality > 0.95);
assert(approx(neutral.windwardGain, 0.93, 0.08));
assert(approx(neutral.leeGain, 0.93, 0.08));
assert(neutral.materialTemperatureBias <= 0.02);
assert(neutral.materialTemperatureBias >= -0.02);

const flatAspectSweep = [-1, -0.75, -0.4, -0.1, 0, 0.1, 0.4, 0.75, 1];
for (const aspect of flatAspectSweep) {
  const fabric = resolveTerrainWindSnowSurfaceFabric({ slopeDegrees: 1, aspectDot: aspect, foldGradient: 0 });
  validateFabric(fabric, `flat-aspect-${aspect}`);
  assert(fabric.crosswindNeutrality >= 0);
  assert(fabric.crosswindNeutrality <= 1);
}

const exactCrosswind = resolveTerrainWindSnowSurfaceFabric({ slopeDegrees: 28, aspectDot: 0, foldGradient: 0.12 });
validateFabric(exactCrosswind, 'crosswind');
assert(exactCrosswind.crosswindNeutrality >= 0.99);
assert(exactCrosswind.windwardAlignment === 0);
assert(exactCrosswind.leeAlignment === 0);
assert(exactCrosswind.windwardGain < 1.05);
assert(exactCrosswind.leeGain < 1.05);

const windward = resolveTerrainWindSnowSurfaceFabric({ slopeDegrees: 28, aspectDot: 0.90, foldGradient: 0.08 });
const lee = resolveTerrainWindSnowSurfaceFabric({ slopeDegrees: 28, aspectDot: -0.90, foldGradient: 0.08 });
validateFabric(windward, 'windward');
validateFabric(lee, 'lee');
assert(windward.windwardAlignment > 0.8);
assert(windward.leeAlignment === 0);
assert(lee.leeAlignment > 0.8);
assert(lee.windwardAlignment === 0);
assert(windward.ridgeCrust > lee.ridgeCrust);
assert(lee.leePowder > windward.leePowder);
assert(windward.materialTemperatureBias < lee.materialTemperatureBias);
assert(windward.materialBrightnessBias < lee.materialBrightnessBias);

const foldSweep = [0, 0.005, 0.01, 0.025, 0.05, 0.09, 0.14, 0.20, 0.28, 0.40];
let priorFold = -1;
for (const fold of foldSweep) {
  const fabric = resolveTerrainWindSnowSurfaceFabric({ slopeDegrees: 30, aspectDot: 0.82, foldGradient: fold });
  validateFabric(fabric, `fold-${fold}`);
  assert(fabric.foldStrength >= priorFold, `fold strength regressed at ${fold}`);
  priorFold = fabric.foldStrength;
}
assert(priorFold <= 1);

const slopeSweep = [0, 2, 4, 6, 9, 12, 16, 22, 30, 38, 46, 54, 62, 72, 90];
let priorSlope = -1;
for (const slope of slopeSweep) {
  const fabric = resolveTerrainWindSnowSurfaceFabric({ slopeDegrees: slope, aspectDot: 0.75, foldGradient: 0.10 });
  validateFabric(fabric, `slope-${slope}`);
  assert(fabric.slope >= priorSlope, `normalized slope regressed at ${slope}`);
  priorSlope = fabric.slope;
}
assert(priorSlope <= 1);

const cliffWindward = resolveTerrainWindSnowSurfaceFabric({ slopeDegrees: 72, aspectDot: 0.9, foldGradient: 0.15 });
const cliffLee = resolveTerrainWindSnowSurfaceFabric({ slopeDegrees: 72, aspectDot: -0.9, foldGradient: 0.15 });
validateFabric(cliffWindward, 'cliff-windward');
validateFabric(cliffLee, 'cliff-lee');
assert(cliffWindward.cliff > 0.9);
assert(cliffLee.cliff > 0.9);
assert(cliffWindward.windwardGain < windward.windwardGain + 0.14);
assert(cliffLee.leeGain < lee.leeGain);
assert(cliffLee.retention < lee.retention);

const retentionSweep = [0, 0.1, 0.25, 0.5, 0.75, 1];
for (const retention of retentionSweep) {
  const fabric = resolveTerrainWindSnowSurfaceFabric({
    slopeDegrees: 26,
    aspectDot: -0.8,
    foldGradient: 0.14,
    leeRetention: retention,
  });
  validateFabric(fabric, `retention-${retention}`);
  assert(approx(fabric.leeRetention, retention, EPS));
}

const families = buildTerrainWindSnowSurfaceFamilyMatrix({ directions: 16, aspectMagnitude: 0.80 });
assert.equal(families.length, SNOW_RELIEF_FAMILIES.length * 16);
for (const row of families) {
  validateFabric(row.fabric, `family-${row.family}-${row.index}`);
  assert(row.digest.includes('continuity='));
  assert(Number.isFinite(row.theta));
  assert(between(row.aspectDot, -1, 1));
}
for (const family of SNOW_RELIEF_FAMILIES) {
  const rows = families.filter((row) => row.family === family.id);
  assert.equal(rows.length, 16);
  const unique = new Set(rows.map((row) => row.digest));
  assert(unique.size >= 5, `${family.id}: directional fabric collapsed too aggressively`);
}

const ladder = buildTerrainWindSnowSurfaceProbeLadder({
  slopes: [0, 8, 18, 30, 46, 62],
  folds: [0, 0.02, 0.08, 0.16, 0.24],
  aspects: [-1, -0.55, 0, 0.55, 1],
});
assert.equal(ladder.length, 6 * 5 * 5);
for (const row of ladder) {
  assert(between(row.aspectDot, -1, 1));
  assert(bounded(row.continuity));
  assert(between(row.windwardGain, TERRAIN_WIND_SNOW_SURFACE_FABRIC_POLICY.minGain, TERRAIN_WIND_SNOW_SURFACE_FABRIC_POLICY.maxGain));
  assert(between(row.leeGain, TERRAIN_WIND_SNOW_SURFACE_FABRIC_POLICY.minGain, TERRAIN_WIND_SNOW_SURFACE_FABRIC_POLICY.maxGain));
  assert(typeof row.digest === 'string' && row.digest.length > 32);
}

const directionalMirrorPairs = [
  [0.2, 0.05],
  [0.42, 0.08],
  [0.7, 0.12],
  [0.9, 0.18],
];
for (const [aspect, fold] of directionalMirrorPairs) {
  const a = resolveTerrainWindSnowSurfaceFabric({ slopeDegrees: 28, aspectDot: aspect, foldGradient: fold });
  const b = resolveTerrainWindSnowSurfaceFabric({ slopeDegrees: 28, aspectDot: -aspect, foldGradient: fold });
  validateFabric(a, `mirror-positive-${aspect}`);
  validateFabric(b, `mirror-negative-${aspect}`);
  assert(approx(a.ridgeCrust, b.leePowder, 0.42), `mirror family diverged unexpectedly at ${aspect}`);
  assert(a.windwardAlignment > 0);
  assert(a.leeAlignment === 0);
  assert(b.leeAlignment > 0);
  assert(b.windwardAlignment === 0);
}

for (const slope of slopeSweep) {
  for (const aspect of [-1, -0.8, -0.4, 0, 0.4, 0.8, 1]) {
    for (const fold of [0, 0.02, 0.06, 0.12, 0.20, 0.35]) {
      const fabric = resolveTerrainWindSnowSurfaceFabric({ slopeDegrees: slope, aspectDot: aspect, foldGradient: fold });
      validateFabric(fabric, `cartesian-${slope}-${aspect}-${fold}`);
      assert(Number.isFinite(resolveTerrainWindSnowContinuity({ slopeDegrees: slope, aspectDot: aspect, foldGradient: fold })));
      validateHints(resolveTerrainWindSnowToneHints({ slopeDegrees: slope, aspectDot: aspect, foldGradient: fold }), `hints-${slope}-${aspect}-${fold}`);
      validateSummary(summarizeTerrainWindSnowSurfaceFabric(fabric), `summary-${slope}-${aspect}-${fold}`);
    }
  }
}

const malformedInputs = [
  null,
  undefined,
  {},
  { slopeDegrees: NaN, aspectDot: Infinity, foldGradient: -Infinity, leeRetention: NaN },
  { slopeDegrees: 'bad', aspectDot: 'bad', foldGradient: {}, leeRetention: [] },
  { slopeDegrees: -100, aspectDot: 100, foldGradient: -1, leeRetention: 4 },
  { slopeDegrees: Infinity, aspectDot: -Infinity, foldGradient: Infinity, leeRetention: -Infinity },
];
for (let i = 0; i < malformedInputs.length; i += 1) {
  const input = malformedInputs[i];
  const sanitized = sanitizeTerrainWindSnowSurfaceFabricInput(input ?? {});
  assert(Object.isFrozen(sanitized), `sanitized-${i}: output must be immutable`);
  assert(finite(sanitized.slopeDegrees), `sanitized-${i}: slope non-finite`);
  assert(finite(sanitized.aspectDot), `sanitized-${i}: aspect non-finite`);
  assert(finite(sanitized.foldGradient), `sanitized-${i}: fold non-finite`);
  assert(finite(sanitized.leeRetention), `sanitized-${i}: retention non-finite`);
  const safe = resolveTerrainWindSnowSurfaceFabricSafely(input ?? {});
  validateFabric(safe, `safe-${i}`);
}

const continuityFixtures = [
  { slopeDegrees: 1, aspectDot: 0, foldGradient: 0 },
  { slopeDegrees: 9, aspectDot: 0.5, foldGradient: 0.01 },
  { slopeDegrees: 22, aspectDot: -0.5, foldGradient: 0.08 },
  { slopeDegrees: 32, aspectDot: 0.85, foldGradient: 0.16 },
  { slopeDegrees: 48, aspectDot: -0.85, foldGradient: 0.23 },
  { slopeDegrees: 64, aspectDot: 0.2, foldGradient: 0.3 },
];
for (const fixture of continuityFixtures) {
  const continuity = resolveTerrainWindSnowContinuity(fixture);
  assert(bounded(continuity), `continuity fixture out of range: ${JSON.stringify(fixture)}`);
}

const tonePairs = [
  { slopeDegrees: 20, aspectDot: 0.75, foldGradient: 0.04 },
  { slopeDegrees: 20, aspectDot: -0.75, foldGradient: 0.04 },
  { slopeDegrees: 40, aspectDot: 0.8, foldGradient: 0.16 },
  { slopeDegrees: 40, aspectDot: -0.8, foldGradient: 0.16 },
];
for (const pair of tonePairs) {
  const hints = resolveTerrainWindSnowToneHints(pair);
  validateHints(hints, `tone-${JSON.stringify(pair)}`);
  assert(between(hints.brightness, -1, 1));
}

const familyCoverage = new Map();
for (const row of families) {
  familyCoverage.set(row.family, (familyCoverage.get(row.family) ?? 0) + 1);
}
assert.equal(familyCoverage.size, SNOW_RELIEF_FAMILIES.length);
for (const count of familyCoverage.values()) assert.equal(count, 16);

const digestSet = new Set();
for (const row of ladder) digestSet.add(row.digest);
assert(digestSet.size > ladder.length * 0.30, 'probe ladder is too collapsed; directional breakup may read as a binary mask');

const neutralDigest = terrainWindSnowSurfaceFabricDigest(neutral);
assert(neutralDigest.includes('crosswindNeutrality='));
assert(neutralDigest.includes('materialTemperatureBias='));

const summary = summarizeTerrainWindSnowSurfaceFabric(baseline);
validateSummary(summary, 'baseline-summary');
assert.equal(summary.windwardGain, baseline.windwardGain);
assert.equal(summary.leeGain, baseline.leeGain);

const summaryForNull = summarizeTerrainWindSnowSurfaceFabric(null);
validateSummary(summaryForNull, 'null-summary');
assert.equal(summaryForNull.windwardGain, 1);
assert.equal(summaryForNull.leeGain, 1);

const hintsForEmpty = resolveTerrainWindSnowToneHints({});
validateHints(hintsForEmpty, 'empty-hints');

const deterministicDigestPairs = [];
for (const sample of [
  ...SNOW_RELIEF_FAMILIES,
  ...continuityFixtures,
  ...tonePairs,
]) {
  const fabricA = resolveTerrainWindSnowSurfaceFabric(sample);
  const fabricB = resolveTerrainWindSnowSurfaceFabric(sample);
  deterministicDigestPairs.push([terrainWindSnowSurfaceFabricDigest(fabricA), terrainWindSnowSurfaceFabricDigest(fabricB)]);
}
for (const [a, b] of deterministicDigestPairs) assert.equal(a, b);

let minContinuity = 1;
let maxContinuity = 0;
let minGain = Infinity;
let maxGain = -Infinity;
for (const row of ladder) {
  minContinuity = Math.min(minContinuity, row.continuity);
  maxContinuity = Math.max(maxContinuity, row.continuity);
  minGain = Math.min(minGain, row.windwardGain, row.leeGain);
  maxGain = Math.max(maxGain, row.windwardGain, row.leeGain);
}
assert(minContinuity >= 0 && maxContinuity <= 1);
assert(minGain >= TERRAIN_WIND_SNOW_SURFACE_FABRIC_POLICY.minGain - EPS);
assert(maxGain <= TERRAIN_WIND_SNOW_SURFACE_FABRIC_POLICY.maxGain + EPS);

const report = {
  policy: TERRAIN_WIND_SNOW_SURFACE_FABRIC_POLICY.id,
  familyCount: SNOW_RELIEF_FAMILIES.length,
  familyRows: families.length,
  ladderRows: ladder.length,
  uniqueLadderDigests: digestSet.size,
  continuityRange: [minContinuity, maxContinuity],
  gainRange: [minGain, maxGain],
  deterministicDigestCount: deterministicDigestPairs.length,
};
console.log(`[checkTerrainWindSnowFieldMatrix] PASS ${JSON.stringify(report)}`);
