/**
 * Read-only category profiles shared by autonomous environment consumers.
 *
 * These profiles mirror the semantics of the existing WorldAssetPlacementPipeline surface presets,
 * but they do not import or duplicate that pipeline. They give player/NPC/settlement systems one
 * terrain-side description of acceptable slope, water, biome and clearance context before they ask the
 * central placement gate to prepare an actual asset. The numbers are conservative safety envelopes,
 * not geography generation rules.
 * @module world/terrainGroundContextProfiles
 */

const freezeProfile = (profile) => Object.freeze({
  ...profile,
  forbiddenBiomes: Object.freeze([...(profile.forbiddenBiomes || [])]),
  allowedBiomes: Object.freeze([...(profile.allowedBiomes || [])]),
  allowedWaterTypes: Object.freeze([...(profile.allowedWaterTypes || [])]),
  forbiddenWaterTypes: Object.freeze([...(profile.forbiddenWaterTypes || [])]),
});

export const TERRAIN_GROUND_CONTEXT_PROFILES = Object.freeze({
  vegetation: freezeProfile({
    id: 'vegetation', maxSlopeDegrees: 38, maxWaterDepth: 0.05, minRoadDistance: 0.75,
    minSettlementDistance: 0, forbiddenBiomes: ['ocean', 'lake', 'river', 'cliff'],
  }),
  tree: freezeProfile({
    id: 'tree', maxSlopeDegrees: 34, maxWaterDepth: 0.05, minRoadDistance: 1.5,
    minSettlementDistance: 0, forbiddenBiomes: ['ocean', 'lake', 'river', 'cliff', 'alpine-bare'],
  }),
  rock: freezeProfile({
    id: 'rock', maxSlopeDegrees: 72, maxWaterDepth: 0.8, minRoadDistance: 0,
    minSettlementDistance: 0, allowedWaterTypes: ['none', 'shore', 'shallow'],
  }),
  building: freezeProfile({
    id: 'building', maxSlopeDegrees: 12, maxWaterDepth: 0.02, minRoadDistance: 0,
    minSettlementDistance: 0, forbiddenBiomes: ['ocean', 'lake', 'river', 'cliff'],
  }),
  settlement: freezeProfile({
    id: 'settlement', maxSlopeDegrees: 12, maxWaterDepth: 0.02, minRoadDistance: 0,
    minSettlementDistance: 0, forbiddenBiomes: ['ocean', 'lake', 'river', 'cliff'],
  }),
  bridge: freezeProfile({
    id: 'bridge', maxSlopeDegrees: 24, maxWaterDepth: Infinity, minRoadDistance: 0,
    minSettlementDistance: 0, allowedWaterTypes: ['none', 'shore', 'shallow', 'deep'],
  }),
  waterside: freezeProfile({
    id: 'waterside', maxSlopeDegrees: 18, maxWaterDepth: Infinity, minRoadDistance: 0,
    minSettlementDistance: 0, allowedWaterTypes: ['shore', 'shallow', 'deep'],
  }),
});

export function listTerrainGroundContextProfiles() {
  return Object.freeze(Object.keys(TERRAIN_GROUND_CONTEXT_PROFILES));
}

export function resolveTerrainGroundContextProfile(category = 'vegetation') {
  const key = String(category || 'vegetation').toLowerCase();
  return TERRAIN_GROUND_CONTEXT_PROFILES[key] || TERRAIN_GROUND_CONTEXT_PROFILES.vegetation;
}

export function evaluateTerrainGroundContextAgainstProfile(context, category = 'vegetation', overrides = {}) {
  const profile = resolveTerrainGroundContextProfile(category);
  const c = context && typeof context === 'object' ? context : {};
  const slopeDegrees = Number(c.slope?.degrees ?? 0);
  const waterDepth = Number(c.water?.depthMeters ?? 0);
  const biome = String(c.dominantBiome ?? c.biomeName ?? '').toLowerCase();
  const waterType = String(c.water?.type ?? (c.water?.land ? 'none' : c.water?.shallow ? 'shallow' : c.water?.deep ? 'deep' : 'shore')).toLowerCase();
  const maxSlopeDegrees = Number.isFinite(overrides.maxSlopeDegrees) ? overrides.maxSlopeDegrees : profile.maxSlopeDegrees;
  const maxWaterDepth = Number.isFinite(overrides.maxWaterDepth) ? overrides.maxWaterDepth : profile.maxWaterDepth;
  const minRoadDistance = Number.isFinite(overrides.minRoadDistance) ? overrides.minRoadDistance : profile.minRoadDistance;
  const minSettlementDistance = Number.isFinite(overrides.minSettlementDistance) ? overrides.minSettlementDistance : profile.minSettlementDistance;
  const roadDistance = Number(c.distance?.roadMeters ?? c.roadDistanceMeters ?? Infinity);
  const settlementDistance = Number(c.distance?.settlementMeters ?? c.settlementDistanceMeters ?? Infinity);
  const slopeOk = Number.isFinite(slopeDegrees) && slopeDegrees <= maxSlopeDegrees;
  const waterOk = Number.isFinite(waterDepth) && waterDepth <= maxWaterDepth;
  const roadOk = !Number.isFinite(roadDistance) || roadDistance >= minRoadDistance;
  const settlementOk = !Number.isFinite(settlementDistance) || settlementDistance >= minSettlementDistance;
  const forbiddenBiome = biome && profile.forbiddenBiomes.includes(biome);
  const allowedBiome = profile.allowedBiomes.length === 0 || profile.allowedBiomes.includes(biome);
  const forbiddenWater = profile.forbiddenWaterTypes.includes(waterType);
  const allowedWater = profile.allowedWaterTypes.length === 0 || profile.allowedWaterTypes.includes(waterType);
  return Object.freeze({
    category: profile.id,
    profile,
    slopeOk,
    waterOk,
    roadOk,
    settlementOk,
    forbiddenBiome,
    allowedBiome,
    forbiddenWater,
    allowedWater,
    accepted: slopeOk && waterOk && roadOk && settlementOk && !forbiddenBiome && allowedBiome && !forbiddenWater && allowedWater,
    reason: !slopeOk ? 'slope' : !waterOk ? 'water-depth' : !roadOk ? 'road-clearance'
      : !settlementOk ? 'settlement-clearance' : forbiddenBiome || !allowedBiome ? 'biome'
        : forbiddenWater || !allowedWater ? 'water-type' : 'accepted',
  });
}

export function serializeTerrainGroundContextProfile(category = 'vegetation') {
  const profile = resolveTerrainGroundContextProfile(category);
  return JSON.stringify(profile);
}

export const getTerrainGroundProfile = resolveTerrainGroundContextProfile;
export const evaluateGroundContextProfile = evaluateTerrainGroundContextAgainstProfile;
