const HARD_EXCLUDED_PRIMITIVES = Object.freeze([
  'land-cell', 'terrain-cell', 'terrain',
  'water-cell', 'water', 'ocean', 'lake', 'river',
  'road-segment', 'road', 'path-segment', 'path',
  'tree', 'grass', 'vegetation', 'soldier',
]);

const STRUCTURE_TERMS = Object.freeze([
  'architecture', 'architectural', 'building', 'structure', 'settlement', 'village', 'city', 'town',
  'castle', 'citadel', 'keep', 'tower', 'watchtower', 'towerhouse', 'stronghold', 'outpost', 'lighthouse', 'wall', 'gate', 'gatehouse', 'fort', 'fortress',
  'fortification', 'palace', 'house', 'longhouse', 'townhouse', 'rowhouse', 'farmhouse', 'boathouse', 'hall', 'manor', 'inn', 'tavern', 'hut', 'cottage', 'cabin', 'shed', 'barn',
  'stable', 'granary', 'warehouse', 'workshop', 'forge', 'smithy', 'foundry', 'brewery', 'bakery', 'mill', 'market', 'sept', 'temple', 'shrine', 'chapel',
  'church', 'cathedral', 'abbey', 'monastery', 'crypt', 'mausoleum', 'barracks', 'armory', 'armoury', 'library', 'school',
  'hospital', 'bridge', 'aqueduct', 'dock', 'pier', 'quay', 'wharf', 'harbor', 'harbour', 'port', 'shipyard', 'rampart',
  'battlement', 'ruin', 'monument', 'arena', 'stadium', 'well', 'fountain', 'residence', 'homestead', 'farmstead', 'estate', 'greenhouse',
  'mimari', 'bina', 'yapi', 'yapı', 'konut', 'yerlesim', 'yerleşim', 'koy', 'köy', 'sehir', 'şehir', 'kasaba', 'kale',
  'hisar', 'sur', 'kule', 'gozetleme', 'gözetleme', 'karakol', 'saray', 'kosk', 'köşk', 'malikane', 'ciftlik', 'çiftlik', 'baraka',
  'kulube', 'kulübe', 'kopru', 'köprü', 'iskele', 'liman', 'rihtim', 'rıhtım', 'tersane', 'depo', 'ambar', 'atolye',
  'atölye', 'demirhane', 'dokumhane', 'dökümhane', 'birahane', 'firin', 'fırın', 'degirmen', 'değirmen', 'pazar', 'ahir', 'ahır', 'han', 'meyhane', 'tapinak', 'tapınak',
  'mabet', 'sapel', 'şapel', 'manastir', 'manastır', 'katedral', 'kisla', 'kışla', 'cephanelik', 'kutuphane', 'kütüphane',
  'okul', 'hastane', 'mezar', 'anit', 'anıt', 'kuyu', 'cesme', 'çeşme', 'sera',
]);

const TURKISH_STRUCTURE_STEMS = Object.freeze([
  'mimari', 'bina', 'yapi', 'yapı', 'konut', 'yerlesim', 'yerleşim', 'koy', 'köy', 'sehir', 'şehir', 'kasaba', 'kale',
  'hisar', 'kule', 'gozetleme', 'gözetleme', 'karakol', 'saray', 'kosk', 'köşk', 'malikane', 'ciftlik', 'çiftlik', 'baraka', 'kulube',
  'kulübe', 'kopru', 'köprü', 'iskele', 'liman', 'rihtim', 'rıhtım', 'tersane', 'depo', 'ambar', 'atolye', 'atölye',
  'demirhane', 'dokumhane', 'dökümhane', 'birahane', 'firin', 'fırın', 'degirmen', 'değirmen', 'pazar', 'ahir', 'ahır', 'meyhane', 'tapinak', 'tapınak', 'mabet', 'sapel', 'şapel',
  'manastir', 'manastır', 'katedral', 'kisla', 'kışla', 'cephanelik', 'kutuphane', 'kütüphane', 'okul', 'hastane', 'mezar',
  'anit', 'anıt', 'kuyu', 'cesme', 'çeşme', 'sera',
]);

const BRIDGE_PROFILE_TERMS = Object.freeze(['bridge', 'aqueduct']);
const BRIDGE_PROFILE_STEMS = Object.freeze(['kopru', 'köprü']);
const WATERSIDE_PROFILE_TERMS = Object.freeze([
  'dock', 'pier', 'quay', 'wharf', 'harbor', 'harbour', 'port', 'shipyard', 'boathouse', 'lighthouse',
]);
const WATERSIDE_PROFILE_STEMS = Object.freeze(['iskele', 'liman', 'rihtim', 'rıhtım', 'tersane']);

const DESCRIPTOR_FIELDS = Object.freeze([
  'id', 'name', 'category', 'kind', 'type', 'subtype', 'family', 'tags', 'primitive', 'src',
  'assetId', 'assetName', 'assetCategory', 'assetKind', 'assetType', 'assetSubtype', 'assetFamily', 'assetTags', 'assetPrimitive', 'assetSrc',
]);

