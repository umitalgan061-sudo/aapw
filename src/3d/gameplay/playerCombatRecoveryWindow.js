/**
 * Deterministic read-only recovery projection over existing player combat observations.
 * The shipped player state machine remains authoritative for timers and mutations.
 * @module gameplay/playerCombatRecoveryWindow
 */

const DEFAULTS = Object.freeze({
  maxRecoverySeconds: 1.25,
  hitStaggerSeconds: 0.32,
  guardBreakSeconds: 0.75,
  dodgeSeconds: 0.38,
  parryFeedbackSeconds: 0.18,
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const bool = (value) => value === true;

function normalizePhase(phase) {
  const value = String(phase ?? '').trim().toLowerCase();
  return ['idle', 'attack', 'guard', 'parry', 'dodge', 'hit-stagger', 'guard-break'].includes(value) ? value : 'idle';
}

function durationForPhase(phase, source = {}) {
  const key = {
    'hit-stagger': 'hitStaggerSeconds',
    'guard-break': 'guardBreakSeconds',
    dodge: 'dodgeSeconds',
    parry: 'parryFeedbackSeconds',
  }[phase];
  return key ? Math.max(0, finite(source[key], DEFAULTS[key])) : Math.max(0, finite(source.recoverySeconds, 0));
}

export function projectCombatRecoveryWindow(observation = {}, options = {}) {
  const phase = normalizePhase(observation.phase);
  const defaults = { ...DEFAULTS, ...options };
  const duration = clamp(durationForPhase(phase, { ...defaults, ...observation }), 0, Math.max(0.05, finite(defaults.maxRecoverySeconds, DEFAULTS.maxRecoverySeconds)));
  const elapsed = clamp(finite(observation.elapsedSeconds, 0), 0, duration);
  const remaining = Math.max(0, duration - elapsed);
  const invulnerable = bool(observation.invulnerable) || phase === 'dodge' || phase === 'parry';
  const recoveryLocked = ['hit-stagger', 'guard-break', 'dodge', 'parry'].includes(phase) && remaining > 0;
  return Object.freeze({
    phase,
    durationSeconds: duration,
    elapsedSeconds: elapsed,
    remainingSeconds: remaining,
    progress: duration > 0 ? elapsed / duration : 1,
    invulnerable,
    recoveryLocked,
    canQueueAttack: !recoveryLocked && phase !== 'guard-break',
    canTurn: !['hit-stagger', 'guard-break'].includes(phase),
    ownership: 'player-runtime-timer-and-state-machine',
  });
}

export function validateCombatRecoveryWindow(snapshot) {
  return Boolean(snapshot && Object.isFrozen(snapshot)
    && Number.isFinite(snapshot.durationSeconds)
    && Number.isFinite(snapshot.elapsedSeconds)
    && Number.isFinite(snapshot.remainingSeconds)
    && snapshot.progress >= 0 && snapshot.progress <= 1);
}
