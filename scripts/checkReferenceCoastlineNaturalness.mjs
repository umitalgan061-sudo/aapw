#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  WORLD_REFERENCE_BASE_SURFACE_MASK,
  classifyReferenceBaseSurface,
  sampleReferencePindexQualityV2,
} from '../src/3d/world/worldReferenceSurfacePindexes.js';
import {
  REFERENCE_COASTLINE_WARP_POLICY,
  referenceCoastlineNaturalizationOffsets,
  referenceCoastlineWarpStats,
  sampleReferenceCoastlineField,
} from '../src/3d/world/referenceCoastlineWarp.js';
import {
  TERRAIN_RELIEF_DETAIL_POLICY,
  coastWarpOffsets,
  signedFbmNoise,
} from '../src/3d/world/terrainReliefDetail.js';

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const P = REFERENCE_COASTLINE_WARP_POLICY;
const R = TERRAIN_RELIEF_DETAIL_POLICY;
const width = WORLD_REFERENCE_BASE_SURFACE_MASK.width;
const height = WORLD_REFERENCE_BASE_SURFACE_MASK.height;
const WORLD_WIDTH_METERS = 13296;
const WORLD_DEPTH_METERS = 10341;

assert.equal(P.sourceMaskSha256, WORLD_REFERENCE_BASE_SURFACE_MASK.maskSha256);
assert.equal(P.sourceMapSha256, WORLD_REFERENCE_BASE_SURFACE_MASK.sourceMapSha256);
assert.equal(P.canonicalMaskUnchanged, true);
assert.equal(P.canonicalLakeOwnershipUnchanged, true);
assert.equal(P.heightAuthorityUnchanged, true);
assert.equal(P.topologyPreserving, true);
assert.equal(P.deterministic, true);
assert.equal(R.coastlineWarpPolicyId, P.id);
assert.equal(R.coastlineSignedDistanceAware, true);
assert.equal(R.revision, 5);
assert(P.maximumAdditionalWarpCells < 0.5, 'additional coastline warp must stay sub-half-cell');

const stats = referenceCoastlineWarpStats();
assert.equal(stats.width, width);
assert.equal(stats.height, height);
assert(stats.seaBoundaryCellCount > 100, 'unexpectedly small sea boundary set');
assert(stats.dryBoundaryCellCount > 100, 'unexpectedly small dry boundary set');

let seaCenters = 0;
let dryCenters = 0;
let lakeCenters = 0;
let minimumCenterMarginCells = Infinity;
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const nx = (x + 0.5) / width;
    const ny = (y + 0.5) / height;
    const semantic = classifyReferenceBaseSurface(nx, ny);
    const field = sampleReferenceCoastlineField(nx, ny);
    const extra = referenceCoastlineNaturalizationOffsets(nx, ny);
    if (semantic === 'sea') {
      seaCenters += 1;
      assert(field.signedDistanceCells < 0, `sea centre lost negative sign at ${x},${y}`);
    } else {
      dryCenters += 1;
      assert(field.signedDistanceCells > 0, `non-sea centre lost positive sign at ${x},${y}`);
      if (semantic === 'lake') lakeCenters += 1;
    }
    minimumCenterMarginCells = Math.min(minimumCenterMarginCells, Math.abs(field.signedDistanceCells));
    assert(Math.abs(extra.du) < 1e-14 && Math.abs(extra.dv) < 1e-14,
      `additional coastline warp leaked into exact semantic centre ${x},${y}`);
  }
}
assert.equal(seaCenters, WORLD_REFERENCE_BASE_SURFACE_MASK.cellCounts.sea);
assert.equal(lakeCenters, WORLD_REFERENCE_BASE_SURFACE_MASK.cellCounts.lake);
assert.equal(dryCenters, width * height - seaCenters);
assert(minimumCenterMarginCells >= 0.499999, `semantic centre margin too small: ${minimumCenterMarginCells}`);