const HARD_EXCLUDED_SET = new Set(HARD_EXCLUDED_PRIMITIVES);
const STRUCTURE_PATTERN = termPattern(STRUCTURE_TERMS);
const BRIDGE_PROFILE_PATTERN = termPattern(BRIDGE_PROFILE_TERMS);
const WATERSIDE_PROFILE_PATTERN = termPattern(WATERSIDE_PROFILE_TERMS);

export const STRUCTURE_GROUNDING_POLICY = Object.freeze({
  id: 'structure-grounding-classifier-2026-08-24-v3-family-aliases',
  footprintProbeCount: 9,
  primaryMetadataOverridesFallback: true,
  protectedPrimitivesOverrideOptIn: true,
  surfaceProfiles: Object.freeze(['building', 'bridge', 'waterside']),
  hardExcludedPrimitives: HARD_EXCLUDED_PRIMITIVES,
  descriptorFields: DESCRIPTOR_FIELDS,
});

export function classifyStructureGrounding(primaryMetadata, fallbackMetadata = null) {
  const metadata = mergeMetadata(primaryMetadata, fallbackMetadata);
  if (!metadata) {
    return Object.freeze({ isStructure: false, reason: 'missing-metadata', primitive: '', descriptor: '' });
  }

  const primitive = String(metadata.primitive || metadata.assetPrimitive || '').trim().toLocaleLowerCase('tr-TR');
  if (HARD_EXCLUDED_SET.has(primitive)) {
    return Object.freeze({ isStructure: false, reason: `protected-primitive:${primitive}`, primitive, descriptor: '' });
  }

  if (metadata.terrainFoundation === false || metadata.structureLike === false) {
    return Object.freeze({ isStructure: false, reason: 'explicit-opt-out', primitive, descriptor: structureDescriptor(metadata) });
  }
  if (metadata.terrainFoundation === true || metadata.structureLike === true) {
    return Object.freeze({ isStructure: true, reason: 'explicit-opt-in', primitive, descriptor: structureDescriptor(metadata) });
  }

  const descriptor = structureDescriptor(metadata);
  if (STRUCTURE_PATTERN.test(descriptor)) {
    return Object.freeze({ isStructure: true, reason: 'descriptor-term', primitive, descriptor });
  }
  if (hasLocalizedStructureStem(descriptor)) {
    return Object.freeze({ isStructure: true, reason: 'localized-stem', primitive, descriptor });
  }
  return Object.freeze({ isStructure: false, reason: 'no-structure-signal', primitive, descriptor });
}

export function isStructureGroundingCandidate(primaryMetadata, fallbackMetadata = null) {
  return classifyStructureGrounding(primaryMetadata, fallbackMetadata).isStructure;
}

export function resolveStructureSurfaceProfile(primaryMetadata, fallbackMetadata = null) {
  const classification = classifyStructureGrounding(primaryMetadata, fallbackMetadata);
  if (!classification.isStructure) return null;
  const descriptor = classification.descriptor;
  if (BRIDGE_PROFILE_PATTERN.test(descriptor) || hasStem(descriptor, BRIDGE_PROFILE_STEMS)) return 'bridge';
  if (WATERSIDE_PROFILE_PATTERN.test(descriptor) || hasStem(descriptor, WATERSIDE_PROFILE_STEMS)) return 'waterside';
  return 'building';
}

function mergeMetadata(primaryMetadata, fallbackMetadata) {
  const primary = isMetadataObject(primaryMetadata) ? primaryMetadata : null;
  const fallback = isMetadataObject(fallbackMetadata) ? fallbackMetadata : null;
  if (!primary && !fallback) return null;
  if (!fallback) return primary;
  if (!primary) return fallback;

  const merged = { ...fallback };
  for (const [key, value] of Object.entries(primary)) {
    if (value !== undefined && value !== null && value !== '') merged[key] = value;
  }
  return merged;
}

function structureDescriptor(metadata) {
  return DESCRIPTOR_FIELDS
    .map((field) => metadata?.[field])
    .filter((value) => value !== undefined && value !== null && value !== '')
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .join(' ')
    .toLocaleLowerCase('tr-TR');
}

function hasLocalizedStructureStem(descriptor) {
  return hasStem(descriptor, TURKISH_STRUCTURE_STEMS);
}

function hasStem(descriptor, stems) {
  const words = descriptor.split(/[^a-z0-9çğıöşü]+/iu).filter(Boolean);
  return words.some((word) => stems.some((stem) => word === stem || word.startsWith(stem)));
}

function termPattern(terms) {
  return new RegExp(
    `(^|[^a-z0-9çğıöşü])(${terms.map(escapeRegExp).join('|')})(?=$|[^a-z0-9çğıöşü])`,
    'iu',
  );
}

function isMetadataObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
