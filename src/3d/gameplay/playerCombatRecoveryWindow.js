/**
 * Resolves bounded cancel/queue windows for the existing player combat phase.
 *
 * This is a pure policy adapter. It does not own player state, timers, input listeners,
 * animation mixers, damage, equipment, scene objects or terrain. The authoritative player
 * controller supplies the current phase and consumes the returned window.
 *
 * @module gameplay/playerCombatRecoveryWindow
 */

const PHASES = Object.freeze(['idle', 'windup', 'active', 'recovery', 'interrupted', 'defeated']);
const ACTIONS = Object.freeze(['light', 'heavy', 'block', 'parry', 'dodge']);
const DEFAULTS = Object.freeze({
  windupSeconds: 0.18,
  activeSeconds: 0.16,
  recoverySeconds: 0.42,
  queueLeadSeconds: 0.12,
  cancelLeadSeconds: 0.08,
  maxComboIndex: 3,
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const normalizePhase = (value) => PHASES.includes(value) ? value : 'idle';
const normalizeAction = (value) => ACTIONS.includes(value) ? value : null;

function normalizeOptions(options = {}) {
  return {
    windupSeconds: clamp(finite(options.windupSeconds, DEFAULTS.windupSeconds), 0.01, 1.5),
    activeSeconds: clamp(finite(options.activeSeconds, DEFAULTS.activeSeconds), 0.01, 1.5),
    recoverySeconds: clamp(finite(options.recoverySeconds, DEFAULTS.recoverySeconds), 0.02, 2.5),
    queueLeadSeconds: clamp(finite(options.queueLeadSeconds, DEFAULTS.queueLeadSeconds), 0, 0.5),
    cancelLeadSeconds: clamp(finite(options.cancelLeadSeconds, DEFAULTS.cancelLeadSeconds), 0, 0.5),
    maxComboIndex: clamp(Math.trunc(finite(options.maxComboIndex, DEFAULTS.maxComboIndex)), 1, 9),
  };
}

/**
 * @param {object} input
 * @param {object} [options]
 * @returns {Readonly<{phase:string, action:string|null, comboIndex:number, elapsedSeconds:number, durationSeconds:number, cancelable:boolean, queueable:boolean, acceptedActions:ReadonlyArray<string>, reason:string}>}
 */
export function resolvePlayerCombatRecoveryWindow(input = {}, options = {}) {
  const config = normalizeOptions(options);
  const phase = normalizePhase(input.phase);
  const action = normalizeAction(input.action);
  const comboIndex = clamp(Math.trunc(finite(input.comboIndex, 0)), 0, config.maxComboIndex);
  const elapsedSeconds = clamp(finite(input.elapsedSeconds, 0), 0, 10);
  const durationSeconds = phase === 'windup'
    ? config.windupSeconds
    : phase === 'active'
      ? config.activeSeconds
      : phase === 'recovery'
        ? config.recoverySeconds
        : 0;
  const remainingSeconds = Math.max(0, durationSeconds - elapsedSeconds);
  const terminal = phase === 'idle' || phase === 'interrupted' || phase === 'defeated' || !action;
  const inRecoveryTail = phase === 'recovery' && remainingSeconds <= config.cancelLeadSeconds;
  const queueable = phase === 'windup' || phase === 'active' || (phase === 'recovery' && remainingSeconds <= config.queueLeadSeconds);
  const cancelable = phase === 'windup' || phase === 'active' || inRecoveryTail;
  const acceptedActions = terminal
    ? Object.freeze([])
    : Object.freeze(queueable ? ['light', 'heavy', 'block', 'parry', 'dodge'] : ['dodge', 'block']);
  const reason = terminal
    ? 'terminal-or-unarmed'
    : inRecoveryTail
      ? 'recovery-tail'
      : queueable
        ? 'queue-window'
        : 'defensive-only';

  return Object.freeze({
    phase,
    action,
    comboIndex,
    elapsedSeconds,
    durationSeconds,
    remainingSeconds,
    cancelable,
    queueable,
    acceptedActions,
    reason,
  });
}

/**
 * Returns whether a buffered action is permitted by the resolved window.
 */
export function canAcceptPlayerCombatRecoveryAction(windowInput, actionInput) {
  if (!windowInput || !Array.isArray(windowInput.acceptedActions)) return false;
  const action = normalizeAction(actionInput);
  return Boolean(action && windowInput.acceptedActions.includes(action));
}

export { PHASES as PLAYER_COMBAT_RECOVERY_PHASES, ACTIONS as PLAYER_COMBAT_RECOVERY_ACTIONS };
