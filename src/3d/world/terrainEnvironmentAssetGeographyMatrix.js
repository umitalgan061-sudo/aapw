/**
 * Geographic suitability matrix for authored environment assets.
 *
 * This module bridges asset metadata and canonical environmental samples. It does not instantiate
 * geometry. The output is a deterministic suitability score and an explainable rejection reason.
 */
import { TERRAIN_ENVIRONMENT_ASSET_MANIFEST } from './terrainEnvironmentAssetManifest.js';
import { resolveTerrainEnvironmentProfile, environmentSurfaceScore } from './terrainEnvironmentProfiles.js';
import { biomeTransitionWeights, climateExposureEnvelope, seasonalAssetWeights } from './terrainEnvironmentClimateTransitions.js';
import { ecotoneComposition, moistureDistributionWeight, slopeDistributionWeight, rockExposureWeight, snowDriftWeight } from './terrainEnvironmentSpatialPolicy.js';
import { materialResponseForRole, classifyAssetSurfaceRoles } from './terrainEnvironmentMaterialDirector.js';

const freeze = (value) => Object.freeze(value);
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : min));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const keyOf = (value) => String(value ?? '').trim().toLowerCase();

export const TERRAIN_ENVIRONMENT_ASSET_GEOGRAPHY_POLICY = freeze({
  id: 'terrain-environment-asset-geography-matrix-2026-09-07-v1',
  deterministic: true,
  noGeometryInstantiation: true,
  authoredAssetOnly: true,
  canonicalTerrainAuthority: 'src/3d/world/terrain.js',
  canonicalHydrologyAuthority: 'map/Pindex hydrology',
  materialAuthority: 'src/3d/materials/MaterialAssignmentCore.js',
  placementAuthority: 'src/3d/world/WorldAssetPlacementPipeline.js',
  scoring: freeze({ profile: 0.34, biome: 0.23, climate: 0.15, spatial: 0.16, season: 0.07, material: 0.05 }),
  forbiddenWaterDepthMeters: 0.05,
});

const FAMILY_CONTEXTS = freeze({
  tree: freeze(['forest', 'forest-edge', 'meadow', 'lowland', 'heath', 'tundra-edge']),
  shrub: freeze(['forest-edge', 'meadow', 'wet-meadow', 'heath', 'tundra']),
  grass: freeze(['meadow', 'wet-meadow', 'lowland', 'forest-edge', 'heath', 'tundra']),
  flower: freeze(['meadow', 'wet-meadow', 'garden', 'settlement-envelope']),
  crop: freeze(['lowland', 'meadow', 'settlement-envelope', 'farm']),
  rock: freeze(['mountain', 'highland', 'alpine-bare', 'tundra', 'rocky-coast', 'dry-upland']),
  cliff: freeze(['mountain', 'highland', 'alpine-bare', 'tundra', 'rocky-coast']),
  scree: freeze(['mountain', 'highland', 'alpine-bare', 'tundra']),
  snow: freeze(['tundra', 'alpine-bare', 'glacier', 'mountain']),
  prop: freeze(['settlement', 'farm', 'roadside', 'dock', 'garden', 'shrine', 'camp', 'warehouse']),
});

function familyForAsset(asset = {}) {
  const family = keyOf(asset.family || asset.category);
  if (family.includes('snow')) return 'snow';
  if (family.includes('rock') || family === 'boulder') return 'rock';
  if (family.includes('cliff')) return 'cliff';
  if (family.includes('scree') || family.includes('talus')) return 'scree';
  if (['tree', 'dead-tree', 'twisted-tree', 'winter-tree', 'snow-dead-tree'].includes(family)) return 'tree';
  if (['shrub', 'fern'].includes(family)) return 'shrub';
  if (['grass', 'grass-ground-cover', 'flower-grass'].includes(family)) return 'grass';
  if (['flower'].includes(family)) return 'flower';
  if (['crop', 'ground-prop'].includes(family)) return 'crop';
  if (family === 'prop') return 'prop';
  return family;
}

