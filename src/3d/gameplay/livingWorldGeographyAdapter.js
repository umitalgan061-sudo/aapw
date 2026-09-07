/**
 * Şafak Kartalı — geography-aware living-world seam.
 *
 * This module consumes the existing owner-map geography, terrain, settlement, road and shared
 * material/placement contracts. It does not create another biome, spawn, material or placement
 * framework. Its job is to answer whether an existing NPC/creature decision is geographically
 * plausible and which already-tracked authored asset belongs to that context.
 */
import { REFERENCE_BIOME_ZONES, REFERENCE_RELIEF_CHAINS, REFERENCE_WATER_ZONES, sampleReferenceInfluence } from '../world/worldReferenceMap.js';
import { WORLD_REFERENCE_ALIGNMENT, worldXZToNormalizedReference } from '../world/worldReferenceAlignment.js';
import { WORLD_SCALE } from '../config.js';
import { prepareWorldAssetForPlacement, auditWorldAssetPlacement } from '../world/WorldAssetPlacementPipeline.js';

const VERSION = '2026-09-07-v2';
const MAP_SHA256 = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';
const MAX_SLOPE = 38;
const MIN_WATER_DEPTH = 0.05;
const ROAD_BUFFER = 1.5;
const SETTLEMENT_BUFFER = 90;
const clamp = (v, min, max) => Math.max(min, Math.min(max, Number(v) || 0));
const finite = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;

const BIOME_TO_REGION = Object.freeze({
  snow: 'snow',
  'cold-grassland': 'north',
  marsh: 'marsh',
  mountain: 'mountain',
  'rocky-hills': 'westerlands',
  'lush-grassland': 'reach',
  desert: 'desert',
  steppe: 'steppe',
  arid: 'arid',
  'temperate-coast': 'coast',
  jungle: 'jungle',
});

