/**
 * Produces a deterministic presentation/combat stance receipt from the existing
 * equipment/combat rules. The caller-owned player state machine remains the
 * authority for mutation, timers, input, AnimationMixer and scene objects.
 *
 * @module gameplay/playerCombatStanceDirector
 */

import {
  resolvePlayerDefenseRules,
  resolvePlayerDodgeRules,
  resolvePlayerRangedRules,
  resolvePlayerCombatEnvelope,
} from './playerEquipmentCombatRules.js';
import {
  resolvePlayerEquipmentCombatProfile,
  resolvePlayerAnimationPlan,
} from './playerEquipmentCombatProfile.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const freeze = (value) => Object.freeze(value);

const normalizeMotion = (value) => {
  const key = String(value ?? 'idle').trim().toLowerCase();
  if (key === 'sprint' || key === 'run') return 'run';
  if (key === 'walk') return 'walk';
  if (key === 'dodge' || key === 'evade') return 'dodge';
  return 'idle';
};

const normalizeAttack = (value) => {
  const key = String(value ?? 'none').trim().toLowerCase();
  if (key === 'heavy' || key === 'charged') return 'heavy';
  if (key === 'ranged' || key === 'bow' || key === 'archery') return 'ranged';
  if (key === 'light' || key === 'attack') return 'light';
  return 'none';
};

const stanceFor = ({ attackKind, guard, parry, dodge, ranged }) => {
  if (dodge) return 'evade';
  if (parry) return 'parry';
  if (guard) return 'guard';
  if (attackKind === 'heavy') return 'heavy-attack';
  if (attackKind === 'ranged' || ranged) return 'ranged-aim';
  if (attackKind === 'light') return 'light-attack';
  return 'neutral';
};

export function resolvePlayerCombatStance(input = {}, options = {}) {
  const profile = input?.mainHand ? input : resolvePlayerEquipmentCombatProfile(input?.equipment || input);
  const staminaRatio = clamp(finite(options.staminaRatio ?? input.staminaRatio, 1), 0, 1);
  const poiseRatio = clamp(finite(options.poiseRatio ?? input.poiseRatio, 1), 0, 1);
  const motionState = normalizeMotion(options.motionState ?? input.motionState);
  const attackKind = normalizeAttack(options.attackKind ?? input.attackKind);
  const guardInput = Boolean(options.guardInput ?? input.guardInput);
  const parryWindowOpen = Boolean(options.parryWindowOpen ?? input.parryWindowOpen);
  const dodgeInput = Boolean(options.dodgeInput ?? input.dodgeInput);
  const grounded = options.grounded !== false && input.grounded !== false;
  const moving = options.moving ?? input.moving ?? motionState !== 'idle';
  const lockOn = Boolean(options.lockOn ?? input.lockOn);
  const attackBusy = Boolean(options.attackBusy ?? input.attackBusy);
  const guardBreak = Boolean(options.guardBreak ?? input.guardBreak);

  const defense = resolvePlayerDefenseRules(profile, {
    staminaRatio,
    poiseRatio,
    guardInput,
    parryWindowOpen,
    dodgeInvulnerable: Boolean(options.dodgeInvulnerable ?? input.dodgeInvulnerable),
  });
  const dodge = resolvePlayerDodgeRules(profile, {
    staminaRatio,
    grounded,
    attackBusy,
    guardBreak,
  });
  const ranged = resolvePlayerRangedRules(profile, {
    staminaRatio,
    lockOn,
    moving,
  });
  const attack = attackKind === 'none'
    ? freeze({ accepted: false, kind: 'none', staminaCost: 0, activeStart: 0, activeEnd: 0, duration: 0, reach: 0 })
    : resolvePlayerCombatEnvelope(profile, { kind: attackKind === 'ranged' ? 'light' : attackKind, staminaRatio, poiseRatio });
  const dodgeAccepted = dodgeInput && dodge.canStart;
  const guardAccepted = defense.guardAvailable && !dodgeAccepted && attackKind === 'none';
  const parryAccepted = defense.parryAvailable && guardAccepted;
  const attackAccepted = !dodgeAccepted && !guardAccepted && attackKind !== 'none' && !attackBusy && grounded && staminaRatio > 0;
  const acceptedKind = dodgeAccepted ? 'dodge' : parryAccepted ? 'parry' : guardAccepted ? 'guard' : attackAccepted ? attackKind : 'none';
  const stance = stanceFor({
    attackKind: acceptedKind,
    guard: guardAccepted,
    parry: parryAccepted,
    dodge: dodgeAccepted,
    ranged: ranged.ranged && acceptedKind === 'none',
  });
  const animation = resolvePlayerAnimationPlan(profile, {
    movementState: stance === 'neutral' ? motionState : stance,
    attackKind: acceptedKind === 'dodge' || acceptedKind === 'parry' || acceptedKind === 'guard' ? 'none' : acceptedKind,
    comboStep: clamp(finite(options.comboStep ?? input.comboStep, 0), 0, 4),
    speedMps: clamp(finite(options.speedMps ?? input.speedMps, 0), 0, 12),
    grounded,
  });
  const staminaCost = acceptedKind === 'dodge'
    ? dodge.staminaCost
    : acceptedKind === 'guard' || acceptedKind === 'parry'
      ? 0
      : acceptedKind === 'none'
        ? 0
        : attack.staminaCost;

  return freeze({
    version: 1,
    accepted: acceptedKind !== 'none',
    acceptedKind,
    stance,
    motionState,
    grounded,
    moving: Boolean(moving),
    lockOn,
    staminaRatio,
    poiseRatio,
    staminaCost: clamp(finite(staminaCost, 0), 0, 100),
    defense,
    dodge: freeze({ ...dodge, accepted: dodgeAccepted }),
    ranged,
    attack,
    animation,
    ownership: freeze({
      mutationOwner: 'player-state-machine',
      mixerOwner: 'player-animation-runtime',
      sceneOwner: 'player-scene-runtime',
      materialOwner: 'MaterialAssignmentCore',
    }),
  });
}

export function validatePlayerCombatStance(receipt = {}) {
  const errors = [];
  if (receipt.version !== 1) errors.push('version');
  if (!['none', 'dodge', 'guard', 'parry', 'light', 'heavy', 'ranged'].includes(receipt.acceptedKind)) errors.push('accepted-kind');
  if (!['neutral', 'evade', 'guard', 'parry', 'light-attack', 'heavy-attack', 'ranged-aim'].includes(receipt.stance)) errors.push('stance');
  if (!Number.isFinite(receipt.staminaCost) || receipt.staminaCost < 0 || receipt.staminaCost > 100) errors.push('stamina-cost');
  if (receipt.accepted !== (receipt.acceptedKind !== 'none')) errors.push('accepted-mismatch');
  return freeze({ ok: errors.length === 0, errors: freeze(errors) });
}
