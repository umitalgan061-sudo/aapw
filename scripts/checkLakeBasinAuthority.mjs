#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY,
  WORLD_REFERENCE_LAKE_CELL_COUNT,
  sampleReferenceLakeBasinScale,
  sampleReferenceLakeDistanceNormalized,
} from '../src/3d/world/worldReferenceMountainRelief.js';
import { WORLD_REFERENCE_BASE_SURFACE_MASK } from '../src/3d/world/worldReferenceSurfacePindexes.js';
import {
  TERRAIN_LAKE_BASIN_CONFORM_POLICY,
  terrainLakeBasinDryScale,
} from '../src/3d/world/terrain.js';
import {
  QA_ROOT,
  collectLakeCenters,
  assertApprox,
  assertUnit,
  summarize,
  round,
  normalizedOffset,
  TAU,
  mean,
  writeJsonArtifact,
} from './lib/lakeBasinQa.mjs';

const mountainPolicy = WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY;
const basinPolicy = mountainPolicy.lakeBasinTaper;
const terrainPolicy = TERRAIN_LAKE_BASIN_CONFORM_POLICY;
const mask = WORLD_REFERENCE_BASE_SURFACE_MASK;
const lakeCenters = collectLakeCenters(mask);
const aspect = mask.sourcePixelWidth / mask.sourcePixelHeight;

assert.equal(mountainPolicy.id, 'owner-map-live-mountain-relief-2026-08-26-v7-lake-basin-cirques');
assert.equal(terrainPolicy.id, 'terrain-lake-basin-dry-enhancement-conform-2026-08-26-v1');
assert.equal(terrainPolicy.lakeAuthorityPolicyId, mountainPolicy.id,
  'terrain basin conformer must consume the canonical mountain lake authority');
assert.equal(terrainPolicy.canonicalWaterHeightPreserved, true);
assert.equal(terrainPolicy.canonicalLakeMaskPreserved, true);
assert.equal(terrainPolicy.dryEnhancementExponent, 2,
  'dry enhancement exponent changed without updating the audited basin contract');
assert.equal(WORLD_REFERENCE_LAKE_CELL_COUNT, 6, 'production lake-cell count drifted');
assert.equal(lakeCenters.length, WORLD_REFERENCE_LAKE_CELL_COUNT, 'decoded QA lake-cell count drifted');
assert.equal(mountainPolicy.surfaceMaskSha256, mask.maskSha256, 'mountain relief mask authority drifted');

assert(basinPolicy.innerRadiusNormalized > 0);
assert(basinPolicy.outerRadiusNormalized > basinPolicy.innerRadiusNormalized);
assert(basinPolicy.outerRadiusNormalized <= 0.060,
  'lake basin support expanded beyond the audited local-cirque envelope');
assert(basinPolicy.minimumScale > 0 && basinPolicy.minimumScale < 0.30);

const terrainSource = readFileSync(resolve(QA_ROOT, 'src/3d/world/terrain.js'), 'utf8');
const mountainSource = readFileSync(resolve(QA_ROOT, 'src/3d/world/worldReferenceMountainRelief.js'), 'utf8');

for (const snippet of [
  'sampleReferenceLakeBasinScale',
  'TERRAIN_LAKE_BASIN_CONFORM_POLICY',
  'nonMountainDryEnhancement * lakeDryEnhancementScale',
  'detailTaper * lakeDryEnhancementScale',
  'const wetRelative = -3.0 - waterWeight * 5.25',
]) {
  assert(terrainSource.includes(snippet), `terrain production wiring lost required lake-basin snippet: ${snippet}`);
}
assert(!terrainSource.includes('wetRelative * lakeDryEnhancementScale'),
  'wet terrain must never be multiplied by the dry lake-basin conformer');
assert(!terrainSource.includes('waterWeight * lakeDryEnhancementScale'),
  'canonical water ownership must never be scaled by the dry lake-basin conformer');
assert(mountainSource.includes('const LAKE_DISTANCE_FIELD = buildLakeDistanceField();'),
  'lake-distance authority must remain precomputed from the immutable surface mask');
assert(mountainSource.includes('sampleReferenceLakeBasinScale(normalizedX, normalizedY)'),
  'mountain production relief no longer consumes lake-basin scale');

const centerMetrics = [];
for (const [index, center] of lakeCenters.entries()) {
  const distance = sampleReferenceLakeDistanceNormalized(center.nx, center.ny);
  const mountainScale = sampleReferenceLakeBasinScale(center.nx, center.ny);
  const dryScale = terrainLakeBasinDryScale(center.nx, center.ny);
  assert(distance <= 0.016, `lake ${index} center is unexpectedly far from its own distance field: ${distance}`);
  assertApprox(mountainScale, basinPolicy.minimumScale, 0.025, `lake ${index} mountain center scale`);
  assertApprox(dryScale, mountainScale ** terrainPolicy.dryEnhancementExponent, 1e-12,
    `lake ${index} dry scale composition`);
  centerMetrics.push({
    index,
    cellX: center.cellX,
    cellY: center.cellY,
    nx: round(center.nx, 6),
    ny: round(center.ny, 6),
    distance: round(distance, 6),
    mountainScale: round(mountainScale, 6),
    dryScale: round(dryScale, 6),
  });
}

const gridWidth = 257;
const gridHeight = 193;
const distances = [];
const mountainScales = [];
const dryScales = [];
const affected = [];
const strong = [];
const far = [];
let exactFarCount = 0;
let stronglyConformedCount = 0;
let relationErrorMax = 0;
let finiteCount = 0;

