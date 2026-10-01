/** Production TypeScript owner for deterministic combat recovery projection. */
// @ts-nocheck

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const round = (value, digits = 4) => Number(Number(value).toFixed(digits));
const freeze = (value) => Object.freeze(value);

const ACTIONS = freeze(['light', 'heavy', 'guard', 'parry', 'dodge', 'ranged']);

export function resolvePlayerCombatRecoveryReceipt({
  action = 'light',
  phase = 'recovery',
  elapsedSeconds = 0,
  stamina = 0,
  maxStamina = 100,
  poise = 0,
  maxPoise = 100,
  staminaRecoveryPerSecond = 18,
  poiseRecoveryPerSecond = 22,
  staminaRecoveryDelaySeconds = 0.65,
  poiseRecoveryDelaySeconds = 0.9,
  guardBreak = false,
  grounded = true,
  hitStagger = false,
  attackSerial = 0,
} = {}) {
  const normalizedAction = ACTIONS.includes(action) ? action : 'light';
  const normalizedPhase = ['startup', 'active', 'recovery', 'neutral'].includes(phase) ? phase : 'neutral';
  const safeElapsed = clamp(finite(elapsedSeconds, 0), 0, 10);
  const safeMaxStamina = Math.max(1, finite(maxStamina, 100));
  const safeMaxPoise = Math.max(1, finite(maxPoise, 100));
  const currentStamina = clamp(finite(stamina, 0), 0, safeMaxStamina);
  const currentPoise = clamp(finite(poise, 0), 0, safeMaxPoise);
  const canRecoverStamina = Boolean(grounded) && !guardBreak && !hitStagger && normalizedPhase !== 'active' && safeElapsed >= Math.max(0, finite(staminaRecoveryDelaySeconds, 0));
  const canRecoverPoise = Boolean(grounded) && !guardBreak && !hitStagger && normalizedPhase === 'neutral' && safeElapsed >= Math.max(0, finite(poiseRecoveryDelaySeconds, 0));
  const staminaDelta = canRecoverStamina ? Math.min(safeMaxStamina - currentStamina, Math.max(0, finite(staminaRecoveryPerSecond, 0)) * safeElapsed) : 0;
  const poiseDelta = canRecoverPoise ? Math.min(safeMaxPoise - currentPoise, Math.max(0, finite(poiseRecoveryPerSecond, 0)) * safeElapsed) : 0;
  const staminaAfter = round(currentStamina + staminaDelta);
  const poiseAfter = round(currentPoise + poiseDelta);
  const recoveryState = guardBreak ? 'guard-break-locked' : hitStagger ? 'stagger-locked' : !grounded ? 'airborne-locked' : (canRecoverStamina || canRecoverPoise) ? 'recovering' : 'delayed';
  const receiptKey = [normalizedAction, normalizedPhase, round(safeElapsed, 3), round(currentStamina, 3), round(currentPoise, 3), staminaAfter, poiseAfter, recoveryState, Math.max(0, Math.trunc(finite(attackSerial, 0)))].join('|');
  return freeze({
    version: 1,
    action: normalizedAction,
    phase: normalizedPhase,
    recoveryState,
    grounded: Boolean(grounded),
    guardBreak: Boolean(guardBreak),
    hitStagger: Boolean(hitStagger),
    stamina: freeze({ current: round(currentStamina), delta: round(staminaDelta), after: staminaAfter, max: safeMaxStamina, ready: staminaAfter >= safeMaxStamina * 0.28 }),
    poise: freeze({ current: round(currentPoise), delta: round(poiseDelta), after: poiseAfter, max: safeMaxPoise, vulnerable: poiseAfter <= 0 }),
    timing: freeze({ elapsedSeconds: round(safeElapsed, 3), staminaDelaySeconds: round(Math.max(0, finite(staminaRecoveryDelaySeconds, 0)), 3), poiseDelaySeconds: round(Math.max(0, finite(poiseRecoveryDelaySeconds, 0)), 3) }),
    receiptKey,
  });
}

export function isPlayerCombatRecoveryReceipt(value) {
  return Boolean(value && value.version === 1 && typeof value.receiptKey === 'string' && value.stamina && value.poise && value.timing && ['recovering', 'delayed', 'guard-break-locked', 'stagger-locked', 'airborne-locked'].includes(value.recoveryState));
}

export function validatePlayerCombatRecoveryReceipt(value) {
  const errors = [];
  if (!isPlayerCombatRecoveryReceipt(value)) errors.push('invalid-shape');
  if (value && value.stamina && value.stamina.after < value.stamina.current) errors.push('stamina-decreased');
  if (value && value.poise && value.poise.after < value.poise.current) errors.push('poise-decreased');
  if (value && value.guardBreak && value.recoveryState !== 'guard-break-locked') errors.push('guard-break-state-mismatch');
  if (value && value.hitStagger && value.recoveryState !== 'stagger-locked') errors.push('stagger-state-mismatch');
  return freeze({ ok: errors.length === 0, errors: freeze(errors) });
}
