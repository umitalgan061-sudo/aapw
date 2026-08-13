/**
 * Buzul Muhafızı / NW GeoCell G00 — Rock/Snow.
 *
 * GeoCell coordinates are work addressing only. Material weights are derived
 * from the already-qualified G00 relief plus continuous global biome/latitude
 * signals. No GeoCell edge/grid term participates in the final surface field.
 */
import {
  WORLD_REFERENCE_MAP,
  REFERENCE_BIOME_ZONES,
  sampleReferenceInfluence,
} from '../../../../src/3d/world/worldReferenceMap.js';
import {
  G00_RELIEF_POLICY,
  sampleG00CanonicalWaterConfidence,
  sampleG00ReliefHeight,
  sampleG00ReliefNormal,
} from './g00_relief.mjs';

export const G00_ROCK_SNOW_POLICY = Object.freeze({
  id: 'buzul-muhafizi-g00-terrain3d-rock-snow-2026-08-13-v1',
  sourceMapSha256: WORLD_REFERENCE_MAP.sha256,
  geoCell: 'G00',
  gx: 0,
  gy: 0,
  layer: 'Rock/Snow',
  normalizedBounds: G00_RELIEF_POLICY.normalizedBounds,
  maskBounds: G00_RELIEF_POLICY.maskBounds,
  sourceGridSize: 65,
  terrain3dRegionSize: 256,
  rockTextureId: 0,
  snowTextureId: 1,
  guardBandNormalized: 1 / 1536,
});