const REGION_ASSET_PROFILES = Object.freeze({
  snow: Object.freeze({
    human: Object.freeze({ family: 'guard-winter', assetCandidates: Object.freeze(['assets/models/characters/paladin_j_nordstrom.fbx','assets/models/characters/uriel_a_plotexia.fbx']), surfaceRoles: Object.freeze(['skin','hair','eyes','clothing','boots','gear']) }),
    wildlife: Object.freeze({ species: Object.freeze(['wolf','bear','bighorn_sheep']), assetCandidates: Object.freeze(['assets/models/animals/wolf/Wolf-Blender-2.82a.glb','assets/models/animals/bear_0PXWfxfb0Hu.glb','assets/models/animals/bighorn_sheep_4kUChlMv8Vp.glb']), habitat: Object.freeze({ maxSlope: 34, waterAllowed: false, roadBuffer: 8, settlementBuffer: 120 }), surfaceRoles: Object.freeze(['fur','eye','claw','tooth']) }),
    scenery: Object.freeze(['snow-pine','dead-snow-tree','snow-rock']),
  }),
  north: Object.freeze({
    human: Object.freeze({ family: 'guard-boreal', assetCandidates: Object.freeze(['assets/models/characters/erika_archer.fbx','assets/models/characters/dreyar.fbx']), surfaceRoles: Object.freeze(['skin','hair','eyes','clothing','boots','gear']) }),
    wildlife: Object.freeze({ species: Object.freeze(['wolf','deer','horse','bear']), assetCandidates: Object.freeze(['assets/models/animals/wolf/Wolf-Blender-2.82a.glb','assets/models/animals/deer_T6Cs7tmMHJ.glb','assets/models/animals/white_horse_bEdE4rmZy9.glb','assets/models/animals/bear_0PXWfxfb0Hu.glb']), habitat: Object.freeze({ maxSlope: 32, waterAllowed: false, roadBuffer: 5, settlementBuffer: 110 }), surfaceRoles: Object.freeze(['fur','eye','claw','tooth']) }),
    scenery: Object.freeze(['pine','snow-pine','low-shrub','field-boulder']),
  }),
  marsh: Object.freeze({
    human: Object.freeze({ family: 'guard-marsh', assetCandidates: Object.freeze(['assets/models/characters/dreyar.fbx','assets/models/characters/arissa.fbx']), surfaceRoles: Object.freeze(['skin','hair','eyes','clothing','boots','gear']) }),
    wildlife: Object.freeze({ species: Object.freeze(['wolf','boar','bird']), assetCandidates: Object.freeze(['assets/models/animals/wolf/Wolf-Blender-2.82a.glb','assets/models/animals/bird_8Ph79kHbt9s.glb']), habitat: Object.freeze({ maxSlope: 26, waterAllowed: true, maxWaterDepth: 0.12, roadBuffer: 4, settlementBuffer: 90 }), surfaceRoles: Object.freeze(['fur','eye','claw','tooth']) }),
    scenery: Object.freeze(['willow','reed-clump','wet-boulder','dead-marsh-tree']),
  }),
  mountain: Object.freeze({
    human: Object.freeze({ family: 'guard-highland', assetCandidates: Object.freeze(['assets/models/characters/paladin_wprop_j_nordstrom.fbx','assets/models/characters/erika_archer.fbx']), surfaceRoles: Object.freeze(['skin','hair','eyes','clothing','boots','gear']) }),
    wildlife: Object.freeze({ species: Object.freeze(['goat','sheep','eagle','bear']), assetCandidates: Object.freeze(['assets/models/animals/bighorn_sheep_4kUChlMv8Vp.glb','assets/models/animals/bear_0PXWfxfb0Hu.glb']), habitat: Object.freeze({ maxSlope: 42, waterAllowed: false, roadBuffer: 6, settlementBuffer: 100 }), surfaceRoles: Object.freeze(['fur','eye','claw','tooth']) }),
    scenery: Object.freeze(['mountain-pine','wind-bent-conifer','alpine-boulder','scree']),
  }),
  westerlands: Object.freeze({
    human: Object.freeze({ family: 'guard-temperate-upland', assetCandidates: Object.freeze(['assets/models/characters/dreyar.fbx','assets/models/characters/arissa.fbx']), surfaceRoles: Object.freeze(['skin','hair','eyes','clothing','boots','gear']) }),
    wildlife: Object.freeze({ species: Object.freeze(['deer','boar','horse','wolf']), assetCandidates: Object.freeze(['assets/models/animals/deer_T6Cs7tmMHJ.glb','assets/models/animals/white_horse_bEdE4rmZy9.glb','assets/models/animals/wolf/Wolf-Blender-2.82a.glb']), habitat: Object.freeze({ maxSlope: 34, waterAllowed: false, roadBuffer: 5, settlementBuffer: 90 }), surfaceRoles: Object.freeze(['fur','eye','claw','tooth']) }),
    scenery: Object.freeze(['round-tree','thorn-tree','hedge','field-boulder']),
  }),
  reach: Object.freeze({
    human: Object.freeze({ family: 'guard-fertile', assetCandidates: Object.freeze(['assets/models/characters/farmer_7pn3R6hPvE.glb','assets/models/characters/dreyar.fbx']), surfaceRoles: Object.freeze(['skin','hair','eyes','clothing','boots','gear']) }),
    wildlife: Object.freeze({ species: Object.freeze(['horse','cow','sheep','deer','fox']), assetCandidates: Object.freeze(['assets/models/animals/white_horse_bEdE4rmZy9.glb','assets/models/animals/cow_26zM1outCr.glb','assets/models/animals/sheep_C39AUXUUes.glb','assets/models/animals/deer_T6Cs7tmMHJ.glb','assets/models/animals/fox_Bc97C66HKi.glb']), habitat: Object.freeze({ maxSlope: 30, waterAllowed: false, roadBuffer: 4, settlementBuffer: 75 }), surfaceRoles: Object.freeze(['fur','eye','claw','tooth']) }),
    scenery: Object.freeze(['round-tree','oak','beech','field-shrub','grass-tuft']),
  }),
  desert: Object.freeze({
    human: Object.freeze({ family: 'guard-dorne', assetCandidates: Object.freeze(['assets/models/characters/uriel_a_plotexia.fbx','assets/models/characters/erika_archer.fbx']), surfaceRoles: Object.freeze(['skin','hair','eyes','clothing','boots','gear']) }),
    wildlife: Object.freeze({ species: Object.freeze(['horse','camel','scorpion','snake']), assetCandidates: Object.freeze(['assets/models/animals/white_horse_bEdE4rmZy9.glb']), habitat: Object.freeze({ maxSlope: 28, waterAllowed: false, roadBuffer: 3, settlementBuffer: 80 }), surfaceRoles: Object.freeze(['fur','eye','claw','tooth']) }),
    scenery: Object.freeze(['dry-shrub','thorn-tree','dead-tree','sand-rock']),
  }),
  steppe: Object.freeze({
    human: Object.freeze({ family: 'guard-steppe', assetCandidates: Object.freeze(['assets/models/characters/erika_archer.fbx','assets/models/characters/uriel_a_plotexia.fbx']), surfaceRoles: Object.freeze(['skin','hair','eyes','clothing','boots','gear']) }),
    wildlife: Object.freeze({ species: Object.freeze(['horse','bison','wolf','deer']), assetCandidates: Object.freeze(['assets/models/animals/white_horse_bEdE4rmZy9.glb','assets/models/animals/bison_by_poly_by_google_9strha_txds_na.glb','assets/models/animals/wolf/Wolf-Blender-2.82a.glb','assets/models/animals/deer_T6Cs7tmMHJ.glb']), habitat: Object.freeze({ maxSlope: 32, waterAllowed: false, roadBuffer: 4, settlementBuffer: 90 }), surfaceRoles: Object.freeze(['fur','eye','claw','tooth']) }),
    scenery: Object.freeze(['short-grass-tuft','scattered-tree','dry-shrub','steppe-boulder']),
  }),
  arid: Object.freeze({
    human: Object.freeze({ family: 'guard-red-waste', assetCandidates: Object.freeze(['assets/models/characters/uriel_a_plotexia.fbx','assets/models/characters/dreyar.fbx']), surfaceRoles: Object.freeze(['skin','hair','eyes','clothing','boots','gear']) }),
    wildlife: Object.freeze({ species: Object.freeze(['horse','goat','camel','scorpion']), assetCandidates: Object.freeze(['assets/models/animals/white_horse_bEdE4rmZy9.glb']), habitat: Object.freeze({ maxSlope: 30, waterAllowed: false, roadBuffer: 3, settlementBuffer: 100 }), surfaceRoles: Object.freeze(['fur','eye','claw','tooth']) }),
    scenery: Object.freeze(['dry-shrub','thorn-tree','dead-tree','red-boulder']),
  }),
  coast: Object.freeze({
    human: Object.freeze({ family: 'guard-maritime', assetCandidates: Object.freeze(['assets/models/characters/arissa.fbx','assets/models/characters/dreyar.fbx']), surfaceRoles: Object.freeze(['skin','hair','eyes','clothing','boots','gear']) }),
    wildlife: Object.freeze({ species: Object.freeze(['horse','deer','bird','seal']), assetCandidates: Object.freeze(['assets/models/animals/white_horse_bEdE4rmZy9.glb','assets/models/animals/deer_T6Cs7tmMHJ.glb','assets/models/animals/bird_8Ph79kHbt9s.glb']), habitat: Object.freeze({ maxSlope: 26, waterAllowed: false, roadBuffer: 4, settlementBuffer: 85 }), surfaceRoles: Object.freeze(['fur','eye','claw','tooth']) }),
    scenery: Object.freeze(['wind-bent-tree','coastal-shrub','shore-boulder','dune-gravel']),
  }),
  jungle: Object.freeze({
    human: Object.freeze({ family: 'guard-jungle', assetCandidates: Object.freeze(['assets/models/characters/arissa.fbx','assets/models/characters/erika_archer.fbx']), surfaceRoles: Object.freeze(['skin','hair','eyes','clothing','boots','gear']) }),
    wildlife: Object.freeze({ species: Object.freeze(['jaguar','bird','monkey','snake']), assetCandidates: Object.freeze(['assets/models/animals/bird_8Ph79kHbt9s.glb']), habitat: Object.freeze({ maxSlope: 30, waterAllowed: true, maxWaterDepth: 0.16, roadBuffer: 3, settlementBuffer: 80 }), surfaceRoles: Object.freeze(['fur','eye','claw','tooth']) }),
    scenery: Object.freeze(['broadleaf-tall','broadleaf-round','palm','fern-clump','moss-boulder']),
  }),
  valyria: Object.freeze({
    human: Object.freeze({ family: 'guard-volcanic', assetCandidates: Object.freeze(['assets/models/characters/Meshy_AI_Iron_Sentinel_0809085351_texture.fbx','assets/models/characters/Meshy_AI_Golden_Vanguard_Knigh_0809074809_texture.fbx']), surfaceRoles: Object.freeze(['skin','hair','eyes','clothing','boots','gear']) }),
    wildlife: Object.freeze({ species: Object.freeze(['dragon','ash-beast']), assetCandidates: Object.freeze(['assets/models/creatures/dragons/verdant_wyrm.glb','assets/models/creatures/dragons/auric_dragon.glb','assets/models/creatures/dragons/frostscale_dragon.glb']), habitat: Object.freeze({ maxSlope: 48, waterAllowed: false, roadBuffer: 10, settlementBuffer: 140 }), surfaceRoles: Object.freeze(['scale','wing','eye','horn','claw']) }),
    scenery: Object.freeze(['ash-shrub','dead-black-tree','basalt-boulder','volcanic-spire']),
  }),
  temperate: Object.freeze({
    human: Object.freeze({ family: 'guard-temperate', assetCandidates: Object.freeze(['assets/models/characters/dreyar.fbx','assets/models/characters/arissa.fbx']), surfaceRoles: Object.freeze(['skin','hair','eyes','clothing','boots','gear']) }),
    wildlife: Object.freeze({ species: Object.freeze(['horse','deer','wolf','boar']), assetCandidates: Object.freeze(['assets/models/animals/white_horse_bEdE4rmZy9.glb','assets/models/animals/deer_T6Cs7tmMHJ.glb','assets/models/animals/wolf/Wolf-Blender-2.82a.glb']), habitat: Object.freeze({ maxSlope: 34, waterAllowed: false, roadBuffer: 4, settlementBuffer: 75 }), surfaceRoles: Object.freeze(['fur','eye','claw','tooth']) }),
    scenery: Object.freeze(['round-tree','oak','pine','field-shrub','grass-tuft']),
  }),
});

