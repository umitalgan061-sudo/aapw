/**
 * Pure settlement action preflight for UI affordances.
 *
 * This is intentionally read-only: it reuses the existing settlement content
 * registry and never mutates SettlementVerticalSlice, inventory, economy,
 * crafting, travel or persistence state.
 */
import {
  getSettlementItem,
  getSettlementRecipe,
  getSettlementRoute,
  getSettlementService,
  resolveCraftingRecipe,
  resolveTradeQuote,
  resolveTravelCost,
} from './settlementCampaignContent.js';

export const SETTLEMENT_ACTION_PREVIEW_VERSION = 1;
const ACTION_SERVICE = Object.freeze({
  enter: 'gate', exit: 'gate', travel: 'gate', trade: 'market', buy: 'market', sell: 'market',
  craft: 'blacksmith', equip: 'blacksmith', talk: 'tavern', rest: 'tavern',
  acceptQuest: 'tavern', advanceQuest: 'tavern', train: 'barracks', interact: 'house', save: 'house',
});
const ACTIONS = new Set(['enter', 'exit', 'interact', 'talk', 'trade', 'buy', 'sell', 'craft', 'equip', 'acceptQuest', 'advanceQuest', 'travel', 'rest', 'train', 'save']);
const PANELS = new Set(['overview', 'trade', 'craft', 'travel', 'quests', 'perks']);
const text = (value, fallback = '') => {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, 160) : fallback;
};
const finite = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};
const integer = (value, min, max, fallback = min) => Math.max(min, Math.min(max, Math.trunc(finite(value, fallback))));
const clone = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));
const list = (value) => (Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : []);
const snapshotOf = (raw = {}) => {
  const source = raw && typeof raw === 'object' ? raw : {};
  const inventory = {};
  for (const [key, value] of Object.entries(source.inventory ?? {}).slice(0, 96)) inventory[text(key)] = integer(value, 0, 9999, 0);
  return {
    copper: integer(source.copper, 0, 999999, 0),
    fatigue: Math.max(0, Math.min(100, finite(source.fatigue, 0))),
    inventory,
    perks: list(source.perks),
  };
};
const blocked = (action, reason, message, extra = {}) => Object.freeze({
  version: SETTLEMENT_ACTION_PREVIEW_VERSION,
  action,
  ok: false,
  reason: text(reason, 'action-unavailable'),
  message: text(message, 'İşlem şu anda kullanılamıyor.'),
  requestMutation: false,
  ...clone(extra),
});

