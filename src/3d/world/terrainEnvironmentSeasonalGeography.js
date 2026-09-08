/**
 * Seasonal geography response matrix for authored environment assets.
 *
 * Seasonal adaptation is represented as weights and material/environment descriptors only.
 * It never creates geometry, edits terrain height, changes hydrology, or changes collider data.
 */

import { TERRAIN_ENVIRONMENT_PROFILE_POLICY, resolveTerrainEnvironmentProfile } from './terrainEnvironmentProfiles.js';
import { VERIFIED_ENVIRONMENT_ASSETS } from './terrainEnvironmentAssetRegistry.js';
import { VERIFIED_ROCK_ENVIRONMENT_ASSETS } from './terrainEnvironmentRockAssetCatalog.js';
import { climateMaterialResponse, climateExposureEnvelope, seasonalAssetWeights, resolveClimateMaterialFamily } from './terrainEnvironmentClimateTransitions.js';

const freeze = (value) => Object.freeze(value);
const norm = (value) => String(value ?? '').trim().toLowerCase();
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp01 = (value) => Math.max(0, Math.min(1, finite(value)));

export const TERRAIN_ENVIRONMENT_SEASONAL_GEOGRAPHY_POLICY = freeze({
  id: 'terrain-environment-seasonal-geography-2026-09-08-v1',
  deterministic: true,
  authoredOnly: true,
  noGeometryCreation: true,
  noProceduralReplacement: true,
  terrainMutation: false,
  hydrologyMutation: false,
  colliderMutation: false,
  seasons: freeze(['spring', 'summer', 'autumn', 'winter']),
  climateFamilies: freeze(['temperate', 'meadow', 'forest', 'forest-edge', 'heath', 'tundra', 'alpine-bare', 'wetland', 'dryland', 'hot-arid']),
  materialAuthority: TERRAIN_ENVIRONMENT_PROFILE_POLICY.materialAuthority,
  placementAuthority: TERRAIN_ENVIRONMENT_PROFILE_POLICY.placementAuthority,
});

const SEASON_CURVES = freeze({
  spring: freeze({ green: 0.74, dry: 0.20, snow: 0.06, leafDrop: 0.12, mud: 0.56, exposedRock: 0.54, wind: 0.38 }),
  summer: freeze({ green: 0.92, dry: 0.31, snow: 0.01, leafDrop: 0.02, mud: 0.24, exposedRock: 0.60, wind: 0.34 }),
  autumn: freeze({ green: 0.48, dry: 0.34, snow: 0.08, leafDrop: 0.56, mud: 0.42, exposedRock: 0.58, wind: 0.46 }),
  winter: freeze({ green: 0.13, dry: 0.18, snow: 0.69, leafDrop: 0.83, mud: 0.17, exposedRock: 0.49, wind: 0.68 }),
});

const BIOME_SEASON_MODIFIERS = freeze({
  forest: freeze({ spring: 1.06, summer: 1.12, autumn: 1.02, winter: 0.66 }),
  'forest-edge': freeze({ spring: 1.04, summer: 1.06, autumn: 1.07, winter: 0.82 }),
  meadow: freeze({ spring: 1.12, summer: 1.18, autumn: 0.78, winter: 0.46 }),
  heath: freeze({ spring: 0.92, summer: 0.98, autumn: 1.06, winter: 0.74 }),
  tundra: freeze({ spring: 0.68, summer: 0.52, autumn: 0.74, winter: 1.28 }),
  'alpine-bare': freeze({ spring: 0.54, summer: 0.58, autumn: 0.64, winter: 1.34 }),
  wetland: freeze({ spring: 1.08, summer: 0.92, autumn: 0.96, winter: 0.52 }),
  dryland: freeze({ spring: 0.88, summer: 1.12, autumn: 1.08, winter: 0.82 }),
});

const CATEGORY_SEASONAL_BIAS = freeze({
  tree: freeze({ spring: 1.08, summer: 1.13, autumn: 0.88, winter: 0.62 }),
  'dead-tree': freeze({ spring: 0.84, summer: 0.82, autumn: 1.04, winter: 1.16 }),
  'snow-dead-tree': freeze({ spring: 0.22, summer: 0.06, autumn: 0.34, winter: 1.42 }),
  crop: freeze({ spring: 1.20, summer: 1.26, autumn: 0.92, winter: 0.14 }),
  'ground-prop': freeze({ spring: 1.0, summer: 1.0, autumn: 0.94, winter: 0.70 }),
  rock: freeze({ spring: 0.94, summer: 1.02, autumn: 0.99, winter: 0.90 }),
  cliff: freeze({ spring: 0.96, summer: 1.01, autumn: 1.02, winter: 0.94 }),
  scree: freeze({ spring: 0.92, summer: 1.04, autumn: 1.06, winter: 0.96 }),
  prop: freeze({ spring: 1.02, summer: 1.02, autumn: 1.0, winter: 0.82 }),
});

