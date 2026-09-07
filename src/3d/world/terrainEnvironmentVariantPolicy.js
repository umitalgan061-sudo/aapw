/**
 * Deterministic habitat-to-asset-variant policy.
 *
 * This layer selects among already-authored model families. It never creates geometry and never
 * changes canonical terrain, water, road, settlement or collider authority. The purpose is to stop
 * one authored model from becoming a visual stencil over an entire biome.
 */

const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const freeze = Object.freeze;

export const TERRAIN_ENVIRONMENT_VARIANT_POLICY = freeze({
  id: 'terrain-environment-habitat-variant-policy-2026-09-07-v1',
  deterministic: true,
  canonicalGeographyUntouched: true,
  maxRepeatRadiusMeters: 140,
  habitatBands: freeze(['temperate', 'wet-lowland', 'dry-heath', 'montane', 'alpine', 'subarctic', 'barren-volcanic']),
  familyRules: freeze({
    tree: freeze({ minDistinctVariants: 2, maxSameVariantFraction: 0.70 }),
    shrub: freeze({ minDistinctVariants: 2, maxSameVariantFraction: 0.72 }),
    deadTree: freeze({ minDistinctVariants: 2, maxSameVariantFraction: 0.64 }),
    snowTree: freeze({ minDistinctVariants: 2, maxSameVariantFraction: 0.68 }),
    rock: freeze({ minDistinctVariants: 2, maxSameVariantFraction: 0.66 }),
    prop: freeze({ minDistinctVariants: 2, maxSameVariantFraction: 0.74 }),
  }),
});

function normalizeHabitat(context = {}) {
  const biome = String(context.biome || '').toLowerCase();
  const moisture = clamp01(context.moisture);
  const snow = clamp01(context.snowWeight);
  const rock = clamp01(context.rockWeight);
  const elevation = Math.max(0, finite(context.heightAboveSeaMeters));
  const slope = clamp(finite(context.slopeDegrees), 0, 90);
  if (biome.includes('volcan') || biome.includes('ash') || context.barren === true) return 'barren-volcanic';
  if (snow > 0.68 || elevation > 520) return 'alpine';
  if (snow > 0.30 || elevation > 300) return 'subarctic';
  if (slope > 42 || rock > 0.68 || elevation > 220) return 'montane';
  if (moisture > 0.72 || biome.includes('marsh') || biome.includes('wet')) return 'wet-lowland';
  if (moisture < 0.34 || biome.includes('heath') || biome.includes('dry')) return 'dry-heath';
  return 'temperate';
}

function hash32(value) {
  let x = value | 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x | 0;
}

function hashString(value) {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) h = Math.imul(h ^ value.charCodeAt(i), 0x01000193);
  return hash32(h);
}

export function habitatVariantSeed({ assetFamily = 'tree', worldX = 0, worldZ = 0, ordinal = 0, seed = 0 } = {}) {
  const gx = Math.floor(finite(worldX) / TERRAIN_ENVIRONMENT_VARIANT_POLICY.maxRepeatRadiusMeters);
  const gz = Math.floor(finite(worldZ) / TERRAIN_ENVIRONMENT_VARIANT_POLICY.maxRepeatRadiusMeters);
  return (hash32(hashString(String(assetFamily))) ^ hash32(gx * 73856093) ^ hash32(gz * 19349663) ^ hash32(finite(seed)) ^ hash32(finite(ordinal))) >>> 0;
}

export function habitatVariantIndex(variantCount, options = {}) {
  const count = Math.max(1, Math.floor(finite(variantCount, 1)));
  return habitatVariantSeed(options) % count;
}

export function habitatVariantOrder(variantCount, options = {}) {
  const count = Math.max(1, Math.floor(finite(variantCount, 1)));
  const first = habitatVariantIndex(count, options);
  if (count === 1) return [0];
  const order = [first];
  const step = 1 + (habitatVariantSeed({ ...options, ordinal: finite(options.ordinal) + 17 }) % (count - 1));
  let current = first;
  for (let i = 1; i < count; i += 1) {
    current = (current + step) % count;
    if (!order.includes(current)) order.push(current);
  }
  return order;
}