for (let gy = 0; gy < gridHeight; gy += 1) {
  const ny = gy / (gridHeight - 1);
  for (let gx = 0; gx < gridWidth; gx += 1) {
    const nx = gx / (gridWidth - 1);
    const distance = sampleReferenceLakeDistanceNormalized(nx, ny);
    const mountainScale = sampleReferenceLakeBasinScale(nx, ny);
    const dryScale = terrainLakeBasinDryScale(nx, ny);
    assert(Number.isFinite(distance) && distance >= 0, `invalid lake distance at ${nx}/${ny}`);
    assertUnit(mountainScale, `mountain scale ${nx}/${ny}`);
    assertUnit(dryScale, `dry scale ${nx}/${ny}`);
    const expectedDry = mountainScale ** terrainPolicy.dryEnhancementExponent;
    relationErrorMax = Math.max(relationErrorMax, Math.abs(dryScale - expectedDry));
    distances.push(distance);
    mountainScales.push(mountainScale);
    dryScales.push(dryScale);
    finiteCount += 1;
    if (dryScale < 0.999999) affected.push(dryScale);
    if (dryScale < 0.50) {
      strong.push(dryScale);
      stronglyConformedCount += 1;
    }
    if (distance >= basinPolicy.outerRadiusNormalized + 0.015) {
      far.push(dryScale);
      if (dryScale === 1) exactFarCount += 1;
      assert.equal(dryScale, 1, `far-field dry scale must be exactly 1 at ${nx}/${ny}`);
    }
  }
}

assert.equal(finiteCount, gridWidth * gridHeight);
assert(relationErrorMax <= 1e-12, `terrain dry scale no longer exactly composes mountain basin scale: ${relationErrorMax}`);
const affectedFraction = affected.length / dryScales.length;
const strongFraction = strong.length / dryScales.length;
assert(affectedFraction > 0.002, `lake basin conformer became inert: affectedFraction=${affectedFraction}`);
assert(affectedFraction < 0.08, `lake basin conformer affects too much of the owner map: ${affectedFraction}`);
assert(strongFraction > 0.0005, `strong basin core disappeared: ${strongFraction}`);
assert(strongFraction < 0.03, `strong basin core is no longer local: ${strongFraction}`);
assert(exactFarCount === far.length && far.length > dryScales.length * 0.80,
  'far owner-map terrain must remain exactly untouched by lake conforming');

const radialRadii = Object.freeze([
  0,
  basinPolicy.innerRadiusNormalized * 0.5,
  basinPolicy.innerRadiusNormalized,
  (basinPolicy.innerRadiusNormalized + basinPolicy.outerRadiusNormalized) * 0.5,
  basinPolicy.outerRadiusNormalized,
  basinPolicy.outerRadiusNormalized + 0.012,
]);
const radialByLake = [];

for (const [lakeIndex, center] of lakeCenters.entries()) {
  const means = radialRadii.map((radius) => {
    const values = [];
    for (let angleIndex = 0; angleIndex < 48; angleIndex += 1) {
      const angle = (angleIndex / 48) * TAU;
      const point = normalizedOffset(center.nx, center.ny, radius, angle, aspect);
      if (point.nx < 0 || point.nx > 1 || point.ny < 0 || point.ny > 1) continue;
      values.push(terrainLakeBasinDryScale(point.nx, point.ny));
    }
    return mean(values);
  });
  assert(means[0] <= means.at(-1), `lake ${lakeIndex} radial basin envelope is inverted`);
  assert(means.at(-1) > 0.95, `lake ${lakeIndex} does not recover toward untouched terrain: ${means.at(-1)}`);
  radialByLake.push({
    lakeIndex,
    radii: radialRadii,
    meanDryScale: means.map((value) => round(value, 5)),
  });
}

const invalidCases = [
  [Number.NaN, 0.5],
  [0.5, Number.POSITIVE_INFINITY],
  [-0.001, 0.5],
  [1.001, 0.5],
  [0.5, -0.001],
  [0.5, 1.001],
];
for (const [nx, ny] of invalidCases) {
  assert.throws(() => sampleReferenceLakeDistanceNormalized(nx, ny),
    `invalid normalized input ${nx}/${ny} must be rejected by lake-distance authority`);
}

const report = Object.freeze({
  policy: {
    mountainPolicyId: mountainPolicy.id,
    terrainPolicyId: terrainPolicy.id,
    maskSha256: mask.maskSha256,
    lakeCellCount: lakeCenters.length,
    innerRadiusNormalized: basinPolicy.innerRadiusNormalized,
    outerRadiusNormalized: basinPolicy.outerRadiusNormalized,
    minimumMountainScale: basinPolicy.minimumScale,
    dryEnhancementExponent: terrainPolicy.dryEnhancementExponent,
    theoreticalMinimumDryScale: round(basinPolicy.minimumScale ** terrainPolicy.dryEnhancementExponent, 6),
  },
  coverage: {
    gridWidth,
    gridHeight,
    sampleCount: dryScales.length,
    affectedCount: affected.length,
    affectedFraction: round(affectedFraction, 6),
    stronglyConformedCount,
    stronglyConformedFraction: round(strongFraction, 6),
    exactFarCount,
    relationErrorMax,
  },
  centerMetrics,
  radialByLake,
  distributions: {
    distance: summarize(distances, 6),
    mountainScale: summarize(mountainScales, 6),
    dryScale: summarize(dryScales, 6),
    affectedDryScale: summarize(affected, 6),
  },
});

writeJsonArtifact('artifacts/lake-basin-exact-head/authority.json', report);
console.log('[checkLakeBasinAuthority] PASS');
console.log(JSON.stringify(report, null, 2));
