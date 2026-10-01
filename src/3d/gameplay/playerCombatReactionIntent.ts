/**
 * Deterministic reaction intent over the existing player combat rules.
 * Keeps damage/poise/state mutation in the shipped player authority.
 */
import { resolvePlayerHitReaction } from './playerEquipmentCombatRules.ts';

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value)));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const freeze = (value) => Object.freeze(value);

export function resolvePlayerCombatReactionIntent(profileInput = {}, {
  outcome = 'hit',
  rawAmount = 0,
  blockedAmount = 0,
  poise = 100,
  maxPoise = 100,
  impactDirection = 0,
  airborne = false,
  dodgeInvulnerable = false,
} = {}) {
  const normalizedOutcome = ['hit', 'blocked', 'parried', 'dodged', 'miss', 'staggered', 'guard-break'].includes(outcome) ? outcome : 'miss';
  const reaction = resolvePlayerHitReaction(profileInput, { rawAmount, blockedAmount, poise, maxPoise });
  const impact = clamp(finite(impactDirection, 0), -Math.PI, Math.PI);
  const active = !airborne && !dodgeInvulnerable && ['hit', 'blocked', 'parried', 'staggered', 'guard-break'].includes(normalizedOutcome);
  const severity = normalizedOutcome === 'parried' ? 0.72 : normalizedOutcome === 'guard-break' ? 1 : clamp(reaction.staggerSeverity, 0, 1);
  const family = normalizedOutcome === 'dodged' || normalizedOutcome === 'miss' ? 'none' : normalizedOutcome === 'blocked' ? 'guard' : normalizedOutcome === 'parried' ? 'parry' : reaction.staggers || normalizedOutcome === 'staggered' || normalizedOutcome === 'guard-break' ? 'stagger' : 'hit';
  const duration = family === 'stagger' ? 0.42 : family === 'parry' ? 0.24 : family === 'guard' ? 0.16 : family === 'hit' ? 0.2 : 0;
  const feedbackTier = family === 'stagger' ? 'major' : family === 'parry' || family === 'guard' ? 'medium' : family === 'hit' ? 'minor' : 'none';
  const intentKey = [normalizedOutcome, family, active ? 'active' : 'suppressed', Math.round(severity * 1000), Math.round((impact + Math.PI) * 1000)].join('|');
  return freeze({
    version: 1,
    outcome: normalizedOutcome,
    active,
    family,
    feedbackTier,
    severity: Number(severity.toFixed(4)),
    durationSeconds: duration,
    impactDirection: Number(impact.toFixed(4)),
    poiseAfter: reaction.poiseAfter,
    staggered: reaction.staggers || normalizedOutcome === 'staggered' || normalizedOutcome === 'guard-break',
    hitStopSeconds: family === 'stagger' ? 0.12 : family === 'parry' ? 0.08 : family === 'hit' ? 0.05 : 0,
    cameraImpulse: Number((severity * (family === 'stagger' ? 0.24 : 0.1)).toFixed(4)),
    intentKey,
  });
}

export function isPlayerCombatReactionIntent(value) {
  return Boolean(value && value.version === 1 && typeof value.intentKey === 'string' && ['none', 'hit', 'guard', 'parry', 'stagger'].includes(value.family) && ['none', 'minor', 'medium', 'major'].includes(value.feedbackTier) && Object.isFrozen(value));
}

export default { resolvePlayerCombatReactionIntent, isPlayerCombatReactionIntent };
