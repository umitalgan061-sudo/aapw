/**
 * Deterministic hit-impact resolution adapter for the shipped player combat pipeline.
 *
 * This module consumes caller-owned attack/contact/equipment/target snapshots and returns
 * bounded damage/poise/guard outcomes for existing health, feedback and event consumers.
 * It never mutates player state, scene objects, colliders, inventory, animation mixers or AI.
 * @module gameplay/playerCombatImpactResolution
 */

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finiteOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const normalizeId = (value, fallback = '') => String(value ?? fallback).trim().toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').slice(0, 96) || fallback;

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
}

function normalizeAttack(attack = {}) {
  const kind = attack.kind === 'heavy' ? 'heavy' : attack.kind === 'light' ? 'light' : attack.kind === 'ranged' ? 'ranged' : 'none';
  const baseDamage = clamp(finiteOr(attack.baseDamage, kind === 'heavy' ? 24 : kind === 'ranged' ? 18 : 12), 0, 1000);
  const damageScale = clamp(finiteOr(attack.damageScale, 1), 0, 10);
  const comboStep = clamp(Math.floor(finiteOr(attack.comboStep, 1)), 1, 3);
  const criticalMultiplier = clamp(finiteOr(attack.criticalMultiplier, 1), 1, 3);
  const active = attack.active !== false;
  return { kind, baseDamage, damageScale, comboStep, criticalMultiplier, active };
}

function normalizeTarget(target = {}) {
  return {
    id: normalizeId(target.id, 'target'),
    faction: normalizeId(target.faction, 'neutral'),
    active: target.active !== false,
    invulnerable: target.invulnerable === true,
    health: clamp(finiteOr(target.health, 100), 0, 100000),
    armor: clamp(finiteOr(target.armor, 0), 0, 1000),
    poise: clamp(finiteOr(target.poise, 100), 0, 1000),
    guard: target.guard === true,
    parry: target.parry === true,
    distanceMeters: clamp(finiteOr(target.distanceMeters, 0), 0, 1000),
  };
}

export function resolveCombatImpact({
  attackerFaction = 'player',
  attack = {},
  weapon = {},
  target = {},
  contact = {},
  random = 0.5,
} = {}) {
  const normalizedAttack = normalizeAttack(attack);
  const normalizedTarget = normalizeTarget(target);
  const attacker = normalizeId(attackerFaction, 'player');
  const weaponDamage = clamp(finiteOr(weapon.damageMultiplier, 1), 0, 10);
  const weaponPoise = clamp(finiteOr(weapon.poiseMultiplier, 1), 0, 10);
  const guardBreakMultiplier = clamp(finiteOr(weapon.guardBreakMultiplier, 1), 0, 10);
  const contactConfidence = clamp(finiteOr(contact.confidence, 1), 0, 1);
  const inReach = contact.inReach !== false;
  const facingValid = contact.facingValid !== false;
  const sameFaction = attacker !== 'neutral' && attacker === normalizedTarget.faction;
  const roll = clamp(finiteOr(random, 0.5), 0, 1);
  const critical = normalizedAttack.kind !== 'none' && roll >= 0.93 && !normalizedTarget.guard && !normalizedTarget.parry;

  let outcome = 'miss';
  let damage = 0;
  let poiseDamage = 0;
  let blockedDamage = 0;
  let guardBreak = false;
  let reason = 'inactive-attack';

  if (!normalizedAttack.active) reason = 'inactive-attack';
  else if (normalizedAttack.kind === 'none') reason = 'unsupported-attack';
  else if (!normalizedTarget.active) reason = 'inactive-target';
  else if (normalizedTarget.invulnerable) reason = 'invulnerable-target';
  else if (sameFaction) reason = 'friendly-fire-blocked';
  else if (!inReach) reason = 'out-of-reach';
  else if (!facingValid) reason = 'facing-gate';
  else if (contactConfidence <= 0) reason = 'low-confidence-contact';
  else if (normalizedTarget.parry) { outcome = 'parried'; reason = 'parried'; }
  else {
    const comboMultiplier = 1 + (normalizedAttack.comboStep - 1) * 0.08;
    const rawDamage = normalizedAttack.baseDamage * normalizedAttack.damageScale * weaponDamage * comboMultiplier * (critical ? normalizedAttack.criticalMultiplier : 1) * contactConfidence;
    const mitigation = normalizedTarget.armor / (normalizedTarget.armor + 100);
    const mitigated = rawDamage * (1 - mitigation);
    if (normalizedTarget.guard) {
      const guardRatio = clamp(0.35 - (guardBreakMultiplier - 1) * 0.08, 0.08, 0.35);
      damage = mitigated * guardRatio;
      blockedDamage = mitigated - damage;
      poiseDamage = rawDamage * weaponPoise * 0.42;
      guardBreak = poiseDamage >= normalizedTarget.poise;
      outcome = guardBreak ? 'guard-break' : 'blocked';
      reason = outcome;
    } else {
      damage = mitigated;
      poiseDamage = rawDamage * weaponPoise * (normalizedAttack.kind === 'heavy' ? 0.9 : 0.55);
      outcome = critical ? 'critical-hit' : 'hit';
      reason = outcome;
    }
  }

  const appliedDamage = clamp(Math.min(damage, normalizedTarget.health), 0, 100000);
  const remainingHealth = clamp(normalizedTarget.health - appliedDamage, 0, 100000);
  const remainingPoise = clamp(normalizedTarget.poise - poiseDamage, 0, 100000);
  return freezeDeep({
    outcome,
    reason,
    targetId: normalizedTarget.id,
    attackKind: normalizedAttack.kind,
    comboStep: normalizedAttack.comboStep,
    critical,
    rawDamage: Number(damage.toFixed(4)),
    appliedDamage: Number(appliedDamage.toFixed(4)),
    blockedDamage: Number(blockedDamage.toFixed(4)),
    poiseDamage: Number(poiseDamage.toFixed(4)),
    guardBreak,
    remainingHealth: Number(remainingHealth.toFixed(4)),
    remainingPoise: Number(remainingPoise.toFixed(4)),
    canDefeat: remainingHealth <= 0 && appliedDamage > 0,
    stableKey: `${normalizedAttack.kind}:${normalizedAttack.comboStep}:${normalizedTarget.id}:${outcome}:${Number(appliedDamage.toFixed(3))}:${Number(poiseDamage.toFixed(3))}`,
  });
}

export function serializeCombatImpact(value) {
  return JSON.stringify(value ?? null);
}
