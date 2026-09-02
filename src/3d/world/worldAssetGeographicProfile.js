/**
 * Canonical geographic presentation profile for placed world assets.
 *
 * This module does not create regions, move objects or own geography. It combines the existing
 * north-reference cryosphere classifier with surface telemetry already supplied to the shared world
 * placement pipeline. Autonomous ecological categories can use the resulting suitability score to
 * avoid obviously implausible distribution (for example normal trees on permanent ice), while
 * authored structures remain placement-authoritative. The same profile also drives render-only
 * material weathering so an asset does not look chemically identical in glacial, damp and dry zones.
 *
 * Canonical terrain height, map.png/Pindex, shoreline, hydrology, routes, settlements and colliders
 * are untouched.
 * @module world/worldAssetGeographicProfile
 */

import { northReferenceCryosphereAtWorldXZ } from './northReferenceCryosphere.js';

const clamp01 = (value) => value < 0 ? 0 : value > 1 ? 1 : value;
const lerp = (a, b, t) => a + (b - a) * t;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const smoothstep = (edge0, edge1, value) => {
  if (edge0 === edge1) return value >= edge1 ? 1 : 0;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};
const boundedUnion = (a, b) => 1 - (1 - clamp01(a)) * (1 - clamp01(b));

export const WORLD_ASSET_GEOGRAPHIC_PROFILE_POLICY = Object.freeze({
  id: 'world-asset-geographic-profile-2026-09-02-v1-canonical-climate-surface',
  deterministic: true,
  renderOnlyWeathering: true,
  canonicalCryosphereAuthority: 'world/northReferenceCryosphere.js',
  canonicalHeightUnchanged: true,
  canonicalHydrologyUnchanged: true,
  canonicalShorelineUnchanged: true,
  canonicalColliderUnchanged: true,
  authoredStructurePlacementUnchanged: true,
  autonomousCategories: Object.freeze(['vegetation', 'tree', 'rock', 'waterside']),
  structureCategories: Object.freeze(['building', 'settlement', 'bridge']),
  defaultMoisture: 0.48,
  defaultSuitability: 1,
  eligibilityThresholds: Object.freeze({
    vegetation: 0.12,
    tree: 0.16,
    rock: 0.08,
    waterside: 0.10,
  }),
  treePermanentIceSuppression: 0.985,
  treeTundraSuppression: 0.78,
  vegetationPermanentIceSuppression: 0.86,
  vegetationTundraSuppression: 0.48,
  watersideDryPenalty: 0.72,
  rockMinimumSuitability: 0.34,
  frostFromPermanentIce: 0.92,
  frostFromTundra: 0.48,
  snowDustFromPermanentIce: 0.72,
  snowDustFromTundra: 0.22,
  organicColdSuppression: 0.80,
  saltOceanGain: 0.76,
});

const CATEGORY_ALIASES = Object.freeze({
  foliage: 'vegetation',
  grass: 'vegetation',
  shrub: 'vegetation',
  bush: 'vegetation',
  plant: 'vegetation',
  plants: 'vegetation',
  trees: 'tree',
  forest: 'tree',
  boulder: 'rock',
  rocks: 'rock',
  stone: 'rock',
  cliff: 'rock',
  geology: 'rock',
  shore: 'waterside',
  coastal: 'waterside',
  riverbank: 'waterside',
  dock: 'waterside',
  pier: 'waterside',
  structure: 'building',
  house: 'building',
  castle: 'building',
  village: 'settlement',
});

const MATERIAL_FAMILY_HINTS = Object.freeze([
  Object.freeze({ family: 'foliage', terms: Object.freeze(['leaf', 'leaves', 'foliage', 'grass', 'plant', 'pine', 'needle', 'moss']) }),
  Object.freeze({ family: 'wood', terms: Object.freeze(['wood', 'timber', 'plank', 'bark', 'beam', 'log', 'branch']) }),
  Object.freeze({ family: 'stone', terms: Object.freeze(['stone', 'rock', 'brick', 'mortar', 'masonry', 'granite', 'basalt', 'cliff']) }),
  Object.freeze({ family: 'metal', terms: Object.freeze(['metal', 'iron', 'steel', 'bronze', 'copper', 'chain', 'plate']) }),
  Object.freeze({ family: 'soil', terms: Object.freeze(['soil', 'dirt', 'mud', 'earth', 'ground', 'sand']) }),
  Object.freeze({ family: 'fabric', terms: Object.freeze(['cloth', 'fabric', 'canvas', 'leather', 'hide', 'wool']) }),
]);

