/**
 * Şafak Kartalı / NE GeoCell G60 — Macro Albedo/Biome through pinned Terrain3D.
 * G60 is canonical 96/96 open sea. GeoCell coordinates are addressing only; this
 * layer must not invent coastline, land, snow, roads, foliage, grid seams or steps.
 */

import { G60_HYDROLOGY_POLICY, measureG60Hydrology } from './g60_hydrology.mjs';

export const G60_TERRAIN3D_BIOME_POLICY = Object.freeze({
  id: 'safak-kartali-g60-terrain3d-biome-2026-08-14-v1',
  sourceMapSha256: G60_HYDROLOGY_POLICY.sourceMapSha256,
  hydrologyPolicyId: G60_HYDROLOGY_POLICY.id,
  geoCell: 'G60',
  gx: 6,
  gy: 0,
  layer: 'Macro Albedo/Biome',
  normalizedBounds: Object.freeze({ xMin: 6 / 8, xMax: 7 / 8, yMin: 0, yMax: 1 / 8 }),
  sourceGridSize: 65,
  terrain3dImportSize: 257,
  terrain3dRegionSize: 256,
  heightMeters: -8,
  color: Object.freeze([0.16, 0.30, 0.36]),
  roughness: 0.86,
});

function hashByte(checksum, byte) {
  return Math.imul((checksum ^ (byte & 0xff)) >>> 0, 16777619) >>> 0;
}

function hashQuantized(checksum, value, scale = 1000000) {
  const quantized = Math.round(value * scale) | 0;
  let result = checksum;
  for (const shift of [0, 8, 16, 24]) result = hashByte(result, quantized >>> shift);
  return result >>> 0;
}

export function sampleG60Biome(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
    throw new TypeError('normalized coordinates must be finite');
  }
  const { normalizedBounds: b } = G60_TERRAIN3D_BIOME_POLICY;
  const guard = 1 / (96 * 4);
  if (normalizedX < b.xMin - guard || normalizedX > b.xMax + guard || normalizedY < b.yMin || normalizedY > b.yMax + guard) {
    throw new RangeError('G60 biome sample is outside the qualified owner/guard envelope');
  }
  return Object.freeze({
    body: 'sea',
    water: true,
    waterConfidence: 1,
    heightMeters: G60_TERRAIN3D_BIOME_POLICY.heightMeters,
    color: G60_TERRAIN3D_BIOME_POLICY.color,
    roughness: G60_TERRAIN3D_BIOME_POLICY.roughness,
    dominantId: 'open-sea-floor',
  });
}

export function measureG60Terrain3DBiome() {
  const hydrology = measureG60Hydrology();
  const p = G60_TERRAIN3D_BIOME_POLICY;
  const size = p.sourceGridSize;
  let checksum = 2166136261;
  let nonSeaSamples = 0;
  let maxAdjacentColorDelta = 0;
  let maxAdjacentRoughnessDelta = 0;
  const previous = [];

  for (let y = 0; y < size; y += 1) {
    const ny = p.normalizedBounds.yMin + (p.normalizedBounds.yMax - p.normalizedBounds.yMin) * y / (size - 1);
    let left = null;
    for (let x = 0; x < size; x += 1) {
      const nx = p.normalizedBounds.xMin + (p.normalizedBounds.xMax - p.normalizedBounds.xMin) * x / (size - 1);
      const sample = sampleG60Biome(nx, ny);
      if (sample.body !== 'sea') nonSeaSamples += 1;
      for (const value of [sample.heightMeters, ...sample.color, sample.roughness]) checksum = hashQuantized(checksum, value);
      if (left) {
        maxAdjacentColorDelta = Math.max(maxAdjacentColorDelta, Math.hypot(...sample.color.map((v, i) => v - left.color[i])));
        maxAdjacentRoughnessDelta = Math.max(maxAdjacentRoughnessDelta, Math.abs(sample.roughness - left.roughness));
      }
      if (previous[x]) {
        maxAdjacentColorDelta = Math.max(maxAdjacentColorDelta, Math.hypot(...sample.color.map((v, i) => v - previous[x].color[i])));
        maxAdjacentRoughnessDelta = Math.max(maxAdjacentRoughnessDelta, Math.abs(sample.roughness - previous[x].roughness));
      }
      previous[x] = sample;
      left = sample;
    }
  }

  return Object.freeze({
    policyId: p.id,
    sourceMapSha256: p.sourceMapSha256,
    geoCell: p.geoCell,
    layer: p.layer,
    canonicalWater: hydrology.waterCells,
    canonicalLand: hydrology.landCells,
    canonicalSea: hydrology.seaCells,
    boundaryEdges: hydrology.boundaryEdges,
    samples: size * size,
    nonSeaSamples,
    maxAdjacentColorDelta,
    maxAdjacentRoughnessDelta,
    sourceChecksum: checksum >>> 0,
  });
}

export function buildG60Terrain3DBiomeSource() {
  const p = G60_TERRAIN3D_BIOME_POLICY;
  const size = p.sourceGridSize;
  const payload = {
    schema: 'westeros-g60-terrain3d-biome-source-v1',
    policyId: p.id,
    hydrologyPolicyId: p.hydrologyPolicyId,
    sourceMapSha256: p.sourceMapSha256,
    geoCell: p.geoCell,
    layer: p.layer,
    width: size,
    height: size,
    terrain3dImportSize: p.terrain3dImportSize,
    terrain3dRegionSize: p.terrain3dRegionSize,
    heights: [], waterConfidence: [], colorR: [], colorG: [], colorB: [], roughness: [],
  };
  let checksum = 2166136261;
  for (let i = 0; i < size * size; i += 1) {
    const values = [p.heightMeters, 1, p.color[0], p.color[1], p.color[2], p.roughness];
    payload.heights.push(values[0]);
    payload.waterConfidence.push(values[1]);
    payload.colorR.push(values[2]);
    payload.colorG.push(values[3]);
    payload.colorB.push(values[4]);
    payload.roughness.push(values[5]);
    for (const value of values) checksum = hashQuantized(checksum, value);
  }
  payload.sourceChecksum = checksum >>> 0;
  return Object.freeze(payload);
}
