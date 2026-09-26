/** Deterministic presentation window over the existing player combat frame owner. */

export const PLAYER_COMBAT_PRESENTATION_WINDOW_VERSION = '2026-09-26-r11';
const PHASES = Object.freeze(['idle', 'windup', 'active', 'recovery', 'defense', 'dodge', 'hit-stagger']);
const ATTACKS = Object.freeze(['none', 'light', 'heavy']);
const clamp01 = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
};
const text = (value, fallback = '') => {
  const result = String(value ?? '').trim();
  return result || fallback;
};

export function derivePlayerCombatPresentationWindow(frame = {}) {
  const phase = text(frame.phase, 'idle');
  const attackKind = text(frame.attack?.kind, 'none');
  const activeStart = clamp01(frame.attack?.activeStart, 0);
  const activeEnd = Math.max(activeStart, clamp01(frame.attack?.activeEnd, activeStart));
  const staminaRatio = clamp01(frame.movement?.staminaRatio, 1);
  const poiseRatio = clamp01(frame.movement?.poiseRatio, 1);
  const grounded = Boolean(frame.movement?.grounded);
  const phaseValid = PHASES.includes(phase);
  const attackValid = ATTACKS.includes(attackKind);
  const actionable = phaseValid && grounded && (phase === 'active' || phase === 'defense' || phase === 'dodge');
  const cancellable = phase === 'recovery' || phase === 'defense' || phase === 'dodge';
  const parryable = phase === 'active' && attackKind !== 'none' && poiseRatio > 0;
  const key = [PLAYER_COMBAT_PRESENTATION_WINDOW_VERSION, text(frame.revision, '0'), phase, attackKind, Math.floor(Number(frame.attack?.comboStep) || 0), activeStart.toFixed(3), activeEnd.toFixed(3), grounded ? 1 : 0, staminaRatio.toFixed(3), poiseRatio.toFixed(3)].join('|');
  return Object.freeze({ version: PLAYER_COMBAT_PRESENTATION_WINDOW_VERSION, phase, phaseValid, attackKind, attackValid, activeStart, activeEnd, grounded, staminaRatio, poiseRatio, actionable, cancellable, parryable, key });
}

export function isPlayerCombatPresentationWindow(value) {
  return Boolean(value) && value.version === PLAYER_COMBAT_PRESENTATION_WINDOW_VERSION && PHASES.includes(value.phase) && ATTACKS.includes(value.attackKind) && Number.isFinite(value.activeStart) && Number.isFinite(value.activeEnd) && value.activeStart >= 0 && value.activeEnd <= 1 && value.activeEnd >= value.activeStart && typeof value.key === 'string' && value.key.length > 0;
}
