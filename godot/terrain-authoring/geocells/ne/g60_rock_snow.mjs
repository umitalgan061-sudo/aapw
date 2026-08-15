/**
 * Şafak Kartalı / NE GeoCell G60 — Rock/Snow through pinned Terrain3D.
 * G60 is canonical 96/96 open sea. Rock/Snow may not invent exposed rock,
 * terrestrial snow, islands, shelves or GeoCell-shaped material patches.
 * Merged Relief height and Macro Biome color/roughness are carried verbatim.
 */
import { measureG60Hydrology } from './g60_hydrology.mjs';
import { G60_TERRAIN3D_BIOME_POLICY, sampleG60Biome } from './g60_biome.mjs';
import {
  G60_TERRAIN3D_RELIEF_POLICY,
  g60ReliefGuardBounds,
  measureG60Terrain3DRelief,
  sampleG60Relief,
} from './g60_relief.mjs';

export const G60_TERRAIN3D_ROCK_SNOW_POLICY = Object.freeze({
  id: 'safak-kartali-g60-terrain3d-rock-snow-2026-08-15-v1',
  sourceMapSha256: G60_TERRAIN3D_RELIEF_POLICY.sourceMapSha256,
  reliefPolicyId: G60_TERRAIN3D_RELIEF_POLICY.id,
  biomePolicyId: G60_TERRAIN3D_BIOME_POLICY.id,
  geoCell: 'G60', gx: 6, gy: 0, layer: 'Rock/Snow',
  normalizedBounds: G60_TERRAIN3D_RELIEF_POLICY.normalizedBounds,
  guardNormalized: G60_TERRAIN3D_RELIEF_POLICY.guardNormalized,
  sourceGridSize: 65,
  denseEnvelopeSize: 193,
  terrain3dImportSize: 257,
  terrain3dRegionSize: 256,
  baseTextureId: 0,
  overlayTextureId: 1,
  syntheticRockWeight: 0,
  syntheticSnowWeight: 0,
});

const lerp = (a, b, t) => a + (b - a) * t;
function hashByte(checksum, value) {
  return Math.imul((checksum ^ (value & 0xff)) >>> 0, 16777619) >>> 0;
}
function hashQuantized(checksum, value, scale = 1000000) {
  const q = Math.round(value * scale) | 0;
  let out = checksum;
  for (const shift of [0, 8, 16, 24]) out = hashByte(out, q >>> shift);
  return out >>> 0;
}

export function sampleG60RockSnow(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
    throw new TypeError('normalized coordinates must be finite');
  }
  const relief = sampleG60Relief(normalizedX, normalizedY);
  const biome = sampleG60Biome(normalizedX, normalizedY);
  if (!relief.water || relief.body !== 'sea' || !biome.water || biome.body !== 'sea') {
    throw new Error(`G60 Rock/Snow cannot author terrestrial semantics at ${normalizedX},${normalizedY}`);
  }
  if (Math.abs(relief.heightMeters - biome.heightMeters) > 1e-9) {
    throw new Error(`G60 Rock/Snow lost Relief/Biome height provenance at ${normalizedX},${normalizedY}`);
  }
  return Object.freeze({
    body: 'sea', water: true, landFactor: 0,
    heightMeters: relief.heightMeters,
    normal: relief.normal,
    rockWeight: 0,
    snowWeight: 0,
    terrestrialSurfaceMass: 0,
    controlBlend: 0,
    color: biome.color,
    roughness: biome.roughness,
  });
}

