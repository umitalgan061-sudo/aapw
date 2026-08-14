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
  guardNormalized: 1 / (96 * 4),
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

function assertFiniteCoordinates(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
    throw new TypeError('normalized coordinates must be finite');
  }
}

export function g60BiomeOwnerCoordinates(normalizedX, normalizedY, { allowGuard = true } = {}) {
  assertFiniteCoordinates(normalizedX, normalizedY);
  const p = G60_TERRAIN3D_BIOME_POLICY;
  const b = p.normalizedBounds;
  const guard = allowGuard ? p.guardNormalized : 0;
  if (
    normalizedX < b.xMin - guard || normalizedX > b.xMax + guard
    || normalizedY < b.yMin || normalizedY > b.yMax + guard
  ) {
    throw new RangeError('G60 biome coordinate is outside the qualified owner/guard envelope');
  }
  const width = b.xMax - b.xMin;
  const height = b.yMax - b.yMin;
  const u = (normalizedX - b.xMin) / width;
  const v = (normalizedY - b.yMin) / height;
  const insideOwner = normalizedX >= b.xMin && normalizedX <= b.xMax && normalizedY >= b.yMin && normalizedY <= b.yMax;
  return Object.freeze({
    normalizedX,
    normalizedY,
    u,
    v,
    clampedU: Math.max(0, Math.min(1, u)),
    clampedV: Math.max(0, Math.min(1, v)),
    insideOwner,
    insideGuard: !insideOwner,
  });
}

export function g60BiomeNormalizedFromSource(sourceX, sourceY) {
  const p = G60_TERRAIN3D_BIOME_POLICY;
  const size = p.sourceGridSize;
  if (!Number.isInteger(sourceX) || !Number.isInteger(sourceY)) {
    throw new TypeError('G60 biome source coordinates must be integers');
  }
  if (sourceX < 0 || sourceX >= size || sourceY < 0 || sourceY >= size) {
    throw new RangeError('G60 biome source coordinates are outside the 65x65 source grid');
  }
  const u = sourceX / (size - 1);
  const v = sourceY / (size - 1);
  const b = p.normalizedBounds;
  return Object.freeze({
    sourceX,
    sourceY,
    u,
    v,
    normalizedX: b.xMin + (b.xMax - b.xMin) * u,
    normalizedY: b.yMin + (b.yMax - b.yMin) * v,
    linearIndex: sourceY * size + sourceX,
  });
}

export function sampleG60Biome(normalizedX, normalizedY) {
  g60BiomeOwnerCoordinates(normalizedX, normalizedY);
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

export function sampleG60BiomeSourcePoint(sourceX, sourceY) {
  const coordinates = g60BiomeNormalizedFromSource(sourceX, sourceY);
  const sample = sampleG60Biome(coordinates.normalizedX, coordinates.normalizedY);
  return Object.freeze({ ...coordinates, ...sample });
}

export function measureG60Terrain3DBiome() {
  const hydrology = measureG60Hydrology();
  const p = G60_TERRAIN3D_BIOME_POLICY;
  const size = p.sourceGridSize;
  let checksum = 2166136261;
  let coordinateChecksum = 2166136261;
  let nonSeaSamples = 0;
  let maxAdjacentColorDelta = 0;
  let maxAdjacentRoughnessDelta = 0;
  let maxCoordinateRoundTripError = 0;
  const previous = [];

  for (let y = 0; y < size; y += 1) {
    let left = null;
    for (let x = 0; x < size; x += 1) {
      const coordinates = g60BiomeNormalizedFromSource(x, y);
      const owner = g60BiomeOwnerCoordinates(coordinates.normalizedX, coordinates.normalizedY, { allowGuard: false });
      const sample = sampleG60Biome(coordinates.normalizedX, coordinates.normalizedY);
      if (sample.body !== 'sea') nonSeaSamples += 1;
      for (const value of [sample.heightMeters, sample.waterConfidence, ...sample.color, sample.roughness]) checksum = hashQuantized(checksum, value);
      for (const value of [coordinates.normalizedX, coordinates.normalizedY, owner.u, owner.v]) coordinateChecksum = hashQuantized(coordinateChecksum, value);
      maxCoordinateRoundTripError = Math.max(
        maxCoordinateRoundTripError,
        Math.abs(owner.u - coordinates.u),
        Math.abs(owner.v - coordinates.v),
      );
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
    maxCoordinateRoundTripError,
    sourceChecksum: checksum >>> 0,
    coordinateChecksum: coordinateChecksum >>> 0,
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
    normalizedBounds: p.normalizedBounds,
    guardNormalized: p.guardNormalized,
    terrain3dImportSize: p.terrain3dImportSize,
    terrain3dRegionSize: p.terrain3dRegionSize,
    heights: [], waterConfidence: [], colorR: [], colorG: [], colorB: [], roughness: [],
  };
  let checksum = 2166136261;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sample = sampleG60BiomeSourcePoint(x, y);
      const values = [sample.heightMeters, sample.waterConfidence, sample.color[0], sample.color[1], sample.color[2], sample.roughness];
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
  for (const channel of ['heights', 'waterConfidence', 'colorR', 'colorG', 'colorB', 'roughness']) Object.freeze(payload[channel]);
  return Object.freeze(payload);
}