function seasonCurve(season) {
  return SEASON_CURVES[norm(season)] ?? SEASON_CURVES.spring;
}

function biomeModifier(biome, season) {
  return BIOME_SEASON_MODIFIERS[norm(biome)]?.[norm(season)] ?? 1;
}

function categoryModifier(category, season) {
  return CATEGORY_SEASONAL_BIAS[norm(category)]?.[norm(season)] ?? 1;
}

function temperatureScore(sample) {
  const thermal = finite(sample?.thermalWeight, finite(sample?.temperatureWeight, 0.5));
  return clamp01(1 - Math.abs(thermal - 0.52) * 0.92);
}

function snowEnvelope(sample, season) {
  const curve = seasonCurve(season);
  const snowDepth = Math.max(0, finite(sample?.snowDepthMeters));
  const elevation = finite(sample?.heightAboveSeaMeters);
  const altitudeSnow = clamp01((elevation - 640) / 1180);
  const depthSnow = clamp01(snowDepth / 0.75);
  const winterBoost = norm(season) === 'winter' ? 0.42 : 0;
  return clamp01(altitudeSnow * 0.48 + depthSnow * 0.43 + curve.snow * 0.09 + winterBoost);
}

function slopeSeasonScore(sample, category, season) {
  const slope = finite(sample?.slopeDegrees);
  const rockFamily = ['rock', 'cliff', 'scree'].includes(norm(category));
  const leafless = norm(season) === 'winter' || (norm(season) === 'autumn' && norm(category) === 'tree');
  if (rockFamily) return clamp01(0.52 + Math.abs(slope - 28) / 88 + (leafless ? 0.05 : 0));
  return clamp01(1 - Math.max(0, slope - (leafless ? 34 : 29)) / 42);
}

export function seasonalGeometryEnvelope({ season = 'spring', biome = '', category = '', sample = {} } = {}) {
  const curve = seasonCurve(season);
  const snow = snowEnvelope(sample, season);
  const slope = slopeSeasonScore(sample, category, season);
  const moisture = clamp01(sample?.moisture);
  const wind = clamp01(finite(sample?.windExposure, curve.wind));
  const exposure = clamp01(finite(sample?.rockExposure, curve.exposedRock));
  const green = clamp01(curve.green * (0.72 + moisture * 0.36));
  const mud = clamp01(curve.mud * (0.5 + moisture * 0.6));
  const seasonalFactor = clamp01(0.34 + biomeModifier(biome, season) * 0.26 + categoryModifier(category, season) * 0.18 + slope * 0.11 + temperatureScore(sample) * 0.11);
  return freeze({
    season: norm(season),
    biome: norm(biome),
    category: norm(category),
    green,
    snow,
    mud,
    wind,
    exposure,
    leafDrop: curve.leafDrop,
    dry: curve.dry,
    slope,
    seasonalFactor,
    scaleFactor: 0.82 + seasonalFactor * 0.32,
    densityFactor: 0.56 + seasonalFactor * 0.58,
  });
}

export function seasonalAssetScore(asset, { season = 'spring', biome = '', climate = '', category = '', sample = {} } = {}) {
  if (!asset) return freeze({ ok: false, score: 0, errors: freeze(['missing-asset']) });
  const key = norm(category);
  const seasonKey = norm(season);
  const profile = resolveTerrainEnvironmentProfile(key);
  const envelope = seasonalGeometryEnvelope({ season: seasonKey, biome, category: key, sample });
  const explicitSeason = Array.isArray(asset.seasons) && asset.seasons.includes(seasonKey);
  const winterFlag = seasonKey === 'winter' && asset.winter === true;
  const sourceClimateMatch = !climate || !Array.isArray(asset.climates) || asset.climates.map(norm).includes(norm(climate));
  const biomeMatch = !biome || !Array.isArray(asset.biomes) || asset.biomes.map(norm).includes(norm(biome));
  const profileAllowed = !profile?.forbiddenBiomes?.map(norm).includes(norm(biome));
  const seasonExplicitScore = explicitSeason ? 1 : winterFlag ? 0.94 : 0.46;
  const climateScore = sourceClimateMatch ? 1 : 0.24;
  const biomeScore = biomeMatch ? 1 : 0.30;
  const profileScore = profileAllowed ? 1 : 0;
  const familyScore = key && (asset.family === key || asset.families?.includes(key)) ? 1 : 0.42;
  const curveScore = clamp01(envelope.seasonalFactor * 0.82 + seasonExplicitScore * 0.18);
  const score = clamp01(
    seasonExplicitScore * 0.24
      + climateScore * 0.16
      + biomeScore * 0.15
      + profileScore * 0.15
      + familyScore * 0.12
      + envelope.scaleFactor / 1.18 * 0.08
      + envelope.densityFactor / 1.14 * 0.05
      + curveScore * 0.05,
  );
  const errors = [];
  if (!profileAllowed) errors.push(`forbidden-biome:${norm(biome)}`);
  if (!sourceClimateMatch) errors.push(`climate-mismatch:${norm(climate)}`);
  if (!explicitSeason && !winterFlag) errors.push(`season-not-authored:${seasonKey}`);
  return freeze({ ok: errors.length === 0, score, errors: freeze(errors), asset, envelope, profile });
}

