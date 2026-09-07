/**
 * Public terrain/environment contract facade.
 *
 * Other gameplay owners need terrain facts without importing or rewriting the terrain renderer. This
 * facade combines the render-only surface fabric, terrain/environment profiles and verified authored
 * asset registry into small, deterministic query functions. It deliberately does not attach an object
 * to a scene and therefore cannot bypass MaterialAssignmentCore or WorldAssetPlacementPipeline.
 *
 * @module world/terrainEnvironmentContract
 */

import {
  TERRAIN_SURFACE_FABRIC_POLICY,
  buildTerrainSurfaceManifest,
  terrainSurfaceReliefContext,
  terrainSurfaceColorMultiplier,
  terrainSurfaceRoughness,
  terrainSurfaceNormalGain,
  chooseTerrainSubstrate,
} from './terrainSurfaceFabric.js';
import {
  TERRAIN_ENVIRONMENT_PROFILE_POLICY,
  resolveTerrainEnvironmentProfile,
  environmentSurfaceScore,
  validateTerrainEnvironmentPlacement,
  deterministicAssetTransform,
  makeEnvironmentAssetManifest,
} from './terrainEnvironmentProfiles.js';
import {
  ENVIRONMENT_ASSET_REGISTRY_POLICY,
  findVerifiedEnvironmentAsset,
  selectVerifiedEnvironmentCandidates,
  environmentAssetRequirement,
  validateVerifiedEnvironmentAsset,
  environmentAssetPlacementPlan,
  deterministicEnvironmentSeed,
} from './terrainEnvironmentAssetRegistry.js';

const freeze = (value) => Object.freeze(value);

export const TERRAIN_ENVIRONMENT_CONTRACT = freeze({
  id: 'buzul-muhafizi-terrain-environment-contract-2026-09-07-v1',
  surfaceFabricPolicyId: TERRAIN_SURFACE_FABRIC_POLICY.id,
  environmentProfilePolicyId: TERRAIN_ENVIRONMENT_PROFILE_POLICY.id,
  assetRegistryPolicyId: ENVIRONMENT_ASSET_REGISTRY_POLICY.id,
  sequence: freeze([
    'asset-hydrate',
    'surface-analysis',
    'material-recipe',
    'material-validation',
    'ground-transform',
    'placement-manifest',
    'scene-attach',
  ]),
  canonicalAuthorities: freeze({
    height: 'src/3d/world/terrain.js',
    material: 'src/3d/materials/MaterialAssignmentCore.js',
    placement: 'src/3d/world/WorldAssetPlacementPipeline.js',
  }),
  forbiddenShortcuts: freeze([
    'procedural-placeholder',
    'editor-runtime-import',
    'scene-attach-before-material-validation',
    'scene-attach-before-ground-validation',
    'canonical-height-modification-from-visual-fabric',
    'canonical-hydrology-modification-from-visual-fabric',
  ]),
});

export function analyzeTerrainSurfaceForEnvironment(sample = {}) {
  const context = terrainSurfaceReliefContext(sample);
  return freeze({
    contractId: TERRAIN_ENVIRONMENT_CONTRACT.id,
    substrate: chooseTerrainSubstrate(context),
    context,
    response: freeze({
      colorMultiplier: terrainSurfaceColorMultiplier(context),
      roughness: terrainSurfaceRoughness(context),
      normalGain: terrainSurfaceNormalGain(context),
    }),
    manifest: buildTerrainSurfaceManifest({
      sample,
      materialPolicyId: TERRAIN_SURFACE_FABRIC_POLICY.id,
      sourceMapPolicyId: sample.sourceMapPolicyId || null,
    }),
  });
}

export function queryTerrainEnvironmentAssetFamily(category, context = {}) {
  const profile = resolveTerrainEnvironmentProfile(category, context.metadata || {});
  const requirement = environmentAssetRequirement(category);
  const candidates = selectVerifiedEnvironmentCandidates(category, {
    biome: context.biome,
    climate: context.climate,
    winter: Boolean(context.winter),
  });
  return freeze({
    contractId: TERRAIN_ENVIRONMENT_CONTRACT.id,
    category: profile?.category || null,
    profile,
    requirement,
    candidates,
  });
}

