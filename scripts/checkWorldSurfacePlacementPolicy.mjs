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
  assert.equal(result.ok, true, `${label}: expected placement to pass, got ${result.errors.join(',')}`);
  return result;
}

function expectError(label, surface, policy, expected) {
  const result = evaluateWorldSurfacePlacement(surface, policy);
  assert.equal(result.ok, false, `${label}: expected placement rejection`);
  assert(result.errors.includes(expected), `${label}: expected ${expected}, got ${result.errors.join(',')}`);
  return result;
}

const forestFloor = {
  height: 118.4,
  slopeDegrees: 13.2,
  waterDepth: 0,
  roadDistance: 9.8,
  settlementDistance: 142,
  moisture: 0.67,
  biome: 'temperate-forest',
  waterType: null,
};

const normalized = normalizeWorldSurfaceSample(forestFloor);
assert.equal(normalized.ok, true);
assert.deepEqual(normalized.sample, forestFloor);

expectOk('tree-on-forest-floor', forestFloor, WORLD_SURFACE_POLICY_PRESETS.tree);
expectError('tree-in-sea', { ...forestFloor, waterDepth: 4.2, biome: 'ocean', waterType: 'ocean' }, WORLD_SURFACE_POLICY_PRESETS.tree, 'water-too-deep');
expectError('tree-on-cliff', { ...forestFloor, slopeDegrees: 61 }, WORLD_SURFACE_POLICY_PRESETS.tree, 'slope-too-steep');
expectError('tree-on-road-edge', { ...forestFloor, roadDistance: 0.4 }, WORLD_SURFACE_POLICY_PRESETS.tree, 'too-close-to-road');
expectError('tree-in-forbidden-biome', { ...forestFloor, biome: 'alpine-bare' }, WORLD_SURFACE_POLICY_PRESETS.tree, 'biome-forbidden');

expectOk('rock-on-steep-ridge', {
  height: 870,
  slopeDegrees: 64,
  waterDepth: 0,
  roadDistance: 24,
  settlementDistance: 500,
  biome: 'alpine-bare',
}, WORLD_SURFACE_POLICY_PRESETS.rock);
expectError('rock-on-impossible-wall', { height: 80, slopeDegrees: 85, waterDepth: 0 }, WORLD_SURFACE_POLICY_PRESETS.rock, 'slope-too-steep');
expectError('rock-deep-underwater', { height: -7, slopeDegrees: 9, waterDepth: 7 }, WORLD_SURFACE_POLICY_PRESETS.rock, 'water-too-deep');

expectOk('building-on-flat-pad', {
  height: 35,
  slopeDegrees: 4,
  waterDepth: 0,
  roadDistance: 8,
  settlementDistance: 0,
  biome: 'settlement',
}, WORLD_SURFACE_POLICY_PRESETS.building);
expectError('building-on-steep-slope', { height: 35, slopeDegrees: 19, waterDepth: 0 }, WORLD_SURFACE_POLICY_PRESETS.building, 'slope-too-steep');
expectError('building-in-water', { height: -0.4, slopeDegrees: 1, waterDepth: 0.4 }, WORLD_SURFACE_POLICY_PRESETS.building, 'water-too-deep');

expectOk('bridge-over-water', {
  height: 1.5,
  slopeDegrees: 8,
  waterDepth: 6,
  roadDistance: 0,
  waterType: 'river',
}, WORLD_SURFACE_POLICY_PRESETS.bridge);

const contextualPolicy = resolveWorldSurfacePolicy(
  { category: 'vegetation' },
  {
    maxSlopeDegrees: 22,
    minSettlementDistance: 20,
    allowedBiomes: ['meadow', 'temperate-forest'],
  },
);
assert.equal(contextualPolicy.maxSlopeDegrees, 22);
assert.equal(contextualPolicy.maxWaterDepth, 0.05);
assert.equal(contextualPolicy.minRoadDistance, 0.75);
assert.equal(contextualPolicy.minSettlementDistance, 20);
assert.deepEqual(contextualPolicy.allowedBiomes, ['meadow', 'temperate-forest']);
assert.deepEqual(contextualPolicy.forbiddenBiomes, ['cliff', 'lake', 'ocean', 'river']);

