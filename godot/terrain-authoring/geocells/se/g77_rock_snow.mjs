/** Kızıl Ufuk / SE G77 Rock/Snow. GeoCell bounds are addressing only. */
import { REFERENCE_BIOME_ZONES, sampleReferenceInfluence } from '../../../../src/3d/world/worldReferenceMap.js';
import { G77_RELIEF_POLICY, sampleG77ReliefHeight, sampleG77ReliefNormal } from './g77_relief.mjs';
import { sampleG77WaterConfidence } from './g77_hydrology.mjs';

export const G77_ROCK_SNOW_POLICY = Object.freeze({
  id: 'kizil-ufuk-g77-terrain3d-rock-snow-2026-08-14-v6',
  sourceMapSha256: G77_RELIEF_POLICY.sourceMapSha256,
  geoCell: 'G77',
  gx: 7,
  gy: 7,
  layer: 'Rock/Snow',
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
  slopeFilterRadiusNormalized: 1 / 1024,
  slopeFilterTaps: 9,
  weightEpsilon: 1e-9,
});

const ROCK_ZONES = REFERENCE_BIOME_ZONES.filter((zone) => (
  zone.kind === 'mountain'
  || zone.kind === 'rocky-hills'
  || zone.kind === 'desert'
  || zone.kind === 'arid'
));
const COLD_ZONES = REFERENCE_BIOME_ZONES.filter((zone) => (
  zone.id === 'lands-always-winter'
  || zone.id === 'north'
  || zone.kind === 'snow'
  || zone.kind === 'tundra'
));
const clamp = (value, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, value));

function smoothstep(a, b, value) {
  if (b <= a) return value >= b ? 1 : 0;
  const t = clamp((value - a) / (b - a));
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
  return clamp(
    (G77_ROCK_SNOW_POLICY.landFadeEnd - water)
      / (G77_ROCK_SNOW_POLICY.landFadeEnd - G77_ROCK_SNOW_POLICY.landFadeStart),
  );
}

export function sampleG77RawReliefSlope(nx, ny) {
  return reliefSlope(sampleG77ReliefNormal(nx, ny));
}

/**
 * Material classification must not amplify a one-sample relief derivative into a visible splat
 * discontinuity. A symmetric 3x3 footprint keeps the authored rock response tied to real relief
 * while making it stable at the 257x257 Terrain3D import density.
 */
export function sampleG77FilteredReliefSlope(nx, ny) {
  const r = G77_ROCK_SNOW_POLICY.slopeFilterRadiusNormalized;
  let sum = 0;
  let taps = 0;
  for (const oy of [-r, 0, r]) {
    for (const ox of [-r, 0, r]) {
      sum += sampleG77RawReliefSlope(nx + ox, ny + oy);
      taps += 1;
    }
  }
  return clamp(sum / taps);
}

export function buildG77RockSnowControlContract(surface) {
  if (!surface || typeof surface !== 'object') throw new TypeError('surface contract requires a sample object');
  const rock = clamp(surface.rockWeight);
  const snow = clamp(surface.snowWeight);
  const overlayTextureId = snow > rock
    ? G77_ROCK_SNOW_POLICY.snowTextureId
    : G77_ROCK_SNOW_POLICY.rockTextureId;
  const overlayBlend = Math.max(rock, snow);
  return Object.freeze({
    baseTextureId: G77_ROCK_SNOW_POLICY.groundTextureId,
    overlayTextureId,
    overlayBlend,
    overlayBlend8: Math.round(overlayBlend * 255),
  });
}

export function sampleG77RockSnow(nx, ny) {
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
    throw new TypeError('normalized coordinates must be finite');
  }

  const water = sampleG77WaterConfidence(nx, ny);
  const landFactor = continuousLandFactor(water);
  const height = sampleG77ReliefHeight(nx, ny);
  const rawSlope = sampleG77RawReliefSlope(nx, ny);
  const slope = sampleG77FilteredReliefSlope(nx, ny);
  const rockClimate = strongestInfluence(ROCK_ZONES, nx, ny);
  const coldClimate = strongestInfluence(COLD_ZONES, nx, ny);
  const elevationSignal = smoothstep(8, 60, height);
  const slopeSignal = smoothstep(0.035, 0.30, slope);
  const coastExposure = smoothstep(0.20, 0.46, water) * landFactor;

  const rockBlend = landFactor * clamp(
    0.08
      + 0.44 * rockClimate
      + 0.30 * slopeSignal
      + 0.12 * elevationSignal
      + 0.06 * coastExposure,
  );
  const snowWeight = landFactor
    * smoothstep(0.38, 0.88, coldClimate)
    * smoothstep(30, 82, height)
    * (0.60 + 0.40 * smoothstep(0.03, 0.22, slope));
  const rockWeight = rockBlend * (1 - snowWeight);
  const groundWeight = landFactor * (1 - rockBlend) * (1 - snowWeight);
  const materialWeight = groundWeight + rockWeight + snowWeight;

  return Object.freeze({
    waterConfidence: water,
    landFactor,
    height,
    rawSlope,
    slope,
    slopeFilterDelta: Math.abs(rawSlope - slope),
    rockClimate,
    coldClimate,
    elevationSignal,
    slopeSignal,
    coastExposure,
    rockBlend,
    rockWeight,
    snowWeight,
    groundWeight,
    materialWeight,
  });
}