function legacyCoastWarpOffsets(nx, ny) {
  const broadU = signedFbmNoise(nx * 9.3 + 11.7, ny * 9.3 + 3.1, R.coastWarpOctaves);
  const broadV = signedFbmNoise(nx * 9.3 - 5.9, ny * 9.3 + 27.4, R.coastWarpOctaves);
  const fineU = signedFbmNoise(nx * 31.5 + 61.2, ny * 31.5 - 17.8, 2);
  const fineV = signedFbmNoise(nx * 31.5 - 43.6, ny * 31.5 + 8.5, 2);
  return {
    du: (broadU * 0.72 + fineU * 0.28) * R.coastWarpU,
    dv: (broadV * 0.72 + fineV * 0.28) * R.coastWarpV,
  };
}

const GRID_X = 288;
const GRID_Y = 192;
const legacySea = new Float32Array(GRID_X * GRID_Y);
const naturalSea = new Float32Array(GRID_X * GRID_Y);
let proximitySamples = 0;
let changedCoastSamples = 0;
let maxAdditionalCells = 0;
let maxCombinedDeltaMeters = 0;
let sumCombinedDeltaMeters = 0;
let maxDeterminismError = 0;
let farFieldAdditionalWarp = 0;

for (let gy = 0; gy < GRID_Y; gy += 1) {
  const ny = (gy + 0.5) / GRID_Y;
  for (let gx = 0; gx < GRID_X; gx += 1) {
    const nx = (gx + 0.5) / GRID_X;
    const index = gy * GRID_X + gx;
    const field = sampleReferenceCoastlineField(nx, ny);
    const extra = referenceCoastlineNaturalizationOffsets(nx, ny);
    const extraAgain = referenceCoastlineNaturalizationOffsets(nx, ny);
    maxDeterminismError = Math.max(
      maxDeterminismError,
      Math.abs(extra.du - extraAgain.du),
      Math.abs(extra.dv - extraAgain.dv),
    );
    const extraCells = Math.hypot(extra.du * width, extra.dv * height);
    maxAdditionalCells = Math.max(maxAdditionalCells, extraCells);
    if (field.proximity <= 0) farFieldAdditionalWarp = Math.max(farFieldAdditionalWarp, extraCells);

    const legacy = legacyCoastWarpOffsets(nx, ny);
    const natural = coastWarpOffsets(nx, ny);
    const deltaMeters = Math.hypot(
      (natural.du - legacy.du) * WORLD_WIDTH_METERS,
      (natural.dv - legacy.dv) * WORLD_DEPTH_METERS,
    );
    if (field.proximity > 0.05) {
      proximitySamples += 1;
      sumCombinedDeltaMeters += deltaMeters;
      maxCombinedDeltaMeters = Math.max(maxCombinedDeltaMeters, deltaMeters);
      if (deltaMeters > 2) changedCoastSamples += 1;
    }

    const legacySample = sampleReferencePindexQualityV2(
      clamp01(nx + legacy.du),
      clamp01(ny + legacy.dv),
    );
    const naturalSample = sampleReferencePindexQualityV2(
      clamp01(nx + natural.du),
      clamp01(ny + natural.dv),
    );
    legacySea[index] = legacySample.surfaceWeights.sea;
    naturalSea[index] = naturalSample.surfaceWeights.sea;
  }
}

assert.equal(maxDeterminismError, 0, 'coastline warp is not deterministic');
assert(maxAdditionalCells <= P.maximumAdditionalWarpCells + 1e-9,
  `additional coastline warp exceeded policy: ${maxAdditionalCells}`);
