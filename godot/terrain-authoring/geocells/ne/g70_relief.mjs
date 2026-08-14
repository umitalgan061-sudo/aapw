/**
 * Şafak Kartalı / NE GeoCell G70 — Relief/Height Character through pinned Terrain3D.
 *
 * G70 is canonical open sea. The merged Hydrology layer resolves its core and proven
 * west/south guard domain to the same open-water seafloor height. Relief therefore
 * preserves that physical field exactly: inventing submarine ridges, islands, coast
 * shelves or GeoCell-shaped bumps would be less faithful to map.png, not more detailed.
 */
import {
  G70_TERRAIN3D_HYDROLOGY_POLICY,
  g70GuardBounds,
  measureG70Terrain3DHydrology,
  sampleG70Hydrology,
} from './g70_hydrology.mjs';
import {
  G70_TERRAIN3D_BIOME_POLICY,
  measureG70Terrain3DBiome,
  sampleG70Biome,
} from './g70_biome.mjs';
import { FULL_REFERENCE_EXTENT_PLAN } from '../../../../src/3d/world/worldReferenceExtent.js';

export const G70_TERRAIN3D_RELIEF_POLICY = Object.freeze({
  id: 'safak-kartali-g70-terrain3d-relief-2026-08-13-v1',
  sourceMapSha256: G70_TERRAIN3D_HYDROLOGY_POLICY.sourceMapSha256,
  hydrologyPolicyId: G70_TERRAIN3D_HYDROLOGY_POLICY.id,
  biomePolicyId: G70_TERRAIN3D_BIOME_POLICY.id,
  geoCell: 'G70',
  gx: 7,
  gy: 0,
  layer: 'Relief/Height Character',
  normalizedBounds: G70_TERRAIN3D_HYDROLOGY_POLICY.normalizedBounds,
  guardBandNormalized: G70_TERRAIN3D_HYDROLOGY_POLICY.guardBandNormalized,
  sourceGridSize: 65,
  terrain3dImportSize: 257,
  terrain3dRegionSize: 256,
  syntheticReliefMeters: 0,
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

export function sampleG70Relief(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
    throw new TypeError('normalized coordinates must be finite');
  }
  const hydrology = sampleG70Hydrology(normalizedX, normalizedY);
  const biome = sampleG70Biome(normalizedX, normalizedY);
  if (hydrology.body !== 'sea' || biome.body !== 'sea' || !hydrology.water || !biome.water) {
    throw new Error(`G70 Relief cannot author non-sea semantics at ${normalizedX},${normalizedY}`);
  }
  if (Math.abs(hydrology.heightMeters - biome.heightMeters) > 1e-9) {
    throw new Error(`G70 merged Hydrology/Biome height provenance diverged at ${normalizedX},${normalizedY}`);
  }
  return Object.freeze({
    body: 'sea',
    water: true,
    heightMeters: hydrology.heightMeters,
    hydrologyHeightMeters: hydrology.heightMeters,
    biomeHeightMeters: biome.heightMeters,
    addedReliefMeters: 0,
    normal: Object.freeze({ x: 0, y: 1, z: 0 }),
  });
}

export function measureG70Terrain3DRelief() {
  const policy = G70_TERRAIN3D_RELIEF_POLICY;
  const hydrology = measureG70Terrain3DHydrology();
  const biome = measureG70Terrain3DBiome();
  const bounds = g70GuardBounds();
  const core = policy.normalizedBounds;
  const size = policy.sourceGridSize;
  let minHeight = Infinity;
  let maxHeight = -Infinity;
  let maxAdjacentHeightDelta = 0;
  let maxGuardHeightDelta = 0;
  let maxGuardNormalDelta = 0;
  let nonSeaSamples = 0;
  let hydrologyMismatchSamples = 0;
  let biomeMismatchSamples = 0;
  let addedReliefAbsMax = 0;
  let checksum = 2166136261;
  const rows = [];

  for (let y = 0; y < size; y += 1) {
    const ny = lerp(bounds.yMin, bounds.yMax, y / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = lerp(bounds.xMin, bounds.xMax, x / (size - 1));
      const sample = sampleG70Relief(nx, ny);
      const hydrologySample = sampleG70Hydrology(nx, ny);
      const biomeSample = sampleG70Biome(nx, ny);
      if (sample.body !== 'sea') nonSeaSamples += 1;
      if (Math.abs(sample.heightMeters - hydrologySample.heightMeters) > 1e-9) hydrologyMismatchSamples += 1;
      if (Math.abs(sample.heightMeters - biomeSample.heightMeters) > 1e-9) biomeMismatchSamples += 1;
      addedReliefAbsMax = Math.max(addedReliefAbsMax, Math.abs(sample.addedReliefMeters));
      minHeight = Math.min(minHeight, sample.heightMeters);
      maxHeight = Math.max(maxHeight, sample.heightMeters);
      checksum = hashQuantized(checksum, sample.heightMeters);
      checksum = hashQuantized(checksum, sample.normal.y);
      row.push(sample.heightMeters);
      if (x > 0) maxAdjacentHeightDelta = Math.max(maxAdjacentHeightDelta, Math.abs(sample.heightMeters - row[x - 1]));
      if (y > 0) maxAdjacentHeightDelta = Math.max(maxAdjacentHeightDelta, Math.abs(sample.heightMeters - rows[y - 1][x]));
    }
    rows.push(row);
  }

  const g = policy.guardBandNormalized;
  for (let i = 0; i < size; i += 1) {
    const t = i / (size - 1);
    const ny = lerp(core.yMin, core.yMax, t);
    const nx = lerp(core.xMin, core.xMax, t);
    const pairs = [
      [core.xMin, ny, core.xMin - g, ny],
      [nx, core.yMax, nx, core.yMax + g],
    ];
    for (const [ax, ay, bx, by] of pairs) {
      const a = sampleG70Relief(ax, ay);
      const b = sampleG70Relief(bx, by);
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
    boundaryEdges: hydrology.boundaryEdges,
    priorBiomeCanonicalSea: biome.canonicalSea,
    samples: size * size,
    nonSeaSamples,
    hydrologyMismatchSamples,
    biomeMismatchSamples,
    addedReliefAbsMax,
    minHeight: Number(minHeight.toFixed(8)),
    maxHeight: Number(maxHeight.toFixed(8)),
    heightSpan: Number((maxHeight - minHeight).toFixed(8)),
    maxAdjacentHeightDelta: Number(maxAdjacentHeightDelta.toFixed(8)),
    maxGuardHeightDelta: Number(maxGuardHeightDelta.toFixed(8)),
    maxGuardNormalDelta: Number(maxGuardNormalDelta.toFixed(8)),
    worldWidthMeters: Number(policy.worldWidthMeters.toFixed(6)),
    worldDepthMeters: Number(policy.worldDepthMeters.toFixed(6)),
    reliefChecksum: checksum >>> 0,
  });
}

export function buildG70Terrain3DReliefSource() {
  const policy = G70_TERRAIN3D_RELIEF_POLICY;
  const bounds = g70GuardBounds();
  const size = policy.sourceGridSize;
  const source = {
    schema: 'westeros-g70-terrain3d-relief-source-v1',
    policyId: policy.id,
    hydrologyPolicyId: policy.hydrologyPolicyId,
    biomePolicyId: policy.biomePolicyId,
    sourceMapSha256: policy.sourceMapSha256,
    geoCell: policy.geoCell,
    layer: policy.layer,
    width: size,
    height: size,
    terrain3dImportSize: policy.terrain3dImportSize,
    terrain3dRegionSize: policy.terrain3dRegionSize,
    coreBounds: policy.normalizedBounds,
    guardBounds: bounds,
    heights: [],
  };
  let checksum = 2166136261;
  for (let y = 0; y < size; y += 1) {
    const ny = lerp(bounds.yMin, bounds.yMax, y / (size - 1));
    for (let x = 0; x < size; x += 1) {
      const nx = lerp(bounds.xMin, bounds.xMax, x / (size - 1));
      const sample = sampleG70Relief(nx, ny);
      if (sample.body !== 'sea' || sample.addedReliefMeters !== 0) {
        throw new Error(`G70 relief source invented geography at ${x},${y}`);
      }
      const heightMeters = Number(sample.heightMeters.toFixed(6));
      source.heights.push(heightMeters);
      checksum = hashQuantized(checksum, heightMeters);
    }
  }
  source.sourceChecksum = checksum >>> 0;
  return Object.freeze(source);
}
