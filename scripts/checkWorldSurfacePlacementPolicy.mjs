#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  WORLD_SURFACE_POLICY_PRESETS,
  evaluateWorldSurfacePlacement,
  normalizeWorldSurfaceSample,
  resolveWorldSurfacePlacement,
  resolveWorldSurfacePolicy,
  validateWorldSurfacePolicy,
} from '../src/3d/world/WorldAssetPlacementPipeline.js';

function expectOk(label, surface, policy) {
  const result = evaluateWorldSurfacePlacement(surface, policy);
  assert.equal(result.ok, true, `${label}: expected pass, got ${result.errors.join(',')}`);
}
function expectError(label, surface, policy, expected) {
  const result = evaluateWorldSurfacePlacement(surface, policy);
  assert.equal(result.ok, false, `${label}: expected rejection`);
  assert(result.errors.includes(expected), `${label}: expected ${expected}, got ${result.errors.join(',')}`);
}
function expectPolicyError(label, policy, expected) {
  const validation = validateWorldSurfacePolicy(policy);
  assert.equal(validation.ok, false, `${label}: malformed policy must fail validation`);
  assert(validation.errors.includes(expected), `${label}: expected ${expected}, got ${validation.errors.join(',')}`);
  expectError(label, forest, policy, expected);
}

const forest = { height: 118.4, slopeDegrees: 13.2, waterDepth: 0, roadDistance: 9.8, settlementDistance: 142, moisture: 0.67, biome: 'temperate-forest', waterType: null };
assert.deepEqual(normalizeWorldSurfaceSample(forest), { ok: true, sample: forest });
expectOk('tree-on-forest-floor', forest, WORLD_SURFACE_POLICY_PRESETS.tree);
expectError('tree-in-sea', { ...forest, waterDepth: 4.2, biome: 'ocean', waterType: 'ocean' }, WORLD_SURFACE_POLICY_PRESETS.tree, 'water-too-deep');
expectError('tree-on-cliff', { ...forest, slopeDegrees: 61 }, WORLD_SURFACE_POLICY_PRESETS.tree, 'slope-too-steep');
expectError('tree-on-road', { ...forest, roadDistance: 0.4 }, WORLD_SURFACE_POLICY_PRESETS.tree, 'too-close-to-road');
expectError('tree-in-alpine-bare', { ...forest, biome: 'alpine-bare' }, WORLD_SURFACE_POLICY_PRESETS.tree, 'biome-forbidden');
expectError('tree-without-slope', { ...forest, slopeDegrees: null }, WORLD_SURFACE_POLICY_PRESETS.tree, 'missing-slope');
expectError('tree-without-water-depth', { ...forest, waterDepth: null }, WORLD_SURFACE_POLICY_PRESETS.tree, 'missing-water-depth');
expectError('tree-without-road-distance', { ...forest, roadDistance: null }, WORLD_SURFACE_POLICY_PRESETS.tree, 'missing-road-distance');
expectError('tree-without-biome', { ...forest, biome: null }, WORLD_SURFACE_POLICY_PRESETS.tree, 'missing-biome');
expectOk('ridge-rock', { height: 870, slopeDegrees: 64, waterDepth: 0, biome: 'alpine-bare' }, WORLD_SURFACE_POLICY_PRESETS.rock);
expectError('vertical-rock', { height: 80, slopeDegrees: 85, waterDepth: 0 }, WORLD_SURFACE_POLICY_PRESETS.rock, 'slope-too-steep');
expectOk('flat-building', { height: 35, slopeDegrees: 4, waterDepth: 0, roadDistance: 8, biome: 'settlement' }, WORLD_SURFACE_POLICY_PRESETS.building);
expectError('cliff-building', { height: 35, slopeDegrees: 19, waterDepth: 0, roadDistance: 8 }, WORLD_SURFACE_POLICY_PRESETS.building, 'slope-too-steep');
expectError('submerged-building', { height: -0.4, slopeDegrees: 1, waterDepth: 0.4, roadDistance: 8 }, WORLD_SURFACE_POLICY_PRESETS.building, 'water-too-deep');
expectOk('river-bridge', { height: 1.5, slopeDegrees: 8, waterDepth: 6, roadDistance: 0, waterType: 'river' }, WORLD_SURFACE_POLICY_PRESETS.bridge);

const contextual = resolveWorldSurfacePolicy({ category: 'vegetation' }, {
  maxSlopeDegrees: 22,
  minSettlementDistance: 20,
  minMoisture: 0.25,
  maxMoisture: 0.9,
  allowedBiomes: ['meadow', 'temperate-forest'],
});
expectOk('meadow-shrub', { height: 73, slopeDegrees: 8, waterDepth: 0, roadDistance: 3, settlementDistance: 45, moisture: 0.55, biome: 'meadow' }, contextual);
expectError('settlement-buffer', { height: 73, slopeDegrees: 8, waterDepth: 0, roadDistance: 3, settlementDistance: 4, moisture: 0.55, biome: 'meadow' }, contextual, 'too-close-to-settlement');
expectError('biome-mask', { height: 73, slopeDegrees: 8, waterDepth: 0, roadDistance: 3, settlementDistance: 45, moisture: 0.55, biome: 'tundra' }, contextual, 'biome-not-allowed');
expectError('missing-moisture', { height: 73, slopeDegrees: 8, waterDepth: 0, roadDistance: 3, settlementDistance: 45, biome: 'meadow' }, contextual, 'missing-moisture');
expectError('too-dry', { height: 73, slopeDegrees: 8, waterDepth: 0, roadDistance: 3, settlementDistance: 45, moisture: 0.1, biome: 'meadow' }, contextual, 'too-dry');
expectError('too-wet', { height: 73, slopeDegrees: 8, waterDepth: 0, roadDistance: 3, settlementDistance: 45, moisture: 0.96, biome: 'meadow' }, contextual, 'too-wet');

