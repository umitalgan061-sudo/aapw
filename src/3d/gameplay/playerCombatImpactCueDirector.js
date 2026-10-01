/**
 * Deterministic presentation cues for the existing player combat pipeline.
 *
 * This adapter does not own damage, animation mixers, cameras, audio, VFX, input,
 * or scene state. It turns an existing combat outcome into bounded cues that
 * callers may consume for hit-stop, camera impulse, audio and VFX feedback.
 */

const OUTCOMES = Object.freeze([
  'hit',
  'blocked',
  'parried',
  'dodged',
  'staggered',
  'guard-break',
  'defeated',
  'miss',
]);

const finite = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);
const clamp01 = (value) => Math.min(1, Math.max(0, finite(value)));
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value)));

function normalizeOutcome(value) {
  const outcome = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return OUTCOMES.includes(outcome) ? outcome : 'miss';
}

function resolveSeverity({ outcome, damage, poiseDamage, blockedRatio }) {
  const damageSignal = clamp01(Math.abs(damage) / 100);
  const poiseSignal = clamp01(Math.abs(poiseDamage) / 100);
  const guardSignal = clamp01(blockedRatio);
  const base = Math.max(damageSignal, poiseSignal * 0.85);
  if (outcome === 'defeated') return 1;
  if (outcome === 'guard-break') return Math.max(0.8, base);
  if (outcome === 'parried') return Math.max(0.6, base * 0.9);
  if (outcome === 'blocked') return Math.max(0.2, guardSignal * 0.65);
  if (outcome === 'dodged' || outcome === 'miss') return 0;
  return clamp01(base);
}

export function resolvePlayerCombatImpactCue(input = {}) {
  const outcome = normalizeOutcome(input.outcome);
  const severity = resolveSeverity({
    outcome,
    damage: input.damage,
    poiseDamage: input.poiseDamage,
    blockedRatio: input.blockedRatio,
  });
  const comboStep = clamp(Math.round(finite(input.comboStep, 0)), 0, 3);
  const distance = clamp(Math.abs(input.distance), 0, 12);
  const airborne = Boolean(input.airborne);
  const critical = Boolean(input.critical);
  const hitStopMs = clamp(
    (outcome === 'hit' || outcome === 'staggered' || outcome === 'guard-break' || outcome === 'defeated'
      ? 18 + severity * 86
      : outcome === 'parried'
        ? 28 + severity * 64
        : outcome === 'blocked'
          ? 8 + severity * 26
          : 0),
    0,
    120,
  );
  const cameraImpulse = clamp01(
    (outcome === 'hit' || outcome === 'staggered' || outcome === 'guard-break' || outcome === 'defeated'
      ? 0.18 + severity * 0.72
      : outcome === 'parried'
        ? 0.34 + severity * 0.5
        : outcome === 'blocked'
          ? 0.12 + severity * 0.24
          : 0),
  );
  const audioIntensity = clamp01(Math.max(severity, critical ? 0.85 : 0));
  const vfxIntensity = clamp01(severity * (airborne ? 0.9 : 1));

  return Object.freeze({
    outcome,
    severity,
    comboStep,
    distance,
    airborne,
    critical,
    cues: Object.freeze({
      hitStopMs,
      cameraImpulse,
      audioIntensity,
      vfxIntensity,
      emitImpact: outcome !== 'miss' && outcome !== 'dodged',
      emitGuardSpark: outcome === 'blocked' || outcome === 'parried' || outcome === 'guard-break',
      emitDefeatBurst: outcome === 'defeated',
    }),
  });
}

export function serializePlayerCombatImpactCue(cue) {
  return JSON.stringify(cue);
}

export const PLAYER_COMBAT_IMPACT_OUTCOMES = OUTCOMES;
