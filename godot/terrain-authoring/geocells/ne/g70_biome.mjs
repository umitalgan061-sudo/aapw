/**
 * Şafak Kartalı / NE GeoCell G70 — Macro Albedo/Biome through pinned Terrain3D.
 *
 * G70 is canonical open sea. GeoCell coordinates are work addressing only: the authored
 * color/roughness field is sampled in continuous owner-map space and extends through the same
 * west/south guard domain already proven by merged G70 Coast/Hydrology. No land biome, island,
 * coastline or square-cell texture feature may be invented by this layer.
 */

import {
  G70_TERRAIN3D_HYDROLOGY_POLICY,
  g70GuardBounds,
  measureG70Terrain3DHydrology,
  sampleG70Hydrology,
} from './g70_hydrology.mjs';

export const G70_TERRAIN3D_BIOME_POLICY = Object.freeze({
  id: 'safak-kartali-g70-terrain3d-biome-2026-08-13-v1',
  sourceMapSha256: G70_TERRAIN3D_HYDROLOGY_POLICY.sourceMapSha256,
  hydrologyPolicyId: G70_TERRAIN3D_HYDROLOGY_POLICY.id,
  geoCell: 'G70',
  gx: 7,
  gy: 0,
  layer: 'Macro Albedo/Biome',
  normalizedBounds: G70_TERRAIN3D_HYDROLOGY_POLICY.normalizedBounds,
  guardBandNormalized: G70_TERRAIN3D_HYDROLOGY_POLICY.guardBandNormalized,
  sourceGridSize: 65,
  terrain3dImportSize: 257,
  terrain3dRegionSize: 256,
});

const COASTAL_SEDIMENT = Object.freeze([0.31, 0.34, 0.29]);
const OPEN_SEA_FLOOR = Object.freeze([0.16, 0.30, 0.36]);
const COASTAL_ROUGHNESS = 0.94;
const OPEN_SEA_ROUGHNESS = 0.86;

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const lerp = (a, b, t) => a + (b - a) * t;
const mixColor = (a, b, t) => Object.freeze([
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
]);
const colorDistance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function hashByte(checksum, byte) {
  return Math.imul((checksum ^ (byte & 0xff)) >>> 0, 16777619) >>> 0;
}

function hashQuantized(checksum, value, scale = 1000000) {
  const quantized = Math.round(value * scale) | 0;
  let result = checksum;
  for (const shift of [0, 8, 16, 24]) result = hashByte(result, quantized >>> shift);
  return result >>> 0;
}

export function sampleG70Biome(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
    throw new TypeError('normalized coordinates must be finite');
  }
  const hydrology = sampleG70Hydrology(normalizedX, normalizedY);
  if (!hydrology.water) {
    throw new Error(`G70 Macro Albedo/Biome cannot author land semantics at ${normalizedX},${normalizedY}`);
  }
  const coastBlend = clamp01(hydrology.coastBlend);
  return Object.freeze({
    body: hydrology.body,
    water: true,
    waterConfidence: 1,
    coastBlend,
    heightMeters: hydrology.heightMeters,
    color: mixColor(COASTAL_SEDIMENT, OPEN_SEA_FLOOR, coastBlend),
    roughness: lerp(COASTAL_ROUGHNESS, OPEN_SEA_ROUGHNESS, coastBlend),
    dominantId: coastBlend >= 0.5 ? 'open-sea-floor' : 'coastal-sediment',
  });
}

