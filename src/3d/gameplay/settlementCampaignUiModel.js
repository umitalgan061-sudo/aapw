/**
 * Read-only settlement campaign presentation model.
 * No DOM, renderer, inventory, quest or persistence ownership lives here.
 */
import {
  getSettlementService, getSettlementUxMessage, getSettlementQuestObjective,
  getSettlementRecipe, getSettlementRoute, getSettlementPerk, getSettlementDialogueCondition,
} from './settlementCampaignContent.js';

export const SETTLEMENT_CAMPAIGN_UI_VERSION = 1;
const text = (value, fallback = '') => {
  const result = String(value ?? '').trim();
  return result ? result.slice(0, 160) : fallback;
};
const clone = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));
const uniq = (values = []) => [...new Set(values.filter(Boolean))];

function actionMeta(action) {
  const map = {
    enter: ['Kapı', 'İçeri gir', 'navigation'], exit: ['Kapı', 'Dışarı çık', 'navigation'],
    interact: ['Etkileşim', 'Etkileş', 'interaction'], talk: ['Diyalog', 'Konuş', 'dialogue'],
    trade: ['Ekonomi', 'Takas', 'economy'], buy: ['Ekonomi', 'Satın al', 'economy'],
    sell: ['Ekonomi', 'Sat', 'economy'], craft: ['Üretim', 'Üret', 'crafting'],
    equip: ['Ekipman', 'Kuşan', 'equipment'], acceptQuest: ['Görev', 'Görevi kabul et', 'quest'],
    advanceQuest: ['Görev', 'Görevi ilerlet', 'quest'], travel: ['Seyahat', 'Yola çık', 'travel'],
    rest: ['Dinlenme', 'Dinlen', 'survival'], train: ['Eğitim', 'Antrenman yap', 'progression'],
    save: ['Kayıt', 'Oyunu kaydet', 'persistence'],
  };
  const value = map[action] ?? ['İşlem', text(action, 'Etkileş'), 'interaction'];
  return { action, section: value[0], label: value[1], intent: value[2] };
}

function buildActions(actions = [], feedback) {
  return uniq(actions).map((action) => {
    const meta = actionMeta(action);
    return { ...meta, enabled: feedback?.action === action ? feedback.status !== 'blocked' : true, feedbackCode: feedback?.action === action ? text(feedback.code) : '' };
  });
}

function questSummary(quests = {}) {
  return Object.entries(quests).slice(0, 16).map(([id, value]) => {
    const objective = getSettlementQuestObjective(id);
    const record = value && typeof value === 'object' ? value : {};
    return { id, state: text(record.state, 'unknown'), step: Number(record.step) || 0, completed: Boolean(record.completed), rewardClaimed: Boolean(record.rewardClaimed), authoredObjective: objective ? clone(objective) : null };
  });
}

function skillSummary(skills = {}) {
  return Object.entries(skills).slice(0, 12).map(([id, level]) => ({ id, level: Math.max(0, Number(level) || 0) }));
}

function equipmentSummary(equipment = {}) {
  return Object.entries(equipment).slice(0, 12).map(([slot, itemId]) => ({ slot, itemId: text(itemId), item: itemId ? clone(getSettlementUxMessage(itemId) ? null : itemId) : null }));
}

export function createSettlementCampaignUiModel(runtime) {
  if (!runtime || typeof runtime.getViewModel !== 'function') throw new TypeError('Settlement campaign UI model requires runtime.getViewModel().');
  const snapshot = () => runtime.getViewModel();
  function build() {
    const view = snapshot();
    const service = view.activeService;
    const serviceMeta = service ? getSettlementService(service.id) : null;
    const player = view.player ?? {};
    const serviceCard = serviceMeta ? { id: serviceMeta.id, label: serviceMeta.label, kind: serviceMeta.kind, domain: serviceMeta.domain, prompt: serviceMeta.prompt, actions: serviceMeta.actions.map(actionMeta) } : null;
    return {
      version: SETTLEMENT_CAMPAIGN_UI_VERSION, runtimeVersion: view.version, contentVersion: view.contentVersion,
      revision: view.revision,
      header: { title: serviceCard?.label ?? 'Yerleşim', subtitle: serviceCard?.prompt ?? 'Yakındaki hizmetleri seç.', location: text(player.locationId, player.settlementId) },
      service: serviceCard, actions: buildActions(view.availableActions, view.feedback), route: (view.route ?? []).slice(-24),
      feedback: clone(view.feedback),
      status: { copper: player.copper ?? 0, fatigue: player.fatigue ?? 0, health: player.health ?? 0, maxHealth: player.maxHealth ?? 100, carryWeight: player.carryWeight ?? 0, maxCarryWeight: player.maxCarryWeight ?? 1, reputation: player.reputation ?? 0 },
      survival: clone(player.survival ?? {}),
      inventory: Object.entries(player.inventory ?? {}).slice(0, 24).map(([id, quantity]) => ({ id, quantity, item: clone(runtime.getItem(id)) })).filter(item => item.quantity > 0),
      equipment: equipmentSummary(player.equipment), skills: skillSummary(player.skills),
      perks: (player.perks ?? []).slice(0, 24).map((id) => getSettlementPerk(id)).filter(Boolean),
      quests: questSummary(player.quests),
      panels: { trade: clone(view.panels?.trade ?? []), craft: clone(view.panels?.craft ?? []), travel: clone(view.panels?.travel ?? []), quests: clone(view.panels?.quests ?? []), perks: clone(view.panels?.perks ?? []) },
      notifications: (view.history ?? []).slice(-12).map((entry) => ({ sequence: entry.sequence, type: text(entry.type), action: text(entry.action), ok: entry.ok !== false, reason: text(entry.reason) })),
    };
  }
  function describeQuest(objectiveId) {
    const objective = getSettlementQuestObjective(objectiveId);
    return objective ? { ok: true, ...clone(objective) } : { ok: false, reason: 'unknown-objective' };
  }
  function describeDialogue(conditionId) {
    const condition = getSettlementDialogueCondition(conditionId);
    return condition ? { ok: true, ...clone(condition) } : { ok: false, reason: 'unknown-condition' };
  }
  function describeRecipe(recipeId) {
    const recipe = getSettlementRecipe(recipeId);
    if (!recipe) return { ok: false, reason: 'unknown-recipe' };
    const row = snapshot().panels?.craft?.find(item => item.id === recipeId);
    return { ok: true, ...clone(recipe), ready: Boolean(row?.ready), missing: clone(row?.missing ?? []) };
  }
  function describeTravel(routeId) {
    const route = getSettlementRoute(routeId);
    if (!route) return { ok: false, reason: 'unknown-route' };
    const row = snapshot().panels?.travel?.find(item => item.id === routeId);
    return { ok: true, ...clone(route), quotedCost: row?.quote?.cost ?? route.cost, quotedFatigue: row?.quote?.fatigue ?? route.fatigue };
  }
  return Object.freeze({ build, describeQuest, describeDialogue, describeRecipe, describeTravel, getActionMeta: actionMeta });
}