const riverOnly = resolveWorldSurfacePolicy({}, { allowedWaterTypes: ['river'] });
expectError('missing-water-type', { height: 2, waterDepth: 1 }, riverOnly, 'missing-water-type');
expectError('wrong-water-type', { height: 2, waterDepth: 1, waterType: 'lake' }, riverOnly, 'water-type-not-allowed');
expectOk('allowed-water-type', { height: 2, waterDepth: 1, waterType: 'river' }, riverOnly);

for (const sample of [null, undefined, {}, { height: null }, { height: Number.NaN }, { height: Infinity }]) {
  assert.equal(normalizeWorldSurfaceSample(sample).ok, false, 'malformed ground must fail');
}
for (const sample of [{ height: 1, slopeDegrees: -1 }, { height: 1, waterDepth: -0.1 }, { height: 1, roadDistance: -0.1 }, { height: 1, settlementDistance: -0.1 }, { height: 1, moisture: -0.1 }, { height: 1, moisture: 1.1 }]) {
  assert.equal(normalizeWorldSurfaceSample(sample).ok, false, 'invalid terrain context must fail');
}

expectPolicyError('scalar-policy', 'invalid', 'policy-invalid-object');
expectPolicyError('array-policy', [], 'policy-invalid-object');
expectPolicyError('unknown-policy-key', { maxSlopeDegree: 20 }, 'policy-unknown-max-slope-degree');
expectPolicyError('non-finite-max-slope', { maxSlopeDegrees: 'broken' }, 'policy-invalid-max-slope-degrees');
expectPolicyError('negative-road-buffer', { minRoadDistance: -1 }, 'policy-invalid-min-road-distance');
expectPolicyError('scalar-biome-list', { allowedBiomes: 'temperate-forest' }, 'policy-invalid-allowed-biomes');
expectPolicyError('blank-biome-entry', { allowedBiomes: ['temperate-forest', '   '] }, 'policy-invalid-allowed-biomes');
expectPolicyError('inverted-slope-range', { minSlopeDegrees: 40, maxSlopeDegrees: 10 }, 'policy-inverted-slope-range');
expectPolicyError('inverted-moisture-range', { minMoisture: 0.8, maxMoisture: 0.2 }, 'policy-inverted-moisture-range');
expectPolicyError('moisture-policy-over-one', { maxMoisture: 1.2 }, 'policy-invalid-max-moisture');
assert.deepEqual(
  resolveWorldSurfacePolicy({}, { allowedBiomes: [' Meadow ', 'meadow', 'FOREST'] }).allowedBiomes,
  ['forest', 'meadow'],
  'policy string lists must trim, normalize case and deduplicate deterministically',
);
for (const badOverride of ['invalid', [], { maxSlopeDegrees: 'broken' }, { maxSlopeDegree: 20 }]) {
  assert.throws(
    () => resolveWorldSurfacePolicy({}, badOverride),
    /policy-(invalid|unknown)-/,
    'public policy resolver must fail closed on malformed overrides',
  );
}

for (const badPolicy of ['invalid', [], { maxSlopeDegrees: 'broken' }, { maxSlopeDegree: 20 }]) {
  const unsnapped = { position: { x: 5, y: 999, z: 7 } };
  const rejectedRuntimePolicy = resolveWorldSurfacePlacement(unsnapped, {
    metadata: { category: 'tree' },
    surfaceQuery: () => forest,
    placementPolicy: badPolicy,
    requireSurfaceContext: true,
  });
  assert.equal(rejectedRuntimePolicy.ok, false, 'runtime placement must reject malformed policy before scene attach');
  assert(rejectedRuntimePolicy.error.includes('policy-'), `unexpected runtime rejection: ${rejectedRuntimePolicy.error}`);
  assert.equal(unsnapped.position.y, 999, 'rejected policy must not snap or mutate asset height');
}

const deterministicInput = { height: 44.25, slopeDegrees: 17.5, waterDepth: 0, roadDistance: 11, settlementDistance: 91, moisture: 0.6, biome: 'meadow' };
const deterministicPolicy = resolveWorldSurfacePolicy({ category: 'vegetation' }, { maxSlopeDegrees: 24, minMoisture: 0.2, allowedBiomes: ['MEADOW', 'meadow', 'Temperate-Forest'] });
assert.deepEqual(
  evaluateWorldSurfacePlacement(deterministicInput, deterministicPolicy),
  evaluateWorldSurfacePlacement(structuredClone(deterministicInput), structuredClone(deterministicPolicy)),
  'surface placement must be deterministic',
);

console.log('[checkWorldSurfacePlacementPolicy] PASS: shared placement core fails closed on missing terrain context, invalid policy shapes/keys and malformed policy values, rejects invalid sea, cliff, road, biome, moisture, water-type and malformed-ground placements, and preserves valid deterministic tree/rock/building/bridge cases.');
