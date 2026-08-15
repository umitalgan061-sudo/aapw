/**
 * Şafak Kartalı / NE GeoCell G60 — Relief/Height Character through pinned Terrain3D.
 *
 * G60 is canonical 96/96 open sea. The merged Macro Biome already carries the
 * canonical submerged height for this owner cell. Relief must therefore preserve
 * that field exactly instead of inventing local submarine ridges, shelves, islands,
 * coastline or GeoCell-shaped bumps that are absent from map.png.
 */

import { G60_HYDROLOGY_POLICY, measureG60Hydrology } from './g60_hydrology.mjs';
import {
  G60_TERRAIN3D_BIOME_POLICY,
  g60BiomeOwnerCoordinates,
  measureG60Terrain3DBiome,
  sampleG60Biome,
} from './g60_biome.mjs';
import { FULL_REFERENCE_EXTENT_PLAN } from '../../../../src/3d/world/worldReferenceExtent.js';

export const G60_TERRAIN3D_RELIEF_POLICY = Object.freeze({
  id: 'safak-kartali-g60-terrain3d-relief-2026-08-15-v1',
  sourceMapSha256: G60_HYDROLOGY_POLICY.sourceMapSha256,
  hydrologyPolicyId: G60_HYDROLOGY_POLICY.id,
  biomePolicyId: G60_TERRAIN3D_BIOME_POLICY.id,
  geoCell: 'G60',
  gx: 6,
  gy: 0,
  layer: 'Relief/Height Character',
  normalizedBounds: G60_TERRAIN3D_BIOME_POLICY.normalizedBounds,
  guardNormalized: G60_TERRAIN3D_BIOME_POLICY.guardNormalized,
  sourceGridSize: 65,
  denseEnvelopeSize: 129,
  terrain3dImportSize: 257,
  terrain3dRegionSize: 256,
  syntheticReliefMeters: 0,
  canonicalHeightMeters: G60_TERRAIN3D_BIOME_POLICY.heightMeters,
  worldWidthMeters: FULL_REFERENCE_EXTENT_PLAN.widthMeters,
  worldDepthMeters: FULL_REFERENCE_EXTENT_PLAN.depthMeters,
});

const lerp = (a, b, t) => a + (b - a) * t;

function hashByte(checksum, byte) {
  return Math.imul((checksum ^ (byte & 0xff)) >>> 0, 16777619) >>> 0;
}

function hashQuantized(checksum, value, scale = 1000000) {
  const quantized = Math.round(value * scale) | 0;
  let result = checksum;
  for (const shift of [0, 8, 16, 24]) result = hashByte(result, quantized >>> shift);
  return result >>> 0;
}

export function g60ReliefGuardBounds() {
  const policy = G60_TERRAIN3D_RELIEF_POLICY;
  const bounds = policy.normalizedBounds;
  const guard = policy.guardNormalized;
  return Object.freeze({
    xMin: bounds.xMin - guard,
    xMax: bounds.xMax + guard,
    yMin: bounds.yMin,
    yMax: bounds.yMax + guard,
  });
}

export function sampleG60Relief(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
    throw new TypeError('normalized coordinates must be finite');
  }
  const owner = g60BiomeOwnerCoordinates(normalizedX, normalizedY, { allowGuard: true });
  const biome = sampleG60Biome(normalizedX, normalizedY);
  if (biome.body !== 'sea' || biome.water !== true) {
    throw new Error(`G60 Relief cannot author non-sea semantics at ${normalizedX},${normalizedY}`);
  }
  if (Math.abs(biome.heightMeters - G60_TERRAIN3D_RELIEF_POLICY.canonicalHeightMeters) > 1e-9) {
    throw new Error(`G60 merged Biome height provenance diverged at ${normalizedX},${normalizedY}`);
  }
  return Object.freeze({
    body: 'sea',
    water: true,
    insideOwner: owner.insideOwner,
    insideGuard: owner.insideGuard,
    heightMeters: biome.heightMeters,
    biomeHeightMeters: biome.heightMeters,
    addedReliefMeters: 0,
    normal: Object.freeze({ x: 0, y: 1, z: 0 }),
  });
}