const SPECIES_OVERRIDES = Object.freeze({
  wolf: Object.freeze({ preferred: ['snow','north','westerlands','reach','marsh','temperate','steppe'], forbidden: ['desert','arid','jungle'], maxSlope: 36, waterAllowed: false }),
  deer: Object.freeze({ preferred: ['north','westerlands','reach','temperate','coast','mountain'], forbidden: ['desert','arid','valyria'], maxSlope: 34, waterAllowed: false }),
  horse: Object.freeze({ preferred: ['north','westerlands','reach','steppe','coast','temperate','desert'], forbidden: ['marsh','valyria'], maxSlope: 28, waterAllowed: false }),
  bear: Object.freeze({ preferred: ['snow','north','mountain','westerlands','temperate'], forbidden: ['desert','arid','jungle','valyria'], maxSlope: 38, waterAllowed: false }),
  dragon: Object.freeze({ preferred: ['valyria','mountain','arid','steppe'], forbidden: ['marsh'], maxSlope: 48, waterAllowed: false }),
});

const SPECIES_AUTHORED_ASSETS = Object.freeze({
  wolf: Object.freeze(['assets/models/animals/wolf/Wolf-Blender-2.82a.glb']),
  bear: Object.freeze(['assets/models/animals/bear_0PXWfxfb0Hu.glb']),
  bighorn_sheep: Object.freeze(['assets/models/animals/bighorn_sheep_4kUChlMv8Vp.glb']),
  deer: Object.freeze(['assets/models/animals/deer_T6Cs7tmMHJ.glb']),
  horse: Object.freeze(['assets/models/animals/white_horse_bEdE4rmZy9.glb']),
  cow: Object.freeze(['assets/models/animals/cow_26zM1outCr.glb']),
  sheep: Object.freeze(['assets/models/animals/sheep_C39AUXUUes.glb']),
  fox: Object.freeze(['assets/models/animals/fox_Bc97C66HKi.glb']),
  bison: Object.freeze(['assets/models/animals/bison_by_poly_by_google_9strha_txds_na.glb']),
  bird: Object.freeze(['assets/models/animals/bird_8Ph79kHbt9s.glb']),
  dragon: Object.freeze(['assets/models/creatures/dragons/verdant_wyrm.glb','assets/models/creatures/dragons/auric_dragon.glb','assets/models/creatures/dragons/frostscale_dragon.glb']),
});

