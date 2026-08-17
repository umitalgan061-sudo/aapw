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
expectOk('ridge-rock', { height: 870, slopeDegrees: 64, waterDepth: 0, biome: 'alpine-bare' }, WORLD_SURFACE_POLICY_PRESETS.rock);
expectError('vertical-rock', { height: 80, slopeDegrees: 85, waterDepth: 0 }, WORLD_SURFACE_POLICY_PRESETS.rock, 'slope-too-steep');
expectOk('flat-building', { height: 35, slopeDegrees: 4, waterDepth: 0, roadDistance: 8, biome: 'settlement' }, WORLD_SURFACE_POLICY_PRESETS.building);
expectError('cliff-building', { height: 35, slopeDegrees: 19, waterDepth: 0 }, WORLD_SURFACE_POLICY_PRESETS.building, 'slope-too-steep');
expectError('submerged-building', { height: -0.4, slopeDegrees: 1, waterDepth: 0.4 }, WORLD_SURFACE_POLICY_PRESETS.building, 'water-too-deep');
expectOk('river-bridge', { height: 1.5, slopeDegrees: 8, waterDepth: 6, roadDistance: 0, waterType: 'river' }, WORLD_SURFACE_POLICY_PRESETS.bridge);

const contextual = resolveWorldSurfacePolicy({ category: 'vegetation' }, { maxSlopeDegrees: 22, minSettlementDistance: 20, allowedBiomes: ['meadow', 'temperate-forest'] });
expectOk('meadow-shrub', { height: 73, slopeDegrees: 8, waterDepth: 0, roadDistance: 3, settlementDistance: 45, biome: 'meadow' }, contextual);
expectError('settlement-buffer', { height: 73, slopeDegrees: 8, waterDepth: 0, roadDistance: 3, settlementDistance: 4, biome: 'meadow' }, contextual, 'too-close-to-settlement');
expectError('biome-mask', { height: 73, slopeDegrees: 8, waterDepth: 0, roadDistance: 3, settlementDistance: 45, biome: 'tundra' }, contextual, 'biome-not-allowed');

for (const sample of [null, undefined, {}, { height: null }, { height: Number.NaN }, { height: Infinity }]) {
  assert.equal(normalizeWorldSurfaceSample(sample).ok, false, 'malformed ground must fail');
}
for (const sample of [{ height: 1, slopeDegrees: -1 }, { height: 1, waterDepth: -0.1 }, { height: 1, roadDistance: -0.1 }, { height: 1, settlementDistance: -0.1 }]) {
  assert.equal(normalizeWorldSurfaceSample(sample).ok, false, 'negative terrain context must fail');
}

const deterministicInput = { height: 44.25, slopeDegrees: 17.5, waterDepth: 0, roadDistance: 11, settlementDistance: 91, biome: 'meadow' };
const deterministicPolicy = resolveWorldSurfacePolicy({ category: 'vegetation' }, { maxSlopeDegrees: 24, allowedBiomes: ['MEADOW', 'meadow', 'Temperate-Forest'] });
assert.deepEqual(
  evaluateWorldSurfacePlacement(deterministicInput, deterministicPolicy),
  evaluateWorldSurfacePlacement(structuredClone(deterministicInput), structuredClone(deterministicPolicy)),
  'surface placement must be deterministic',
);

console.log('[checkWorldSurfacePlacementPolicy] PASS: shared placement core deterministically rejects floating/invalid sea, cliff, road, biome and malformed-ground placements while preserving valid tree/rock/building/bridge cases.');
