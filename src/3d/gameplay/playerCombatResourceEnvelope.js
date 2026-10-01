/**
 * Bounded resource envelope over the existing player equipment/combat rules.
 *
 * This module does not own stamina/poise mutation, timers, animation or input.
 * It converts caller-owned resource state plus an already-resolved action into
 * a deterministic budget receipt for the existing player state machine.
 *
 * @module gameplay/playerCombatResourceEnvelope
 */

import {
  resolvePlayerEquipmentCombatProfile,
  resolvePlayerCombatEnvelope,
  resolvePlayerDefenseRules,
  resolvePlayerDodgeRules,
  resolvePlayerRangedRules,
} from './playerEquipmentCombatRules.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const normalizeAction = (value) => {
  const action = String(value ?? '').trim().toLowerCase();
  if (action === 'heavy' || action === 'strong' || action === 'charged') return 'heavy';
  if (action === 'block' || action === 'guard' || action === 'shield') return 'block';
  if (action === 'parry' || action === 'riposte') return 'parry';
  if (action === 'dodge' || action === 'roll' || action === 'evade') return 'dodge';
  if (action === 'ranged' || action === 'shoot' || action === 'throw') return 'ranged';
  if (action === 'archery' || action === 'bow') return 'archery';
  return 'light';
};

function resolveCost(profile, action, context) {
  if (action === 'light' || action === 'heavy') {
    return resolvePlayerCombatEnvelope(profile, { kind: action, staminaRatio: context.staminaRatio, poiseRatio: context.poiseRatio }).staminaCost;
  }
  if (action === 'dodge') return resolvePlayerDodgeRules(profile, context).staminaCost;
  if (action === 'block') return context.guardInput ? 4 : 0;
  if (action === 'parry') return context.parryWindowOpen ? 8 : 0;
  if (action === 'ranged' || action === 'archery') return Math.round(resolvePlayerRangedRules(profile, context).drawStaminaRatio * 100);
  return 0;
}

function resolveGate(profile, action, context) {
  const stamina = clamp(finite(context.staminaRatio, 1), 0, 1);
  const grounded = context.grounded !== false;
  const attackBusy = Boolean(context.attackBusy);
  const guardBreak = Boolean(context.guardBreak);
  const defense = resolvePlayerDefenseRules(profile, context);
  const dodge = resolvePlayerDodgeRules(profile, { ...context, staminaRatio: stamina, grounded, attackBusy, guardBreak });
  const ranged = resolvePlayerRangedRules(profile, { ...context, staminaRatio: stamina });
  if (action === 'block') return defense.guardAvailable;
  if (action === 'parry') return defense.parryAvailable;
  if (action === 'dodge') return dodge.canStart;
  if (action === 'ranged' || action === 'archery') return ranged.ranged && ranged.releaseQuality > 0.2;
  return grounded && !attackBusy && !guardBreak && stamina > 0;
}

export function resolvePlayerCombatResourceEnvelope(input = {}, {
  action = 'light',
  stamina = 100,
  maxStamina = 100,
  poise = 100,
  maxPoise = 100,
  staminaRegenPerSecond = 18,
  poiseRecoveryPerSecond = 12,
  deltaSeconds = 0,
  grounded = true,
  attackBusy = false,
  guardBreak = false,
  guardInput = false,
  parryWindowOpen = false,
  lockOn = false,
  moving = false,
} = {}) {
  const profile = input?.mainHand ? input : resolvePlayerEquipmentCombatProfile(input);
  const normalizedAction = normalizeAction(action);
  const boundedMaxStamina = Math.max(1, finite(maxStamina, 100));
  const boundedMaxPoise = Math.max(1, finite(maxPoise, 100));
  const staminaRatio = clamp(finite(stamina, boundedMaxStamina) / boundedMaxStamina, 0, 1);
  const poiseRatio = clamp(finite(poise, boundedMaxPoise) / boundedMaxPoise, 0, 1);
  const context = { staminaRatio, poiseRatio, grounded, attackBusy, guardBreak, guardInput, parryWindowOpen, lockOn, moving };
  const gateOpen = resolveGate(profile, normalizedAction, context);
  const rawCost = resolveCost(profile, normalizedAction, context);
  const staminaCost = clamp(rawCost, 0, boundedMaxStamina);
  const spent = gateOpen ? Math.min(Math.max(0, finite(stamina, boundedMaxStamina)), staminaCost) : 0;
  const dt = clamp(finite(deltaSeconds, 0), 0, 0.25);
  const regenBlocked = gateOpen && ['light', 'heavy', 'dodge', 'ranged', 'archery'].includes(normalizedAction);
  const nextStamina = clamp(finite(stamina, boundedMaxStamina) - spent + (regenBlocked ? 0 : Math.max(0, finite(staminaRegenPerSecond, 18)) * dt), 0, boundedMaxStamina);
  const nextPoise = clamp(finite(poise, boundedMaxPoise) + Math.max(0, finite(poiseRecoveryPerSecond, 12)) * dt, 0, boundedMaxPoise);
  const exhausted = nextStamina <= boundedMaxStamina * 0.05;
  const staggered = nextPoise <= 0;
  return Object.freeze({
    action: normalizedAction,
    accepted: gateOpen && spent >= staminaCost,
    gateOpen,
    stamina: Object.freeze({
      current: Number(clamp(finite(stamina, boundedMaxStamina), 0, boundedMaxStamina).toFixed(4)),
      max: Number(boundedMaxStamina.toFixed(4)),
      cost: Number(staminaCost.toFixed(4)),
      spent: Number(spent.toFixed(4)),
      next: Number(nextStamina.toFixed(4)),
      ratio: Number((nextStamina / boundedMaxStamina).toFixed(6)),
      exhausted,
      regenBlocked,
    }),
    poise: Object.freeze({
      current: Number(clamp(finite(poise, boundedMaxPoise), 0, boundedMaxPoise).toFixed(4)),
      max: Number(boundedMaxPoise.toFixed(4)),
      next: Number(nextPoise.toFixed(4)),
      ratio: Number((nextPoise / boundedMaxPoise).toFixed(6)),
      staggered,
    }),
    context: Object.freeze({ grounded: Boolean(grounded), attackBusy, guardBreak, guardInput, parryWindowOpen, lockOn, moving }),
  });
}

export function validatePlayerCombatResourceEnvelope(input = {}, options = {}) {
  const envelope = resolvePlayerCombatResourceEnvelope(input, options);
  const errors = [];
  if (envelope.stamina.next < 0 || envelope.stamina.next > envelope.stamina.max) errors.push('stamina-out-of-bounds');
  if (envelope.poise.next < 0 || envelope.poise.next > envelope.poise.max) errors.push('poise-out-of-bounds');
  if (envelope.accepted && envelope.stamina.spent < envelope.stamina.cost) errors.push('accepted-without-full-cost');
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors), envelope });
}
