#!/usr/bin/env node
import assert from 'node:assert/strict';
import { WORLD_DEFAULTS, WORLD_SCALE } from '../src/3d/config.js';
import { createHeightSampler, terrainLakeBasinDryScale } from '../src/3d/world/terrain.js';
import {
  WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY,
  sampleReferenceLakeBasinScale,
  sampleReferenceLakeDistanceNormalized,
} from '../src/3d/world/worldReferenceMountainRelief.js';
import { WORLD_REFERENCE_BASE_SURFACE_MASK } from '../src/3d/world/worldReferenceSurfacePindexes.js';
import {
  collectLakeCenters,
  fixedLcg,
  checksumNumbers,
  normalizedToWorld,
  normalizedOffset,
  round,
  summarize,
  timeIt,
  writeJsonArtifact,
  TAU,
} from './lib/lakeBasinQa.mjs';

const mask = WORLD_REFERENCE_BASE_SURFACE_MASK;
const centers = collectLakeCenters(mask);
const aspect = mask.sourcePixelWidth / mask.sourcePixelHeight;
const policy = WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.lakeBasinTaper;
const sampleHeight = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);

function buildCoordinateSet(count, seed) {
  const random = fixedLcg(seed);
  const points = [];
  for (let index = 0; index < count; index += 1) {
    if (index % 3 === 0) {
      const center = centers[index % centers.length];
      const angle = random() * TAU;
      const radius = random() * (policy.outerRadiusNormalized + 0.020);
      const point = normalizedOffset(center.nx, center.ny, radius, angle, aspect);
      points.push({
        nx: Math.max(0, Math.min(1, point.nx)),
        ny: Math.max(0, Math.min(1, point.ny)),
      });
    } else {
      points.push({ nx: random(), ny: random() });
    }
  }
  return Object.freeze(points);
}

const coordinates = buildCoordinateSet(12000, 0x6a09e667);

function sampleScalarPass() {
  const values = new Float64Array(coordinates.length * 3);
  let offset = 0;
  for (const point of coordinates) {
    values[offset++] = sampleReferenceLakeDistanceNormalized(point.nx, point.ny);
    values[offset++] = sampleReferenceLakeBasinScale(point.nx, point.ny);
    values[offset++] = terrainLakeBasinDryScale(point.nx, point.ny);
  }
  return values;
}

const scalarA = timeIt(sampleScalarPass);
const scalarB = timeIt(sampleScalarPass);
assert.equal(scalarA.value.length, scalarB.value.length);
for (let index = 0; index < scalarA.value.length; index += 1) {
  assert.equal(scalarA.value[index], scalarB.value[index], `scalar lake policy nondeterminism at index ${index}`);
}
const scalarChecksumA = checksumNumbers(scalarA.value);
const scalarChecksumB = checksumNumbers(scalarB.value);
assert.equal(scalarChecksumA, scalarChecksumB, 'scalar lake-policy checksum changed between identical passes');

function sampleHeightPass() {
  const values = new Float64Array(coordinates.length);
  for (let index = 0; index < coordinates.length; index += 1) {
    const point = coordinates[index];
    const world = normalizedToWorld(point.nx, point.ny, WORLD_SCALE);
    values[index] = sampleHeight(world.x, world.z);
  }
  return values;
}

const heightA = timeIt(sampleHeightPass);
const heightB = timeIt(sampleHeightPass);
for (let index = 0; index < heightA.value.length; index += 1) {
  assert.equal(heightA.value[index], heightB.value[index], `height nondeterminism at index ${index}`);
}
const heightChecksumA = checksumNumbers(heightA.value, 1000);
const heightChecksumB = checksumNumbers(heightB.value, 1000);
assert.equal(heightChecksumA, heightChecksumB, 'terrain-height checksum changed between identical passes');

assert(scalarA.elapsedMs < 4000 && scalarB.elapsedMs < 4000,
  `lake scalar policy became unexpectedly expensive: ${scalarA.elapsedMs.toFixed(1)} / ${scalarB.elapsedMs.toFixed(1)} ms`);
