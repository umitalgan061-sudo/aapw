/**
 * Asset-first registry for environment families verified against the live repository tree.
 *
 * The registry is intentionally declarative. It never downloads, mutates, replaces or procedurally
 * invents a model. A renderer/placement owner uses these records to choose an existing authored
 * asset, hydrate it through the project's normal loader, then pass the resulting scene graph through
 * MaterialAssignmentCore and WorldAssetPlacementPipeline.
 *
 * The current repository stores environment models under vegetation/, props/, settlements/ and fbx/;
 * there is no canonical assets/models/env directory on the live main tree. A missing family is therefore
 * an asset-availability state, not an invitation to create a cone/cube placeholder.
 *
 * @module world/terrainEnvironmentAssetRegistry
 */

import {
  TERRAIN_ENVIRONMENT_PROFILE_POLICY,
  resolveTerrainEnvironmentProfile,
} from './terrainEnvironmentProfiles.js';

const freeze = (value) => Object.freeze(value);
const list = (values) => freeze([...new Set(values)]);
const asString = (value) => value == null ? '' : String(value).trim().toLowerCase();

export const ENVIRONMENT_ASSET_REGISTRY_POLICY = freeze({
  id: 'verified-world-environment-asset-registry-2026-09-07-v1',
  provenanceBase: 'main@8b5dc527d8d209aa0c30d943e12059178d4df02a',
  sourceDirectories: freeze([
    'assets/models/vegetation',
    'assets/models/props',
    'assets/models/settlements',
    'assets/models/fbx',
    'assets/textures',
  ]),
  canonicalHeightAuthority: 'src/3d/world/terrain.js',
  materialAuthority: 'src/3d/materials/MaterialAssignmentCore.js',
  placementAuthority: 'src/3d/world/WorldAssetPlacementPipeline.js',
  placeholderAllowed: false,
  proceduralReplacementAllowed: false,
  importedMaterialPreservationPreferred: true,
  requireHydratedAssetBeforeSceneAttach: true,
  requireManifestBeforeSceneAttach: true,
});

/**
 * These entries are file names actually observed in the live vegetation/props directories. Their
 * blob sizes are Git LFS pointer-sized in the GitHub contents API, so the pointer is treated as
 * provenance metadata rather than as proof that the runtime asset bytes are absent.
 */
export const VERIFIED_VEGETATION_ASSETS = freeze([
  freeze({
    id: 'vegetation-big-tree-3donimus-61',
    src: 'assets/models/vegetation/big_tree_by_3donimus_dnwh762pn_6_1_na.glb',
    family: 'tree',
    climate: ['temperate', 'lowland', 'meadow'],
    role: 'canopy-tree',
    pbr: ['bark', 'wood', 'leaves', 'moss'],
    winterCompatible: false,
    pointerSha: 'a3e8a4acda7ae5c68c1225041cc28b1f0f935491',
  }),
  freeze({
    id: 'vegetation-big-tree-3donimus-6',
    src: 'assets/models/vegetation/big_tree_by_3donimus_dnwh762pn_6_na.glb',
    family: 'tree',
    climate: ['temperate', 'forest-edge', 'meadow'],
    role: 'canopy-tree',
    pbr: ['bark', 'wood', 'leaves', 'moss'],
    winterCompatible: false,
    pointerSha: 'a3e8a4acda7ae5c68c1225041cc28b1f0f935491',
  }),
  freeze({
    id: 'vegetation-birch-r7',
    src: 'assets/models/vegetation/birch_trees_R7qMWzb7nk.glb',
    family: 'tree',
    climate: ['temperate', 'forest-edge', 'meadow'],
    role: 'light-canopy-tree',
    pbr: ['bark', 'leaves'],
    winterCompatible: true,
    pointerSha: 'a3eff224e386f9edfec57dec225f4d95d4c30d7e',
  }),
  freeze({
    id: 'vegetation-dead-tree-n8',
    src: 'assets/models/vegetation/dead_tree_n8FhMgMldD.glb',
    family: 'dead-tree',
    climate: ['tundra', 'tundra-edge', 'highland', 'forest-edge'],
    role: 'dead-standing-tree',
    pbr: ['weathered-bark', 'deadwood'],
    winterCompatible: true,
    pointerSha: 'e8ad069332fdf40563141b29746028b44466304e',
  }),
  freeze({
    id: 'vegetation-dead-trees-f5',
    src: 'assets/models/vegetation/dead_trees_F5I0Q7TwO5.glb',
    family: 'dead-tree',
    climate: ['tundra', 'tundra-edge', 'highland'],
    role: 'dead-tree-group',
    pbr: ['weathered-bark', 'deadwood'],
    winterCompatible: true,
    pointerSha: '2c35950ebb5f9b90d4a019e5227dea85c531d4f5',
  }),
  freeze({
    id: 'vegetation-dead-snow-iew',
    src: 'assets/models/vegetation/dead_trees_with_snow_iEuwXWner0.glb',
    family: 'snow-dead-tree',
    climate: ['tundra', 'alpine-bare', 'glacier-edge'],
    role: 'snow-covered-dead-tree',
    pbr: ['weathered-bark', 'snow'],
    winterCompatible: true,
    pointerSha: '2b8fbd907d00b847f55bbb50ca1523fbafbc0fd2',
  }),
  freeze({
    id: 'vegetation-fall-tree',
    src: 'assets/models/vegetation/fall_tree_4GYen9Xm3Kj.glb',
    family: 'tree',
    climate: ['temperate', 'heath', 'forest-edge'],
    role: 'seasonal-canopy-tree',
    pbr: ['bark', 'leaves', 'dead-leaf'],
    winterCompatible: true,
    pointerSha: 'cc1b3c26b83cbfb67d9e220f0985b89c3b8987ff',
  }),
  freeze({
    id: 'vegetation-crops',
    src: 'assets/models/vegetation/crops_Ro6K0Yg7mx.glb',
    family: 'crop',
    climate: ['lowland', 'meadow', 'settlement-envelope'],
    role: 'cultivated-ground',
    pbr: ['stem', 'leaf', 'crop-head'],
    winterCompatible: false,
    pointerSha: '9201da198c5e7b8dfdfd255ad80b44ab015f8069',
  }),
]);

