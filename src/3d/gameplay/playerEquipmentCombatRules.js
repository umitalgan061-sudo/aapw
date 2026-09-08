/**
 * Stateless secondary rules for the shipped equipment/combat profile.
 *
 * This module complements `playerEquipmentCombatProfile.js`; it is not a new combat framework.
 * The existing player state machine remains the only authority for timers and state mutation.
 * These helpers answer bounded questions about defense, dodge, ranged release, loadout deltas,
 * animation transition compatibility, lock-on eligibility and hitbox/hurtbox descriptors from
 * already-resolved gameplay state.
 *
 * @module gameplay/playerEquipmentCombatRules
 */

import { resolvePlayerEquipmentCombatProfile, resolvePlayerAttackTuning, resolvePlayerAnimationPlan } from './playerEquipmentCombatProfile.js';

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const finite = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const normalizeKind = (v) => v === 'heavy' ? 'heavy' : 'light';
const unique = (items) => [...new Set(items.filter(Boolean))];

export function resolvePlayerDefenseRules(profileInput = {}, {
  staminaRatio = 1,
  poiseRatio = 1,
  guardInput = false,
  parryWindowOpen = false,
  dodgeInvulnerable = false,
} = {}) {
  const profile = profileInput?.mainHand ? profileInput : resolvePlayerEquipmentCombatProfile(profileInput);
  const stamina = clamp(finite(staminaRatio, 1), 0, 1);
  const poise = clamp(finite(poiseRatio, 1), 0, 1);
  const guardAvailable = Boolean(guardInput) && stamina > 0 && !dodgeInvulnerable;
  const parryAvailable = guardAvailable && Boolean(parryWindowOpen) && stamina >= 0.08;
  const shieldFactor = profile.shieldEquipped ? 0.82 : 1;
  return Object.freeze({
    guardAvailable,
    parryAvailable,
    dodgeInvulnerable: Boolean(dodgeInvulnerable),
    staminaRatio: stamina,
    poiseRatio: poise,
    staminaCostMultiplier: clamp(profile.armor.staminaDrainMultiplier * shieldFactor, 0.35, 2),
    guardDamageMultiplier: clamp(profile.effectiveGuardMultiplier, 0.25, 1.2),
    poiseDamageMultiplier: clamp(profile.mainHand.poiseMultiplier, 0.1, 3),
    guardBreakRisk: clamp((1 - stamina) * 0.55 + (1 - poise) * 0.45, 0, 1),
  });
}

export function resolvePlayerDodgeRules(profileInput = {}, { staminaRatio = 1, grounded = true, attackBusy = false, guardBreak = false } = {}) {
  const profile = profileInput?.mainHand ? profileInput : resolvePlayerEquipmentCombatProfile(profileInput);
  const stamina = clamp(finite(staminaRatio, 1), 0, 1);
  const canStart = Boolean(grounded) && !attackBusy && !guardBreak && stamina >= 0.28;
  const distanceMultiplier = clamp(profile.armor.dodgeDistanceMultiplier, 0.6, 1.1);
  return Object.freeze({
    canStart,
    staminaCost: 28,
    distanceMultiplier,
    iframeWindow: Object.freeze({ start: 0.06, end: 0.28, duration: 0.22 }),
    cooldownSeconds: 0.6,
    speedMultiplier: clamp(1 + (distanceMultiplier - 1) * 0.65, 0.75, 1.08),
  });
}

export function resolvePlayerRangedRules(profileInput = {}, { staminaRatio = 1, lockOn = false, moving = false } = {}) {
  const profile = profileInput?.mainHand ? profileInput : resolvePlayerEquipmentCombatProfile(profileInput);
  const stamina = clamp(finite(staminaRatio, 1), 0, 1);
  const ranged = Boolean(profile.ranged);
  const stableAim = ranged && stamina > 0.18 && !moving;
  const lockOnAssist = ranged && Boolean(lockOn);
  const releaseQuality = clamp((stableAim ? 0.72 : ranged ? 0.54 : 0) + (lockOnAssist ? 0.08 : 0) + stamina * 0.2, 0, 1);
  return Object.freeze({
    ranged,
    projectile: ranged,
    twoHanded: Boolean(profile.twoHanded),
    stableAim,
    lockOnAssist,
    releaseQuality,
    drawStaminaRatio: ranged ? clamp(0.05 + (1 - stamina) * 0.06, 0.05, 0.11) : 0,
    preferredSocket: ranged ? 'back' : null,
  });
}

