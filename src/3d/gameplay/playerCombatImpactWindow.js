/**
 * Deterministic attack-timing policy for the shipped player combat frame.
 *
 * This module derives hitbox/hurtbox evaluation windows from caller-owned attack samples.
 * It does not perform collision, apply damage, mutate player state, own animation mixers, or
 * create a second combat framework.
 */

const ATTACK_KINDS = Object.freeze(['light', 'heavy', 'ranged', 'archery']);
const PHASES = Object.freeze(['idle', 'windup', 'active', 'recovery', 'interrupted', 'defeated']);

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));
const id = (value, fallback = 'none') => String(value ?? fallback).trim() || fallback;

const normalizeKind = (value) => {
  const normalized = id(value).toLowerCase();
  return ATTACK_KINDS.includes(normalized) ? normalized : 'light';
};

const normalizePhase = (value) => {
  const normalized = id(value, 'idle').toLowerCase();
  return PHASES.includes(normalized) ? normalized : 'idle';
};

const normalizedWindow = (window, fallback) => {
  const start = clamp(window?.start, 0, 1);
  const end = clamp(window?.end, start, 1);
  return { start, end, fallback };
};

export function resolvePlayerCombatImpactWindow(sample = {}, tuning = {}) {
  const phase = normalizePhase(sample.phase);
  const kind = normalizeKind(sample.attackKind ?? sample.kind);
  const progress = clamp(sample.progress ?? sample.normalizedTime, 0, 1);
  const targetId = sample.targetId == null ? null : id(sample.targetId, 'target');
  const windows = {
    light: normalizedWindow(tuning.light, { start: 0.34, end: 0.58 }),
    heavy: normalizedWindow(tuning.heavy, { start: 0.46, end: 0.70 }),
    ranged: normalizedWindow(tuning.ranged, { start: 0.58, end: 0.90 }),
    archery: normalizedWindow(tuning.archery, { start: 0.58, end: 0.92 }),
  };
  const window = windows[kind];
  const eligiblePhase = phase === 'active' || (phase === 'windup' && progress >= window.start);
  const inWindow = eligiblePhase && progress >= window.start && progress <= window.end;
  const completed = phase === 'recovery' || phase === 'interrupted' || phase === 'defeated' || progress > window.end;

  return Object.freeze({
    attackKind: kind,
    phase,
    progress,
    targetId,
    window: Object.freeze({ start: window.start, end: window.end }),
    hitboxActive: Boolean(inWindow),
    hurtboxActive: phase !== 'defeated',
    canConfirmHit: Boolean(inWindow && targetId),
    completed,
  });
}

export function createPlayerCombatImpactWindowGate({ tuning, maxHistory = 16 } = {}) {
  const state = { history: [], disposed: false };
  const limit = Math.max(1, Math.min(64, Math.floor(finite(maxHistory, 16))));
  const evaluate = (sample = {}) => {
    if (state.disposed) return Object.freeze({ disposed: true });
    const result = resolvePlayerCombatImpactWindow(sample, tuning);
    state.history.push(result);
    if (state.history.length > limit) state.history.splice(0, state.history.length - limit);
    return result;
  };
  const snapshot = () => Object.freeze({
    disposed: state.disposed,
    count: state.history.length,
    history: state.history.map((entry) => ({ ...entry, window: { ...entry.window } })),
  });
  const reset = () => { state.history.length = 0; };
  const dispose = () => { state.disposed = true; reset(); };
  return Object.freeze({ evaluate, snapshot, reset, dispose });
}

export { ATTACK_KINDS, PHASES };
