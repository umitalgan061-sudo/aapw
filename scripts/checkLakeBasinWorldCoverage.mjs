#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY,
  sampleReferenceLakeDistanceNormalized,
  sampleReferenceLakeBasinScale,
} from '../src/3d/world/worldReferenceMountainRelief.js';
import { WORLD_REFERENCE_BASE_SURFACE_MASK } from '../src/3d/world/worldReferenceSurfacePindexes.js';
import { terrainLakeBasinDryScale } from '../src/3d/world/terrain.js';
import {
  collectLakeCenters,
  nearestCenter,
  countConnectedComponents,
  summarize,
  round,
  mean,
  writeJsonArtifact,
} from './lib/lakeBasinQa.mjs';

const mask = WORLD_REFERENCE_BASE_SURFACE_MASK;
const centers = collectLakeCenters(mask);
const aspect = mask.sourcePixelWidth / mask.sourcePixelHeight;
const policy = WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.lakeBasinTaper;
const width = 321;
const height = 241;
const active = new Uint8Array(width * height);
const strong = new Uint8Array(width * height);
const scaleValues = [];
const affectedDistances = [];
const strongDistances = [];
const affectedPerLake = new Array(centers.length).fill(0);
const strongPerLake = new Array(centers.length).fill(0);
const quadrantAffected = [0, 0, 0, 0];
const quadrantTotal = [0, 0, 0, 0];
const edgeScales = [];
let activeCount = 0;
let strongCount = 0;
let exactOneCount = 0;
let outsideSupportLeakCount = 0;

for (let gy = 0; gy < height; gy += 1) {
  const ny = gy / (height - 1);
  for (let gx = 0; gx < width; gx += 1) {
    const nx = gx / (width - 1);
    const index = gy * width + gx;
    const distance = sampleReferenceLakeDistanceNormalized(nx, ny);
    const mountainScale = sampleReferenceLakeBasinScale(nx, ny);
    const dryScale = terrainLakeBasinDryScale(nx, ny);
    assert(Number.isFinite(distance) && distance >= 0);
    assert(mountainScale >= 0 && mountainScale <= 1);
    assert(dryScale >= 0 && dryScale <= 1);
    scaleValues.push(dryScale);
    const quadrant = (ny >= 0.5 ? 2 : 0) + (nx >= 0.5 ? 1 : 0);
    quadrantTotal[quadrant] += 1;

    const nearest = nearestCenter({ nx, ny }, centers, aspect);
    const isActive = dryScale < 0.999999;
    const isStrong = dryScale < 0.50;
    if (isActive) {
      active[index] = 1;
      activeCount += 1;
      quadrantAffected[quadrant] += 1;
      affectedDistances.push(distance);
      const lakeIndex = centers.indexOf(nearest.center);
      if (lakeIndex >= 0) affectedPerLake[lakeIndex] += 1;
    } else {
      exactOneCount += Number(dryScale === 1);
    }
    if (isStrong) {
      strong[index] = 1;
      strongCount += 1;
      strongDistances.push(distance);
      const lakeIndex = centers.indexOf(nearest.center);
      if (lakeIndex >= 0) strongPerLake[lakeIndex] += 1;
    }

    const halfCellAllowance = 0.5 * Math.hypot(aspect / mask.width, 1 / mask.height);
    if (distance > policy.outerRadiusNormalized + halfCellAllowance + 0.004 && isActive) {
      outsideSupportLeakCount += 1;
    }

    if (gx === 0 || gy === 0 || gx === width - 1 || gy === height - 1) edgeScales.push(dryScale);
  }
}

const total = width * height;
const affectedFraction = activeCount / total;
const strongFraction = strongCount / total;
assert(activeCount > 100, `lake basin support unexpectedly vanished: ${activeCount}`);
assert(affectedFraction < 0.06, `lake conformer ceased to be local: ${affectedFraction}`);
assert(strongCount > 20, `strong lake-basin core unexpectedly vanished: ${strongCount}`);
assert(strongFraction < 0.025, `strong lake-basin core expanded too far: ${strongFraction}`);
assert(outsideSupportLeakCount === 0,
  `lake conformer leaked beyond outer support envelope at ${outsideSupportLeakCount} samples`);
