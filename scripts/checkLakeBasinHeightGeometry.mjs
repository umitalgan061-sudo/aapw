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
  TAU,
  collectLakeCenters,
  normalizedOffset,
  normalizedToWorld,
  sampleGradient,
  sampleRadialProfile,
  profileGrades,
  summarize,
  round,
  mean,
  quantile,
  assertFinite,
  writeJsonArtifact,
} from './lib/lakeBasinQa.mjs';

const mask = WORLD_REFERENCE_BASE_SURFACE_MASK;
const centers = collectLakeCenters(mask);
const aspect = mask.sourcePixelWidth / mask.sourcePixelHeight;
const basinPolicy = WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.lakeBasinTaper;
const sampleHeight = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
const seaLevel = WORLD_DEFAULTS.WATER_LEVEL_METERS;

assert.equal(centers.length, 6);
assert(basinPolicy.outerRadiusNormalized > basinPolicy.innerRadiusNormalized);

function sampleTerrainAtNormalized(nx, ny) {
  const world = normalizedToWorld(nx, ny, WORLD_SCALE);
  const surface = { rockWeight: 0, snowWeight: 0, waterWeight: 0 };
  const height = sampleHeight(world.x, world.z, undefined, surface);
  assertFinite(height, `height ${nx}/${ny}`);
  assertFinite(surface.rockWeight, `rockWeight ${nx}/${ny}`);
  assertFinite(surface.snowWeight, `snowWeight ${nx}/${ny}`);
  assertFinite(surface.waterWeight, `waterWeight ${nx}/${ny}`);
  assert(surface.waterWeight >= -1e-9 && surface.waterWeight <= 1 + 1e-9,
    `waterWeight out of range at ${nx}/${ny}: ${surface.waterWeight}`);
  return Object.freeze({ ...world, nx, ny, height, ...surface });
}

function ringSamples(center, radius, count = 96) {
  const values = [];
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * TAU;
    const point = normalizedOffset(center.nx, center.ny, radius, angle, aspect);
    if (point.nx < 0 || point.nx > 1 || point.ny < 0 || point.ny > 1) continue;
    const terrain = sampleTerrainAtNormalized(point.nx, point.ny);
    const gradient = sampleGradient(sampleHeight, terrain.x, terrain.z, 25);
    values.push(Object.freeze({
      angle,
      radius,
      ...terrain,
      gradientDegrees: gradient.degrees,
      basinScale: sampleReferenceLakeBasinScale(point.nx, point.ny),
      dryScale: terrainLakeBasinDryScale(point.nx, point.ny),
      lakeDistance: sampleReferenceLakeDistanceNormalized(point.nx, point.ny),
    }));
  }
  return Object.freeze(values);
}

const radii = Object.freeze([
  0,
  basinPolicy.innerRadiusNormalized * 0.50,
  basinPolicy.innerRadiusNormalized,
  0.022,
  0.030,
  0.040,
  basinPolicy.outerRadiusNormalized,
  basinPolicy.outerRadiusNormalized + 0.012,
]);
const radialProfileRadii = Object.freeze(Array.from({ length: 29 }, (_, index) =>
  (basinPolicy.outerRadiusNormalized + 0.015) * index / 28));

const lakeReports = [];
const allGrades = [];
const allInnerGrades = [];
const allOuterGrades = [];
const allHeights = [];
const allWaterWeights = [];
const allDeterminismDeltas = [];
let totalOpenDirections = 0;
let totalDirectionCount = 0;
let totalWaterCoreSamples = 0;
let totalStrongBasinSamples = 0;