assert(heightA.elapsedMs < 30000 && heightB.elapsedMs < 30000,
  `12k exact terrain samples exceeded the CI safety budget: ${heightA.elapsedMs.toFixed(1)} / ${heightB.elapsedMs.toFixed(1)} ms`);

const boundaryDeltas = [];
const derivativeLike = [];
const epsilon = 1e-6;
for (const [lakeIndex, center] of centers.entries()) {
  for (const radius of [policy.innerRadiusNormalized, policy.outerRadiusNormalized]) {
    for (let direction = 0; direction < 64; direction += 1) {
      const angle = direction / 64 * TAU;
      const before = normalizedOffset(center.nx, center.ny, Math.max(0, radius - epsilon), angle, aspect);
      const after = normalizedOffset(center.nx, center.ny, radius + epsilon, angle, aspect);
      if (before.nx < 0 || before.nx > 1 || before.ny < 0 || before.ny > 1
        || after.nx < 0 || after.nx > 1 || after.ny < 0 || after.ny > 1) continue;
      const a = terrainLakeBasinDryScale(before.nx, before.ny);
      const b = terrainLakeBasinDryScale(after.nx, after.ny);
      const delta = Math.abs(b - a);
      boundaryDeltas.push(delta);
      derivativeLike.push(delta / (2 * epsilon));
      assert(delta < 0.01,
        `lake ${lakeIndex} basin scale has a step at radius ${radius}: delta=${delta}`);
    }
  }
}

const centerRepeatDeltas = [];
for (const [lakeIndex, center] of centers.entries()) {
  const world = normalizedToWorld(center.nx, center.ny, WORLD_SCALE);
  const baseline = sampleHeight(world.x, world.z);
  for (let repeat = 0; repeat < 200; repeat += 1) {
    const value = sampleHeight(world.x, world.z);
    const delta = Math.abs(value - baseline);
    centerRepeatDeltas.push(delta);
    assert.equal(value, baseline, `lake ${lakeIndex} center changed during repeat ${repeat}`);
  }
}

const orderProbe = buildCoordinateSet(2048, 0xbb67ae85);
const forward = [];
for (const point of orderProbe) {
  const world = normalizedToWorld(point.nx, point.ny, WORLD_SCALE);
  forward.push(sampleHeight(world.x, world.z));
}
const reverse = new Array(orderProbe.length);
for (let index = orderProbe.length - 1; index >= 0; index -= 1) {
  const point = orderProbe[index];
  const world = normalizedToWorld(point.nx, point.ny, WORLD_SCALE);
  reverse[index] = sampleHeight(world.x, world.z);
}
for (let index = 0; index < forward.length; index += 1) {
  assert.equal(forward[index], reverse[index], `sample order changed terrain height at probe ${index}`);
}

const report = Object.freeze({
  policyId: WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.id,
  sampleCounts: {
    scalarCoordinates: coordinates.length,
    scalarValues: scalarA.value.length,
    heightCoordinates: coordinates.length,
    orderProbeCoordinates: orderProbe.length,
    centerRepeats: centerRepeatDeltas.length,
  },
  checksums: {
    scalarA: scalarChecksumA,
    scalarB: scalarChecksumB,
    heightA: heightChecksumA,
    heightB: heightChecksumB,
  },
  timingMs: {
    scalarPassA: round(scalarA.elapsedMs, 2),
    scalarPassB: round(scalarB.elapsedMs, 2),
    heightPassA: round(heightA.elapsedMs, 2),
    heightPassB: round(heightB.elapsedMs, 2),
  },
  continuity: {
    boundaryDelta: summarize(boundaryDeltas, 8),
    derivativeLike: summarize(derivativeLike, 4),
    centerRepeatDelta: summarize(centerRepeatDeltas, 12),
  },
});

writeJsonArtifact('artifacts/lake-basin-exact-head/determinism-performance.json', report);
console.log('[checkLakeBasinDeterminismPerformance] PASS');
console.log(JSON.stringify(report, null, 2));
