/**
 * World Coverage Visual Runtime v52 — policy matrix.
 *
 * This file is intentionally data-first. It never authors geometry or invents geography.
 * Policies describe how already-shipped canonical terrain, water, road and environment assets
 * should be rendered when the runtime sees their existing semantic/userData/name metadata.
 *
 * Asset placement remains governed by MaterialAssignmentCore + WorldAssetPlacementPipeline.
 * No editor module is imported here and no new placeholder asset is created.
 */

export const WORLD_COVERAGE_VISUAL_V52_ID = 'world-coverage-visual-runtime-2026-09-10-v52';
export const WORLD_COVERAGE_VISUAL_V52_SOURCE = 'canonical-runtime-scene';
export const WORLD_COVERAGE_VISUAL_V52_CONTRACT = Object.freeze({
  materialContract: 'MaterialAssignmentCore',
  placementContract: 'WorldAssetPlacementPipeline',
  editorRuntimeImportForbidden: true,
  geometryAuthoringForbidden: true,
  canonicalGeographyRequired: true,
});

export const WORLD_COVERAGE_V52_BUDGET = Object.freeze({
  maxMaterialMutationsPerFrame: 120,
  maxObjectMutationsPerFrame: 160,
  rescanIntervalFrames: 6,
  vegetationScaleMin: 0.88,
  vegetationScaleMax: 1.16,
  vegetationMaxVisibleDistanceMeters: 17000,
  nearDetailDistanceMeters: 1600,
  midDetailDistanceMeters: 5200,
  farDetailDistanceMeters: 11000,
  waterWaveSuppression: 0.42,
  atmosphereSmoothing: 0.08,
});

const FREEZE = Object.freeze;
const surface = (albedo, roughness, normalStrength, ao, variation) => FREEZE({ albedo, roughness, normalStrength, ao, variation });

export const TERRAIN_SURFACE_POLICIES = FREEZE({
  grass: surface([0.34, 0.38, 0.20], 0.94, 0.58, 0.82, 0.16),
  meadow: surface([0.42, 0.45, 0.24], 0.91, 0.54, 0.80, 0.14),
  soil: surface([0.31, 0.25, 0.16], 0.98, 0.42, 0.88, 0.18),
  mud: surface([0.24, 0.21, 0.16], 0.99, 0.34, 0.90, 0.12),
  wetSoil: surface([0.20, 0.22, 0.18], 0.96, 0.38, 0.92, 0.15),
  scree: surface([0.37, 0.34, 0.30], 0.97, 0.68, 0.89, 0.20),
  rock: surface([0.39, 0.37, 0.34], 0.99, 0.76, 0.93, 0.22),
  darkRock: surface([0.28, 0.27, 0.26], 0.99, 0.72, 0.91, 0.19),
  snow: surface([0.78, 0.81, 0.80], 0.88, 0.34, 0.72, 0.12),
  ice: surface([0.62, 0.76, 0.82], 0.76, 0.28, 0.55, 0.11),
  shoreline: surface([0.29, 0.31, 0.25], 0.91, 0.45, 0.86, 0.19),
});

export const WATER_SURFACE_POLICIES = FREEZE({
  sea: FREEZE({
    deep: [0.045, 0.16, 0.22],
    shallow: [0.20, 0.42, 0.44],
    roughness: 0.30,
    metalness: 0.02,
    opacity: 0.92,
    normalScale: 0.16,
    flowStrength: 0.10,
    stripeSuppression: 0.58,
  }),
  lake: FREEZE({
    deep: [0.07, 0.24, 0.27],
    shallow: [0.25, 0.47, 0.45],
    roughness: 0.34,
    metalness: 0.01,
    opacity: 0.89,
    normalScale: 0.13,
    flowStrength: 0.07,
    stripeSuppression: 0.68,
  }),
  river: FREEZE({
    deep: [0.06, 0.22, 0.25],
    shallow: [0.22, 0.43, 0.41],
    roughness: 0.37,
    metalness: 0.00,
    opacity: 0.86,
    normalScale: 0.11,
    flowStrength: 0.12,
    stripeSuppression: 0.54,
  }),
  generic: FREEZE({
    deep: [0.06, 0.19, 0.24],
    shallow: [0.21, 0.41, 0.42],
    roughness: 0.36,
    metalness: 0.00,
    opacity: 0.88,
    normalScale: 0.12,
    flowStrength: 0.08,
    stripeSuppression: 0.60,
  }),
});