export function previewSettlementAction({ action, input = {}, snapshot = {}, activeService = null } = {}) {
  const safeAction = text(action);
  if (!ACTIONS.has(safeAction)) return blocked(safeAction, 'unknown-action', 'Bilinmeyen yerleşim işlemi.');
  const safeInput = input && typeof input === 'object' ? input : {};
  const player = snapshotOf(snapshot);
  const serviceId = ACTION_SERVICE[safeAction] ?? text(activeService);
  const service = serviceId ? getSettlementService(serviceId) : null;
  const base = { serviceId: service?.id ?? null, service: clone(service), requestMutation: false };

  if (['enter', 'exit', 'interact', 'talk', 'rest', 'train', 'equip', 'acceptQuest', 'advanceQuest', 'save'].includes(safeAction)) {
    return Object.freeze({ version: SETTLEMENT_ACTION_PREVIEW_VERSION, action: safeAction, ok: Boolean(service), reason: service ? '' : 'unknown-service', message: service ? (service.prompt ?? 'İşlem hazır.') : 'Hizmet bulunamadı.', ...base });
  }
  if (['trade', 'buy', 'sell'].includes(safeAction)) {
    const itemId = text(safeInput.itemId);
    const item = getSettlementItem(itemId);
    if (!item) return blocked(safeAction, 'unknown-item', 'Takas kalemi bulunamadı.', { ...base, itemId });
    const direction = text(safeInput.direction, safeAction === 'sell' ? 'sell' : 'buy');
    const quote = resolveTradeQuote(itemId, safeInput.quantity, direction, {
      buyRate: player.perks.includes('merchant_road') ? -0.04 : 0,
      sellRate: player.perks.includes('market_eye') ? 0.05 : 0,
    });
    if (!quote?.ok) return blocked(safeAction, quote?.reason, 'Takas miktarı veya fiyatı geçersiz.', { ...base, item: clone(item), quote: clone(quote) });
    const affordable = direction === 'sell' || player.copper >= quote.total;
    return Object.freeze({ version: SETTLEMENT_ACTION_PREVIEW_VERSION, action: safeAction, ok: affordable, reason: affordable ? '' : 'insufficient-copper', message: affordable ? 'Takas onaya hazır.' : 'Bu işlem için yeterli bakır yok.', ...base, item: clone(item), itemId, direction, quote: clone(quote), affordable });
  }
  if (safeAction === 'craft') {
    const recipeId = text(safeInput.recipeId);
    const recipe = getSettlementRecipe(recipeId);
    if (!recipe) return blocked(safeAction, 'unknown-recipe', 'Üretim tarifi bulunamadı.', { ...base, recipeId });
    const craftCheck = resolveCraftingRecipe(recipeId, snapshot);
    return Object.freeze({ version: SETTLEMENT_ACTION_PREVIEW_VERSION, action: safeAction, ok: craftCheck?.ok === true, reason: craftCheck?.ok ? '' : text(craftCheck?.reason, 'missing-materials'), message: craftCheck?.ok ? 'Üretim için malzeme hazır.' : 'Üretim için gerekli malzeme eksik.', ...base, recipeId, recipe: clone(recipe), craftCheck: clone(craftCheck) });
  }
  if (safeAction === 'travel') {
    const routeId = text(safeInput.routeId);
    const route = getSettlementRoute(routeId);
    if (!route) return blocked(safeAction, 'unknown-route', 'Seyahat rotası bulunamadı.', { ...base, routeId });
    const modifier = player.perks.includes('roadwise') ? -0.07 : 0;
    const travel = resolveTravelCost(routeId, { costRate: modifier, fatigueRate: modifier });
    const affordable = travel?.ok === true && player.copper >= travel.cost;
    return Object.freeze({ version: SETTLEMENT_ACTION_PREVIEW_VERSION, action: safeAction, ok: affordable, reason: affordable ? '' : (travel?.ok ? 'insufficient-copper' : text(travel?.reason, 'travel-unavailable')), message: affordable ? 'Seyahat onaya hazır.' : 'Seyahat koşulları sağlanmıyor.', ...base, routeId, route: clone(route), travel: clone(travel), affordable });
  }
  return blocked(safeAction, 'unsupported-action', 'Bu işlem için önizleme üretilemedi.', base);
}

export function previewSettlementPanel(panel, { snapshot = {}, activeService = null } = {}) {
  const safePanel = text(panel, 'overview');
  if (!PANELS.has(safePanel)) return Object.freeze({ version: SETTLEMENT_ACTION_PREVIEW_VERSION, panel: safePanel, ok: false, reason: 'unknown-panel', items: [] });
  const player = snapshotOf(snapshot);
  if (safePanel === 'trade') return Object.freeze({ version: SETTLEMENT_ACTION_PREVIEW_VERSION, panel: safePanel, ok: true, items: Object.keys(player.inventory).slice(0, 24).map((itemId) => ({ itemId, item: clone(getSettlementItem(itemId)), quantity: player.inventory[itemId], preview: previewSettlementAction({ action: 'trade', input: { itemId, quantity: 1 }, snapshot, activeService }) })) });
  if (safePanel === 'craft') return Object.freeze({ version: SETTLEMENT_ACTION_PREVIEW_VERSION, panel: safePanel, ok: true, items: ['iron_sword', 'iron_dagger', 'steel_buckle', 'leather_gloves', 'travel_rations'].map((recipeId) => previewSettlementAction({ action: 'craft', input: { recipeId }, snapshot, activeService })) });
  if (safePanel === 'travel') return Object.freeze({ version: SETTLEMENT_ACTION_PREVIEW_VERSION, panel: safePanel, ok: true, items: ['north_gate', 'river_market', 'hill_fort', 'old_mill', 'east_road', 'winter_pass'].map((routeId) => previewSettlementAction({ action: 'travel', input: { routeId }, snapshot, activeService })) });
  return Object.freeze({ version: SETTLEMENT_ACTION_PREVIEW_VERSION, panel: safePanel, ok: true, serviceId: text(activeService), items: [] });
}
