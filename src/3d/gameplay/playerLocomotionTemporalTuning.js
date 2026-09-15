/**
 * Data-first timing matrix for contextual locomotion presentation.
 * Values are presentation tuning, not gameplay constants.
 */
export const PLAYER_LOCOMOTION_TEMPORAL_TUNING_VERSION = '2026-09-15-v1';

export const PLAYER_LOCOMOTION_TEMPORAL_TUNING = Object.freeze({
  idle: Object.freeze({ enter: 0.09, exit: 0.08, smoothing: 0.72, inertia: 0.22, overshoot: 0.02 }),
  start: Object.freeze({ enter: 0.08, exit: 0.12, smoothing: 0.68, inertia: 0.34, overshoot: 0.06 }),
  accelerate: Object.freeze({ enter: 0.1, exit: 0.14, smoothing: 0.66, inertia: 0.42, overshoot: 0.08 }),
  cruise: Object.freeze({ enter: 0.14, exit: 0.14, smoothing: 0.78, inertia: 0.5, overshoot: 0.04 }),
  brake: Object.freeze({ enter: 0.08, exit: 0.16, smoothing: 0.58, inertia: 0.7, overshoot: 0.03 }),
  stop: Object.freeze({ enter: 0.06, exit: 0.1, smoothing: 0.5, inertia: 0.82, overshoot: 0.01 }),
  strafe: Object.freeze({ enter: 0.12, exit: 0.13, smoothing: 0.62, inertia: 0.46, overshoot: 0.05 }),
  reverse: Object.freeze({ enter: 0.14, exit: 0.16, smoothing: 0.64, inertia: 0.55, overshoot: 0.07 }),
  pivot: Object.freeze({ enter: 0.18, exit: 0.2, smoothing: 0.54, inertia: 0.76, overshoot: 0.11 }),
  recover: Object.freeze({ enter: 0.14, exit: 0.2, smoothing: 0.6, inertia: 0.64, overshoot: 0.04 }),
  'turn-in-place': Object.freeze({ enter: 0.1, exit: 0.12, smoothing: 0.59, inertia: 0.35, overshoot: 0.04 }),
  'combat-advance': Object.freeze({ enter: 0.1, exit: 0.12, smoothing: 0.6, inertia: 0.48, overshoot: 0.05 }),
  'combat-retreat': Object.freeze({ enter: 0.11, exit: 0.13, smoothing: 0.61, inertia: 0.58, overshoot: 0.05 }),
  'guard-walk': Object.freeze({ enter: 0.13, exit: 0.15, smoothing: 0.7, inertia: 0.52, overshoot: 0.03 }),
  'dodge-recover': Object.freeze({ enter: 0.16, exit: 0.2, smoothing: 0.48, inertia: 0.72, overshoot: 0.02 }),
  'stagger-recover': Object.freeze({ enter: 0.2, exit: 0.24, smoothing: 0.44, inertia: 0.8, overshoot: 0.01 }),
});

const ENVIRONMENT_MODIFIERS = Object.freeze({
  clear: Object.freeze({ duration: 1, smoothing: 1, inertia: 1, confidence: 1 }),
  soft: Object.freeze({ duration: 1.08, smoothing: 0.94, inertia: 1.06, confidence: 0.96 }),
  slippery: Object.freeze({ duration: 1.16, smoothing: 0.9, inertia: 1.12, confidence: 0.9 }),
  steep: Object.freeze({ duration: 1.12, smoothing: 0.92, inertia: 1.09, confidence: 0.93 }),
  unstable: Object.freeze({ duration: 1.2, smoothing: 0.86, inertia: 1.15, confidence: 0.84 }),
});

