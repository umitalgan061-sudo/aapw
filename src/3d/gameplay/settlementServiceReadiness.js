/**
 * Settlement service readiness projection.
 * Uses existing campaign content as the authority and stays side-effect free.
 */
import {
  getSettlementService,
  getSettlementItem,
  getSettlementRecipe,
  getSettlementRoute,
  resolveCraftingRecipe,
  resolveTradeQuote,
  resolveTravelCost,
} from './settlementCampaignContent.js';

export const SETTLEMENT_SERVICE_READINESS_VERSION = 1;
export const SETTLEMENT_SERVICE_READINESS_LIMITS = Object.freeze({ services: 16, items: 24, recipes: 24, routes: 24, text: 120 });
const text = (value, fallback = '') => {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, SETTLEMENT_SERVICE_READINESS_LIMITS.text) : fallback;
};
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const integer = (value, min, max, fallback = min) => Math.max(min, Math.min(max, Math.trunc(finite(value, fallback))));
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(freeze);
  return value;
};

function normalizeSnapshot(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const inventory = {};
  for (const [key, value] of Object.entries(source.inventory ?? {}).slice(0, 96)) inventory[text(key)] = integer(value, 0, 9999, 0);
  return {
    copper: integer(source.copper, 0, 999999, 0),
    fatigue: Math.max(0, Math.min(100, finite(source.fatigue, 0))),
    health: Math.max(0, Math.min(100, finite(source.health, 100))),
    inventory,
    perks: Array.isArray(source.perks) ? source.perks.map((id) => text(id)).filter(Boolean).slice(0, 24) : [],
    flags: source.flags && typeof source.flags === 'object' ? { ...source.flags } : {},
  };
}

function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}

export function serializeSettlementServiceReadiness(value) { return stable(value); }

function serviceState(serviceId, snapshot, options) {
  const service = getSettlementService(serviceId);
  if (!service) return { id: text(serviceId), status: 'unknown', reason: 'unknown-service', actions: [] };
  const actions = Array.isArray(service.actions) ? service.actions.map((action) => text(action)).filter(Boolean).slice(0, 12) : [];
  const fatigueBlocked = snapshot.fatigue >= integer(options.restThreshold, 0, 100, 88) && service.id !== 'tavern';
  const healthBlocked = snapshot.health <= 0;
  const status = healthBlocked ? 'blocked' : fatigueBlocked ? 'deferred' : 'ready';
  return { id: service.id, kind: text(service.kind, 'service'), label: text(service.label, service.id), status, reason: healthBlocked ? 'player-defeated' : fatigueBlocked ? 'fatigue-high' : '', actions };
}

function tradeReadiness(input, snapshot) {
  const item = getSettlementItem(input.itemId);
  const quantity = integer(input.quantity, 1, 99, 1);
  const direction = input.direction === 'sell' ? 'sell' : 'buy';
  const quote = item ? resolveTradeQuote(item.id, quantity, direction, { buyRate: finite(input.buyRate, 0), sellRate: finite(input.sellRate, 0) }) : null;
  if (!item || !quote?.ok) return { kind: 'trade', status: 'blocked', reason: quote?.reason ?? 'unknown-item', itemId: text(input.itemId), quantity, direction, cost: 0 };
  const cost = integer(quote.total, 0, 999999, 0);
  const enoughCopper = direction === 'sell' || snapshot.copper >= cost;
  const enoughInventory = direction === 'buy' || (snapshot.inventory[item.id] || 0) >= quantity;
  return { kind: 'trade', status: enoughCopper && enoughInventory ? 'ready' : 'blocked', reason: enoughCopper ? (enoughInventory ? '' : 'insufficient-inventory') : 'insufficient-copper', itemId: item.id, quantity, direction, cost };
}

function craftReadiness(input, snapshot) {
  const recipe = getSettlementRecipe(input.recipeId);
  if (!recipe) return { kind: 'craft', status: 'blocked', reason: 'unknown-recipe', recipeId: text(input.recipeId) };
  const result = resolveCraftingRecipe(recipe.id, snapshot);
  return { kind: 'craft', status: result?.ok ? 'ready' : 'blocked', reason: result?.ok ? '' : text(result?.reason, 'missing-materials'), recipeId: recipe.id, label: text(recipe.label, recipe.id), station: text(recipe.station), missing: clone(result?.missing ?? []), xp: integer(recipe.xp, 0, 9999, 0), minutes: integer(recipe.minutes, 0, 9999, 0) };
}

function travelReadiness(input, snapshot) {
  const route = getSettlementRoute(input.routeId);
  const quote = route ? resolveTravelCost(route.id, { costRate: finite(input.costRate, 0), fatigueRate: finite(input.fatigueRate, 0) }) : null;
  if (!route || !quote?.ok) return { kind: 'travel', status: 'blocked', reason: quote?.reason ?? 'unknown-route', routeId: text(input.routeId), cost: 0 };
  const cost = integer(quote.cost, 0, 999999, 0);
  const canAfford = snapshot.copper >= cost;
  const fatigueBlocked = snapshot.fatigue >= integer(input.fatigueThreshold, 0, 100, 92);
  return { kind: 'travel', status: canAfford && !fatigueBlocked ? 'ready' : 'blocked', reason: !canAfford ? 'insufficient-copper' : fatigueBlocked ? 'fatigue-high' : '', routeId: route.id, label: text(route.label, route.id), cost };
}

export function createSettlementServiceReadiness(options = {}) {
  const snapshot = normalizeSnapshot(options.snapshot ?? {});
  const serviceIds = Array.isArray(options.serviceIds) ? options.serviceIds.map((id) => text(id)).filter(Boolean).slice(0, SETTLEMENT_SERVICE_READINESS_LIMITS.services) : ['gate', 'tavern', 'market', 'blacksmith', 'farm', 'barracks', 'stable', 'house'];
  const services = serviceIds.map((id) => serviceState(id, snapshot, options));
  const intents = Array.isArray(options.intents) ? options.intents.slice(0, 24).map((intent) => {
    const input = intent && typeof intent === 'object' ? intent : {};
    if (input.kind === 'trade') return tradeReadiness(input, snapshot);
    if (input.kind === 'craft') return craftReadiness(input, snapshot);
    if (input.kind === 'travel') return travelReadiness(input, snapshot);
    return { kind: text(input.kind, 'unknown'), status: 'blocked', reason: 'unsupported-intent' };
  }) : [];
  const readyCount = services.filter((item) => item.status === 'ready').length + intents.filter((item) => item.status === 'ready').length;
  const blockedCount = services.filter((item) => item.status !== 'ready').length + intents.filter((item) => item.status !== 'ready').length;
  const result = { version: SETTLEMENT_SERVICE_READINESS_VERSION, services, intents, summary: { readyCount, blockedCount, fatigue: snapshot.fatigue, health: snapshot.health, copper: snapshot.copper }, digest: '' };
  result.digest = stable({ ...result, digest: undefined });
  return freeze(result);
}
