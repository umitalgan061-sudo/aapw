/**
 * Environment-family profiles used by the world/environment director.
 *
 * This file is declarative: it never spawns geometry, edits canonical terrain, or selects a fallback
 * primitive. Concrete models remain the responsibility of the shared material/placement pipeline.
 */
const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0));
const finiteOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const keyOf = (value) => String(value ?? '').trim().toLowerCase();

export const TERRAIN_ENVIRONMENT_PROFILE_POLICY = Object.freeze({
  id: 'terrain-environment-profile-contract-2026-09-07-v2',
  version: 2,
  canonicalHeightAuthority: 'src/3d/world/terrain.js',
  canonicalHydrologyAuthority: 'map/Pindex hydrology',
  materialAuthority: 'src/3d/materials/MaterialAssignmentCore.js',
  placementAuthority: 'src/3d/world/WorldAssetPlacementPipeline.js',
  editorRuntimeImportAllowed: false,
  proceduralPlaceholderAllowed: false,
  sourceMaterialPreservationPreferred: true,
  deterministicTransformRequired: true,
  lodRequiredForRepeatedFamilies: true,
});

const profile = (value) => Object.freeze({
  ...value,
  allowedBiomes: Object.freeze([...(value.allowedBiomes ?? [])]),
  forbiddenBiomes: Object.freeze([...(value.forbiddenBiomes ?? [])]),
  preferredPalettes: Object.freeze([...(value.preferredPalettes ?? [])]),
  requiredSurfaces: Object.freeze([...(value.requiredSurfaces ?? [])]),
  scale: Object.freeze({ ...(value.scale ?? {}) }),
  lod: Object.freeze({ ...(value.lod ?? {}) }),
  distribution: Object.freeze({ ...(value.distribution ?? {}) }),
});

export const TERRAIN_ENVIRONMENT_ASSET_PROFILES = Object.freeze({
  tree: profile({ category: 'tree', allowedBiomes: ['forest','forest-edge','meadow','heath','lowland','tundra-edge'], forbiddenBiomes: ['ocean','lake','river','alpine-bare','open-scree'], minSlopeDegrees: 0, maxSlopeDegrees: 34, minHeightMeters: 0, preferredPalettes: ['bark','pine-foliage','moss','snow-pine'], requiredSurfaces: ['trunk','bark','leaves'], scale: { min: 0.72, max: 1.44, preferred: 1 }, lod: { near: 0, mid: 1, far: 2, maxVisibleMeters: 2300 }, distribution: { densityPerKm2: 95, clusterRadiusMeters: 165, ecotoneMeters: 42, clearingMeters: 18 } }),
  shrub: profile({ category: 'shrub', allowedBiomes: ['forest-edge','meadow','heath','wet-meadow','tundra','tundra-edge'], forbiddenBiomes: ['ocean','lake','river','alpine-bare'], minSlopeDegrees: 0, maxSlopeDegrees: 44, minHeightMeters: 0, preferredPalettes: ['moss','heath','tundra'], requiredSurfaces: ['foliage','stem'], scale: { min: 0.52, max: 1.65, preferred: 0.92 }, lod: { near: 0, mid: 1, far: 2, maxVisibleMeters: 1150 }, distribution: { densityPerKm2: 260, clusterRadiusMeters: 90, ecotoneMeters: 26, clearingMeters: 7 } }),
  grass: profile({ category: 'grass', allowedBiomes: ['meadow','wet-meadow','heath','lowland','forest-edge','tundra'], forbiddenBiomes: ['ocean','lake','river','open-scree'], minSlopeDegrees: 0, maxSlopeDegrees: 52, minHeightMeters: 0, preferredPalettes: ['meadow','dry-heath','moss','tundra'], requiredSurfaces: ['blade','stem','ground-detail'], scale: { min: 0.34, max: 1.9, preferred: 0.84 }, lod: { near: 0, mid: 1, far: 2, maxVisibleMeters: 900 }, distribution: { densityPerKm2: 3400, clusterRadiusMeters: 44, ecotoneMeters: 12, clearingMeters: 5 } }),
  rock: profile({ category: 'rock', allowedBiomes: ['mountain','highland','alpine-bare','tundra','dry-upland','rocky-coast'], forbiddenBiomes: ['ocean','lake','river','settlement-center'], minSlopeDegrees: 12, maxSlopeDegrees: 88, minHeightMeters: 0.2, preferredPalettes: ['granite','basalt','moraine','quartz'], requiredSurfaces: ['rock'], scale: { min: 0.55, max: 1.85, preferred: 1 }, lod: { near: 0, mid: 1, far: 2, maxVisibleMeters: 2900 }, distribution: { densityPerKm2: 24, clusterRadiusMeters: 120, ecotoneMeters: 20, clearingMeters: 12 } }),
  cliff: profile({ category: 'cliff', allowedBiomes: ['mountain','highland','alpine-bare','tundra','rocky-coast'], forbiddenBiomes: ['ocean','lake','river'], minSlopeDegrees: 24, maxSlopeDegrees: 84, minHeightMeters: 4, preferredPalettes: ['granite','basalt','quartz','moraine'], requiredSurfaces: ['rock','moss','wet-rock'], scale: { min: 0.72, max: 1.56, preferred: 1.08 }, lod: { near: 1, mid: 2, far: 3, maxVisibleMeters: 4300 }, distribution: { densityPerKm2: 7, clusterRadiusMeters: 155, ecotoneMeters: 32, clearingMeters: 42 } }),
  scree: profile({ category: 'scree', allowedBiomes: ['mountain','highland','alpine-bare','tundra'], forbiddenBiomes: ['ocean','lake','river','marsh'], minSlopeDegrees: 22, maxSlopeDegrees: 62, minHeightMeters: 25, preferredPalettes: ['moraine','granite','basalt','dry-heath'], requiredSurfaces: ['scree','dust','rock'], scale: { min: 0.7, max: 1.52, preferred: 1 }, lod: { near: 0, mid: 1, far: 2, maxVisibleMeters: 1700 }, distribution: { densityPerKm2: 42, clusterRadiusMeters: 95, ecotoneMeters: 18, clearingMeters: 8 } }),
  snowPatch: profile({ category: 'snow-patch', allowedBiomes: ['tundra','alpine-bare','glacier','mountain'], forbiddenBiomes: ['ocean','lake','river','dry-upland'], minSlopeDegrees: 0, maxSlopeDegrees: 58, minHeightMeters: 115, preferredPalettes: ['snow','packed-snow','glacial-ice'], requiredSurfaces: ['snow','ice','exposed-rock'], scale: { min: 0.7, max: 2.2, preferred: 1 }, lod: { near: 0, mid: 1, far: 2, maxVisibleMeters: 3100 }, distribution: { densityPerKm2: 30, clusterRadiusMeters: 175, ecotoneMeters: 36, clearingMeters: 22 } }),
  house: profile({ category: 'house', allowedBiomes: ['settlement-envelope','meadow','lowland','heath'], forbiddenBiomes: ['ocean','lake','river','open-scree','alpine-bare'], minSlopeDegrees: 0, maxSlopeDegrees: 12, minHeightMeters: 0.1, preferredPalettes: ['stone','timber','roof','moss','metal'], requiredSurfaces: ['wall','roof','wood','metal'], scale: { min: 0.9, max: 1.12, preferred: 1 }, lod: { near: 0, mid: 1, far: 2, maxVisibleMeters: 4300 }, distribution: { densityPerKm2: 24, clusterRadiusMeters: 125, ecotoneMeters: 0, clearingMeters: 9 } }),
  bridge: profile({ category: 'bridge', allowedBiomes: ['any-dry'], forbiddenBiomes: [], minSlopeDegrees: 0, maxSlopeDegrees: 24, minHeightMeters: -20, preferredPalettes: ['stone','wood','metal','moss'], requiredSurfaces: ['deck','support','edge'], scale: { min: 0.85, max: 1.2, preferred: 1 }, lod: { near: 0, mid: 1, far: 2, maxVisibleMeters: 2700 }, distribution: { densityPerKm2: 1, clusterRadiusMeters: 0, ecotoneMeters: 0, clearingMeters: 0 } }),
});

