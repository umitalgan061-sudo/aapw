/** Kızıl Ufuk / SE G77 Rock/Snow. GeoCell bounds are addressing only. */
import { REFERENCE_BIOME_ZONES, sampleReferenceInfluence } from '../../../../src/3d/world/worldReferenceMap.js';
import { G77_RELIEF_POLICY, sampleG77ReliefHeight, sampleG77ReliefNormal } from './g77_relief.mjs';
import { sampleG77WaterConfidence } from './g77_hydrology.mjs';

export const G77_ROCK_SNOW_POLICY = Object.freeze({
  id: 'kizil-ufuk-g77-terrain3d-rock-snow-2026-08-14-r9',
  sourceMapSha256: G77_RELIEF_POLICY.sourceMapSha256,
  sourceMapSize: Object.freeze([1536, 1024]),
  sourceMapVersion: 'map.png-r1',
  geoCell: 'G77', gx: 7, gy: 7, layer: 'Rock/Snow',
  normalizedBounds: G77_RELIEF_POLICY.normalizedBounds,
  maskBounds: G77_RELIEF_POLICY.maskBounds,
  sourceGridSize: 65,
  terrain3dRegionSize: 256,
  terrain3dImportSize: 257,
  groundTextureId: 0,
  rockTextureId: 1,
  snowTextureId: 2,
  waterThreshold: 0.5,
  landFadeStart: 0.0,
  landFadeEnd: 0.5,
  guardBandNormalized: 1 / 1536,
  slopeFilterRadiusNormalized: 1 / 1024,
  slopeFilterTaps: 9,
});

const ROCK_ZONES = REFERENCE_BIOME_ZONES.filter((z) => ['mountain', 'rocky-hills', 'desert', 'arid'].includes(z.kind));
const COLD_ZONES = REFERENCE_BIOME_ZONES.filter((z) => z.id === 'lands-always-winter' || z.id === 'north' || ['snow', 'tundra'].includes(z.kind));
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smoothstep = (a, b, v) => { const t = clamp01((v - a) / Math.max(1e-9, b - a)); return t * t * (3 - 2 * t); };

function strongestInfluence(zones, nx, ny) {
  let strongest = 0;
  for (const zone of zones) strongest = Math.max(strongest, sampleReferenceInfluence(nx, ny, zone));
  return strongest;
}

function slopeFromNormal(normal) {
  return clamp01(Math.hypot(normal.x, normal.z) / Math.max(1e-6, normal.y));
}

export function sampleG77RawReliefSlope(nx, ny) {
  return slopeFromNormal(sampleG77ReliefNormal(nx, ny));
}

export function sampleG77FilteredReliefSlope(nx, ny) {
  const r = G77_ROCK_SNOW_POLICY.slopeFilterRadiusNormalized;
  let sum = 0;
  for (const oy of [-r, 0, r]) for (const ox of [-r, 0, r]) sum += sampleG77RawReliefSlope(nx + ox, ny + oy);
  return clamp01(sum / G77_ROCK_SNOW_POLICY.slopeFilterTaps);
}

function landFactorFromWater(water) {
  const p = G77_ROCK_SNOW_POLICY;
  return clamp01((p.landFadeEnd - water) / Math.max(1e-9, p.landFadeEnd - p.landFadeStart));
}

export function buildG77RockSnowControlContract(surface) {
  const rock = clamp01(surface.rockWeight);
  const snow = clamp01(surface.snowWeight);
  const overlayTextureId = snow > rock ? G77_ROCK_SNOW_POLICY.snowTextureId : G77_ROCK_SNOW_POLICY.rockTextureId;
  const overlayBlend = Math.max(rock, snow);
  return Object.freeze({
    baseTextureId: G77_ROCK_SNOW_POLICY.groundTextureId,
    overlayTextureId,
    overlayBlend,
    overlayBlend8: Math.round(overlayBlend * 255),
  });
}

