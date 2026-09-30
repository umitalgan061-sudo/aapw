/**
 * Strict runtime feature-flag registry.
 *
 * Flags are non-sensitive rollout switches only. Definitions, overrides and snapshots are typed,
 * validated and immutable at the public boundary.
 */
import { booleanOr, finiteOr } from './modernRuntimeContract.ts';

export const FEATURE_FLAG_TYPES = ['boolean', 'number', 'string', 'enum'] as const;
export type FeatureFlagType = (typeof FEATURE_FLAG_TYPES)[number];
export type FeatureFlagValue = boolean | number | string;
export interface FeatureFlagDefinition {
  readonly name: string;
  readonly type: FeatureFlagType;
  readonly default: FeatureFlagValue;
  readonly min: number | null;
  readonly max: number | null;
  readonly allowed: readonly string[] | null;
  readonly description: string;
  readonly tags: readonly string[];
}
export interface FeatureFlagInput {
  readonly type?: unknown;
  readonly default?: unknown;
  readonly min?: unknown;
  readonly max?: unknown;
  readonly allowed?: readonly unknown[];
  readonly description?: unknown;
  readonly tags?: readonly unknown[];
}
export interface FeatureFlagValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
}
export interface FeatureFlagState {
  readonly exists: boolean;
  readonly name: string;
  readonly value: FeatureFlagValue | undefined;
  readonly default?: FeatureFlagValue;
  readonly overridden?: boolean;
  readonly source?: string;
  readonly type?: FeatureFlagType;
}
export interface FeatureFlagOverride {
  readonly value: FeatureFlagValue;
  readonly source: string;
}
export type AudiencePredicate = (context: Readonly<Record<string, unknown>>) => boolean;
export interface FeatureFlagSnapshot {
  readonly revision: number;
  readonly flags: Readonly<Record<string, FeatureFlagValue | undefined>>;
  readonly definitions: Readonly<Record<string, FeatureFlagDefinition>>;
  readonly overrides: Readonly<Record<string, FeatureFlagOverride>>;
}
export interface FeatureFlagValidationSummary {
  readonly valid: boolean;
  readonly problems: readonly Readonly<{ name: string; errors: readonly string[] }>[];
}
export interface RuntimeFeatureFlagRegistry {
  define(name: string, definition: FeatureFlagInput): FeatureFlagDefinition;
  defineMany(definitions: Readonly<Record<string, FeatureFlagInput>>): FeatureFlagSnapshot;
  setOverride(name: string, value: FeatureFlagValue, source?: string): FeatureFlagState;
  clearOverride(name: string): void;
  setAudience(name: string, predicate: AudiencePredicate): void;
  resolve(name: string, context?: Readonly<Record<string, unknown>>): FeatureFlagValue | undefined;
  get(name: string, context?: Readonly<Record<string, unknown>>): FeatureFlagState;
  isEnabled(name: string, context?: Readonly<Record<string, unknown>>): boolean;
  snapshot(context?: Readonly<Record<string, unknown>>): FeatureFlagSnapshot;
  validateAll(context?: Readonly<Record<string, unknown>>): FeatureFlagValidationSummary;
  reset(): void;
  readonly revision: number;
}

function normalizeDefinition(name: string, definition: FeatureFlagInput = {}): FeatureFlagDefinition {
  const type: FeatureFlagType = FEATURE_FLAG_TYPES.includes(definition.type as FeatureFlagType)
    ? definition.type as FeatureFlagType
    : 'boolean';
  const allowed = Array.isArray(definition.allowed)
    ? Object.freeze(definition.allowed.map(String))
    : null;
  let defaultValue: FeatureFlagValue = definition.default as FeatureFlagValue;
  if (type === 'boolean') defaultValue = booleanOr(defaultValue, false);
  if (type === 'number') defaultValue = finiteOr(defaultValue, 0);
  if (type === 'string') defaultValue = String(defaultValue ?? '');
  if (type === 'enum') defaultValue = allowed?.includes(String(defaultValue)) ? String(defaultValue) : String(allowed?.[0] ?? '');

  return Object.freeze({
    name,
    type,
    default: defaultValue,
    min: type === 'number' ? finiteOr(definition.min, Number.NEGATIVE_INFINITY) : null,
    max: type === 'number' ? finiteOr(definition.max, Number.POSITIVE_INFINITY) : null,
    allowed,
    description: String(definition.description || ''),
    tags: Object.freeze(Array.isArray(definition.tags) ? definition.tags.slice(0, 12).map(String) : []),
  });
}