const SPECIES_SURFACE_ROLES = Object.freeze({
  horse: Object.freeze(['coat','mane','tail','hoof','saddle','harness']),
  dragon: Object.freeze(['scale','wing','eye','horn','claw']),
});

function zoneInfluence(normalizedX, normalizedY) {
  let best = { id: null, kind: null, influence: 0 };
  for (const zone of REFERENCE_BIOME_ZONES) {
    const influence = sampleReferenceInfluence(normalizedX, normalizedY, zone);
    if (influence > best.influence) best = { id: zone.id, kind: zone.kind, influence };
  }
  return Object.freeze(best);
}

function waterInfluence(normalizedX, normalizedY) {
  let best = { id: null, kind: null, influence: 0 };
  for (const zone of REFERENCE_WATER_ZONES) {
    const influence = sampleReferenceInfluence(normalizedX, normalizedY, zone);
    if (influence > best.influence) best = { id: zone.id, kind: zone.kind, influence };
  }
  return Object.freeze(best);
}

function reliefInfluence(normalizedX, normalizedY) {
  let best = 0;
  for (const chain of REFERENCE_RELIEF_CHAINS) {
    for (let i = 1; i < chain.points.length; i += 1) {
      const [ax, ay] = chain.points[i - 1]; const [bx, by] = chain.points[i];
      const dx = bx - ax; const dy = by - ay; const len2 = dx * dx + dy * dy || 1;
      const t = clamp(((normalizedX - ax) * dx + (normalizedY - ay) * dy) / len2, 0, 1);
      const distance = Math.hypot(normalizedX - (ax + dx * t), normalizedY - (ay + dy * t));
      best = Math.max(best, clamp(1 - distance / 0.10, 0, 1));
    }
  }
  return best;
}