export function measureG60Terrain3DRelief() {
  const policy = G60_TERRAIN3D_RELIEF_POLICY;
  const hydrology = measureG60Hydrology();
  const biome = measureG60Terrain3DBiome();
  const guardBounds = g60ReliefGuardBounds();
  const size = policy.sourceGridSize;
  let minHeight = Infinity;
  let maxHeight = -Infinity;
  let nonSeaSamples = 0;
  let biomeMismatchSamples = 0;
  let addedReliefAbsMax = 0;
  let maxAdjacentHeightDelta = 0;
  let maxGuardHeightDelta = 0;
  let maxGuardNormalDelta = 0;
  let maxCoordinateRoundTripError = 0;
  let checksum = 2166136261;
  const rows = [];

  for (let y = 0; y < size; y += 1) {
    const ny = lerp(guardBounds.yMin, guardBounds.yMax, y / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = lerp(guardBounds.xMin, guardBounds.xMax, x / (size - 1));
      const sample = sampleG60Relief(nx, ny);
      const prior = sampleG60Biome(nx, ny);
      const owner = g60BiomeOwnerCoordinates(nx, ny, { allowGuard: true });
      if (sample.body !== 'sea') nonSeaSamples += 1;
      if (Math.abs(sample.heightMeters - prior.heightMeters) > 1e-9) biomeMismatchSamples += 1;
      addedReliefAbsMax = Math.max(addedReliefAbsMax, Math.abs(sample.addedReliefMeters));
      minHeight = Math.min(minHeight, sample.heightMeters);
      maxHeight = Math.max(maxHeight, sample.heightMeters);
      checksum = hashQuantized(checksum, sample.heightMeters);
      checksum = hashQuantized(checksum, sample.normal.y);
      maxCoordinateRoundTripError = Math.max(
        maxCoordinateRoundTripError,
        Math.abs(owner.normalizedX - nx),
        Math.abs(owner.normalizedY - ny),
      );
      row.push(sample.heightMeters);
      if (x > 0) maxAdjacentHeightDelta = Math.max(maxAdjacentHeightDelta, Math.abs(sample.heightMeters - row[x - 1]));
      if (y > 0) maxAdjacentHeightDelta = Math.max(maxAdjacentHeightDelta, Math.abs(sample.heightMeters - rows[y - 1][x]));
    }
    rows.push(row);
  }

  const core = policy.normalizedBounds;
  const g = policy.guardNormalized;
  for (let i = 0; i < size; i += 1) {
    const t = i / (size - 1);
    const ny = lerp(core.yMin, core.yMax, t);
    const nx = lerp(core.xMin, core.xMax, t);
    const pairs = [
      [core.xMin, ny, core.xMin - g, ny],
      [core.xMax, ny, core.xMax + g, ny],
      [nx, core.yMax, nx, core.yMax + g],
    ];
    for (const [ax, ay, bx, by] of pairs) {
      const a = sampleG60Relief(ax, ay);
      const b = sampleG60Relief(bx, by);
      maxGuardHeightDelta = Math.max(maxGuardHeightDelta, Math.abs(a.heightMeters - b.heightMeters));
      maxGuardNormalDelta = Math.max(maxGuardNormalDelta, Math.hypot(
        a.normal.x - b.normal.x,
        a.normal.y - b.normal.y,
        a.normal.z - b.normal.z,
      ));
    }
  }

  return Object.freeze({
    policyId: policy.id,
    sourceMapSha256: policy.sourceMapSha256,
    hydrologyPolicyId: policy.hydrologyPolicyId,
    biomePolicyId: policy.biomePolicyId,
    geoCell: policy.geoCell,
    layer: policy.layer,
    canonicalWater: hydrology.waterCells,
    canonicalLand: hydrology.landCells,
    canonicalSea: hydrology.seaCells,
    canonicalLake: hydrology.lakeCells,
    boundaryEdges: hydrology.boundaryEdges,
    priorBiomeCanonicalSea: biome.canonicalSea,
    samples: size * size,
    nonSeaSamples,
    biomeMismatchSamples,
    addedReliefAbsMax,
    minHeight: Number(minHeight.toFixed(8)),
    maxHeight: Number(maxHeight.toFixed(8)),
    heightSpan: Number((maxHeight - minHeight).toFixed(8)),
    maxAdjacentHeightDelta: Number(maxAdjacentHeightDelta.toFixed(8)),
    maxGuardHeightDelta: Number(maxGuardHeightDelta.toFixed(8)),
    maxGuardNormalDelta: Number(maxGuardNormalDelta.toFixed(8)),
    maxCoordinateRoundTripError: Number(maxCoordinateRoundTripError.toFixed(12)),
    worldWidthMeters: Number(policy.worldWidthMeters.toFixed(6)),
    worldDepthMeters: Number(policy.worldDepthMeters.toFixed(6)),
    reliefChecksum: checksum >>> 0,
  });
}

export function buildG60Terrain3DReliefSource() {
  const policy = G60_TERRAIN3D_RELIEF_POLICY;
  const bounds = policy.normalizedBounds;
  const size = policy.sourceGridSize;
  const source = {
    schema: 'westeros-g60-terrain3d-relief-source-v1',
    policyId: policy.id,
    hydrologyPolicyId: policy.hydrologyPolicyId,
    biomePolicyId: policy.biomePolicyId,
    sourceMapSha256: policy.sourceMapSha256,
    geoCell: policy.geoCell,
    layer: policy.layer,
    width: size,
    height: size,
    normalizedBounds: bounds,
    guardNormalized: policy.guardNormalized,
    terrain3dImportSize: policy.terrain3dImportSize,
    terrain3dRegionSize: policy.terrain3dRegionSize,
    heights: [],
  };
  let checksum = 2166136261;
  for (let y = 0; y < size; y += 1) {
    const ny = lerp(bounds.yMin, bounds.yMax, y / (size - 1));
    for (let x = 0; x < size; x += 1) {
      const nx = lerp(bounds.xMin, bounds.xMax, x / (size - 1));
      const sample = sampleG60Relief(nx, ny);
      if (sample.body !== 'sea' || sample.addedReliefMeters !== 0) {
        throw new Error(`G60 Relief invented geography at ${x},${y}`);
      }
      const heightMeters = Number(sample.heightMeters.toFixed(6));
      source.heights.push(heightMeters);
      checksum = hashQuantized(checksum, heightMeters);
    }
  }
  source.sourceChecksum = checksum >>> 0;
  Object.freeze(source.heights);
  return Object.freeze(source);
}
