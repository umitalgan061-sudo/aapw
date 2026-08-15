/**
 * Şafak Kartalı / NE GeoCell G71 — Relief/Height Character through pinned Terrain3D.
 *
 * G71 is canonical 96/96 open sea and its accepted Macro Biome is a flat -8m
 * seafloor. map.png carries no bathymetric evidence here, so Relief must preserve
 * that field exactly instead of inventing ridges, shelves, islands or cell bumps.
 */
import { G71_HYDROLOGY_POLICY, measureG71Hydrology } from './g71_hydrology.mjs';
import {
  G71_TERRAIN3D_BIOME_POLICY,
  g71BiomeGuardBounds,
  g71BiomeNormalizedFromSource,
  g71BiomeOwnerCoordinates,
  measureG71NeighborSeaHalo,
  measureG71Terrain3DBiome,
  sampleG71Biome,
} from './g71_biome.mjs';
import { FULL_REFERENCE_EXTENT_PLAN } from '../../../../src/3d/world/worldReferenceExtent.js';

export const G71_TERRAIN3D_RELIEF_POLICY = Object.freeze({
  id: 'safak-kartali-g71-terrain3d-relief-2026-08-15-v1',
  sourceMapSha256: G71_HYDROLOGY_POLICY.sourceMapSha256,
  hydrologyPolicyId: G71_HYDROLOGY_POLICY.id,
  biomePolicyId: G71_TERRAIN3D_BIOME_POLICY.id,
  geoCell: 'G71', gx: 7, gy: 1, layer: 'Relief/Height Character',
  normalizedBounds: G71_TERRAIN3D_BIOME_POLICY.normalizedBounds,
  guardNormalized: G71_TERRAIN3D_BIOME_POLICY.guardNormalized,
  sourceGridSize: 65,
  denseEnvelopeSize: 129,
  terrain3dImportSize: 257,
  terrain3dRegionSize: 256,
  canonicalHeightMeters: G71_TERRAIN3D_BIOME_POLICY.heightMeters,
  syntheticReliefMeters: 0,
  eastWorldBoundaryX: 1,
  eastGuardAllowed: false,
  worldWidthMeters: FULL_REFERENCE_EXTENT_PLAN.widthMeters,
  worldDepthMeters: FULL_REFERENCE_EXTENT_PLAN.depthMeters,
});

const lerp = (a, b, t) => a + (b - a) * t;
function hashByte(checksum, byte) {
  return Math.imul((checksum ^ (byte & 0xff)) >>> 0, 16777619) >>> 0;
}
function hashNumber(checksum, value) {
  const q = Math.round(value * 1e6) | 0;
  let out = checksum;
  for (const shift of [0, 8, 16, 24]) out = hashByte(out, q >>> shift);
  return out >>> 0;
}

export function g71ReliefGuardBounds() {
  return g71BiomeGuardBounds();
}

export function sampleG71Relief(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
    throw new TypeError('G71 Relief coordinates must be finite');
  }
  const owner = g71BiomeOwnerCoordinates(normalizedX, normalizedY, { allowGuard: true });
  const biome = sampleG71Biome(normalizedX, normalizedY);
  if (biome.body !== 'sea' || biome.water !== true || biome.waterConfidence !== 1) {
    throw new Error(`G71 Relief cannot author non-sea semantics at ${normalizedX},${normalizedY}`);
  }
  if (Math.abs(biome.heightMeters - G71_TERRAIN3D_RELIEF_POLICY.canonicalHeightMeters) > 1e-9) {
    throw new Error(`G71 merged Biome height provenance diverged at ${normalizedX},${normalizedY}`);
  }
  return Object.freeze({
    body: 'sea', water: true,
    insideOwner: owner.insideOwner,
    insideGuard: owner.insideGuard,
    heightMeters: biome.heightMeters,
    biomeHeightMeters: biome.heightMeters,
    addedReliefMeters: 0,
    normal: Object.freeze({ x: 0, y: 1, z: 0 }),
  });
}

