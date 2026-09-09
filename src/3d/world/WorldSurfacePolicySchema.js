/**
 * World-surface placement policy schema: field definitions, normalization and validation.
 *
 * Extracted from `WorldAssetPlacementPipeline.js` (Run 357) to bring that file under
 * GOVERNANCE.md's 600-line file cap (Altın Kural 7) — a pure lossless move, zero logic changes.
 * `validateWorldSurfacePolicy` and `normalizePlacementPolicy` remain part of the pipeline's public
 * API (re-exported from `WorldAssetPlacementPipeline.js`) since external callers (e.g.
 * `scripts/checkWorldSurfacePlacementPolicy.mjs`, `scripts/checkStructureSurfacePolicy.mjs`) import
 * them from that module path.
 */

const POLICY_NUMERIC_FIELDS = Object.freeze([
  ['minSlopeDegrees', false], ['maxSlopeDegrees', true],
  ['minWaterDepth', false], ['maxWaterDepth', true],
  ['minRoadDistance', false], ['maxRoadDistance', true],
  ['minSettlementDistance', false], ['maxSettlementDistance', true],
  ['minMoisture', false], ['maxMoisture', true],
]);
const POLICY_LIST_FIELDS = Object.freeze([
  'allowedBiomes', 'forbiddenBiomes', 'allowedWaterTypes', 'forbiddenWaterTypes',
]);
const POLICY_FIELDS = Object.freeze([
  ...POLICY_NUMERIC_FIELDS.map(([key]) => key),
  ...POLICY_LIST_FIELDS,
]);
const POLICY_RANGES = Object.freeze([
  ['minSlopeDegrees', 'maxSlopeDegrees', 'slope'],
  ['minWaterDepth', 'maxWaterDepth', 'water-depth'],
  ['minRoadDistance', 'maxRoadDistance', 'road-distance'],
  ['minSettlementDistance', 'maxSettlementDistance', 'settlement-distance'],
  ['minMoisture', 'maxMoisture', 'moisture'],
]);

export function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizedStringList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item).trim().toLowerCase()).filter(Boolean))].sort();
}

function policyErrorKey(key) {
  return key.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
}

export function optionalFinite(value, allowInfinity = false) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const number = Number(value);
  if (allowInfinity && number === Infinity) return Infinity;
  return Number.isFinite(number) ? number : null;
}

export function validateWorldSurfacePolicy(policy = {}) {
  const source = isPlainObject(policy) ? policy : null;
  const normalizedPolicy = normalizePlacementPolicy(source || {});
  if (!source) return { ok: false, errors: ['policy-invalid-object'], policy: normalizedPolicy };

  const errors = [];
  for (const key of Object.keys(source)) {
    if (!POLICY_FIELDS.includes(key)) errors.push(`policy-unknown-${policyErrorKey(key)}`);
  }
  for (const [key, allowInfinity] of POLICY_NUMERIC_FIELDS) {
    const value = source[key];
    if (value === null || value === undefined || value === '') continue;
    if (typeof value !== 'number' && typeof value !== 'string') {
      errors.push(`policy-invalid-${policyErrorKey(key)}`);
      continue;
    }
    const numeric = Number(value);
    if ((!Number.isFinite(numeric) && !(allowInfinity && numeric === Infinity)) || numeric < 0) {
      errors.push(`policy-invalid-${policyErrorKey(key)}`);
    }
  }
  for (const key of POLICY_LIST_FIELDS) {
    const value = source[key];
    if (value === null || value === undefined) continue;
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
      errors.push(`policy-invalid-${policyErrorKey(key)}`);
    }
  }
  if (normalizedPolicy.minMoisture !== null && normalizedPolicy.minMoisture > 1) errors.push('policy-invalid-min-moisture');
  if (normalizedPolicy.maxMoisture !== null && normalizedPolicy.maxMoisture > 1) errors.push('policy-invalid-max-moisture');
  for (const [minKey, maxKey, label] of POLICY_RANGES) {
    const min = normalizedPolicy[minKey];
    const max = normalizedPolicy[maxKey];
    if (min !== null && max !== null && min > max) errors.push(`policy-inverted-${label}-range`);
  }

  return { ok: errors.length === 0, errors: [...new Set(errors)], policy: normalizedPolicy };
}

export function normalizePlacementPolicy(policy = {}) {
  const source = isPlainObject(policy) ? policy : {};
  return {
    minSlopeDegrees: optionalFinite(source.minSlopeDegrees),
    maxSlopeDegrees: optionalFinite(source.maxSlopeDegrees, true),
    minWaterDepth: optionalFinite(source.minWaterDepth),
    maxWaterDepth: optionalFinite(source.maxWaterDepth, true),
    minRoadDistance: optionalFinite(source.minRoadDistance),
    maxRoadDistance: optionalFinite(source.maxRoadDistance, true),
    minSettlementDistance: optionalFinite(source.minSettlementDistance),
    maxSettlementDistance: optionalFinite(source.maxSettlementDistance, true),
    minMoisture: optionalFinite(source.minMoisture),
    maxMoisture: optionalFinite(source.maxMoisture, true),
    allowedBiomes: normalizedStringList(source.allowedBiomes),
    forbiddenBiomes: normalizedStringList(source.forbiddenBiomes),
    allowedWaterTypes: normalizedStringList(source.allowedWaterTypes),
    forbiddenWaterTypes: normalizedStringList(source.forbiddenWaterTypes),
  };
}
