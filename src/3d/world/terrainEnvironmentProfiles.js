/**
 * Shared terrain/environment visual profiles for asset-first world placement.
 *
 * This module does not instantiate or attach assets. It describes what a caller must ask the merged
 * MaterialAssignmentCore + WorldAssetPlacementPipeline to do after an authored model is hydrated:
 * surface survey, layered PBR recipe, terrain grounding, habitat/biome checks, deterministic scale
 * and yaw, LOD family selection and manifest evidence.
 *
 * Keeping the policy here makes the terrain module a useful common source for the other agents while
 * leaving their gameplay controllers untouched. The profile deliberately separates visual intent from
 * canonical geography ownership: map/Pindex/height/hydrology/collider remain upstream authorities.
 * @module world/terrainEnvironmentProfiles
 */

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const finiteOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const asString = (value) => value == null ? '' : String(value).trim().toLowerCase();

export const TERRAIN_ENVIRONMENT_PROFILE_POLICY = Object.freeze({
  id: 'terrain-environment-asset-context-2026-09-07-v1',
  version: 1,
  canonicalHeightAuthority: 'src/3d/world/terrain.js',
  canonicalHydrologyAuthority: 'map.png-derived-water-ownership',
  materialAuthority: 'src/3d/materials/MaterialAssignmentCore.js',
  placementAuthority: 'src/3d/world/WorldAssetPlacementPipeline.js',
  editorRuntimeImportAllowed: false,
  proceduralPlaceholderAllowed: false,
  importedMaterialPreservationPreferred: true,
  deterministicTransformRequired: true,
  manifestRequired: true,
  lodRequiredForRepeatedFamilies: true,
});

const freezeProfile = (profile) => Object.freeze({
  ...profile,
  allowedBiomes: Object.freeze([...(profile.allowedBiomes || [])]),
  forbiddenBiomes: Object.freeze([...(profile.forbiddenBiomes || [])]),
  preferredPalettes: Object.freeze([...(profile.preferredPalettes || [])]),
  requiredSurfaces: Object.freeze([...(profile.requiredSurfaces || [])]),
  lod: Object.freeze({ ...(profile.lod || {}) }),
  distribution: Object.freeze({ ...(profile.distribution || {}) }),
});