export function resolvePlayerCombatEnvelope(profileInput = {}, { kind = 'light', staminaRatio = 1, poiseRatio = 1 } = {}) {
  const profile = profileInput?.mainHand ? profileInput : resolvePlayerEquipmentCombatProfile(profileInput);
  const attackKind = normalizeKind(kind);
  const base = attackKind === 'heavy'
    ? { staminaCost: 24, duration: 0.72, activeStart: 0.28, activeEnd: 0.46, reach: 2.05, damageScale: 1.65, commitMeters: 0.9 }
    : { staminaCost: 12, duration: 0.44, activeStart: 0.14, activeEnd: 0.26, reach: 1.65, damageScale: 1, commitMeters: 0.58 };
  const tuning = resolvePlayerAttackTuning(base, profile, attackKind);
  const stamina = clamp(finite(staminaRatio, 1), 0, 1);
  const poise = clamp(finite(poiseRatio, 1), 0, 1);
  return Object.freeze({
    ...tuning,
    staminaRatio: stamina,
    poiseRatio: poise,
    damageScaleAtCurrentStamina: clamp(tuning.damageScale * (0.84 + stamina * 0.16), 0.1, 6),
    staggerPressure: clamp(tuning.poiseMultiplier * (0.65 + poise * 0.35), 0.1, 3),
    exhausted: stamina <= 0,
    vulnerable: poise <= 0,
  });
}

export function comparePlayerEquipmentProfiles(previousInput = {}, nextInput = {}) {
  const previous = previousInput?.mainHand ? previousInput : resolvePlayerEquipmentCombatProfile(previousInput);
  const next = nextInput?.mainHand ? nextInput : resolvePlayerEquipmentCombatProfile(nextInput);
  const changedSlots = [];
  for (const slot of ['head', 'chest', 'back', 'mainHand', 'offHand']) {
    if (previous.sourceIds[slot] !== next.sourceIds[slot]) changedSlots.push(slot);
  }
  return Object.freeze({
    changed: changedSlots.length > 0,
    changedSlots: Object.freeze(changedSlots),
    weaponChanged: previous.sourceIds.mainHand !== next.sourceIds.mainHand,
    defenseChanged: previous.sourceIds.chest !== next.sourceIds.chest || previous.sourceIds.head !== next.sourceIds.head || previous.sourceIds.offHand !== next.sourceIds.offHand,
    rangedChanged: previous.ranged !== next.ranged,
    handednessChanged: previous.twoHanded !== next.twoHanded,
    movementDelta: Number((next.armor.movementMultiplier - previous.armor.movementMultiplier).toFixed(4)),
    staminaDrainDelta: Number((next.armor.staminaDrainMultiplier - previous.armor.staminaDrainMultiplier).toFixed(4)),
    poiseDelta: Number((next.armor.poiseBonus - previous.armor.poiseBonus).toFixed(4)),
    damageDelta: Number((next.mainHand.damageMultiplier - previous.mainHand.damageMultiplier).toFixed(4)),
    reachDelta: Number((next.mainHand.reachMultiplier - previous.mainHand.reachMultiplier).toFixed(4)),
  });
}

export function resolvePlayerEquipmentTransition(previousInput = {}, nextInput = {}, {
  movementState = 'idle',
  attackKind = 'none',
  comboStep = 0,
  speedMps = 0,
  grounded = true,
} = {}) {
  const previous = previousInput?.mainHand ? previousInput : resolvePlayerEquipmentCombatProfile(previousInput);
  const next = nextInput?.mainHand ? nextInput : resolvePlayerEquipmentCombatProfile(nextInput);
  const delta = comparePlayerEquipmentProfiles(previous, next);
  const nextAnimation = resolvePlayerAnimationPlan(next, { movementState, attackKind, comboStep, speedMps, grounded });
  const previousAnimation = resolvePlayerAnimationPlan(previous, { movementState, attackKind, comboStep, speedMps, grounded });
  const compatible = previousAnimation.family === nextAnimation.family;
  const hardReset = delta.weaponChanged || delta.handednessChanged || delta.rangedChanged;
  return Object.freeze({
    ...delta,
    animation: Object.freeze({
      compatible,
      hardReset,
      fromFamily: previousAnimation.family,
      toFamily: nextAnimation.family,
      action: nextAnimation.action,
      preserveLocomotion: !hardReset && movementState !== 'dodge',
      crossfadeSeconds: hardReset ? 0.14 : compatible ? 0.25 : 0.18,
    }),
    socketsToRefresh: Object.freeze(unique([...delta.changedSlots].filter((slot) => ['head', 'chest', 'back', 'mainHand', 'offHand'].includes(slot)))),
  });
}

export function resolvePlayerHitReaction(profileInput = {}, { rawAmount = 0, blockedAmount = 0, poise = 100, maxPoise = 100 } = {}) {
  const profile = profileInput?.mainHand ? profileInput : resolvePlayerEquipmentCombatProfile(profileInput);
  const raw = Math.max(0, finite(rawAmount, 0));
  const blocked = clamp(finite(blockedAmount, 0), 0, raw);
  const effective = Math.max(0, raw - blocked) * profile.mainHand.poiseMultiplier;
  const currentPoise = clamp(finite(poise, maxPoise), 0, Math.max(1, finite(maxPoise, 100)));
  return Object.freeze({
    rawAmount: raw,
    blockedAmount: blocked,
    effectiveImpact: Number(effective.toFixed(4)),
    poiseAfter: clamp(currentPoise - effective, 0, Math.max(1, finite(maxPoise, 100))),
    staggers: currentPoise - effective <= 0,
    staggerSeverity: clamp(effective / Math.max(1, finite(maxPoise, 100)), 0, 3),
  });
}