const COLD_ZONE = REFERENCE_BIOME_ZONES.find((zone) => zone.id === 'lands-always-winter');
const NORTH_ZONE = REFERENCE_BIOME_ZONES.find((zone) => zone.id === 'north');
if (!COLD_ZONE) throw new Error('canonical Lands of Always Winter biome control missing');

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function smoothstep(edge0, edge1, value) {
  if (edge1 <= edge0) return value >= edge1 ? 1 : 0;
  const t = clamp((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function physicalSlopeAt(normalizedX, normalizedY) {
  const normal = sampleG00ReliefNormal(normalizedX, normalizedY);
  return clamp(Math.hypot(normal.x, normal.z) / 0.22);
}

function sampleSlopeExposure(normalizedX, normalizedY) {
  // Material response represents a finite surface footprint rather than a
  // point sample. Average the qualified physical normal over a compact cross
  // footprint (well below one source-grid step) so narrow derivative spikes do
  // not turn into painted rock/snow stripes while broad steep faces remain rock.
  const footprint = G00_RELIEF_POLICY.normalProbeNormalized * 2;
  return (
    physicalSlopeAt(normalizedX, normalizedY)
    + physicalSlopeAt(normalizedX - footprint, normalizedY)
    + physicalSlopeAt(normalizedX + footprint, normalizedY)
    + physicalSlopeAt(normalizedX, normalizedY - footprint)
    + physicalSlopeAt(normalizedX, normalizedY + footprint)
  ) / 5;
}

export function sampleG00RockSnow(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
    throw new TypeError('normalized coordinates must be finite');
  }
  const nx = clamp(normalizedX);
  const ny = clamp(normalizedY);
  const water = sampleG00CanonicalWaterConfidence(nx, ny);
  // Canonical water confidence is already bilinearly filtered in continuous
  // owner-map space. Using it directly avoids re-steepening the coastline with
  // a second smoothstep while preserving exact 0/1 canonical cell centres.
  const landFactor = 1 - water;
  const heightMeters = sampleG00ReliefHeight(nx, ny);
  const slope = sampleSlopeExposure(nx, ny);
  const cold = sampleReferenceInfluence(nx, ny, COLD_ZONE);
  const northBiome = NORTH_ZONE ? sampleReferenceInfluence(nx, ny, NORTH_ZONE) : 0;
  const latitudeCold = 1 - smoothstep(0.025, 0.24, ny);
  const elevationSnow = smoothstep(4, 28, heightMeters);
  const exposedRock = clamp(0.72 * slope + 0.18 * (1 - cold) + 0.10 * (1 - elevationSnow));
  const snowPreference = clamp(
    0.14
      + 0.44 * cold
      + 0.18 * northBiome
      + 0.22 * latitudeCold
      + 0.24 * elevationSnow
      - 0.42 * exposedRock,
  );
  // Keep the preference ordering and cold/elevation semantics, but do not feed
  // it through a second high-gain S-curve. A linear retention response is more
  // stable under neighbouring physical-normal changes and still preserves both
  // snow-dominant shelves and rock-dominant exposed faces.
  const snowBlend = 0.05 + 0.90 * snowPreference;
  const snowWeight = landFactor * snowBlend;
  const rockWeight = landFactor * (1 - snowBlend);
  return Object.freeze({
    waterConfidence: water,
    landFactor,
    heightMeters,
    slope,
    coldInfluence: cold,
    northBiomeInfluence: northBiome,
    latitudeCold,
    elevationSnow,
    exposedRock,
    snowBlend,
    rockWeight,
    snowWeight,
  });
}

function fnv1a(checksum, value) {
  checksum ^= value & 0xff;
  return Math.imul(checksum, 16777619) >>> 0;
}

function canonicalHydrologyFingerprint() {
  const bounds = G00_ROCK_SNOW_POLICY.maskBounds;
  let waterCells = 0;
  let landCells = 0;
  let centreMismatches = 0;
  for (let y = bounds.yMin; y <= bounds.yMax; y += 1) {
    for (let x = bounds.xMin; x <= bounds.xMax; x += 1) {
      const nx = (x + 0.5) / G00_RELIEF_POLICY.baseMaskWidth;
      const ny = (y + 0.5) / G00_RELIEF_POLICY.baseMaskHeight;
      const water = sampleG00CanonicalWaterConfidence(nx, ny) >= 0.5;
      const belowSea = sampleG00ReliefHeight(nx, ny) < 0;
      if (water) waterCells += 1;
      else landCells += 1;
      if (water !== belowSea) centreMismatches += 1;
    }
  }
  return Object.freeze({ waterCells, landCells, centreMismatches });
}

export function measureG00RockSnow() {
  const { xMin, xMax, yMin, yMax } = G00_ROCK_SNOW_POLICY.normalizedBounds;
  const size = G00_ROCK_SNOW_POLICY.sourceGridSize;
  const rows = [];
  let fractionalBlendSamples = 0;
  let snowDominantLandSamples = 0;
  let rockDominantLandSamples = 0;
  let maxAdjacentSurfaceWeightStep = 0;
  let maxGuardBandSurfaceWeightDelta = 0;
  let maxWaterSnowLeak = 0;
  let maxMaterialMassError = 0;
  let checksum = 2166136261;

  for (let y = 0; y < size; y += 1) {
    const ny = yMin + (yMax - yMin) * (y / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = xMin + (xMax - xMin) * (x / (size - 1));
      const sample = sampleG00RockSnow(nx, ny);
      if (sample.landFactor > 0.05 && sample.snowBlend > 0.05 && sample.snowBlend < 0.95) fractionalBlendSamples += 1;
      if (sample.landFactor > 0.5) {
        if (sample.snowBlend >= 0.5) snowDominantLandSamples += 1;
        else rockDominantLandSamples += 1;
      }
      maxMaterialMassError = Math.max(maxMaterialMassError, Math.abs((sample.rockWeight + sample.snowWeight) - sample.landFactor));
      checksum = fnv1a(fnv1a(fnv1a(checksum, Math.round(sample.rockWeight * 255)), Math.round(sample.snowWeight * 255)), Math.round(sample.snowBlend * 255));
      row.push(sample);
    }
    rows.push(row);
  }

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const snow = rows[y][x].snowWeight;
      if (x + 1 < size) maxAdjacentSurfaceWeightStep = Math.max(maxAdjacentSurfaceWeightStep, Math.abs(snow - rows[y][x + 1].snowWeight));
      if (y + 1 < size) maxAdjacentSurfaceWeightStep = Math.max(maxAdjacentSurfaceWeightStep, Math.abs(snow - rows[y + 1][x].snowWeight));
    }
  }

  const guard = G00_ROCK_SNOW_POLICY.guardBandNormalized;
  for (let i = 0; i < size; i += 1) {
    const t = i / (size - 1);
    const nx = xMin + (xMax - xMin) * t;
    const ny = yMin + (yMax - yMin) * t;
    maxGuardBandSurfaceWeightDelta = Math.max(
      maxGuardBandSurfaceWeightDelta,
      Math.abs(sampleG00RockSnow(nx, yMin).snowWeight - sampleG00RockSnow(nx, yMin - guard).snowWeight),
      Math.abs(sampleG00RockSnow(nx, yMax).snowWeight - sampleG00RockSnow(nx, yMax + guard).snowWeight),
      Math.abs(sampleG00RockSnow(xMin, ny).snowWeight - sampleG00RockSnow(xMin - guard, ny).snowWeight),
      Math.abs(sampleG00RockSnow(xMax, ny).snowWeight - sampleG00RockSnow(xMax + guard, ny).snowWeight),
    );
  }

  const mask = G00_ROCK_SNOW_POLICY.maskBounds;
  for (let y = mask.yMin; y <= mask.yMax; y += 1) {
    for (let x = mask.xMin; x <= mask.xMax; x += 1) {
      const nx = (x + 0.5) / G00_RELIEF_POLICY.baseMaskWidth;
      const ny = (y + 0.5) / G00_RELIEF_POLICY.baseMaskHeight;
      if (sampleG00CanonicalWaterConfidence(nx, ny) >= 0.5) {
        maxWaterSnowLeak = Math.max(maxWaterSnowLeak, sampleG00RockSnow(nx, ny).snowWeight);
      }
    }
  }

  return Object.freeze({
    policyId: G00_ROCK_SNOW_POLICY.id,
    sourceMapSha256: G00_ROCK_SNOW_POLICY.sourceMapSha256,
    geoCell: 'G00',
    layer: 'Rock/Snow',
    sourceGridSize: size,
    sourceSamples: size * size,
    terrain3dRegionSize: G00_ROCK_SNOW_POLICY.terrain3dRegionSize,
    hydrologyFingerprint: canonicalHydrologyFingerprint(),
    fractionalBlendSamples,
    snowDominantLandSamples,
    rockDominantLandSamples,
    maxAdjacentSurfaceWeightStep: Number(maxAdjacentSurfaceWeightStep.toFixed(8)),
    maxGuardBandSurfaceWeightDelta: Number(maxGuardBandSurfaceWeightDelta.toFixed(8)),
    maxWaterSnowLeak: Number(maxWaterSnowLeak.toFixed(8)),
    maxMaterialMassError: Number(maxMaterialMassError.toFixed(10)),
    surfaceChecksum: checksum,
  });
}

