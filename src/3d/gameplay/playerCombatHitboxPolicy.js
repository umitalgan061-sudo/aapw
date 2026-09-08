const DEFAULT_PROFILE = Object.freeze({
  body: Object.freeze({ radius: 0.42, height: 1.72, offsetY: 0.86 }),
  head: Object.freeze({ radius: 0.22, height: 0.34, offsetY: 1.62 }),
  torso: Object.freeze({ radius: 0.34, height: 0.76, offsetY: 1.08 }),
  legs: Object.freeze({ radius: 0.23, height: 0.82, offsetY: 0.42 }),
  reach: 1.35,
  hurtboxPadding: 0.04,
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finitePositive = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback;

function normalizePart(name, part, fallback) {
  const source = part && typeof part === 'object' ? part : {};
  return Object.freeze({
    radius: clamp(finitePositive(source.radius, fallback.radius), 0.05, 2),
    height: clamp(finitePositive(source.height, fallback.height), 0.05, 4),
    offsetY: clamp(Number.isFinite(source.offsetY) ? source.offsetY : fallback.offsetY, 0, 4),
    name,
  });
}

export function createPlayerCombatHitboxPolicy(profile = {}) {
  const normalized = {
    body: normalizePart('body', profile.body, DEFAULT_PROFILE.body),
    head: normalizePart('head', profile.head, DEFAULT_PROFILE.head),
    torso: normalizePart('torso', profile.torso, DEFAULT_PROFILE.torso),
    legs: normalizePart('legs', profile.legs, DEFAULT_PROFILE.legs),
    reach: clamp(finitePositive(profile.reach, DEFAULT_PROFILE.reach), 0.25, 4),
    hurtboxPadding: clamp(Number.isFinite(profile.hurtboxPadding) ? profile.hurtboxPadding : DEFAULT_PROFILE.hurtboxPadding, 0, 0.5),
  };
  return Object.freeze(normalized);
}

export function resolvePlayerCombatHitbox(policy, part = 'body', overrides = {}) {
  const active = policy && typeof policy === 'object' ? policy : createPlayerCombatHitboxPolicy();
  const base = active[part] || active.body;
  const radius = clamp(finitePositive(overrides.radius, base.radius) + active.hurtboxPadding, 0.05, 2.5);
  const height = clamp(finitePositive(overrides.height, base.height), 0.05, 4);
  const offsetY = clamp(Number.isFinite(overrides.offsetY) ? overrides.offsetY : base.offsetY, 0, 4);
  return Object.freeze({
    part: base.name,
    radius,
    height,
    offsetY,
    reach: active.reach,
    isFinite: [radius, height, offsetY, active.reach].every(Number.isFinite),
  });
}

export function evaluatePlayerCombatHit({ attackerDistance = Infinity, targetHeight = 1.7, hitbox = null, attackReach = 0, verticalOffset = 0 } = {}) {
  const activeHitbox = hitbox || resolvePlayerCombatHitbox(createPlayerCombatHitboxPolicy());
  const reach = clamp(finitePositive(attackReach, activeHitbox.reach), 0.25, 5);
  const distance = Number.isFinite(attackerDistance) ? Math.max(0, attackerDistance) : Infinity;
  const height = Number.isFinite(targetHeight) ? clamp(targetHeight, 0.05, 4) : 1.7;
  const vertical = Number.isFinite(verticalOffset) ? Math.abs(verticalOffset) : Infinity;
  const verticalLimit = Math.max(0.1, (activeHitbox.height + height) * 0.5);
  return Object.freeze({
    hit: distance <= reach + activeHitbox.radius && vertical <= verticalLimit,
    distance,
    reach,
    vertical,
    verticalLimit,
    part: activeHitbox.part,
  });
}

export const PLAYER_COMBAT_HITBOX_DEFAULTS = DEFAULT_PROFILE;
