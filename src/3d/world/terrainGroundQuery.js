/**
 * Canonical terrain-ground query facade for world/environment callers.
 *
 * This module is intentionally DOM-free and dependency-light. It does not own terrain,
 * hydrology, roads, settlements, navigation or collider state; it only normalizes injected
 * authoritative samplers into a stable, fail-closed answer for placement consumers.
 *
 * @module world/terrainGroundQuery
 */

const finiteOr = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp01 = (value) => Math.min(1, Math.max(0, finiteOr(value)));

const sanitizePoint = (point = {}) => ({
  x: finiteOr(point?.x),
  z: finiteOr(point?.z),
});

const callSampler = (sampler, point, fallback) => {
  if (typeof sampler !== 'function') return fallback;
  try {
    const value = sampler(point);
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
};

const normalizeLabel = (value, fallback) => {
  const label = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return label || fallback;
};

/**
 * Query a canonical point without inventing terrain when an authority is absent.
 * Samplers are injected by the existing runtime owner (terrain.js/worldReferenceMap/etc.).
 */
export function queryTerrainGround(point, authorities = {}) {
  const safePoint = sanitizePoint(point);
  const seaLevel = finiteOr(authorities.seaLevel, 0);
  const rawHeight = callSampler(authorities.heightAt, safePoint, seaLevel);
  const waterConfidence = clamp01(callSampler(authorities.waterConfidenceAt, safePoint, rawHeight < seaLevel ? 1 : 0));
  const surfaceMask = normalizeLabel(authorities.surfaceMaskAt?.(safePoint), waterConfidence >= 0.5 ? 'water' : 'land');
  const biome = normalizeLabel(authorities.biomeAt?.(safePoint), 'unknown');
  const roadDistance = Math.max(0, callSampler(authorities.roadDistanceAt, safePoint, Infinity));
  const settlementDistance = Math.max(0, callSampler(authorities.settlementDistanceAt, safePoint, Infinity));
  const slope = clamp01(callSampler(authorities.slopeAt, safePoint, 0));
  const colliderHeight = callSampler(authorities.colliderHeightAt, safePoint, rawHeight);
  const groundedHeight = Number.isFinite(colliderHeight) ? colliderHeight : rawHeight;
  const isWater = surfaceMask === 'water' || waterConfidence >= 0.5;

  return {
    point: safePoint,
    height: groundedHeight,
    rawHeight,
    colliderHeight: groundedHeight,
    seaLevel,
    waterConfidence,
    isWater,
    surfaceMask,
    biome,
    slope,
    roadDistance,
    settlementDistance,
    valid: Number.isFinite(groundedHeight) && Number.isFinite(waterConfidence),
    source: 'injected-canonical-authorities',
  };
}

/**
 * Decide whether a world asset can be grounded at a point. This is a policy result only;
 * callers still route any accepted asset through MaterialAssignmentCore + WorldAssetPlacementPipeline.
 */
export function evaluateTerrainPlacement(point, context = {}, authorities = {}) {
  const sample = queryTerrainGround(point, authorities);
  const category = normalizeLabel(context.category, 'prop');
  const minRoadDistance = Math.max(0, finiteOr(context.minRoadDistance, 10));
  const minSettlementDistance = Math.max(0, finiteOr(context.minSettlementDistance, category === 'tree' ? 90 : 0));
  const maxSlope = clamp01(finiteOr(context.maxSlope, category === 'tree' ? 0.72 : 0.9));
  const waterAllowed = context.waterAllowed === true || category === 'bridge';
  const reasons = [];

  if (!sample.valid) reasons.push('invalid-ground-sample');
  if (sample.isWater && !waterAllowed) reasons.push('canonical-water');
  if (!sample.isWater && category === 'bridge') reasons.push('bridge-requires-water-or-crossing');
  if (sample.roadDistance < minRoadDistance) reasons.push('road-clearance');
  if (sample.settlementDistance < minSettlementDistance) reasons.push('settlement-clearance');
  if (sample.slope > maxSlope) reasons.push('slope-limit');

  return {
    ...sample,
    category,
    accepted: reasons.length === 0,
    reasons,
    groundTransform: {
      x: sample.point.x,
      y: sample.colliderHeight,
      z: sample.point.z,
    },
    contract: 'MaterialAssignmentCore+WorldAssetPlacementPipeline',
  };
}

/**
 * Compact deterministic evidence for cross-agent consumers and placement manifests.
 */
export function createTerrainGroundEvidence(result) {
  const safe = result && typeof result === 'object' ? result : {};
  return {
    accepted: safe.accepted === true,
    category: normalizeLabel(safe.category, 'prop'),
    x: finiteOr(safe.point?.x),
    y: finiteOr(safe.colliderHeight, safe.height),
    z: finiteOr(safe.point?.z),
    biome: normalizeLabel(safe.biome, 'unknown'),
    surfaceMask: normalizeLabel(safe.surfaceMask, 'unknown'),
    waterConfidence: clamp01(safe.waterConfidence),
    slope: clamp01(safe.slope),
    roadDistance: Number.isFinite(safe.roadDistance) ? safe.roadDistance : null,
    settlementDistance: Number.isFinite(safe.settlementDistance) ? safe.settlementDistance : null,
    reasons: Array.isArray(safe.reasons) ? safe.reasons.map((reason) => String(reason)) : [],
    source: 'terrain-ground-query-v1',
  };
}
