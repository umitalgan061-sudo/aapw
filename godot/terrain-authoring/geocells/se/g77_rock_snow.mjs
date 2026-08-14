/** Kızıl Ufuk / SE G77 Rock/Snow. GeoCell bounds are addressing only. */
import { REFERENCE_BIOME_ZONES, sampleReferenceInfluence } from '../../../../src/3d/world/worldReferenceMap.js';
import { G77_RELIEF_POLICY, sampleG77ReliefHeight, sampleG77ReliefNormal } from './g77_relief.mjs';
import { sampleG77WaterConfidence } from './g77_hydrology.mjs';

export const G77_ROCK_SNOW_POLICY = Object.freeze({
  id: 'kizil-ufuk-g77-terrain3d-rock-snow-2026-08-14-v5',
  sourceMapSha256: G77_RELIEF_POLICY.sourceMapSha256,
  geoCell: 'G77', gx: 7, gy: 7, layer: 'Rock/Snow',
  normalizedBounds: G77_RELIEF_POLICY.normalizedBounds,
  maskBounds: G77_RELIEF_POLICY.maskBounds,
  sourceGridSize: 65,
  terrain3dRegionSize: 256,
  terrain3dImportSize: 257,
  groundTextureId: 0,
  rockTextureId: 1,
  snowTextureId: 2,
  landFadeStart: 0.0,
  landFadeEnd: 0.5,
  guardBandNormalized: 1 / 1536,
});

const ROCK_ZONES = REFERENCE_BIOME_ZONES.filter((zone) =>
  zone.kind === 'mountain' || zone.kind === 'rocky-hills' || zone.kind === 'desert' || zone.kind === 'arid',
);
const COLD_ZONES = REFERENCE_BIOME_ZONES.filter((zone) =>
  zone.id === 'lands-always-winter' || zone.id === 'north' || zone.kind === 'snow' || zone.kind === 'tundra',
);

const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
function smoothstep(a, b, v) {
  if (b <= a) return v >= b ? 1 : 0;
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}
function strongestInfluence(zones, nx, ny) {
  let strongest = 0;
  for (const zone of zones) strongest = Math.max(strongest, sampleReferenceInfluence(nx, ny, zone));
  return strongest;
}
function reliefSlope(normal) {
  return clamp(Math.hypot(normal.x, normal.z) / Math.max(0.000001, normal.y));
}
function continuousLandFactor(water) {
  // The semantic 96x64 mask is never emitted as a material grid. Use the full bilinear
  // confidence interval directly so a single dense sample cannot inherit the steeper
  // derivative of nested smoothstep attenuation. This remains continuous and reaches
  // exactly zero at the canonical water threshold without moving that threshold.
  return clamp((G77_ROCK_SNOW_POLICY.landFadeEnd - water)
    / (G77_ROCK_SNOW_POLICY.landFadeEnd - G77_ROCK_SNOW_POLICY.landFadeStart));
}

export function sampleG77RockSnow(nx, ny) {
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) throw new TypeError('normalized coordinates must be finite');
  const water = sampleG77WaterConfidence(nx, ny);
  const landFactor = continuousLandFactor(water);
  const height = sampleG77ReliefHeight(nx, ny);
  const normal = sampleG77ReliefNormal(nx, ny);
  const slope = reliefSlope(normal);
  const rockClimate = strongestInfluence(ROCK_ZONES, nx, ny);
  const coldClimate = strongestInfluence(COLD_ZONES, nx, ny);
  const elevationSignal = smoothstep(8, 60, height);
  const slopeSignal = smoothstep(0.035, 0.30, slope);
  const coastExposure = smoothstep(0.20, 0.46, water) * landFactor;

  const rockBlend = landFactor * clamp(
    0.08 + 0.44 * rockClimate + 0.30 * slopeSignal + 0.12 * elevationSignal + 0.06 * coastExposure,
  );
  const snowWeight = landFactor
    * smoothstep(0.38, 0.88, coldClimate)
    * smoothstep(30, 82, height)
    * (0.60 + 0.40 * smoothstep(0.03, 0.22, slope));
  const rockWeight = rockBlend * (1 - snowWeight);
  const groundWeight = landFactor * (1 - rockBlend) * (1 - snowWeight);

  return Object.freeze({ waterConfidence: water, landFactor, height, slope, rockClimate, coldClimate,
    elevationSignal, slopeSignal, coastExposure, rockBlend, rockWeight, snowWeight, groundWeight });
}

function fnv1a(sum, value) { return Math.imul((sum ^ (value & 0xff)) >>> 0, 16777619) >>> 0; }