export const VERIFIED_PROP_ASSETS = freeze([
  freeze({
    id: 'prop-barrel',
    src: 'assets/models/props/barrel_zjCQP1TAci.glb',
    family: 'prop',
    role: 'storage-barrel',
    context: ['settlement', 'farm', 'dock', 'roadside'],
    pbr: ['wood', 'metal-band'],
    pointerSha: '09cfff50b4181f2001af9c88497c4fae9d5f80c6',
  }),
  freeze({
    id: 'prop-bonfire',
    src: 'assets/models/props/bonfire_Azj9hJwwwG.glb',
    family: 'prop',
    role: 'fire-pit',
    context: ['settlement', 'camp', 'roadside'],
    pbr: ['stone', 'charcoal', 'wood'],
    pointerSha: '02350a0a5fb6e4e497e4988932b5ecdff09e8cef',
  }),
  freeze({
    id: 'prop-candle',
    src: 'assets/models/props/candle_aH83BlSFxJu.glb',
    family: 'prop',
    role: 'small-light',
    context: ['settlement', 'house', 'shrine'],
    pbr: ['wax', 'metal'],
    pointerSha: 'd1dd3ab37a9b12dc42ac2c7962f3369a442d5e5b',
  }),
  freeze({
    id: 'prop-crate',
    src: 'assets/models/props/crate_3OEFd1AWfa.glb',
    family: 'prop',
    role: 'cargo-crate',
    context: ['settlement', 'dock', 'farm', 'warehouse'],
    pbr: ['wood', 'iron'],
    pointerSha: '5d8b15b04a49bc8f711bff3bd36a17121fc5cd5d',
  }),
  freeze({
    id: 'prop-curtains',
    src: 'assets/models/props/curtains_aFWefo0cEFo.glb',
    family: 'prop',
    role: 'house-textile',
    context: ['house', 'settlement'],
    pbr: ['textile'],
    pointerSha: 'ddc2c948f8a45a936ac5c926a473e5e8c28029e3',
  }),
  freeze({
    id: 'prop-farm-dirt',
    src: 'assets/models/props/farm_dirt_8BQFbUMOeC.glb',
    family: 'ground-prop',
    role: 'farm-ground',
    context: ['farm', 'lowland', 'settlement-envelope'],
    pbr: ['soil', 'mud', 'dry-earth'],
    pointerSha: '784f22ed1e001faa558b383a2718a8819707cf66',
  }),
  freeze({
    id: 'prop-greek-stone-bench',
    src: 'assets/models/props/greek_stone_bench.glb',
    family: 'prop',
    role: 'stone-bench',
    context: ['settlement', 'garden', 'roadside'],
    pbr: ['stone', 'moss'],
    pointerSha: '5af6d43bae470298096c5184090b92609563a5c5',
  }),
  freeze({
    id: 'prop-hand-statue',
    src: 'assets/models/props/hand_statue_prop.glb',
    family: 'prop',
    role: 'statue',
    context: ['settlement', 'shrine', 'garden'],
    pbr: ['stone', 'weathering'],
    pointerSha: 'cb6704ebb990269d202575477d49bee5556a3ce7',
  }),
  freeze({
    id: 'prop-athena-arms',
    src: 'assets/models/props/statue_athena_arms.glb',
    family: 'prop',
    role: 'statue-fragment',
    context: ['settlement', 'shrine'],
    pbr: ['stone', 'weathering'],
    pointerSha: '26cb6dd1f42620b143cf11a053f7971540a70d2d',
  }),
]);

