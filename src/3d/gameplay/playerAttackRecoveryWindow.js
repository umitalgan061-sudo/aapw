/**
 * Read-only recovery/cancel window projection for the existing player action state machine.
 * The caller still owns timers, AnimationMixer, input consumption and state mutation.
 */
const ACTIONS = Object.freeze({ light: { windup: 0.18, active: 0.16, recovery: 0.32, cancel: 0.72 }, heavy: { windup: 0.38, active: 0.24, recovery: 0.58, cancel: 0.84 }, ranged: { windup: 0.34, active: 0.12, recovery: 0.42, cancel: 0.78 } });
const finite = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;
const clamp01 = (v) => Math.max(0, Math.min(1, finite(v)));
const actionKey = (v) => { const s = String(v ?? '').toLowerCase(); return s.includes('heavy') ? 'heavy' : s.includes('ranged') || s.includes('bow') || s.includes('crossbow') ? 'ranged' : 'light'; };
const freeze = (v) => Object.freeze(v);

export function resolvePlayerAttackRecoveryWindow({ action = 'light', progress = 0, bufferedAction = null, interrupted = false, grounded = true, stunned = false } = {}) {
  const key = actionKey(action);
  const spec = ACTIONS[key];
  const p = clamp01(progress);
  const phase = p < spec.windup / (spec.windup + spec.active + spec.recovery) ? 'windup' : p < (spec.windup + spec.active) / (spec.windup + spec.active + spec.recovery) ? 'active' : 'recovery';
  const cancelable = !stunned && !interrupted && grounded && p >= spec.cancel;
  const queueAccepted = cancelable && bufferedAction != null;
  return freeze({ version: 1, action: key, phase, progress: p, cancelable, queueAccepted, bufferedAction: queueAccepted ? actionKey(bufferedAction) : null, remainingRecovery: phase === 'recovery' ? Number(((1 - p) * spec.recovery).toFixed(4)) : spec.recovery, interrupted: Boolean(interrupted), grounded: Boolean(grounded), stunned: Boolean(stunned) });
}

export const PLAYER_ATTACK_RECOVERY_ACTIONS = ACTIONS;