function canonicalRegionForPosition(worldX, worldZ) {
  const normalized = worldXZToNormalizedReference(worldX, worldZ, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
  const zone = zoneInfluence(normalized.x, normalized.y);
  const water = waterInfluence(normalized.x, normalized.y);
  const relief = reliefInfluence(normalized.x, normalized.y);
  let region = BIOME_TO_REGION[zone.kind] || 'temperate';
  if (water.influence > 0.72 && region !== 'marsh') region = 'coast';
  if (relief > 0.72 && ['north','temperate'].includes(region)) region = 'mountain';
  if (normalized.y > 0.80 && normalized.x > 0.72 && region !== 'jungle') region = 'jungle';
  return Object.freeze({ normalized, zone, water, relief, region });
}

export const LIVING_WORLD_GEOGRAPHY_POLICY = Object.freeze({
  id: `living-world-geography-${VERSION}`,
  version: VERSION,
  sourceMapSha256: MAP_SHA256,
  alignmentAuthority: WORLD_REFERENCE_ALIGNMENT.id,
  terrainAuthority: 'world/terrain.js',
  placementAuthority: 'WorldAssetPlacementPipeline.js',
  materialAuthority: 'MaterialAssignmentCore.js',
  maxSlopeDegrees: MAX_SLOPE,
  settlementBufferMeters: SETTLEMENT_BUFFER,
  roadBufferMeters: ROAD_BUFFER,
  waterDepthThresholdMeters: MIN_WATER_DEPTH,
  deterministic: true,
  noSecondBiomeFramework: true,
});

export function resolveLivingWorldGeography({ worldX, worldZ, speciesId = null, role = 'guard', groundHeight = null, slopeDegrees = 0, waterDepth = 0, settlementDistance = Infinity, roadDistance = Infinity, seed = 0 } = {}) {
  if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) return Object.freeze({ ok: false, reason: 'non-finite-position' });
  const canonical = canonicalRegionForPosition(worldX, worldZ);
  const profile = REGION_ASSET_PROFILES[canonical.region] || REGION_ASSET_PROFILES.temperate;
  const species = speciesId ? SPECIES_OVERRIDES[String(speciesId).toLowerCase()] : null;
  const maxSlope = species?.maxSlope ?? profile.wildlife?.habitat?.maxSlope ?? MAX_SLOPE;
  const speciesPreferred = !species || species.preferred.includes(canonical.region) || (species.preferred.includes('temperate') && canonical.region === 'temperate');
  const speciesForbidden = Boolean(species?.forbidden?.includes(canonical.region));
  const waterAllowed = species?.waterAllowed ?? profile.wildlife?.habitat?.waterAllowed ?? false;
  const maxWaterDepth = profile.wildlife?.habitat?.maxWaterDepth ?? MIN_WATER_DEPTH;
  const allowedWater = waterAllowed ? waterDepth <= maxWaterDepth : waterDepth <= MIN_WATER_DEPTH;
  const habitatSlope = Number(slopeDegrees) <= maxSlope;
  const roadOk = Number(roadDistance) >= (role === 'wildlife' ? Math.max(ROAD_BUFFER, profile.wildlife?.habitat?.roadBuffer ?? ROAD_BUFFER) : ROAD_BUFFER);
  const seatOk = Number(settlementDistance) >= (role === 'wildlife' ? Math.max(SETTLEMENT_BUFFER, profile.wildlife?.habitat?.settlementBuffer ?? SETTLEMENT_BUFFER) : 18);
  const roleAllowed = role === 'wildlife' ? speciesPreferred && !speciesForbidden : true;
  const ok = habitatSlope && allowedWater && roadOk && seatOk && roleAllowed;
  return Object.freeze({
    ok,
    reason: ok ? 'habitat-valid' : !habitatSlope ? 'slope' : !allowedWater ? 'water' : !roadOk ? 'road-buffer' : !seatOk ? 'settlement-buffer' : 'species-region',
    position: Object.freeze({ x: worldX, z: worldZ, y: Number.isFinite(groundHeight) ? groundHeight : null }),
    normalizedReference: canonical.normalized,
    region: canonical.region,
    zone: canonical.zone,
    water: canonical.water,
    reliefSignal: canonical.relief,
    speciesId: speciesId ?? null,
    role,
    profileId: canonical.region,
    maxSlopeDegrees: maxSlope,
    waterDepth: finite(waterDepth),
    slopeDegrees: finite(slopeDegrees),
    roadDistance: Number.isFinite(roadDistance) ? roadDistance : null,
    settlementDistance: Number.isFinite(settlementDistance) ? settlementDistance : null,
    seed: String(seed),
  });
}