assert(edgeScales.every((value) => value === 1), 'owner-map outer edge must remain exactly unaffected');
assert(exactOneCount > total * 0.90, `too little of the world remains exactly untouched: ${exactOneCount}/${total}`);

for (let index = 0; index < centers.length; index += 1) {
  assert(affectedPerLake[index] > 0, `canonical lake ${index} has no affected dry-terrain footprint`);
  assert(strongPerLake[index] > 0, `canonical lake ${index} has no strong conforming core`);
}

const components = countConnectedComponents(width, height, active);
const strongComponents = countConnectedComponents(width, height, strong);
assert(components.length >= 1 && components.length <= centers.length,
  `affected support topology is inconsistent with ${centers.length} canonical lakes: ${components.length} components`);
assert(strongComponents.length >= 1 && strongComponents.length <= centers.length,
  `strong support topology is inconsistent with ${centers.length} canonical lakes: ${strongComponents.length} components`);

for (const [componentIndex, component] of components.entries()) {
  assert(component.size >= 4,
    `affected component ${componentIndex} is a suspicious isolated island of ${component.size} cells`);
}

const rowCoverage = [];
for (let gy = 0; gy < height; gy += 1) {
  let rowActive = 0;
  for (let gx = 0; gx < width; gx += 1) rowActive += active[gy * width + gx];
  rowCoverage.push(rowActive / width);
}
const columnCoverage = [];
for (let gx = 0; gx < width; gx += 1) {
  let columnActive = 0;
  for (let gy = 0; gy < height; gy += 1) columnActive += active[gy * width + gx];
  columnCoverage.push(columnActive / height);
}
assert(Math.max(...rowCoverage) < 0.20, 'lake support occupies an implausibly broad full-world row');
assert(Math.max(...columnCoverage) < 0.20, 'lake support occupies an implausibly broad full-world column');

const quadrantFractions = quadrantAffected.map((count, index) => count / quadrantTotal[index]);
assert(quadrantFractions.every((fraction) => fraction < 0.12),
  `lake support became region-scale in a quadrant: ${quadrantFractions.join(', ')}`);

const perLakeMetrics = centers.map((center, index) => ({
  lakeIndex: index,
  cellX: center.cellX,
  cellY: center.cellY,
  nx: round(center.nx, 6),
  ny: round(center.ny, 6),
  affectedSamples: affectedPerLake[index],
  strongSamples: strongPerLake[index],
  affectedShare: round(affectedPerLake[index] / Math.max(1, activeCount), 5),
  strongShare: round(strongPerLake[index] / Math.max(1, strongCount), 5),
}));

const dominantShare = Math.max(...perLakeMetrics.map((entry) => entry.affectedShare));
assert(dominantShare < 0.70, `one lake dominates the conformer footprint: ${dominantShare}`);

const componentMetrics = components.map((component, index) => ({
  index,
  ...component,
  fractionOfAffected: round(component.size / activeCount, 5),
}));
const strongComponentMetrics = strongComponents.map((component, index) => ({
  index,
  ...component,
  fractionOfStrong: round(component.size / strongCount, 5),
}));

const report = Object.freeze({
  policyId: WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.id,
  grid: { width, height, total },
  support: {
    activeCount,
    affectedFraction: round(affectedFraction, 6),
    strongCount,
    strongFraction: round(strongFraction, 6),
    exactOneCount,
    exactOneFraction: round(exactOneCount / total, 6),
    outsideSupportLeakCount,
    componentCount: components.length,
    strongComponentCount: strongComponents.length,
    dominantLakeAffectedShare: round(dominantShare, 5),
  },
  distributions: {
    dryScale: summarize(scaleValues, 6),
    affectedDistance: summarize(affectedDistances, 6),
    strongDistance: summarize(strongDistances, 6),
    rowCoverage: summarize(rowCoverage, 6),
    columnCoverage: summarize(columnCoverage, 6),
  },
  quadrantFractions: quadrantFractions.map((value) => round(value, 6)),
  meanQuadrantFraction: round(mean(quadrantFractions), 6),
  lakes: perLakeMetrics,
  components: componentMetrics,
  strongComponents: strongComponentMetrics,
});

writeJsonArtifact('artifacts/lake-basin-exact-head/world-coverage.json', report);
console.log('[checkLakeBasinWorldCoverage] PASS');
console.log(JSON.stringify(report, null, 2));
