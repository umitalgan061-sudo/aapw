/**
 * Deterministic defense reaction projection over the existing equipment/combat rules.
 *
 * The shipped player state machine remains authoritative for input, timers, animation,
 * damage and scene mutation. This module only resolves a bounded reaction outcome from
 * caller-owned attack/defense observations.
 */

import { resolvePlayerEquipmentCombatProfile, resolvePlayerDefenseRules } from './playerEquipmentCombatProfile.js';

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));
const bool = (value) => value === true;
const stable = (value) => JSON.stringify(value, Object.keys(value).sort());

const OUTCOMES = Object.freeze(['miss', 'blocked', 'parried', 'hit', 'guard-break', 'dodged']);

export function resolvePlayerDefenseReactionWindow(profileInput = {}, options = {}) {
  const profile = profileInput?.mainHand ? profileInput : resolvePlayerEquipmentCombatProfile(profileInput);
  const {
    incoming = {},
    defense = {},
    nowSeconds = 0,
    reactionWindowSeconds = 0.22,
    parryWindowSeconds = 0.1,
  } = options;

  const now = Math.max(0, finite(nowSeconds, 0));
  const attackTime = Math.max(0, finite(incoming.impactTimeSeconds, now));
  const delta = now - attackTime;
  const withinReaction = delta >= -0.03 && delta <= clamp(reactionWindowSeconds, 0.05, 0.6);
  const withinParry = delta >= -0.03 && delta <= clamp(parryWindowSeconds, 0.04, 0.3);
  const distance = Math.max(0, finite(incoming.distanceMeters, 999));
  const reach = clamp(finite(incoming.reachMeters, profile.mainHand.reachMultiplier * 1.65), 0.5, 8);
  const inRange = distance <= reach;
  const attackActive = bool(incoming.active) && inRange;
  const staminaRatio = clamp(defense.staminaRatio, 0, 1);
  const poiseRatio = clamp(defense.poiseRatio, 0, 1);
  const dodgeActive = bool(defense.dodgeInvulnerable);
  const guardInput = bool(defense.guardInput);
  const parryInput = bool(defense.parryInput);
  const rules = resolvePlayerDefenseRules(profile, {
    staminaRatio,
    poiseRatio,
    guardInput,
    parryWindowOpen: withinParry,
    dodgeInvulnerable: dodgeActive,
  });

  let outcome = 'miss';
  let reason = 'inactive-or-out-of-range';
  if (attackActive && dodgeActive) {
    outcome = 'dodged';
    reason = 'dodge-invulnerable';
  } else if (attackActive && parryInput && rules.parryAvailable && withinParry) {
    outcome = 'parried';
    reason = 'parry-window';
  } else if (attackActive && guardInput && rules.guardAvailable && withinReaction) {
    outcome = poiseRatio <= 0.12 ? 'guard-break' : 'blocked';
    reason = outcome === 'guard-break' ? 'poise-depleted' : 'guard-window';
  } else if (attackActive) {
    outcome = 'hit';
    reason = withinReaction ? 'defense-missed' : 'reaction-window-expired';
  }

  const impactScale = clamp(finite(incoming.damageScale, 1), 0.1, 6);
  const damageMultiplier = outcome === 'parried' || outcome === 'dodged'
    ? 0
    : outcome === 'blocked'
      ? rules.guardDamageMultiplier
      : outcome === 'guard-break'
        ? 1.15
        : outcome === 'hit'
          ? impactScale
          : 0;

  const result = {
    outcome,
    reason,
    timestampSeconds: Number(now.toFixed(4)),
    impactAgeSeconds: Number(delta.toFixed(4)),
    withinReactionWindow: withinReaction,
    withinParryWindow: withinParry,
    attackActive,
    inRange,
    damageMultiplier: Number(clamp(damageMultiplier, 0, 6).toFixed(4)),
    staminaCostMultiplier: Number(rules.staminaCostMultiplier.toFixed(4)),
    poiseRatio,
    accepted: OUTCOMES.includes(outcome) && outcome !== 'miss',
  };
  return Object.freeze(result);
}

export function validatePlayerDefenseReactionWindow(input = {}) {
  const profile = input.equipment?.mainHand ? input.equipment : resolvePlayerEquipmentCombatProfile(input.equipment || input);
  const result = resolvePlayerDefenseReactionWindow(profile, input);
  const errors = [];
  if (!OUTCOMES.includes(result.outcome)) errors.push('unknown-outcome');
  if (result.damageMultiplier < 0) errors.push('negative-damage-multiplier');
  if (result.impactAgeSeconds < -0.03) errors.push('future-impact-outside-tolerance');
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors), result, digest: stable(result) });
}