export function resolvePlayerLockOnRules(profileInput = {}, {
  targetDistanceMeters = Infinity,
  targetAngleRad = Math.PI,
  targetAlive = true,
  targetVisible = true,
  targetPriority = 0,
  currentLocked = false,
  targetMovesAway = false,
} = {}) {
  const profile = profileInput?.mainHand ? profileInput : resolvePlayerEquipmentCombatProfile(profileInput);
  const distance = Math.max(0, finite(targetDistanceMeters, Number.POSITIVE_INFINITY));
  const angle = Math.max(0, finite(targetAngleRad, Math.PI));
  const maxRange = profile.ranged ? 28 : clamp(profile.mainHand.reachMultiplier * 9, 8, 18);
  const halfFov = profile.ranged ? 0.95 : 1.15;
  const inRange = distance <= maxRange;
  const inArc = angle <= halfFov;
  const eligible = Boolean(targetAlive) && Boolean(targetVisible) && inRange && inArc;
  const distanceScore = clamp(1 - distance / Math.max(maxRange, 1), 0, 1);
  const angleScore = clamp(1 - angle / Math.max(halfFov, 0.001), 0, 1);
  const priorityScore = clamp(finite(targetPriority, 0), 0, 1);
  const score = eligible ? Number((distanceScore * 0.45 + angleScore * 0.35 + priorityScore * 0.2).toFixed(6)) : 0;
  return Object.freeze({
    eligible,
    acquire: eligible && !currentLocked,
    maintain: Boolean(currentLocked) && eligible && !targetMovesAway,
    breakLock: Boolean(currentLocked) && (!targetAlive || !targetVisible || distance > maxRange * 1.25),
    maxRange,
    halfFov,
    distanceMeters: distance,
    angleRad: angle,
    score,
  });
}

export function buildPlayerHitboxHurtboxContract(profileInput = {}, {
  grounded = true,
  crouching = false,
  attackKind = 'light',
  stance = 'neutral',
} = {}) {
  const profile = profileInput?.mainHand ? profileInput : resolvePlayerEquipmentCombatProfile(profileInput);
  const tuning = resolvePlayerCombatEnvelope(profile, { kind: attackKind });
  const armorMass = clamp(profile.armor.staminaDrainMultiplier, 0.65, 1.9);
  const height = crouching ? 1.22 : 1.72;
  const radius = clamp(0.29 + (armorMass - 1) * 0.035, 0.24, 0.34);
  const chestDepth = clamp(0.34 + (armorMass - 1) * 0.025, 0.28, 0.39);
  const attackReach = clamp(tuning.reach, 0.75, 3.4);
  const forward = stance === 'guard' ? attackReach * 0.78 : attackReach;
  return Object.freeze({
    version: 1,
    grounded: Boolean(grounded),
    hurtbox: Object.freeze({ shape: 'capsule', radius, height, centerY: height * 0.5, tag: 'player-hurtbox' }),
    hitbox: Object.freeze({
      shape: 'arc',
      activeReachMeters: forward,
      widthMeters: clamp(0.42 + attackReach * 0.12, 0.42, 0.86),
      heightMeters: clamp(0.5 + attackReach * 0.08, 0.5, 0.78),
      attackKind: normalizeKind(attackKind),
      tag: 'player-hitbox',
    }),
    separation: Object.freeze({
      visualColliderParityRequired: true,
      groundedContactRequired: true,
      maxVerticalPenetrationMeters: 0.025,
      maxHorizontalPenetrationMeters: 0.04,
    }),
  });
}

export function validatePlayerEquipmentRuntimeInput(input = {}) {
  const errors = [];
  const warnings = [];
  const profile = resolvePlayerEquipmentCombatProfile(input.equipment || input);
  const tuning = resolvePlayerCombatEnvelope(profile, { kind: input.kind, staminaRatio: input.staminaRatio, poiseRatio: input.poiseRatio });
  const dodge = resolvePlayerDodgeRules(profile, { staminaRatio: input.staminaRatio, grounded: input.grounded !== false, attackBusy: Boolean(input.attackBusy), guardBreak: Boolean(input.guardBreak) });
  const ranged = resolvePlayerRangedRules(profile, { staminaRatio: input.staminaRatio, lockOn: Boolean(input.lockOn), moving: Boolean(input.moving) });
  if (tuning.activeStart >= tuning.activeEnd) errors.push('invalid-active-window');
  if (tuning.activeEnd > tuning.duration) errors.push('active-window-after-duration');
  if (tuning.reach <= 0) errors.push('non-positive-reach');
  if (dodge.distanceMultiplier <= 0) errors.push('non-positive-dodge-distance');
  if (profile.mainHand.projectile !== ranged.projectile) errors.push('ranged-profile-mismatch');
  if (ranged.ranged && !ranged.twoHanded) warnings.push('ranged-one-handed-profile');
  if (profile.armor.movementMultiplier < 0.65) warnings.push('heavy-movement');
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors), warnings: Object.freeze(warnings), profile, tuning, dodge, ranged });
}