export function sampleG77RockSnow(nx, ny) {
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) throw new TypeError('normalized coordinates must be finite');
  const waterConfidence = sampleG77WaterConfidence(nx, ny);
  const landFactor = landFactorFromWater(waterConfidence);
  const height = sampleG77ReliefHeight(nx, ny);
  const rawSlope = sampleG77RawReliefSlope(nx, ny);
  const slope = sampleG77FilteredReliefSlope(nx, ny);
  const rockClimate = strongestInfluence(ROCK_ZONES, nx, ny);
  const coldClimate = strongestInfluence(COLD_ZONES, nx, ny);
  const elevationSignal = smoothstep(8, 60, height);
  const slopeSignal = smoothstep(0.035, 0.30, slope);
  const coastalExposure = smoothstep(0.18, 0.46, waterConfidence) * landFactor;
  const rockBlend = landFactor * clamp01(0.08 + 0.44 * rockClimate + 0.30 * slopeSignal + 0.12 * elevationSignal + 0.06 * coastalExposure);
  const snowWeight = landFactor * smoothstep(0.38, 0.88, coldClimate) * smoothstep(30, 82, height) * (0.60 + 0.40 * smoothstep(0.03, 0.22, slope));
  const rockWeight = rockBlend * (1 - snowWeight);
  const groundWeight = Math.max(0, landFactor - rockWeight - snowWeight);
  const materialWeight = groundWeight + rockWeight + snowWeight;
  return Object.freeze({
    waterConfidence, landFactor, height, rawSlope, slope,
    slopeFilterDelta: Math.abs(rawSlope - slope),
    rockClimate, coldClimate, elevationSignal, slopeSignal, coastalExposure,
    rockBlend, rockWeight, snowWeight, groundWeight, materialWeight,
  });
}

function fnv1a(sum, value) { return Math.imul((sum ^ (value & 0xff)) >>> 0, 16777619) >>> 0; }

export function measureG77RockSnow() {
  const p = G77_ROCK_SNOW_POLICY, b = p.normalizedBounds, size = p.sourceGridSize, rows = [];
  let checksum = 2166136261;
  let minRockBlend = Infinity, maxRockBlend = -Infinity, maxSnowWeight = 0;
  let fractionalRockSamples = 0, shorelineSamples = 0, deepLandSamples = 0;
  let maxAdjacentRockStep = 0, maxAdjacentSnowStep = 0;
  let maxAdjacentRawSlopeStep = 0, maxAdjacentFilteredSlopeStep = 0;
  let maxGuardRockDelta = 0, maxGuardSnowDelta = 0, maxCanonicalWaterLeak = 0;
  let canonicalWaterCells = 0, canonicalLandCells = 0;
  for (let y = 0; y < size; y += 1) {
    const ny = b.yMin + (b.yMax - b.yMin) * y / (size - 1), row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = b.xMin + (b.xMax - b.xMin) * x / (size - 1), s = sampleG77RockSnow(nx, ny);
      if (![s.rockWeight, s.snowWeight, s.height, s.slope, s.materialWeight].every(Number.isFinite)) throw new Error('non-finite G77 Rock/Snow sample');
      minRockBlend = Math.min(minRockBlend, s.rockBlend); maxRockBlend = Math.max(maxRockBlend, s.rockBlend); maxSnowWeight = Math.max(maxSnowWeight, s.snowWeight);
      if (s.rockBlend > 0.001 && s.rockBlend < 0.999) fractionalRockSamples += 1;
      if (s.waterConfidence > 0.05 && s.waterConfidence < p.waterThreshold) shorelineSamples += 1;
      if (s.waterConfidence <= 0.05) deepLandSamples += 1;
      checksum = fnv1a(checksum, Math.round(s.rockBlend * 255)); checksum = fnv1a(checksum, Math.round(s.snowWeight * 255)); checksum = fnv1a(checksum, Math.round(s.slope * 255));
      row.push(s);
    }
    rows.push(row);
  }
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) for (const [dx, dy] of [[1, 0], [0, 1]]) {
    if (x + dx >= size || y + dy >= size) continue;
    const a = rows[y][x], c = rows[y + dy][x + dx];
    maxAdjacentRockStep = Math.max(maxAdjacentRockStep, Math.abs(a.rockBlend - c.rockBlend));
    maxAdjacentSnowStep = Math.max(maxAdjacentSnowStep, Math.abs(a.snowWeight - c.snowWeight));
    maxAdjacentRawSlopeStep = Math.max(maxAdjacentRawSlopeStep, Math.abs(a.rawSlope - c.rawSlope));
    maxAdjacentFilteredSlopeStep = Math.max(maxAdjacentFilteredSlopeStep, Math.abs(a.slope - c.slope));
  }
  const g = p.guardBandNormalized;
  for (let i = 0; i < size; i += 1) {
    const t = i / (size - 1), x = b.xMin + (b.xMax - b.xMin) * t, y = b.yMin + (b.yMax - b.yMin) * t;
    for (const [a, c] of [[sampleG77RockSnow(b.xMin, y), sampleG77RockSnow(b.xMin - g, y)], [sampleG77RockSnow(x, b.yMin), sampleG77RockSnow(x, b.yMin - g)]]) {
      maxGuardRockDelta = Math.max(maxGuardRockDelta, Math.abs(a.rockBlend - c.rockBlend));
      maxGuardSnowDelta = Math.max(maxGuardSnowDelta, Math.abs(a.snowWeight - c.snowWeight));
    }
  }
  const m = p.maskBounds;
  for (let y = m.yMin; y <= m.yMax; y += 1) for (let x = m.xMin; x <= m.xMax; x += 1) {
    const s = sampleG77RockSnow((x + 0.5) / 96, (y + 0.5) / 64);
    if (s.waterConfidence >= p.waterThreshold) { canonicalWaterCells += 1; maxCanonicalWaterLeak = Math.max(maxCanonicalWaterLeak, s.rockWeight + s.snowWeight); }
    else canonicalLandCells += 1;
  }
  return Object.freeze({ policyId: p.id, sourceMapSha256: p.sourceMapSha256, sourceMapSize: p.sourceMapSize, sourceMapVersion: p.sourceMapVersion, geoCell: p.geoCell, layer: p.layer, sourceGridSize: size, sourceSamples: size * size, terrain3dRegionSize: p.terrain3dRegionSize, terrain3dImportSize: p.terrain3dImportSize, canonicalWaterCells, canonicalLandCells, fractionalRockSamples, shorelineSamples, deepLandSamples, minRockBlend: Number(minRockBlend.toFixed(8)), maxRockBlend: Number(maxRockBlend.toFixed(8)), rockBlendSpan: Number((maxRockBlend - minRockBlend).toFixed(8)), maxSnowWeight: Number(maxSnowWeight.toFixed(8)), maxAdjacentRockStep: Number(maxAdjacentRockStep.toFixed(8)), maxAdjacentSnowStep: Number(maxAdjacentSnowStep.toFixed(8)), maxAdjacentRawSlopeStep: Number(maxAdjacentRawSlopeStep.toFixed(8)), maxAdjacentFilteredSlopeStep: Number(maxAdjacentFilteredSlopeStep.toFixed(8)), maxGuardRockDelta: Number(maxGuardRockDelta.toFixed(8)), maxGuardSnowDelta: Number(maxGuardSnowDelta.toFixed(8)), maxCanonicalWaterLeak: Number(maxCanonicalWaterLeak.toFixed(8)), surfaceChecksum: checksum });
}

