/**
 * Deterministic guard/parry timing policy for the shipped player combat runtime.
 *
 * This module is intentionally stateless with respect to the player. The existing player
 * state machine remains authoritative for input, timers, stamina, poise, animation and damage.
 * Callers provide a normalized action sample and receive an immutable timing/cost receipt.
 */

const ACTIONS = Object.freeze({ guard: 'guard', parry: 'parry' });
const OUTCOMES = Object.freeze({
  guard: 'guard',
  parry: 'parry',
  exhausted: 'exhausted',
  rejected: 'rejected',
});

const DEFAULTS = Object.freeze({
  guardWindowMs: 260,
  parryWindowMs: 120,
  guardRecoveryMs: 180,
  parryRecoveryMs: 260,
  guardStaminaCost: 6,
  parryStaminaCost: 10,
  guardPoiseCost: 4,
  parryPoiseCost: 0,
  minStaminaRatio: 0,
  minPoiseRatio: 0,
});

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const positive = (value, fallback) => Math.max(0, finite(value, fallback));

function normalizeAction(action) {
  const value = String(action ?? '').trim().toLowerCase();
  if (value === 'block' || value === 'guard-held') return ACTIONS.guard;
  if (value === 'perfect-guard' || value === 'deflect') return ACTIONS.parry;
  return value === ACTIONS.guard || value === ACTIONS.parry ? value : null;
}

function normalizeConfig(input = {}) {
  return Object.freeze({
    guardWindowMs: positive(input.guardWindowMs, DEFAULTS.guardWindowMs),
    parryWindowMs: positive(input.parryWindowMs, DEFAULTS.parryWindowMs),
    guardRecoveryMs: positive(input.guardRecoveryMs, DEFAULTS.guardRecoveryMs),
    parryRecoveryMs: positive(input.parryRecoveryMs, DEFAULTS.parryRecoveryMs),
    guardStaminaCost: positive(input.guardStaminaCost, DEFAULTS.guardStaminaCost),
    parryStaminaCost: positive(input.parryStaminaCost, DEFAULTS.parryStaminaCost),
    guardPoiseCost: positive(input.guardPoiseCost, DEFAULTS.guardPoiseCost),
    parryPoiseCost: positive(input.parryPoiseCost, DEFAULTS.parryPoiseCost),
    minStaminaRatio: clamp(finite(input.minStaminaRatio, DEFAULTS.minStaminaRatio), 0, 1),
    minPoiseRatio: clamp(finite(input.minPoiseRatio, DEFAULTS.minPoiseRatio), 0, 1),
  });
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export function resolvePlayerCombatGuardWindowPolicy({
  action,
  elapsedMs = 0,
  staminaRatio = 1,
  poiseRatio = 1,
  isGrounded = true,
  isDefeated = false,
  isInterrupted = false,
  config,
} = {}) {
  const normalizedAction = normalizeAction(action);
  const tuning = normalizeConfig(config);
  const stamina = clamp(finite(staminaRatio, 0), 0, 1);
  const poise = clamp(finite(poiseRatio, 0), 0, 1);
  const elapsed = Math.max(0, finite(elapsedMs, 0));
  const isParry = normalizedAction === ACTIONS.parry;
  const windowMs = isParry ? tuning.parryWindowMs : tuning.guardWindowMs;
  const recoveryMs = isParry ? tuning.parryRecoveryMs : tuning.guardRecoveryMs;
  const staminaCost = isParry ? tuning.parryStaminaCost : tuning.guardStaminaCost;
  const poiseCost = isParry ? tuning.parryPoiseCost : tuning.guardPoiseCost;
  const common = {
    action: normalizedAction ?? 'unknown',
    elapsedMs: elapsed,
    windowMs,
    recoveryMs,
    staminaCost,
    poiseCost,
    staminaRatio: stamina,
    poiseRatio: poise,
    grounded: Boolean(isGrounded),
  };

  let outcome = OUTCOMES.rejected;
  let reason = 'unsupported-action';
  if (!normalizedAction) reason = 'unsupported-action';
  else if (isDefeated) reason = 'defeated';
  else if (isInterrupted) reason = 'interrupted';
  else if (!isGrounded) reason = 'airborne';
  else if (stamina < Math.max(tuning.minStaminaRatio, staminaCost / 100)) {
    outcome = OUTCOMES.exhausted;
    reason = 'stamina';
  } else if (poise < tuning.minPoiseRatio) {
    outcome = OUTCOMES.exhausted;
    reason = 'poise';
  } else {
    outcome = isParry && elapsed <= windowMs ? OUTCOMES.parry : OUTCOMES.guard;
    reason = outcome === OUTCOMES.parry ? 'perfect-window' : 'guard-window';
  }

  return deepFreeze({
    ok: outcome === OUTCOMES.guard || outcome === OUTCOMES.parry,
    outcome,
    reason,
    phase: elapsed <= windowMs ? 'active' : 'recovery',
    costs: Object.freeze({ stamina: staminaCost, poise: poiseCost }),
    timing: Object.freeze({ activeMs: windowMs, recoveryMs }),
    ...common,
  });
}

export function validatePlayerCombatGuardWindowReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object') return false;
  if (!Object.values(OUTCOMES).includes(receipt.outcome)) return false;
  if (!['active', 'recovery'].includes(receipt.phase)) return false;
  if (!Number.isFinite(receipt.timing?.activeMs) || receipt.timing.activeMs < 0) return false;
  if (!Number.isFinite(receipt.timing?.recoveryMs) || receipt.timing.recoveryMs < 0) return false;
  if (!Number.isFinite(receipt.costs?.stamina) || receipt.costs.stamina < 0) return false;
  if (!Number.isFinite(receipt.costs?.poise) || receipt.costs.poise < 0) return false;
  return receipt.ok === (receipt.outcome === OUTCOMES.guard || receipt.outcome === OUTCOMES.parry);
}

export const PLAYER_COMBAT_GUARD_WINDOW_ACTIONS = ACTIONS;
export const PLAYER_COMBAT_GUARD_WINDOW_DEFAULTS = DEFAULTS;
