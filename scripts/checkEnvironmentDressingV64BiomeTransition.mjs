import assert from 'node:assert/strict';
import {
  createBiomeEcotoneTransitionV64,
  validateBiomeEcotoneTransitionV64,
  compareBiomeEcotoneTransitionsV64,
} from '../src/3d/world/environmentBiomeTransitionV64.js';

function testForestEdge() {
  const result = createBiomeEcotoneTransitionV64({
    biome: 'forest',
    adjacentBiomes: ['grassland', 'shrubland', 'forest'],
    moisture: 0.64,
    elevation01: 0.46,
    snowWeight: 0.03,
    slopeDegrees: 9,
    waterDistance: 140,
    relief: 0.68,
    seed: 'forest-edge',
  });
  assert.equal(result.currentGroup, 'wooded');
  assert.equal(result.dominantNeighbourGroup, 'open');
  assert.equal(result.ecotone.forestToShrub, true);
  assert.ok(result.weights.canopy > 0);
  assert.ok(result.transitionBandMeters > 12);
  assert.equal(validateBiomeEcotoneTransitionV64(result).valid, true);
}

function testAlpineRockSnowEdge() {
  const result = createBiomeEcotoneTransitionV64({
    biome: 'alpine',
    adjacentBiomes: ['tundra', 'taiga'],
    moisture: 0.48,
    elevation01: 0.92,
    snowWeight: 0.78,
    slopeDegrees: 52,
    waterDistance: 900,
    relief: 0.86,
    seed: 'alpine-edge',
  });
  assert.equal(result.currentGroup, 'cold');
  assert.equal(result.ecotone.alpineRockEdge, true);
  assert.equal(result.ecotone.coldEdge, true);
  assert.ok(result.weights.rock > 0);
  assert.ok(result.weights.snowEdge > 0);
  assert.ok(result.weights.snowEdge > result.weights.wetEdge);
}

function testWetlandWaterEdge() {
  const result = createBiomeEcotoneTransitionV64({
    biome: 'wetland',
    adjacentBiomes: ['riverine', 'grassland'],
    moisture: 0.88,
    elevation01: 0.18,
    snowWeight: 0,
    slopeDegrees: 3,
    waterDistance: 8,
    relief: 0.24,
    seed: 'wet-edge',
  });
  assert.equal(result.currentGroup, 'wet');
  assert.equal(result.ecotone.wetEdge, true);
  assert.ok(result.weights.wetEdge > 0);
  assert.ok(result.weights.grass > 0);
}

function testDesertTransition() {
  const result = createBiomeEcotoneTransitionV64({
    biome: 'desert',
    adjacentBiomes: ['steppe', 'grassland'],
    moisture: 0.08,
    elevation01: 0.52,
    snowWeight: 0,
    slopeDegrees: 18,
    waterDistance: 700,
    relief: 0.55,
    seed: 'desert-edge',
  });
  assert.equal(result.currentGroup, 'open');
  assert.ok(result.weights.grass >= 0);
  assert.ok(result.clearingBias > 0);
  assert.equal(result.ecotone.wetEdge, false);
}

function testDeterminismAndOrder() {
  const options = {
    biome: 'forest',
    adjacentBiomes: ['grassland', 'forest', 'shrubland'],
    moisture: 0.58,
    elevation01: 0.4,
    snowWeight: 0.06,
    slopeDegrees: 11,
    waterDistance: 96,
    relief: 0.61,
    seed: 'same',
  };
  const first = createBiomeEcotoneTransitionV64(options);
  const second = createBiomeEcotoneTransitionV64(options);
  const reversed = createBiomeEcotoneTransitionV64({ ...options, adjacentBiomes: [...options.adjacentBiomes].reverse() });
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(compareBiomeEcotoneTransitionsV64(first, second).deterministic, true);
  assert.equal(compareBiomeEcotoneTransitionsV64(first, reversed).sameBiome, true);
  assert.ok(compareBiomeEcotoneTransitionsV64(first, reversed).sameNeighbourGroup);
}

function testMalformedFiniteFallback() {
  const result = createBiomeEcotoneTransitionV64({
    biome: null,
    adjacentBiomes: ['unknown'],
    moisture: Number.NaN,
    elevation01: Number.POSITIVE_INFINITY,
    snowWeight: Number.NaN,
    slopeDegrees: Number.NaN,
    waterDistance: Number.NaN,
    relief: Number.NaN,
  });
  assert.equal(result.currentGroup, 'unknown');
  assert.equal(validateBiomeEcotoneTransitionV64(result).valid, true);
  const total = Object.values(result.weights).reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(total - 1) < 0.02);
}

const tests = [
  testForestEdge,
  testAlpineRockSnowEdge,
  testWetlandWaterEdge,
  testDesertTransition,
  testDeterminismAndOrder,
  testMalformedFiniteFallback,
];
for (const test of tests) test();
console.log(JSON.stringify({ ok: true, tests: tests.length }, null, 2));
