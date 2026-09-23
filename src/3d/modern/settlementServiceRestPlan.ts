export const SETTLEMENT_REST_SERVICES = Object.freeze(['tavern', 'farm', 'barracks', 'stable']);

const MAX_RECOVERY = 100;
const MAX_DURATION_MINUTES = 24 * 60;

function clampInteger(value, min, max, fallback = min) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function freeze(value) {
  return Object.freeze(value);
}

function normalizeContext(context) {
  const source = context && typeof context === 'object' ? context : {};
  const service = typeof source.service === 'string' ? source.service : '';
  const action = typeof source.action === 'string' ? source.action : '';
  const minutes = clampInteger(source.minutes, 1, MAX_DURATION_MINUTES, 60);
  const player = source.player && typeof source.player === 'object' ? source.player : {};
  const status = typeof player.status === 'string' ? player.status : 'unknown';
  const health = clampInteger(player.health, 0, MAX_RECOVERY, 0);
  const stamina = clampInteger(player.stamina, 0, MAX_RECOVERY, 0);
  const copper = clampInteger(player.copper, 0, Number.MAX_SAFE_INTEGER, 0);
  return { service, action, minutes, status, health, stamina, copper };
}

function resolveReason({ service, action, status, health, stamina }) {
  if (!SETTLEMENT_REST_SERVICES.includes(service)) return 'unsupported-service';
  if (action !== 'rest') return 'unsupported-action';
  if (status === 'dead' || status === 'incapacitated') return 'player-unavailable';
  if (health >= MAX_RECOVERY && stamina >= MAX_RECOVERY) return 'already-recovered';
  return 'allowed';
}

export function createSettlementServiceRestPlan(context = {}) {
  const normalized = normalizeContext(context);
  const reason = resolveReason(normalized);
  const recovery = freeze({
    health: Math.max(0, MAX_RECOVERY - normalized.health),
    stamina: Math.max(0, MAX_RECOVERY - normalized.stamina),
  });
  const plan = {
    ok: reason === 'allowed',
    service: normalized.service,
    action: normalized.action,
    minutes: normalized.minutes,
    reason,
    recovery,
    timeAdvanceMinutes: reason === 'allowed' ? normalized.minutes : 0,
    copperCost: 0,
  };
  return freeze(plan);
}

export function applySettlementServiceRestPlan(player, plan) {
  if (!player || typeof player !== 'object') return freeze({ ok: false, reason: 'invalid-player' });
  if (!plan || plan.ok !== true) return freeze({ ok: false, reason: 'plan-not-executable' });
  const next = {
    ...player,
    health: clampInteger(player.health, 0, MAX_RECOVERY, 0) + plan.recovery.health,
    stamina: clampInteger(player.stamina, 0, MAX_RECOVERY, 0) + plan.recovery.stamina,
    lastRestService: plan.service,
    lastRestMinutes: plan.minutes,
  };
  next.health = Math.min(MAX_RECOVERY, next.health);
  next.stamina = Math.min(MAX_RECOVERY, next.stamina);
  return freeze({ ok: true, player: freeze(next), elapsedMinutes: plan.timeAdvanceMinutes });
}

export function isSettlementServiceRestPlan(value) {
  return Boolean(value && typeof value === 'object'
    && typeof value.ok === 'boolean'
    && typeof value.service === 'string'
    && typeof value.action === 'string'
    && typeof value.reason === 'string'
    && value.recovery && typeof value.recovery.health === 'number'
    && typeof value.recovery.stamina === 'number');
}