export function resolveLivingWorldAssetProfile({ worldX, worldZ, speciesId = null, role = 'guard' } = {}) {
  const geography = canonicalRegionForPosition(worldX, worldZ);
  const profile = REGION_ASSET_PROFILES[geography.region] || REGION_ASSET_PROFILES.temperate;
  const speciesKey = String(speciesId ?? '').toLowerCase();
  if (role === 'wildlife') {
    const exactCandidates = SPECIES_AUTHORED_ASSETS[speciesKey];
    const surfaceRoles = SPECIES_SURFACE_ROLES[speciesKey] ?? profile.wildlife.surfaceRoles;
    return Object.freeze({
      ...profile.wildlife,
      assetCandidates: exactCandidates ?? profile.wildlife.assetCandidates,
      speciesId: speciesId ?? null,
      surfaceRoles,
      region: geography.region,
      profileId: geography.region,
      geography,
      authoredAssetExact: Boolean(exactCandidates),
    });
  }
  return Object.freeze({ ...profile.human, region: geography.region, profileId: geography.region, geography, speciesId: speciesId ?? null, authoredAssetExact: false });
}

export function resolveLivingWorldSceneryFamilies(worldX, worldZ) {
  const geography = canonicalRegionForPosition(worldX, worldZ);
  return Object.freeze({ region: geography.region, families: REGION_ASSET_PROFILES[geography.region]?.scenery || REGION_ASSET_PROFILES.temperate.scenery, geography });
}

