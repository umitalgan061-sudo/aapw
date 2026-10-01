const RESOURCE_LIMITS = Object.freeze({
  stamina: Object.freeze({ min: 0, max: 100 }),
  health: Object.freeze({ min: 0, max: 100 }),
  poise: Object.freeze({ min: 0, max: 100 }),
});

const finiteOr = (value, fallback = 0) =>
  Number.isFinite(value) ? value : fallback;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const normalizeResource = (value, resource) => {
  const limits = RESOURCE_LIMITS[resource] || RESOURCE_LIMITS.stamina;
  return clamp(finiteOr(value, limits.min), limits.min, limits.max);
};

const normalizeDelta = (value) => Math.max(0, finiteOr(value, 0));

export const normalizeCombatResources = (snapshot = {}) => ({
  stamina: normalizeResource(snapshot.stamina, 'stamina'),
  health: normalizeResource(snapshot.health, 'health'),
  poise: normalizeResource(snapshot.poise, 'poise'),
});

export const getCombatResourceFlags = (snapshot = {}) => {
  const resources = normalizeCombatResources(snapshot);
  return {
    exhausted: resources.stamina <= 0,
    defeated: resources.health <= 0,
    staggered: resources.poise <= 0 && resources.health > 0,
  };
};

export const applyCombatResourceDelta = (snapshot = {}, delta = {}) => {
  const current = normalizeCombatResources(snapshot);
  const staminaCost = normalizeDelta(delta.staminaCost);
  const healthDamage = normalizeDelta(delta.healthDamage);
  const poiseDamage = normalizeDelta(delta.poiseDamage);
  const staminaGain = normalizeDelta(delta.staminaGain);
  const healthGain = normalizeDelta(delta.healthGain);
  const poiseGain = normalizeDelta(delta.poiseGain);

  const next = {
    stamina: normalizeResource(current.stamina - staminaCost + staminaGain, 'stamina'),
    health: normalizeResource(current.health - healthDamage + healthGain, 'health'),
    poise: normalizeResource(current.poise - poiseDamage + poiseGain, 'poise'),
  };

  return {
    ...next,
    flags: getCombatResourceFlags(next),
  };
};

export const resolveGuardResourceCost = ({
  baseCost = 0,
  damage = 0,
  poise = 0,
  guardMultiplier = 1,
} = {}) => {
  const multiplier = clamp(finiteOr(guardMultiplier, 1), 0, 4);
  const impact = Math.max(0, finiteOr(damage, 0)) + Math.max(0, finiteOr(poise, 0)) * 0.5;
  return normalizeDelta(Math.max(0, finiteOr(baseCost, 0)) + impact * multiplier);
};

export const resolveDodgeStaminaCost = ({
  baseCost = 0,
  intensity = 1,
  encumbrance = 0,
} = {}) => {
  const normalizedIntensity = clamp(finiteOr(intensity, 1), 0, 3);
  const normalizedEncumbrance = clamp(finiteOr(encumbrance, 0), 0, 1);
  return normalizeDelta(
    Math.max(0, finiteOr(baseCost, 0)) * (1 + normalizedIntensity * 0.25 + normalizedEncumbrance * 0.5),
  );
};

export const createCombatResourceSnapshot = (snapshot = {}) => {
  const resources = normalizeCombatResources(snapshot);
  return Object.freeze({
    ...resources,
    flags: Object.freeze(getCombatResourceFlags(resources)),
  });
};

export const COMBAT_RESOURCE_LIMITS = RESOURCE_LIMITS;