function assetBySource(src) {
  const target = keyOf(src);
  return TERRAIN_ENVIRONMENT_ASSET_MANIFEST.find((asset) => keyOf(asset.src) === target) ?? null;
}

function profileSuitability(asset, sample) {
  const category = asset.family === 'snow-dead-tree' ? 'tree' : familyForAsset(asset);
  const profile = resolveTerrainEnvironmentProfile(category, asset);
  if (!profile) return freeze({ score: 0, reason: 'missing-profile', profile: null });
  const slope = finite(sample.slopeDegrees ?? sample.slope);
  const height = finite(sample.heightMeters ?? sample.heightAboveSeaMeters);
  const depth = Math.max(0, finite(sample.waterDepth));
  const validation = environmentSurfaceScore(profile, {
    slopeDegrees: slope,
    heightMeters: height,
    moisture: sample.moisture,
    waterDepth: depth,
    biome: sample.biome,
    roadDistance: sample.roadDistance,
    settlementDistance: sample.settlementDistance,
  });
  return freeze({ score: clamp(validation), profile, reason: validation > 0 ? 'profile-fit' : 'profile-reject' });
}

function biomeSuitability(asset, sample) {
  const family = familyForAsset(asset);
  const biome = keyOf(sample.biome);
  if (!biome) return 0.52;
  const explicit = asset.biomes ?? asset.climates ?? [];
  if (explicit.length) {
    const exact = explicit.some((value) => keyOf(value) === biome);
    if (exact) return 1;
  }
  const contexts = FAMILY_CONTEXTS[family] ?? [];
  if (contexts.some((value) => keyOf(value) === biome)) return 0.78;
  const transition = biomeTransitionWeights({ biome, moisture: sample.moisture, elevationMeters: sample.heightAboveSeaMeters ?? sample.heightMeters, slopeDegrees: sample.slopeDegrees, temperatureC: sample.temperatureC });
  if (family === 'tree') return clamp(transition.forest * 0.82 + transition.wetForest * 0.18);
  if (family === 'shrub') return clamp((transition.forest + transition.heath + transition.wetland) / 2.8);
  if (family === 'grass' || family === 'flower') return clamp(transition.meadow * 0.68 + transition.wetland * 0.20 + transition.heath * 0.12);
  if (family === 'rock' || family === 'cliff' || family === 'scree') return clamp(transition.alpine * 0.64 + transition.tundra * 0.18 + transition.heath * 0.10 + (1 - transition.meadow) * 0.08);
  if (family === 'snow') return clamp(transition.tundra * 0.66 + transition.alpine * 0.30);
  return 0.56;
}

function climateSuitability(asset, sample) {
  const family = familyForAsset(asset);
  const climate = climateExposureEnvelope({
    temperatureC: sample.temperatureC,
    moisture: sample.moisture,
    windExposure: sample.windExposure,
    elevationMeters: sample.heightAboveSeaMeters ?? sample.heightMeters,
    biome: sample.biome,
    slopeDegrees: sample.slopeDegrees,
  });
  if (family === 'tree') return clamp(climate.forestScore * 0.56 + climate.heathScore * 0.12 + climate.tundraScore * 0.18 + climate.drylandScore * 0.14);
  if (family === 'shrub') return clamp(climate.forestScore * 0.25 + climate.wetlandScore * 0.40 + climate.heathScore * 0.25 + climate.tundraScore * 0.10);
  if (family === 'grass' || family === 'flower') return clamp(climate.forestScore * 0.12 + climate.wetlandScore * 0.32 + climate.heathScore * 0.26 + climate.drylandScore * 0.30);
  if (family === 'rock' || family === 'cliff' || family === 'scree') return clamp(climate.heathScore * 0.34 + climate.tundraScore * 0.42 + climate.drylandScore * 0.24);
  if (family === 'snow') return clamp(climate.tundraScore * 0.66 + climate.heathScore * 0.12 + climate.forestScore * 0.04 + (climate.elevation.alpine * 0.18));
  return clamp(0.56 + climate.forestScore * 0.12 + climate.drylandScore * 0.08);
}