function normalizedCategory(metadata = {}, objectMetadata = {}) {
  const raw = String(
    metadata.category
      || metadata.kind
      || objectMetadata.assetCategory
      || objectMetadata.category
      || objectMetadata.kind
      || '',
  ).trim().toLowerCase();
  return CATEGORY_ALIASES[raw] || raw || 'generic';
}

function normalizedBiome(surface = {}) {
  return surface?.biome == null ? '' : String(surface.biome).trim().toLowerCase();
}

function normalizedWaterType(surface = {}) {
  return surface?.waterType == null ? '' : String(surface.waterType).trim().toLowerCase();
}

function surfaceMoisture(surface = {}) {
  return surface?.moisture == null
    ? WORLD_ASSET_GEOGRAPHIC_PROFILE_POLICY.defaultMoisture
    : clamp01(finite(surface.moisture, WORLD_ASSET_GEOGRAPHIC_PROFILE_POLICY.defaultMoisture));
}

function surfaceSlope(surface = {}) {
  return Math.max(0, finite(surface?.slopeDegrees, 0));
}

function dryBiomesWeight(biome) {
  if (!biome) return 0;
  if (/(desert|arid|dry|heath|scrub|badland|volcanic)/.test(biome)) return 1;
  if (/(alpine|bare|rock|cliff)/.test(biome)) return 0.45;
  return 0;
}

function wetBiomesWeight(biome) {
  if (!biome) return 0;
  if (/(marsh|swamp|bog|wetland|riparian|river|lake)/.test(biome)) return 1;
  if (/(forest|meadow|grass)/.test(biome)) return 0.24;
  return 0;
}

function rockyBiomesWeight(biome) {
  if (!biome) return 0;
  return /(rock|cliff|alpine|bare|mountain|volcanic|scree)/.test(biome) ? 1 : 0;
}

function climateWeights(worldX, worldZ) {
  const canonical = northReferenceCryosphereAtWorldXZ(worldX, worldZ) || {};
  const permanentIce = clamp01(finite(canonical.permanentIce, 0));
  const tundra = clamp01(finite(canonical.tundra, 0));
  const tundraBand = tundra * (1 - permanentIce);
  const mixedIce = 4 * permanentIce * (1 - permanentIce);
  const cold = boundedUnion(permanentIce, tundraBand * 0.72);
  const deepCold = clamp01(permanentIce * 0.88 + tundraBand * 0.24);
  const temperate = clamp01(1 - cold);
  return Object.freeze({
    permanentIce,
    tundra,
    tundraBand,
    mixedIce,
    cold,
    deepCold,
    temperate,
    normalizedY: Number.isFinite(canonical.normalizedY) ? canonical.normalizedY : null,
  });
}

function surfaceWeights(surface = {}, category = 'generic') {
  const moisture = surfaceMoisture(surface);
  const slopeDegrees = surfaceSlope(surface);
  const slopeShoulder = smoothstep(11, 38, slopeDegrees);
  const steep = smoothstep(26, 58, slopeDegrees);
  const gentle = 1 - smoothstep(8, 30, slopeDegrees);
  const biome = normalizedBiome(surface);
  const waterType = normalizedWaterType(surface);
  const rawWaterDepth = surface?.waterDepth;
  const waterDepth = rawWaterDepth == null ? null : Math.max(0, finite(rawWaterDepth, 0));
  const wetBiome = wetBiomesWeight(biome);
  const dryBiome = dryBiomesWeight(biome);
  const rockyBiome = rockyBiomesWeight(biome);
  const wet = clamp01(moisture * 0.76 + wetBiome * 0.42 + (waterDepth !== null && waterDepth > 0 ? 0.22 : 0));
  const dry = clamp01((1 - moisture) * 0.78 + dryBiome * 0.44 - wetBiome * 0.20);
  const exposed = clamp01(slopeShoulder * 0.68 + steep * 0.24 + rockyBiome * 0.32);
  const sheltered = clamp01(gentle * (0.52 + moisture * 0.28) + wetBiome * 0.22);
  const ocean = waterType === 'ocean' || biome === 'ocean' ? 1 : 0;
  const freshwater = /^(lake|river|stream|pond)$/.test(waterType) || /(lake|river|riparian)/.test(biome) ? 1 : 0;
  const watersideEvidence = clamp01(
    (category === 'waterside' ? 0.34 : 0)
      + (ocean || freshwater ? 0.50 : 0)
      + (waterDepth !== null ? smoothstep(0, 0.35, waterDepth) * 0.30 : 0)
      + wetBiome * 0.22,
  );
  return Object.freeze({
    moisture,
    slopeDegrees,
    slopeShoulder,
    steep,
    gentle,
    biome,
    waterType,
    waterDepth,
    wet,
    dry,
    exposed,
    sheltered,
    ocean,
    freshwater,
    watersideEvidence,
    rockyBiome,
  });
}

