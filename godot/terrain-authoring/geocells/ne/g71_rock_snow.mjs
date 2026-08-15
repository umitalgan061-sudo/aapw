/**
 * Şafak Kartalı / NE GeoCell G71 — Rock/Snow through pinned Terrain3D.
 *
 * G71 is canonical 96/96 open sea. Rock/Snow is terrestrial surface semantics,
 * so merged Hydrology/Relief remain the hard gate: no rock, snow, island shelf,
 * or GeoCell-shaped control patch may be authored over this ocean parcel.
 */
import { measureG71Hydrology } from './g71_hydrology.mjs';
import {
  G71_TERRAIN3D_BIOME_POLICY,
  g71BiomeNormalizedFromSource,
  measureG71NeighborSeaHalo,
  measureG71Terrain3DBiome,
  sampleG71Biome,
} from './g71_biome.mjs';
import {
  G71_TERRAIN3D_RELIEF_POLICY,
  g71ReliefGuardBounds,
  measureG71Terrain3DRelief,
  sampleG71Relief,
} from './g71_relief.mjs';

export const G71_TERRAIN3D_ROCK_SNOW_POLICY = Object.freeze({
  id: 'safak-kartali-g71-terrain3d-rock-snow-2026-08-15-v1',
  sourceMapSha256: G71_TERRAIN3D_RELIEF_POLICY.sourceMapSha256,
  reliefPolicyId: G71_TERRAIN3D_RELIEF_POLICY.id,
  biomePolicyId: G71_TERRAIN3D_BIOME_POLICY.id,
  geoCell: 'G71', gx: 7, gy: 1, layer: 'Rock/Snow',
  normalizedBounds: G71_TERRAIN3D_RELIEF_POLICY.normalizedBounds,
  guardNormalized: G71_TERRAIN3D_RELIEF_POLICY.guardNormalized,
  sourceGridSize: 65,
  denseEnvelopeSize: 129,
  terrain3dImportSize: 257,
  terrain3dRegionSize: 256,
  baseTextureId: 0,
  overlayTextureId: 1,
  syntheticRockWeight: 0,
  syntheticSnowWeight: 0,
  eastWorldBoundaryX: 1,
  eastGuardAllowed: false,
});

const lerp = (a, b, t) => a + (b - a) * t;
function hashByte(checksum, value) {
  return Math.imul((checksum ^ (value & 0xff)) >>> 0, 16777619) >>> 0;
}
function hashNumber(checksum, value) {
  const q = Math.round(value * 1e6) | 0;
  let out = checksum;
  for (const shift of [0, 8, 16, 24]) out = hashByte(out, q >>> shift);
  return out >>> 0;
}