function spatialSuitability(asset, sample) {
  const family = familyForAsset(asset);
  const slope = slopeDistributionWeight({ slopeDegrees: sample.slopeDegrees, category: family === 'cliff' ? 'cliff' : family });
  const moisture = moistureDistributionWeight({ moisture: sample.moisture, biome: sample.biome, elevationMeters: sample.heightAboveSeaMeters ?? sample.heightMeters, waterDistanceMeters: sample.waterDistanceMeters });
  const rock = rockExposureWeight({ slopeDegrees: sample.slopeDegrees, ridgeWeight: sample.ridgeWeight, substrateRock: sample.rockWeight });
  const snow = snowDriftWeight({ snowWeight: sample.snowWeight, windward: sample.windward, lee: sample.lee, exposedRock: sample.rockWeight, slopeDegrees: sample.slopeDegrees });
  const composition = ecotoneComposition(family === 'snow' ? 'snow-patch' : family, { ...sample, worldX: sample.worldX, worldZ: sample.worldZ, distanceFromGroveCenterMeters: sample.distanceFromGroveCenterMeters, groveRadiusMeters: sample.groveRadiusMeters });
  if (family === 'tree') return clamp(slope * 0.24 + moisture * 0.16 + composition.densityMultiplier / 2.2 * 0.60);
  if (family === 'shrub') return clamp(slope * 0.20 + moisture * 0.22 + composition.densityMultiplier / 2.2 * 0.58);
  if (family === 'grass' || family === 'flower') return clamp(slope * 0.18 + moisture * 0.30 + composition.densityMultiplier / 2.2 * 0.52);
  if (family === 'rock') return clamp(slope * 0.30 + rock * 0.44 + composition.densityMultiplier / 2.2 * 0.26);
  if (family === 'cliff' || family === 'scree') return clamp(slope * 0.34 + rock * 0.44 + composition.densityMultiplier / 2.2 * 0.22);
  if (family === 'snow') return clamp(snow * 0.68 + slope * 0.12 + composition.densityMultiplier / 2.2 * 0.20);
  return clamp(0.48 + composition.densityMultiplier / 2.2 * 0.28);
}

function seasonalSuitability(asset, sample) {
  const season = seasonalAssetWeights({ season: sample.season, snowWeight: sample.snowWeight, temperatureC: sample.temperatureC, biome: sample.biome, moisture: sample.moisture, windExposure: sample.windExposure });
  const family = familyForAsset(asset);
  if (family === 'tree') return clamp(sample.winter ? season.winterVegetation * 0.72 + season.dormantLeaf * 0.28 : 1 - season.winterVegetation * 0.16);
  if (family === 'snow') return clamp(sample.winter ? 0.78 + season.winterVegetation * 0.22 : sample.snowWeight * 0.72);
  if (family === 'flower') return clamp(0.32 + season.flowering * 0.68);
  if (family === 'grass') return clamp(0.48 + season.dryGrass * 0.18 + season.wetGrowth * 0.34);
  return 0.62;
}

function materialSuitability(asset, sample) {
  const roles = classifyAssetSurfaceRoles(asset);
  if (!roles.length) return 0.30;
  const values = roles.map((role) => materialResponseForRole(role, {
    biome: sample.biome,
    moisture: sample.moisture,
    temperatureC: sample.temperatureC,
    exposure: sample.windExposure,
    rockWeight: sample.rockWeight,
    snowWeight: sample.snowWeight,
  }));
  const physicallyPlausible = values.filter((value) => value.roughness >= 0.34 && value.roughness <= 1 && value.normalStrength > 0).length;
  return clamp((physicallyPlausible / values.length) * 0.72 + Math.min(1, values.length / 3) * 0.28);
}

