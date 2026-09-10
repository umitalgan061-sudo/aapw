const ACTION_COSTS = Object.freeze({ light: 8, heavy: 18, ranged: 12, block: 4, parry: 10, dodge: 16 });
const ACTION_ORDER = Object.freeze(['light', 'heavy', 'ranged', 'block', 'parry', 'dodge']);

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));
const bool = value => value === true;
const text = (value, fallback = '') => typeof value === 'string' ? value.trim() : fallback;

function normalizeAction(value) {
  const candidate = text(value).toLowerCase();
  return ACTION_ORDER.includes(candidate) ? candidate : null;
}

function stableRecord(record) {
  return Object.fromEntries(Object.keys(record).sort().map(key => [key, record[key]]));
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(freeze);
  return value;
}

export function projectPlayerCombatResources(input = {}) {
  const maxStamina = clamp(input.maxStamina, 0, 1000);
  const stamina = clamp(input.stamina, 0, maxStamina);
  const maxPoise = clamp(input.maxPoise, 0, 1000);
  const poise = clamp(input.poise, 0, maxPoise);
  const health = clamp(input.health, 0, clamp(input.maxHealth, 0, 1000));
  const maxHealth = clamp(input.maxHealth, 0, 1000);
  const normalizedHealth = maxHealth > 0 ? Math.min(health, maxHealth) : 0;
  const recoveryRate = clamp(input.staminaRecoveryRate, 0, 120);
  const poiseRecoveryRate = clamp(input.poiseRecoveryRate, 0, 120);
  const requested = normalizeAction(input.requestedAction);
  const canAct = bool(input.alive) && !bool(input.stunned) && !bool(input.recoveryLocked);
  const costs = { ...ACTION_COSTS, ...(input.actionCosts && typeof input.actionCosts === 'object' ? input.actionCosts : {}) };
  const actions = ACTION_ORDER.map(action => {
    const cost = clamp(costs[action], 0, 1000);
    const affordable = stamina >= cost;
    const allowed = canAct && affordable && (action !== 'ranged' || bool(input.rangedReady));
    return stableRecord({ action, affordable, allowed, cost, reason: allowed ? 'ready' : (!canAct ? 'state-blocked' : (!affordable ? 'stamina' : 'ranged-unready')) });
  });
  const selected = requested && actions.find(row => row.action === requested && row.allowed) ? requested : null;
  const output = {
    health: normalizedHealth,
    maxHealth,
    stamina,
    maxStamina,
    staminaRatio: maxStamina > 0 ? Number((stamina / maxStamina).toFixed(4)) : 0,
    poise,
    maxPoise,
    poiseRatio: maxPoise > 0 ? Number((poise / maxPoise).toFixed(4)) : 0,
    staminaRecoveryRate: recoveryRate,
    poiseRecoveryRate,
    canAct,
    selectedAction: selected,
    actions,
    recovery: stableRecord({ staminaPerSecond: recoveryRate, poisePerSecond: poiseRecoveryRate })
  };
  return freeze(output);
}

export function serializePlayerCombatResources(input = {}) {
  return JSON.stringify(projectPlayerCombatResources(input));
}