for (const [lakeIndex, center] of centers.entries()) {
  const centerTerrain = sampleTerrainAtNormalized(center.nx, center.ny);
  const centerHeightAgain = sampleTerrainAtNormalized(center.nx, center.ny).height;
  assert.equal(centerTerrain.height, centerHeightAgain,
    `lake ${lakeIndex} center height sampler must be bit-for-bit deterministic`);

  const rings = radii.map((radius) => ringSamples(center, radius));
  const ringSummaries = rings.map((samples, radiusIndex) => {
    const heights = samples.map((sample) => sample.height);
    const grades = samples.map((sample) => sample.gradientDegrees);
    const waters = samples.map((sample) => sample.waterWeight);
    const scales = samples.map((sample) => sample.dryScale);
    for (const sample of samples) {
      allGrades.push(sample.gradientDegrees);
      allHeights.push(sample.height);
      allWaterWeights.push(sample.waterWeight);
      if (sample.dryScale < 0.50) totalStrongBasinSamples += 1;
      if (sample.waterWeight > 0.50) totalWaterCoreSamples += 1;
    }
    if (radiusIndex <= 3) allInnerGrades.push(...grades);
    if (radiusIndex >= radii.length - 2) allOuterGrades.push(...grades);
    return Object.freeze({
      radius: radii[radiusIndex],
      sampleCount: samples.length,
      height: summarize(heights, 3),
      gradeDegrees: summarize(grades, 3),
      waterWeight: summarize(waters, 4),
      dryScale: summarize(scales, 4),
      highGradeFraction55: samples.length
        ? round(grades.filter((value) => value >= 55).length / samples.length, 4)
        : 0,
      walkableFraction35: samples.length
        ? round(grades.filter((value) => value <= 35).length / samples.length, 4)
        : 0,
    });
  });

  const directionReports = [];
  for (let directionIndex = 0; directionIndex < 48; directionIndex += 1) {
    const angle = (directionIndex / 48) * TAU;
    const profile = sampleRadialProfile({
      center,
      radii: radialProfileRadii,
      angle,
      aspect,
      worldScale: WORLD_SCALE,
      sampleHeight,
      sampleScale: terrainLakeBasinDryScale,
    });
    const grades = profileGrades(profile);
    const maxGrade = grades.length ? Math.max(...grades) : 90;
    const p90Grade = grades.length ? quantile(grades, 0.90) : 90;
    const meanGrade = mean(grades);
    const outerHeight = profile.at(-1)?.height ?? centerTerrain.height;
    const innerHeight = profile[0]?.height ?? centerTerrain.height;
    const totalRise = outerHeight - innerHeight;
    const open = maxGrade <= 55 || (p90Grade <= 42 && meanGrade <= 30);
    if (open) totalOpenDirections += 1;
    totalDirectionCount += 1;
    directionReports.push(Object.freeze({
      directionIndex,
      angle: round(angle, 5),
      sampleCount: profile.length,
      maxGrade: round(maxGrade, 3),
      p90Grade: round(p90Grade, 3),
      meanGrade: round(meanGrade, 3),
      totalRise: round(totalRise, 3),
      open,
    }));
  }

  const openDirections = directionReports.filter((entry) => entry.open).length;
  const highGradeRingFractions = ringSummaries
    .filter((entry) => entry.radius >= basinPolicy.innerRadiusNormalized && entry.radius <= 0.040)
    .map((entry) => entry.highGradeFraction55);
  const worstClosedRing = highGradeRingFractions.length ? Math.max(...highGradeRingFractions) : 1;

  assert(worstClosedRing < 0.985,
    `lake ${lakeIndex} still forms an almost fully closed >55° crater ring: ${worstClosedRing}`);
  assert(openDirections >= 2,
    `lake ${lakeIndex} has no practical low-gradient opening through its cirque (${openDirections}/48)`);

  const farRing = ringSummaries.at(-1);
  assert(farRing.dryScale.p50 > 0.95,
    `lake ${lakeIndex} dry conformer does not recover outside the audited basin: ${farRing.dryScale.p50}`);

  for (const radius of [0, 0.01, 0.02, 0.04, 0.062]) {
    for (const angle of [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5]) {
      const point = normalizedOffset(center.nx, center.ny, radius, angle, aspect);
      if (point.nx < 0 || point.nx > 1 || point.ny < 0 || point.ny > 1) continue;
      const a = sampleTerrainAtNormalized(point.nx, point.ny).height;
      const b = sampleTerrainAtNormalized(point.nx, point.ny).height;
      const delta = Math.abs(a - b);
      allDeterminismDeltas.push(delta);
      assert.equal(a, b, `height nondeterminism at lake ${lakeIndex} radius=${radius} angle=${angle}`);
    }
  }

  lakeReports.push(Object.freeze({
    lakeIndex,
    center: {
      cellX: center.cellX,
      cellY: center.cellY,
      nx: round(center.nx, 6),
      ny: round(center.ny, 6),
      height: round(centerTerrain.height, 3),
      waterWeight: round(centerTerrain.waterWeight, 4),
      mountainScale: round(sampleReferenceLakeBasinScale(center.nx, center.ny), 5),
      dryScale: round(terrainLakeBasinDryScale(center.nx, center.ny), 5),
    },
    openDirections,
    directionCount: directionReports.length,
    openDirectionFraction: round(openDirections / directionReports.length, 4),
    worstClosedRingFraction55: round(worstClosedRing, 4),
    rings: ringSummaries,
    directions: directionReports,
  }));
}

