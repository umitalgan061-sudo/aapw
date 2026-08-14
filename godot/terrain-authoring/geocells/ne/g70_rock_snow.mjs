/**
 * Şafak Kartalı / NE GeoCell G70 — Rock/Snow through pinned Terrain3D.
 *
 * G70 is canonical 96/96 open sea. Rock/Snow is a terrestrial surface layer,
 * therefore the merged Hydrology water mask is a hard semantic gate: neither
 * northern latitude nor cold-biome influence may paint rock or snow over sea.
 * GeoCell bounds remain addressing only; Relief height is preserved verbatim.
 */
import { g70GuardBounds, sampleG70Hydrology } from './g70_hydrology.mjs';
import { sampleG70Biome } from './g70_biome.mjs';
import {
  G70_TERRAIN3D_RELIEF_POLICY,
  measureG70Terrain3DRelief,
  sampleG70Relief,
} from './g70_relief.mjs';

export const G70_TERRAIN3D_ROCK_SNOW_POLICY = Object.freeze({
  id: 'safak-kartali-g70-terrain3d-rock-snow-2026-08-14-v1',
  sourceMapSha256: G70_TERRAIN3D_RELIEF_POLICY.sourceMapSha256,
  reliefPolicyId: G70_TERRAIN3D_RELIEF_POLICY.id,
  geoCell: 'G70', gx: 7, gy: 0, layer: 'Rock/Snow',
  normalizedBounds: G70_TERRAIN3D_RELIEF_POLICY.normalizedBounds,
  guardBandNormalized: G70_TERRAIN3D_RELIEF_POLICY.guardBandNormalized,
  sourceGridSize: 65,
  terrain3dImportSize: 257,
  terrain3dRegionSize: 256,
  baseTextureId: 0,
  rockTextureId: 1,
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

export function sampleG70RockSnow(nx, ny) {
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) throw new TypeError('normalized coordinates must be finite');
  const hydrology = sampleG70Hydrology(nx, ny);
  const biome = sampleG70Biome(nx, ny);
  const relief = sampleG70Relief(nx, ny);
  if (!hydrology.water || hydrology.body !== 'sea' || biome.body !== 'sea' || relief.body !== 'sea') {
    throw new Error(`G70 Rock/Snow cannot author terrestrial semantics at ${nx},${ny}`);
  }
  if (Math.abs(relief.heightMeters - hydrology.heightMeters) > 1e-9) {
    throw new Error(`G70 Rock/Snow lost Relief/Hydrology height provenance at ${nx},${ny}`);
  }
  // Water is the semantic authority. Latitude/climate are intentionally not
  // evaluated after this gate: a cold ocean is still not snow-covered land.
  return Object.freeze({
    body: 'sea', water: true, landFactor: 0,
    heightMeters: relief.heightMeters,
    normal: relief.normal,
    rockWeight: 0,
    snowWeight: 0,
    terrestrialSurfaceMass: 0,
    controlBlend: 0,
  });
}

export function measureG70Terrain3DRockSnow() {
  const p = G70_TERRAIN3D_ROCK_SNOW_POLICY;
  const bounds = g70GuardBounds();
  const core = p.normalizedBounds;
  const size = p.sourceGridSize;
  const relief = measureG70Terrain3DRelief();
  let canonicalWater = 0;
  let canonicalLand = 0;
  for (let y = 0; y < 8; y += 1) for (let x = 84; x < 96; x += 1) {
    const sample = sampleG70RockSnow((x + 0.5) / 96, (y + 0.5) / 64);
    if (sample.water) canonicalWater += 1; else canonicalLand += 1;
  }
  let maxRockWeight = 0, maxSnowWeight = 0, maxTerrestrialSurfaceMass = 0;
  let maxHeightMismatch = 0, maxAdjacentBlendStep = 0, maxGuardBlendDelta = 0;
  let nonSeaSamples = 0, checksum = 2166136261;
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const ny = lerp(bounds.yMin, bounds.yMax, y / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = lerp(bounds.xMin, bounds.xMax, x / (size - 1));
      const s = sampleG70RockSnow(nx, ny);
      if (s.body !== 'sea') nonSeaSamples += 1;
      maxRockWeight = Math.max(maxRockWeight, Math.abs(s.rockWeight));
      maxSnowWeight = Math.max(maxSnowWeight, Math.abs(s.snowWeight));
      maxTerrestrialSurfaceMass = Math.max(maxTerrestrialSurfaceMass, Math.abs(s.terrestrialSurfaceMass));
      maxHeightMismatch = Math.max(maxHeightMismatch, Math.abs(s.heightMeters - sampleG70Relief(nx, ny).heightMeters));
      checksum = hashQuantized(hashQuantized(hashQuantized(checksum, s.heightMeters), s.rockWeight), s.snowWeight);
      row.push(s.controlBlend);
      if (x) maxAdjacentBlendStep = Math.max(maxAdjacentBlendStep, Math.abs(row[x] - row[x - 1]));
      if (y) maxAdjacentBlendStep = Math.max(maxAdjacentBlendStep, Math.abs(row[x] - rows[y - 1][x]));
    }
    rows.push(row);
  }
  const g = p.guardBandNormalized;
  for (let i = 0; i < size; i += 1) {
    const t = i / (size - 1);
    const nx = lerp(core.xMin, core.xMax, t);
    const ny = lerp(core.yMin, core.yMax, t);
    const pairs = [
      [core.xMin, ny, core.xMin - g, ny],
      [nx, core.yMax, nx, core.yMax + g],
    ];
    for (const [ax, ay, bx, by] of pairs) maxGuardBlendDelta = Math.max(
      maxGuardBlendDelta,
      Math.abs(sampleG70RockSnow(ax, ay).controlBlend - sampleG70RockSnow(bx, by).controlBlend),
    );
  }
  return Object.freeze({
    policyId: p.id, sourceMapSha256: p.sourceMapSha256, reliefPolicyId: p.reliefPolicyId,
    geoCell: p.geoCell, layer: p.layer,
    canonicalWater, canonicalLand, sourceSamples: size * size, nonSeaSamples,
    terrain3dImportSize: p.terrain3dImportSize, terrain3dRegionSize: p.terrain3dRegionSize,
    reliefMinHeight: relief.minHeight, reliefMaxHeight: relief.maxHeight,
    maxRockWeight, maxSnowWeight, maxTerrestrialSurfaceMass, maxHeightMismatch,
    maxAdjacentBlendStep, maxGuardBlendDelta, surfaceChecksum: checksum >>> 0,
  });
}

