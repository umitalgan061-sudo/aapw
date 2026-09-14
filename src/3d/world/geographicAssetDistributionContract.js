/**
 * Geographic visual distribution contract for living-world assets.
 *
 * This module is deliberately data-only. It does not spawn entities and it does not replace the
 * existing NPC, fauna, settlement, road, biome or world-event systems. Its job is to answer one
 * visual question consistently: which real asset family belongs to which geographic context, and
 * which material surfaces must remain visually distinct when that asset is dressed.
 *
 * The canonical geographic authority remains `worldReferenceMap.js`; this contract only maps those
 * already-authored biome kinds to existing asset families. The same palette/part vocabulary is used
 * by `MaterialAssignmentCore.js` and the geographic ambient director so an NPC cannot silently
 * become a single flat material merely because it was placed in a different climate.
 */

export const GEOGRAPHIC_ASSET_DISTRIBUTION_VERSION = '2026-09-07.v1';

export const CHARACTER_SURFACE_REQUIREMENTS = Object.freeze({
  human: Object.freeze({
    requiredSemanticSurfaces: Object.freeze(['skin', 'hair', 'eyes', 'clothing', 'boots', 'gear']),
    preferredPaletteFamilies: Object.freeze(['skin-fair', 'skin-olive', 'skin-brown', 'skin-deep']),
    materialSeparation: 'named-or-layered',
    visualFailure: 'single-flat-character-material',
  }),
  horse: Object.freeze({
    requiredSemanticSurfaces: Object.freeze(['coat', 'mane', 'tail', 'hoof', 'saddle', 'harness']),
    materialSeparation: 'named-or-layered',
    visualFailure: 'single-flat-equine-material',
  }),
  wolf: Object.freeze({
    requiredSemanticSurfaces: Object.freeze(['fur', 'eye', 'claw', 'tooth']),
    materialSeparation: 'named-or-layered',
    visualFailure: 'single-flat-wolf-material',
  }),
  creature: Object.freeze({
    requiredSemanticSurfaces: Object.freeze(['body', 'eye', 'claw', 'tooth']),
    materialSeparation: 'named-or-layered',
    visualFailure: 'single-flat-creature-material',
  }),
  dragon: Object.freeze({
    requiredSemanticSurfaces: Object.freeze(['scale', 'wing', 'eye', 'horn', 'claw']),
    materialSeparation: 'named-or-layered',
    visualFailure: 'single-flat-dragon-material',
  }),
});

export const CHARACTER_ASSET_PROFILES = Object.freeze({
  'peasant-girl': Object.freeze({
    source: 'assets/models/characters/peasant_girl.fbx',
    family: 'human',
    role: 'settlement-worker',
    preferredBiomes: Object.freeze(['lush-grassland', 'temperate-coast', 'cold-grassland', 'marsh', 'jungle']),
    palette: 'peasant',
    surfaceRequirements: CHARACTER_SURFACE_REQUIREMENTS.human,
    authoredMaterialPolicy: 'preserve-when-present',
  }),
  'paladin-j-nordstrom': Object.freeze({
    source: 'assets/models/characters/paladin_j_nordstrom.fbx',
    family: 'human',
    role: 'road-guard',
    preferredBiomes: Object.freeze(['snow', 'cold-grassland', 'mountain', 'rocky-hills', 'temperate-coast']),
    palette: 'knight',
    surfaceRequirements: CHARACTER_SURFACE_REQUIREMENTS.human,
    authoredMaterialPolicy: 'preserve-when-present',
  }),
  'erika-archer': Object.freeze({
    source: 'assets/models/characters/erika_archer.fbx',
    family: 'human',
    role: 'frontier-scout',
    preferredBiomes: Object.freeze(['steppe', 'desert', 'arid', 'lush-grassland', 'rocky-hills', 'jungle', 'temperate-coast']),
    palette: 'soldier',
    surfaceRequirements: CHARACTER_SURFACE_REQUIREMENTS.human,
    authoredMaterialPolicy: 'preserve-when-present',
  }),
  'wolf-blender-282a': Object.freeze({
    source: 'assets/models/animals/wolf/Wolf-Blender-2.82a.glb',
    family: 'wolf',
    role: 'wild-pack',
    preferredBiomes: Object.freeze(['cold-grassland', 'mountain', 'rocky-hills', 'steppe', 'jungle']),
    palette: 'wolf-grey',
    surfaceRequirements: CHARACTER_SURFACE_REQUIREMENTS.wolf,
    authoredMaterialPolicy: 'preserve-when-present',
  }),
  'dragon-baked-fbx': Object.freeze({
    source: 'assets/models/creatures/dragon/Dragon_Baked_Actions_fbx_7.4_binary.fbx',
    family: 'dragon',
    role: 'aerial-predator',
    preferredBiomes: Object.freeze(['mountain', 'desert', 'arid', 'jungle', 'snow']),
    palette: 'dragon-black',
    surfaceRequirements: CHARACTER_SURFACE_REQUIREMENTS.dragon,
    authoredMaterialPolicy: 'preserve-when-present',
    textureEvidence: Object.freeze([
      'assets/models/creatures/dragon/textures/Dragon_ground_color.jpg',
      'assets/models/creatures/dragon/textures/Dragon_Bump_Col2.jpg',
      'assets/models/creatures/dragon/textures/Dragon_Nor.jpg',
      'assets/models/creatures/dragon/textures/Ani_Fire_A.png',
    ]),
  }),
});

