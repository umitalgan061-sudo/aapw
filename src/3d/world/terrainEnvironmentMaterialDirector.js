/**
 * Asset-aware material planning for environment models.
 *
 * This module does not replace MaterialAssignmentCore. It produces a deterministic recipe which that
 * shared authority can consume after the model has been hydrated. Terrain geometry, height,
 * hydrology and collider state are deliberately outside this module.
 */
import { TERRAIN_ENVIRONMENT_CLIMATE_TRANSITION_POLICY, climateMaterialResponse, climateMaterialLayers, seasonalAssetWeights } from './terrainEnvironmentClimateTransitions.js';
import { TERRAIN_ENVIRONMENT_PROFILE_POLICY, resolveTerrainEnvironmentProfile } from './terrainEnvironmentProfiles.js';
import { TERRAIN_ENVIRONMENT_ASSET_MANIFEST } from './terrainEnvironmentAssetManifest.js';

const freeze = (value) => Object.freeze(value);
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const norm = (value) => String(value ?? '').trim().toLowerCase();

export const TERRAIN_ENVIRONMENT_MATERIAL_DIRECTOR_POLICY = freeze({
  id: 'terrain-environment-material-director-2026-09-07-v1',
  deterministic: true,
  recipeOnly: true,
  materialAuthority: TERRAIN_ENVIRONMENT_PROFILE_POLICY.materialAuthority,
  assetManifestAuthority: TERRAIN_ENVIRONMENT_ASSET_MANIFEST.length > 0,
  editorRuntimeImportAllowed: false,
  placeholderAllowed: false,
  preserveAuthoredSurfaceDetail: true,
  reuseGeneratedTextureRecipe: true,
  canonicalHeightMutation: false,
  canonicalHydrologyMutation: false,
});

const SURFACE_ALIASES = freeze({
  bark: ['bark', 'trunk', 'wood', 'deadwood', 'weathered-bark'],
  foliage: ['leaves', 'leaf', 'foliage', 'needle', 'needles', 'pine-foliage'],
  ground: ['ground', 'soil', 'dirt', 'dust', 'mud', 'dry-earth', 'moss'],
  rock: ['rock', 'stone', 'granite', 'basalt', 'quartz', 'moraine', 'scree'],
  snow: ['snow', 'ice', 'packed-snow', 'glacial-ice'],
  metal: ['metal', 'iron', 'metal-band'],
  roof: ['roof', 'tile', 'shingle'],
  wall: ['wall', 'stone-wall', 'plaster'],
  waterEdge: ['wet-rock', 'wet-sediment', 'shoreline'],
});

const BASE_SURFACE_PRESETS = freeze({
  bark: freeze({ colorKey: 'bark', roughness: 0.90, metalness: 0.00, normalStrength: 0.68, detailScaleMeters: 0.20 }),
  foliage: freeze({ colorKey: 'foliage', roughness: 0.86, metalness: 0.00, normalStrength: 0.42, detailScaleMeters: 0.13 }),
  ground: freeze({ colorKey: 'ground', roughness: 0.92, metalness: 0.00, normalStrength: 0.78, detailScaleMeters: 0.32 }),
  rock: freeze({ colorKey: 'rock', roughness: 0.95, metalness: 0.00, normalStrength: 0.74, detailScaleMeters: 0.58 }),
  snow: freeze({ colorKey: 'snow', roughness: 0.83, metalness: 0.00, normalStrength: 0.34, detailScaleMeters: 0.90 }),
  metal: freeze({ colorKey: 'metal', roughness: 0.36, metalness: 0.72, normalStrength: 0.28, detailScaleMeters: 0.11 }),
  roof: freeze({ colorKey: 'roof', roughness: 0.78, metalness: 0.08, normalStrength: 0.34, detailScaleMeters: 0.16 }),
  wall: freeze({ colorKey: 'wall', roughness: 0.88, metalness: 0.00, normalStrength: 0.56, detailScaleMeters: 0.42 }),
  waterEdge: freeze({ colorKey: 'waterEdge', roughness: 0.94, metalness: 0.00, normalStrength: 0.68, detailScaleMeters: 0.24 }),
});

function aliasSetFor(role) {
  return SURFACE_ALIASES[role] ?? [];
}

export function surfaceRoleFromMaterialName(materialName = '') {
  const name = norm(materialName);
  if (!name) return 'ground';
  for (const [role, aliases] of Object.entries(SURFACE_ALIASES)) {
    if (aliases.some((alias) => name.includes(alias))) return role;
  }
  return 'ground';
}

export function surfaceRoleFromManifest(entry = {}) {
  const candidates = [
    ...(entry.materialSurfaces ?? []),
    ...(entry.pbr ?? []),
    entry.family,
    entry.category,
  ].filter(Boolean);
  for (const candidate of candidates) {
    const role = surfaceRoleFromMaterialName(candidate);
    if (role !== 'ground' || norm(candidate) === 'ground') return role;
  }
  return 'ground';
}