function fnv1a(sum, value) {
  return Math.imul((sum ^ (value & 0xff)) >>> 0, 16777619) >>> 0;
}

export function measureG77RockSnow() {
  const bounds = G77_ROCK_SNOW_POLICY.normalizedBounds;
  const size = G77_ROCK_SNOW_POLICY.sourceGridSize;
  const rows = [];
  let minRockBlend = Infinity;
  let maxRockBlend = -Infinity;
  let maxSnowWeight = 0;
  let maxRawSlope = 0;
  let maxFilteredSlope = 0;
  let maxSlopeFilterDelta = 0;
  let fractionalRockSamples = 0;
  let rockDominantSamples = 0;
  let shorelineSamples = 0;
  let deepLandSamples = 0;
  let maxAdjacentRockStep = 0;
  let maxAdjacentRawSlopeStep = 0;
  let maxAdjacentFilteredSlopeStep = 0;
  let maxMaterialWeight = 0;
  let minMaterialWeight = Infinity;
  let maxLandWeightOverrun = 0;
  let maxGuardBandRockDelta = 0;
  let maxGuardBandSnowDelta = 0;
  let checksum = 2166136261;

  for (let y = 0; y < size; y += 1) {
    const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * (y / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * (x / (size - 1));
      const surface = sampleG77RockSnow(nx, ny);
      minRockBlend = Math.min(minRockBlend, surface.rockBlend);
      maxRockBlend = Math.max(maxRockBlend, surface.rockBlend);
      maxSnowWeight = Math.max(maxSnowWeight, surface.snowWeight);
      maxRawSlope = Math.max(maxRawSlope, surface.rawSlope);
      maxFilteredSlope = Math.max(maxFilteredSlope, surface.slope);
      maxSlopeFilterDelta = Math.max(maxSlopeFilterDelta, surface.slopeFilterDelta);
      maxMaterialWeight = Math.max(maxMaterialWeight, surface.materialWeight);
      minMaterialWeight = Math.min(minMaterialWeight, surface.materialWeight);
      maxLandWeightOverrun = Math.max(maxLandWeightOverrun, surface.materialWeight - surface.landFactor);
      if (surface.rockBlend > 0.001 && surface.rockBlend < 0.999) fractionalRockSamples += 1;
      if (surface.rockWeight > surface.groundWeight) rockDominantSamples += 1;
      if (surface.waterConfidence > 0.05 && surface.waterConfidence < 0.5) shorelineSamples += 1;
      if (surface.waterConfidence <= 0.05) deepLandSamples += 1;
      checksum = fnv1a(checksum, Math.round(surface.rockBlend * 255));
      checksum = fnv1a(checksum, Math.round(surface.snowWeight * 255));
      checksum = fnv1a(checksum, Math.round(surface.slope * 255));
      row.push(surface);
    }
    rows.push(row);
  }

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const surface = rows[y][x];
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        if (x + dx >= size || y + dy >= size) continue;
        const neighbor = rows[y + dy][x + dx];
        maxAdjacentRockStep = Math.max(maxAdjacentRockStep, Math.abs(surface.rockBlend - neighbor.rockBlend));
        maxAdjacentRawSlopeStep = Math.max(maxAdjacentRawSlopeStep, Math.abs(surface.rawSlope - neighbor.rawSlope));
        maxAdjacentFilteredSlopeStep = Math.max(maxAdjacentFilteredSlopeStep, Math.abs(surface.slope - neighbor.slope));
      }
    }
  }

  const guard = G77_ROCK_SNOW_POLICY.guardBandNormalized;
  for (let i = 0; i < size; i += 1) {
    const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * (i / (size - 1));
    const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * (i / (size - 1));
    for (const [ax, ay, bx, by] of [
      [nx, bounds.yMin, nx, bounds.yMin - guard],
      [bounds.xMin, ny, bounds.xMin - guard, ny],
    ]) {
      const a = sampleG77RockSnow(ax, ay);
      const b = sampleG77RockSnow(bx, by);
      maxGuardBandRockDelta = Math.max(maxGuardBandRockDelta, Math.abs(a.rockBlend - b.rockBlend));
      maxGuardBandSnowDelta = Math.max(maxGuardBandSnowDelta, Math.abs(a.snowWeight - b.snowWeight));
    }
  }

  let canonicalWaterCells = 0;
  let canonicalLandCells = 0;
  let maxCanonicalWaterSurfaceLeak = 0;
  const mask = G77_ROCK_SNOW_POLICY.maskBounds;
  for (let y = mask.yMin; y <= mask.yMax; y += 1) {
    for (let x = mask.xMin; x <= mask.xMax; x += 1) {
      const surface = sampleG77RockSnow((x + 0.5) / 96, (y + 0.5) / 64);
      if (surface.waterConfidence >= 0.5) {
        canonicalWaterCells += 1;
        maxCanonicalWaterSurfaceLeak = Math.max(
          maxCanonicalWaterSurfaceLeak,
          surface.rockWeight + surface.snowWeight,
        );
      } else {
        canonicalLandCells += 1;
      }
    }
  }

  return Object.freeze({
    policyId: G77_ROCK_SNOW_POLICY.id,
    sourceMapSha256: G77_ROCK_SNOW_POLICY.sourceMapSha256,
    geoCell: 'G77',
    layer: G77_ROCK_SNOW_POLICY.layer,
    sourceGridSize: size,
    sourceSamples: size * size,
    terrain3dRegionSize: G77_ROCK_SNOW_POLICY.terrain3dRegionSize,
    terrain3dImportSize: G77_ROCK_SNOW_POLICY.terrain3dImportSize,
    slopeFilterRadiusNormalized: G77_ROCK_SNOW_POLICY.slopeFilterRadiusNormalized,
    slopeFilterTaps: G77_ROCK_SNOW_POLICY.slopeFilterTaps,
    canonicalWaterCells,
    canonicalLandCells,
    fractionalRockSamples,
    rockDominantSamples,
    shorelineSamples,
    deepLandSamples,
    minRockBlend: Number(minRockBlend.toFixed(8)),
    maxRockBlend: Number(maxRockBlend.toFixed(8)),
    rockBlendSpan: Number((maxRockBlend - minRockBlend).toFixed(8)),
    maxSnowWeight: Number(maxSnowWeight.toFixed(8)),
    maxRawSlope: Number(maxRawSlope.toFixed(8)),
    maxFilteredSlope: Number(maxFilteredSlope.toFixed(8)),
    maxSlopeFilterDelta: Number(maxSlopeFilterDelta.toFixed(8)),
    maxAdjacentRockStep: Number(maxAdjacentRockStep.toFixed(8)),
    maxAdjacentRawSlopeStep: Number(maxAdjacentRawSlopeStep.toFixed(8)),
    maxAdjacentFilteredSlopeStep: Number(maxAdjacentFilteredSlopeStep.toFixed(8)),
    minMaterialWeight: Number(minMaterialWeight.toFixed(8)),
    maxMaterialWeight: Number(maxMaterialWeight.toFixed(8)),
    maxLandWeightOverrun: Number(Math.max(0, maxLandWeightOverrun).toFixed(10)),
    maxGuardBandRockDelta: Number(maxGuardBandRockDelta.toFixed(8)),
    maxGuardBandSnowDelta: Number(maxGuardBandSnowDelta.toFixed(8)),
    maxCanonicalWaterSurfaceLeak: Number(maxCanonicalWaterSurfaceLeak.toFixed(8)),
    surfaceChecksum: checksum,
  });
}