export function measureG71Terrain3DRelief() {
  const p = G71_TERRAIN3D_RELIEF_POLICY;
  const hydrology = measureG71Hydrology();
  const biome = measureG71Terrain3DBiome();
  const halo = measureG71NeighborSeaHalo();
  const guard = g71ReliefGuardBounds();
  const rows = [];
  let minHeight = Infinity;
  let maxHeight = -Infinity;
  let nonSeaSamples = 0;
  let biomeMismatchSamples = 0;
  let addedReliefAbsMax = 0;
  let maxAdjacentHeightDelta = 0;
  let maxCoordinateRoundTripError = 0;
  let checksum = 2166136261;

  for (let y = 0; y < p.sourceGridSize; y += 1) {
    const ny = lerp(guard.yMin, guard.yMax, y / (p.sourceGridSize - 1));
    const row = [];
    for (let x = 0; x < p.sourceGridSize; x += 1) {
      const nx = lerp(guard.xMin, guard.xMax, x / (p.sourceGridSize - 1));
      const sample = sampleG71Relief(nx, ny);
      const prior = sampleG71Biome(nx, ny);
      const owner = g71BiomeOwnerCoordinates(nx, ny, { allowGuard: true });
      if (sample.body !== 'sea') nonSeaSamples += 1;
      if (Math.abs(sample.heightMeters - prior.heightMeters) > 1e-9) biomeMismatchSamples += 1;
      addedReliefAbsMax = Math.max(addedReliefAbsMax, Math.abs(sample.addedReliefMeters));
      minHeight = Math.min(minHeight, sample.heightMeters);
      maxHeight = Math.max(maxHeight, sample.heightMeters);
      maxCoordinateRoundTripError = Math.max(
        maxCoordinateRoundTripError,
        Math.abs(owner.normalizedX - nx), Math.abs(owner.normalizedY - ny),
      );
      checksum = hashNumber(checksum, sample.heightMeters);
      checksum = hashNumber(checksum, sample.normal.y);
      row.push(sample.heightMeters);
      if (x > 0) maxAdjacentHeightDelta = Math.max(maxAdjacentHeightDelta, Math.abs(sample.heightMeters - row[x - 1]));
      if (y > 0) maxAdjacentHeightDelta = Math.max(maxAdjacentHeightDelta, Math.abs(sample.heightMeters - rows[y - 1][x]));
    }
    rows.push(row);
  }

  const core = p.normalizedBounds;
  const g = p.guardNormalized;
  let maxGuardHeightDelta = 0;
  let maxGuardNormalDelta = 0;
  let guardPairs = 0;
  for (let i = 0; i < p.sourceGridSize; i += 1) {
    const t = i / (p.sourceGridSize - 1);
    const ny = lerp(core.yMin, core.yMax, t);
    const nx = lerp(core.xMin, core.xMax, t);
    for (const [ax, ay, bx, by] of [
      [core.xMin, ny, core.xMin - g, ny],
      [nx, core.yMin, nx, core.yMin - g],
      [nx, core.yMax, nx, core.yMax + g],
    ]) {
      const a = sampleG71Relief(ax, ay);
      const b = sampleG71Relief(bx, by);
      maxGuardHeightDelta = Math.max(maxGuardHeightDelta, Math.abs(a.heightMeters - b.heightMeters));
      maxGuardNormalDelta = Math.max(maxGuardNormalDelta, Math.hypot(a.normal.x - b.normal.x, a.normal.y - b.normal.y, a.normal.z - b.normal.z));
      guardPairs += 1;
    }
  }

  return Object.freeze({
    policyId: p.id, sourceMapSha256: p.sourceMapSha256,
    hydrologyPolicyId: p.hydrologyPolicyId, biomePolicyId: p.biomePolicyId,
    geoCell: p.geoCell, layer: p.layer,
    canonicalWater: hydrology.waterCells, canonicalLand: hydrology.landCells,
    canonicalSea: hydrology.seaCells, canonicalLake: hydrology.lakeCells,
    boundaryEdges: hydrology.boundaryEdges, priorBiomeCanonicalSea: biome.canonicalSea,
    haloSamples: halo.samples, haloNonSeaSamples: halo.nonSeaSamples,
    samples: p.sourceGridSize ** 2, nonSeaSamples, biomeMismatchSamples,
    addedReliefAbsMax, minHeight, maxHeight,
    heightSpan: Number((maxHeight - minHeight).toFixed(8)),
    maxAdjacentHeightDelta, maxGuardHeightDelta, maxGuardNormalDelta,
    guardPairs, maxCoordinateRoundTripError,
    eastWorldBoundaryX: p.eastWorldBoundaryX, eastGuardAllowed: p.eastGuardAllowed,
    worldWidthMeters: Number(p.worldWidthMeters.toFixed(6)),
    worldDepthMeters: Number(p.worldDepthMeters.toFixed(6)),
    reliefChecksum: checksum >>> 0,
  });
}

export function buildG71Terrain3DReliefSource() {
  const p = G71_TERRAIN3D_RELIEF_POLICY;
  const payload = {
    schema: 'westeros-g71-terrain3d-relief-source-v1', policyId: p.id,
    hydrologyPolicyId: p.hydrologyPolicyId, biomePolicyId: p.biomePolicyId,
    sourceMapSha256: p.sourceMapSha256, geoCell: p.geoCell, layer: p.layer,
    width: p.sourceGridSize, height: p.sourceGridSize,
    normalizedBounds: p.normalizedBounds, guardBounds: g71ReliefGuardBounds(),
    terrain3dImportSize: p.terrain3dImportSize, terrain3dRegionSize: p.terrain3dRegionSize,
    heights: [],
  };
  let checksum = 2166136261;
  for (let y = 0; y < p.sourceGridSize; y += 1) for (let x = 0; x < p.sourceGridSize; x += 1) {
    const c = g71BiomeNormalizedFromSource(x, y);
    const sample = sampleG71Relief(c.normalizedX, c.normalizedY);
    if (sample.body !== 'sea' || sample.addedReliefMeters !== 0) throw new Error(`G71 Relief invented geography at ${x},${y}`);
    const heightMeters = Number(sample.heightMeters.toFixed(6));
    payload.heights.push(heightMeters);
    checksum = hashNumber(checksum, heightMeters);
  }
  payload.sourceChecksum = checksum >>> 0;
  Object.freeze(payload.heights);
  return Object.freeze(payload);
}