export function buildG70Terrain3DRockSnowProbe() {
  const p = G70_TERRAIN3D_ROCK_SNOW_POLICY;
  const bounds = g70GuardBounds();
  const rows = [];
  for (let y = 0; y < p.sourceGridSize; y += 1) {
    const ny = lerp(bounds.yMin, bounds.yMax, y / (p.sourceGridSize - 1));
    const row = [];
    for (let x = 0; x < p.sourceGridSize; x += 1) {
      const nx = lerp(bounds.xMin, bounds.xMax, x / (p.sourceGridSize - 1));
      const s = sampleG70RockSnow(nx, ny);
      row.push([0, 0, 0, Number(s.heightMeters.toFixed(6)), 0]);
    }
    rows.push(row);
  }
  return Object.freeze({
    schema: 'westeros-g70-terrain3d-rock-snow-probe-v1',
    policyId: p.id, sourceMapSha256: p.sourceMapSha256, reliefPolicyId: p.reliefPolicyId,
    geoCell: p.geoCell, layer: p.layer, sourceGridSize: p.sourceGridSize,
    terrain3dImportSize: p.terrain3dImportSize, terrain3dRegionSize: p.terrain3dRegionSize,
    baseTextureId: p.baseTextureId, rockTextureId: p.rockTextureId, rows,
  });
}