assert(totalWaterCoreSamples > 0, 'dense lake-basin sampling never observed canonical water ownership');
assert(totalStrongBasinSamples > 0, 'dense lake-basin sampling never observed strong dry conforming');
assert(totalOpenDirections >= centers.length * 2,
  `aggregate cirque opening count regressed: ${totalOpenDirections}/${totalDirectionCount}`);
assert(allDeterminismDeltas.every((value) => value === 0), 'height field lost deterministic repeatability');

const epsilonNormalized = 1e-7;
const epsilonDeltas = [];
for (const [lakeIndex, center] of centers.entries()) {
  for (let ring = 0; ring <= 8; ring += 1) {
    const radius = (basinPolicy.outerRadiusNormalized + 0.010) * ring / 8;
    for (let direction = 0; direction < 32; direction += 1) {
      const angle = direction / 32 * TAU;
      const point = normalizedOffset(center.nx, center.ny, radius, angle, aspect);
      if (point.nx <= epsilonNormalized || point.nx >= 1 - epsilonNormalized
        || point.ny <= epsilonNormalized || point.ny >= 1 - epsilonNormalized) continue;
      const base = sampleTerrainAtNormalized(point.nx, point.ny).height;
      const east = sampleTerrainAtNormalized(point.nx + epsilonNormalized, point.ny).height;
      const south = sampleTerrainAtNormalized(point.nx, point.ny + epsilonNormalized).height;
      const eastDelta = Math.abs(east - base);
      const southDelta = Math.abs(south - base);
      epsilonDeltas.push(eastDelta, southDelta);
      assert(eastDelta < 0.5,
        `lake ${lakeIndex} has a discontinuous east epsilon jump ${eastDelta}m at ${point.nx}/${point.ny}`);
      assert(southDelta < 0.5,
        `lake ${lakeIndex} has a discontinuous south epsilon jump ${southDelta}m at ${point.nx}/${point.ny}`);
    }
  }
}

const report = Object.freeze({
  policyId: WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.id,
  seaLevelMeters: seaLevel,
  lakeCount: centers.length,
  aggregate: {
    gradeDegrees: summarize(allGrades, 3),
    innerGradeDegrees: summarize(allInnerGrades, 3),
    outerGradeDegrees: summarize(allOuterGrades, 3),
    heightMeters: summarize(allHeights, 3),
    waterWeight: summarize(allWaterWeights, 4),
    epsilonHeightDeltaMeters: summarize(epsilonDeltas, 8),
    openDirections: totalOpenDirections,
    directionCount: totalDirectionCount,
    openDirectionFraction: round(totalOpenDirections / totalDirectionCount, 4),
    totalWaterCoreSamples,
    totalStrongBasinSamples,
  },
  lakes: lakeReports,
});

writeJsonArtifact('artifacts/lake-basin-exact-head/height-geometry.json', report);
console.log('[checkLakeBasinHeightGeometry] PASS');
console.log(JSON.stringify(report, null, 2));