export function measureG70Terrain3DBiome() {
  const hydrology = measureG70Terrain3DHydrology();
  const bounds = g70GuardBounds();
  const core = G70_TERRAIN3D_BIOME_POLICY.normalizedBounds;
  const guard = G70_TERRAIN3D_BIOME_POLICY.guardBandNormalized;
  const size = G70_TERRAIN3D_BIOME_POLICY.sourceGridSize;
  const rows = [];
  const dominantCounts = {};
  let denseNonSeaSamples = 0;
  let minRoughness = Infinity;
  let maxRoughness = -Infinity;
  let maxAdjacentColorDelta = 0;
  let maxAdjacentRoughnessDelta = 0;
  let colorChecksum = 2166136261;
  let roughnessChecksum = 2166136261;

  for (let y = 0; y < size; y += 1) {
    const ny = lerp(bounds.yMin, bounds.yMax, y / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = lerp(bounds.xMin, bounds.xMax, x / (size - 1));
      const sample = sampleG70Biome(nx, ny);
      if (sample.body !== 'sea') denseNonSeaSamples += 1;
      dominantCounts[sample.dominantId] = (dominantCounts[sample.dominantId] ?? 0) + 1;
      minRoughness = Math.min(minRoughness, sample.roughness);
      maxRoughness = Math.max(maxRoughness, sample.roughness);
      for (const component of sample.color) colorChecksum = hashQuantized(colorChecksum, component);
      roughnessChecksum = hashQuantized(roughnessChecksum, sample.roughness);
      row.push(sample);
    }
    rows.push(row);
  }

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sample = rows[y][x];
      if (x + 1 < size) {
        maxAdjacentColorDelta = Math.max(maxAdjacentColorDelta, colorDistance(sample.color, rows[y][x + 1].color));
        maxAdjacentRoughnessDelta = Math.max(maxAdjacentRoughnessDelta, Math.abs(sample.roughness - rows[y][x + 1].roughness));
      }
      if (y + 1 < size) {
        maxAdjacentColorDelta = Math.max(maxAdjacentColorDelta, colorDistance(sample.color, rows[y + 1][x].color));
        maxAdjacentRoughnessDelta = Math.max(maxAdjacentRoughnessDelta, Math.abs(sample.roughness - rows[y + 1][x].roughness));
      }
    }
  }

  let maxGuardColorDelta = 0;
  let maxGuardRoughnessDelta = 0;
  for (let i = 0; i < size; i += 1) {
    const t = i / (size - 1);
    const ny = lerp(core.yMin, core.yMax, t);
    const nx = lerp(core.xMin, core.xMax, t);
    const westCore = sampleG70Biome(core.xMin, ny);
    const westGuard = sampleG70Biome(core.xMin - guard, ny);
    const southCore = sampleG70Biome(nx, core.yMax);
    const southGuard = sampleG70Biome(nx, core.yMax + guard);
    maxGuardColorDelta = Math.max(
      maxGuardColorDelta,
      colorDistance(westCore.color, westGuard.color),
      colorDistance(southCore.color, southGuard.color),
    );
    maxGuardRoughnessDelta = Math.max(
      maxGuardRoughnessDelta,
      Math.abs(westCore.roughness - westGuard.roughness),
      Math.abs(southCore.roughness - southGuard.roughness),
    );
  }

  return Object.freeze({
    policyId: G70_TERRAIN3D_BIOME_POLICY.id,
    sourceMapSha256: G70_TERRAIN3D_BIOME_POLICY.sourceMapSha256,
    geoCell: 'G70',
    layer: G70_TERRAIN3D_BIOME_POLICY.layer,
    canonicalWater: hydrology.waterCells,
    canonicalLand: hydrology.landCells,
    canonicalSea: hydrology.seaCells,
    canonicalLake: hydrology.lakeCells,
    boundaryEdges: hydrology.boundaryEdges,
    samples: size * size,
    denseNonSeaSamples,
    dominantCounts: Object.freeze({ ...dominantCounts }),
    minRoughness: Number(minRoughness.toFixed(8)),
    maxRoughness: Number(maxRoughness.toFixed(8)),
    maxAdjacentColorDelta: Number(maxAdjacentColorDelta.toFixed(8)),
    maxAdjacentRoughnessDelta: Number(maxAdjacentRoughnessDelta.toFixed(8)),
    maxGuardColorDelta: Number(maxGuardColorDelta.toFixed(8)),
    maxGuardRoughnessDelta: Number(maxGuardRoughnessDelta.toFixed(8)),
    colorChecksum: colorChecksum >>> 0,
    roughnessChecksum: roughnessChecksum >>> 0,
  });
}

export function buildG70Terrain3DBiomeSource() {
  const policy = G70_TERRAIN3D_BIOME_POLICY;
  const bounds = g70GuardBounds();
  const size = policy.sourceGridSize;
  const payload = {
    schema: 'westeros-g70-terrain3d-biome-source-v1',
    policyId: policy.id,
    hydrologyPolicyId: policy.hydrologyPolicyId,
    sourceMapSha256: policy.sourceMapSha256,
    geoCell: policy.geoCell,
    layer: policy.layer,
    width: size,
    height: size,
    sourceGridSize: size,
    terrain3dImportSize: policy.terrain3dImportSize,
    terrain3dRegionSize: policy.terrain3dRegionSize,
    coreBounds: policy.normalizedBounds,
    guardBounds: bounds,
    heights: [],
    waterConfidence: [],
    colorR: [],
    colorG: [],
    colorB: [],
    roughness: [],
  };
  let checksum = 2166136261;
  for (let y = 0; y < size; y += 1) {
    const ny = lerp(bounds.yMin, bounds.yMax, y / (size - 1));
    for (let x = 0; x < size; x += 1) {
      const nx = lerp(bounds.xMin, bounds.xMax, x / (size - 1));
      const sample = sampleG70Biome(nx, ny);
      if (sample.body !== 'sea' || sample.waterConfidence !== 1) {
        throw new Error(`G70 biome source invented non-sea semantics at ${x},${y}: ${sample.body}`);
      }
      const values = [
        Number(sample.heightMeters.toFixed(6)),
        1,
        Number(sample.color[0].toFixed(8)),
        Number(sample.color[1].toFixed(8)),
        Number(sample.color[2].toFixed(8)),
        Number(sample.roughness.toFixed(8)),
      ];
      payload.heights.push(values[0]);
      payload.waterConfidence.push(values[1]);
      payload.colorR.push(values[2]);
      payload.colorG.push(values[3]);
      payload.colorB.push(values[4]);
      payload.roughness.push(values[5]);
      for (const value of values) checksum = hashQuantized(checksum, value);
    }
  }
  payload.sourceChecksum = checksum >>> 0;
  return Object.freeze(payload);
}