export const VEGETATION_POLICIES = FREEZE({
  tree: FREEZE({ roughness: 0.86, trunkRoughness: 0.96, leafRoughness: 0.82, minScale: 0.92, maxScale: 1.10, fadeStart: 5200, fadeEnd: 11200, bias: 0.08 }),
  conifer: FREEZE({ roughness: 0.88, trunkRoughness: 0.97, leafRoughness: 0.84, minScale: 0.90, maxScale: 1.14, fadeStart: 4800, fadeEnd: 10800, bias: 0.11 }),
  shrub: FREEZE({ roughness: 0.93, trunkRoughness: 0.96, leafRoughness: 0.90, minScale: 0.88, maxScale: 1.16, fadeStart: 3300, fadeEnd: 7800, bias: 0.07 }),
  grass: FREEZE({ roughness: 0.95, trunkRoughness: 0.95, leafRoughness: 0.94, minScale: 0.84, maxScale: 1.12, fadeStart: 1400, fadeEnd: 4200, bias: 0.05 }),
  fern: FREEZE({ roughness: 0.96, trunkRoughness: 0.96, leafRoughness: 0.93, minScale: 0.86, maxScale: 1.10, fadeStart: 1100, fadeEnd: 3600, bias: 0.04 }),
});

export const GEOLOGY_POLICIES = FREEZE({
  cliff: FREEZE({ roughness: 0.99, normalStrength: 0.82, colorBias: [0.93, 0.91, 0.88], edgeContrast: 0.22, talusBias: 0.16 }),
  ridge: FREEZE({ roughness: 0.98, normalStrength: 0.74, colorBias: [0.92, 0.90, 0.86], edgeContrast: 0.18, talusBias: 0.12 }),
  mountain: FREEZE({ roughness: 0.98, normalStrength: 0.70, colorBias: [0.90, 0.89, 0.86], edgeContrast: 0.15, talusBias: 0.14 }),
  scree: FREEZE({ roughness: 0.995, normalStrength: 0.86, colorBias: [0.88, 0.87, 0.84], edgeContrast: 0.24, talusBias: 0.22 }),
  boulder: FREEZE({ roughness: 0.99, normalStrength: 0.80, colorBias: [0.87, 0.86, 0.82], edgeContrast: 0.20, talusBias: 0.20 }),
});

export const ROAD_POLICIES = FREEZE({
  road: FREEZE({ roughness: 0.93, metalness: 0, color: [0.30, 0.27, 0.22], variation: 0.14, edgeFade: 0.16 }),
  path: FREEZE({ roughness: 0.95, metalness: 0, color: [0.34, 0.31, 0.24], variation: 0.18, edgeFade: 0.21 }),
  stoneRoad: FREEZE({ roughness: 0.99, metalness: 0, color: [0.42, 0.39, 0.34], variation: 0.12, edgeFade: 0.11 }),
  bridge: FREEZE({ roughness: 0.97, metalness: 0, color: [0.38, 0.35, 0.30], variation: 0.10, edgeFade: 0.08 }),
});

export const ATMOSPHERE_POLICY = FREEZE({
  fallbackBackground: [0.028, 0.045, 0.065],
  horizonLift: 0.14,
  farMountainDesaturation: 0.18,
  fogDensityNear: 0.000014,
  fogDensityFar: 0.000006,
  fogColor: [0.30, 0.38, 0.41],
  skyBlueNightFloor: 0.02,
  exposureMin: 0.82,
  exposureMax: 1.16,
  blackBackgroundThreshold: 0.006,
});

export const MATERIAL_FAMILY_ALIASES = FREEZE({
  terrain: ['terrain', 'ground', 'land', 'soil', 'grass', 'meadow', 'mud', 'scree', 'rock', 'snow', 'ice', 'cliff'],
  water: ['water', 'sea', 'ocean', 'lake', 'river', 'stream', 'shore'],
  vegetation: ['tree', 'forest', 'foliage', 'leaf', 'leaves', 'grass', 'shrub', 'fern', 'bush', 'pine', 'conifer', 'reed'],
  geology: ['cliff', 'rock', 'boulder', 'stone', 'mountain', 'ridge', 'talus', 'scree'],
  road: ['road', 'path', 'track', 'trail', 'bridge', 'street'],
  settlement: ['house', 'hut', 'castle', 'wall', 'tower', 'building', 'settlement', 'village', 'gate', 'market'],
  sky: ['sky', 'aurora', 'star', 'atmosphere', 'cloud', 'moon', 'sun'],
});

