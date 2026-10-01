/**
 * Deterministic execution plan over existing player combat rules.
 *
 * This module is intentionally a composition adapter: the shipped player state machine,
 * input router, hit detection, damage, animation mixer and equipment owners remain authoritative.
 * Consumers use the returned plan to apply one already-validated action for the current frame.
 */

import {
  resolvePlayerDefenseRules,
  resolvePlayerDodgeRules,
  resolvePlayerRangedRules,
  resolvePlayerCombatEnvelope,
  resolvePlayerLockOnRules,
  validatePlayerEquipmentRuntimeInput,
} from './playerEquipmentCombatRules.js';

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const finite = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const freeze = (value) => Object.freeze(value);
const normalizeAction = (value) => {
  const action = String(value || '').toLowerCase();
  if (action === 'guard') return 'block';
  if (action === 'attack' || action === 'melee') return 'light';
  return ['light', 'heavy', 'block', 'parry', 'dodge', 'ranged', 'archery'].includes(action) ? action : 'idle';
};

const costs = Object.freeze({ light: 12, heavy: 24, block: 0, parry: 8, dodge: 28, ranged: 9, archery: 9, idle: 0 });

export function resolvePlayerCombatActionExecutionPlan(profileInput = {}, {
  action = 'idle',
  staminaRatio = 1,
  poiseRatio = 1,
  grounded = true,
  attackBusy = false,
  guardBreak = false,
  lockOn = false,
  targetDistanceMeters = Infinity,
  targetAngleRad = Math.PI,
  targetAlive = true,
  targetVisible = true,
  targetPriority = 0,
  currentLocked = false,
  targetMovesAway = false,
  parryWindowOpen = false,
  dodgeInvulnerable = false,
  moving = false,
  comboStep = 0,
} = {}) {
  const normalizedAction = normalizeAction(action);
  const input = {
    equipment: profileInput,
    kind: normalizedAction === 'archery' || normalizedAction === 'ranged' ? 'light' : normalizedAction,
    staminaRatio,
    poiseRatio,
    grounded,
    attackBusy,
    guardBreak,
    lockOn,
    moving,
  };
  const validation = validatePlayerEquipmentRuntimeInput(input);
  const profile = validation.profile;
  const stamina = clamp(finite(staminaRatio, 1), 0, 1);
  const defense = resolvePlayerDefenseRules(profile, { staminaRatio: stamina, poiseRatio, guardInput: normalizedAction === 'block' || normalizedAction === 'parry', parryWindowOpen, dodgeInvulnerable });
  const dodge = resolvePlayerDodgeRules(profile, { staminaRatio: stamina, grounded, attackBusy, guardBreak });
  const ranged = resolvePlayerRangedRules(profile, { staminaRatio: stamina, lockOn, moving });
  const combat = ['light', 'heavy'].includes(normalizedAction) ? resolvePlayerCombatEnvelope(profile, { kind: normalizedAction, staminaRatio: stamina, poiseRatio }) : null;
  const target = lockOn ? resolvePlayerLockOnRules(profile, { targetDistanceMeters, targetAngleRad, targetAlive, targetVisible, targetPriority, currentLocked, targetMovesAway }) : null;
  let allowed = validation.ok;
  const reasons = [...validation.errors];
  if (normalizedAction === 'block' && !defense.guardAvailable) { allowed = false; reasons.push('guard-unavailable'); }
  if (normalizedAction === 'parry' && !defense.parryAvailable) { allowed = false; reasons.push('parry-window-closed'); }
  if (normalizedAction === 'dodge' && !dodge.canStart) { allowed = false; reasons.push('dodge-unavailable'); }
  if (['light', 'heavy'].includes(normalizedAction) && (!combat || combat.exhausted || attackBusy)) { allowed = false; reasons.push(combat?.exhausted ? 'stamina-exhausted' : 'attack-busy'); }
  if (['ranged', 'archery'].includes(normalizedAction) && (!ranged.ranged || stamina <= 0.18)) { allowed = false; reasons.push(ranged.ranged ? 'ranged-stamina-low' : 'ranged-profile-required'); }
  if (lockOn && target && !target.eligible && ['light', 'heavy', 'ranged', 'archery'].includes(normalizedAction)) { allowed = false; reasons.push('target-ineligible'); }
  const cost = allowed ? costs[normalizedAction] : 0;
  const nextStaminaRatio = clamp(stamina - cost / 100, 0, 1);
  const execution = normalizedAction === 'idle' ? 'none' : normalizedAction === 'block' || normalizedAction === 'parry' ? 'defense' : normalizedAction === 'dodge' ? 'evade' : normalizedAction === 'ranged' || normalizedAction === 'archery' ? 'projectile' : 'melee';
  return freeze({
    version: 1,
    action: normalizedAction,
    execution,
    allowed,
    reasons: freeze([...new Set(reasons)]),
    staminaCost: cost,
    staminaRatio: stamina,
    nextStaminaRatio,
    comboStep: clamp(Math.trunc(finite(comboStep, 0)), 0, 4),
    defense,
    dodge,
    ranged,
    combat,
    target,
    audit: freeze({
      owner: 'player-state-machine',
      appliesMutation: false,
      requiresGroundedContact: normalizedAction === 'dodge' || normalizedAction === 'light' || normalizedAction === 'heavy',
      requiresTarget: ['light', 'heavy', 'ranged', 'archery'].includes(normalizedAction),
    }),
  });
}

export function validatePlayerCombatActionExecutionPlan(plan) {
  const errors = [];
  if (!plan || plan.version !== 1) errors.push('invalid-plan');
  if (!plan?.allowed && plan?.staminaCost !== 0) errors.push('rejected-plan-cost');
  if (plan?.nextStaminaRatio < 0 || plan?.nextStaminaRatio > 1) errors.push('stamina-out-of-range');
  if (plan?.audit?.appliesMutation !== false) errors.push('mutation-owner-violation');
  if (plan?.audit?.requiresTarget && plan?.allowed && !plan.target && ['light', 'heavy', 'ranged', 'archery'].includes(plan.action)) errors.push('missing-target-receipt');
  return freeze({ ok: errors.length === 0, errors: freeze(errors) });
}