function profileForCategory(category) {
  const key = keyOf(category);
  if (key === 'trees' || key === 'vegetation') return TERRAIN_ENVIRONMENT_ASSET_PROFILES.tree;
  if (key === 'rocks' || key === 'boulder') return TERRAIN_ENVIRONMENT_ASSET_PROFILES.rock;
  if (key === 'cliffs') return TERRAIN_ENVIRONMENT_ASSET_PROFILES.cliff;
  if (key === 'building' || key === 'buildings') return TERRAIN_ENVIRONMENT_ASSET_PROFILES.house;
  return TERRAIN_ENVIRONMENT_ASSET_PROFILES[key] ?? null;
}

export function resolveTerrainEnvironmentProfile(category, metadata = {}) {
  const base = profileForCategory(category);
  if (!base) return null;
  const winter = /(winter|snow|frost|ice)/.test(`${keyOf(metadata.name)} ${keyOf(metadata.src)}`);
  if (base.category === 'tree' && winter) return Object.freeze({ ...base, preferredPalettes: Object.freeze(['snow-pine','bark','packed-snow','moss']) });
  return base;
}

export function environmentSurfaceScore(profileValue, { slopeDegrees = 0, heightMeters = 0, moisture = 0.5, waterDepth = 0, biome = '', roadDistance = Infinity, settlementDistance = Infinity } = {}) {
  const p = profileValue;
  if (!p) return 0;
  const slope = finiteOr(slopeDegrees, 0);
  const height = finiteOr(heightMeters, 0);
  const wet = clamp01(moisture);
  const depth = finiteOr(waterDepth, 0);
  const biomeKey = keyOf(biome);
  if (p.forbiddenBiomes.includes(biomeKey)) return 0;
  if (p.allowedBiomes.length && !p.allowedBiomes.includes('any-dry') && !p.allowedBiomes.includes(biomeKey)) return 0;
  if (slope < p.minSlopeDegrees || slope > p.maxSlopeDegrees || height < p.minHeightMeters) return 0;
  if (depth > 0.05 && p.category !== 'bridge') return 0;
  const mid = (p.minSlopeDegrees + p.maxSlopeDegrees) * 0.5;
  const span = Math.max(1, p.maxSlopeDegrees - p.minSlopeDegrees);
  let score = 0.82 + 0.18 * (1 - Math.min(1, Math.abs(slope - mid) / span));
  const target = ['grass','shrub','tree'].includes(p.category) ? 0.58 : ['rock','cliff','scree'].includes(p.category) ? 0.34 : 0.5;
  score *= 0.86 + 0.14 * (1 - Math.abs(wet - target));
  if (p.category === 'tree' && Number.isFinite(roadDistance) && roadDistance < 3) score *= 0.35;
  if (p.category === 'house' && Number.isFinite(settlementDistance) && settlementDistance > 260) score *= 0.65;
  return clamp01(score);
}