export const V52_VISIBILITY_TIERS = FREEZE({
  near: FREEZE({ start: 0, end: 1600, opacity: 1 }),
  mid: FREEZE({ start: 1600, end: 5200, opacity: 0.98 }),
  far: FREEZE({ start: 5200, end: 11000, opacity: 0.90 }),
  extreme: FREEZE({ start: 11000, end: 17000, opacity: 0.72 }),
});

export const SURFACE_CONTEXT_WEIGHTS = FREEZE({
  slope: FREEZE({ low: 0.10, medium: 0.32, high: 0.74, cliff: 0.92 }),
  moisture: FREEZE({ dry: 0.12, temperate: 0.38, wet: 0.68, saturated: 0.86 }),
  height: FREEZE({ valley: 0.14, lowland: 0.30, upland: 0.56, alpine: 0.80, summit: 0.94 }),
  waterDistance: FREEZE({ shore: 0.92, near: 0.60, mid: 0.30, far: 0.06 }),
});

export const REQUIRED_RUNTIME_TOKENS = FREEZE([
  'MaterialAssignmentCore',
  'WorldAssetPlacementPipeline',
  'canonicalGeographyRequired',
  'geometryAuthoringForbidden',
  'P0',
  'P1',
  'P2',
  'P3',
  'P4',
  'P5',
]);

export function normalizeVisualFamily(value) {
  const token = String(value ?? '').trim().toLowerCase();
  if (!token) return 'unknown';
  for (const [family, aliases] of Object.entries(MATERIAL_FAMILY_ALIASES)) {
    if (aliases.some((alias) => token.includes(alias))) return family;
  }
  return 'unknown';
}

export function classifyWaterKind(value) {
  const token = String(value ?? '').trim().toLowerCase();
  if (token.includes('river') || token.includes('stream')) return 'river';
  if (token.includes('lake') || token.includes('pond')) return 'lake';
  if (token.includes('sea') || token.includes('ocean')) return 'sea';
  return 'generic';
}

export function surfacePolicyFor(family, context = {}) {
  if (family === 'terrain') {
    const token = `${context.surface ?? ''} ${context.name ?? ''}`.toLowerCase();
    if (token.includes('snow') || token.includes('ice')) return TERRAIN_SURFACE_POLICIES.snow;
    if (token.includes('scree') || token.includes('talus')) return TERRAIN_SURFACE_POLICIES.scree;
    if (token.includes('rock') || token.includes('stone') || token.includes('cliff')) return TERRAIN_SURFACE_POLICIES.rock;
    if (token.includes('mud') || context.moisture === 'wet') return TERRAIN_SURFACE_POLICIES.mud;
    if (token.includes('soil')) return TERRAIN_SURFACE_POLICIES.soil;
    return TERRAIN_SURFACE_POLICIES.grass;
  }
  if (family === 'water') return WATER_SURFACE_POLICIES[classifyWaterKind(context.name ?? context.kind)];
  if (family === 'geology') return GEOLOGY_POLICIES[context.kind] ?? GEOLOGY_POLICIES.mountain;
  if (family === 'road') return ROAD_POLICIES[context.kind] ?? ROAD_POLICIES.road;
  return null;
}

export function tierForDistance(distanceMeters) {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= V52_VISIBILITY_TIERS.near.end) return 'near';
  if (distanceMeters <= V52_VISIBILITY_TIERS.mid.end) return 'mid';
  if (distanceMeters <= V52_VISIBILITY_TIERS.far.end) return 'far';
  return 'extreme';
}

export function deterministicUnit(seed) {
  let value = Number(seed) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967295;
}

export function deterministicRange(seed, min, max) {
  return min + (max - min) * deterministicUnit(seed);
}

export function materialRiskFlags({ family, material, object }) {
  const flags = [];
  if (!material) flags.push('missing-material');
  if (family === 'water' && material?.color?.r > 0.30 && material?.color?.g > 0.70) flags.push('cyan-risk');
  if (family === 'terrain' && material?.roughness < 0.65) flags.push('flat-plastic-risk');
  if (family === 'vegetation' && material?.roughness < 0.55) flags.push('synthetic-leaf-risk');
  if (object && object.visible === false) flags.push('hidden');
  return flags;
}

export function p0VisualRules() {
  return FREEZE([
    'no visible rectangular water block',
    'no visible tile boundary',
    'no visible grid seam',
    'no visible coast stair-step amplification',
    'no obvious directional water stripe',
    'no synthetic cyan overlay',
  ]);
}

