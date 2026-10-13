/**
 * Deterministic presentation intent for player combat stance consumers.
 * Existing player state/combat rules remain authoritative for mutation.
 */
// @ts-nocheck

import {
  resolvePlayerDefenseRules,
  resolvePlayerDodgeRules,
  resolvePlayerRangedRules,
  resolvePlayerCombatEnvelope,
  buildPlayerHitboxHurtboxContract,
} from './playerEquipmentCombatRules.ts';

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value)));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) freeze(value[key]);
  return Object.freeze(value);
};

export function resolvePlayerCombatStanceIntent(profileInput = {}, options = {}) {
  const {
    stance = 'neutral',
    attackKind = 'light',
    staminaRatio = 1,
    poiseRatio = 1,
    grounded = true,
    guardInput = false,
    parryWindowOpen = false,
    dodgeInvulnerable = false,
    attackBusy = false,
    guardBreak = false,
    lockOn = false,
    moving = false,
    crouching = false,
  } = options;
  const normalizedStance = ['neutral', 'guard', 'parry', 'dodge', 'attack', 'ranged'].includes(stance) ? stance : 'neutral';
  const defense = resolvePlayerDefenseRules(profileInput, { staminaRatio, poiseRatio, guardInput, parryWindowOpen, dodgeInvulnerable });
  const dodge = resolvePlayerDodgeRules(profileInput, { staminaRatio, grounded, attackBusy, guardBreak });
  const ranged = resolvePlayerRangedRules(profileInput, { staminaRatio, lockOn, moving });
  const envelope = resolvePlayerCombatEnvelope(profileInput, { kind: attackKind, staminaRatio, poiseRatio });
  const contact = buildPlayerHitboxHurtboxContract(profileInput, { grounded, crouching, attackKind, stance: normalizedStance });
  const canGuard = normalizedStance === 'guard' && defense.guardAvailable;
  const canParry = normalizedStance === 'parry' && defense.parryAvailable;
  const canDodge = normalizedStance === 'dodge' && dodge.canStart;
  const canAttack = normalizedStance === 'attack' && !envelope.exhausted && grounded && !attackBusy;
  const canAim = normalizedStance === 'ranged' && ranged.ranged && grounded;
  const active = canParry || canDodge || canAttack || canAim || canGuard;
  const intensity = clamp(
    canParry ? 1 : canDodge ? 0.82 : canAttack ? (attackKind === 'heavy' ? 0.92 : 0.68) : canAim ? ranged.releaseQuality : canGuard ? 0.38 : 0.08,
    0,
    1,
  );
  const key = [
    normalizedStance,
    attackKind === 'heavy' ? 'heavy' : 'light',
    Number(clamp(staminaRatio, 0, 1).toFixed(3)),
    Number(clamp(poiseRatio, 0, 1).toFixed(3)),
    grounded ? 'grounded' : 'airborne',
    active ? 'active' : 'inactive',
    Number(intensity.toFixed(3)),
  ].join('|');
  return freeze({
    version: 1,
    stance: normalizedStance,
    attackKind: attackKind === 'heavy' ? 'heavy' : 'light',
    active,
    intensity: Number(intensity.toFixed(4)),
    staminaRatio: clamp(staminaRatio, 0, 1),
    poiseRatio: clamp(poiseRatio, 0, 1),
    grounded: Boolean(grounded),
    decisions: freeze({ canGuard, canParry, canDodge, canAttack, canAim }),
    defense,
    dodge,
    ranged,
    envelope,
    contact,
    stanceKey: key,
  });
}

export function isPlayerCombatStanceIntent(value) {
  try {
    if (!value || value.version !== 1 || typeof value.stanceKey !== 'string') return false;
    if (!Object.isFrozen(value) || !Object.isFrozen(value.decisions)) return false;
    if (!['neutral', 'guard', 'parry', 'dodge', 'attack', 'ranged'].includes(value.stance)) return false;
    if (!Number.isFinite(value.intensity) || value.intensity < 0 || value.intensity > 1) return false;
    const expected = [
      value.stance,
      value.attackKind,
      Number(clamp(value.staminaRatio, 0, 1).toFixed(3)),
      Number(clamp(value.poiseRatio, 0, 1).toFixed(3)),
      value.grounded ? 'grounded' : 'airborne',
      value.active ? 'active' : 'inactive',
      Number(value.intensity.toFixed(3)),
    ].join('|');
    return expected === value.stanceKey;
  } catch {
    return false;
  }
}