export function buildG77RockSnowProbe() {
  const p = G77_ROCK_SNOW_POLICY, b = p.normalizedBounds, rows = [];
  for (let y = 0; y < p.sourceGridSize; y += 1) {
    const row = [], ny = b.yMin + (b.yMax - b.yMin) * y / (p.sourceGridSize - 1);
    for (let x = 0; x < p.sourceGridSize; x += 1) {
      const nx = b.xMin + (b.xMax - b.xMin) * x / (p.sourceGridSize - 1), s = sampleG77RockSnow(nx, ny), c = buildG77RockSnowControlContract(s);
      row.push([Number(s.groundWeight.toFixed(8)), Number(s.rockWeight.toFixed(8)), Number(s.snowWeight.toFixed(8)), Number(s.rockBlend.toFixed(8)), Number(s.height.toFixed(6)), Number(s.slope.toFixed(8)), Number(s.waterConfidence.toFixed(8)), Number(s.landFactor.toFixed(8)), Number(s.rawSlope.toFixed(8)), c.overlayTextureId, c.overlayBlend8]);
    }
    rows.push(row);
  }
  return Object.freeze({ schema: 'westeros-g77-terrain3d-rock-snow-r9', policyId: p.id, sourceMapSha256: p.sourceMapSha256, geoCell: p.geoCell, layer: p.layer, sourceGridSize: p.sourceGridSize, terrain3dRegionSize: p.terrain3dRegionSize, terrain3dImportSize: p.terrain3dImportSize, groundTextureId: p.groundTextureId, rockTextureId: p.rockTextureId, snowTextureId: p.snowTextureId, slopeFilterRadiusNormalized: p.slopeFilterRadiusNormalized, slopeFilterTaps: p.slopeFilterTaps, rows });
}
