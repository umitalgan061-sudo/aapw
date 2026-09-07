/**
 * Deterministic spatial distribution policy for environment assets.
 *
 * The canonical map supplies the geography. This module only decides how already-authored assets
 * should cluster, thin out, form ecotones and preserve clearings around roads/settlements. It never
 * changes terrain height or hydrology and never instantiates geometry.
 *
 * The important visual distinction is between a believable population field and random point scatter:
 * forests have cores, edges and openings; shrub/grass follows edge and moisture gradients; rock and
 * scree favour steep transitions; settlement props keep a deliberate human clearing; snow patches
 * break around windward/leeward and exposed rock context.
 *
 * @module world/terrainEnvironmentSpatialPolicy
 */

import { environmentSurfaceScore, resolveTerrainEnvironmentProfile } from './terrainEnvironmentProfiles.js';
import { deterministicEnvironmentSeed } from './terrainEnvironmentAssetRegistry.js';

const TAU = Math.PI * 2;
const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const freeze = (value) => Object.freeze(value);

export const TERRAIN_ENVIRONMENT_SPATIAL_POLICY = freeze({
  id: 'terrain-environment-spatial-ecology-2026-09-07-v1',
  deterministic: true,
  canonicalHeightUntouched: true,
  canonicalHydrologyUntouched: true,
  canonicalColliderUntouched: true,
  noGeometryInstantiation: true,
  patternTypes: freeze(['grove', 'ecotone', 'clearing', 'talus', 'scree-apron', 'shoreline-edge', 'settlement-envelope', 'snow-drift']),
  canopy: freeze({
    coreDensityMultiplier: 1.75,
    edgeDensityMultiplier: 0.72,
    clearingRadiusMeters: 18,
    ecotoneWidthMeters: 46,
  }),
  shrub: freeze({
    edgeMultiplier: 1.35,
    wetMultiplier: 1.45,
    dryHeathMultiplier: 0.88,
  }),
  rock: freeze({
    slopePeakDegrees: 62,
    slopeWindowDegrees: 22,
    ridgeMultiplier: 1.28,
  }),
  scree: freeze({
    slopeMinDegrees: 24,
    slopeMaxDegrees: 58,
    talusDistanceMeters: 95,
  }),
  settlement: freeze({
    innerClearingMeters: 22,
    outerEnvelopeMeters: 150,
    propDensityMultiplier: 1.42,
  }),
  snow: freeze({
    windwardMultiplier: 0.72,
    leewardMultiplier: 1.32,
    exposedRockPenalty: 0.58,
  }),
});