export function p1VisualRules() {
  return FREEZE([
    'preserve canonical height provenance',
    'preserve canonical collider coordinate',
    'increase rock/scree material separation',
    'avoid flat unlit mountain surfaces',
    'do not author replacement mountain geometry',
  ]);
}

export function p2VisualRules() {
  return FREEZE([
    'retain authored maps when available',
    'raise roughness on dry ground',
    'lower roughness only for genuinely wet water materials',
    'preserve normal maps and AO',
    'use deterministic nonuniform material response',
    'do not overwrite imported PBR maps with solid-color placeholders',
  ]);
}

export function p3VisualRules() {
  return FREEZE([
    'asset-first only',
    'deterministic scale/yaw variation',
    'frustum culling on by default',
    'distance-aware visibility',
    'no floating vegetation',
    'no vegetation beyond canonical land masks',
  ]);
}

export function p4VisualRules() {
  return FREEZE([
    'deep-to-shallow color response',
    'reduced repeated wave signal',
    'shoreline wet-edge response only where already authored',
    'no cyan rectangle',
    'no hard water halo',
  ]);
}

export function p5VisualRules() {
  return FREEZE([
    'no black sky fallback',
    'camera-relative atmospheric readability',
    'far mountain desaturation',
    'stable mobile exposure range',
    'fog must not erase near terrain detail',
  ]);
}

export const V52_ACCEPTANCE = FREEZE({
  visibleGridSeams: 0,
  visibleWaterRectangles: 0,
  obviousWaterMoiré: 0,
  blackSkyFailures: 0,
  floatingVegetation: 0,
  placeholderGeometry: 0,
  missingMaterialAssignments: 0,
  invalidWaterOnLand: 0,
  visualPolicyFamilyCoverage: ['terrain', 'water', 'vegetation', 'geology', 'road', 'settlement', 'sky'],
});

export const V52_EVIDENCE_SAMPLE_POINTS = FREEZE([
  FREEZE({ id: 'full-world-center', x: 0, z: 0 }),
  FREEZE({ id: 'northwest-near', x: -3100, z: -1800 }),
  FREEZE({ id: 'north-east-mountain', x: 2900, z: -1650 }),
  FREEZE({ id: 'south-coast', x: 0, z: 2350 }),
  FREEZE({ id: 'west-lake', x: -2900, z: 120 }),
  FREEZE({ id: 'east-settlement', x: 2700, z: 980 }),
  FREEZE({ id: 'river-valley', x: 520, z: 820 }),
  FREEZE({ id: 'forest-ecotone', x: -1050, z: -680 }),
]);

export function acceptanceTargetFor(family) {
  switch (family) {
    case 'water': return ['no rectangle', 'no stripe/moire', 'natural depth response'];
    case 'terrain': return ['macro breakup', 'micro-readable surface', 'canonical mask parity'];
    case 'vegetation': return ['cluster/ecotone', 'asset-first silhouette', 'no floating instances'];
    case 'geology': return ['ridge/cliff exposure', 'scree separation', 'no smooth wall'];
    case 'road': return ['soft edge', 'natural roughness', 'no sterile ribbon'];
    case 'settlement': return ['ground contact', 'material slot integrity'];
    case 'sky': return ['non-black horizon', 'far-depth readability'];
    default: return ['unclassified objects are preserved, not replaced'];
  }
}

export const V52_REFERENCE_NOTES = FREEZE({
  provenance: 'Owner-map canonical reference; runtime is a render-adoption layer only.',
  scope: 'P0-P5 environment production.',
  nonGoals: FREEZE(['new geography', 'new settlement topology', 'new combat logic', 'editor UI', 'physics rewrite']),
  lifecycle: 'install once, observe render calls, update deterministically, dispose explicitly.',
  concurrency: 'Only one renderer hook per browser realm; controller is per-scene.',
});

export default FREEZE({
  id: WORLD_COVERAGE_VISUAL_V52_ID,
  contract: WORLD_COVERAGE_VISUAL_V52_CONTRACT,
  budget: WORLD_COVERAGE_V52_BUDGET,
  terrain: TERRAIN_SURFACE_POLICIES,
  water: WATER_SURFACE_POLICIES,
  vegetation: VEGETATION_POLICIES,
  geology: GEOLOGY_POLICIES,
  roads: ROAD_POLICIES,
  atmosphere: ATMOSPHERE_POLICY,
  acceptance: V52_ACCEPTANCE,
});
