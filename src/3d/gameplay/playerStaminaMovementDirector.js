/**
 * Deterministic stamina + locomotion policy for the shipped player runtime.
 *
 * This module is a pure adapter over caller-owned movement/state data. It does not
 * mutate stamina, transforms, input devices, animation mixers, timers, camera or scene.
 * The existing player state machine remains authoritative for execution.
 *
 * @module gameplay/playerStaminaMovementDirector
 */

import { resolvePlayerEquipmentCombatProfile, resolvePlayerDodgeRules } from './playerEquipmentCombatProfile.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const freezeDeep = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
};
const normalizeState = (value) => ['idle', 'walk', 'run', 'sprint', 'dodge', 'airborne', 'fall', 'land'].includes(value) ? value : 'idle';

const STATE_COSTS = freezeDeep({
  idle: { drainPerSecond: 0, regenPerSecond: 0.22, speedMultiplier: 0 },
  walk: { drainPerSecond: 0.02, regenPerSecond: 0.18, speedMultiplier: 0.42 },
  run: { drainPerSecond: 0.12, regenPerSecond: 0.08, speedMultiplier: 0.72 },
  sprint: { drainPerSecond: 0.34, regenPerSecond: 0.02, speedMultiplier: 1 },
  dodge: { drainPerSecond: 0, regenPerSecond: 0, speedMultiplier: 1.08 },
  airborne: { drainPerSecond: 0, regenPerSecond: 0.01, speedMultiplier: 0 },
  fall: { drainPerSecond: 0, regenPerSecond: 0.01, speedMultiplier: 0 },
  land: { drainPerSecond: 0.05, regenPerSecond: 0.04, speedMultiplier: 0.2 },
});

export function resolvePlayerStaminaMovement(profileInput = {}, {
  state = 'idle',
  staminaRatio = 1,
  deltaSeconds = 0,
  grounded = true,
  inputMagnitude = 0,
  requestedSprint = false,
  attackBusy = false,
  guardActive = false,
  dodgeRequested = false,
  speedMps = 0,
  maxSpeedMps = 5.2,
} = {}) {
  const profile = profileInput?.mainHand ? profileInput : resolvePlayerEquipmentCombatProfile(profileInput);
  const requestedState = normalizeState(state);
  const dt = clamp(finite(deltaSeconds, 0), 0, 0.25);
  const stamina = clamp(finite(staminaRatio, 1), 0, 1);
  const magnitude = clamp(finite(inputMagnitude, 0), 0, 1);
  const speed = Math.max(0, finite(speedMps, 0));
  const maxSpeed = Math.max(0.1, finite(maxSpeedMps, 5.2));
  const dodge = resolvePlayerDodgeRules(profile, { staminaRatio: stamina, grounded, attackBusy, guardBreak: false });
  const sprintEligible = Boolean(grounded) && !attackBusy && !guardActive && stamina >= 0.18 && magnitude >= 0.55;
  const sprinting = Boolean(requestedSprint) && sprintEligible;
  const effectiveState = dodgeRequested && dodge.canStart ? 'dodge' : sprinting ? 'sprint' : requestedState;
  const cost = STATE_COSTS[effectiveState];
  const armorRegen = clamp(profile.armor.staminaRegenMultiplier, 0.65, 1.4);
  const armorDrain = clamp(profile.armor.staminaDrainMultiplier, 0.65, 1.9);
  const drain = cost.drainPerSecond * armorDrain * dt;
  const regen = cost.regenPerSecond * armorRegen * dt;
  const nextStaminaRatio = clamp(stamina - drain + (effectiveState === 'idle' || effectiveState === 'walk' ? regen : 0), 0, 1);
  const exhausted = nextStaminaRatio <= 0.001;
  const movementMultiplier = clamp(profile.armor.movementMultiplier, 0.6, 1.08);
  const targetSpeedMps = clamp(maxSpeed * cost.speedMultiplier * movementMultiplier * magnitude, 0, maxSpeed * 1.1);
  const speedRatio = clamp(speed / maxSpeed, 0, 1.25);
  const locomotion = Object.freeze({
    state: effectiveState,
    grounded: Boolean(grounded),
    targetSpeedMps: Number(targetSpeedMps.toFixed(4)),
    currentSpeedRatio: Number(speedRatio.toFixed(4)),
    movementMultiplier: Number(movementMultiplier.toFixed(4)),
    sprintEligible,
    sprinting,
    dodgeEligible: dodge.canStart,
    animationFamily: profile.armor.animationFamily,
  });
  return freezeDeep({
    version: 1,
    requestedState,
    effectiveState,
    deltaSeconds: dt,
    staminaRatio: stamina,
    nextStaminaRatio: Number(nextStaminaRatio.toFixed(6)),
    staminaDrain: Number(drain.toFixed(6)),
    staminaRegen: Number((effectiveState === 'idle' || effectiveState === 'walk' ? regen : 0).toFixed(6)),
    exhausted,
    guardSuppressedSprint: Boolean(guardActive),
    attackSuppressedSprint: Boolean(attackBusy),
    locomotion,
  });
}

export function validatePlayerStaminaMovementReceipt(receipt = {}) {
  const errors = [];
  if (receipt.version !== 1) errors.push('unsupported-version');
  if (!Number.isFinite(receipt.nextStaminaRatio) || receipt.nextStaminaRatio < 0 || receipt.nextStaminaRatio > 1) errors.push('invalid-next-stamina');
  if (!receipt.locomotion || !Number.isFinite(receipt.locomotion.targetSpeedMps) || receipt.locomotion.targetSpeedMps < 0) errors.push('invalid-locomotion');
  if (receipt.staminaDrain < 0 || receipt.staminaRegen < 0) errors.push('negative-resource-delta');
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}