export const ASSET_FAMILY_FALLBACK_POLICY = freeze({
  cliff: freeze({ families: ['cliff', 'rock', 'scree'], proceduralFallback: false }),
  rock: freeze({ families: ['rock', 'cliff'], proceduralFallback: false }),
  scree: freeze({ families: ['scree', 'rock'], proceduralFallback: false }),
  tree: freeze({ families: ['tree', 'dead-tree'], proceduralFallback: false }),
  shrub: freeze({ families: ['shrub'], proceduralFallback: false }),
  grass: freeze({ families: ['grass', 'crop'], proceduralFallback: false }),
  snow: freeze({ families: ['snow-patch', 'snow-dead-tree'], proceduralFallback: false }),
  bridge: freeze({ families: ['bridge'], proceduralFallback: false }),
  house: freeze({ families: ['house', 'settlement'], proceduralFallback: false }),
  settlement: freeze({ families: ['settlement', 'house', 'prop'], proceduralFallback: false }),
});

const ALL_ASSETS = freeze([...VERIFIED_VEGETATION_ASSETS, ...VERIFIED_PROP_ASSETS]);

export function normalizeAssetSource(src) {
  return asString(src).replace(/\\/g, '/').replace(/^\.\//, '');
}

export function findVerifiedEnvironmentAsset(identifier) {
  const needle = normalizeAssetSource(identifier);
  if (!needle) return null;
  const exact = ALL_ASSETS.find((asset) => normalizeAssetSource(asset.src) === needle);
  if (exact) return exact;
  const lowered = needle.toLowerCase();
  return ALL_ASSETS.find((asset) => normalizeAssetSource(asset.src).toLowerCase() === lowered)
    || ALL_ASSETS.find((asset) => asset.id === lowered)
    || null;
}

export function listVerifiedEnvironmentAssetsByFamily(family) {
  const key = asString(family);
  return freeze(ALL_ASSETS.filter((asset) => asset.family === key));
}

export function listVerifiedEnvironmentAssetsForContext(context) {
  const key = asString(context);
  return freeze(ALL_ASSETS.filter((asset) => asset.context?.includes(key) || asset.climate?.includes(key)));
}

export function assetFamilyCandidates(category) {
  const profile = resolveTerrainEnvironmentProfile(category);
  const fallback = ASSET_FAMILY_FALLBACK_POLICY[profile?.category || asString(category)];
  return freeze(fallback ? [...fallback.families] : []);
}

export function selectVerifiedEnvironmentCandidates(category, { biome = '', climate = '', winter = false } = {}) {
  const key = asString(category);
  const biomeKey = asString(biome);
  const climateKey = asString(climate);
  const familyOrder = assetFamilyCandidates(key);
  const candidates = [];
  for (const family of familyOrder) {
    for (const asset of ALL_ASSETS) {
      if (asset.family !== family) continue;
      if (winter && asset.winterCompatible === false) continue;
      if (biomeKey && asset.climate && !asset.climate.includes(biomeKey)) continue;
      if (climateKey && asset.climate && !asset.climate.includes(climateKey)) continue;
      if (!candidates.some((item) => item.id === asset.id)) candidates.push(asset);
    }
  }
  return freeze(candidates);
}

export function environmentAssetRequirement(category) {
  const profile = resolveTerrainEnvironmentProfile(category);
  if (!profile) return null;
  const candidates = selectVerifiedEnvironmentCandidates(profile.category);
  return freeze({
    registryPolicyId: ENVIRONMENT_ASSET_REGISTRY_POLICY.id,
    category: profile.category,
    profile,
    candidates,
    hydratedRequired: ENVIRONMENT_ASSET_REGISTRY_POLICY.requireHydratedAssetBeforeSceneAttach,
    manifestRequired: ENVIRONMENT_ASSET_REGISTRY_POLICY.requireManifestBeforeSceneAttach,
    proceduralReplacementAllowed: ENVIRONMENT_ASSET_REGISTRY_POLICY.proceduralReplacementAllowed,
    materialAuthority: ENVIRONMENT_ASSET_REGISTRY_POLICY.materialAuthority,
    placementAuthority: ENVIRONMENT_ASSET_REGISTRY_POLICY.placementAuthority,
  });
}

export function validateVerifiedEnvironmentAsset(asset, { category = null, sample = {} } = {}) {
  const errors = [];
  const warnings = [];
  if (!asset || typeof asset !== 'object') errors.push('missing-asset');
  if (asset?.placeholder === true) errors.push('placeholder-asset');
  if (asset && !normalizeAssetSource(asset.src)) errors.push('missing-source');
  const registryAsset = asset ? findVerifiedEnvironmentAsset(asset.src || asset.id) : null;
  if (!registryAsset) warnings.push('asset-not-in-verified-registry');

  const chosenCategory = category || asset?.category;
  const profile = chosenCategory ? resolveTerrainEnvironmentProfile(chosenCategory, asset) : null;
  if (!profile && chosenCategory) errors.push('missing-terrain-environment-profile');
  if (profile && registryAsset) {
    if (profile.category === 'tree' && registryAsset.family !== 'tree' && registryAsset.family !== 'dead-tree' && registryAsset.family !== 'snow-dead-tree') {
      errors.push('tree-family-mismatch');
    }
    const biome = asString(sample.biome);
    if (biome && profile.forbiddenBiomes.includes(biome)) errors.push(`forbidden-biome:${biome}`);
  }
  return freeze({
    ok: errors.length === 0,
    errors: freeze(errors),
    warnings: freeze(warnings),
    verified: Boolean(registryAsset),
    registryAsset,
    profile,
    policyId: ENVIRONMENT_ASSET_REGISTRY_POLICY.id,
  });
}

export function deterministicEnvironmentSeed(assetId, worldX = 0, worldZ = 0) {
  const source = `${assetId || 'unknown'}:${Number(worldX).toFixed(3)}:${Number(worldZ).toFixed(3)}`;
  let hash = 2166136261;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function environmentAssetPlacementPlan(asset, {
  category = asset?.category,
  worldX = 0,
  worldZ = 0,
  biome = '',
  climate = '',
  winter = false,
  sample = {},
} = {}) {
  const requirement = environmentAssetRequirement(category);
  const validation = validateVerifiedEnvironmentAsset(asset, { category, sample });
  const candidates = requirement
    ? selectVerifiedEnvironmentCandidates(category, { biome, climate, winter })
    : [];
  const chosen = asset?.src ? findVerifiedEnvironmentAsset(asset.src) : candidates[0] || null;
  return freeze({
    policyId: ENVIRONMENT_ASSET_REGISTRY_POLICY.id,
    asset: chosen,
    category: category || null,
    source: chosen?.src || null,
    validation,
    requirement,
    deterministicSeed: deterministicEnvironmentSeed(chosen?.id || asset?.id, worldX, worldZ),
    ground: {
      required: true,
      queryAuthority: 'WorldAssetPlacementPipeline',
      maxSlopeDegrees: requirement?.profile?.maxSlopeDegrees ?? null,
    },
    material: {
      required: true,
      authority: TERRAIN_ENVIRONMENT_PROFILE_POLICY.materialAuthority,
      preferredPalettes: requirement?.profile?.preferredPalettes || [],
      requiredSurfaces: requirement?.profile?.requiredSurfaces || [],
    },
    placement: {
      required: true,
      authority: TERRAIN_ENVIRONMENT_PROFILE_POLICY.placementAuthority,
      manifestRequired: true,
      editorRuntimeImportAllowed: false,
    },
  });
}

export function registrySummary() {
  const familyCounts = {};
  for (const asset of ALL_ASSETS) familyCounts[asset.family] = (familyCounts[asset.family] || 0) + 1;
  return freeze({
    policyId: ENVIRONMENT_ASSET_REGISTRY_POLICY.id,
    provenanceBase: ENVIRONMENT_ASSET_REGISTRY_POLICY.provenanceBase,
    totalVerifiedAssets: ALL_ASSETS.length,
    vegetationAssets: VERIFIED_VEGETATION_ASSETS.length,
    propAssets: VERIFIED_PROP_ASSETS.length,
    familyCounts: freeze({ ...familyCounts }),
    placeholderAllowed: ENVIRONMENT_ASSET_REGISTRY_POLICY.placeholderAllowed,
    proceduralReplacementAllowed: ENVIRONMENT_ASSET_REGISTRY_POLICY.proceduralReplacementAllowed,
    sourceDirectories: [...ENVIRONMENT_ASSET_REGISTRY_POLICY.sourceDirectories],
  });
}