function finite(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function round(value, digits = 4) { const f = 10 ** digits; return Math.round(finite(value) * f) / f; }
function freeze(value) { return Object.freeze(value); }
function normalizeMode(mode) { const key = String(mode ?? 'idle'); return PLAYER_LOCOMOTION_TEMPORAL_TUNING[key] ? key : 'idle'; }

export function listPlayerLocomotionTemporalModes() { return Object.freeze(Object.keys(PLAYER_LOCOMOTION_TEMPORAL_TUNING)); }
export function resolvePlayerLocomotionTemporalTuning(mode = 'idle') { const key = normalizeMode(mode); return freeze({ mode: key, ...PLAYER_LOCOMOTION_TEMPORAL_TUNING[key] }); }
export function resolvePlayerLocomotionEnvironmentModifier(environment = 'clear') { const key = ENVIRONMENT_MODIFIERS[environment] ? environment : 'clear'; return freeze({ environment: key, ...ENVIRONMENT_MODIFIERS[key] }); }

export function resolvePlayerLocomotionTemporalWindow(from = 'idle', to = 'idle', context = {}) {
  const target = resolvePlayerLocomotionTemporalTuning(to); const source = resolvePlayerLocomotionTemporalTuning(from); const env = resolvePlayerLocomotionEnvironmentModifier(context.environment);
  const confidence = clamp(finite(context.confidence, 1), 0, 1); const risk = clamp(finite(context.groundRisk), 0, 1); const intensity = clamp(Math.abs(finite(context.speedDeltaMps)) / 8, 0, 1);
  const transitionBase = from === to ? target.enter : (target.enter + source.exit) / 2;
  const seconds = transitionBase * env.duration * (1 + risk * 0.12 + intensity * 0.06 + (1 - confidence) * 0.08);
  return round(clamp(seconds, 0.04, 0.46));
}

export function resolvePlayerLocomotionTemporalSample({ elapsedSeconds = 0, windowSeconds = 0.1, mode = 'idle', directionWeight = 1, confidence = 1 } = {}) {
  const tuning = resolvePlayerLocomotionTemporalTuning(mode); const duration = clamp(finite(windowSeconds, 0.1), 0.04, 0.46); const elapsed = Math.max(0, finite(elapsedSeconds)); const t = clamp(elapsed / duration, 0, 1); const easing = clamp(tuning.smoothing, 0.2, 1); const shaped = 1 - Math.exp(-t * (2.4 + easing * 4.2));
  const normalized = clamp(shaped / (1 - Math.exp(-(2.4 + easing * 4.2))), 0, 1); const overshoot = tuning.overshoot * Math.sin(Math.PI * normalized) * clamp(1 - confidence, 0, 1);
  const weight = clamp(finite(directionWeight, 1), 0, 1); return freeze({ progress: round(clamp(normalized + overshoot, 0, 1)), rawProgress: round(normalized), directionWeight: round(weight), confidence: round(clamp(finite(confidence, 1), 0, 1)), complete: t >= 1, durationSeconds: duration });
}

export function resolvePlayerLocomotionTemporalVelocity({ previousWeight = 0, targetWeight = 1, deltaSeconds = 1 / 60, mode = 'cruise', environment = 'clear' } = {}) {
  const tuning = resolvePlayerLocomotionTemporalTuning(mode); const env = resolvePlayerLocomotionEnvironmentModifier(environment); const dt = clamp(finite(deltaSeconds, 1 / 60), 0, 0.1); const gain = clamp((1 - tuning.smoothing) * 9 + 2, 2, 11); const inertia = clamp(tuning.inertia * env.inertia, 0.05, 1.2); const target = clamp(finite(targetWeight), 0, 1); const previous = clamp(finite(previousWeight), 0, 1); const delta = (target - previous) * gain * dt / inertia; return round(clamp(delta, -0.22, 0.22));
}

export function resolvePlayerLocomotionTemporalNextWeight(args = {}) { const previous = clamp(finite(args.previousWeight), 0, 1); const target = clamp(finite(args.targetWeight, 1), 0, 1); const delta = resolvePlayerLocomotionTemporalVelocity(args); return round(clamp(previous + delta, 0, 1)); }

export function resolvePlayerLocomotionTemporalInterruptibility(from = 'idle', to = 'idle', context = {}) { const target = normalizeMode(to); const risk = clamp(finite(context.groundRisk), 0, 1); const pivot = target === 'pivot' || from === 'pivot'; const recovery = target.includes('recover'); return freeze({ interruptible: !pivot && !(recovery && risk > 0.72), lockSeconds: round(pivot ? 0.18 : recovery ? 0.12 : 0.06), priority: round(clamp((pivot ? 1 : recovery ? 0.92 : 0.68) + risk * 0.04, 0, 1)) }); }

export function resolvePlayerLocomotionTemporalStack(layers = []) { const list = Array.isArray(layers) ? layers : []; const ordered = list.map((layer, index) => freeze({ index, mode: normalizeMode(layer?.mode), weight: clamp(finite(layer?.weight), 0, 1), priority: clamp(finite(layer?.priority, 0.5), 0, 1) })).sort((a, b) => b.priority - a.priority); const total = ordered.reduce((sum, item) => sum + item.weight, 0); return freeze(ordered.map((item) => freeze({ ...item, normalizedWeight: round(total > 0 ? item.weight / total : 0) })));
}

export function validatePlayerLocomotionTemporalTuning(tuning = {}) { const fields = ['enter','exit','smoothing','inertia','overshoot']; const finiteFields = fields.every((field) => Number.isFinite(tuning[field])); const range = finiteFields && tuning.enter >= 0.04 && tuning.enter <= 0.42 && tuning.exit >= 0.04 && tuning.exit <= 0.42 && tuning.smoothing >= 0.2 && tuning.smoothing <= 1 && tuning.inertia >= 0.05 && tuning.inertia <= 1.2 && tuning.overshoot >= 0 && tuning.overshoot <= 0.15; return freeze({ ok: Boolean(range), finiteFields, range }); }

export function auditPlayerLocomotionTemporalTuning(){const modes=listPlayerLocomotionTemporalModes();const configs=modes.map((mode)=>resolvePlayerLocomotionTemporalTuning(mode));return freeze({version:PLAYER_LOCOMOTION_TEMPORAL_TUNING_VERSION,count:modes.length,valid:configs.every((item)=>validatePlayerLocomotionTemporalTuning(item).ok),immutable:configs.every(Object.isFrozen),environmentCount:Object.keys(ENVIRONMENT_MODIFIERS).length});}