function validate(definition: FeatureFlagDefinition, value: FeatureFlagValue): FeatureFlagValidation {
  const errors: string[] = [];
  if (definition.type === 'boolean' && typeof value !== 'boolean') errors.push('expected boolean');
  if (
    definition.type === 'number'
    && (!Number.isFinite(Number(value))
      || Number(value) < Number(definition.min)
      || Number(value) > Number(definition.max))
  ) errors.push('number out of range');
  if (definition.type === 'string' && typeof value !== 'string') errors.push('expected string');
  if (definition.type === 'enum' && !definition.allowed?.includes(String(value))) errors.push('value not in enum');
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function createRuntimeFeatureFlagRegistry(): RuntimeFeatureFlagRegistry {
  const definitions = new Map<string, FeatureFlagDefinition>();
  const overrides = new Map<string, FeatureFlagOverride>();
  const audiences = new Map<string, AudiencePredicate>();
  let revision = 0;

  function define(name: string, definition: FeatureFlagInput): FeatureFlagDefinition {
    const key = String(name || '').trim();
    if (!key) throw new TypeError('Feature flag name is required.');
    const normalized = normalizeDefinition(key, definition);
    definitions.set(key, normalized);
    revision += 1;
    return normalized;
  }

  function defineMany(definitionsInput: Readonly<Record<string, FeatureFlagInput>>): FeatureFlagSnapshot {
    for (const [name, definition] of Object.entries(definitionsInput)) define(name, definition);
    return snapshot();
  }

  function setOverride(name: string, value: FeatureFlagValue, source = 'runtime'): FeatureFlagState {
    const definition = definitions.get(String(name));
    if (!definition) throw new Error(`Unknown feature flag: ${name}`);
    const check = validate(definition, value);
    if (!check.valid) throw new TypeError(`${name}: ${check.errors.join(', ')}`);
    overrides.set(definition.name, Object.freeze({ value, source: String(source || 'runtime') }));
    revision += 1;
    return get(definition.name);
  }

  function clearOverride(name: string): void {
    if (overrides.delete(String(name))) revision += 1;
  }

  function setAudience(name: string, predicate: AudiencePredicate): void {
    if (typeof predicate !== 'function') throw new TypeError('Audience predicate must be a function.');
    audiences.set(String(name), predicate);
    revision += 1;
  }

  function resolve(name: string, context: Readonly<Record<string, unknown>> = {}): FeatureFlagValue | undefined {
    const definition = definitions.get(String(name));
    if (!definition) return undefined;
    const override = overrides.get(definition.name);
    if (override) return override.value;
    const audience = audiences.get(definition.name);
    if (!audience) return definition.default;
    try {
      return audience(context) ? definition.default : false;
    } catch {
      return false;
    }
  }

  function get(name: string, context: Readonly<Record<string, unknown>> = {}): FeatureFlagState {
    const definition = definitions.get(String(name));
    if (!definition) return Object.freeze({ exists: false, name: String(name), value: undefined });
    const override = overrides.get(definition.name);
    return Object.freeze({
      exists: true,
      name: definition.name,
      value: resolve(definition.name, context),
      default: definition.default,
      overridden: Boolean(override),
      source: override?.source || 'default',
      type: definition.type,
    });
  }

  function isEnabled(name: string, context: Readonly<Record<string, unknown>> = {}): boolean {
    return resolve(name, context) === true;
  }

  function snapshot(context: Readonly<Record<string, unknown>> = {}): FeatureFlagSnapshot {
    const flags: Record<string, FeatureFlagValue | undefined> = {};
    for (const name of definitions.keys()) flags[name] = resolve(name, context);
    const definitionsObject = Object.fromEntries(definitions.entries()) as Record<string, FeatureFlagDefinition>;
    const overridesObject = Object.fromEntries(overrides.entries()) as Record<string, FeatureFlagOverride>;
    return Object.freeze({
      revision,
      flags: Object.freeze(flags),
      definitions: Object.freeze(definitionsObject),
      overrides: Object.freeze(overridesObject),
    });
  }

  function validateAll(context: Readonly<Record<string, unknown>> = {}): FeatureFlagValidationSummary {
    const problems: Readonly<{ name: string; errors: readonly string[] }>[] = [];
    for (const name of definitions.keys()) {
      const definition = definitions.get(name);
      if (!definition) continue;
      const state = get(name, context);
      const value = state.value ?? definition.default;
      const check = validate(definition, value);
      if (!check.valid) problems.push(Object.freeze({ name, errors: check.errors }));
    }
    return Object.freeze({ valid: problems.length === 0, problems: Object.freeze(problems) });
  }

  function reset(): void {
    overrides.clear();
    audiences.clear();
    revision += 1;
  }

  return Object.freeze({
    define,
    defineMany,
    setOverride,
    clearOverride,
    setAudience,
    resolve,
    get,
    isEnabled,
    snapshot,
    validateAll,
    reset,
    get revision(): number { return revision; },
  });
}

export function createDefaultRuntimeFlags(): Readonly<Record<string, FeatureFlagDefinition>> {
  const definitions: Record<string, FeatureFlagDefinition> = {};
  const raw: Readonly<Record<string, FeatureFlagInput>> = {
    'runtime.fixed-step': { type: 'boolean', default: true, description: 'Use deterministic fixed-step scheduling.', tags: ['simulation'] },
    'runtime.adaptive-quality': { type: 'boolean', default: true, description: 'Enable automatic quality adaptation.', tags: ['performance'] },
    'runtime.telemetry': { type: 'boolean', default: true, description: 'Record bounded local runtime telemetry.', tags: ['observability'] },
    'runtime.asset-residency': { type: 'boolean', default: true, description: 'Use bounded residency accounting for heavy assets.', tags: ['memory'] },
    'runtime.save-ledger': { type: 'boolean', default: true, description: 'Use versioned save slots.', tags: ['persistence'] },
    'runtime.input-buffer': { type: 'boolean', default: true, description: 'Use deterministic semantic input buffering.', tags: ['input'] },
    'runtime.reduced-motion': { type: 'boolean', default: true, description: 'Honor reduced-motion presentation policy.', tags: ['accessibility'] },
    'renderer.webgpu-experiment': { type: 'boolean', default: false, description: 'Allow an explicit WebGPU experiment at the composition boundary.', tags: ['renderer', 'experimental'] },
    'renderer.dynamic-resolution': { type: 'boolean', default: true, description: 'Allow dynamic pixel ratio recommendations.', tags: ['renderer'] },
    'world.background-streaming': { type: 'boolean', default: true, description: 'Allow caller-owned zone streaming to use runtime pressure signals.', tags: ['world'] },
    'world.low-power-shed': { type: 'boolean', default: true, description: 'Shed presentation density on constrained devices.', tags: ['world', 'performance'] },
    'debug.diagnostics-overlay': { type: 'boolean', default: false, description: 'Expose diagnostics for development builds.', tags: ['debug'] },
    'debug.strict-contracts': { type: 'boolean', default: true, description: 'Enable strict validation in acceptance tools.', tags: ['debug', 'quality'] },
  };
  for (const [name, definition] of Object.entries(raw)) definitions[name] = normalizeDefinition(name, definition);
  return Object.freeze(definitions);
}
