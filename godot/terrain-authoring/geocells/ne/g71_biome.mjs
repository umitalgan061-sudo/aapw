/**
 * Şafak Kartalı / NE GeoCell G71 — Macro Albedo/Biome through pinned Terrain3D.
 * G71 is canonical open sea. GeoCell coordinates are authoring addresses only;
 * this layer must not invent land, coastline, islands, lakes or visible cell seams.
 */
import { classifyReferenceWaterCell } from '../../../../src/3d/world/worldReferenceWaterMask.js';
import { G71_HYDROLOGY_POLICY, measureG71Hydrology } from './g71_hydrology.mjs';

export const G71_TERRAIN3D_BIOME_POLICY = Object.freeze({
  id: 'safak-kartali-g71-terrain3d-biome-2026-08-15-v1',
  sourceMapSha256: G71_HYDROLOGY_POLICY.sourceMapSha256,
  hydrologyPolicyId: G71_HYDROLOGY_POLICY.id,
  geoCell: 'G71', gx: 7, gy: 1, layer: 'Macro Albedo/Biome',
  normalizedBounds: Object.freeze({ xMin: 7 / 8, xMax: 1, yMin: 1 / 8, yMax: 2 / 8 }),
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
function hashNumber(checksum, value) {
  const q = Math.round(value * 1e6) | 0;
  let out = checksum;
  for (const shift of [0, 8, 16, 24]) out = hashByte(out, q >>> shift);
  return out >>> 0;
}
function assertFinite(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError('G71 biome coordinates must be finite');
}

export function g71BiomeGuardBounds() {
  const p = G71_TERRAIN3D_BIOME_POLICY;
  return Object.freeze({
    xMin: p.normalizedBounds.xMin - p.guardNormalized,
    xMax: 1,
    yMin: p.normalizedBounds.yMin - p.guardNormalized,
    yMax: p.normalizedBounds.yMax + p.guardNormalized,
  });
}

export function g71BiomeOwnerCoordinates(normalizedX, normalizedY, { allowGuard = true } = {}) {
  assertFinite(normalizedX, normalizedY);
  const p = G71_TERRAIN3D_BIOME_POLICY;
  const core = p.normalizedBounds;
  const allowed = allowGuard ? g71BiomeGuardBounds() : core;
  if (normalizedX < allowed.xMin || normalizedX > allowed.xMax || normalizedY < allowed.yMin || normalizedY > allowed.yMax) {
    throw new RangeError('G71 biome coordinate is outside the qualified owner/guard envelope');
  }
  const u = (normalizedX - core.xMin) / (core.xMax - core.xMin);
  const v = (normalizedY - core.yMin) / (core.yMax - core.yMin);
  const insideOwner = normalizedX >= core.xMin && normalizedX <= core.xMax && normalizedY >= core.yMin && normalizedY <= core.yMax;
  return Object.freeze({ normalizedX, normalizedY, u, v, clampedU: Math.max(0, Math.min(1, u)), clampedV: Math.max(0, Math.min(1, v)), insideOwner, insideGuard: !insideOwner });
}

export function g71BiomeNormalizedFromSource(sourceX, sourceY) {
  const p = G71_TERRAIN3D_BIOME_POLICY;
  if (!Number.isInteger(sourceX) || !Number.isInteger(sourceY)) throw new TypeError('G71 source coordinates must be integers');
  if (sourceX < 0 || sourceX >= p.sourceGridSize || sourceY < 0 || sourceY >= p.sourceGridSize) throw new RangeError('G71 source coordinate outside 65x65 grid');
  const u = sourceX / (p.sourceGridSize - 1);
  const v = sourceY / (p.sourceGridSize - 1);
  const b = p.normalizedBounds;
  return Object.freeze({ sourceX, sourceY, u, v, normalizedX: b.xMin + (b.xMax - b.xMin) * u, normalizedY: b.yMin + (b.yMax - b.yMin) * v, linearIndex: sourceY * p.sourceGridSize + sourceX });
}

export function sampleG71Biome(normalizedX, normalizedY) {
  g71BiomeOwnerCoordinates(normalizedX, normalizedY);
  const p = G71_TERRAIN3D_BIOME_POLICY;
  return Object.freeze({ body: 'sea', water: true, waterConfidence: 1, heightMeters: p.heightMeters, color: p.color, roughness: p.roughness, dominantId: 'open-sea-floor' });
}

export function measureG71NeighborSeaHalo() {
  const probes = [];
  for (let y = 8; y < 16; y += 1) probes.push([83, y, 'west']);
  for (let x = 84; x < 96; x += 1) probes.push([x, 7, 'north'], [x, 16, 'south']);
  const nonSea = probes.filter(([x, y]) => classifyReferenceWaterCell(x, y) !== 'sea');
  return Object.freeze({ samples: probes.length, nonSeaSamples: nonSea.length, sides: Object.freeze(['west', 'north', 'south']) });
}

export function measureG71Terrain3DBiome() {
  const hydrology = measureG71Hydrology();
  const halo = measureG71NeighborSeaHalo();
  const p = G71_TERRAIN3D_BIOME_POLICY;
  let checksum = 2166136261;
  let coordinateChecksum = 2166136261;
  let nonSeaSamples = 0;
  let maxCoordinateRoundTripError = 0;
  for (let y = 0; y < p.sourceGridSize; y += 1) for (let x = 0; x < p.sourceGridSize; x += 1) {
    const c = g71BiomeNormalizedFromSource(x, y);
    const owner = g71BiomeOwnerCoordinates(c.normalizedX, c.normalizedY, { allowGuard: false });
    const sample = sampleG71Biome(c.normalizedX, c.normalizedY);
    if (sample.body !== 'sea') nonSeaSamples += 1;
    for (const value of [sample.heightMeters, sample.waterConfidence, ...sample.color, sample.roughness]) checksum = hashNumber(checksum, value);
    for (const value of [c.normalizedX, c.normalizedY, owner.u, owner.v]) coordinateChecksum = hashNumber(coordinateChecksum, value);
    maxCoordinateRoundTripError = Math.max(maxCoordinateRoundTripError, Math.abs(owner.u - c.u), Math.abs(owner.v - c.v));
  }
  return Object.freeze({ policyId: p.id, geoCell: p.geoCell, layer: p.layer, canonicalWater: hydrology.waterCells, canonicalLand: hydrology.landCells, canonicalSea: hydrology.seaCells, canonicalLake: hydrology.lakeCells, boundaryEdges: hydrology.boundaryEdges, samples: p.sourceGridSize ** 2, nonSeaSamples, haloSamples: halo.samples, haloNonSeaSamples: halo.nonSeaSamples, maxAdjacentColorDelta: 0, maxAdjacentRoughnessDelta: 0, maxCoordinateRoundTripError, sourceChecksum: checksum >>> 0, coordinateChecksum: coordinateChecksum >>> 0 });
}

export function buildG71Terrain3DBiomeSource() {
  const p = G71_TERRAIN3D_BIOME_POLICY;
  const payload = { schema: 'westeros-g71-terrain3d-biome-source-v1', policyId: p.id, hydrologyPolicyId: p.hydrologyPolicyId, sourceMapSha256: p.sourceMapSha256, geoCell: p.geoCell, layer: p.layer, width: p.sourceGridSize, height: p.sourceGridSize, normalizedBounds: p.normalizedBounds, guardBounds: g71BiomeGuardBounds(), terrain3dImportSize: p.terrain3dImportSize, terrain3dRegionSize: p.terrain3dRegionSize, heights: [], waterConfidence: [], colorR: [], colorG: [], colorB: [], roughness: [] };
  let checksum = 2166136261;
  for (let y = 0; y < p.sourceGridSize; y += 1) for (let x = 0; x < p.sourceGridSize; x += 1) {
    const c = g71BiomeNormalizedFromSource(x, y);
    const s = sampleG71Biome(c.normalizedX, c.normalizedY);
    const values = [s.heightMeters, s.waterConfidence, ...s.color, s.roughness];
    payload.heights.push(values[0]); payload.waterConfidence.push(values[1]); payload.colorR.push(values[2]); payload.colorG.push(values[3]); payload.colorB.push(values[4]); payload.roughness.push(values[5]);
    for (const value of values) checksum = hashNumber(checksum, value);
  }
  payload.sourceChecksum = checksum >>> 0;
  for (const name of ['heights', 'waterConfidence', 'colorR', 'colorG', 'colorB', 'roughness']) Object.freeze(payload[name]);
  return Object.freeze(payload);
}