export function sampleG71RockSnow(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
    throw new TypeError('G71 Rock/Snow coordinates must be finite');
  }
  const relief = sampleG71Relief(normalizedX, normalizedY);
  const biome = sampleG71Biome(normalizedX, normalizedY);
  if (!relief.water || relief.body !== 'sea' || !biome.water || biome.body !== 'sea') {
    throw new Error(`G71 Rock/Snow cannot author terrestrial semantics at ${normalizedX},${normalizedY}`);
  }
  if (Math.abs(relief.heightMeters - biome.heightMeters) > 1e-9) {
    throw new Error(`G71 Rock/Snow lost Relief/Biome height provenance at ${normalizedX},${normalizedY}`);
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

export function measureG71Terrain3DRockSnow() {
  const p = G71_TERRAIN3D_ROCK_SNOW_POLICY;
  const hydrology = measureG71Hydrology();
  const biome = measureG71Terrain3DBiome();
  const relief = measureG71Terrain3DRelief();
  const halo = measureG71NeighborSeaHalo();
  const guard = g71ReliefGuardBounds();
  const rows = [];
  let nonSeaSamples = 0;
  let maxRockWeight = 0, maxSnowWeight = 0, maxTerrestrialSurfaceMass = 0;
  let maxHeightMismatch = 0, maxColorMismatch = 0, maxRoughnessMismatch = 0;
  let maxAdjacentBlendStep = 0, maxGuardBlendDelta = 0, guardPairs = 0;
  let checksum = 2166136261;

  for (let y = 0; y < p.sourceGridSize; y += 1) {
    const ny = lerp(guard.yMin, guard.yMax, y / (p.sourceGridSize - 1));
    const row = [];
    for (let x = 0; x < p.sourceGridSize; x += 1) {
      const nx = lerp(guard.xMin, guard.xMax, x / (p.sourceGridSize - 1));
      const sample = sampleG71RockSnow(nx, ny);
      const priorRelief = sampleG71Relief(nx, ny);
      const priorBiome = sampleG71Biome(nx, ny);
      if (sample.body !== 'sea') nonSeaSamples += 1;
      maxRockWeight = Math.max(maxRockWeight, Math.abs(sample.rockWeight));
      maxSnowWeight = Math.max(maxSnowWeight, Math.abs(sample.snowWeight));
      maxTerrestrialSurfaceMass = Math.max(maxTerrestrialSurfaceMass, Math.abs(sample.terrestrialSurfaceMass));
      maxHeightMismatch = Math.max(maxHeightMismatch, Math.abs(sample.heightMeters - priorRelief.heightMeters));
      maxColorMismatch = Math.max(maxColorMismatch, ...sample.color.map((v, i) => Math.abs(v - priorBiome.color[i])));
      maxRoughnessMismatch = Math.max(maxRoughnessMismatch, Math.abs(sample.roughness - priorBiome.roughness));
      for (const value of [sample.heightMeters, sample.rockWeight, sample.snowWeight, ...sample.color, sample.roughness]) {
        checksum = hashNumber(checksum, value);
      }
      row.push(sample.controlBlend);
      if (x) maxAdjacentBlendStep = Math.max(maxAdjacentBlendStep, Math.abs(row[x] - row[x - 1]));
      if (y) maxAdjacentBlendStep = Math.max(maxAdjacentBlendStep, Math.abs(row[x] - rows[y - 1][x]));
    }
    rows.push(row);
  }

  const core = p.normalizedBounds;
  const g = p.guardNormalized;
  for (let i = 0; i < p.sourceGridSize; i += 1) {
    const t = i / (p.sourceGridSize - 1);
    const nx = lerp(core.xMin, core.xMax, t);
    const ny = lerp(core.yMin, core.yMax, t);
    for (const [ax, ay, bx, by] of [
      [core.xMin, ny, core.xMin - g, ny],
      [nx, core.yMin, nx, core.yMin - g],
      [nx, core.yMax, nx, core.yMax + g],
    ]) {
      maxGuardBlendDelta = Math.max(maxGuardBlendDelta, Math.abs(
        sampleG71RockSnow(ax, ay).controlBlend - sampleG71RockSnow(bx, by).controlBlend,
      ));
      guardPairs += 1;
    }
  }

  return Object.freeze({
    policyId: p.id, sourceMapSha256: p.sourceMapSha256,
    reliefPolicyId: p.reliefPolicyId, biomePolicyId: p.biomePolicyId,
    geoCell: p.geoCell, layer: p.layer,
    canonicalWater: hydrology.waterCells, canonicalLand: hydrology.landCells,
    canonicalSea: hydrology.seaCells, canonicalLake: hydrology.lakeCells,
    boundaryEdges: hydrology.boundaryEdges, priorBiomeCanonicalSea: biome.canonicalSea,
    haloSamples: halo.samples, haloNonSeaSamples: halo.nonSeaSamples,
    sourceSamples: p.sourceGridSize ** 2, nonSeaSamples,
    reliefMinHeight: relief.minHeight, reliefMaxHeight: relief.maxHeight,
    maxRockWeight, maxSnowWeight, maxTerrestrialSurfaceMass,
    maxHeightMismatch, maxColorMismatch, maxRoughnessMismatch,
    maxAdjacentBlendStep, maxGuardBlendDelta, guardPairs,
    eastWorldBoundaryX: p.eastWorldBoundaryX, eastGuardAllowed: p.eastGuardAllowed,
    surfaceChecksum: checksum >>> 0,
  });
}

export function buildG71Terrain3DRockSnowProbe() {
  const p = G71_TERRAIN3D_ROCK_SNOW_POLICY;
  const rows = [];
  for (let y = 0; y < p.sourceGridSize; y += 1) {
    const row = [];
    for (let x = 0; x < p.sourceGridSize; x += 1) {
      const c = g71BiomeNormalizedFromSource(x, y);
      const sample = sampleG71RockSnow(c.normalizedX, c.normalizedY);
      row.push([
        0, 0, 0, Number(sample.heightMeters.toFixed(6)), 0,
        Number(sample.color[0].toFixed(6)), Number(sample.color[1].toFixed(6)),
        Number(sample.color[2].toFixed(6)), Number(sample.roughness.toFixed(6)),
      ]);
    }
    rows.push(row);
  }
  return Object.freeze({
    schema: 'westeros-g71-terrain3d-rock-snow-probe-v1',
    policyId: p.id, sourceMapSha256: p.sourceMapSha256,
    reliefPolicyId: p.reliefPolicyId, biomePolicyId: p.biomePolicyId,
    geoCell: p.geoCell, layer: p.layer,
    normalizedBounds: p.normalizedBounds, guardBounds: g71ReliefGuardBounds(),
    sourceGridSize: p.sourceGridSize, terrain3dImportSize: p.terrain3dImportSize,
    terrain3dRegionSize: p.terrain3dRegionSize,
    baseTextureId: p.baseTextureId, overlayTextureId: p.overlayTextureId,
    eastWorldBoundaryX: p.eastWorldBoundaryX, eastGuardAllowed: p.eastGuardAllowed,
    rows,
  });
}