export function measureG77RockSnow() {
  const b = G77_ROCK_SNOW_POLICY.normalizedBounds;
  const size = G77_ROCK_SNOW_POLICY.sourceGridSize;
  const rows = [];
  let minRockBlend = Infinity, maxRockBlend = -Infinity, maxSnowWeight = 0;
  let fractionalRockSamples = 0, rockDominantSamples = 0, maxAdjacentRockStep = 0;
  let maxGuardBandRockDelta = 0, maxGuardBandSnowDelta = 0, checksum = 2166136261;

  for (let y = 0; y < size; y += 1) {
    const ny = b.yMin + (b.yMax - b.yMin) * (y / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = b.xMin + (b.xMax - b.xMin) * (x / (size - 1));
      const s = sampleG77RockSnow(nx, ny);
      minRockBlend = Math.min(minRockBlend, s.rockBlend);
      maxRockBlend = Math.max(maxRockBlend, s.rockBlend);
      maxSnowWeight = Math.max(maxSnowWeight, s.snowWeight);
      if (s.rockBlend > 0.001 && s.rockBlend < 0.999) fractionalRockSamples += 1;
      if (s.rockWeight > s.groundWeight) rockDominantSamples += 1;
      checksum = fnv1a(checksum, Math.round(s.rockBlend * 255));
      checksum = fnv1a(checksum, Math.round(s.snowWeight * 255));
      row.push(s);
    }
    rows.push(row);
  }
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const blend = rows[y][x].rockBlend;
    if (x + 1 < size) maxAdjacentRockStep = Math.max(maxAdjacentRockStep, Math.abs(blend - rows[y][x + 1].rockBlend));
    if (y + 1 < size) maxAdjacentRockStep = Math.max(maxAdjacentRockStep, Math.abs(blend - rows[y + 1][x].rockBlend));
  }

  const g = G77_ROCK_SNOW_POLICY.guardBandNormalized;
  for (let i = 0; i < size; i += 1) {
    const nx = b.xMin + (b.xMax - b.xMin) * (i / (size - 1));
    const ny = b.yMin + (b.yMax - b.yMin) * (i / (size - 1));
    const pairs = [[nx, b.yMin, nx, b.yMin - g], [b.xMin, ny, b.xMin - g, ny]];
    for (const [ax, ay, bx, by] of pairs) {
      const a = sampleG77RockSnow(ax, ay), c = sampleG77RockSnow(bx, by);
      maxGuardBandRockDelta = Math.max(maxGuardBandRockDelta, Math.abs(a.rockBlend - c.rockBlend));
      maxGuardBandSnowDelta = Math.max(maxGuardBandSnowDelta, Math.abs(a.snowWeight - c.snowWeight));
    }
  }

  let canonicalWaterCells = 0, canonicalLandCells = 0, maxCanonicalWaterSurfaceLeak = 0;
  const m = G77_ROCK_SNOW_POLICY.maskBounds;
  for (let y = m.yMin; y <= m.yMax; y += 1) for (let x = m.xMin; x <= m.xMax; x += 1) {
    const s = sampleG77RockSnow((x + 0.5) / 96, (y + 0.5) / 64);
    if (s.waterConfidence >= 0.5) {
      canonicalWaterCells += 1;
      maxCanonicalWaterSurfaceLeak = Math.max(maxCanonicalWaterSurfaceLeak, s.rockWeight + s.snowWeight);
    } else canonicalLandCells += 1;
  }

  return Object.freeze({ policyId: G77_ROCK_SNOW_POLICY.id, sourceMapSha256: G77_ROCK_SNOW_POLICY.sourceMapSha256,
    geoCell: 'G77', layer: G77_ROCK_SNOW_POLICY.layer, sourceGridSize: size, sourceSamples: size * size,
    terrain3dRegionSize: G77_ROCK_SNOW_POLICY.terrain3dRegionSize, terrain3dImportSize: G77_ROCK_SNOW_POLICY.terrain3dImportSize,
    canonicalWaterCells, canonicalLandCells, fractionalRockSamples, rockDominantSamples,
    minRockBlend: Number(minRockBlend.toFixed(8)), maxRockBlend: Number(maxRockBlend.toFixed(8)),
    rockBlendSpan: Number((maxRockBlend - minRockBlend).toFixed(8)), maxSnowWeight: Number(maxSnowWeight.toFixed(8)),
    maxAdjacentRockStep: Number(maxAdjacentRockStep.toFixed(8)), maxGuardBandRockDelta: Number(maxGuardBandRockDelta.toFixed(8)),
    maxGuardBandSnowDelta: Number(maxGuardBandSnowDelta.toFixed(8)), maxCanonicalWaterSurfaceLeak: Number(maxCanonicalWaterSurfaceLeak.toFixed(8)),
    surfaceChecksum: checksum });
}

export function buildG77RockSnowProbe() {
  const b = G77_ROCK_SNOW_POLICY.normalizedBounds, size = G77_ROCK_SNOW_POLICY.sourceGridSize, rows = [];
  for (let y = 0; y < size; y += 1) {
    const ny = b.yMin + (b.yMax - b.yMin) * (y / (size - 1)), row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = b.xMin + (b.xMax - b.xMin) * (x / (size - 1)), s = sampleG77RockSnow(nx, ny);
      row.push([Number(s.groundWeight.toFixed(8)), Number(s.rockWeight.toFixed(8)), Number(s.snowWeight.toFixed(8)),
        Number(s.rockBlend.toFixed(8)), Number(s.height.toFixed(6)), Number(s.slope.toFixed(8))]);
    }
    rows.push(row);
  }
  return Object.freeze({ policyId: G77_ROCK_SNOW_POLICY.id, sourceMapSha256: G77_ROCK_SNOW_POLICY.sourceMapSha256,
    geoCell: 'G77', layer: G77_ROCK_SNOW_POLICY.layer, sourceGridSize: size,
    terrain3dRegionSize: G77_ROCK_SNOW_POLICY.terrain3dRegionSize, terrain3dImportSize: G77_ROCK_SNOW_POLICY.terrain3dImportSize,
    groundTextureId: G77_ROCK_SNOW_POLICY.groundTextureId, rockTextureId: G77_ROCK_SNOW_POLICY.rockTextureId,
    snowTextureId: G77_ROCK_SNOW_POLICY.snowTextureId, rows });
}
