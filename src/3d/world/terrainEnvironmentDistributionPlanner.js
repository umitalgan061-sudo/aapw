/**
 * Deterministic world-space distribution planner.
 *
 * It computes candidate positions and density from canonical environmental samples. It never creates
 * meshes, never replaces authored assets and never becomes a second terrain authority.
 */
import { deterministicSpatialOrdinal, ecotoneComposition, environmentSpatialNoise, slopeDistributionWeight, moistureDistributionWeight, rockExposureWeight, talusWeight, snowDriftWeight } from './terrainEnvironmentSpatialPolicy.js';
import { resolveTerrainEnvironmentProfile } from './terrainEnvironmentProfiles.js';
import { resolveEnvironmentLod, shouldCullEnvironment } from './terrainEnvironmentLodPolicy.js';
import { biomeTransitionWeights, seasonalAssetWeights } from './terrainEnvironmentClimateTransitions.js';

const freeze = (value) => Object.freeze(value);
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : min));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const keyOf = (value) => String(value ?? '').trim().toLowerCase();
const SQRT3 = Math.sqrt(3);

export const TERRAIN_ENVIRONMENT_DISTRIBUTION_PLANNER_POLICY = freeze({
  id: 'terrain-environment-distribution-planner-2026-09-07-v1',
  deterministic: true,
  worldSpace: true,
  noGeometryInstantiation: true,
  noTerrainMutation: true,
  noHydrologyMutation: true,
  neverUniformGrid: true,
  canonicalSampleAuthority: 'src/3d/world/terrain.js',
  minimumSeparationMeters: freeze({ tree: 8, shrub: 3, grass: 0.7, rock: 12, cliff: 30, scree: 8, snowPatch: 18, house: 45, bridge: 55 }),
  densityCapsPerKm2: freeze({ tree: 320, shrub: 520, grass: 1400, rock: 130, cliff: 26, scree: 220, snowPatch: 70, house: 28, bridge: 14 }),
  visualBandsMeters: freeze({ close: 80, near: 350, mid: 1100, far: 2900 }),
});

const FAMILY_ALIASES = freeze({
  trees: 'tree', vegetation: 'tree', boulder: 'rock', rocks: 'rock', cliffs: 'cliff', snow: 'snowPatch', 'snow-patch': 'snowPatch', building: 'house', buildings: 'house',
});

function normalizeCategory(category) {
  const key = keyOf(category);
  return FAMILY_ALIASES[key] ?? key;
}

function hash01(seed) {
  let value = Number(seed) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967296;
}

function deterministicAngle(seed) {
  return hash01(seed) * Math.PI * 2;
}

export function distributionDensity(category, sample = {}) {
  const c = normalizeCategory(category);
  const slope = clamp(finite(sample.slopeDegrees ?? sample.slope) / 65);
  const rock = clamp(sample.rockWeight);
  const snow = clamp(sample.snowWeight);
  const moisture = clamp(sample.moisture == null ? 0.5 : sample.moisture);
  const waterDepth = Math.max(0, finite(sample.waterDepth));
  if (waterDepth > 0.05 && c !== 'bridge') return 0;

  const transitions = biomeTransitionWeights({
    biome: sample.biome,
    moisture,
    elevationMeters: sample.heightAboveSeaMeters ?? sample.heightMeters,
    slopeDegrees: sample.slopeDegrees ?? sample.slope,
    temperatureC: sample.temperatureC,
  });
  const season = seasonalAssetWeights({
    season: sample.season,
    snowWeight: snow,
    temperatureC: sample.temperatureC,
    biome: sample.biome,
    moisture,
    windExposure: sample.windExposure,
  });
  const slopeFit = slopeDistributionWeight({ slopeDegrees: sample.slopeDegrees, category: c });
  const moistureFit = moistureDistributionWeight({ moisture, biome: sample.biome, elevationMeters: sample.heightAboveSeaMeters, waterDistanceMeters: sample.waterDistanceMeters });
  const rockFit = rockExposureWeight({ slopeDegrees: sample.slopeDegrees, ridgeWeight: sample.ridgeWeight, substrateRock: rock });
  const snowFit = snowDriftWeight({ snowWeight: snow, windward: sample.windward, lee: sample.lee, exposedRock: rock, slopeDegrees: sample.slopeDegrees });

  let density = 0.08;
  if (c === 'tree') density = 0.36 + transitions.forest * 0.56 + transitions.wetForest * 0.18 - slope * 0.42 - rock * 0.22 + season.evergreen * 0.03;
  else if (c === 'shrub') density = 0.30 + transitions.forest * 0.24 + transitions.heath * 0.24 + transitions.wetland * 0.28 + moistureFit * 0.18 - slope * 0.16;
  else if (c === 'grass') density = 0.40 + transitions.meadow * 0.34 + transitions.wetland * 0.24 + transitions.heath * 0.12 + moistureFit * 0.12 - slope * 0.16;
  else if (c === 'rock') density = 0.08 + rock * 0.56 + slope * 0.45 + transitions.alpine * 0.14 + rockFit * 0.25;
  else if (c === 'cliff') density = 0.04 + slope * 0.74 + rockFit * 0.32 + transitions.alpine * 0.15;
  else if (c === 'scree') density = 0.06 + talusWeight({ slopeDegrees: sample.slopeDegrees, heightMeters: sample.heightAboveSeaMeters ?? sample.heightMeters, distanceBelowRockFaceMeters: sample.distanceBelowRockFaceMeters, ridgeWeight: sample.ridgeWeight }) * 0.84;
  else if (c === 'snowPatch') density = 0.04 + snow * 0.64 + snowFit * 0.48 + transitions.tundra * 0.18;
  else if (c === 'house') density = 0.14 + (1 - slope) * 0.40 + (1 - moistureFit) * 0.18 + (1 - rock) * 0.16;
  else if (c === 'bridge') density = 0.10 + (waterDepth > 0.01 ? 0.56 : 0.08) + (1 - slope) * 0.18;
  return clamp(density, 0, 2.2);
}