export function variantEligibility(assetFamily, context = {}) {
  const family = String(assetFamily || '').toLowerCase();
  const habitat = normalizeHabitat(context);
  const moisture = clamp01(context.moisture);
  const snow = clamp01(context.snowWeight);
  const rock = clamp01(context.rockWeight);
  const slope = clamp(finite(context.slopeDegrees), 0, 90);
  const forbidden = [];
  if (family === 'tree' && (habitat === 'alpine' || habitat === 'barren-volcanic')) forbidden.push('temperate-tree');
  if (family === 'snowtree' && snow < 0.25) forbidden.push('snow-tree');
  if (family === 'deadtree' && moisture > 0.82 && habitat === 'wet-lowland') forbidden.push('dead-dry-tree');
  if (family === 'rock' && slope < 12 && rock < 0.35) forbidden.push('high-slope-rock');
  if (family === 'scree' && slope < 24) forbidden.push('scree');
  if (family === 'shrub' && (slope > 46 || habitat === 'barren-volcanic')) forbidden.push('shrub');
  return freeze({ family, habitat, eligible: forbidden.length === 0, forbidden });
}

export function selectHabitatVariant(candidates = [], context = {}) {
  const normalized = candidates.filter(Boolean).map((candidate, index) => {
    const id = typeof candidate === 'string' ? candidate : candidate.id;
    const family = typeof candidate === 'string' ? 'asset' : candidate.family || 'asset';
    const eligibility = variantEligibility(family, context);
    return { id, family, index, eligibility };
  }).filter((candidate) => candidate.eligibility.eligible);
  if (normalized.length === 0) return null;
  const ordinal = finite(context.ordinal, 0);
  const seed = finite(context.seed, 0);
  const selected = normalized[habitatVariantIndex(normalized.length, {
    assetFamily: context.assetFamily || normalized[0].family,
    worldX: context.worldX,
    worldZ: context.worldZ,
    ordinal,
    seed,
  })];
  return freeze({
    id: selected.id,
    family: selected.family,
    habitat: normalizeHabitat(context),
    sourceIndex: selected.index,
    eligibleCount: normalized.length,
    candidateCount: candidates.length,
    selectionSeed: habitatVariantSeed({ assetFamily: selected.family, worldX: context.worldX, worldZ: context.worldZ, ordinal, seed }),
  });
}

export function enforceVariantDiversity(selectedIds = [], family = 'tree') {
  const values = selectedIds.filter(Boolean).map(String);
  const total = values.length;
  if (total === 0) return freeze({ ok: true, family, total: 0, distinct: 0, dominantFraction: 0 });
  const counts = new Map();
  for (const id of values) counts.set(id, (counts.get(id) || 0) + 1);
  let dominant = 0;
  for (const value of counts.values()) dominant = Math.max(dominant, value);
  const rule = TERRAIN_ENVIRONMENT_VARIANT_POLICY.familyRules[family] || TERRAIN_ENVIRONMENT_VARIANT_POLICY.familyRules.tree;
  const dominantFraction = dominant / total;
  return freeze({
    ok: counts.size >= Math.min(rule.minDistinctVariants, total) && dominantFraction <= rule.maxSameVariantFraction,
    family,
    total,
    distinct: counts.size,
    dominantFraction,
    maxSameVariantFraction: rule.maxSameVariantFraction,
  });
}

export function buildVariantPlacementManifest({ assetFamily = 'tree', candidates = [], selectedIds = [], context = {} } = {}) {
  const variantRules = variantEligibility(assetFamily, context);
  const diversity = enforceVariantDiversity(selectedIds, assetFamily);
  return freeze({
    policyId: TERRAIN_ENVIRONMENT_VARIANT_POLICY.id,
    assetFamily,
    habitat: normalizeHabitat(context),
    canonicalGeographyUntouched: true,
    selection: selectHabitatVariant(candidates, { ...context, assetFamily }),
    diversity,
    constraints: {
      waterDepth: finite(context.waterDepth, 0),
      slopeDegrees: clamp(finite(context.slopeDegrees), 0, 90),
      moisture: clamp01(context.moisture),
      snowWeight: clamp01(context.snowWeight),
      rockWeight: clamp01(context.rockWeight),
      eligible: variantRules.eligible,
    },
  });
}
