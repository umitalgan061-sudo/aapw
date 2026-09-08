/**
 * Deterministic, DOM-free combat resolution adapter for the existing player pipeline.
 * It owns combat math/state only; movement, terrain, animation playback and RPG item semantics
 * remain with their existing directors.
 */

export const COMBAT_ACTIONS = Object.freeze({
  LIGHT: 'light',
  HEAVY: 'heavy',
  BLOCK: 'block',
  PARRY: 'parry',
  DODGE: 'dodge',
});

const DEFAULTS = Object.freeze({
  maxHealth: 100,
  maxStamina: 100,
  maxPoise: 100,
  staminaRegenPerSecond: 22,
  poiseRecoveryPerSecond: 28,
  lightCost: 14,
  heavyCost: 28,
  dodgeCost: 24,
  blockDrainPerSecond: 10,
  parryWindowSeconds: 0.18,
  dodgeIFrameSeconds: 0.24,
  comboResetSeconds: 0.9,
});

const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const finite = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);

export function createPlayerCombatState(overrides = {}) {
  const config = { ...DEFAULTS, ...overrides };
  return {
    health: config.maxHealth,
    stamina: config.maxStamina,
    poise: config.maxPoise,
    action: null,
    actionStartedAt: -Infinity,
    comboIndex: 0,
    comboExpiresAt: -Infinity,
    guardHeld: false,
    parryUntil: -Infinity,
    dodgeUntil: -Infinity,
    lockTargetId: null,
    lastResolvedHit: null,
    config,
  };
}

export function resolveCombatIntent(state, intent = {}, nowSeconds = 0) {
  const next = { ...state };
  const action = intent.action;
  const dt = Math.max(0, Math.min(0.25, finite(intent.deltaSeconds, 0)));

  if (next.action === COMBAT_ACTIONS.BLOCK && !intent.guardHeld) next.guardHeld = false;
  if (!next.guardHeld && !action) {
    next.stamina = Math.min(next.config.maxStamina, next.stamina + next.config.staminaRegenPerSecond * dt);
    next.poise = Math.min(next.config.maxPoise, next.poise + next.config.poiseRecoveryPerSecond * dt);
  }
  if (next.guardHeld) next.stamina = Math.max(0, next.stamina - next.config.blockDrainPerSecond * dt);
  if (next.stamina === 0) next.guardHeld = false;

  if (!action) return next;
  if (action === COMBAT_ACTIONS.BLOCK) {
    next.guardHeld = true;
    next.action = COMBAT_ACTIONS.BLOCK;
    next.actionStartedAt = nowSeconds;
    next.parryUntil = nowSeconds + next.config.parryWindowSeconds;
    return next;
  }
  if (action === COMBAT_ACTIONS.DODGE && next.stamina >= next.config.dodgeCost) {
    next.stamina -= next.config.dodgeCost;
    next.action = action;
    next.actionStartedAt = nowSeconds;
    next.dodgeUntil = nowSeconds + next.config.dodgeIFrameSeconds;
    next.guardHeld = false;
    return next;
  }
  if ((action === COMBAT_ACTIONS.LIGHT || action === COMBAT_ACTIONS.HEAVY) && !next.guardHeld) {
    const cost = action === COMBAT_ACTIONS.LIGHT ? next.config.lightCost : next.config.heavyCost;
    if (next.stamina < cost) return next;
    next.stamina -= cost;
    next.action = action;
    next.actionStartedAt = nowSeconds;
    next.comboIndex = nowSeconds <= next.comboExpiresAt ? Math.min(next.comboIndex + 1, 3) : 1;
    next.comboExpiresAt = nowSeconds + next.config.comboResetSeconds;
  }
  return next;
}

export function resolveIncomingHit(state, hit = {}, nowSeconds = 0) {
  const damage = Math.max(0, finite(hit.damage, 0));
  const poiseDamage = Math.max(0, finite(hit.poiseDamage, damage));
  const distance = Math.max(0, finite(hit.distance, 0));
  const result = { kind: 'ignored', damageApplied: 0, poiseApplied: 0, staggered: false, distance };
  if (state.health <= 0 || damage <= 0) return { state, result };

  const next = { ...state };
  if (nowSeconds <= next.dodgeUntil) {
    result.kind = 'dodged';
  } else if (next.guardHeld && nowSeconds <= next.parryUntil) {
    result.kind = 'parried';
    next.poise = Math.min(next.config.maxPoise, next.poise + poiseDamage * 0.2);
  } else if (next.guardHeld && next.stamina > 0) {
    const mitigation = clamp01(finite(hit.blockMitigation, 0.65));
    result.kind = 'blocked';
    result.damageApplied = damage * (1 - mitigation);
    result.poiseApplied = poiseDamage * 0.35;
    next.health = Math.max(0, next.health - result.damageApplied);
    next.poise = Math.max(0, next.poise - result.poiseApplied);
  } else {
    result.kind = 'hit';
    result.damageApplied = damage;
    result.poiseApplied = poiseDamage;
    next.health = Math.max(0, next.health - damage);
    next.poise = Math.max(0, next.poise - poiseDamage);
    result.staggered = next.poise === 0;
  }
  next.lastResolvedHit = result;
  return { state: next, result };
}

export function buildCombatHitbox({ action, comboIndex = 1, weaponReach = 1.1 } = {}) {
  const heavy = action === COMBAT_ACTIONS.HEAVY;
  const radius = Math.max(0.15, finite(weaponReach, 1.1) * (heavy ? 0.82 : 0.62));
  return Object.freeze({
    action,
    comboIndex: Math.max(1, Math.min(3, Math.trunc(comboIndex))),
    radius,
    arcDegrees: heavy ? 110 : 85,
    damageMultiplier: heavy ? 1.65 : 1,
    activeWindow: heavy ? [0.28, 0.56] : [0.2, 0.42],
  });
}

export function resolveLockOn(currentTargetId, candidates = [], maxDistance = 18) {
  const valid = candidates
    .filter((candidate) => candidate && candidate.id != null && Number.isFinite(candidate.distance))
    .filter((candidate) => candidate.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance || String(a.id).localeCompare(String(b.id)));
  return currentTargetId && valid.some((candidate) => candidate.id === currentTargetId)
    ? currentTargetId
    : (valid[0]?.id ?? null);
}

export function normalizeCombatInput(input = {}) {
  return {
    light: Boolean(input.light || input.primary || input.gamepadSouth || input.touchLight),
    heavy: Boolean(input.heavy || input.secondary || input.gamepadEast || input.touchHeavy),
    block: Boolean(input.block || input.secondaryHold || input.gamepadLeftBumper || input.touchGuard),
    dodge: Boolean(input.dodge || input.space || input.gamepadEastPressed || input.touchDodge),
    lockOn: Boolean(input.lockOn || input.middleMouse || input.gamepadRightStick || input.touchLockOn),
  };
}
