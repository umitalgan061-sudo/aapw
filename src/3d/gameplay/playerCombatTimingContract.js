/**
 * Deterministic timing contract for the shipped player combat state machine.
 * It mirrors player.js's bounded frame delta without owning timers or animation state.
 * @module gameplay/playerCombatTimingContract
 */

const MAX_FRAME_DELTA_SECONDS = 0.1;
const MAX_ACCUMULATED_SECONDS = 2;
const EPSILON = 1e-6;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function normalizeFrameDelta(deltaSeconds, { maxFrameDeltaSeconds = MAX_FRAME_DELTA_SECONDS } = {}) {
  const maxDelta = clamp(finite(maxFrameDeltaSeconds, MAX_FRAME_DELTA_SECONDS), 0.001, 0.5);
  return clamp(Math.max(0, finite(deltaSeconds, 0)), 0, maxDelta);
}

export function projectCombatClock({
  elapsedSeconds = 0,
  deltaSeconds = 0,
  phaseSeconds = 0,
  phaseDurationSeconds = 0,
  maxFrameDeltaSeconds = MAX_FRAME_DELTA_SECONDS,
} = {}) {
  const elapsed = clamp(finite(elapsedSeconds, 0), 0, MAX_ACCUMULATED_SECONDS);
  const delta = normalizeFrameDelta(deltaSeconds, { maxFrameDeltaSeconds });
  const phase = clamp(finite(phaseSeconds, 0), 0, MAX_ACCUMULATED_SECONDS);
  const duration = clamp(finite(phaseDurationSeconds, 0), 0, MAX_ACCUMULATED_SECONDS);
  const nextElapsed = clamp(elapsed + delta, 0, MAX_ACCUMULATED_SECONDS);
  const nextPhase = clamp(phase + delta, 0, MAX_ACCUMULATED_SECONDS);
  const remainingSeconds = Math.max(0, duration - nextPhase);
  const complete = duration > EPSILON && nextPhase + EPSILON >= duration;
  return Object.freeze({
    deltaSeconds: delta,
    elapsedSeconds: nextElapsed,
    phaseSeconds: nextPhase,
    phaseDurationSeconds: duration,
    remainingSeconds,
    complete,
    frameDeltaClamped: delta < Math.max(0, finite(deltaSeconds, 0)) - EPSILON,
  });
}

export function buildCombatTimingEvidence(input = {}) {
  const clock = projectCombatClock(input);
  return Object.freeze({
    ...clock,
    contract: 'player-combat-timing-v1',
    maxFrameDeltaSeconds: clamp(finite(input.maxFrameDeltaSeconds, MAX_FRAME_DELTA_SECONDS), 0.001, 0.5),
    ownership: Object.freeze({
      timerOwner: 'src/3d/gameplay/player.js',
      animationOwner: 'src/3d/gameplay/player.js',
      consumerRole: 'runtime-check-diagnostics',
    }),
  });
}

export function validateCombatTimingEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object') return false;
  return Number.isFinite(evidence.deltaSeconds)
    && Number.isFinite(evidence.phaseSeconds)
    && Number.isFinite(evidence.remainingSeconds)
    && evidence.phaseSeconds >= 0
    && evidence.remainingSeconds >= 0
    && typeof evidence.complete === 'boolean'
    && evidence.contract === 'player-combat-timing-v1';
}
