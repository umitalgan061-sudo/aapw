/**
 * Deterministic dodge commitment policy over caller-owned combat input/state.
 * Does not mutate player state, scene, colliders, animation mixers or input devices.
 * @module gameplay/playerDodgeDirector
 */

const MAX_NUMBER = 1000;
const DEFAULT_DURATION = 0.42;
const DEFAULT_IFRAME_START = 0.08;
const DEFAULT_IFRAME_END = 0.24;
const DEFAULT_DISTANCE = 2.4;
const DEFAULT_STAMINA_COST = 18;

const finiteOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const positiveOr = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
};

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
}

function normalizeDirection(input) {
  const x = clamp(finiteOr(input?.x, 0), -1, 1);
  const z = clamp(finiteOr(input?.z, 0), -1, 1);
  const length = Math.hypot(x, z);
  if (length <= 0.0001) return { x: 0, z: 1, magnitude: 0 };
  return { x: x / length, z: z / length, magnitude: clamp(length, 0, 1) };
}

function normalizeConfig(config = {}) {
  const duration = clamp(positiveOr(config.duration, DEFAULT_DURATION), 0.05, 3);
  const iframeStart = clamp(finiteOr(config.iframeStart, DEFAULT_IFRAME_START), 0, duration);
  const iframeEnd = clamp(finiteOr(config.iframeEnd, DEFAULT_IFRAME_END), iframeStart, duration);
  return {
    duration,
    iframeStart,
    iframeEnd,
    distance: clamp(positiveOr(config.distance, DEFAULT_DISTANCE), 0, MAX_NUMBER),
    staminaCost: clamp(positiveOr(config.staminaCost, DEFAULT_STAMINA_COST), 0, MAX_NUMBER),
    recoverySeconds: clamp(finiteOr(config.recoverySeconds, 0.2), 0, 3),
  };
}

function normalizeState(state = {}) {
  const stamina = clamp(finiteOr(state.stamina, 0), 0, MAX_NUMBER);
  const maxStamina = clamp(positiveOr(state.maxStamina, Math.max(stamina, DEFAULT_STAMINA_COST)), 0.0001, MAX_NUMBER);
  return {
    alive: state.alive !== false,
    stunned: state.stunned === true,
    recovering: state.recovering === true,
    stamina,
    maxStamina,
    canDodge: state.canDodge !== false,
  };
}

export function createDodgePlan(input = {}, config = {}) {
  const rules = normalizeConfig(config);
  const state = normalizeState(input.state);
  const direction = normalizeDirection(input.direction);
  const requested = input.requested !== false;
  const staminaReady = state.stamina + 1e-9 >= rules.staminaCost;
  let accepted = requested && state.alive && !state.stunned && !state.recovering && state.canDodge && staminaReady && direction.magnitude > 0;
  let reason = accepted ? 'accepted' : 'rejected';
  if (!requested) reason = 'not-requested';
  else if (!state.alive) reason = 'dead';
  else if (state.stunned) reason = 'stunned';
  else if (state.recovering) reason = 'recovering';
  else if (!state.canDodge) reason = 'disabled';
  else if (!staminaReady) reason = 'insufficient-stamina';
  else if (direction.magnitude <= 0) reason = 'missing-direction';

  const elapsed = clamp(finiteOr(input.elapsed, 0), 0, rules.duration);
  const progress = accepted ? clamp(elapsed / rules.duration, 0, 1) : 0;
  const active = accepted && elapsed >= rules.iframeStart && elapsed <= rules.iframeEnd;
  const remainingStamina = clamp(state.stamina - (accepted ? rules.staminaCost : 0), 0, state.maxStamina);
  return freezeDeep({
    accepted,
    reason,
    direction,
    duration: rules.duration,
    elapsed,
    progress,
    active,
    iframe: { start: rules.iframeStart, end: rules.iframeEnd },
    distance: accepted ? rules.distance : 0,
    stamina: { cost: accepted ? rules.staminaCost : 0, remaining: remainingStamina, max: state.maxStamina },
    recoverySeconds: accepted ? rules.recoverySeconds : 0,
  });
}

export function serializeDodgePlan(plan) {
  return JSON.stringify(plan);
}