export function validateTerrainEnvironmentPlacement(profileValue, sample = {}) {
  const errors = [];
  if (!profileValue) return Object.freeze({ ok: false, errors: ['missing-profile'] });
  const slope = finiteOr(sample.slopeDegrees ?? sample.slope, NaN);
  const height = finiteOr(sample.heightMeters ?? sample.height, NaN);
  const waterDepth = finiteOr(sample.waterDepth, 0);
  const biome = keyOf(sample.biome);
  if (!Number.isFinite(slope)) errors.push('missing-slope');
  if (!Number.isFinite(height)) errors.push('missing-height');
  if (profileValue.forbiddenBiomes.includes(biome)) errors.push(`forbidden-biome:${biome}`);
  if (Number.isFinite(slope) && (slope < profileValue.minSlopeDegrees || slope > profileValue.maxSlopeDegrees)) errors.push('slope-out-of-policy');
  if (Number.isFinite(height) && height < profileValue.minHeightMeters) errors.push('height-below-policy');
  if (waterDepth > 0.05 && profileValue.category !== 'bridge') errors.push('water-depth-out-of-policy');
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors), profileId: profileValue.category });
}

export function deterministicAssetTransform(seed = 1, ordinal = 0, profileValue = null) {
  const p = profileValue ?? TERRAIN_ENVIRONMENT_ASSET_PROFILES.rock;
  let state = ((Number(seed) >>> 0) ^ Math.imul(Number(ordinal) | 0, 0x9e3779b9)) >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const scale = p.scale.min + (p.scale.max - p.scale.min) * next();
  const yawRadians = next() * Math.PI * 2;
  const tilt = ['rock','cliff','scree'].includes(p.category) ? 0.14 : 0.035;
  return Object.freeze({ scale, yawRadians, pitchRadians: (next() - 0.5) * tilt, rollRadians: (next() - 0.5) * tilt * 0.72, seed: Number(seed) >>> 0, ordinal: Number(ordinal) | 0 });
}

export function makeEnvironmentAssetManifest({ asset = {}, profile: explicitProfile = null, sample = {}, transform = null, materialManifest = null, placementManifest = null } = {}) {
  const selected = explicitProfile ?? resolveTerrainEnvironmentProfile(asset.category, asset);
  const placement = validateTerrainEnvironmentPlacement(selected, sample);
  return Object.freeze({
    version: 2,
    policyId: TERRAIN_ENVIRONMENT_PROFILE_POLICY.id,
    asset: Object.freeze({ id: asset.id ?? '', name: asset.name ?? '', category: asset.category ?? '', src: asset.src ?? '', hydrated: asset.hydrated !== false, placeholder: asset.placeholder === true }),
    profile: selected ? Object.freeze({ category: selected.category, allowedBiomes: [...selected.allowedBiomes], forbiddenBiomes: [...selected.forbiddenBiomes], requiredSurfaces: [...selected.requiredSurfaces], preferredPalettes: [...selected.preferredPalettes], lod: { ...selected.lod }, distribution: { ...selected.distribution } }) : null,
    sample: Object.freeze({ slopeDegrees: finiteOr(sample.slopeDegrees ?? sample.slope, null), heightMeters: finiteOr(sample.heightMeters ?? sample.height, null), moisture: finiteOr(sample.moisture, null), waterDepth: finiteOr(sample.waterDepth, null), biome: keyOf(sample.biome) }),
    transform: transform ? Object.freeze({ ...transform }) : null,
    materialManifest, placementManifest,
    acceptance: Object.freeze({ profileAccepted: Boolean(selected), placementAccepted: placement.ok, materialContractRequired: true, placeholderAllowed: false, editorRuntimeImportAllowed: false, canonicalGeometryModified: false }),
  });
}

export function listEnvironmentAssetFamilyRequirements(category) {
  const p = resolveTerrainEnvironmentProfile(category);
  if (!p) return null;
  return Object.freeze({ category: p.category, deterministic: true, requireLod: p.lod != null, requiredSurfaces: [...p.requiredSurfaces], preferredPalettes: [...p.preferredPalettes], distribution: { ...p.distribution } });
}
