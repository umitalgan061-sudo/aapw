/**
 * Deterministic settlement loadout planner for the existing authored content.
 *
 * This is a read-only bridge for settlement UX: it suggests a bounded set of
 * items/recipes/routes for the current service and player context without
 * mutating inventory, economy, quest, travel or persistence state.
 */
import {
  getSettlementItem,
  getSettlementRecipe,
  getSettlementRoute,
  getSettlementService,
} from './settlementCampaignContent.js';

export const SETTLEMENT_LOADOUT_PLANNER_VERSION = 1;
const LIMIT = 8;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const cleanId = (value) => typeof value === 'string' ? value.trim() : '';
const clone = (value) => JSON.parse(JSON.stringify(value));
const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
};
const unique = (values) => [...new Set(values.filter(Boolean))];

function ownedCount(inventory, id) {
  const raw = inventory && typeof inventory === 'object' ? inventory[id] : 0;
  return Math.max(0, Math.floor(finite(raw, 0)));
}

function candidateItems(serviceId) {
  const tags = {
    blacksmith: ['ore', 'fuel', 'weapon', 'component'],
    market: ['food', 'basic', 'cloth', 'leather'],
    farm: ['food', 'herb', 'mount'],
    tavern: ['food', 'rest', 'healing'],
    stable: ['mount', 'travel'],
    gate: ['travel', 'food'],
  }[serviceId] || ['basic'];
  const ids = ['iron_ore', 'coal', 'herb', 'bread', 'stew', 'linen', 'leather', 'horse_feed', 'iron_sword', 'travel_rations', 'bandage', 'torch'];
  return ids.filter((id) => {
    const item = getSettlementItem(id);
    return item && item.tags.some((tag) => tags.includes(tag));
  });
}

function candidateRecipes(serviceId) {
  const ids = ['iron_sword', 'iron_dagger', 'steel_buckle', 'linen_tunic', 'leather_gloves', 'travel_rations'];
  return ids.filter((id) => getSettlementRecipe(id)?.station === serviceId);
}

function candidateRoutes(serviceId) {
  if (!['gate', 'stable', 'farm'].includes(serviceId)) return [];
  return ['north_gate', 'river_market', 'old_mill', 'east_road', 'winter_pass'].filter((id) => Boolean(getSettlementRoute(id)));
}

function scoreItem(item, serviceId, inventory, copper) {
  const count = ownedCount(inventory, item.id);
  const urgency = count === 0 ? 2 : count < 2 ? 1 : 0;
  const affordability = item.buy <= copper ? 1 : 0;
  const serviceBonus = item.tags.includes(serviceId === 'blacksmith' ? 'smithing' : serviceId === 'stable' ? 'travel' : 'food') ? 1 : 0;
  return urgency * 3 + affordability + serviceBonus;
}

export function planSettlementLoadout(input = {}) {
  const serviceId = cleanId(input.serviceId);
  const service = getSettlementService(serviceId);
  if (!service) return freeze({ version: SETTLEMENT_LOADOUT_PLANNER_VERSION, ok: false, reason: 'unknown-service', serviceId, items: [], recipes: [], routes: [], summary: 'Servis bulunamadı.' });
  const inventory = input.inventory && typeof input.inventory === 'object' ? input.inventory : {};
  const copper = Math.max(0, Math.floor(finite(input.copper, 0)));
  const fatigue = clamp(Math.floor(finite(input.fatigue, 0)), 0, 100);
  const items = candidateItems(serviceId)
    .map((id) => getSettlementItem(id))
    .sort((a, b) => scoreItem(b, serviceId, inventory, copper) - scoreItem(a, serviceId, inventory, copper) || a.id.localeCompare(b.id))
    .slice(0, LIMIT)
    .map((item) => ({ id: item.id, label: item.label, owned: ownedCount(inventory, item.id), buy: item.buy, affordable: item.buy <= copper, weight: item.weight, tags: [...item.tags] }));
  const recipes = candidateRecipes(serviceId).slice(0, LIMIT).map((id) => { const recipe = getSettlementRecipe(id); return { id, label: recipe.label, station: recipe.station, ingredients: clone(recipe.ingredients), xp: recipe.xp, minutes: recipe.minutes }; });
  const routes = candidateRoutes(serviceId).slice(0, LIMIT).map((id) => { const route = getSettlementRoute(id); return { id, label: route.label, destination: route.destination, cost: route.cost, fatigue: route.fatigue, risk: route.risk, affordable: route.cost <= copper, fatigueSafe: route.fatigue + fatigue <= 100 }; });
  const affordableItems = items.filter((item) => item.affordable).length;
  const safeRoutes = routes.filter((route) => route.affordable && route.fatigueSafe).length;
  return freeze({
    version: SETTLEMENT_LOADOUT_PLANNER_VERSION,
    ok: true,
    serviceId,
    service: { id: service.id, label: service.label, domain: service.domain },
    context: { copper, fatigue },
    items,
    recipes,
    routes,
    summary: `${service.label}: ${affordableItems} alınabilir eşya, ${recipes.length} tarif, ${safeRoutes} güvenli rota.`,
  });
}

export function serializeSettlementLoadoutPlan(plan) {
  return JSON.stringify(planSettlementLoadoutForSerialization(plan));
}

function planSettlementLoadoutForSerialization(plan) {
  return {
    version: plan?.version || SETTLEMENT_LOADOUT_PLANNER_VERSION,
    ok: Boolean(plan?.ok),
    serviceId: cleanId(plan?.serviceId),
    context: { copper: Math.max(0, Math.floor(finite(plan?.context?.copper, 0))), fatigue: clamp(Math.floor(finite(plan?.context?.fatigue, 0)), 0, 100) },
    items: Array.isArray(plan?.items) ? plan.items.map((item) => ({ id: cleanId(item.id), owned: ownedCount({ [item.id]: item.owned }, item.id), buy: Math.max(0, Math.floor(finite(item.buy, 0))), affordable: Boolean(item.affordable) })) : [],
    recipes: Array.isArray(plan?.recipes) ? plan.recipes.map((recipe) => ({ id: cleanId(recipe.id), station: cleanId(recipe.station), xp: Math.max(0, Math.floor(finite(recipe.xp, 0))), minutes: Math.max(0, Math.floor(finite(recipe.minutes, 0))) })) : [],
    routes: Array.isArray(plan?.routes) ? plan.routes.map((route) => ({ id: cleanId(route.id), cost: Math.max(0, Math.floor(finite(route.cost, 0))), fatigue: Math.max(0, Math.floor(finite(route.fatigue, 0))), affordable: Boolean(route.affordable), fatigueSafe: Boolean(route.fatigueSafe) })) : [],
  };
}

export function summarizeSettlementLoadoutPlan(plan) {
  return Object.freeze({
    ok: Boolean(plan?.ok),
    serviceId: cleanId(plan?.serviceId),
    itemCount: Array.isArray(plan?.items) ? plan.items.length : 0,
    recipeCount: Array.isArray(plan?.recipes) ? plan.recipes.length : 0,
    routeCount: Array.isArray(plan?.routes) ? plan.routes.length : 0,
    affordableItemCount: Array.isArray(plan?.items) ? plan.items.filter((item) => item.affordable).length : 0,
    safeRouteCount: Array.isArray(plan?.routes) ? plan.routes.filter((route) => route.affordable && route.fatigueSafe).length : 0,
    digest: serializeSettlementLoadoutPlan(plan),
  });
}
