/**
 * Converts the existing player-combat-feedback payload into a bounded presentation cue.
 * This is an adapter only: input.js owns device feedback and player.js owns authoritative combat.
 */

const finite = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const OUTCOME_TO_CUE = Object.freeze({
  hit: 'impact',
  blocked: 'guard-impact',
  parry: 'parry-success',
  dodge: 'dodge-success',
  'hit-stagger': 'stagger',
  guardBreak: 'guard-break',
  defeat: 'defeat',
});

export function resolveCombatFeedbackCue(detail = {}) {
  const outcome = String(detail.outcome || '');
  const appliedAmount = Math.max(0, finite(detail.appliedAmount));
  const blockedAmount = Math.max(0, finite(detail.blockedAmount));
  const stamina = clamp(finite(detail.stamina, 0), 0, 100);
  const poise = clamp(finite(detail.poise, 0), 0, 100);
  const cue = OUTCOME_TO_CUE[outcome] || 'none';
  const intensity = clamp(Math.max(appliedAmount, blockedAmount * 0.45) / 60, 0, 1);
  return Object.freeze({
    cue,
    intensity,
    staminaRatio: stamina / 100,
    poiseRatio: poise / 100,
    serial: Math.max(0, Math.trunc(finite(detail.serial, 0))),
    position: Object.freeze({
      x: finite(detail.position?.x),
      y: finite(detail.position?.y),
      z: finite(detail.position?.z),
    }),
  });
}

export function buildCombatFeedbackVfxCue(detail = {}) {
  const resolved = resolveCombatFeedbackCue(detail);
  if (resolved.cue === 'none') return resolved;
  return Object.freeze({
    ...resolved,
    flashStrength: clamp(0.18 + resolved.intensity * 0.72, 0.18, 0.9),
    shakeMeters: clamp(resolved.intensity * 0.045, 0, 0.045),
    soundVariant: resolved.cue,
  });
}