export function buildG00RockSnowProbe() {
  const { xMin, xMax, yMin, yMax } = G00_ROCK_SNOW_POLICY.normalizedBounds;
  const size = G00_ROCK_SNOW_POLICY.sourceGridSize;
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const ny = yMin + (yMax - yMin) * (y / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = xMin + (xMax - xMin) * (x / (size - 1));
      const sample = sampleG00RockSnow(nx, ny);
      row.push([
        Number(sample.rockWeight.toFixed(8)),
        Number(sample.snowWeight.toFixed(8)),
        Number(sample.snowBlend.toFixed(8)),
        Number(sample.landFactor.toFixed(8)),
        Number(sample.heightMeters.toFixed(6)),
        Number(sample.slope.toFixed(8)),
        Number(sample.coldInfluence.toFixed(8)),
      ]);
    }
    rows.push(row);
  }
  return Object.freeze({
    policyId: G00_ROCK_SNOW_POLICY.id,
    sourceMapSha256: G00_ROCK_SNOW_POLICY.sourceMapSha256,
    geoCell: 'G00',
    layer: 'Rock/Snow',
    sourceGridSize: size,
    terrain3dRegionSize: G00_ROCK_SNOW_POLICY.terrain3dRegionSize,
    rockTextureId: G00_ROCK_SNOW_POLICY.rockTextureId,
    snowTextureId: G00_ROCK_SNOW_POLICY.snowTextureId,
    rows,
  });
}
