#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  G10_RELIEF_POLICY,
  buildG10ReliefProbe,
  sampleG10ReliefHeight,
  sampleG10ReliefNormal,
} from '../godot/terrain-authoring/geocells/nw/g10_relief.mjs';
import { measureG10Hydrology } from '../godot/terrain-authoring/geocells/nw/g10_hydrology.mjs';
import { measureG10Biome } from '../godot/terrain-authoring/geocells/nw/g10_biome.mjs';

const EXPECTED_MAP_SHA = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';
const OUT_ARG = process.argv.find((arg) => arg.startsWith('--emit-probe='));
const DENSE_ARG = process.argv.find((arg) => arg.startsWith('--emit-dense='));

function need(condition, message) {
  if (!condition) throw new Error(`[checkNWG10Relief] ${message}`);
}

function digest(value) {
  let checksum = 2166136261;
  const quantized = Math.round((value + 512) * 100000);
  for (let shift = 0; shift < 32; shift += 8) {
    checksum ^= (quantized >>> shift) & 0xff;
    checksum = Math.imul(checksum, 16777619) >>> 0;
  }
  return checksum >>> 0;
}

function mixChecksum(checksum, value) {
  let next = checksum ^ digest(value);
  next = Math.imul(next, 16777619) >>> 0;
  return next;
}

const hydrology = measureG10Hydrology();
need(hydrology.waterCells === 60, `water fingerprint drifted: ${hydrology.waterCells}`);
need(hydrology.landCells === 36, `land fingerprint drifted: ${hydrology.landCells}`);
need(hydrology.boundaryEdges === 30, `hydrology boundary drifted: ${hydrology.boundaryEdges}`);
need(hydrology.centreMismatches === 0, 'canonical hydrology centres must remain exact');

const biome = measureG10Biome();
need(biome.colorChecksum === 3353551246, `merged Macro Biome checksum drifted: ${biome.colorChecksum}`);
need(biome.fractionalWaterSamples === 1251, `merged Macro Biome fractional-water count drifted: ${biome.fractionalWaterSamples}`);

const first = buildG10ReliefProbe();
const second = buildG10ReliefProbe();
need(JSON.stringify(first) === JSON.stringify(second), 'relief probe is not byte deterministic');
need(first.policyId === G10_RELIEF_POLICY.id, 'policy id mismatch');
need(first.sourceMapSha256 === EXPECTED_MAP_SHA, 'map.png provenance mismatch');
need(first.canonicalWaterCells === 60 && first.canonicalLandCells === 36, 'canonical ownership changed');
need(first.canonicalSignMismatches === 0, `land/water height sign mismatches: ${first.canonicalSignMismatches}`);
need(first.heightSpan > 2, `relief span unexpectedly flat: ${first.heightSpan}`);
need(first.maxSlopeDegrees < 75, `relief contains pathological slope: ${first.maxSlopeDegrees}`);
need(first.maxAdjacentHeightStep < 20, `source-grid height step too large: ${first.maxAdjacentHeightStep}`);
need(first.maxGuardHeightDelta < 12, `guard-band height discontinuity: ${first.maxGuardHeightDelta}`);
need(first.maxGuardNormalDelta < 0.75, `guard-band normal discontinuity: ${first.maxGuardNormalDelta}`);

const bounds = G10_RELIEF_POLICY.bounds;
const denseSize = G10_RELIEF_POLICY.denseGridSize;
const heights = new Float64Array(denseSize * denseSize);
const slopes = new Float64Array(denseSize * denseSize);
const normals = new Array(denseSize * denseSize);
let denseChecksum = 2166136261;
let denseMin = Infinity;
let denseMax = -Infinity;
let maxDenseNeighborHeightDelta = 0;
let maxDenseNeighborNormalDelta = 0;
let maxDenseNeighborSlopeDelta = 0;
let maxSecondDifference = 0;

for (let y = 0; y < denseSize; y += 1) {
  const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * y / (denseSize - 1);
  for (let x = 0; x < denseSize; x += 1) {
    const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * x / (denseSize - 1);
    const index = y * denseSize + x;
    const height = sampleG10ReliefHeight(nx, ny);
    const normal = sampleG10ReliefNormal(nx, ny);
    need(Number.isFinite(height), `non-finite dense height at ${x},${y}`);
    need(Number.isFinite(normal.x) && Number.isFinite(normal.y) && Number.isFinite(normal.z), `non-finite normal at ${x},${y}`);
    need(normal.y > 0, `downward G10 normal at ${x},${y}`);
    heights[index] = height;
    slopes[index] = normal.slopeDegrees;
    normals[index] = normal;
    denseMin = Math.min(denseMin, height);
    denseMax = Math.max(denseMax, height);
    for (const value of [height, normal.x, normal.y, normal.z, normal.slopeDegrees]) denseChecksum = mixChecksum(denseChecksum, value);
  }
}

function normalDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

for (let y = 0; y < denseSize; y += 1) {
  for (let x = 0; x < denseSize; x += 1) {
    const index = y * denseSize + x;
    if (x + 1 < denseSize) {
      const right = index + 1;
      maxDenseNeighborHeightDelta = Math.max(maxDenseNeighborHeightDelta, Math.abs(heights[right] - heights[index]));
      maxDenseNeighborNormalDelta = Math.max(maxDenseNeighborNormalDelta, normalDistance(normals[right], normals[index]));
      maxDenseNeighborSlopeDelta = Math.max(maxDenseNeighborSlopeDelta, Math.abs(slopes[right] - slopes[index]));
    }
    if (y + 1 < denseSize) {
      const down = index + denseSize;
      maxDenseNeighborHeightDelta = Math.max(maxDenseNeighborHeightDelta, Math.abs(heights[down] - heights[index]));
      maxDenseNeighborNormalDelta = Math.max(maxDenseNeighborNormalDelta, normalDistance(normals[down], normals[index]));
      maxDenseNeighborSlopeDelta = Math.max(maxDenseNeighborSlopeDelta, Math.abs(slopes[down] - slopes[index]));
    }
    if (x > 0 && x + 1 < denseSize) {
      maxSecondDifference = Math.max(maxSecondDifference, Math.abs(heights[index - 1] - 2 * heights[index] + heights[index + 1]));
    }
    if (y > 0 && y + 1 < denseSize) {
      maxSecondDifference = Math.max(maxSecondDifference, Math.abs(heights[index - denseSize] - 2 * heights[index] + heights[index + denseSize]));
    }
  }
}