function nearestDistance(point, seats) {
  let nearest = Infinity;
  for (const seat of seats || []) {
    if (!Number.isFinite(seat?.x) || !Number.isFinite(seat?.z)) continue;
    nearest = Math.min(nearest, Math.hypot(point.x - seat.x, point.z - seat.z));
  }
  return nearest;
}

function roadDistance(point, edges) {
  let nearest = Infinity;
  for (const edge of edges || []) {
    const points = Array.isArray(edge?.points) ? edge.points : [];
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1]; const b = points[i];
      if (![a?.x, a?.z, b?.x, b?.z].every(Number.isFinite)) continue;
      const abx = b.x - a.x; const abz = b.z - a.z; const len2 = abx * abx + abz * abz || 1;
      const t = clamp(((point.x - a.x) * abx + (point.z - a.z) * abz) / len2, 0, 1);
      nearest = Math.min(nearest, Math.hypot(point.x - (a.x + abx * t), point.z - (a.z + abz * t)));
    }
  }
  return nearest;
}

export function validateLivingWorldSpawn(context, { groundHeight, slopeDegrees, waterDepth, settlementSeats = [], roadEdges = [], role = 'wildlife', speciesId = null } = {}) {
  if (!context?.position) return Object.freeze({ ok: false, reason: 'missing-context' });
  const point = context.position;
  return resolveLivingWorldGeography({
    worldX: point.x,
    worldZ: point.z,
    speciesId,
    role,
    groundHeight,
    slopeDegrees,
    waterDepth,
    settlementDistance: nearestDistance(point, settlementSeats),
    roadDistance: roadDistance(point, roadEdges),
    seed: context.seed,
  });
}

export function prepareLivingWorldAsset(object, { geography, assetId, assetCategory, src, paletteId, materialRecipe, surfaceQuery, position, rotation, scale, metadata = {} } = {}) {
  if (!object || !geography) return Object.freeze({ ok: false, error: 'missing-object-or-geography' });
  const result = prepareWorldAssetForPlacement(object, {
    metadata: { ...metadata, id: assetId, category: assetCategory, src, geographyProfile: geography.profileId, geographyRegion: geography.region },
    paletteId,
    materialRecipe,
    surfaceQuery,
    position,
    rotation,
    scale,
    requireSurfaceContext: Boolean(surfaceQuery),
    snapToGround: true,
  });
  return Object.freeze({ ...result, geography });
}

export function auditLivingWorldAsset(object, geography) {
  const placement = auditWorldAssetPlacement(object);
  return Object.freeze({ ...placement, geography: geography ? { region: geography.region, profileId: geography.profileId, normalizedReference: geography.normalizedReference } : null });
}

