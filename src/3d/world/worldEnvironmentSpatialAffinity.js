/**
 * Deterministic spatial affinity for already-classified environment assets.
 *
 * This module deliberately consumes caller-supplied canonical surface facts. It never samples the
 * map, moves settlements, changes biome ownership, or selects a concrete asset. Its job is to turn
 * slope/elevation/moisture/water-edge context into stable relative suitability weights so an asset
 * family can fade naturally between neighboring landscape conditions instead of appearing as a flat
 * random sprinkle.
 *
 * @module world/worldEnvironmentSpatialAffinity
 */

const FAMILY_RULES = Object.freeze({
  vegetation: { dry: 0.55, wet: 0.95, low: 0.75, high: 0.45, flat: 0.9, steep: 0.16 },
  tree: { dry: 0.5, wet: 0.82, low: 0.88, high: 0.38, flat: 0.92, steep: 0.05 },
  shrub: { dry: 0.58, wet: 0.92, low: 0.88, high: 0.48, flat: 0.84, steep: 0.2 },
  grass: { dry: 0.7, wet: 1.0, low: 0.98, high: 0.58, flat: 1.0, steep: 0.12 },
  rock: { dry: 0.82, wet: 0.5, low: 0.34, high: 0.95, flat: 0.22, steep: 1.0 },
  cliff: { dry: 0.78, wet: 0.42, low: 0.25, high: 1.0, flat: 0.1, steep: 1.0 },
  prop: { dry: 0.7, wet: 0.66, low: 0.72, high: 0.62, flat: 0.78, steep: 0.28 },
  settlement: { dry: 0.86, wet: 0.28, low: 1.0, high: 0.42, flat: 1.0, steep: 0.02 },
  bridge: { dry: 0.55, wet: 0.92, low: 1.0, high: 0.28, flat: 0.82, steep: 0.05 },
});

const SURFACE_BONUS = Object.freeze({
  grass: { vegetation: 1.15, tree: 1.08, shrub: 1.12, grass: 1.22 },
  soil: { vegetation: 0.74, tree: 0.72, shrub: 0.82, grass: 0.78, settlement: 1.08 },
  mud: { vegetation: 0.8, tree: 0.72, shrub: 0.9, grass: 0.86, bridge: 1.18 },
  rock: { rock: 1.3, cliff: 1.2, vegetation: 0.24, tree: 0.08, shrub: 0.16, grass: 0.18 },
  scree: { rock: 1.24, cliff: 1.18, vegetation: 0.14, tree: 0.04, shrub: 0.1, grass: 0.12 },
  snow: { rock: 0.62, cliff: 0.72, vegetation: 0.18, tree: 0.22, shrub: 0.12, grass: 0.16 },
  wet: { vegetation: 0.82, grass: 0.92, shrub: 0.84, bridge: 1.08, settlement: 0.5, rock: 0.72 },
});

const TRANSITION_RULES = Object.freeze([
  ['grass', 'soil', 0.3],
  ['grass', 'mud', 0.4],
  ['soil', 'rock', 0.45],
  ['soil', 'scree', 0.5],
  ['rock', 'scree', 0.35],
  ['rock', 'snow', 0.58],
  ['scree', 'snow', 0.42],
  ['wet', 'grass', 0.52],
  ['wet', 'mud', 0.48],
]);

function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) return value >= edge1 ? 1 : 0;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function normalizeFamily(family) {
  const key = String(family ?? '').trim().toLowerCase();
  if (FAMILY_RULES[key]) return key;
  if (key.includes('tree')) return 'tree';
  if (key.includes('shrub')) return 'shrub';
  if (key.includes('grass')) return 'grass';
  if (key.includes('rock') || key.includes('boulder')) return 'rock';
  if (key.includes('cliff') || key.includes('talus')) return 'cliff';
  if (key.includes('settlement') || key.includes('castle') || key.includes('house')) return 'settlement';
  if (key.includes('bridge')) return 'bridge';
  return 'prop';
}

function slopeFactor(slopeDegrees, rule) {
  const slope = Math.max(0, Math.min(90, Number(slopeDegrees) || 0));
  const flat = smoothstep(0, 28, slope);
  const steep = smoothstep(18, 62, slope);
  return clamp01(rule.flat * (1 - flat) + rule.steep * steep);
}

function elevationFactor(elevationMeters, rule) {
  const elevation = Math.max(-100, Number(elevationMeters) || 0);
  const low = 1 - smoothstep(250, 900, elevation);
  const high = smoothstep(650, 1500, elevation);
  return clamp01(rule.low * low + rule.high * high);
}

function moistureFactor(moisture, rule) {
  const wet = clamp01(moisture);
  return clamp01(rule.dry * (1 - wet) + rule.wet * wet);
}