assert(farFieldAdditionalWarp < 1e-12, `coastline warp leaked into far field: ${farFieldAdditionalWarp}`);
const meanCombinedDeltaMeters = proximitySamples ? sumCombinedDeltaMeters / proximitySamples : 0;
const changedFraction = proximitySamples ? changedCoastSamples / proximitySamples : 0;
assert(maxCombinedDeltaMeters > 8, 'new coastline reconstruction is visually inert');
assert(maxCombinedDeltaMeters < 105, `combined coastline displacement is too large: ${maxCombinedDeltaMeters}`);
assert(changedFraction > 0.18, `too little of the source coastline changed: ${changedFraction}`);

function gradientMetrics(field) {
  let boundarySamples = 0;
  let axisAlignedSamples = 0;
  let gradientEnergy = 0;
  let maximumGradient = 0;
  for (let y = 1; y < GRID_Y - 1; y += 1) {
    for (let x = 1; x < GRID_X - 1; x += 1) {
      const index = y * GRID_X + x;
      const value = field[index];
      if (value <= 0.08 || value >= 0.92) continue;
      const gx = (field[index + 1] - field[index - 1]) * 0.5;
      const gy = (field[index + GRID_X] - field[index - GRID_X]) * 0.5;
      const ax = Math.abs(gx);
      const ay = Math.abs(gy);
      const major = Math.max(ax, ay);
      if (major < 1e-7) continue;
      const minor = Math.min(ax, ay);
      boundarySamples += 1;
      gradientEnergy += Math.hypot(gx, gy);
      maximumGradient = Math.max(maximumGradient, major);
      if (minor / major < 0.105) axisAlignedSamples += 1;
    }
  }
  return {
    boundarySamples,
    axisAlignedSamples,
    axisAlignedFraction: boundarySamples ? axisAlignedSamples / boundarySamples : 0,
    meanGradientEnergy: boundarySamples ? gradientEnergy / boundarySamples : 0,
    maximumGradient,
  };
}

const legacyGradient = gradientMetrics(legacySea);
const naturalGradient = gradientMetrics(naturalSea);
assert(legacyGradient.boundarySamples > 350, 'legacy boundary sample set too small');
assert(naturalGradient.boundarySamples > 350, 'natural boundary sample set too small');
assert(naturalGradient.axisAlignedFraction <= legacyGradient.axisAlignedFraction + 0.012,
  `axis alignment regressed: legacy=${legacyGradient.axisAlignedFraction}, natural=${naturalGradient.axisAlignedFraction}`);

let maxPindexSeamDeltaCells = 0;
const epsilon = 1e-7;
for (let strip = 1; strip < 10; strip += 1) {
  const x = strip / 10;
  for (let yi = 0; yi <= 96; yi += 1) {
    const y = yi / 96;
    const left = coastWarpOffsets(x - epsilon, y);
    const right = coastWarpOffsets(x + epsilon, y);
    maxPindexSeamDeltaCells = Math.max(
      maxPindexSeamDeltaCells,
      Math.abs(right.du - left.du) * width,
      Math.abs(right.dv - left.dv) * height,
    );
  }
}
assert(maxPindexSeamDeltaCells < 0.0025, `Pindex seam discontinuity: ${maxPindexSeamDeltaCells}`);

console.log('[checkReferenceCoastlineNaturalness] PASS');
console.log(JSON.stringify({
  coastlinePolicyId: P.id,
  reliefPolicyId: R.id,
  mask: {
    width,
    height,
    seaCenters,
    dryCenters,
    lakeCenters,
    minimumCenterMarginCells,
    seaBoundaryCellCount: stats.seaBoundaryCellCount,
    dryBoundaryCellCount: stats.dryBoundaryCellCount,
  },
  warp: {
    maxAdditionalCells,
    farFieldAdditionalWarp,
    maxCombinedDeltaMeters,
    meanCombinedDeltaMeters,
    changedFraction,
    maxPindexSeamDeltaCells,
  },
  gradient: {
    legacy: legacyGradient,
    natural: naturalGradient,
    axisAlignedDelta: naturalGradient.axisAlignedFraction - legacyGradient.axisAlignedFraction,
  },
}, null, 2));
