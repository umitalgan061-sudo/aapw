/** Reusable authored profiles for contextual locomotion anticipation tuning. */
import { resolvePlayerLocomotionAnticipationProfile } from './playerLocomotionAnticipationPolicy.js';

export const PLAYER_LOCOMOTION_PROFILE_VERSION = '2026-09-15-v1';

const PROFILE_DATA = Object.freeze({
  default: Object.freeze({ label: 'balanced', accelerationBias: 1, brakeBias: 1, pivotBias: 1, contactBias: 1, lookAheadBias: 1, confidenceBias: 1 }),
  agile: Object.freeze({ label: 'agile', accelerationBias: 1.12, brakeBias: 1.04, pivotBias: 1.16, contactBias: 0.94, lookAheadBias: 1.12, confidenceBias: 1.02 }),
  heavy: Object.freeze({ label: 'heavy', accelerationBias: 0.88, brakeBias: 1.18, pivotBias: 0.8, contactBias: 1.12, lookAheadBias: 0.92, confidenceBias: 1.06 }),
  scout: Object.freeze({ label: 'scout', accelerationBias: 1.04, brakeBias: 0.92, pivotBias: 1.08, contactBias: 0.9, lookAheadBias: 1.2, confidenceBias: 1.08 }),
  armored: Object.freeze({ label: 'armored', accelerationBias: 0.82, brakeBias: 1.24, pivotBias: 0.72, contactBias: 1.18, lookAheadBias: 0.88, confidenceBias: 1.1 }),
  slippery: Object.freeze({ label: 'slippery', accelerationBias: 1.02, brakeBias: 1.28, pivotBias: 1.14, contactBias: 0.74, lookAheadBias: 1.14, confidenceBias: 0.9 }),
  cautious: Object.freeze({ label: 'cautious', accelerationBias: 0.94, brakeBias: 1.16, pivotBias: 1.06, contactBias: 1.08, lookAheadBias: 1.24, confidenceBias: 1.12 }),
  evasive: Object.freeze({ label: 'evasive', accelerationBias: 1.1, brakeBias: 1.02, pivotBias: 1.22, contactBias: 0.88, lookAheadBias: 1.28, confidenceBias: 0.98 }),
});

