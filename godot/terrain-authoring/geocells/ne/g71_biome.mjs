/**
 * Şafak Kartalı / NE GeoCell G71 — Macro Albedo/Biome through pinned Terrain3D.
 * G71 is canonical 96/96 open sea. Grid coordinates are addressing/QA only; this
 * layer preserves the owner-map silhouette and creates no land, coast, or square patch.
 */
import { G71_HYDROLOGY_POLICY, measureG71Hydrology } from './g71_hydrology.mjs';

export const G71_TERRAIN3D_BIOME_POLICY = Object.freeze({
  id: 'safak-kartali-g71-terrain3d-biome-2026-08-14-v1',
  hydrologyPolicyId: G71_HYDROLOGY_POLICY.id,
  sourceMapSha256: G71_HYDROLOGY_POLICY.sourceMapSha256,
  geoCell: 'G71', gx: 7, gy: 1, layer: 'Macro Albedo/Biome',
  normalizedBounds: Object.freeze({ xMin: 7 / 8, xMax: 1, yMin: 1 / 8, yMax: 2 / 8 }),
  guardBandNormalized: 1 / 192,
  sourceGridSize: 65,
  terrain3dImportSize: 257,
  terrain3dRegionSize: 256,
});

const SEA_COLOR = Object.freeze([0.16, 0.30, 0.36]);
const SEA_ROUGHNESS = 0.86;
const SEA_HEIGHT = -8.0;
const lerp = (a, b, t) => a + (b - a) * t;

function hashByte(checksum, byte) {
  return Math.imul((checksum ^ (byte & 0xff)) >>> 0, 16777619) >>> 0;
}
function hashQuantized(checksum, value, scale = 1_000_000) {
  const q = Math.round(value * scale) | 0;
  let result = checksum;
  for (const shift of [0, 8, 16, 24]) result = hashByte(result, q >>> shift);
  return result >>> 0;
}

export function g71BiomeGuardBounds() {
  const core = G71_TERRAIN3D_BIOME_POLICY.normalizedBounds;
  const g = G71_TERRAIN3D_BIOME_POLICY.guardBandNormalized;
  return Object.freeze({ xMin: core.xMin - g, xMax: core.xMax, yMin: core.yMin - g, yMax: core.yMax + g });
}

export function sampleG71Biome(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) throw new TypeError('normalized coordinates must be finite');
  const bounds = g71BiomeGuardBounds();
  if (normalizedX < bounds.xMin || normalizedX > bounds.xMax || normalizedY < bounds.yMin || normalizedY > bounds.yMax) {
    throw new RangeError('G71 biome sample outside qualified guard domain');
  }
  return Object.freeze({
    body: 'sea', water: true, waterConfidence: 1,
    heightMeters: SEA_HEIGHT, color: SEA_COLOR, roughness: SEA_ROUGHNESS,
    dominantId: 'open-sea-floor',
  });
}

export function measureG71Terrain3DBiome() {
  const hydrology = measureG71Hydrology();
  const bounds = g71BiomeGuardBounds();
  const size = G71_TERRAIN3D_BIOME_POLICY.sourceGridSize;
  let checksum = 2166136261;
  let nonSea = 0;
  let maxAdjacentColorDelta = 0;
  let maxAdjacentRoughnessDelta = 0;
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const ny = lerp(bounds.yMin, bounds.yMax, y / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = lerp(bounds.xMin, bounds.xMax, x / (size - 1));
      const sample = sampleG71Biome(nx, ny);
      if (sample.body !== 'sea') nonSea += 1;
      for (const value of [sample.heightMeters, ...sample.color, sample.roughness]) checksum = hashQuantized(checksum, value);
      row.push(sample);
    }
    rows.push(row);
  }
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const a = rows[y][x];
    for (const b of [x + 1 < size ? rows[y][x + 1] : null, y + 1 < size ? rows[y + 1][x] : null]) if (b) {
      maxAdjacentColorDelta = Math.max(maxAdjacentColorDelta, Math.hypot(a.color[0]-b.color[0], a.color[1]-b.color[1], a.color[2]-b.color[2]));
      maxAdjacentRoughnessDelta = Math.max(maxAdjacentRoughnessDelta, Math.abs(a.roughness-b.roughness));
    }
  }
  return Object.freeze({
    policyId: G71_TERRAIN3D_BIOME_POLICY.id, sourceMapSha256: G71_TERRAIN3D_BIOME_POLICY.sourceMapSha256,
    geoCell: 'G71', layer: G71_TERRAIN3D_BIOME_POLICY.layer,
    canonicalWater: hydrology.waterCells, canonicalLand: hydrology.landCells,
    canonicalSea: hydrology.seaCells, canonicalLake: hydrology.lakeCells, boundaryEdges: hydrology.boundaryEdges,
    samples: size * size, denseNonSeaSamples: nonSea,
    dominantCounts: Object.freeze({ 'open-sea-floor': size * size }),
    minRoughness: SEA_ROUGHNESS, maxRoughness: SEA_ROUGHNESS,
    maxAdjacentColorDelta, maxAdjacentRoughnessDelta,
    northGuardNeighbor: 'G70', westGuardNeighbor: 'G61', sourceChecksum: checksum >>> 0,
  });
}

export function buildG71Terrain3DBiomeSource() {
  const policy = G71_TERRAIN3D_BIOME_POLICY;
  const bounds = g71BiomeGuardBounds();
  const size = policy.sourceGridSize;
  const payload = {
    schema: 'westeros-g71-terrain3d-biome-source-v1', policyId: policy.id,
    hydrologyPolicyId: policy.hydrologyPolicyId, sourceMapSha256: policy.sourceMapSha256,
    geoCell: policy.geoCell, layer: policy.layer, width: size, height: size,
    sourceGridSize: size, terrain3dImportSize: policy.terrain3dImportSize,
    terrain3dRegionSize: policy.terrain3dRegionSize, coreBounds: policy.normalizedBounds, guardBounds: bounds,
    heights: [], waterConfidence: [], colorR: [], colorG: [], colorB: [], roughness: [],
  };
  let checksum = 2166136261;
  for (let y = 0; y < size; y += 1) {
    const ny = lerp(bounds.yMin, bounds.yMax, y / (size - 1));
    for (let x = 0; x < size; x += 1) {
      const nx = lerp(bounds.xMin, bounds.xMax, x / (size - 1));
      const s = sampleG71Biome(nx, ny);
      const values = [s.heightMeters, 1, s.color[0], s.color[1], s.color[2], s.roughness];
      payload.heights.push(values[0]); payload.waterConfidence.push(1);
      payload.colorR.push(values[2]); payload.colorG.push(values[3]); payload.colorB.push(values[4]); payload.roughness.push(values[5]);
      for (const value of values) checksum = hashQuantized(checksum, value);
    }
  }
  payload.sourceChecksum = checksum >>> 0;
  return Object.freeze(payload);
}