export function prepareTerrainEnvironmentAssetContext(asset, {
  category = asset?.category,
  worldX = 0,
  worldZ = 0,
  seedOrdinal = 0,
  biome = '',
  climate = '',
  winter = false,
  sample = {},
} = {}) {
  const profile = resolveTerrainEnvironmentProfile(category, asset || {});
  const registryAsset = asset?.src || asset?.id ? findVerifiedEnvironmentAsset(asset.src || asset.id) : null;
  const chosenAsset = registryAsset || asset || null;
  const validation = validateVerifiedEnvironmentAsset(chosenAsset, { category, sample });
  const placementProfile = profile;
  const surfaceScore = environmentSurfaceScore(placementProfile, {
    slopeDegrees: sample.slopeDegrees ?? sample.slope,
    heightMeters: sample.heightMeters ?? sample.height,
    moisture: sample.moisture,
    waterDepth: sample.waterDepth,
    biome: sample.biome,
    roadDistance: sample.roadDistance,
    settlementDistance: sample.settlementDistance,
  });
  const placementValidation = validateTerrainEnvironmentPlacement(placementProfile, sample);
  const seed = deterministicEnvironmentSeed(chosenAsset?.id || category, worldX, worldZ);
  const transform = deterministicAssetTransform(seed, seedOrdinal, placementProfile);
  const plan = environmentAssetPlacementPlan(chosenAsset || {}, {
    category,
    worldX,
    worldZ,
    biome,
    climate,
    winter,
    sample,
  });
  return freeze({
    contractId: TERRAIN_ENVIRONMENT_CONTRACT.id,
    asset: chosenAsset,
    profile: placementProfile,
    registry: freeze({ verified: Boolean(registryAsset), validation }),
    surface: freeze({ score: surfaceScore, validation: placementValidation, analysis: analyzeTerrainSurfaceForEnvironment({ ...sample, worldX, worldZ }) }),
    transform,
    plan,
    attachAllowed: Boolean(
      chosenAsset
      && registryAsset
      && validation.ok
      && placementValidation.ok
      && surfaceScore > 0
      && plan.material.required
      && plan.placement.manifestRequired,
    ),
  });
}

export function finalizeTerrainEnvironmentManifest(context, {
  materialManifest = null,
  placementManifest = null,
} = {}) {
  if (!context || typeof context !== 'object') return null;
  return makeEnvironmentAssetManifest({
    asset: context.asset || {},
    profile: context.profile || null,
    sample: context.surface?.analysis?.context || {},
    materialManifest,
    placementManifest,
    transform: context.transform || null,
  });
}

export function assertTerrainEnvironmentAttachReady(context) {
  const errors = [];
  if (!context?.asset) errors.push('missing-asset');
  if (!context?.registry?.verified) errors.push('asset-not-verified');
  if (!context?.registry?.validation?.ok) errors.push('asset-validation-failed');
  if (!context?.surface?.validation?.ok) errors.push('surface-placement-failed');
  if (!(context?.surface?.score > 0)) errors.push('surface-score-zero');
  if (!context?.plan?.material?.required) errors.push('material-contract-missing');
  if (!context?.plan?.placement?.required) errors.push('placement-contract-missing');
  if (!context?.plan?.placement?.manifestRequired) errors.push('placement-manifest-missing');
  return freeze({ ok: errors.length === 0, errors });
}

export function environmentContextForOtherOwners(category, sample = {}, asset = {}) {
  const context = prepareTerrainEnvironmentAssetContext(asset, {
    category,
    worldX: sample.worldX,
    worldZ: sample.worldZ,
    biome: sample.biome,
    climate: sample.climate,
    winter: sample.winter,
    sample,
  });
  const gate = assertTerrainEnvironmentAttachReady(context);
  return freeze({
    contractId: TERRAIN_ENVIRONMENT_CONTRACT.id,
    queryOnly: true,
    gate,
    asset: context.asset,
    profile: context.profile,
    surfaceScore: context.surface.score,
    deterministicTransform: context.transform,
    materialAuthority: TERRAIN_ENVIRONMENT_CONTRACT.canonicalAuthorities.material,
    placementAuthority: TERRAIN_ENVIRONMENT_CONTRACT.canonicalAuthorities.placement,
    heightAuthority: TERRAIN_ENVIRONMENT_CONTRACT.canonicalAuthorities.height,
    waterAuthority: 'map/Pindex hydrology',
  });
}

export function validateTerrainEnvironmentContract() {
  const errors = [];
  if (!TERRAIN_ENVIRONMENT_CONTRACT.canonicalAuthorities.height) errors.push('missing-height-authority');
  if (!TERRAIN_ENVIRONMENT_CONTRACT.canonicalAuthorities.material) errors.push('missing-material-authority');
  if (!TERRAIN_ENVIRONMENT_CONTRACT.canonicalAuthorities.placement) errors.push('missing-placement-authority');
  if (TERRAIN_ENVIRONMENT_CONTRACT.sequence.join('>') !== 'asset-hydrate>surface-analysis>material-recipe>material-validation>ground-transform>placement-manifest>scene-attach') {
    errors.push('invalid-operation-sequence');
  }
  if (TERRAIN_SURFACE_FABRIC_POLICY.canonicalHeightUnchanged !== true) errors.push('surface-fabric-height-bypass');
  if (TERRAIN_SURFACE_FABRIC_POLICY.canonicalHydrologyUnchanged !== true) errors.push('surface-fabric-hydrology-bypass');
  if (ENVIRONMENT_ASSET_REGISTRY_POLICY.placeholderAllowed !== false) errors.push('placeholder-policy-open');
  return freeze({ ok: errors.length === 0, errors, contractId: TERRAIN_ENVIRONMENT_CONTRACT.id });
}
