/** Asset-first authored environment registry. It never invents replacement geometry. */
import { TERRAIN_ENVIRONMENT_PROFILE_POLICY, resolveTerrainEnvironmentProfile } from './terrainEnvironmentProfiles.js';

const freeze = (v) => Object.freeze(v);
const norm = (v) => String(v ?? '').trim().replaceAll('\\', '/').replace(/^\.\//, '').toLowerCase();

export const ENVIRONMENT_ASSET_REGISTRY_POLICY = freeze({
  id: 'terrain-environment-authored-asset-registry-2026-09-08-v2',
  sourceDirectories: freeze(['assets/models/vegetation','assets/models/props','assets/models/settlements','assets/models/fbx','assets/textures']),
  materialAuthority: TERRAIN_ENVIRONMENT_PROFILE_POLICY.materialAuthority,
  placementAuthority: TERRAIN_ENVIRONMENT_PROFILE_POLICY.placementAuthority,
  requireHydratedBeforeAttach: true,
  requireMaterialValidation: true,
  requireGroundValidation: true,
  placeholderAllowed: false,
  proceduralReplacementAllowed: false,
  directNaturalGeologySources: freeze([
    'assets/models/fbx/rocky_terrain_low_poly.glb',
    'assets/models/fbx/desert_rocks.glb',
  ]),
});

export const VERIFIED_ENVIRONMENT_ASSETS = freeze([
  freeze({ id:'big-tree-6-1', src:'assets/models/vegetation/big_tree_by_3donimus_dnwh762pn_6_1_na.glb', family:'tree', climates:['temperate','meadow','forest'], pbr:['bark','wood','leaves','moss'], winter:false }),
  freeze({ id:'big-tree-6', src:'assets/models/vegetation/big_tree_by_3donimus_dnwh762pn_6_na.glb', family:'tree', climates:['temperate','forest-edge','meadow'], pbr:['bark','wood','leaves'], winter:false }),
  freeze({ id:'birch-r7', src:'assets/models/vegetation/birch_trees_R7qMWzb7nk.glb', family:'tree', climates:['temperate','forest-edge','meadow'], pbr:['bark','leaves'], winter:true }),
  freeze({ id:'dead-tree-n8', src:'assets/models/vegetation/dead_tree_n8FhMgMldD.glb', family:'dead-tree', climates:['tundra','highland','forest-edge'], pbr:['weathered-bark','deadwood'], winter:true }),
  freeze({ id:'dead-tree-snow', src:'assets/models/vegetation/dead_trees_with_snow_iEuwXWner0.glb', family:'snow-dead-tree', climates:['tundra','alpine-bare','glacier-edge'], pbr:['weathered-bark','snow'], winter:true }),
  freeze({ id:'fall-tree', src:'assets/models/vegetation/fall_tree_4GYen9Xm3Kj.glb', family:'tree', climates:['temperate','heath','forest-edge'], pbr:['bark','leaves','dead-leaf'], winter:true }),
  freeze({ id:'crop', src:'assets/models/vegetation/crops_Ro6K0Yg7mx.glb', family:'crop', climates:['lowland','meadow','settlement-envelope'], pbr:['stem','leaf','crop-head'], winter:false }),
  freeze({ id:'barrel', src:'assets/models/props/barrel_zjCQP1TAci.glb', family:'prop', contexts:['settlement','farm','dock','roadside'], pbr:['wood','metal-band'] }),
  freeze({ id:'bonfire', src:'assets/models/props/bonfire_Azj9hJwwwG.glb', family:'prop', contexts:['settlement','camp','roadside'], pbr:['stone','charcoal','wood'] }),
  freeze({ id:'crate', src:'assets/models/props/crate_3OEFd1AWfa.glb', family:'prop', contexts:['settlement','dock','farm','warehouse'], pbr:['wood','iron'] }),
  freeze({ id:'farm-dirt', src:'assets/models/props/farm_dirt_8BQFbUMOeC.glb', family:'ground-prop', contexts:['farm','lowland','settlement-envelope'], pbr:['soil','mud','dry-earth'] }),
  freeze({ id:'stone-bench', src:'assets/models/props/greek_stone_bench.glb', family:'prop', contexts:['settlement','garden','roadside'], pbr:['stone','moss'] }),
  freeze({ id:'hand-statue', src:'assets/models/props/hand_statue_prop.glb', family:'prop', contexts:['settlement','shrine','garden'], pbr:['stone','weathering'] }),
  freeze({ id:'athena-arms', src:'assets/models/props/statue_athena_arms.glb', family:'prop', contexts:['settlement','shrine'], pbr:['stone','weathering'] }),
  freeze({ id:'rocky-terrain-low-poly', src:'assets/models/fbx/rocky_terrain_low_poly.glb', family:'rock', climates:['temperate','forest','forest-edge','highland','alpine-bare','tundra'], biomes:['forest','forest-edge','heath','tundra','alpine-bare','meadow'], contexts:['outcrop','bedrock','cliff','scree'], pbr:['albedo','normal','roughness'], winter:true, geology:true }),
  freeze({ id:'desert-rocks', src:'assets/models/fbx/desert_rocks.glb', family:'rock', climates:['dryland','hot-arid','temperate'], biomes:['dryland','heath','meadow'], contexts:['outcrop','scree','dry-rock'], pbr:['albedo','normal','roughness'], winter:false, geology:true }),
]);

export function findVerifiedEnvironmentAsset(identifier) {
  const needle = norm(identifier);
  if (!needle) return null;
  return VERIFIED_ENVIRONMENT_ASSETS.find((a) => norm(a.id) === needle || norm(a.src) === needle || norm(a.src).endsWith(`/${needle}`)) ?? null;
}

export function listVerifiedEnvironmentAssetsByFamily(family) {
  const key = norm(family);
  return freeze(VERIFIED_ENVIRONMENT_ASSETS.filter((a) => norm(a.family) === key));
}

export function selectVerifiedEnvironmentCandidates(category, { biome = '', winter = false, context = '' } = {}) {
  const profile = resolveTerrainEnvironmentProfile(category);
  if (!profile) return freeze([]);
  const b = norm(biome);
  const c = norm(context);
  const candidates = VERIFIED_ENVIRONMENT_ASSETS.filter((asset) => {
    if (winter && asset.winter === false) return false;
    if (asset.contexts && c && !asset.contexts.map(norm).includes(c)) return false;
    if (b && asset.biomes && !asset.biomes.some((biomeName) => norm(biomeName) === b)) {
      if (asset.climates && !asset.climates.some((climate) => norm(climate) === b)) return false;
    }
    if (profile.category === 'tree') return ['tree','dead-tree','snow-dead-tree'].includes(asset.family);
    if (profile.category === 'grass') return ['crop','ground-prop'].includes(asset.family);
    if (profile.category === 'rock') return asset.geology === true;
    if (profile.category === 'cliff') return asset.geology === true && ['outcrop','bedrock','cliff'].some((name) => asset.contexts?.map(norm).includes(name));
    if (profile.category === 'scree') return asset.geology === true && ['scree','outcrop'].some((name) => asset.contexts?.map(norm).includes(name));
    return asset.family === 'prop';
  });
  return freeze(candidates);
}

export function deterministicEnvironmentSeed(assetId, worldX = 0, worldZ = 0) {
  const text = `${assetId ?? 'environment'}:${Number(worldX).toFixed(2)}:${Number(worldZ).toFixed(2)}`;
  let hash = 2166136261;
  for (const ch of text) { hash ^= ch.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}

export function validateVerifiedEnvironmentAsset(asset, { category = null, sample = {} } = {}) {
  const errors = [];
  const source = asset?.src || asset?.id;
  const verified = findVerifiedEnvironmentAsset(source);
  if (!source) errors.push('missing-source');
  if (!verified) errors.push('asset-not-in-registry');
  if (asset?.placeholder === true) errors.push('placeholder-asset');
  const profile = category ? resolveTerrainEnvironmentProfile(category, asset) : null;
  if (profile && sample.biome && profile.forbiddenBiomes.includes(norm(sample.biome))) errors.push(`forbidden-biome:${norm(sample.biome)}`);
  if (profile && ['rock','cliff','scree'].includes(profile.category) && !verified?.geology) errors.push('natural-geology-source-required');
  return freeze({ ok: errors.length === 0, errors: freeze(errors), verified: Boolean(verified), registryAsset: verified, profile, policyId: ENVIRONMENT_ASSET_REGISTRY_POLICY.id });
}

export function environmentAssetPlacementPlan(asset, options = {}) {
  const category = options.category ?? asset?.category;
  const validation = validateVerifiedEnvironmentAsset(asset, { category, sample: options.sample ?? {} });
  const chosen = findVerifiedEnvironmentAsset(asset?.src || asset?.id);
  return freeze({
    policyId: ENVIRONMENT_ASSET_REGISTRY_POLICY.id,
    asset: chosen,
    validation,
    hydrate: ENVIRONMENT_ASSET_REGISTRY_POLICY.requireHydratedBeforeAttach,
    material: freeze({ authority: ENVIRONMENT_ASSET_REGISTRY_POLICY.materialAuthority, required: true, palettes: resolveTerrainEnvironmentProfile(category)?.preferredPalettes ?? [] }),
    placement: freeze({ authority: ENVIRONMENT_ASSET_REGISTRY_POLICY.placementAuthority, groundRequired: true, manifestRequired: true }),
    source: chosen?.src ?? null,
    deterministicSeed: deterministicEnvironmentSeed(chosen?.id ?? category, options.worldX, options.worldZ),
  });
}

export function registrySummary() {
  const families = {};
  for (const asset of VERIFIED_ENVIRONMENT_ASSETS) families[asset.family] = (families[asset.family] ?? 0) + 1;
  return freeze({ policyId: ENVIRONMENT_ASSET_REGISTRY_POLICY.id, total: VERIFIED_ENVIRONMENT_ASSETS.length, families: freeze(families), geologyAssetCount: VERIFIED_ENVIRONMENT_ASSETS.filter((asset) => asset.geology).length, placeholderAllowed: false, proceduralReplacementAllowed: false });
}