export function buildG77RockSnowProbe() {
  const bounds = G77_ROCK_SNOW_POLICY.normalizedBounds;
  const size = G77_ROCK_SNOW_POLICY.sourceGridSize;
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * (y / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * (x / (size - 1));
      const surface = sampleG77RockSnow(nx, ny);
      const control = buildG77RockSnowControlContract(surface);
      row.push([
        Number(surface.groundWeight.toFixed(8)),
        Number(surface.rockWeight.toFixed(8)),
        Number(surface.snowWeight.toFixed(8)),
        Number(surface.rockBlend.toFixed(8)),
        Number(surface.height.toFixed(6)),
        Number(surface.slope.toFixed(8)),
        Number(surface.waterConfidence.toFixed(8)),
        Number(surface.landFactor.toFixed(8)),
        Number(surface.rawSlope.toFixed(8)),
        Number(surface.materialWeight.toFixed(8)),
        control.overlayTextureId,
        control.overlayBlend8,
      ]);
    }
    rows.push(row);
  }
  return Object.freeze({
    schema: 'westeros-g77-terrain3d-rock-snow-v6',
    policyId: G77_ROCK_SNOW_POLICY.id,
    sourceMapSha256: G77_ROCK_SNOW_POLICY.sourceMapSha256,
    geoCell: 'G77',
    layer: G77_ROCK_SNOW_POLICY.layer,
    sourceGridSize: size,
    terrain3dRegionSize: G77_ROCK_SNOW_POLICY.terrain3dRegionSize,
    terrain3dImportSize: G77_ROCK_SNOW_POLICY.terrain3dImportSize,
    groundTextureId: G77_ROCK_SNOW_POLICY.groundTextureId,
    rockTextureId: G77_ROCK_SNOW_POLICY.rockTextureId,
    snowTextureId: G77_ROCK_SNOW_POLICY.snowTextureId,
    slopeFilterRadiusNormalized: G77_ROCK_SNOW_POLICY.slopeFilterRadiusNormalized,
    slopeFilterTaps: G77_ROCK_SNOW_POLICY.slopeFilterTaps,
    rowSchema: Object.freeze([
      'groundWeight', 'rockWeight', 'snowWeight', 'rockBlend', 'height', 'filteredSlope',
      'waterConfidence', 'landFactor', 'rawSlope', 'materialWeight', 'overlayTextureId', 'overlayBlend8',
    ]),
    rows,
  });
}
