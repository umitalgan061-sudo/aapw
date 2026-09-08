/**
 * Deterministic ranged/archery charge policy over the existing equipment/combat profile.
 * This module is renderer- and scene-agnostic: callers own projectile spawning, animation and state mutation.
 * @module gameplay/playerRangedChargeDirector
 */

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const positive = (value, fallback = 0) => Math.max(0, finite(value, fallback));

const DEFAULTS = Object.freeze({
  maxChargeSeconds: 1.15,
  minReleaseSeconds: 0.08,
  staminaCost: 10,
  fullChargeThreshold: 0.92,
  minDamageMultiplier: 0.55,
  maxDamageMultiplier: 1.35,
  minProjectileSpeedMultiplier: 0.7,
  maxProjectileSpeedMultiplier: 1.25,
  spreadAtMinChargeDegrees: 4.5,
  spreadAtFullChargeDegrees: 0.8,
});

function normalizeConfig(config = {}) {
  const maxChargeSeconds = Math.max(0.1, positive(config.maxChargeSeconds, DEFAULTS.maxChargeSeconds));
  return {
    maxChargeSeconds,
    minReleaseSeconds: clamp(positive(config.minReleaseSeconds, DEFAULTS.minReleaseSeconds), 0, maxChargeSeconds),
    staminaCost: positive(config.staminaCost, DEFAULTS.staminaCost),
    fullChargeThreshold: clamp(finite(config.fullChargeThreshold, DEFAULTS.fullChargeThreshold), 0.5, 1),
    minDamageMultiplier: Math.max(0, finite(config.minDamageMultiplier, DEFAULTS.minDamageMultiplier)),
    maxDamageMultiplier: Math.max(0, finite(config.maxDamageMultiplier, DEFAULTS.maxDamageMultiplier)),
    minProjectileSpeedMultiplier: Math.max(0, finite(config.minProjectileSpeedMultiplier, DEFAULTS.minProjectileSpeedMultiplier)),
    maxProjectileSpeedMultiplier: Math.max(0, finite(config.maxProjectileSpeedMultiplier, DEFAULTS.maxProjectileSpeedMultiplier)),
    spreadAtMinChargeDegrees: Math.max(0, finite(config.spreadAtMinChargeDegrees, DEFAULTS.spreadAtMinChargeDegrees)),
    spreadAtFullChargeDegrees: Math.max(0, finite(config.spreadAtFullChargeDegrees, DEFAULTS.spreadAtFullChargeDegrees)),
  };
}

function isRangedEquipment(equipment = {}) {
  const family = String(equipment.family || equipment.animationFamily || '').toLowerCase();
  return Boolean(equipment.ranged || equipment.projectile || family === 'archery' || family === 'crossbow');
}

function createRangedChargeState(input = {}, config = {}) {
  const settings = normalizeConfig(config);
  const elapsedSeconds = clamp(positive(input.elapsedSeconds, 0), 0, settings.maxChargeSeconds);
  const charging = Boolean(input.charging);
  const released = Boolean(input.released);
  const stamina = positive(input.stamina, Infinity);
  const canStart = isRangedEquipment(input.equipment) && !input.dead && !input.stunned && stamina >= settings.staminaCost;
  const normalizedElapsed = charging || released ? elapsedSeconds : 0;
  const progress = clamp(normalizedElapsed / settings.maxChargeSeconds, 0, 1);
  const accepted = canStart && (charging || (released && normalizedElapsed >= settings.minReleaseSeconds));
  const fullCharge = progress >= settings.fullChargeThreshold;
  const release = Boolean(accepted && released);
  const damageMultiplier = settings.minDamageMultiplier + (settings.maxDamageMultiplier - settings.minDamageMultiplier) * progress;
  const projectileSpeedMultiplier = settings.minProjectileSpeedMultiplier + (settings.maxProjectileSpeedMultiplier - settings.minProjectileSpeedMultiplier) * progress;
  const spreadDegrees = settings.spreadAtMinChargeDegrees + (settings.spreadAtFullChargeDegrees - settings.spreadAtMinChargeDegrees) * progress;
  return {
    accepted,
    charging: Boolean(accepted && charging && !released),
    release,
    rejectedReason: accepted ? null : (!isRangedEquipment(input.equipment) ? 'not-ranged' : input.dead ? 'dead' : input.stunned ? 'stunned' : stamina < settings.staminaCost ? 'insufficient-stamina' : released && normalizedElapsed < settings.minReleaseSeconds ? 'release-too-early' : 'invalid-state'),
    progress,
    fullCharge,
    elapsedSeconds: normalizedElapsed,
    maxChargeSeconds: settings.maxChargeSeconds,
    staminaCost: release ? settings.staminaCost : 0,
    damageMultiplier,
    projectileSpeedMultiplier,
    spreadDegrees,
    projectile: Boolean(input.equipment?.projectile),
    animationFamily: String(input.equipment?.family || input.equipment?.animationFamily || 'archery'),
  };
}

export { DEFAULTS as RANGED_CHARGE_DEFAULTS, createRangedChargeState, isRangedEquipment, normalizeConfig };