function allSeasonAssets() {
  return freeze([...VERIFIED_ENVIRONMENT_ASSETS, ...VERIFIED_ROCK_ENVIRONMENT_ASSETS]);
}

export function rankSeasonalAssets({ season = 'spring', biome = '', climate = '', category = '', sample = {} } = {}) {
  const candidates = allSeasonAssets().filter((asset) => {
    if (['rock', 'cliff', 'scree'].includes(norm(category))) return asset.families?.includes(norm(category));
    return asset.family === norm(category) || asset.families?.includes(norm(category));
  });
  return freeze(candidates
    .map((asset) => seasonalAssetScore(asset, { season, biome, climate, category, sample }))
    .sort((a, b) => b.score - a.score || String(a.asset.id).localeCompare(String(b.asset.id))));
}

export function seasonalEnvironmentResponse({ season = 'spring', biome = '', climate = '', category = '', sample = {} } = {}) {
  const seasonKey = norm(season);
  const biomeKey = norm(biome);
  const climateKey = norm(climate);
  const categoryKey = norm(category);
  const envelope = seasonalGeometryEnvelope({ season: seasonKey, biome: biomeKey, category: categoryKey, sample });
  const material = climateMaterialResponse(climateKey || 'temperate', { biome: biomeKey, season: seasonKey, category: categoryKey, slopeDegrees: sample?.slopeDegrees, moisture: sample?.moisture });
  const family = resolveClimateMaterialFamily(climateKey || 'temperate', { biome: biomeKey, season: seasonKey });
  const exposure = climateExposureEnvelope(climateKey || 'temperate', { biome: biomeKey, season: seasonKey, windExposure: sample?.windExposure, slopeDegrees: sample?.slopeDegrees });
  const weights = seasonalAssetWeights({ biome: biomeKey, season: seasonKey, category: categoryKey });
  const ranked = rankSeasonalAssets({ season: seasonKey, biome: biomeKey, climate: climateKey, category: categoryKey, sample });
  return freeze({
    policyId: TERRAIN_ENVIRONMENT_SEASONAL_GEOGRAPHY_POLICY.id,
    season: seasonKey,
    biome: biomeKey,
    climate: climateKey,
    category: categoryKey,
    envelope,
    material,
    materialFamily: family,
    exposure,
    weights,
    selectedAsset: ranked[0]?.asset ?? null,
    candidateCount: ranked.length,
    candidates: freeze(ranked.slice(0, 8).map((entry) => freeze({ id: entry.asset.id, score: entry.score, ok: entry.ok, errors: entry.errors }))),
  });
}

export function buildSeasonalGeographyMatrix(categories = ['tree', 'dead-tree', 'snow-dead-tree', 'crop', 'rock', 'cliff', 'scree']) {
  const matrix = {};
  for (const category of categories) {
    matrix[category] = {};
    for (const season of TERRAIN_ENVIRONMENT_SEASONAL_GEOGRAPHY_POLICY.seasons) {
      const response = seasonalEnvironmentResponse({
        season,
        biome: ['rock', 'cliff', 'scree'].includes(category) ? 'highland' : category === 'crop' ? 'meadow' : category === 'snow-dead-tree' ? 'tundra' : 'forest',
        climate: category === 'crop' ? 'meadow' : category === 'snow-dead-tree' ? 'tundra' : 'temperate',
        category,
        sample: { moisture: category === 'crop' ? 0.62 : 0.48, slopeDegrees: ['rock', 'cliff', 'scree'].includes(category) ? 26 : 12, heightAboveSeaMeters: category === 'snow-dead-tree' ? 920 : 120 },
      });
      matrix[category][season] = freeze({ selectedAsset: response.selectedAsset?.id ?? null, factor: response.envelope.seasonalFactor, density: response.envelope.densityFactor, snow: response.envelope.snow });
    }
    matrix[category] = freeze(matrix[category]);
  }
  return freeze(matrix);
}

export function seasonalGeographyCoverage() {
  const matrix = buildSeasonalGeographyMatrix();
  const missing = [];
  for (const [category, seasons] of Object.entries(matrix)) {
    for (const season of TERRAIN_ENVIRONMENT_SEASONAL_GEOGRAPHY_POLICY.seasons) {
      if (!seasons[season]?.selectedAsset) missing.push(`${category}:${season}`);
    }
  }
  return freeze({ policyId: TERRAIN_ENVIRONMENT_SEASONAL_GEOGRAPHY_POLICY.id, ok: missing.length === 0, missing: freeze(missing), matrix });
}