export const TERRAIN_ENVIRONMENT_ASSET_PROFILES = Object.freeze({
  cliff: freezeProfile({
    category: 'cliff',
    allowedBiomes: ['mountain', 'highland', 'alpine-bare', 'tundra', 'rocky-coast'],
    forbiddenBiomes: ['ocean', 'lake', 'river', 'deep-marsh'],
    minSlopeDegrees: 24,
    maxSlopeDegrees: 84,
    minHeightMeters: 4,
    preferredPalettes: ['granite', 'basalt', 'quartz', 'moraine'],
    requiredSurfaces: ['rock', 'moss', 'wet-rock'],
    scale: { min: 0.72, max: 1.55, preferred: 1.08 },
    lod: { near: 1, mid: 2, far: 3, maxVisibleMeters: 4200 },
    distribution: { densityPerKm2: 7, clusterRadiusMeters: 160, clearingRadiusMeters: 42, edgeBufferMeters: 3 },
  }),
  rock: freezeProfile({
    category: 'rock',
    allowedBiomes: ['mountain', 'highland', 'alpine-bare', 'tundra', 'dry-upland', 'rocky-coast'],
    forbiddenBiomes: ['ocean', 'lake', 'river', 'settlement-center'],
    minSlopeDegrees: 12,
    maxSlopeDegrees: 88,
    minHeightMeters: 0.2,
    preferredPalettes: ['granite', 'basalt', 'moraine', 'quartz'],
    requiredSurfaces: ['rock'],
    scale: { min: 0.55, max: 1.85, preferred: 1.0 },
    lod: { near: 0, mid: 1, far: 2, maxVisibleMeters: 2800 },
    distribution: { densityPerKm2: 24, clusterRadiusMeters: 110, clearingRadiusMeters: 12, edgeBufferMeters: 1.2 },
  }),
  scree: freezeProfile({
    category: 'scree',
    allowedBiomes: ['mountain', 'highland', 'alpine-bare', 'tundra'],
    forbiddenBiomes: ['ocean', 'lake', 'river', 'marsh'],
    minSlopeDegrees: 22,
    maxSlopeDegrees: 62,
    minHeightMeters: 25,
    preferredPalettes: ['moraine', 'granite', 'basalt', 'dry-heath'],
    requiredSurfaces: ['scree', 'dust', 'rock'],
    scale: { min: 0.7, max: 1.5, preferred: 1.0 },
    lod: { near: 0, mid: 1, far: 2, maxVisibleMeters: 1600 },
    distribution: { densityPerKm2: 42, clusterRadiusMeters: 90, clearingRadiusMeters: 8, edgeBufferMeters: 0.8 },
  }),
  tree: freezeProfile({
    category: 'tree',
    allowedBiomes: ['forest', 'meadow', 'heath', 'dry-upland', 'lowland', 'tundra-edge'],
    forbiddenBiomes: ['ocean', 'lake', 'river', 'alpine-bare', 'open-scree', 'settlement-road'],
    minSlopeDegrees: 0,
    maxSlopeDegrees: 34,
    minHeightMeters: 0.1,
    preferredPalettes: ['bark', 'pine-foliage', 'moss', 'snow-pine'],
    requiredSurfaces: ['trunk', 'bark', 'leaves'],
    scale: { min: 0.72, max: 1.42, preferred: 1.0 },
    lod: { near: 0, mid: 1, far: 2, maxVisibleMeters: 2200 },
    distribution: { densityPerKm2: 95, clusterRadiusMeters: 170, clearingRadiusMeters: 18, edgeBufferMeters: 2 },
  }),
  shrub: freezeProfile({
    category: 'shrub',
    allowedBiomes: ['forest-edge', 'meadow', 'heath', 'wet-meadow', 'tundra', 'tundra-edge'],
    forbiddenBiomes: ['ocean', 'lake', 'river', 'alpine-bare'],
    minSlopeDegrees: 0,
    maxSlopeDegrees: 44,
    minHeightMeters: 0,
    preferredPalettes: ['moss', 'heath', 'dry-heath', 'tundra'],
    requiredSurfaces: ['foliage', 'stem'],
    scale: { min: 0.55, max: 1.65, preferred: 0.92 },
    lod: { near: 0, mid: 1, far: 2, maxVisibleMeters: 1100 },
    distribution: { densityPerKm2: 260, clusterRadiusMeters: 88, clearingRadiusMeters: 7, edgeBufferMeters: 0.8 },
  }),
  grass: freezeProfile({
    category: 'grass',
    allowedBiomes: ['meadow', 'wet-meadow', 'heath', 'lowland', 'forest-edge', 'tundra'],
    forbiddenBiomes: ['ocean', 'lake', 'river', 'open-scree'],
    minSlopeDegrees: 0,
    maxSlopeDegrees: 52,
    minHeightMeters: 0,
    preferredPalettes: ['meadow', 'dry-heath', 'moss', 'tundra'],
    requiredSurfaces: ['blade', 'stem', 'ground-detail'],
    scale: { min: 0.35, max: 1.9, preferred: 0.84 },
    lod: { near: 0, mid: 1, far: 2, maxVisibleMeters: 850 },
    distribution: { densityPerKm2: 3400, clusterRadiusMeters: 42, clearingRadiusMeters: 5, edgeBufferMeters: 0.3 },
  }),
  snowPatch: freezeProfile({
    category: 'snow-patch',
    allowedBiomes: ['tundra', 'alpine-bare', 'glacier', 'mountain'],
    forbiddenBiomes: ['ocean', 'lake', 'river', 'dry-upland'],
    minSlopeDegrees: 0,
    maxSlopeDegrees: 58,
    minHeightMeters: 115,
    preferredPalettes: ['snow', 'packed-snow', 'glacial-ice'],
    requiredSurfaces: ['snow', 'ice', 'exposed-rock'],
    scale: { min: 0.7, max: 2.2, preferred: 1.0 },
    lod: { near: 0, mid: 1, far: 2, maxVisibleMeters: 3000 },
    distribution: { densityPerKm2: 30, clusterRadiusMeters: 170, clearingRadiusMeters: 22, edgeBufferMeters: 1 },
  }),
  bridge: freezeProfile({
    category: 'bridge',
    allowedBiomes: ['any-dry'],
    forbiddenBiomes: [],
    minSlopeDegrees: 0,
    maxSlopeDegrees: 24,
    minHeightMeters: -20,
    preferredPalettes: ['stone', 'wood', 'metal', 'moss'],
    requiredSurfaces: ['deck', 'support', 'edge'],
    scale: { min: 0.85, max: 1.2, preferred: 1.0 },
    lod: { near: 0, mid: 1, far: 2, maxVisibleMeters: 2600 },
    distribution: { densityPerKm2: 1, clusterRadiusMeters: 0, clearingRadiusMeters: 0, edgeBufferMeters: 0 },
  }),
  house: freezeProfile({
    category: 'house',
    allowedBiomes: ['settlement-envelope', 'meadow', 'lowland', 'heath'],
    forbiddenBiomes: ['ocean', 'lake', 'river', 'open-scree', 'alpine-bare'],
    minSlopeDegrees: 0,
    maxSlopeDegrees: 12,
    minHeightMeters: 0.1,
    preferredPalettes: ['stone', 'timber', 'roof', 'moss', 'metal'],
    requiredSurfaces: ['wall', 'roof', 'wood', 'metal'],
    scale: { min: 0.9, max: 1.12, preferred: 1.0 },
    lod: { near: 0, mid: 1, far: 2, maxVisibleMeters: 4200 },
    distribution: { densityPerKm2: 24, clusterRadiusMeters: 120, clearingRadiusMeters: 9, edgeBufferMeters: 1.4 },
  }),
  settlement: freezeProfile({
    category: 'settlement',
    allowedBiomes: ['settlement-envelope'],
    forbiddenBiomes: ['ocean', 'lake', 'river', 'open-scree'],
    minSlopeDegrees: 0,
    maxSlopeDegrees: 12,
    minHeightMeters: 0.1,
    preferredPalettes: ['stone', 'timber', 'roof', 'moss', 'metal'],
    requiredSurfaces: ['wall', 'roof', 'wood', 'metal', 'ground-contact'],
    scale: { min: 0.88, max: 1.16, preferred: 1.0 },
    lod: { near: 0, mid: 1, far: 2, maxVisibleMeters: 6000 },
    distribution: { densityPerKm2: 4, clusterRadiusMeters: 210, clearingRadiusMeters: 18, edgeBufferMeters: 2 },
  }),
});