export function distanceScaleForDistribution(distanceMeters = 0) {
  const d = Math.max(0, finite(distanceMeters));
  if (d <= TERRAIN_ENVIRONMENT_DISTRIBUTION_PLANNER_POLICY.visualBandsMeters.close) return 0.78;
  if (d <= TERRAIN_ENVIRONMENT_DISTRIBUTION_PLANNER_POLICY.visualBands.near) return 1;
  if (d <= TERRAIN_ENVIRONMENT_DISTRIBUTION_PLANNER_POLICY.visualBands.mid) return 1.25;
  return 1.55;
}

export function spacingEnvelope(category, { distanceMeters = 0, density = 1, visibility = 1, slopeDegrees = 0 } = {}) {
  const c = normalizeCategory(category);
  const base = TERRAIN_ENVIRONMENT_DISTRIBUTION_PLANNER_POLICY.minimumSeparationMeters[c] ?? 5;
  const densityFactor = 1 / Math.sqrt(Math.max(0.20, finite(density, 1)));
  const visualFactor = clamp(visibility, 0.55, 1.20) * distanceScaleForDistribution(distanceMeters);
  const slopeFactor = c === 'rock' || c === 'scree' ? 0.88 + clamp(finite(slopeDegrees) / 90) * 0.28 : 1;
  return freeze({ category: c, baseMeters: base, separationMeters: base * densityFactor * visualFactor * slopeFactor });
}

export function candidatePosition({ category = 'tree', worldX = 0, worldZ = 0, seed = 0, ordinal = 0, radiusMeters = 100 } = {}) {
  const c = normalizeCategory(category);
  const ordinalSeed = deterministicSpatialOrdinal(`candidate:${c}:${seed}`, worldX, worldZ, ordinal);
  const radial = Math.sqrt((hash01(ordinalSeed) * 0.94) + 0.03) * Math.max(0, finite(radiusMeters));
  const angle = deterministicAngle(ordinalSeed ^ 0x8f31a7c1) + ordinal * 2.399963229728653;
  return freeze({
    x: finite(worldX) + Math.cos(angle) * radial,
    z: finite(worldZ) + Math.sin(angle) * radial,
    radius: radial,
    angle,
    jitterSeed: ordinalSeed,
  });
}

export function environmentPointCandidate({ category = 'tree', worldX = 0, worldZ = 0, seed = 0, ordinal = 0, radiusMeters = 100, distanceMeters = 0, visibility = 1, sample = {} } = {}) {
  const c = normalizeCategory(category);
  const density = distributionDensity(c, sample);
  const position = candidatePosition({ category: c, worldX, worldZ, seed, ordinal, radiusMeters });
  const noise = environmentSpatialNoise(position.x, position.z, deterministicSpatialOrdinal(c, worldX, worldZ, seed));
  const composition = ecotoneComposition(c, { ...sample, worldX: position.x, worldZ: position.z, seed });
  const spacing = spacingEnvelope(c, { distanceMeters, density, visibility, slopeDegrees: sample.slopeDegrees });
  const lod = resolveEnvironmentLod(c, distanceMeters);
  const profile = resolveTerrainEnvironmentProfile(c);
  const acceptedByWater = Math.max(0, finite(sample.waterDepth)) <= 0.05 || c === 'bridge';
  const acceptedByProfile = Boolean(profile && Number(sample.slopeDegrees ?? 0) >= profile.minSlopeDegrees && Number(sample.slopeDegrees ?? 0) <= profile.maxSlopeDegrees && Number(sample.heightAboveSeaMeters ?? sample.heightMeters ?? 0) >= profile.minHeightMeters);
  return freeze({
    category: c,
    sourceWorld: freeze({ x: finite(worldX), z: finite(worldZ) }),
    candidateWorld: position,
    density,
    spacing,
    noise,
    composition,
    profileId: profile?.category ?? null,
    lod,
    accepted: density > 0.08 && acceptedByWater && acceptedByProfile && !shouldCullEnvironment(c, distanceMeters),
    acceptance: freeze({ water: acceptedByWater, profile: acceptedByProfile, visible: !shouldCullEnvironment(c, distanceMeters), density: density > 0.08 }),
  });
}