export function classifyAssetSurfaceRoles(entry = {}) {
  const roles = [];
  for (const value of [
    ...(entry.materialSurfaces ?? []),
    ...(entry.pbr ?? []),
  ]) {
    const role = surfaceRoleFromMaterialName(value);
    if (!roles.includes(role)) roles.push(role);
  }
  if (!roles.length) roles.push(surfaceRoleFromManifest(entry));
  return freeze(roles);
}

export function surfaceWeatheringFactors({ moisture = 0.5, exposure = 0.5, slopeDegrees = 0, snowWeight = 0, rockWeight = 0, temperatureC = 12 } = {}) {
  const wet = clamp(finite(moisture, 0.5));
  const wind = clamp(finite(exposure, 0.5));
  const slope = clamp(finite(slopeDegrees) / 65);
  const snow = clamp(finite(snowWeight));
  const rock = clamp(finite(rockWeight));
  const cold = clamp((12 - finite(temperatureC, 12)) / 30);
  const abrasion = clamp(0.12 + wind * 0.28 + slope * 0.28 + rock * 0.24);
  const moistureFilm = clamp(wet * 0.62 + (1 - wind) * 0.16 + snow * 0.08);
  const freezeThaw = clamp(cold * 0.44 + snow * 0.34 + slope * 0.12);
  const biologicalFilm = clamp(wet * 0.44 + (1 - slope) * 0.22);
  return freeze({ abrasion, moistureFilm, freezeThaw, biologicalFilm, wet, wind, slope, snow, rock, cold });
}

export function materialResponseForRole(role, context = {}) {
  const key = SURFACE_ALIASES[role] ? role : surfaceRoleFromMaterialName(role);
  const base = BASE_SURFACE_PRESETS[key] ?? BASE_SURFACE_PRESETS.ground;
  const weather = surfaceWeatheringFactors(context);
  const climate = climateMaterialResponse({
    biome: context.biome,
    moisture: weather.wet,
    temperatureC: context.temperatureC,
    exposure: weather.wind,
    rockWeight: weather.rock,
    snowWeight: weather.snow,
  });
  const wetBias = key === 'snow' ? 0.02 : weather.moistureFilm * (key === 'metal' ? -0.08 : -0.045);
  const abrasiveBias = weather.abrasion * (key === 'rock' ? 0.06 : key === 'bark' ? 0.04 : 0.02);
  const freezeBias = weather.freezeThaw * (key === 'rock' || key === 'wall' ? 0.04 : 0.015);
  const albedo = clamp(climate.albedoValue + (key === 'snow' ? weather.snow * 0.08 : 0) - weather.abrasion * 0.035, 0.62, 1.22);
  const roughness = clamp(base.roughness + wetBias + abrasiveBias + freezeBias + climate.roughnessOffset, 0.34, 1.0);
  const normalStrength = clamp(base.normalStrength + weather.freezeThaw * 0.12 + weather.abrasion * 0.08, 0.10, 0.92);
  const mossBlend = key === 'snow' || key === 'metal' ? 0 : clamp(climate.mossBlend * (key === 'rock' || key === 'wall' ? 0.85 : 0.55));
  const frostBlend = key === 'snow' ? clamp(0.68 + weather.freezeThaw * 0.32) : clamp(weather.freezeThaw * 0.24);
  return freeze({
    role: key,
    base,
    albedo,
    roughness,
    metalness: base.metalness,
    normalStrength,
    detailScaleMeters: base.detailScaleMeters,
    mossBlend,
    frostBlend,
    weather,
    climate,
  });
}

export function buildEnvironmentMaterialRecipe({ asset = {}, category = asset.category, biome = '', season = 'summer', winter = false, context = '', sample = {} } = {}) {
  const profile = resolveTerrainEnvironmentProfile(category, asset) ?? null;
  const entry = TERRAIN_ENVIRONMENT_ASSET_MANIFEST.find((candidate) => norm(candidate.src) === norm(asset.src)) ?? asset;
  const roles = classifyAssetSurfaceRoles(entry);
  const climateOptions = {
    biome: sample.biome ?? biome,
    moisture: sample.moisture,
    temperatureC: sample.temperatureC,
    exposure: sample.windExposure,
    rockWeight: sample.rockWeight,
    snowWeight: sample.snowWeight,
  };
  const response = climateMaterialLayers({
    ...climateOptions,
    season,
    windExposure: sample.windExposure,
    winter,
  });
  const layers = roles.map((role) => materialResponseForRole(role, climateOptions));
  const seasonal = seasonalAssetWeights({
    season,
    snowWeight: sample.snowWeight,
    temperatureC: sample.temperatureC,
    biome: sample.biome ?? biome,
    moisture: sample.moisture,
    windExposure: sample.windExposure,
  });
  return freeze({
    policyId: TERRAIN_ENVIRONMENT_MATERIAL_DIRECTOR_POLICY.id,
    profileId: profile?.category ?? null,
    asset: freeze({ id: asset.id ?? entry.id ?? '', src: asset.src ?? entry.src ?? '', family: asset.family ?? entry.family ?? '' }),
    context: freeze({ biome: biome || sample.biome || '', season, winter: Boolean(winter), context }),
    roles,
    layers: freeze(layers),
    climate: response,
    seasonal,
    assignment: freeze({ authority: TERRAIN_ENVIRONMENT_PROFILE_POLICY.materialAuthority, preserveAuthoredSurfaceDetail: true, sharedRecipeRequired: true }),
    acceptance: freeze({ placeholderAllowed: false, editorRuntimeImportAllowed: false, profileResolved: Boolean(profile), surfaceRoleCount: roles.length > 0 }),
  });
}