function smoothstep(edge0, edge1, value) {
  const t = clamp01((value - edge0) / Math.max(1e-6, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function hash2(x, z, seed) {
  let value = (Math.imul(Math.floor(x) | 0, 0x1f123bb5)
    ^ Math.imul(Math.floor(z) | 0, 0x5bd1e995)
    ^ (seed | 0)) | 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967295;
}

function valueNoise(x, z, seed) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smoothstep(0, 1, x - ix);
  const fz = smoothstep(0, 1, z - iz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fz;
}

function fbm(x, z, seed, octaves = 5) {
  let sum = 0;
  let amplitude = 0.58;
  let frequency = 1;
  let weight = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += valueNoise(x * frequency, z * frequency, seed + octave * 0x9e3779b9) * amplitude;
    weight += amplitude;
    amplitude *= 0.48;
    frequency *= 2.03;
  }
  return weight > 0 ? sum / weight : 0.5;
}

function ridged(x, z, seed) {
  return 1 - Math.abs(fbm(x, z, seed) * 2 - 1);
}

export function environmentSpatialNoise(worldX, worldZ, seed = 0x51f15e) {
  const macro = fbm(worldX / 1200, worldZ / 1200, seed ^ 0x13a6);
  const broad = fbm(worldX / 520, worldZ / 520, seed ^ 0x22bd);
  const meso = fbm(worldX / 210, worldZ / 210, seed ^ 0x42d1);
  const fine = fbm(worldX / 78, worldZ / 78, seed ^ 0x61ef);
  const edge = ridged(worldX / 155, worldZ / 155, seed ^ 0x74aa);
  return freeze({ macro, broad, meso, fine, edge });
}

export function distanceFalloff(distanceMeters, innerRadiusMeters, outerRadiusMeters) {
  const distance = Math.max(0, finite(distanceMeters, 0));
  const inner = Math.max(0, finite(innerRadiusMeters, 0));
  const outer = Math.max(inner + 1e-6, finite(outerRadiusMeters, inner + 1));
  if (distance <= inner) return 1;
  if (distance >= outer) return 0;
  return 1 - smoothstep(inner, outer, distance);
}

export function ringFalloff(distanceMeters, centerRadiusMeters, edgeWidthMeters) {
  const distance = Math.max(0, finite(distanceMeters, 0));
  const center = Math.max(0, finite(centerRadiusMeters, 0));
  const width = Math.max(1e-6, finite(edgeWidthMeters, 1));
  return smoothstep(center, center + width, distance);
}

export function clearingsModifier(distanceFromSettlementMeters, profile = TERRAIN_ENVIRONMENT_SPATIAL_POLICY.settlement) {
  const distance = Math.max(0, finite(distanceFromSettlementMeters, Infinity));
  if (!Number.isFinite(distance)) return 1;
  const inner = Math.max(0, finite(profile.innerClearingMeters, 22));
  const outer = Math.max(inner + 1, finite(profile.outerEnvelopeMeters, 150));
  if (distance <= inner) return 0;
  if (distance >= outer) return 1;
  const t = smoothstep(inner, outer, distance);
  return clamp(t, 0, 1);
}

export function forestCoreWeight(distanceFromGroveCenterMeters, groveRadiusMeters, ecotoneWidthMeters = 46) {
  const radius = Math.max(1, finite(groveRadiusMeters, 170));
  const distance = Math.max(0, finite(distanceFromGroveCenterMeters, radius));
  const edgeStart = Math.max(0, radius - Math.max(1, finite(ecotoneWidthMeters, 46)));
  return distance <= edgeStart ? 1 : distance >= radius ? 0 : 1 - smoothstep(edgeStart, radius, distance);
}

export function forestEcotoneWeight(distanceFromGroveCenterMeters, groveRadiusMeters, ecotoneWidthMeters = 46) {
  const core = forestCoreWeight(distanceFromGroveCenterMeters, groveRadiusMeters, ecotoneWidthMeters);
  const edge = distanceFalloff(distanceFromGroveCenterMeters, Math.max(0, groveRadiusMeters - ecotoneWidthMeters), groveRadiusMeters + ecotoneWidthMeters * 0.45);
  return clamp(edge * (1 - core * 0.42), 0, 1);
}

export function groveOpeningWeight(worldX, worldZ, seed = 0x2c6f19) {
  const field = fbm(worldX / 92, worldZ / 92, seed);
  const opening = 1 - smoothstep(0.45, 0.72, field);
  const clearing = ridged(worldX / 220, worldZ / 220, seed ^ 0x31a7);
  return clamp(opening * 0.66 + (1 - clearing) * 0.34, 0, 1);
}

export function moistureDistributionWeight({
  moisture = 0.5,
  biome = '',
  elevationMeters = 0,
  waterDistanceMeters = Infinity,
} = {}) {
  const wet = clamp01(moisture);
  const lowland = 1 - smoothstep(20, 140, finite(elevationMeters, 0));
  const waterReach = distanceFalloff(waterDistanceMeters, 0, 28);
  const biomeKey = String(biome || '').toLowerCase();
  const biomeWetBonus = ['wet-meadow', 'marsh', 'forest-edge'].includes(biomeKey) ? 0.18 : 0;
  const biomeDryPenalty = ['dry-upland', 'dry-heath'].includes(biomeKey) ? 0.16 : 0;
  return clamp(wet * 0.58 + lowland * 0.15 + waterReach * 0.27 + biomeWetBonus - biomeDryPenalty, 0, 1);
}

export function slopeDistributionWeight({
  slopeDegrees = 0,
  category = 'tree',
} = {}) {
  const slope = clamp(finite(slopeDegrees, 0), 0, 90);
  const key = String(category || 'tree').toLowerCase();
  if (key === 'rock' || key === 'cliff') {
    return clamp(smoothstep(16, 42, slope) * (1 - smoothstep(76, 88, slope)), 0, 1);
  }
  if (key === 'scree') {
    return clamp(smoothstep(24, 32, slope) * (1 - smoothstep(55, 64, slope)), 0, 1);
  }
  if (key === 'grass') return clamp(1 - smoothstep(34, 52, slope), 0, 1);
  if (key === 'shrub') return clamp(1 - smoothstep(38, 50, slope), 0, 1);
  return clamp(1 - smoothstep(22, 38, slope), 0, 1);
}

export function rockExposureWeight({
  slopeDegrees = 0,
  ridgeWeight = 0,
  substrateRock = 0,
} = {}) {
  const slope = finite(slopeDegrees, 0);
  const ridge = clamp01(ridgeWeight);
  const substrate = clamp01(substrateRock);
  const slopePeak = 1 - Math.min(1, Math.abs(slope - TERRAIN_ENVIRONMENT_SPATIAL_POLICY.rock.slopePeakDegrees) / TERRAIN_ENVIRONMENT_SPATIAL_POLICY.rock.slopeWindowDegrees);
  return clamp01(slopePeak * 0.48 + ridge * 0.28 + substrate * 0.24);
}

export function talusWeight({
  slopeDegrees = 0,
  heightMeters = 0,
  distanceBelowRockFaceMeters = Infinity,
  ridgeWeight = 0,
} = {}) {
  const slope = clamp(finite(slopeDegrees, 0), 0, 90);
  const elevation = finite(heightMeters, 0);
  const belowFace = distanceFalloff(distanceBelowRockFaceMeters, 16, TERRAIN_ENVIRONMENT_SPATIAL_POLICY.scree.talusDistanceMeters);
  const slopeBand = smoothstep(TERRAIN_ENVIRONMENT_SPATIAL_POLICY.scree.slopeMinDegrees, 35, slope)
    * (1 - smoothstep(55, TERRAIN_ENVIRONMENT_SPATIAL_POLICY.scree.slopeMaxDegrees, slope));
  const elevationBand = smoothstep(25, 140, elevation);
  const ridge = clamp01(ridgeWeight);
  return clamp01(belowFace * 0.46 + slopeBand * 0.30 + elevationBand * 0.10 + ridge * 0.14);
}

export function settlementEnvelopeWeight({ distanceMeters = Infinity, roadDistanceMeters = Infinity } = {}) {
  const settlement = distanceFalloff(distanceMeters, TERRAIN_ENVIRONMENT_SPATIAL_POLICY.settlement.innerClearingMeters, TERRAIN_ENVIRONMENT_SPATIAL_POLICY.settlement.outerEnvelopeMeters);
  const road = distanceFalloff(roadDistanceMeters, 1.5, 24);
  return clamp(settlement * 0.74 + road * 0.26, 0, 1);
}

export function snowDriftWeight({
  snowWeight = 0.5,
  windward = 0.5,
  lee = 0.5,
  exposedRock = 0,
  slopeDegrees = 0,
} = {}) {
  const snow = clamp01(snowWeight);
  const wind = clamp01(windward);
  const leeward = clamp01(lee);
  const rock = clamp01(exposedRock);
  const slope = clamp(finite(slopeDegrees, 0), 0, 90);
  const leeGain = leeward * TERRAIN_ENVIRONMENT_SPATIAL_POLICY.snow.leewardMultiplier;
  const windPenalty = wind * TERRAIN_ENVIRONMENT_SPATIAL_POLICY.snow.windwardMultiplier;
  const rockPenalty = rock * TERRAIN_ENVIRONMENT_SPATIAL_POLICY.snow.exposedRockPenalty;
  const slopeHold = 0.82 + 0.18 * (1 - smoothstep(42, 70, slope));
  return clamp01(snow * (0.62 + leeGain * 0.38) * (0.72 + windPenalty * 0.28) * (1 - rockPenalty * 0.34) * slopeHold);
}

export function ecotoneComposition(category, context = {}) {
  const key = String(category || '').toLowerCase();
  const noise = environmentSpatialNoise(finite(context.worldX, 0), finite(context.worldZ, 0), finite(context.seed, 0x51f15e));
  const core = forestCoreWeight(context.distanceFromGroveCenterMeters, context.groveRadiusMeters, context.ecotoneWidthMeters);
  const edge = forestEcotoneWeight(context.distanceFromGroveCenterMeters, context.groveRadiusMeters, context.ecotoneWidthMeters);
  const moisture = moistureDistributionWeight({
    moisture: context.moisture,
    biome: context.biome,
    elevationMeters: context.heightMeters,
    waterDistanceMeters: context.waterDistanceMeters,
  });
  const slope = slopeDistributionWeight({ slopeDegrees: context.slopeDegrees, category: key });
  const opening = groveOpeningWeight(finite(context.worldX, 0), finite(context.worldZ, 0), finite(context.seed, 0x2c6f19));
  const score = environmentSurfaceScore(resolveTerrainEnvironmentProfile(key) || resolveTerrainEnvironmentProfile('rock'), {
    slopeDegrees: context.slopeDegrees,
    heightMeters: context.heightMeters,
    moisture,
    waterDepth: context.waterDepth,
    biome: context.biome,
    roadDistance: context.roadDistance,
    settlementDistance: context.settlementDistance,
  });

  let densityMultiplier = 1;
  if (key === 'tree') densityMultiplier = (0.52 + core * 0.90 + edge * 0.52) * (1 - opening * 0.46);
  else if (key === 'shrub') densityMultiplier = 0.68 + edge * 0.72 + moisture * 0.35;
  else if (key === 'grass') densityMultiplier = 0.72 + (1 - core) * 0.22 + moisture * 0.36;
  else if (key === 'rock') densityMultiplier = 0.76 + rockExposureWeight({ slopeDegrees: context.slopeDegrees, ridgeWeight: context.ridgeWeight, substrateRock: context.rockWeight }) * 0.74;
  else if (key === 'scree') densityMultiplier = 0.62 + talusWeight({ slopeDegrees: context.slopeDegrees, heightMeters: context.heightMeters, distanceBelowRockFaceMeters: context.distanceBelowRockFaceMeters, ridgeWeight: context.ridgeWeight }) * 0.98;
  else if (key === 'snow-patch') densityMultiplier = 0.52 + snowDriftWeight({ snowWeight: context.snowWeight, windward: context.windward, lee: context.lee, exposedRock: context.rockWeight, slopeDegrees: context.slopeDegrees }) * 1.22;
  else if (key === 'prop' || key === 'house') densityMultiplier = 0.72 + settlementEnvelopeWeight({ distanceMeters: context.settlementDistance, roadDistanceMeters: context.roadDistance }) * 0.74;

  if (context.settlementDistance != null) densityMultiplier *= clearingsModifier(context.settlementDistance);
  densityMultiplier *= 0.60 + score * 0.40;
  densityMultiplier *= 0.78 + noise.meso * 0.44;

  return freeze({
    category: key,
    densityMultiplier: clamp(densityMultiplier, 0, 2.2),
    coreWeight: core,
    ecotoneWeight: edge,
    moistureWeight: moisture,
    slopeWeight: slope,
    openingWeight: opening,
    environmentalScore: score,
    noise,
  });
}

export function deterministicSpatialOrdinal(assetId, worldX, worldZ, ordinal = 0) {
  const base = deterministicEnvironmentSeed(assetId || 'environment', worldX, worldZ);
  return (base ^ (Number(ordinal) | 0)) >>> 0;
}

export function sampleClusterPoint(seed, centerX, centerZ, innerRadiusMeters, outerRadiusMeters, ordinal = 0) {
  const derived = deterministicSpatialOrdinal(`cluster:${seed}`, centerX, centerZ, ordinal);
  const u = ((derived % 1000003) + 1) / 1000004;
  const v = (((derived >>> 11) % 1000003) + 1) / 1000004;
  const radius = Math.sqrt(u * (outerRadiusMeters * outerRadiusMeters - innerRadiusMeters * innerRadiusMeters) + innerRadiusMeters * innerRadiusMeters);
  const angle = v * TAU;
  return freeze({
    x: centerX + Math.cos(angle) * radius,
    z: centerZ + Math.sin(angle) * radius,
    radius,
    angle,
    seed: derived,
  });
}

export function validateSpatialPatternSample({
  category,
  slopeDegrees,
  heightMeters,
  moisture,
  waterDepth = 0,
  biome,
  distanceFromGroveCenterMeters = Infinity,
  groveRadiusMeters = 170,
  settlementDistance = Infinity,
  roadDistance = Infinity,
} = {}) {
  const errors = [];
  const profile = resolveTerrainEnvironmentProfile(category);
  if (!profile) errors.push('missing-profile');
  if (!Number.isFinite(Number(slopeDegrees))) errors.push('missing-slope');
  if (!Number.isFinite(Number(heightMeters))) errors.push('missing-height');
  const composition = ecotoneComposition(category, {
    slopeDegrees, heightMeters, moisture, waterDepth, biome,
    distanceFromGroveCenterMeters, groveRadiusMeters, settlementDistance, roadDistance,
  });
  if (composition.densityMultiplier < 0) errors.push('negative-density');
  if (composition.densityMultiplier > 2.2) errors.push('density-over-envelope');
  if (profile && Number(waterDepth) > 0.05 && !['bridge', 'waterside'].includes(profile.category)) errors.push('water-conflict');
  return freeze({ ok: errors.length === 0, errors, profileId: profile?.category || null, composition });
}

export function buildSpatialDistributionManifest({ category, seed, worldX, worldZ, sample = {} } = {}) {
  const profile = resolveTerrainEnvironmentProfile(category);
  const composition = ecotoneComposition(category, { ...sample, seed, worldX, worldZ });
  return freeze({
    version: 1,
    policyId: TERRAIN_ENVIRONMENT_SPATIAL_POLICY.id,
    category: profile?.category || String(category || ''),
    deterministic: true,
    seed: deterministicSpatialOrdinal(category, worldX, worldZ, seed),
    origin: { worldX: finite(worldX, 0), worldZ: finite(worldZ, 0) },
    composition,
    spatial: {
      groveCoreWeight: composition.coreWeight,
      ecotoneWeight: composition.ecotoneWeight,
      openingWeight: composition.openingWeight,
      densityMultiplier: composition.densityMultiplier,
    },
    canonical: {
      heightUnchanged: true,
      hydrologyUnchanged: true,
      colliderUnchanged: true,
    },
  });
}
