/**
 * Authored natural-rock catalog.
 *
 * The project already contains natural-geology source models. This catalog makes those
 * sources consumable by the terrain environment contract without inventing geometry.
 * Geometry creation, terrain mutation, hydrology mutation and collider ownership remain
 * outside this module.
 */

import { TERRAIN_ENVIRONMENT_PROFILE_POLICY, resolveTerrainEnvironmentProfile } from './terrainEnvironmentProfiles.js';
import { TERRAIN_ENVIRONMENT_ASSET_MANIFEST } from './terrainEnvironmentAssetManifest.js';
import { validateMaterialAssignment } from '../materials/MaterialAssignmentCore.js';

const freeze = (value) => Object.freeze(value);
const norm = (value) => String(value ?? '').trim().replaceAll('\\', '/').replace(/^\.\//, '').toLowerCase();
const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

export const TERRAIN_ENVIRONMENT_ROCK_ASSET_POLICY = freeze({
  id: 'terrain-environment-rock-authored-catalog-2026-09-08-v1',
  authoredOnly: true,
  placeholderAllowed: false,
  proceduralReplacementAllowed: false,
  runtimeGeometryCreation: false,
  terrainMutation: false,
  hydrologyMutation: false,
  colliderMutation: false,
  sourceAuthority: 'repo-assets-and-naturalGeologyPlacement',
  materialAuthority: TERRAIN_ENVIRONMENT_PROFILE_POLICY.materialAuthority,
  placementAuthority: TERRAIN_ENVIRONMENT_PROFILE_POLICY.placementAuthority,
  acceptedCategories: freeze(['rock', 'cliff', 'scree']),
  expectedSourcePrefix: 'assets/models/fbx/',
  primarySources: freeze([
    'assets/models/fbx/rocky_terrain_low_poly.glb',
    'assets/models/fbx/desert_rocks.glb',
  ]),
  referenceOnlySources: freeze([
    'assets/models/fbx/rugged_mountain_landscape.glb',
    'assets/models/fbx/singlemountain.FBX',
    'assets/models/fbx/terrain_01.fbx',
    'assets/models/fbx/snow_terrain_low_poly.glb',
    'assets/models/fbx/sNOWlaNDSCAPE.glb',
  ]),
});

const ROCK_ASSETS = freeze([
  freeze({
    id: 'rocky-terrain-low-poly',
    src: 'assets/models/fbx/rocky_terrain_low_poly.glb',
    role: 'rock',
    families: freeze(['rock', 'cliff', 'scree']),
    climates: freeze(['temperate', 'forest', 'forest-edge', 'highland', 'alpine-bare', 'tundra']),
    biomes: freeze(['forest', 'forest-edge', 'heath', 'tundra', 'alpine-bare', 'meadow']),
    seasons: freeze(['spring', 'summer', 'autumn', 'winter']),
    exposure: freeze({ minSlope: 5, preferredSlope: 24, maxSlope: 58, moistureMin: 0.08, moistureMax: 0.94 }),
    scale: freeze({ min: 0.7, max: 1.55, aspectBias: 1.15 }),
    materialSurfaces: freeze(['rock', 'weathered-rock', 'moss-rock', 'snow']),
    pbr: freeze(['albedo', 'normal', 'roughness']),
    sourceAuthority: 'naturalGeologyPlacement.directAssetFamilies',
    runtimeEligible: true,
  }),
  freeze({
    id: 'desert-rocks',
    src: 'assets/models/fbx/desert_rocks.glb',
    role: 'rock',
    families: freeze(['rock', 'scree']),
    climates: freeze(['dryland', 'hot-arid', 'temperate']),
    biomes: freeze(['dryland', 'heath', 'meadow']),
    seasons: freeze(['spring', 'summer', 'autumn']),
    exposure: freeze({ minSlope: 2, preferredSlope: 17, maxSlope: 61, moistureMin: 0.02, moistureMax: 0.72 }),
    scale: freeze({ min: 0.55, max: 1.25, aspectBias: 1.0 }),
    materialSurfaces: freeze(['rock', 'dry-rock', 'sandstone']),
    pbr: freeze(['albedo', 'normal', 'roughness']),
    sourceAuthority: 'naturalGeologyPlacement.directAssetFamilies',
    runtimeEligible: true,
  }),
]);

const REFERENCE_ROCKS = freeze([
  ...TERRAIN_ENVIRONMENT_ROCK_ASSET_POLICY.referenceOnlySources.map((src, index) => freeze({
    id: `reference-rock-${index + 1}`,
    src,
    role: 'reference',
    runtimeEligible: false,
  })),
]);

export const VERIFIED_ROCK_ENVIRONMENT_ASSETS = ROCK_ASSETS;
export const REFERENCE_ROCK_ENVIRONMENT_ASSETS = REFERENCE_ROCKS;

function manifestEntryForSource(source) {
  const needle = norm(source);
  if (!needle || !Array.isArray(TERRAIN_ENVIRONMENT_ASSET_MANIFEST)) return null;
  return TERRAIN_ENVIRONMENT_ASSET_MANIFEST.find((entry) => {
    const candidates = [entry?.src, entry?.source, entry?.path, entry?.id].map(norm).filter(Boolean);
    return candidates.includes(needle) || candidates.some((candidate) => candidate.endsWith(`/${needle}`));
  }) ?? null;
}

export function findRockEnvironmentAsset(identifier) {
  const needle = norm(identifier);
  if (!needle) return null;
  return ROCK_ASSETS.find((asset) => norm(asset.id) === needle || norm(asset.src) === needle || norm(asset.src).endsWith(`/${needle}`)) ?? null;
}

export function listRockEnvironmentAssetsForCategory(category) {
  const key = norm(category);
  return freeze(ROCK_ASSETS.filter((asset) => asset.families.includes(key)));
}

export function isRockEnvironmentCategory(category) {
  return TERRAIN_ENVIRONMENT_ROCK_ASSET_POLICY.acceptedCategories.includes(norm(category));
}

function scoreRange(value, min, max, preferred) {
  if (!Number.isFinite(value)) return 0.5;
  if (value < min || value > max) return 0;
  const span = Math.max(0.001, Math.max(preferred - min, max - preferred));
  return clamp01(1 - Math.abs(value - preferred) / span);
}

function scoreOptionalSet(value, values) {
  const needle = norm(value);
  if (!needle || !Array.isArray(values) || values.length === 0) return 0.5;
  return values.map(norm).includes(needle) ? 1 : 0;
}

function scoreTerrainContext(asset, sample = {}, season = '') {
  const slope = Number(sample.slopeDegrees);
  const moisture = Number(sample.moisture);
  const slopeScore = scoreRange(slope, asset.exposure.minSlope, asset.exposure.maxSlope, asset.exposure.preferredSlope);
  const moistureScore = Number.isFinite(moisture)
    ? clamp01(1 - Math.max(0, asset.exposure.moistureMin - moisture) - Math.max(0, moisture - asset.exposure.moistureMax))
    : 0.5;
  const biomeScore = scoreOptionalSet(sample.biome, asset.biomes);
  const climateScore = scoreOptionalSet(sample.climate, asset.climates);
  const seasonScore = scoreOptionalSet(season, asset.seasons);
  const altitude = Number(sample.heightAboveSeaMeters);
  const altitudeScore = Number.isFinite(altitude) ? clamp01((altitude + 15) / 380) : 0.5;
  return freeze({ slopeScore, moistureScore, biomeScore, climateScore, seasonScore, altitudeScore });
}

export function scoreRockEnvironmentAsset(asset, {
  category = 'rock',
  sample = {},
  season = '',
  materialAssignment = null,
} = {}) {
  const normalized = findRockEnvironmentAsset(asset?.src ?? asset?.id);
  if (!normalized || !isRockEnvironmentCategory(category)) {
    return freeze({ ok: false, score: 0, errors: freeze(['unverified-rock-asset-or-category']) });
  }
  const profile = resolveTerrainEnvironmentProfile(category);
  const range = scoreTerrainContext(normalized, sample, season);
  const profileAllowed = !profile?.forbiddenBiomes?.includes(norm(sample.biome));
  const categoryFit = normalized.families.includes(norm(category)) ? 1 : 0;
  const manifestEntry = manifestEntryForSource(normalized.src);
  const manifestScore = manifestEntry ? 1 : 0.72;
  let materialScore = 0.5;
  const materialProbe = materialAssignment ?? { surfaces: normalized.materialSurfaces };
  try {
    const validation = validateMaterialAssignment(materialProbe);
    materialScore = validation?.ok === false ? 0.35 : 1;
  } catch {
    materialScore = materialAssignment ? 0.35 : 0.7;
  }
  const score = clamp01(
    categoryFit * 0.16
      + range.slopeScore * 0.22
      + range.moistureScore * 0.14
      + range.biomeScore * 0.16
      + range.climateScore * 0.12
      + range.seasonScore * 0.06
      + range.altitudeScore * 0.04
      + manifestScore * 0.04
      + materialScore * 0.06,
  );
  const errors = [];
  if (!profileAllowed) errors.push(`forbidden-biome:${norm(sample.biome)}`);
  if (categoryFit === 0) errors.push(`category-mismatch:${norm(category)}`);
  if (range.slopeScore === 0) errors.push('slope-out-of-envelope');
  return freeze({ ok: errors.length === 0, score, errors: freeze(errors), asset: normalized, profile, range, manifestEntry, materialScore });
}

export function rankRockEnvironmentAssets({ category = 'rock', sample = {}, season = '', materialAssignment = null } = {}) {
  const ranked = listRockEnvironmentAssetsForCategory(category)
    .map((asset) => scoreRockEnvironmentAsset(asset, { category, sample, season, materialAssignment }))
    .sort((a, b) => b.score - a.score || a.asset.id.localeCompare(b.asset.id));
  return freeze(ranked);
}

export function selectRockEnvironmentAsset(options = {}) {
  const ranked = rankRockEnvironmentAssets(options);
  return ranked.find((entry) => entry.ok) ?? ranked[0] ?? null;
}

export function buildRockAssetManifest() {
  const categories = {};
  for (const category of TERRAIN_ENVIRONMENT_ROCK_ASSET_POLICY.acceptedCategories) {
    categories[category] = ROCK_ASSETS.filter((asset) => asset.families.includes(category)).map((asset) => asset.id);
  }
  return freeze({
    policyId: TERRAIN_ENVIRONMENT_ROCK_ASSET_POLICY.id,
    runtimeEligible: freeze(ROCK_ASSETS.filter((asset) => asset.runtimeEligible).map((asset) => asset.id)),
    categories: freeze(Object.fromEntries(Object.entries(categories).map(([key, value]) => [key, freeze(value)]))),
    primarySources: TERRAIN_ENVIRONMENT_ROCK_ASSET_POLICY.primarySources,
    referenceOnlySources: TERRAIN_ENVIRONMENT_ROCK_ASSET_POLICY.referenceOnlySources,
    authoredOnly: true,
  });
}

export function validateRockAssetCoverage() {
  const errors = [];
  for (const category of TERRAIN_ENVIRONMENT_ROCK_ASSET_POLICY.acceptedCategories) {
    const matches = listRockEnvironmentAssetsForCategory(category);
    if (matches.length === 0) errors.push(`no-authored-asset:${category}`);
  }
  for (const source of TERRAIN_ENVIRONMENT_ROCK_ASSET_POLICY.primarySources) {
    if (!findRockEnvironmentAsset(source)) errors.push(`missing-catalog-source:${norm(source)}`);
  }
  return freeze({ ok: errors.length === 0, errors: freeze(errors), manifest: buildRockAssetManifest(), assetCount: ROCK_ASSETS.length });
}

export function explainRockSelection(options = {}) {
  const ranked = rankRockEnvironmentAssets(options);
  return freeze({
    category: norm(options.category ?? 'rock'),
    selected: ranked[0]?.asset?.id ?? null,
    candidates: freeze(ranked.map((entry) => freeze({ id: entry.asset.id, score: entry.score, ok: entry.ok, errors: entry.errors }))),
    policyId: TERRAIN_ENVIRONMENT_ROCK_ASSET_POLICY.id,
  });
}