export function adaptMaterialRecipeForAssignmentCore(recipe) {
  if (!recipe?.layers?.length) return null;
  return freeze({
    sourcePolicyId: TERRAIN_ENVIRONMENT_MATERIAL_DIRECTOR_POLICY.id,
    authority: TERRAIN_ENVIRONMENT_PROFILE_POLICY.materialAuthority,
    generatedTextureRequired: true,
    surfaces: freeze(recipe.layers.map((layer) => freeze({
      role: layer.role,
      colorMultiplier: layer.albedo,
      roughness: layer.roughness,
      metalness: layer.metalness,
      normalStrength: layer.normalStrength,
      worldSpaceDetailMeters: layer.detailScaleMeters,
      mossBlend: layer.mossBlend,
      frostBlend: layer.frostBlend,
    }))),
    climate: recipe.climate,
    seasonal: recipe.seasonal,
  });
}

export function buildMaterialManifest(recipe) {
  const assignment = adaptMaterialRecipeForAssignmentCore(recipe);
  return freeze({
    version: 1,
    policyId: TERRAIN_ENVIRONMENT_MATERIAL_DIRECTOR_POLICY.id,
    asset: recipe?.asset ?? null,
    assignment,
    audit: freeze({
      recipeOnly: true,
      assignmentCoreAuthority: Boolean(assignment?.authority),
      generatedTextureRequired: Boolean(assignment?.generatedTextureRequired),
      authoredDetailPreserved: Boolean(recipe?.assignment?.preserveAuthoredSurfaceDetail),
    }),
  });
}

export function validateEnvironmentMaterialRecipe(recipe) {
  const errors = [];
  if (!recipe) errors.push('missing-recipe');
  if (recipe && !recipe.acceptance?.profileResolved) errors.push('missing-profile');
  if (recipe && !recipe.roles?.length) errors.push('missing-surface-role');
  if (recipe && recipe.layers?.length !== recipe.roles?.length) errors.push('surface-role-layer-mismatch');
  if (recipe?.acceptance?.placeholderAllowed) errors.push('placeholder-policy-open');
  if (recipe?.acceptance?.editorRuntimeImportAllowed) errors.push('editor-runtime-import-open');
  for (const layer of recipe?.layers ?? []) {
    if (!(layer.roughness >= 0.34 && layer.roughness <= 1)) errors.push(`roughness:${layer.role}`);
    if (!(layer.normalStrength > 0 && layer.normalStrength <= 0.92)) errors.push(`normal:${layer.role}`);
  }
  return freeze({ ok: errors.length === 0, errors: freeze(errors), policyId: TERRAIN_ENVIRONMENT_MATERIAL_DIRECTOR_POLICY.id });
}

export function environmentMaterialSurfaceSummary(recipe) {
  return freeze({
    policyId: TERRAIN_ENVIRONMENT_MATERIAL_DIRECTOR_POLICY.id,
    assetId: recipe?.asset?.id ?? '',
    roles: freeze([...(recipe?.roles ?? [])]),
    roughness: freeze((recipe?.layers ?? []).map((layer) => ({ role: layer.role, roughness: layer.roughness }))),
    albedo: freeze((recipe?.layers ?? []).map((layer) => ({ role: layer.role, multiplier: layer.albedo }))),
    seasonal: recipe?.seasonal ?? null,
  });
}

export function materialRoleAliases(role) {
  return freeze([...(aliasSetFor(role) ?? [])]);
}

export function materialDirectorReadiness(recipe) {
  const validation = validateEnvironmentMaterialRecipe(recipe);
  const roleScore = clamp((recipe?.roles?.length ?? 0) / 3);
  const layerScore = clamp((recipe?.layers?.length ?? 0) / Math.max(1, recipe?.roles?.length ?? 1));
  const assignmentScore = recipe?.assignment?.sharedRecipeRequired ? 1 : 0;
  return freeze({
    ok: validation.ok,
    score: clamp(validation.ok ? roleScore * 0.28 + layerScore * 0.36 + assignmentScore * 0.36 : 0),
    validation,
  });
}

export function buildMaterialDirectorMatrix(samples = []) {
  const entries = samples.map((sample) => {
    const recipe = buildEnvironmentMaterialRecipe(sample);
    return freeze({ recipe, readiness: materialDirectorReadiness(recipe), manifest: buildMaterialManifest(recipe) });
  });
  const errors = entries.flatMap((entry) => entry.readiness.validation.errors);
  return freeze({
    version: 1,
    policyId: TERRAIN_ENVIRONMENT_MATERIAL_DIRECTOR_POLICY.id,
    entries,
    acceptance: freeze({ ok: errors.length === 0, errorCount: errors.length }),
    errors: freeze(errors),
  });
}
