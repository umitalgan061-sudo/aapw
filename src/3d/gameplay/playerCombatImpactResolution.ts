/** Pure impact projection over the existing player equipment/combat rules. */
import {
  resolvePlayerCombatEnvelope,
  resolvePlayerDefenseRules,
  resolvePlayerHitReaction,
} from './playerEquipmentCombatRules.ts';

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : min));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const normalizeKind = (value) => value === 'heavy' ? 'heavy' : 'light';
const freeze = (value) => Object.freeze(value);

export function resolvePlayerCombatImpactResolution(profileInput = {}, {
  kind = 'light',
  staminaRatio = 1,
  poiseRatio = 1,
  target = {},
  incoming = {},
  guardInput = false,
  parryWindowOpen = false,
  dodgeInvulnerable = false,
} = {}) {
  const attackKind = normalizeKind(kind);
  const envelope = resolvePlayerCombatEnvelope(profileInput, { kind: attackKind, staminaRatio, poiseRatio });
  const defense = resolvePlayerDefenseRules(profileInput, {
    staminaRatio,
    poiseRatio,
    guardInput,
    parryWindowOpen,
    dodgeInvulnerable,
  });
  const targetAlive = target?.alive !== false;
  const targetInRange = Boolean(target?.inRange ?? true);
  const targetInArc = Boolean(target?.inArc ?? true);
  const targetGuarding = Boolean(target?.guarding);
  const incomingAmount = Math.max(0, finite(incoming?.rawAmount, 0));
  const incomingBlocked = targetGuarding && !defense.parryAvailable ? incomingAmount : 0;
  const contact = envelope.staminaRatio > 0 && targetAlive && targetInRange && targetInArc;
  const outcome = !contact
    ? 'miss'
    : defense.parryAvailable && Boolean(incoming?.parryable)
      ? 'parried'
      : targetGuarding
        ? 'blocked'
        : 'hit';
  const rawDamage = contact && outcome === 'hit'
    ? clamp(envelope.damageScaleAtCurrentStamina * 10, 0, 60)
    : 0;
  const blockedDamage = outcome === 'blocked' ? clamp(rawDamage * defense.guardDamageMultiplier, 0, rawDamage) : 0;
  const reaction = resolvePlayerHitReaction(profileInput, {
    rawAmount: incomingAmount,
    blockedAmount: incomingBlocked,
    poise: finite(target?.poise, 100),
    maxPoise: finite(target?.maxPoise, 100),
  });
  const impactKey = [attackKind, outcome, Number(rawDamage.toFixed(3)), Number(blockedDamage.toFixed(3)), reaction.staggers ? 'stagger' : 'stable'].join('|');
  return freeze({
    version: 1,
    kind: attackKind,
    outcome,
    contact,
    rawDamage: Number(rawDamage.toFixed(3)),
    blockedDamage: Number(blockedDamage.toFixed(3)),
    poiseDamage: Number(reaction.effectiveImpact.toFixed(3)),
    staggered: Boolean(reaction.staggers && outcome === 'hit'),
    guardBreakRisk: Number(defense.guardBreakRisk.toFixed(4)),
    impactKey,
  });
}

export function isPlayerCombatImpactResolution(value) {
  return Boolean(value && value.version === 1 && ['miss', 'parried', 'blocked', 'hit'].includes(value.outcome)
    && typeof value.impactKey === 'string' && Object.isFrozen(value));
}