function waterEdgeFactor(waterDistanceMeters) {
  const distance = Math.max(0, Number(waterDistanceMeters) || 999999);
  return 1 - smoothstep(0, 90, distance);
}

export function surfaceTransitionAffinity(surfaceClass, neighboringSurfaceClass, transitionStrength = 0.5) {
  const a = String(surfaceClass ?? '').toLowerCase();
  const b = String(neighboringSurfaceClass ?? '').toLowerCase();
  const strength = clamp01(transitionStrength);
  if (!a || !b || a === b) return 0;
  for (const [left, right, bonus] of TRANSITION_RULES) {
    if ((a === left && b === right) || (a === right && b === left)) return bonus * strength;
  }
  return 0;
}

export function computeSpatialAffinity({
  family = 'prop',
  surfaceClass = 'soil',
  neighboringSurfaceClass = null,
  slopeDegrees = 0,
  elevationMeters = 0,
  moisture = 0.5,
  waterDistanceMeters = 999999,
  edgeTransitionStrength = 0,
  biomeMultiplier = 1,
  settlementDistanceMeters = 999999,
  roadDistanceMeters = 999999,
} = {}) {
  const normalizedFamily = normalizeFamily(family);
  const rule = FAMILY_RULES[normalizedFamily];
  const surface = String(surfaceClass ?? '').toLowerCase();
  const baseSurfaceBonus = SURFACE_BONUS[surface]?.[normalizedFamily] ?? 1;
  const slope = slopeFactor(slopeDegrees, rule);
  const elevation = elevationFactor(elevationMeters, rule);
  const wetness = moistureFactor(moisture, rule);
  const edge = waterEdgeFactor(waterDistanceMeters);
  const transition = surfaceTransitionAffinity(surface, neighboringSurfaceClass, edgeTransitionStrength);
  const settlementDistance = Math.max(0, Number(settlementDistanceMeters) || 999999);
  const roadDistance = Math.max(0, Number(roadDistanceMeters) || 999999);
  const settlementBuffer = normalizedFamily === 'settlement' ? 1 : smoothstep(45, 180, settlementDistance);
  const roadBuffer = normalizedFamily === 'settlement' || normalizedFamily === 'bridge' ? 1 : smoothstep(8, 28, roadDistance);
  const raw = baseSurfaceBonus * (0.38 + 0.24 * slope + 0.2 * elevation + 0.18 * wetness)
    * (0.82 + transition)
    * clamp01(biomeMultiplier)
    * settlementBuffer
    * roadBuffer;
  return Object.freeze({
    family: normalizedFamily,
    surfaceClass: surface,
    score: Math.max(0, Math.min(1.5, raw)),
    components: Object.freeze({ surface: baseSurfaceBonus, slope, elevation, moisture: wetness, waterEdge: edge, transition, settlementBuffer, roadBuffer }),
  });
}

export function familySpatialDensityMultiplier(context = {}) {
  const affinity = computeSpatialAffinity(context);
  return Object.freeze({
    multiplier: Math.max(0.05, Math.min(1.5, affinity.score)),
    score: affinity.score,
    components: affinity.components,
  });
}

export function rankSpatialCandidate(a, b) {
  const left = Number(a?.score) || 0;
  const right = Number(b?.score) || 0;
  if (right !== left) return right - left;
  const leftKey = String(a?.stableKey ?? '');
  const rightKey = String(b?.stableKey ?? '');
  return leftKey.localeCompare(rightKey);
}

export function createSpatialCandidate({ stableKey, ...context } = {}) {
  const affinity = computeSpatialAffinity(context);
  return Object.freeze({
    stableKey: String(stableKey ?? ''),
    family: affinity.family,
    surfaceClass: affinity.surfaceClass,
    score: affinity.score,
    components: affinity.components,
  });
}

export function selectSpatialCandidates(candidates = [], maxCount = Infinity) {
  const sorted = [...candidates].map((candidate) => createSpatialCandidate(candidate)).sort(rankSpatialCandidate);
  const limit = Number.isFinite(maxCount) ? Math.max(0, Math.trunc(maxCount)) : sorted.length;
  return Object.freeze(sorted.slice(0, limit));
}

export function validateSpatialAffinity(value) {
  const reasons = [];
  if (!value || typeof value !== 'object') reasons.push('missing-affinity');
  if (!Number.isFinite(value?.score) || value.score < 0 || value.score > 1.5) reasons.push('score-range');
  if (!value?.family) reasons.push('family');
  if (!value?.surfaceClass) reasons.push('surface-class');
  return Object.freeze({ valid: reasons.length === 0, reasons });
}