expectOk('contextual-meadow-shrub', {
  height: 73,
  slopeDegrees: 8,
  waterDepth: 0,
  roadDistance: 3,
  settlementDistance: 45,
  biome: 'meadow',
}, contextualPolicy);
expectError('contextual-settlement-buffer', {
  height: 73,
  slopeDegrees: 8,
  waterDepth: 0,
  roadDistance: 3,
  settlementDistance: 4,
  biome: 'meadow',
}, contextualPolicy, 'too-close-to-settlement');
expectError('contextual-biome-mask', {
  height: 73,
  slopeDegrees: 8,
  waterDepth: 0,
  roadDistance: 3,
  settlementDistance: 45,
  biome: 'tundra',
}, contextualPolicy, 'biome-not-allowed');

const roadBoundProp = {
  minRoadDistance: 1,
  maxRoadDistance: 12,
  maxSlopeDegrees: 18,
  maxWaterDepth: 0.05,
};
expectOk('roadside-prop', { height: 12, slopeDegrees: 5, waterDepth: 0, roadDistance: 4 }, roadBoundProp);
expectError('prop-over-road', { height: 12, slopeDegrees: 5, waterDepth: 0, roadDistance: 0.2 }, roadBoundProp, 'too-close-to-road');
expectError('prop-too-far-from-road', { height: 12, slopeDegrees: 5, waterDepth: 0, roadDistance: 40 }, roadBoundProp, 'too-far-from-road');

const riverOnly = { allowedWaterTypes: ['river'], minWaterDepth: 0.2, maxWaterDepth: 8 };
expectOk('river-only-placement', { height: -1, waterDepth: 2, waterType: 'river' }, riverOnly);
expectError('river-only-lake-rejection', { height: -1, waterDepth: 2, waterType: 'lake' }, riverOnly, 'water-type-not-allowed');
expectError('river-only-dry-rejection', { height: 1, waterDepth: 0, waterType: 'river' }, riverOnly, 'water-too-shallow');

const forbiddenWater = { forbiddenWaterTypes: ['ocean', 'lake'] };
expectError('ocean-forbidden', { height: -2, waterDepth: 3, waterType: 'ocean' }, forbiddenWater, 'water-type-forbidden');

const deterministicInput = {
  height: 44.25,
  slopeDegrees: 17.5,
  waterDepth: 0,
  roadDistance: 11,
  settlementDistance: 91,
  moisture: 0.3,
  biome: 'meadow',
};
const deterministicPolicy = resolveWorldSurfacePolicy({ category: 'vegetation' }, {
  maxSlopeDegrees: 24,
  allowedBiomes: ['MEADOW', 'meadow', 'Temperate-Forest'],
});
const a = evaluateWorldSurfacePlacement(deterministicInput, deterministicPolicy);
const b = evaluateWorldSurfacePlacement(structuredClone(deterministicInput), structuredClone(deterministicPolicy));
assert.deepEqual(a, b, 'surface placement evaluation must be deterministic');
assert.deepEqual(deterministicPolicy.allowedBiomes, ['meadow', 'temperate-forest']);

const malformedCases = [
  null,
  undefined,
  {},
  { height: Number.NaN },
  { height: Infinity },
];
for (const [index, sample] of malformedCases.entries()) {
  const result = normalizeWorldSurfaceSample(sample);
  assert.equal(result.ok, false, `malformed sample ${index} should fail`);
}

for (const [key, sample] of [
  ['slope', { height: 1, slopeDegrees: -1 }],
  ['water', { height: 1, waterDepth: -0.1 }],
  ['road', { height: 1, roadDistance: -0.1 }],
  ['settlement', { height: 1, settlementDistance: -0.1 }],
]) {
  const result = normalizeWorldSurfaceSample(sample);
  assert.equal(result.ok, false, `${key} must reject negative distance/slope inputs`);
}

console.log('[checkWorldSurfacePlacementPolicy] PASS: deterministic terrain-context placement rejects sea trees, cliff buildings, road overlap, invalid biome/water contexts, and malformed ground samples while preserving valid rock/bridge/settlement cases.');
