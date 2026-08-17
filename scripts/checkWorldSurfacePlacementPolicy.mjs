#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  WORLD_SURFACE_POLICY_PRESETS,
  evaluateWorldSurfacePlacement,
  normalizeWorldSurfaceSample,
  resolveWorldSurfacePolicy,
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

const deterministicInput = { height: 44.25, slopeDegrees: 17.5, waterDepth: 0, roadDistance: 11, settlementDistance: 91, moisture: 0.6, biome: 'meadow' };
const deterministicPolicy = resolveWorldSurfacePolicy({ category: 'vegetation' }, { maxSlopeDegrees: 24, minMoisture: 0.2, allowedBiomes: ['MEADOW', 'meadow', 'Temperate-Forest'] });
assert.deepEqual(
  evaluateWorldSurfacePlacement(deterministicInput, deterministicPolicy),
  evaluateWorldSurfacePlacement(structuredClone(deterministicInput), structuredClone(deterministicPolicy)),
  'surface placement must be deterministic',
);

console.log('[checkWorldSurfacePlacementPolicy] PASS: shared placement core fails closed when constrained terrain context is missing and deterministically rejects invalid sea, cliff, road, biome, moisture, water-type and malformed-ground placements while preserving valid tree/rock/building/bridge cases.');