function greedySeparation(points) {
  const accepted = [];
  for (const point of points) {
    const separation = point.spacing.separationMeters;
    let collision = false;
    for (const previous of accepted) {
      const dx = point.candidateWorld.x - previous.candidateWorld.x;
      const dz = point.candidateWorld.z - previous.candidateWorld.z;
      const required = Math.max(separation, previous.spacing.separationMeters);
      if (dx * dx + dz * dz < required * required) {
        collision = true;
        break;
      }
    }
    if (!collision) accepted.push(point);
  }
  return accepted;
}

export function planEnvironmentCluster({ category = 'tree', centerX = 0, centerZ = 0, radiusMeters = 100, count = 24, distanceMeters = 0, visibility = 1, seed = 0, sample = {} } = {}) {
  const c = normalizeCategory(category);
  const requested = Math.max(0, Math.floor(finite(count)));
  const cap = TERRAIN_ENVIRONMENT_DISTRIBUTION_PLANNER_POLICY.densityCapsPerKm2[c] ?? requested;
  const total = Math.min(requested, cap);
  const points = [];
  for (let ordinal = 0; ordinal < total; ordinal += 1) {
    const point = environmentPointCandidate({ category: c, worldX: centerX, worldZ: centerZ, radiusMeters, ordinal, distanceMeters, visibility, seed: `${seed}:${ordinal}`, sample });
    if (point.accepted) points.push(point);
  }
  const separated = greedySeparation(points);
  return freeze({
    version: 1,
    policyId: TERRAIN_ENVIRONMENT_DISTRIBUTION_PLANNER_POLICY.id,
    category: c,
    center: freeze({ x: finite(centerX), z: finite(centerZ) }),
    radiusMeters: Math.max(0, finite(radiusMeters)),
    requested,
    planned: separated.length,
    rejected: Math.max(0, points.length - separated.length) + Math.max(0, total - points.length),
    points: freeze(separated),
    acceptance: freeze({ ok: true, uniformGrid: false, separationEnforced: true, terrainAuthorityPreserved: true }),
  });
}

export function planEnvironmentClusterSet({ category = 'tree', regions = [], seed = 0 } = {}) {
  const clusters = regions.map((region, index) => planEnvironmentCluster({
    category,
    centerX: region.centerX,
    centerZ: region.centerZ,
    radiusMeters: region.radiusMeters,
    count: region.count,
    distanceMeters: region.distanceMeters,
    visibility: region.visibility,
    sample: region.sample,
    seed: `${seed}:${index}`,
  }));
  return freeze({
    policyId: TERRAIN_ENVIRONMENT_DISTRIBUTION_PLANNER_POLICY.id,
    category: normalizeCategory(category),
    clusters,
    summary: freeze({ regions: clusters.length, planned: clusters.reduce((sum, cluster) => sum + cluster.planned, 0) }),
  });
}

export function planBiomeDistribution({ categories = ['tree', 'shrub', 'grass', 'rock'], regions = [], seed = 0 } = {}) {
  const plans = categories.map((category) => planEnvironmentClusterSet({ category, regions, seed: `${seed}:${category}` }));
  return freeze({
    policyId: TERRAIN_ENVIRONMENT_DISTRIBUTION_PLANNER_POLICY.id,
    plans,
    summary: freeze({ categories: plans.length, planned: plans.reduce((sum, plan) => sum + plan.summary.planned, 0) }),
    acceptance: freeze({ ok: true, deterministic: true, uniformGrid: false }),
  });
}

export function distributionAudit(cluster) {
  const errors = [];
  const points = cluster?.points ?? [];
  if (cluster?.acceptance?.uniformGrid) errors.push('uniform-grid');
  for (const point of points) {
    if (!point.accepted) errors.push('rejected-point-present');
    if (!Number.isFinite(point.candidateWorld?.x) || !Number.isFinite(point.candidateWorld?.z)) errors.push('non-finite-position');
    if (!(point.spacing?.separationMeters > 0)) errors.push('invalid-spacing');
  }
  return freeze({ ok: errors.length === 0, errors: freeze(errors), count: points.length });
}