export function measureG60Terrain3DRockSnow() {
  const p = G60_TERRAIN3D_ROCK_SNOW_POLICY;
  const hydrology = measureG60Hydrology();
  const relief = measureG60Terrain3DRelief();
  const bounds = g60ReliefGuardBounds();
  const core = p.normalizedBounds;
  const size = p.sourceGridSize;
  let nonSeaSamples = 0;
  let maxRockWeight = 0;
  let maxSnowWeight = 0;
  let maxTerrestrialSurfaceMass = 0;
  let maxHeightMismatch = 0;
  let maxColorMismatch = 0;
  let maxRoughnessMismatch = 0;
  let maxAdjacentBlendStep = 0;
  let maxGuardBlendDelta = 0;
  let checksum = 2166136261;
  const rows = [];

  for (let y = 0; y < size; y += 1) {
    const ny = lerp(bounds.yMin, bounds.yMax, y / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = lerp(bounds.xMin, bounds.xMax, x / (size - 1));
      const sample = sampleG60RockSnow(nx, ny);
      const priorRelief = sampleG60Relief(nx, ny);
      const priorBiome = sampleG60Biome(nx, ny);
      if (sample.body !== 'sea') nonSeaSamples += 1;
      maxRockWeight = Math.max(maxRockWeight, Math.abs(sample.rockWeight));
      maxSnowWeight = Math.max(maxSnowWeight, Math.abs(sample.snowWeight));
      maxTerrestrialSurfaceMass = Math.max(maxTerrestrialSurfaceMass, Math.abs(sample.terrestrialSurfaceMass));
      maxHeightMismatch = Math.max(maxHeightMismatch, Math.abs(sample.heightMeters - priorRelief.heightMeters));
      maxColorMismatch = Math.max(
        maxColorMismatch,
        ...sample.color.map((value, index) => Math.abs(value - priorBiome.color[index])),
      );
      maxRoughnessMismatch = Math.max(maxRoughnessMismatch, Math.abs(sample.roughness - priorBiome.roughness));
      for (const value of [sample.heightMeters, sample.rockWeight, sample.snowWeight, ...sample.color, sample.roughness]) {
        checksum = hashQuantized(checksum, value);
      }
      row.push(sample.controlBlend);
      if (x) maxAdjacentBlendStep = Math.max(maxAdjacentBlendStep, Math.abs(row[x] - row[x - 1]));
      if (y) maxAdjacentBlendStep = Math.max(maxAdjacentBlendStep, Math.abs(row[x] - rows[y - 1][x]));
    }
    rows.push(row);
  }

  const g = p.guardNormalized;
  for (let i = 0; i < size; i += 1) {
    const t = i / (size - 1);
    const nx = lerp(core.xMin, core.xMax, t);
    const ny = lerp(core.yMin, core.yMax, t);
    const pairs = [
      [core.xMin, ny, core.xMin - g, ny],
      [core.xMax, ny, core.xMax + g, ny],
      [nx, core.yMax, nx, core.yMax + g],
    ];
    for (const [ax, ay, bx, by] of pairs) {
      maxGuardBlendDelta = Math.max(
        maxGuardBlendDelta,
        Math.abs(sampleG60RockSnow(ax, ay).controlBlend - sampleG60RockSnow(bx, by).controlBlend),
      );
    }
  }

  return Object.freeze({
    policyId: p.id, sourceMapSha256: p.sourceMapSha256,
    reliefPolicyId: p.reliefPolicyId, biomePolicyId: p.biomePolicyId,
    geoCell: p.geoCell, layer: p.layer,
    canonicalWater: hydrology.waterCells, canonicalLand: hydrology.landCells,
    canonicalSea: hydrology.seaCells, canonicalLake: hydrology.lakeCells,
    boundaryEdges: hydrology.boundaryEdges, sourceSamples: size * size, nonSeaSamples,
    reliefMinHeight: relief.minHeight, reliefMaxHeight: relief.maxHeight,
    maxRockWeight, maxSnowWeight, maxTerrestrialSurfaceMass,
    maxHeightMismatch, maxColorMismatch, maxRoughnessMismatch,
    maxAdjacentBlendStep, maxGuardBlendDelta, surfaceChecksum: checksum >>> 0,
  });
}

export function buildG60Terrain3DRockSnowProbe() {
  const p = G60_TERRAIN3D_ROCK_SNOW_POLICY;
  const bounds = p.normalizedBounds;
  const rows = [];
  for (let y = 0; y < p.sourceGridSize; y += 1) {
    const ny = lerp(bounds.yMin, bounds.yMax, y / (p.sourceGridSize - 1));
    const row = [];
    for (let x = 0; x < p.sourceGridSize; x += 1) {
      const nx = lerp(bounds.xMin, bounds.xMax, x / (p.sourceGridSize - 1));
      const sample = sampleG60RockSnow(nx, ny);
      row.push([
        0, 0, 0, Number(sample.heightMeters.toFixed(6)), 0,
        Number(sample.color[0].toFixed(6)), Number(sample.color[1].toFixed(6)),
        Number(sample.color[2].toFixed(6)), Number(sample.roughness.toFixed(6)),
      ]);
    }
    rows.push(row);
  }
  return Object.freeze({
    schema: 'westeros-g60-terrain3d-rock-snow-probe-v1',
    policyId: p.id, sourceMapSha256: p.sourceMapSha256,
    reliefPolicyId: p.reliefPolicyId, biomePolicyId: p.biomePolicyId,
    geoCell: p.geoCell, layer: p.layer, normalizedBounds: p.normalizedBounds,
    guardNormalized: p.guardNormalized, sourceGridSize: p.sourceGridSize,
    terrain3dImportSize: p.terrain3dImportSize, terrain3dRegionSize: p.terrain3dRegionSize,
    baseTextureId: p.baseTextureId, overlayTextureId: p.overlayTextureId, rows,
  });
}
