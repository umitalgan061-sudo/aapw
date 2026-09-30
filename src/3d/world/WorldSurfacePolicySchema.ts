/** Production TypeScript owner for src/3d/world/WorldSurfacePolicySchema.js. */
/** Strict policy schema: normalization and validation for world-surface placement constraints. */

type NumericPolicyKey =
  | 'minSlopeDegrees' | 'maxSlopeDegrees'
  | 'minWaterDepth' | 'maxWaterDepth'
  | 'minRoadDistance' | 'maxRoadDistance'
  | 'minSettlementDistance' | 'maxSettlementDistance'
  | 'minMoisture' | 'maxMoisture';

type PolicyListKey = 'allowedBiomes' | 'forbiddenBiomes' | 'allowedWaterTypes' | 'forbiddenWaterTypes';
export type WorldSurfacePolicyField = NumericPolicyKey | PolicyListKey;
export type WorldSurfacePolicyInput = Partial<Record<WorldSurfacePolicyField, unknown>> & Record<string, unknown>;

export interface NormalizedWorldSurfacePolicy {
  readonly minSlopeDegrees: number | null;
  readonly maxSlopeDegrees: number | null;
  readonly minWaterDepth: number | null;
  readonly maxWaterDepth: number | null;
  readonly minRoadDistance: number | null;
  readonly maxRoadDistance: number | null;
  readonly minSettlementDistance: number | null;
  readonly maxSettlementDistance: number | null;
  readonly minMoisture: number | null;
  readonly maxMoisture: number | null;
  readonly allowedBiomes: readonly string[];
  readonly forbiddenBiomes: readonly string[];
  readonly allowedWaterTypes: readonly string[];
  readonly forbiddenWaterTypes: readonly string[];
}

export interface WorldSurfacePolicyValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
  readonly policy: NormalizedWorldSurfacePolicy;
}

const POLICY_NUMERIC_FIELDS = Object.freeze([
  ['minSlopeDegrees', false], ['maxSlopeDegrees', true],
  ['minWaterDepth', false], ['maxWaterDepth', true],
  ['minRoadDistance', false], ['maxRoadDistance', true],
  ['minSettlementDistance', false], ['maxSettlementDistance', true],
  ['minMoisture', false], ['maxMoisture', true],
] as const);
const POLICY_LIST_FIELDS = Object.freeze([
  'allowedBiomes', 'forbiddenBiomes', 'allowedWaterTypes', 'forbiddenWaterTypes',
] as const satisfies readonly PolicyListKey[]);
const POLICY_FIELDS = Object.freeze([
  ...POLICY_NUMERIC_FIELDS.map(([key]) => key),
  ...POLICY_LIST_FIELDS,
] as const);
const POLICY_RANGES = Object.freeze([
  ['minSlopeDegrees', 'maxSlopeDegrees', 'slope'],
  ['minWaterDepth', 'maxWaterDepth', 'water-depth'],
  ['minRoadDistance', 'maxRoadDistance', 'road-distance'],
  ['minSettlementDistance', 'maxSettlementDistance', 'settlement-distance'],
  ['minMoisture', 'maxMoisture', 'moisture'],
] as const);

export function isPlainObject(value: unknown): value is WorldSurfacePolicyInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizedStringList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return Object.freeze([...new Set(value.map((item) => String(item).trim().toLowerCase()).filter(Boolean))].sort());
}

function policyErrorKey(key: string): string {
  return key.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
}

export function optionalFinite(value: unknown, allowInfinity = false): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const number = Number(value);
  if (allowInfinity && number === Infinity) return Infinity;
  return Number.isFinite(number) ? number : null;
}

export function normalizePlacementPolicy(policy: unknown = {}): NormalizedWorldSurfacePolicy {
  const source = isPlainObject(policy) ? policy : {};
  return Object.freeze({
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
  });
}

export function validateWorldSurfacePolicy(policy: unknown = {}): WorldSurfacePolicyValidationResult {
  const source = isPlainObject(policy) ? policy : null;
  const normalizedPolicy = normalizePlacementPolicy(source || {});
  if (!source) return Object.freeze({ ok: false, errors: Object.freeze(['policy-invalid-object']), policy: normalizedPolicy });

  const errors: string[] = [];
  for (const key of Object.keys(source)) {
    if (!(POLICY_FIELDS as readonly string[]).includes(key)) errors.push(`policy-unknown-${policyErrorKey(key)}`);
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

  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze([...new Set(errors)]), policy: normalizedPolicy });
}
