/**
 * Settlement campaign runtime adapter.
 * Existing SettlementVerticalSlice owns action orchestration; this module adds
 * content-driven UX, deterministic quotes and injectable persistence hooks.
 */
import { createSettlementVerticalSlice } from './settlementVerticalSlice.js';
import {
  SETTLEMENT_CONTENT_VERSION,
  createSettlementContentManifest,
  getSettlementService,
  getSettlementItem,
  getSettlementRecipe,
  getSettlementRoute,
  getSettlementPerk,
  getSettlementDialogueCondition,
  getSettlementQuestObjective,
  getSettlementUxMessage,
  getSettlementSaveMigration,
  resolveCraftingRecipe,
  resolveTradeQuote,
  resolveTravelCost,
  validateSettlementContent,
} from './settlementCampaignContent.js';

export const SETTLEMENT_CAMPAIGN_RUNTIME_VERSION = 1;
export const SETTLEMENT_CAMPAIGN_LIMITS = Object.freeze({
  history: 64, requests: 64, route: 24, panels: 24, text: 160,
});
const ACTION_HANDLER = Object.freeze({
  enter: 'enterSettlement', exit: 'exitSettlement', interact: 'interact', talk: 'talk',
  trade: 'trade', craft: 'craft', acceptQuest: 'acceptQuest', advanceQuest: 'advanceQuest',
  travel: 'travel', save: 'save',
});
const ACTION_SERVICE = Object.freeze({
  enter: 'gate', exit: 'gate', travel: 'gate', trade: 'market', buy: 'market', sell: 'market',
  craft: 'blacksmith', equip: 'blacksmith', talk: 'tavern', rest: 'tavern',
  acceptQuest: 'tavern', advanceQuest: 'tavern', train: 'barracks', interact: 'house', save: 'house',
});
const ACTIONS = Object.freeze([
  'enter', 'exit', 'interact', 'talk', 'trade', 'buy', 'sell', 'craft', 'equip',
  'acceptQuest', 'advanceQuest', 'travel', 'rest', 'train', 'save',
]);
const text = (value, fallback = '') => {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, SETTLEMENT_CAMPAIGN_LIMITS.text) : fallback;
};
const finite = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};
const integer = (value, min, max, fallback = min) => Math.max(
  min, Math.min(max, Math.trunc(finite(value, fallback))),
);
const clone = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));
const unique = (values = []) => [...new Set(values.filter(Boolean))];
function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}
function digest(value) {
  let hash = 2166136261;
  const source = stable(value);
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
function normalizeSnapshot(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const inventory = {};
  const equipment = {};
  const quests = {};
  const skills = {};
  const flags = {};
  for (const [key, value] of Object.entries(source.inventory ?? {}).slice(0, 96)) inventory[text(key)] = integer(value, 0, 9999, 0);
  for (const [key, value] of Object.entries(source.equipment ?? {}).slice(0, 24)) equipment[text(key)] = text(value);
  for (const [key, value] of Object.entries(source.skills ?? {}).slice(0, 24)) skills[text(key)] = integer(value, 0, 999, 0);
  for (const [key, value] of Object.entries(source.flags ?? {}).slice(0, 64)) flags[text(key)] = Boolean(value);
  for (const [key, rawQuest] of Object.entries(source.quests ?? {}).slice(0, 64)) {
    const record = rawQuest && typeof rawQuest === 'object' ? rawQuest : {};
    quests[text(key)] = {
      state: text(record.state, 'unknown'), step: integer(record.step, 0, 999, 0),
      completed: Boolean(record.completed), rewardClaimed: Boolean(record.rewardClaimed),
    };
  }
  return {
    version: integer(source.version, 1, 999, 1), copper: integer(source.copper, 0, 999999, 0),
    fatigue: Math.max(0, Math.min(100, finite(source.fatigue, 0))),
    health: Math.max(0, Math.min(100, finite(source.health, 100))),
    maxHealth: Math.max(1, Math.min(999, finite(source.maxHealth, 100))),
    carryWeight: Math.max(0, finite(source.carryWeight, 0)),
    maxCarryWeight: Math.max(1, finite(source.maxCarryWeight, 24)),
    reputation: Math.max(-9999, Math.min(9999, finite(source.reputation, 0))),
    locationId: text(source.locationId), settlementId: text(source.settlementId, 'settlement'),
    inventory, equipment, quests, skills, flags,
    perks: unique(Array.isArray(source.perks) ? source.perks.map((item) => text(item)) : []),
    survival: {
      hunger: Math.max(0, Math.min(100, finite(source.survival?.hunger, 0))),
      exposure: Math.max(0, Math.min(100, finite(source.survival?.exposure, 0))),
      morale: Math.max(-100, Math.min(100, finite(source.survival?.morale, 0))),
    },
  };
}
function conditionResult(conditionId, snapshot) {
  const condition = getSettlementDialogueCondition(conditionId);
  if (!condition) return { ok: false, reason: 'unknown-condition' };
  if (condition.type === 'flag') return snapshot.flags[condition.target] === true
    ? { ok: true, reason: '' } : { ok: false, reason: 'flag-required' };
  if (condition.type === 'reputation') return snapshot.reputation >= condition.threshold
    ? { ok: true, reason: '' } : { ok: false, reason: 'reputation-too-low' };
  if (condition.type === 'quest') {
    const quest = snapshot.quests[condition.target];
    return quest?.completed || quest?.state === 'completed'
      ? { ok: true, reason: '' } : { ok: false, reason: 'quest-required' };
  }
  if (condition.type === 'item') return (snapshot.inventory[condition.target] || 0) >= condition.threshold
    ? { ok: true, reason: '' } : { ok: false, reason: 'item-required' };
  if (condition.type === 'skill') return (snapshot.skills[condition.target] || 0) >= condition.threshold
    ? { ok: true, reason: '' } : { ok: false, reason: 'skill-required' };
  return { ok: false, reason: 'unsupported-condition' };
}
function handlerResult(result, action, nodeId) {
  if (!result || typeof result !== 'object') return { ok: false, action, nodeId, reason: 'action-rejected', message: '' };
  return {
    ok: result.ok === true, action: text(result.action, action), nodeId: text(result.nodeId, nodeId),
    reason: text(result.reason, result.ok === true ? '' : 'action-rejected'),
    message: text(result.message), data: clone(result.data),
  };
}
function panelData(snapshot, panel) {
  if (panel === 'trade') return Object.keys(snapshot.inventory).slice(0, 24).map((itemId) => {
    const item = getSettlementItem(itemId);
    return item ? { id: itemId, label: item.label, quantity: snapshot.inventory[itemId], buy: item.buy, sell: item.sell } : null;
  }).filter(Boolean);
  if (panel === 'craft') return ['iron_sword', 'iron_dagger', 'steel_buckle', 'leather_gloves', 'travel_rations'].map((recipeId) => {
    const recipe = getSettlementRecipe(recipeId);
    if (!recipe) return null;
    const check = resolveCraftingRecipe(recipeId, snapshot);
    return { id: recipeId, label: recipe.label, station: recipe.station, ready: check.ok, missing: check.missing ?? [], xp: recipe.xp, minutes: recipe.minutes };
  }).filter(Boolean);
  if (panel === 'travel') return ['north_gate', 'river_market', 'hill_fort', 'old_mill', 'east_road', 'winter_pass'].map((routeId) => {
    const route = getSettlementRoute(routeId);
    const rate = snapshot.perks.includes('roadwise') ? -0.07 : 0;
    return { ...route, quote: resolveTravelCost(routeId, { costRate: rate, fatigueRate: rate }) };
  });
  if (panel === 'quests') return Object.entries(snapshot.quests).slice(0, 16).map(([id, quest]) => ({ id, ...quest }));
  if (panel === 'perks') return snapshot.perks.slice(0, 24).map((id) => getSettlementPerk(id)).filter(Boolean);
  return [];
}
export function createSettlementCampaignRuntime(options = {}) {
  const slice = options.slice ?? createSettlementVerticalSlice({ definition: options.definition, handlers: options.handlers });
  const handlers = options.handlers && typeof options.handlers === 'object' ? options.handlers : {};
  const readState = typeof options.readState === 'function' ? options.readState : () => options.initialState ?? {};
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const onEvent = typeof options.onEvent === 'function' ? options.onEvent : null;
  const historyLimit = integer(options.historyLimit, 1, 64, 64);
  const requestLimit = integer(options.requestLimit, 1, 64, 64);
  let disposed = false;
  let state = { revision: 0, panel: 'overview', activeService: null, route: [], history: [], requestIds: [], lastAction: null, feedback: null };
  let sequence = 0;
  const emit = (name, payload = {}) => onEvent?.({ name, at: now(), revision: state.revision, ...clone(payload) });
  const addHistory = (entry) => {
    state = { ...state, revision: state.revision + 1, history: [...state.history, { sequence: ++sequence, at: now(), ...clone(entry) }].slice(-historyLimit) };
  };
  const feedback = (status, code, message, action = '') => {
    const value = { status, code: text(code), message: text(message, 'İşlem sonucu güncellendi.'), action: text(action) };
    state = { ...state, revision: state.revision + 1, feedback: value };
    emit('feedback', { feedback: value });
    return clone(value);
  };
  const guard = (action) => disposed ? feedback('error', 'disposed', 'Yerleşim oturumu kapatıldı.', action) : null;
  const player = () => normalizeSnapshot(readState());
  const open = (serviceId, panel = 'overview') => {
    const blocked = guard('open'); if (blocked) return blocked;
    const service = getSettlementService(serviceId);
    if (!service) return feedback('blocked', 'unknown-service', 'Bilinmeyen hizmet.', 'open');
    const nextPanel = ['overview', 'trade', 'craft', 'travel', 'quests', 'perks'].includes(panel) ? panel : 'overview';
    state = { ...state, activeService: service.id, panel: nextPanel, route: [...state.route, service.id].slice(-24), feedback: null, revision: state.revision + 1 };
    addHistory({ type: 'open', serviceId: service.id, panel: nextPanel }); emit('service-opened', { service: clone(service) });
    return getViewModel();
  };
  const close = () => {
    const blocked = guard('close'); if (blocked) return blocked;
    const serviceId = state.activeService;
    state = { ...state, activeService: null, panel: 'overview', route: [], revision: state.revision + 1 };
    addHistory({ type: 'close', serviceId }); emit('service-closed', { serviceId }); return getViewModel();
  };
  const setPanel = (panel) => {
    const blocked = guard('panel'); if (blocked) return blocked;
    const next = ['overview', 'trade', 'craft', 'travel', 'quests', 'perks'].includes(panel) ? panel : 'overview';
    state = { ...state, panel: next, revision: state.revision + 1 }; addHistory({ type: 'panel', panel: next }); return getViewModel();
  };
  const execute = async (action, input = {}) => {
    const blocked = guard(action); if (blocked) return blocked;
    if (!ACTIONS.includes(action) && !handlers[action]) return feedback('blocked', 'unknown-action', 'Bilinmeyen yerleşim işlemi.', action);
    const requestId = text(input.requestId, `req-${sequence + 1}`);
    if (state.requestIds.includes(requestId)) return feedback('blocked', 'duplicate-request', 'Bu işlem isteği zaten işlendi.', action);
    state = { ...state, requestIds: [...state.requestIds, requestId].slice(-requestLimit) };
    const snapshot = player();
    const serviceId = ACTION_SERVICE[action] ?? state.activeService;
    const service = serviceId ? getSettlementService(serviceId) : null;
    const quote = ['trade', 'buy', 'sell'].includes(action) ? resolveTradeQuote(input.itemId, input.quantity, input.direction ?? (action === 'sell' ? 'sell' : 'buy'), {
      buyRate: snapshot.perks.includes('merchant_road') ? -0.04 : 0, sellRate: snapshot.perks.includes('market_eye') ? 0.05 : 0,
    }) : null;
    const recipe = action === 'craft' ? getSettlementRecipe(input.recipeId) : null;
    const craftCheck = action === 'craft' ? resolveCraftingRecipe(input.recipeId, snapshot) : null;
    const travel = action === 'travel' ? resolveTravelCost(input.routeId, {
      costRate: snapshot.perks.includes('roadwise') ? -0.07 : 0, fatigueRate: snapshot.perks.includes('roadwise') ? -0.07 : 0,
    }) : null;
    if (['trade', 'buy', 'sell'].includes(action) && !quote?.ok) return feedback('blocked', quote?.reason, 'Takas kalemi kullanılamıyor.', action);
    if (action === 'craft' && (!recipe || !craftCheck?.ok)) return feedback('blocked', craftCheck?.reason ?? 'unknown-recipe', 'Üretim için malzeme hazır değil.', action);
    if (action === 'travel' && (!travel?.ok || snapshot.copper < travel.cost)) return feedback('blocked', snapshot.copper < (travel?.cost ?? 0) ? 'insufficient-copper' : travel?.reason, 'Seyahat koşulları sağlanmıyor.', action);
    const handlerName = ACTION_HANDLER[action] ?? action;
    const handler = handlers[handlerName] ?? handlers[action];
    let result;
    if (typeof handler === 'function') {
      try { result = handlerResult(await handler({ action, requestId, node: { id: text(input.nodeId, service?.id ?? state.activeService ?? 'settlement'), serviceId, kind: service?.kind ?? 'settlement' }, service: clone(service), snapshot, input: clone(input), quote, recipe: clone(recipe), craftCheck: clone(craftCheck), travel: clone(travel), slice }), action, service?.id); }
      catch (error) { result = { ok: false, action, nodeId: service?.id ?? '', reason: 'handler-threw', message: text(error?.message, 'İşlem sırasında hata oluştu.') }; }
    } else if (typeof slice.executeAction === 'function') result = handlerResult(await slice.executeAction(action, { requestId, nodeId: service?.id, snapshot, input: clone(input) }), action, service?.id);
    else result = { ok: false, action, nodeId: service?.id ?? '', reason: 'handler-unavailable', message: 'Bu işlem için mevcut otorite handler sağlamıyor.' };
    state = { ...state, lastAction: action, feedback: { status: result.ok ? 'success' : 'blocked', code: result.reason, message: result.message || (result.ok ? 'İşlem tamamlandı.' : 'İşlem gerçekleştirilemedi.'), action }, revision: state.revision + 1 };
    addHistory({ type: 'execute', action, serviceId, requestId, ok: result.ok, reason: result.reason, quote, travel, recipeId: recipe?.id });
    emit(result.ok ? 'action-succeeded' : 'action-blocked', { action, result });
    return { ...result, view: getViewModel() };
  };
  const evaluateDialogue = (conditionIds = []) => {
    const result = conditionIds.slice(0, 8).map((conditionId) => ({ conditionId, ...conditionResult(conditionId, player()) }));
    return { ok: result.every((item) => item.ok), checks: result };
  };
  const getObjective = (objectiveId) => {
    const objective = getSettlementQuestObjective(objectiveId); if (!objective) return null;
    const snapshot = player();
    if (['collect', 'deliver', 'equip', 'craft'].includes(objective.type)) return { ...objective, progress: Math.min(objective.quantity, snapshot.inventory[objective.target] || 0) };
    if (objective.type === 'travel') return { ...objective, progress: snapshot.locationId === getSettlementRoute(objective.target)?.destination ? 1 : 0 };
    if (objective.type === 'rest') return { ...objective, progress: snapshot.fatigue <= 25 ? 1 : 0 };
    return { ...objective, progress: 0 };
  };
  const exportState = () => ({ version: 1, runtimeVersion: SETTLEMENT_CAMPAIGN_RUNTIME_VERSION, contentVersion: SETTLEMENT_CONTENT_VERSION, panel: state.panel, activeService: state.activeService, route: [...state.route], history: clone(state.history), requestIds: [...state.requestIds], lastAction: state.lastAction, revision: state.revision });
  const importState = (raw) => {
    const source = raw && typeof raw === 'object' ? raw : {};
    if (integer(source.version, 0, 999, 0) !== 1) return { ok: false, reason: 'invalid-runtime-state' };
    if (source.activeService && !getSettlementService(source.activeService)) return { ok: false, reason: 'unknown-service' };
    state = { ...state, panel: text(source.panel, 'overview'), activeService: text(source.activeService), route: Array.isArray(source.route) ? source.route.map(text).filter(Boolean).slice(-24) : [], history: Array.isArray(source.history) ? clone(source.history).slice(-historyLimit) : [], requestIds: Array.isArray(source.requestIds) ? unique(source.requestIds.map(text)).slice(-requestLimit) : [], lastAction: text(source.lastAction), revision: Math.max(state.revision, integer(source.revision, 0, 999999, 0)) };
    emit('runtime-state-restored', { state: exportState() }); return { ok: true, state: exportState() };
  };
  const save = async (metadata = {}) => execute('save', { ...metadata, requestId: metadata.requestId ?? `save-${sequence + 1}` });
  const manifest = () => {
    const payload = { runtimeVersion: SETTLEMENT_CAMPAIGN_RUNTIME_VERSION, contentVersion: SETTLEMENT_CONTENT_VERSION, content: createSettlementContentManifest(), state: exportState() };
    return { ...payload, digest: digest(payload) };
  };
  function getViewModel() {
    const snapshot = player();
    return { version: SETTLEMENT_CAMPAIGN_RUNTIME_VERSION, contentVersion: SETTLEMENT_CONTENT_VERSION, revision: state.revision, activeService: state.activeService ? clone(getSettlementService(state.activeService)) : null, panel: state.panel, lastAction: state.lastAction, feedback: clone(state.feedback), player: snapshot, route: [...state.route], history: clone(state.history), settlement: typeof slice.getState === 'function' ? clone(slice.getState()) : null, availableActions: typeof slice.availableActions === 'function' ? unique(slice.availableActions(snapshot)) : [], panels: { overview: [], trade: panelData(snapshot, 'trade'), craft: panelData(snapshot, 'craft'), travel: panelData(snapshot, 'travel'), quests: panelData(snapshot, 'quests'), perks: panelData(snapshot, 'perks') } };
  }
  const reset = () => { state = { revision: state.revision + 1, panel: 'overview', activeService: null, route: [], history: [], requestIds: [], lastAction: null, feedback: null }; emit('runtime-reset', { state: exportState() }); return getViewModel(); };
  const dispose = () => { disposed = true; emit('runtime-disposed', { state: exportState() }); return { ok: true }; };
  return Object.freeze({ open, close, setPanel, execute, save, evaluateDialogue, getObjective, exportState, importState, manifest, reset, dispose, getViewModel, validateContent: validateSettlementContent, getService: getSettlementService, getItem: getSettlementItem, getRecipe: getSettlementRecipe, getRoute: getSettlementRoute, getPerk: getSettlementPerk, getDialogueCondition: getSettlementDialogueCondition, getUxMessage: getSettlementUxMessage, getSaveMigration: getSettlementSaveMigration, getSlice: () => slice, isDisposed: () => disposed, get version() { return SETTLEMENT_CAMPAIGN_RUNTIME_VERSION; } });
}