function profileForCategory(category) {
  const key = asString(category);
  if (key === 'boulder' || key === 'stone') return TERRAIN_ENVIRONMENT_ASSET_PROFILES.rock;
  if (key === 'trees' || key === 'vegetation') return TERRAIN_ENVIRONMENT_ASSET_PROFILES.tree;
  if (key === 'buildings') return TERRAIN_ENVIRONMENT_ASSET_PROFILES.house;
  return TERRAIN_ENVIRONMENT_ASSET_PROFILES[key] || null;
}

export function resolveTerrainEnvironmentProfile(category, metadata = {}) {
  const profile = profileForCategory(category);
  if (!profile) return null;
  const name = asString(metadata.name || metadata.id || metadata.src);
  const source = asString(metadata.src);
  const inferredWinter = /(winter|snow|frost|ice)/.test(`${name} ${source}`);
  if (profile.category === 'tree' && inferredWinter) {
    return Object.freeze({ ...profile, preferredPalettes: Object.freeze(['snow-pine', 'bark', 'packed-snow', 'moss']) });
  }
  return profile;
}

export function environmentSurfaceScore(profile, {
  slopeDegrees = 0,
  heightMeters = 0,
  moisture = 0.5,
  waterDepth = 0,
  biome = '',
  roadDistance = Infinity,
  settlementDistance = Infinity,
} = {}) {
  if (!profile) return 0;
  const slope = finiteOr(slopeDegrees, 0);
  const height = finiteOr(heightMeters, 0);
  const wet = clamp01(moisture);
  const water = finiteOr(waterDepth, 0);
  const biomeKey = asString(biome);
  if (profile.forbiddenBiomes.includes(biomeKey)) return 0;
  if (profile.allowedBiomes.length && !profile.allowedBiomes.includes('any-dry') && !profile.allowedBiomes.includes(biomeKey)) return 0;
  if (slope < profile.minSlopeDegrees || slope > profile.maxSlopeDegrees) return 0;
  if (height < profile.minHeightMeters) return 0;
  if (water > 0.05 && !['bridge', 'waterside'].includes(profile.category)) return 0;

  let score = 1;
  const slopeMid = (profile.minSlopeDegrees + profile.maxSlopeDegrees) * 0.5;
  const slopeSpan = Math.max(1, profile.maxSlopeDegrees - profile.minSlopeDegrees);
  score *= 0.82 + 0.18 * (1 - Math.abs(slope - slopeMid) / slopeSpan);

  const moistureTarget = ['grass', 'shrub', 'tree'].includes(profile.category) ? 0.58 : ['rock', 'cliff', 'scree'].includes(profile.category) ? 0.34 : 0.5;
  score *= 0.86 + 0.14 * (1 - Math.abs(wet - moistureTarget));

  if (profile.category === 'tree' && Number.isFinite(roadDistance) && roadDistance < 3) score *= 0.35;
  if (profile.category === 'house' && Number.isFinite(settlementDistance) && settlementDistance > 260) score *= 0.65;
  if (profile.category === 'grass' && slope > 42) score *= 0.55;
  if (profile.category === 'snow-patch' && wet < 0.23) score *= 0.72;
  return clamp01(score);
}

