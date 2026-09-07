import { CHARACTER_SURFACE_REQUIREMENTS } from './geographicAssetDistributionContract.js';

/**
 * Real fauna/creature/dragon habitat profiles. Entity behavior remains owned by existing gameplay
 * controllers; this module only states where those existing real assets belong visually.
 */
export const GEOGRAPHIC_FAUNA_HABITAT_VERSION = '2026-09-07.v1';

export const REAL_FAUNA_ASSETS = Object.freeze({
  horse: Object.freeze({
    id: 'white-horse',
    source: 'assets/models/animals/white_horse_bEdE4rmZy9.glb',
    family: 'horse',
    controller: 'animalConfig',
    allowedBiomes: Object.freeze(['lush-grassland', 'temperate-coast', 'cold-grassland', 'steppe', 'rocky-hills']),
    preferredBiomes: Object.freeze(['lush-grassland', 'cold-grassland']),
    surfaceRequirements: CHARACTER_SURFACE_REQUIREMENTS.horse,
    clips: Object.freeze(['Idle', 'Walk', 'Gallop']),
    habitatRule: 'pasture-road-settlement-edge',
  }),
  wolf: Object.freeze({
    id: 'wolf-blender-282a',
    source: 'assets/models/animals/wolf/Wolf-Blender-2.82a.glb',
    family: 'wolf',
    controller: 'animals',
    allowedBiomes: Object.freeze(['snow', 'cold-grassland', 'mountain', 'rocky-hills', 'steppe', 'jungle']),
    preferredBiomes: Object.freeze(['cold-grassland', 'mountain', 'rocky-hills']),
    surfaceRequirements: CHARACTER_SURFACE_REQUIREMENTS.wolf,
    clips: Object.freeze(['Idle', 'Walk', 'Run']),
    habitatRule: 'edge-forest-rock-corridor',
  }),
  dragon: Object.freeze({
    id: 'dragon-baked-fbx',
    source: 'assets/models/creatures/dragon/Dragon_Baked_Actions_fbx_7.4_binary.fbx',
    family: 'dragon',
    controller: 'dragonConfig',
    allowedBiomes: Object.freeze(['snow', 'mountain', 'desert', 'arid', 'jungle']),
    preferredBiomes: Object.freeze(['mountain', 'desert', 'jungle']),
    surfaceRequirements: CHARACTER_SURFACE_REQUIREMENTS.dragon,
    clips: Object.freeze(['Idle', 'Fly_New']),
    textureSources: Object.freeze([
      'assets/models/creatures/dragon/textures/Dragon_ground_color.jpg',
      'assets/models/creatures/dragon/textures/Dragon_Bump_Col2.jpg',
      'assets/models/creatures/dragon/textures/Dragon_Nor.jpg',
      'assets/models/creatures/dragon/textures/Ani_Fire_A.png',
    ]),
    habitatRule: 'high-relief-aerial-range',
  }),
});

export const FAUNA_HABITAT_RULES = Object.freeze({
  horse: Object.freeze({
    maxSlopeDegrees: 22,
    maxWaterDepthMeters: 0.08,
    minSettlementDistanceMeters: 20,
    maxSettlementDistanceMeters: 180,
    minRoadDistanceMeters: 2.0,
  }),
  wolf: Object.freeze({
    maxSlopeDegrees: 34,
    maxWaterDepthMeters: 0.30,
    minSettlementDistanceMeters: 180,
    maxSettlementDistanceMeters: 1700,
    minRoadDistanceMeters: 12,
  }),
  dragon: Object.freeze({
    maxSlopeDegrees: 89,
    maxWaterDepthMeters: 999,
    minSettlementDistanceMeters: 260,
    maxSettlementDistanceMeters: 4200,
    minRoadDistanceMeters: 25,
  }),
});

export const FAUNA_BIOME_HABITATS = Object.freeze({
  snow: Object.freeze({ horse: false, wolf: true, dragon: true }),
  'cold-grassland': Object.freeze({ horse: true, wolf: true, dragon: false }),
  marsh: Object.freeze({ horse: false, wolf: false, dragon: false }),
  mountain: Object.freeze({ horse: false, wolf: true, dragon: true }),
  'rocky-hills': Object.freeze({ horse: true, wolf: true, dragon: false }),
  'lush-grassland': Object.freeze({ horse: true, wolf: false, dragon: false }),
  'temperate-coast': Object.freeze({ horse: true, wolf: false, dragon: false }),
  desert: Object.freeze({ horse: false, wolf: false, dragon: true }),
  arid: Object.freeze({ horse: false, wolf: false, dragon: true }),
  steppe: Object.freeze({ horse: true, wolf: true, dragon: false }),
  jungle: Object.freeze({ horse: false, wolf: true, dragon: true }),
});

export function getFaunaHabitatRule(family) {
  return FAUNA_HABITAT_RULES[String(family || '').toLowerCase()] || null;
}

export function getRealFaunaAsset(id) {
  return REAL_FAUNA_ASSETS[id] || null;
}

export function isFaunaAllowedInBiome(id, biomeKind) {
  const asset = getRealFaunaAsset(id);
  const biome = String(biomeKind || '').toLowerCase();
  if (!asset || !asset.allowedBiomes.includes(biome)) return false;
  return FAUNA_BIOME_HABITATS[biome]?.[asset.family] === true;
}

export function describeFaunaVisualContract(family) {
  const asset = Object.values(REAL_FAUNA_ASSETS).find((candidate) => candidate.family === String(family || '').toLowerCase());
  if (!asset) return null;
  return Object.freeze({
    id: asset.id,
    source: asset.source,
    family: asset.family,
    controller: asset.controller,
    clips: asset.clips,
    surfaceRequirements: asset.surfaceRequirements.requiredSemanticSurfaces,
    habitatRule: asset.habitatRule,
  });
}

export function summarizeFaunaHabitatContract() {
  return Object.freeze({
    version: GEOGRAPHIC_FAUNA_HABITAT_VERSION,
    assets: Object.values(REAL_FAUNA_ASSETS).map(({ id, source, family, controller }) => ({ id, source, family, controller })),
    habitatKinds: Object.keys(FAUNA_BIOME_HABITATS),
    ruleFamilies: Object.keys(FAUNA_HABITAT_RULES),
  });
}