need(denseMin < 0, `G10 lost below-sea relief: ${denseMin}`);
need(denseMax > 0, `G10 lost land relief: ${denseMax}`);
need(maxDenseNeighborHeightDelta < 8, `dense height transition too sharp: ${maxDenseNeighborHeightDelta}`);
need(maxDenseNeighborNormalDelta < 0.55, `dense normal transition too sharp: ${maxDenseNeighborNormalDelta}`);
need(maxDenseNeighborSlopeDelta < 30, `dense slope transition too sharp: ${maxDenseNeighborSlopeDelta}`);
need(maxSecondDifference < 8, `dense curvature spike too large: ${maxSecondDifference}`);

// Explicitly detect a source-grid imprint. The 65x65 authoring nodes land every four
// samples on this 257x257 audit. Compare derivative energy on those internal lines
// against the same derivative statistic away from the source grid. A grid should
// never become a visual ridge/crease merely because it is an addressing boundary.
let gridNormalEnergy = 0;
let gridNormalPairs = 0;
let freeNormalEnergy = 0;
let freeNormalPairs = 0;
let maxGridHeightCrossingDelta = 0;
let maxGridNormalCrossingDelta = 0;
for (let y = 1; y + 1 < denseSize; y += 1) {
  for (let x = 1; x + 1 < denseSize; x += 1) {
    const index = y * denseSize + x;
    const horizontal = normalDistance(normals[index - 1], normals[index + 1]);
    const vertical = normalDistance(normals[index - denseSize], normals[index + denseSize]);
    const onGrid = (x % 4 === 0) || (y % 4 === 0);
    if (onGrid) {
      gridNormalEnergy += horizontal + vertical;
      gridNormalPairs += 2;
      maxGridHeightCrossingDelta = Math.max(
        maxGridHeightCrossingDelta,
        Math.abs(heights[index - 1] - heights[index + 1]),
        Math.abs(heights[index - denseSize] - heights[index + denseSize]),
      );
      maxGridNormalCrossingDelta = Math.max(maxGridNormalCrossingDelta, horizontal, vertical);
    } else {
      freeNormalEnergy += horizontal + vertical;
      freeNormalPairs += 2;
    }
  }
}
const meanGridNormalEnergy = gridNormalEnergy / Math.max(1, gridNormalPairs);
const meanFreeNormalEnergy = freeNormalEnergy / Math.max(1, freeNormalPairs);
const gridImprintRatio = meanGridNormalEnergy / Math.max(1e-9, meanFreeNormalEnergy);
need(gridImprintRatio < 3.0, `source-grid normal imprint detected: ratio=${gridImprintRatio}`);
need(maxGridNormalCrossingDelta < 0.8, `source-grid normal crossing discontinuity: ${maxGridNormalCrossingDelta}`);

const denseMetrics = Object.freeze({
  schema: 'westeros-g10-relief-dense-v2',
  policyId: first.policyId,
  sourceMapSha256: first.sourceMapSha256,
  denseSamples: denseSize * denseSize,
  denseGridSize: denseSize,
  denseMinHeight: Number(denseMin.toFixed(7)),
  denseMaxHeight: Number(denseMax.toFixed(7)),
  maxDenseNeighborHeightDelta: Number(maxDenseNeighborHeightDelta.toFixed(7)),
  maxDenseNeighborNormalDelta: Number(maxDenseNeighborNormalDelta.toFixed(7)),
  maxDenseNeighborSlopeDelta: Number(maxDenseNeighborSlopeDelta.toFixed(7)),
  maxSecondDifference: Number(maxSecondDifference.toFixed(7)),
  maxGridHeightCrossingDelta: Number(maxGridHeightCrossingDelta.toFixed(7)),
  maxGridNormalCrossingDelta: Number(maxGridNormalCrossingDelta.toFixed(7)),
  meanGridNormalEnergy: Number(meanGridNormalEnergy.toFixed(9)),
  meanFreeNormalEnergy: Number(meanFreeNormalEnergy.toFixed(9)),
  gridImprintRatio: Number(gridImprintRatio.toFixed(7)),
  denseChecksum,
});

if (OUT_ARG) {
  const output = path.resolve(OUT_ARG.slice('--emit-probe='.length));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(first, null, 2)}\n`);
}
if (DENSE_ARG) {
  const output = path.resolve(DENSE_ARG.slice('--emit-dense='.length));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(denseMetrics, null, 2)}\n`);
}

console.log(`NW_G10_RELIEF_METRICS=${JSON.stringify({
  minHeight: first.minHeight,
  maxHeight: first.maxHeight,
  maxSlopeDegrees: first.maxSlopeDegrees,
  maxGuardHeightDelta: first.maxGuardHeightDelta,
  maxGuardNormalDelta: first.maxGuardNormalDelta,
  denseSamples: denseMetrics.denseSamples,
  gridImprintRatio: denseMetrics.gridImprintRatio,
  denseChecksum: denseMetrics.denseChecksum,
})}`);
console.log('NW_G10_RELIEF_OK');