export const GEOGRAPHIC_BIOME_VISUAL_PROFILES = Object.freeze({
  snow: Object.freeze({
    visualIdentity: 'permanent-winter',
    characters: Object.freeze(['paladin-j-nordstrom']),
    fauna: Object.freeze(['wolf-blender-282a']),
    forbiddenCharacterFamilies: Object.freeze(['peasant-girl']),
    groundMood: 'ice-snow-rock',
  }),
  'cold-grassland': Object.freeze({
    visualIdentity: 'northern-pasture',
    characters: Object.freeze(['paladin-j-nordstrom', 'peasant-girl']),
    fauna: Object.freeze(['wolf-blender-282a']),
    forbiddenCharacterFamilies: Object.freeze([]),
    groundMood: 'cold-meadow',
  }),
  marsh: Object.freeze({
    visualIdentity: 'wet-lowland',
    characters: Object.freeze(['peasant-girl']),
    fauna: Object.freeze([]),
    forbiddenCharacterFamilies: Object.freeze(['paladin-j-nordstrom']),
    groundMood: 'mud-reed-water',
  }),
  mountain: Object.freeze({
    visualIdentity: 'high-relief',
    characters: Object.freeze(['paladin-j-nordstrom']),
    fauna: Object.freeze(['wolf-blender-282a', 'dragon-baked-fbx']),
    forbiddenCharacterFamilies: Object.freeze(['peasant-girl']),
    groundMood: 'rock-scree',
  }),
  'rocky-hills': Object.freeze({
    visualIdentity: 'dry-rocky-upland',
    characters: Object.freeze(['paladin-j-nordstrom', 'erika-archer']),
    fauna: Object.freeze(['wolf-blender-282a']),
    forbiddenCharacterFamilies: Object.freeze([]),
    groundMood: 'stone-scrub',
  }),
  'lush-grassland': Object.freeze({
    visualIdentity: 'fertile-plains',
    characters: Object.freeze(['peasant-girl', 'erika-archer']),
    fauna: Object.freeze([]),
    forbiddenCharacterFamilies: Object.freeze([]),
    groundMood: 'green-meadow',
  }),
  'temperate-coast': Object.freeze({
    visualIdentity: 'salt-wind-coast',
    characters: Object.freeze(['peasant-girl', 'paladin-j-nordstrom', 'erika-archer']),
    fauna: Object.freeze([]),
    forbiddenCharacterFamilies: Object.freeze([]),
    groundMood: 'coastal-grass',
  }),
  desert: Object.freeze({
    visualIdentity: 'hot-arid-desert',
    characters: Object.freeze(['erika-archer']),
    fauna: Object.freeze(['dragon-baked-fbx']),
    forbiddenCharacterFamilies: Object.freeze(['peasant-girl']),
    groundMood: 'sand-salt-rock',
  }),
  arid: Object.freeze({
    visualIdentity: 'grey-dry-waste',
    characters: Object.freeze(['erika-archer']),
    fauna: Object.freeze(['dragon-baked-fbx']),
    forbiddenCharacterFamilies: Object.freeze(['peasant-girl']),
    groundMood: 'dust-stone',
  }),
  steppe: Object.freeze({
    visualIdentity: 'open-steppe',
    characters: Object.freeze(['erika-archer']),
    fauna: Object.freeze(['wolf-blender-282a']),
    forbiddenCharacterFamilies: Object.freeze(['peasant-girl']),
    groundMood: 'dry-grass',
  }),
  jungle: Object.freeze({
    visualIdentity: 'humid-jungle',
    characters: Object.freeze(['peasant-girl', 'erika-archer']),
    fauna: Object.freeze(['wolf-blender-282a', 'dragon-baked-fbx']),
    forbiddenCharacterFamilies: Object.freeze([]),
    groundMood: 'dense-green-mud',
  }),
});

