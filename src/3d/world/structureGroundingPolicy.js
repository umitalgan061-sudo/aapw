const HARD_EXCLUDED_PRIMITIVES = Object.freeze([
  'land-cell', 'terrain-cell', 'terrain',
  'water-cell', 'water', 'ocean', 'lake', 'river',
  'road-segment', 'road', 'path-segment', 'path',
  'tree', 'grass', 'vegetation', 'soldier',
]);

const STRUCTURE_TERMS = Object.freeze([
  'architecture', 'architectural', 'building', 'structure', 'settlement', 'village', 'city', 'town',
  'castle', 'citadel', 'keep', 'tower', 'watchtower', 'lighthouse', 'wall', 'gate', 'gatehouse', 'fort', 'fortress',
  'fortification', 'palace', 'house', 'farmhouse', 'boathouse', 'hall', 'manor', 'inn', 'tavern', 'hut', 'cottage', 'barn',
  'stable', 'granary', 'warehouse', 'workshop', 'forge', 'smithy', 'mill', 'market', 'sept', 'temple', 'shrine', 'chapel',
  'church', 'cathedral', 'abbey', 'monastery', 'crypt', 'mausoleum', 'barracks', 'armory', 'armoury', 'library', 'school',
  'hospital', 'bridge', 'aqueduct', 'dock', 'pier', 'quay', 'wharf', 'harbor', 'harbour', 'port', 'shipyard', 'rampart',
  'battlement', 'ruin', 'monument', 'arena', 'stadium', 'well', 'fountain',
  'mimari', 'bina', 'yapi', 'yapı', 'konut', 'yerlesim', 'yerleşim', 'koy', 'köy', 'sehir', 'şehir', 'kasaba', 'kale',
  'hisar', 'sur', 'kule', 'gozetleme', 'gözetleme', 'saray', 'kosk', 'köşk', 'malikane', 'ciftlik', 'çiftlik', 'baraka',
  'kulube', 'kulübe', 'kopru', 'köprü', 'iskele', 'liman', 'rihtim', 'rıhtım', 'tersane', 'depo', 'ambar', 'atolye',
  'atölye', 'demirhane', 'degirmen', 'değirmen', 'pazar', 'ahir', 'ahır', 'han', 'meyhane', 'tapinak', 'tapınak',
  'mabet', 'sapel', 'şapel', 'manastir', 'manastır', 'katedral', 'kisla', 'kışla', 'cephanelik', 'kutuphane', 'kütüphane',
  'okul', 'hastane', 'mezar', 'anit', 'anıt', 'kuyu', 'cesme', 'çeşme',
]);

const TURKISH_STRUCTURE_STEMS = Object.freeze([
  'mimari', 'bina', 'yapi', 'yapı', 'konut', 'yerlesim', 'yerleşim', 'koy', 'köy', 'sehir', 'şehir', 'kasaba', 'kale',
  'hisar', 'kule', 'gozetleme', 'gözetleme', 'saray', 'kosk', 'köşk', 'malikane', 'ciftlik', 'çiftlik', 'baraka', 'kulube',
  'kulübe', 'kopru', 'köprü', 'iskele', 'liman', 'rihtim', 'rıhtım', 'tersane', 'depo', 'ambar', 'atolye', 'atölye',
  'demirhane', 'degirmen', 'değirmen', 'pazar', 'ahir', 'ahır', 'meyhane', 'tapinak', 'tapınak', 'mabet', 'sapel', 'şapel',
  'manastir', 'manastır', 'katedral', 'kisla', 'kışla', 'cephanelik', 'kutuphane', 'kütüphane', 'okul', 'hastane', 'mezar',
  'anit', 'anıt', 'kuyu', 'cesme', 'çeşme',
]);

const DESCRIPTOR_FIELDS = Object.freeze([
  'id', 'name', 'category', 'kind', 'primitive', 'src',
  'assetId', 'assetName', 'assetCategory', 'assetKind', 'assetPrimitive', 'assetSrc',
]);

const HARD_EXCLUDED_SET = new Set(HARD_EXCLUDED_PRIMITIVES);
const STRUCTURE_PATTERN = new RegExp(
  `(^|[^a-z0-9çğıöşü])(${STRUCTURE_TERMS.map(escapeRegExp).join('|')})(?=$|[^a-z0-9çğıöşü])`,
  'iu',
);

export const STRUCTURE_GROUNDING_POLICY = Object.freeze({
  id: 'structure-grounding-classifier-2026-08-24-v1-shared',
  footprintProbeCount: 9,
  primaryMetadataOverridesFallback: true,
  protectedPrimitivesOverrideOptIn: true,
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
    .join(' ')
    .toLocaleLowerCase('tr-TR');
}

function hasLocalizedStructureStem(descriptor) {
  const words = descriptor.split(/[^a-z0-9çğıöşü]+/iu).filter(Boolean);
  return words.some((word) => TURKISH_STRUCTURE_STEMS.some((stem) => word === stem || word.startsWith(stem)));
}

function isMetadataObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