function categorySuitability(category, climate, surface) {
  const P = WORLD_ASSET_GEOGRAPHIC_PROFILE_POLICY;
  if (P.structureCategories.includes(category)) {
    return Object.freeze({ score: 1, threshold: 0, eligible: true, reason: 'authored-structure-authority' });
  }

  let score = P.defaultSuitability;
  let reason = 'generic-neutral';
  if (category === 'tree') {
    const climateRetention = clamp01(
      1
        - climate.permanentIce * P.treePermanentIceSuppression
        - climate.tundraBand * P.treeTundraSuppression,
    );
    const moistureHealth = 0.48 + (1 - Math.abs(surface.moisture - 0.58) / 0.58) * 0.52;
    const slopeHealth = 1 - smoothstep(27, 43, surface.slopeDegrees) * 0.86;
    score = climateRetention * moistureHealth * slopeHealth;
    reason = climate.permanentIce > 0.55 ? 'permanent-ice-tree-suppression'
      : climate.tundraBand > 0.35 ? 'tundra-treeline-suppression' : 'temperate-tree-support';
  } else if (category === 'vegetation') {
    const climateRetention = clamp01(
      1
        - climate.permanentIce * P.vegetationPermanentIceSuppression
        - climate.tundraBand * P.vegetationTundraSuppression,
    );
    const moistureHealth = 0.38 + surface.moisture * 0.46 + surface.sheltered * 0.16;
    const slopeHealth = 1 - smoothstep(31, 47, surface.slopeDegrees) * 0.72;
    score = climateRetention * moistureHealth * slopeHealth;
    reason = climate.deepCold > 0.60 ? 'deep-cold-vegetation-suppression' : 'ground-cover-climate-support';
  } else if (category === 'rock') {
    const geologySupport = clamp01(
      P.rockMinimumSuitability
        + surface.exposed * 0.36
        + surface.rockyBiome * 0.24
        + climate.cold * 0.10
        + surface.dry * 0.08,
    );
    score = Math.max(P.rockMinimumSuitability, geologySupport);
    reason = climate.cold > 0.55 ? 'cold-exposed-bedrock-support'
      : surface.exposed > 0.45 ? 'slope-bedrock-support' : 'baseline-geology-support';
  } else if (category === 'waterside') {
    score = clamp01(
      0.26
        + surface.watersideEvidence * 0.62
        + surface.wet * 0.22
        - surface.dry * P.watersideDryPenalty * 0.42,
    );
    reason = surface.watersideEvidence > 0.52 ? 'water-edge-support' : 'weak-water-edge-evidence';
  }

  const threshold = P.eligibilityThresholds[category] ?? 0;
  return Object.freeze({ score: clamp01(score), threshold, eligible: score >= threshold, reason });
}

