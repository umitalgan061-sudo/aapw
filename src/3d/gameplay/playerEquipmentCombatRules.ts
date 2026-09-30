/** Production TypeScript owner for src/3d/gameplay/playerEquipmentCombatRules.js. Legacy .js remains compatibility-only. */
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

import type { PlayerEquipmentCombatProfileContract as LegacyProfileContract } from './playerEquipmentCombatProfile.ts';
import {
  resolvePlayerEquipmentCombatProfile,
  resolvePlayerAttackTuning,
  resolvePlayerAnimationPlan,
} from './playerEquipmentCombatProfile.ts';

export type PlayerAttackKind = 'light' | 'heavy';
export type PlayerMovementState = string;
export type PlayerEquipmentInput = Record<string, unknown>;

export interface PlayerWeaponProfile extends Record<string, unknown> {
  readonly id: string;
  readonly animationFamily: string;
  readonly materialSurface: string;
  readonly staminaMultiplier: number;
  readonly damageMultiplier: number;
  readonly reachMultiplier: number;
  readonly activeStartShift: number;
  readonly activeEndShift: number;
  readonly durationMultiplier: number;
  readonly commitMultiplier: number;
  readonly guardBreakMultiplier: number;
  readonly poiseMultiplier: number;
  readonly projectile: boolean;
  readonly twoHanded: boolean;
}

export interface PlayerArmorProfile extends Record<string, unknown> {
  readonly id: string;
  readonly animationFamily: string;
  readonly movementMultiplier: number;
  readonly staminaDrainMultiplier: number;
  readonly staminaRegenMultiplier: number;
  readonly poiseBonus: number;
  readonly guardDamageMultiplier: number;
  readonly dodgeDistanceMultiplier: number;
  readonly materialSurfaces: readonly string[];
}

export interface PlayerResolvedProfile extends LegacyProfileContract {
  readonly version: number;
  readonly mainHand: PlayerWeaponProfile;
  readonly offHand: PlayerWeaponProfile;
  readonly armor: PlayerArmorProfile;
  readonly shieldEquipped: boolean;
  readonly ranged: boolean;
  readonly twoHanded: boolean;
  readonly effectiveGuardMultiplier: number;
  readonly sourceIds: Readonly<Record<'mainHand' | 'offHand' | 'head' | 'chest' | 'back', string>>;
}

export interface PlayerAttackTuning {
  readonly cost: number;
  readonly duration: number;
  readonly activeStart: number;
  readonly activeEnd: number;
  readonly reach: number;
  readonly damageScale: number;
  readonly commitMeters: number;
  readonly guardBreakMultiplier: number;
  readonly poiseMultiplier: number;
  readonly guardDamageMultiplier: number;
  readonly armorPoiseBonus: number;
  readonly movementMultiplier: number;
  readonly staminaRegenMultiplier: number;
  readonly dodgeDistanceMultiplier: number;
  readonly isRanged: boolean;
  readonly twoHanded: boolean;
}

export interface PlayerRuntimeInputOptions {
  readonly staminaRatio?: unknown;
  readonly poiseRatio?: unknown;
  readonly grounded?: unknown;
  readonly attackBusy?: unknown;
  readonly guardBreak?: unknown;
  readonly lockOn?: unknown;
  readonly moving?: unknown;
}

export interface PlayerLockOnOptions {
  readonly targetDistanceMeters?: unknown;
  readonly targetAngleRad?: unknown;
  readonly targetAlive?: unknown;
  readonly targetVisible?: unknown;
  readonly targetPriority?: unknown;
  readonly currentLocked?: unknown;
  readonly targetMovesAway?: unknown;
}

export interface PlayerHitReactionOptions {
  readonly rawAmount?: unknown;
  readonly blockedAmount?: unknown;
  readonly poise?: unknown;
  readonly maxPoise?: unknown;
}

export interface PlayerAnimationOptions {
  readonly movementState?: PlayerMovementState;
  readonly attackKind?: PlayerAttackKind | 'none';
  readonly comboStep?: unknown;
  readonly speedMps?: unknown;
  readonly grounded?: unknown;
}

const asResolvedProfile = (value: unknown): PlayerResolvedProfile => value as PlayerResolvedProfile;
const normalizeRecord = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value)) ? value as Record<string, unknown> : {};

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));
const finite = (v: unknown, fallback = 0): number => Number.isFinite(Number(v)) ? Number(v) : fallback;
const normalizeKind = (v: unknown): PlayerAttackKind => v === 'heavy' ? 'heavy' : 'light';
const unique = (items: readonly unknown[]): string[] => [...new Set(items.filter((value): value is string => typeof value === 'string' && value.length > 0))];

