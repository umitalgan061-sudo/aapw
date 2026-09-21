// @ts-nocheck
/**
 * Runtime feature-flag registry.
 *
 * Centralizes non-sensitive rollout switches with typed defaults, capability predicates, deterministic
 * overrides and immutable snapshots. Flags are not user authorization and must not gate security.
 */

import { booleanOr, clamp, finiteOr, integerOr } from './modernRuntimeContract.js';

const TYPES = Object.freeze(['boolean', 'number', 'string', 'enum']);

function normalizeDefinition(name, definition = {}) {
  const type = TYPES.includes(definition.type) ? definition.type : 'boolean';
  const allowed = Array.isArray(definition.allowed) ? definition.allowed.map(String) : null;
  let defaultValue = definition.default;
  if (type === 'boolean') defaultValue = booleanOr(defaultValue, false);
  if (type === 'number') defaultValue = finiteOr(defaultValue, 0);
  if (type === 'string') defaultValue = String(defaultValue ?? '');
  if (type === 'enum') {
    defaultValue = allowed?.includes(String(defaultValue)) ? String(defaultValue) : String(allowed?.[0] || '');
  }
  return Object.freeze({
    name,
    type,
    default: defaultValue,
    min: type === 'number' ? finiteOr(definition.min, -Infinity) : null,
    max: type === 'number' ? finiteOr(definition.max, Infinity) : null,
    allowed,
    description: String(definition.description || ''),
    tags: Array.isArray(definition.tags) ? definition.tags.slice(0, 12).map(String) : [],
  });
}

function validate(definition, value) {
  const errors = [];
  if (definition.type === 'boolean' && typeof value !== 'boolean') errors.push('expected boolean');
  if (definition.type === 'number' && (!Number.isFinite(Number(value)) || Number(value) < definition.min || Number(value) > definition.max)) errors.push('number out of range');
  if (definition.type === 'string' && typeof value !== 'string') errors.push('expected string');
  if (definition.type === 'enum' && !definition.allowed?.includes(String(value))) errors.push('value not in enum');
  return Object.freeze({ valid: errors.length === 0, errors });
}

export function createRuntimeFeatureFlagRegistry(options = {}) {
  const definitions = new Map();
  const overrides = new Map();
  const audiences = new Map();
  let revision = 0;

  function define(name, definition) {
    const key = String(name || '').trim();
    if (!key) throw new TypeError('Feature flag name is required.');
    definitions.set(key, normalizeDefinition(key, definition));
    revision += 1;
    return definitions.get(key);
  }

  function defineMany(definitionsInput = {}) {
    for (const [name, definition] of Object.entries(definitionsInput)) define(name, definition);
    return snapshot();
  }

  function setOverride(name, value, source = 'runtime') {
    const definition = definitions.get(String(name));
    if (!definition) throw new Error(`Unknown feature flag: ${name}`);
    const check = validate(definition, value);
    if (!check.valid) throw new TypeError(`${name}: ${check.errors.join(', ')}`);
    overrides.set(definition.name, { value, source: String(source || 'runtime') });
    revision += 1;
    return get(definition.name);
  }

  function clearOverride(name) {
    overrides.delete(String(name));
    revision += 1;
  }

  function setAudience(name, predicate) {
    if (typeof predicate !== 'function') throw new TypeError('Audience predicate must be a function.');
    audiences.set(String(name), predicate);
    revision += 1;
  }

  function resolve(name, context = {}) {
    const key = String(name);
    const definition = definitions.get(key);
    if (!definition) return undefined;
    const override = overrides.get(key);
    if (override) return override.value;
    const audience = audiences.get(key);
    if (audience) {
      try {
        return audience(context) ? definition.default : false;
      } catch {
        return false;
      }
    }
    return definition.default;
  }

  function get(name, context = {}) {
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

  function isEnabled(name, context = {}) {
    return resolve(name, context) === true;
  }

  function snapshot(context = {}) {
    const flags = {};
    for (const name of definitions.keys()) flags[name] = resolve(name, context);
    return Object.freeze({ revision, flags: Object.freeze(flags), definitions: Object.freeze(Object.fromEntries([...definitions.entries()])), overrides: Object.freeze(Object.fromEntries(overrides.entries())) });
  }

  function validateAll(context = {}) {
    const problems = [];
    for (const name of definitions.keys()) {
      const state = get(name, context);
      const definition = definitions.get(name);
      const check = validate(definition, state.value);
      if (!check.valid) problems.push({ name, errors: check.errors });
    }
    return Object.freeze({ valid: problems.length === 0, problems: Object.freeze(problems) });
  }

  function reset() {
    overrides.clear();
    audiences.clear();
    revision += 1;
  }

  return Object.freeze({ define, defineMany, setOverride, clearOverride, setAudience, resolve, get, isEnabled, snapshot, validateAll, reset, get revision() { return revision; } });
}

export function createDefaultRuntimeFlags() {
  return Object.freeze({
    'runtime.fixed-step': Object.freeze({ type: 'boolean', default: true, description: 'Use deterministic fixed-step scheduling.', tags: ['simulation'] }),
    'runtime.adaptive-quality': Object.freeze({ type: 'boolean', default: true, description: 'Enable automatic quality adaptation.', tags: ['performance'] }),
    'runtime.telemetry': Object.freeze({ type: 'boolean', default: true, description: 'Record bounded local runtime telemetry.', tags: ['observability'] }),
    'runtime.asset-residency': Object.freeze({ type: 'boolean', default: true, description: 'Use bounded residency accounting for heavy assets.', tags: ['memory'] }),
    'runtime.save-ledger': Object.freeze({ type: 'boolean', default: true, description: 'Use versioned save slots.', tags: ['persistence'] }),
    'runtime.input-buffer': Object.freeze({ type: 'boolean', default: true, description: 'Use deterministic semantic input buffering.', tags: ['input'] }),
    'runtime.reduced-motion': Object.freeze({ type: 'boolean', default: true, description: 'Honor reduced-motion presentation policy.', tags: ['accessibility'] }),
    'renderer.webgpu-experiment': Object.freeze({ type: 'boolean', default: false, description: 'Allow an explicit WebGPU experiment at the composition boundary.', tags: ['renderer', 'experimental'] }),
    'renderer.dynamic-resolution': Object.freeze({ type: 'boolean', default: true, description: 'Allow dynamic pixel ratio recommendations.', tags: ['renderer'] }),
    'world.background-streaming': Object.freeze({ type: 'boolean', default: true, description: 'Allow caller-owned zone streaming to use runtime pressure signals.', tags: ['world'] }),
    'world.low-power-shed': Object.freeze({ type: 'boolean', default: true, description: 'Shed presentation density on constrained devices.', tags: ['world', 'performance'] }),
    'debug.diagnostics-overlay': Object.freeze({ type: 'boolean', default: false, description: 'Expose diagnostics for development builds.', tags: ['debug'] }),
    'debug.strict-contracts': Object.freeze({ type: 'boolean', default: true, description: 'Enable strict validation in acceptance tools.', tags: ['debug', 'quality'] }),
  });
}