function weatheringWeights(category, climate, surface) {
  const P = WORLD_ASSET_GEOGRAPHIC_PROFILE_POLICY;
  const organicCategory = category === 'tree' || category === 'vegetation';
  const frost = clamp01(
    climate.permanentIce * P.frostFromPermanentIce
      + climate.tundraBand * P.frostFromTundra
      + climate.mixedIce * 0.10,
  );
  const snowDust = clamp01(
    climate.permanentIce * P.snowDustFromPermanentIce
      + climate.tundraBand * P.snowDustFromTundra,
  ) * (0.54 + surface.sheltered * 0.34 + surface.exposed * 0.12);
  const wet = clamp01(surface.wet * (1 - frost * 0.28));
  const dry = clamp01(surface.dry * (1 - wet * 0.42));
  const salt = clamp01(surface.ocean * surface.watersideEvidence * P.saltOceanGain);
  const organic = clamp01(
    (organicCategory ? 0.60 : 0.18)
      * surface.moisture
      * (1 - climate.cold * P.organicColdSuppression)
      * (1 - surface.dry * 0.54),
  );
  const mineral = clamp01(
    (category === 'rock' ? 0.48 : 0.14)
      + surface.exposed * 0.24
      + dry * 0.18
      + frost * 0.10,
  );
  const abrasion = clamp01(surface.exposed * (0.46 + dry * 0.34 + frost * 0.20));
  return Object.freeze({
    frost,
    snowDust: clamp01(snowDust),
    wet,
    dry,
    salt,
    organic,
    mineral,
    abrasion,
    exposure: surface.exposed,
    shelter: surface.sheltered,
  });
}

export function resolveWorldAssetGeographicProfile({
  worldX = 0,
  worldZ = 0,
  surface = {},
  metadata = {},
  objectMetadata = {},
} = {}) {
  const x = finite(worldX, 0);
  const z = finite(worldZ, 0);
  const category = normalizedCategory(metadata, objectMetadata);
  const climate = climateWeights(x, z);
  const surfaceProfile = surfaceWeights(surface || {}, category);
  const suitability = categorySuitability(category, climate, surfaceProfile);
  const weathering = weatheringWeights(category, climate, surfaceProfile);
  const autonomous = WORLD_ASSET_GEOGRAPHIC_PROFILE_POLICY.autonomousCategories.includes(category);
  const structure = WORLD_ASSET_GEOGRAPHIC_PROFILE_POLICY.structureCategories.includes(category);

  return Object.freeze({
    policyId: WORLD_ASSET_GEOGRAPHIC_PROFILE_POLICY.id,
    deterministic: true,
    canonicalGeographyUnchanged: true,
    worldX: x,
    worldZ: z,
    category,
    autonomous,
    structure,
    climate,
    surface: surfaceProfile,
    suitability,
    weathering,
  });
}

export function evaluateWorldAssetGeographicEligibility(profile, {
  enforceAutonomous = true,
} = {}) {
  if (!profile) return Object.freeze({ ok: true, reason: 'missing-profile-neutral' });
  if (profile.structure) return Object.freeze({ ok: true, reason: 'authored-structure-authority' });
  if (!profile.autonomous || !enforceAutonomous) {
    return Object.freeze({ ok: true, reason: 'advisory-only-category' });
  }
  if (profile.suitability.eligible) {
    return Object.freeze({ ok: true, reason: profile.suitability.reason, score: profile.suitability.score });
  }
  return Object.freeze({
    ok: false,
    reason: profile.suitability.reason,
    score: profile.suitability.score,
    threshold: profile.suitability.threshold,
  });
}

export function geographicDensityScaleForWorldAsset(profile) {
  if (!profile) return 1;
  if (profile.structure) return 1;
  if (!profile.autonomous) return 1;
  const threshold = profile.suitability.threshold || 0;
  const normalized = threshold >= 1
    ? profile.suitability.score
    : clamp01((profile.suitability.score - threshold) / Math.max(1e-6, 1 - threshold));
  return clamp01(lerp(0.18, 1, smoothstep(0, 1, normalized)));
}

export function inferWorldAssetMaterialFamily({
  category = '',
  materialName = '',
  meshName = '',
  assetName = '',
} = {}) {
  const categoryName = CATEGORY_ALIASES[String(category).trim().toLowerCase()] || String(category).trim().toLowerCase();
  if (categoryName === 'tree' || categoryName === 'vegetation') return 'foliage';
  if (categoryName === 'rock') return 'stone';
  const haystack = `${materialName} ${meshName} ${assetName}`.toLowerCase();
  for (const hint of MATERIAL_FAMILY_HINTS) {
    if (hint.terms.some((term) => haystack.includes(term))) return hint.family;
  }
  return categoryName === 'waterside' ? 'wood' : 'generic';
}