export function resolvePlayerDefenseRules(profileInput: PlayerEquipmentInput | PlayerResolvedProfile = {}, {
  staminaRatio = 1, poiseRatio = 1, guardInput = false, parryWindowOpen = false, dodgeInvulnerable = false, }: { staminaRatio?: unknown; poiseRatio?: unknown; guardInput?: unknown; parryWindowOpen?: unknown; dodgeInvulnerable?: unknown } = {}) {
  const profile = 'mainHand' in normalizeRecord(profileInput) && Boolean(normalizeRecord(profileInput).mainHand) ? asResolvedProfile(profileInput) : asResolvedProfile(resolvePlayerEquipmentCombatProfile(normalizeRecord(profileInput)));
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

export function resolvePlayerDodgeRules(profileInput: PlayerEquipmentInput | PlayerResolvedProfile = {}, { staminaRatio = 1, grounded = true, attackBusy = false, guardBreak = false }: { staminaRatio?: unknown; grounded?: unknown; attackBusy?: unknown; guardBreak?: unknown } = {}) {
  const profile = 'mainHand' in normalizeRecord(profileInput) && Boolean(normalizeRecord(profileInput).mainHand) ? asResolvedProfile(profileInput) : asResolvedProfile(resolvePlayerEquipmentCombatProfile(normalizeRecord(profileInput)));
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

export function resolvePlayerRangedRules(profileInput: PlayerEquipmentInput | PlayerResolvedProfile = {}, { staminaRatio = 1, lockOn = false, moving = false }: { staminaRatio?: unknown; lockOn?: unknown; moving?: unknown } = {}) {
  const profile = 'mainHand' in normalizeRecord(profileInput) && Boolean(normalizeRecord(profileInput).mainHand) ? asResolvedProfile(profileInput) : asResolvedProfile(resolvePlayerEquipmentCombatProfile(normalizeRecord(profileInput)));
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

export function resolvePlayerCombatEnvelope(profileInput: PlayerEquipmentInput | PlayerResolvedProfile = {}, { kind = 'light', staminaRatio = 1, poiseRatio = 1 }: { kind?: unknown; staminaRatio?: unknown; poiseRatio?: unknown } = {}) {
  const profile = 'mainHand' in normalizeRecord(profileInput) && Boolean(normalizeRecord(profileInput).mainHand) ? asResolvedProfile(profileInput) : asResolvedProfile(resolvePlayerEquipmentCombatProfile(normalizeRecord(profileInput)));
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

export function comparePlayerEquipmentProfiles(previousInput: PlayerEquipmentInput | PlayerResolvedProfile = {}, nextInput: PlayerEquipmentInput | PlayerResolvedProfile = {}) {
  const previous = 'mainHand' in normalizeRecord(previousInput) && Boolean(normalizeRecord(previousInput).mainHand) ? asResolvedProfile(previousInput) : asResolvedProfile(resolvePlayerEquipmentCombatProfile(normalizeRecord(previousInput)));
  const next = 'mainHand' in normalizeRecord(nextInput) && Boolean(normalizeRecord(nextInput).mainHand) ? asResolvedProfile(nextInput) : asResolvedProfile(resolvePlayerEquipmentCombatProfile(normalizeRecord(nextInput)));
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

export function resolvePlayerEquipmentTransition(previousInput: PlayerEquipmentInput | PlayerResolvedProfile = {}, nextInput: PlayerEquipmentInput | PlayerResolvedProfile = {}, { movementState = 'idle', attackKind = 'none', comboStep = 0, speedMps = 0, grounded = true }: PlayerAnimationOptions = {}) {
  const previous = 'mainHand' in normalizeRecord(previousInput) && Boolean(normalizeRecord(previousInput).mainHand) ? asResolvedProfile(previousInput) : asResolvedProfile(resolvePlayerEquipmentCombatProfile(normalizeRecord(previousInput)));
  const next = 'mainHand' in normalizeRecord(nextInput) && Boolean(normalizeRecord(nextInput).mainHand) ? asResolvedProfile(nextInput) : asResolvedProfile(resolvePlayerEquipmentCombatProfile(normalizeRecord(nextInput)));
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

export function resolvePlayerHitReaction(profileInput: PlayerEquipmentInput | PlayerResolvedProfile = {}, { rawAmount = 0, blockedAmount = 0, poise = 100, maxPoise = 100 }: PlayerHitReactionOptions = {}) {
  const profile = 'mainHand' in normalizeRecord(profileInput) && Boolean(normalizeRecord(profileInput).mainHand) ? asResolvedProfile(profileInput) : asResolvedProfile(resolvePlayerEquipmentCombatProfile(normalizeRecord(profileInput)));
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

export function resolvePlayerLockOnRules(profileInput: PlayerEquipmentInput | PlayerResolvedProfile = {}, { targetDistanceMeters = Infinity, targetAngleRad = Math.PI, targetAlive = true, targetVisible = true, targetPriority = 0, currentLocked = false, targetMovesAway = false }: PlayerLockOnOptions = {}) {
  const profile = 'mainHand' in normalizeRecord(profileInput) && Boolean(normalizeRecord(profileInput).mainHand) ? asResolvedProfile(profileInput) : asResolvedProfile(resolvePlayerEquipmentCombatProfile(normalizeRecord(profileInput)));
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

export function buildPlayerHitboxHurtboxContract(profileInput: PlayerEquipmentInput | PlayerResolvedProfile = {}, { grounded = true, crouching = false, attackKind = 'light', stance = 'neutral' }: { grounded?: unknown; crouching?: unknown; attackKind?: unknown; stance?: unknown } = {}) {
  const profile = 'mainHand' in normalizeRecord(profileInput) && Boolean(normalizeRecord(profileInput).mainHand) ? asResolvedProfile(profileInput) : asResolvedProfile(resolvePlayerEquipmentCombatProfile(normalizeRecord(profileInput)));
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

export function validatePlayerEquipmentRuntimeInput(input: PlayerRuntimeInputOptions & { equipment?: PlayerEquipmentInput | PlayerResolvedProfile; kind?: unknown; lockOn?: unknown; moving?: unknown } = {}) {
  const errors = [];
  const warnings = [];
  const profile = asResolvedProfile(resolvePlayerEquipmentCombatProfile(input.equipment ?? normalizeRecord(input)));
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