export function materialSurfaceRolesForLivingWorld({ role = 'guard', speciesId = null, worldX = 0, worldZ = 0 } = {}) {
  const profile = resolveLivingWorldAssetProfile({ worldX, worldZ, speciesId, role });
  return Object.freeze({
    profileId: profile.profileId,
    region: profile.region,
    speciesId: profile.speciesId,
    assetCandidates: profile.assetCandidates,
    authoredAssetExact: profile.authoredAssetExact,
    surfaceRoles: profile.surfaceRoles,
    sharedMaterialAuthority: 'MaterialAssignmentCore.js',
    sharedPlacementAuthority: 'WorldAssetPlacementPipeline.js',
  });
}

export function livingWorldGeographyDigest(value) {
  const source = JSON.stringify({ policyId: LIVING_WORLD_GEOGRAPHY_POLICY.id, region: value?.region, profileId: value?.profileId, speciesId: value?.speciesId, normalizedReference: value?.normalizedReference, reason: value?.reason });
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) { hash ^= source.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function auditLivingWorldGeographyCatalog() {
  const errors = [];
  if (LIVING_WORLD_GEOGRAPHY_POLICY.sourceMapSha256 !== MAP_SHA256) errors.push('map-sha-mismatch');
  if (!LIVING_WORLD_GEOGRAPHY_POLICY.deterministic) errors.push('non-deterministic-policy');
  for (const [region, profile] of Object.entries(REGION_ASSET_PROFILES)) {
    if (!profile.human?.assetCandidates?.length) errors.push(`${region}:human-assets-missing`);
    if (!profile.human?.surfaceRoles?.includes('skin')) errors.push(`${region}:human-skin-role-missing`);
    if (!profile.human?.surfaceRoles?.includes('clothing')) errors.push(`${region}:human-clothing-role-missing`);
    if (!profile.wildlife?.assetCandidates?.length) errors.push(`${region}:wildlife-assets-missing`);
    if (!profile.wildlife?.surfaceRoles?.includes('fur')) errors.push(`${region}:wildlife-fur-role-missing`);
    if (!profile.wildlife?.surfaceRoles?.includes('eye')) errors.push(`${region}:wildlife-eye-role-missing`);
    if (!profile.scenery?.length) errors.push(`${region}:scenery-missing`);
    for (const path of profile.human.assetCandidates) if (!/^assets\/models\//.test(path)) errors.push(`${region}:invalid-human-asset:${path}`);
    for (const path of profile.wildlife.assetCandidates) if (!/^assets\/models\//.test(path)) errors.push(`${region}:invalid-wildlife-asset:${path}`);
  }
  for (const [speciesId, candidates] of Object.entries(SPECIES_AUTHORED_ASSETS)) {
    if (!candidates.length) errors.push(`${speciesId}:exact-asset-missing`);
    for (const path of candidates) if (!/^assets\/models\//.test(path)) errors.push(`${speciesId}:invalid-exact-asset:${path}`);
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors), regionCount: Object.keys(REGION_ASSET_PROFILES).length, exactSpeciesAssetCount: Object.keys(SPECIES_AUTHORED_ASSETS).length });
}

export function canonicalGeographySnapshot(points = []) {
  return Object.freeze(points.map((point) => {
    const result = canonicalRegionForPosition(point.x, point.z);
    return Object.freeze({ x: point.x, z: point.z, region: result.region, zone: result.zone.id, water: result.water.id, relief: Number(result.relief.toFixed(4)) });
  }));
}

export const LIVING_WORLD_GEOGRAPHY_ASSET_ROLES = Object.freeze({
  human: Object.freeze(['skin','hair','eyes','clothing','boots','gear']),
  horse: Object.freeze(['coat','mane','tail','hoof','saddle','harness']),
  wildlife: Object.freeze(['fur','eye','claw','tooth']),
  dragon: Object.freeze(['scale','wing','eye','horn','claw']),
});
