/**
 * Deterministic presentation route for the existing settlement service authority.
 *
 * This module only projects the next interaction affordance for settlement UX.
 * It does not mutate settlement, quest, dialogue, inventory, economy or save state.
 */

const SERVICES = new Set(['blacksmith', 'tavern', 'market', 'farm', 'barracks', 'stable', 'house', 'gate']);
const ACTIONS = new Set(['talk', 'trade', 'craft', 'equip', 'rest', 'acceptQuest', 'advanceQuest', 'buy', 'sell', 'interact', 'travel', 'train', 'save', 'enter', 'exit']);
const ROUTE_STAGES = new Set(['approach', 'inside', 'service', 'departure', 'resume']);
const REASONS = new Set(['ready', 'service-unavailable', 'action-unavailable', 'condition-blocked', 'stage-blocked', 'invalid-input']);

const clampInt = (value, min, max, fallback = 0) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(number)));
};

const normalizeId = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';

const stableHash = (value) => {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const freeze = (value) => Object.freeze(value);

const normalizeActions = (actions) => freeze([...new Set(Array.isArray(actions) ? actions.map(normalizeId).filter((action) => ACTIONS.has(action)) : [])].sort());

const normalizeCondition = (condition) => {
  if (!condition || typeof condition !== 'object') return freeze({ passed: true, key: '' });
  const key = normalizeId(condition.key ?? condition.type);
  const passed = condition.passed !== false && condition.met !== false && condition.satisfied !== false;
  return freeze({ passed, key });
};

export function projectSettlementServiceRoute(input = {}) {
  const serviceId = normalizeId(input.serviceId ?? input.activeServiceId);
  const stage = ROUTE_STAGES.has(normalizeId(input.stage)) ? normalizeId(input.stage) : 'approach';
  const requestedAction = normalizeId(input.action ?? input.requestedAction);
  const availableActions = normalizeActions(input.availableActions);
  const condition = normalizeCondition(input.condition);
  const serviceKnown = SERVICES.has(serviceId);
  const actionKnown = ACTIONS.has(requestedAction);
  const stageReady = stage !== 'departure' || requestedAction === 'travel' || requestedAction === 'exit' || requestedAction === '';
  const actionReady = !requestedAction || availableActions.includes(requestedAction);

  let reason = 'ready';
  if (!serviceKnown) reason = 'service-unavailable';
  else if (!stageReady) reason = 'stage-blocked';
  else if (!condition.passed) reason = 'condition-blocked';
  else if (requestedAction && !actionKnown) reason = 'invalid-input';
  else if (!actionReady) reason = 'action-unavailable';

  const nextAction = reason === 'ready'
    ? (requestedAction || availableActions[0] || 'interact')
    : (stage === 'approach' ? 'enter' : stage === 'departure' ? 'exit' : 'talk');
  const routeKey = stableHash([serviceId || 'unknown', stage, nextAction, reason, condition.key].join('|'));

  return freeze({
    version: 1,
    serviceId,
    stage,
    requestedAction,
    availableActions,
    nextAction,
    reason,
    condition,
    serviceKnown,
    actionKnown,
    routeKey,
    blocked: reason !== 'ready',
  });
}

export function isSettlementServiceRoute(value) {
  if (!value || typeof value !== 'object') return false;
  if (value.version !== 1 || typeof value.routeKey !== 'string' || !REASONS.has(value.reason)) return false;
  if (typeof value.serviceId !== 'string' || typeof value.stage !== 'string' || !ROUTE_STAGES.has(value.stage)) return false;
  if (!Array.isArray(value.availableActions) || !Object.isFrozen(value.availableActions)) return false;
  if (value.availableActions.some((action) => typeof action !== 'string' || !ACTIONS.has(action))) return false;
  if (value.blocked !== (value.reason !== 'ready')) return false;
  return value.routeKey === stableHash([value.serviceId || 'unknown', value.stage, value.nextAction, value.reason, value.condition?.key ?? ''].join('|'));
}

export const SETTLEMENT_SERVICE_ROUTE_LIMITS = freeze({ maxActions: 16, maxIdLength: 48, maxConditionKeyLength: 48 });