export const GEOGRAPHIC_DISTRIBUTION_RULES = Object.freeze([
  Object.freeze({ id: 'settlement-ring', description: 'Ambient humans belong in a ring around canonical settlement seats, not inside the settlement core.', minSettlementDistanceMeters: 88, maxSettlementDistanceMeters: 260 }),
  Object.freeze({ id: 'road-buffer', description: 'Ambient humans must not sit on the canonical road ribbon; use a small side-of-road buffer.', minRoadDistanceMeters: 4 }),
  Object.freeze({ id: 'slope-buffer', description: 'Ambient humans belong on walkable terrain rather than cliff faces or extreme ridges.', maxSlopeDegrees: 24 }),
  Object.freeze({ id: 'water-buffer', description: 'Ambient humans never spawn below the water surface.', maxWaterDepthMeters: 0.02 }),
  Object.freeze({ id: 'mobile-budget', description: 'Mobile keeps a small visual population budget with behavior/render throttling.', maxInstances: 5, updateIntervalSeconds: 0.2 }),
  Object.freeze({ id: 'desktop-budget', description: 'Desktop keeps a modest bounded visual population; it is not an unrestricted crowd system.', maxInstances: 12, updateIntervalSeconds: 0.2 }),
  Object.freeze({ id: 'lod-hysteresis', description: 'Near/far thresholds are separated so actors do not flicker at the boundary.', showDistanceMeters: 700, hideDistanceMeters: 920 }),
  Object.freeze({ id: 'deterministic-placement', description: 'Placement candidate order derives from stable world seed and settlement identity; no Math.random().', randomSource: 'stable-hash' }),
]);

export function getGeographicBiomeVisualProfile(biomeKind) {
  return GEOGRAPHIC_BIOME_VISUAL_PROFILES[String(biomeKind || '').toLowerCase()] || null;
}

export function getCharacterAssetProfile(assetId) {
  return CHARACTER_ASSET_PROFILES[assetId] || null;
}

export function isAssetAllowedInBiome(assetId, biomeKind) {
  const profile = getCharacterAssetProfile(assetId);
  if (!profile) return false;
  return profile.preferredBiomes.includes(String(biomeKind || '').toLowerCase());
}

export function getSurfaceRequirements(family) {
  return CHARACTER_SURFACE_REQUIREMENTS[family] || null;
}

export function summarizeGeographicDistribution() {
  const biomeKinds = Object.keys(GEOGRAPHIC_BIOME_VISUAL_PROFILES);
  const assetIds = Object.keys(CHARACTER_ASSET_PROFILES);
  return Object.freeze({
    version: GEOGRAPHIC_ASSET_DISTRIBUTION_VERSION,
    biomeCount: biomeKinds.length,
    assetProfileCount: assetIds.length,
    familyCount: Object.keys(CHARACTER_SURFACE_REQUIREMENTS).length,
    biomeKinds,
    assetIds,
    rules: GEOGRAPHIC_DISTRIBUTION_RULES.map((rule) => rule.id),
  });
}