export function scoreEnvironmentAssetGeography(asset, sample = {}) {
  const source = typeof asset === 'string' ? assetBySource(asset) : asset;
  if (!source) return freeze({ score: 0, accepted: false, reasons: ['asset-not-found'] });
  const waterDepth = Math.max(0, finite(sample.waterDepth));
  if (waterDepth > TERRAIN_ENVIRONMENT_ASSET_GEOGRAPHY_POLICY.forbiddenWaterDepthMeters && familyForAsset(source) !== 'prop') {
    return freeze({ score: 0, accepted: false, reasons: ['water-depth'], asset: source });
  }
  const profile = profileSuitability(source, sample);
  const biome = biomeSuitability(source, sample);
  const climate = climateSuitability(source, sample);
  const spatial = spatialSuitability(source, sample);
  const season = seasonalSuitability(source, sample);
  const material = materialSuitability(source, sample);
  const weights = TERRAIN_ENVIRONMENT_ASSET_GEOGRAPHY_POLICY.scoring;
  const score = clamp(profile.score * weights.profile + biome * weights.biome + climate * weights.climate + spatial * weights.spatial + season * weights.season + material * weights.material);
  const reasons = [];
  if (profile.score <= 0) reasons.push('profile-mismatch');
  if (biome < 0.28) reasons.push('biome-mismatch');
  if (climate < 0.28) reasons.push('climate-mismatch');
  if (spatial < 0.26) reasons.push('spatial-mismatch');
  if (season < 0.24) reasons.push('season-mismatch');
  if (material < 0.55) reasons.push('material-incomplete');
  return freeze({
    score,
    accepted: score >= 0.50 && reasons.length < 3,
    asset: source,
    family: familyForAsset(source),
    dimensions: freeze({ profile: profile.score, biome, climate, spatial, season, material }),
    profile: profile.profile,
    reasons: freeze(reasons),
  });
}

export function rankEnvironmentAssetsForGeography({ category = 'tree', sample = {}, limit = 8 } = {}) {
  const key = keyOf(category);
  const candidates = TERRAIN_ENVIRONMENT_ASSET_MANIFEST
    .filter((asset) => {
      const family = familyForAsset(asset);
      if (key === 'tree') return family === 'tree';
      if (key === 'shrub') return family === 'shrub';
      if (key === 'grass') return family === 'grass' || family === 'flower' || family === 'crop';
      if (key === 'rock') return family === 'rock';
      if (key === 'cliff') return family === 'cliff';
      if (key === 'scree') return family === 'scree';
      if (key === 'snow-patch' || key === 'snow') return family === 'snow';
      return family === key;
    })
    .map((asset, index) => ({ asset, result: scoreEnvironmentAssetGeography(asset, sample), index }))
    .sort((a, b) => b.result.score - a.result.score || a.index - b.index)
    .slice(0, Math.max(1, Math.floor(finite(limit, 8))));
  return freeze(candidates);
}

export function buildAssetGeographyManifest({ categories = ['tree', 'shrub', 'grass', 'rock', 'cliff', 'scree', 'snow-patch'], samples = [] } = {}) {
  const entries = categories.map((category) => {
    const rows = samples.map((sample, index) => ({ sampleIndex: index, candidates: rankEnvironmentAssetsForGeography({ category, sample, limit: 6 }) }));
    return { category, rows };
  });
  return freeze({
    version: 1,
    policyId: TERRAIN_ENVIRONMENT_ASSET_GEOGRAPHY_POLICY.id,
    entries,
    acceptance: freeze({ deterministic: true, authoredAssetOnly: true, noGeometryInstantiation: true }),
  });
}

export function explainAssetGeographyDecision(asset, sample = {}) {
  const result = scoreEnvironmentAssetGeography(asset, sample);
  return freeze({
    policyId: TERRAIN_ENVIRONMENT_ASSET_GEOGRAPHY_POLICY.id,
    decision: result.accepted ? 'accept' : 'reject-or-defer',
    score: result.score,
    asset: result.asset ?? null,
    family: result.family ?? null,
    reasons: result.reasons ?? [],
    dimensions: result.dimensions ?? null,
  });
}