function finite(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function round(value, digits = 4) { const f = 10 ** digits; return Math.round(finite(value) * f) / f; }
function freeze(value) { return Object.freeze(value); }
function normalizedKey(value) { const key = String(value ?? 'default').trim().toLowerCase(); return PROFILE_DATA[key] ? key : 'default'; }

export function listPlayerLocomotionAnticipationProfiles() { return Object.freeze(Object.keys(PROFILE_DATA)); }
export function resolvePlayerLocomotionAnticipationProfileConfig(profile = 'default') { const key = normalizedKey(profile); return freeze({ key, ...PROFILE_DATA[key] }); }

export function mergePlayerLocomotionAnticipationProfileConfig(base = 'default', overrides = {}) {
  const config = resolvePlayerLocomotionAnticipationProfileConfig(base);
  return freeze({
    ...config,
    accelerationBias: clamp(finite(overrides.accelerationBias, config.accelerationBias), 0.6, 1.4),
    brakeBias: clamp(finite(overrides.brakeBias, config.brakeBias), 0.6, 1.5),
    pivotBias: clamp(finite(overrides.pivotBias, config.pivotBias), 0.6, 1.5),
    contactBias: clamp(finite(overrides.contactBias, config.contactBias), 0.6, 1.3),
    lookAheadBias: clamp(finite(overrides.lookAheadBias, config.lookAheadBias), 0.6, 1.5),
    confidenceBias: clamp(finite(overrides.confidenceBias, config.confidenceBias), 0.6, 1.3),
  });
}

export function applyPlayerLocomotionAnticipationProfile(input = {}, profile = 'default', overrides = {}) {
  const config = mergePlayerLocomotionAnticipationProfileConfig(profile, overrides);
  const base = resolvePlayerLocomotionAnticipationProfile(input, overrides.previous ?? null);
  const transformed = {
    ...base,
    startWeight: round(clamp(base.startWeight * config.accelerationBias, 0, 1)),
    brakeWeight: round(clamp(base.brakeWeight * config.brakeBias, 0, 1)),
    pivotWeight: round(clamp(base.pivotWeight * config.pivotBias, 0, 1)),
    lookAheadSeconds: round(clamp(base.lookAheadSeconds * config.lookAheadBias, 0.05, 0.35)),
    confidence: round(clamp(base.confidence * config.confidenceBias, 0, 1)),
    contact: freeze({
      ...base.contact,
      plant: round(clamp(base.contact.plant * config.contactBias, 0, 1)),
      correctiveStep: round(clamp(base.contact.correctiveStep * (2 - config.contactBias), 0, 1)),
    }),
    profileKey: config.key,
    profileLabel: config.label,
  };
  return freeze(transformed);
}

export function resolvePlayerLocomotionProfileBlend(profileWeights = {}) {
  const entries = Object.entries(profileWeights).filter(([, weight]) => finite(weight) > 0);
  if (entries.length === 0) return freeze({ default: 1 });
  const total = entries.reduce((sum, [, weight]) => sum + Math.max(0, finite(weight)), 0);
  const output = Object.fromEntries(entries.map(([key, weight]) => [normalizedKey(key), round(Math.max(0, finite(weight)) / total)]));
  const sum = Object.values(output).reduce((a, b) => a + b, 0);
  const dominant = Object.entries(output).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'default';
  output[dominant] = round(output[dominant] + (1 - sum));
  return freeze(output);
}

export function resolvePlayerLocomotionBlendedConfig(profileWeights = {}) {
  const blend = resolvePlayerLocomotionProfileBlend(profileWeights);
  const keys = Object.keys(blend);
  const keysWithDefaults = keys.length ? keys : ['default'];
  const weighted = (field) => round(keysWithDefaults.reduce((sum, key) => sum + (blend[key] ?? 0) * PROFILE_DATA[normalizedKey(key)][field], 0));
  return freeze({
    accelerationBias: weighted('accelerationBias'),
    brakeBias: weighted('brakeBias'),
    pivotBias: weighted('pivotBias'),
    contactBias: weighted('contactBias'),
    lookAheadBias: weighted('lookAheadBias'),
    confidenceBias: weighted('confidenceBias'),
  });
}

export function resolvePlayerLocomotionContextProfile({ archetype = 'default', surfaceRisk = 0, combatPressure = 0, staminaPressure = 0 } = {}) {
  const risk = clamp(finite(surfaceRisk), 0, 1);
  const combat = clamp(finite(combatPressure), 0, 1);
  const stamina = clamp(finite(staminaPressure), 0, 1);
  const weights = {
    [normalizedKey(archetype)]: 1,
    cautious: risk * 0.65,
    evasive: combat * 0.55,
    heavy: stamina * 0.35,
  };
  const blend = resolvePlayerLocomotionProfileBlend(weights);
  return freeze({ archetype: normalizedKey(archetype), surfaceRisk: round(risk), combatPressure: round(combat), staminaPressure: round(stamina), blend, config: resolvePlayerLocomotionBlendedConfig(blend) });
}

export function resolvePlayerLocomotionProfileMetadata(profile = 'default') {
  const config = resolvePlayerLocomotionAnticipationProfileConfig(profile);
  return freeze({ version: PLAYER_LOCOMOTION_PROFILE_VERSION, key: config.key, label: config.label, tuning: config });
}

export function validatePlayerLocomotionProfileConfig(config = {}) {
  const fields = ['accelerationBias','brakeBias','pivotBias','contactBias','lookAheadBias','confidenceBias'];
  const finiteFields = fields.every((field) => Number.isFinite(config[field]));
  const ranges = finiteFields && config.accelerationBias >= 0.6 && config.accelerationBias <= 1.4 && config.brakeBias >= 0.6 && config.brakeBias <= 1.5 && config.pivotBias >= 0.6 && config.pivotBias <= 1.5 && config.contactBias >= 0.6 && config.contactBias <= 1.3 && config.lookAheadBias >= 0.6 && config.lookAheadBias <= 1.5 && config.confidenceBias >= 0.6 && config.confidenceBias <= 1.3;
  return freeze({ ok: Boolean(ranges), finiteFields, ranges });
}

export function auditPlayerLocomotionProfiles() {
  const configs = listPlayerLocomotionAnticipationProfiles().map((profile) => resolvePlayerLocomotionAnticipationProfileConfig(profile));
  return freeze({ version: PLAYER_LOCOMOTION_PROFILE_VERSION, count: configs.length, keys: listPlayerLocomotionAnticipationProfiles(), valid: configs.every((config) => validatePlayerLocomotionProfileConfig(config).ok), immutable: configs.every(Object.isFrozen) });
}