export function validateTerrainEnvironmentPlacement(profile, sample = {}) {
  const errors = [];
  if (!profile) return { ok: false, errors: ['missing-profile'] };
  const slope = finiteOr(sample.slopeDegrees ?? sample.slope, NaN);
  const height = finiteOr(sample.heightMeters ?? sample.height, NaN);
  const waterDepth = finiteOr(sample.waterDepth, 0);
  const biome = asString(sample.biome);
  if (!Number.isFinite(slope)) errors.push('missing-slope');
  if (!Number.isFinite(height)) errors.push('missing-height');
  if (profile.forbiddenBiomes.includes(biome)) errors.push(`forbidden-biome:${biome}`);
  if (Number.isFinite(slope) && (slope < profile.minSlopeDegrees || slope > profile.maxSlopeDegrees)) errors.push('slope-out-of-policy');
  if (Number.isFinite(height) && height < profile.minHeightMeters) errors.push('height-below-policy');
  if (waterDepth > 0.05 && !['bridge', 'waterside'].includes(profile.category)) errors.push('water-depth-out-of-policy');
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors), profileId: profile.category });
}

export function deterministicAssetTransform(seed = 1, ordinal = 0, profile = null) {
  let state = (Number(seed) >>> 0) ^ Math.imul(Number(ordinal) | 0, 0x9e3779b9);
  const next = () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const p = profile || TERRAIN_ENVIRONMENT_ASSET_PROFILES.rock;
  const scale = lerpFinite(p.scale?.min ?? 1, p.scale?.max ?? 1, next());
  const yawRadians = next() * Math.PI * 2;
  const pitchRadians = (next() - 0.5) * (p.category === 'rock' || p.category === 'cliff' ? 0.16 : 0.035);
  const rollRadians = (next() - 0.5) * (p.category === 'rock' || p.category === 'cliff' ? 0.11 : 0.025);
  return Object.freeze({ scale, yawRadians, pitchRadians, rollRadians, seed: Number(seed) >>> 0, ordinal: Number(ordinal) | 0 });
}

function lerpFinite(a, b, t) {
  const min = finiteOr(a, 1);
  const max = finiteOr(b, min);
  return min + (max - min) * clamp01(t);
}

export function makeEnvironmentAssetManifest({
  asset = {},
  profile = null,
  sample = {},
  materialManifest = null,
  placementManifest = null,
  transform = null,
} = {}) {
  const chosen = profile || resolveTerrainEnvironmentProfile(asset.category, asset);
  const placement = validateTerrainEnvironmentPlacement(chosen, sample);
  return Object.freeze({
    version: 1,
    policyId: TERRAIN_ENVIRONMENT_PROFILE_POLICY.id,
    asset: Object.freeze({
      id: asset.id || '',
      name: asset.name || '',
      category: asset.category || '',
      src: asset.src || '',
      hydrated: asset.hydrated !== false,
      placeholder: asset.placeholder === true,
    }),
    profile: chosen ? Object.freeze({
      category: chosen.category,
      allowedBiomes: [...chosen.allowedBiomes],
      forbiddenBiomes: [...chosen.forbiddenBiomes],
      preferredPalettes: [...chosen.preferredPalettes],
      requiredSurfaces: [...chosen.requiredSurfaces],
      lod: { ...chosen.lod },
      distribution: { ...chosen.distribution },
    }) : null,
    sample: Object.freeze({
      slopeDegrees: finiteOr(sample.slopeDegrees ?? sample.slope, null),
      height: finiteOr(sample.heightMeters ?? sample.height, null),
      moisture: finiteOr(sample.moisture, null),
      waterDepth: finiteOr(sample.waterDepth, null),
      biome: asString(sample.biome),
      roadDistance: finiteOr(sample.roadDistance, null),
      settlementDistance: finiteOr(sample.settlementDistance, null),
    }),
    transform: transform ? { ...transform } : null,
    materialManifest,
    placementManifest,
    acceptance: {
      profileAccepted: Boolean(chosen),
      placementAccepted: placement.ok,
      materialContractRequired: true,
      placeholderAllowed: false,
      editorRuntimeImportAllowed: false,
      canonicalGeometryModified: false,
    },
  });
}

export function listEnvironmentAssetFamilyRequirements(category) {
  const profile = resolveTerrainEnvironmentProfile(category);
  if (!profile) return null;
  return Object.freeze({
    category: profile.category,
    deterministic: TERRAIN_ENVIRONMENT_PROFILE_POLICY.deterministicTransformRequired,
    requireLod: TERRAIN_ENVIRONMENT_PROFILE_POLICY.lodRequiredForRepeatedFamilies,
    requiredSurfaces: [...profile.requiredSurfaces],
    preferredPalettes: [...profile.preferredPalettes],
    forbiddenBiomes: [...profile.forbiddenBiomes],
    distribution: { ...profile.distribution },
  });
}
