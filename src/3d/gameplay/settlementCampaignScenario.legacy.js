/**
 * Authored settlement scenario pack.
 *
 * The scenario is intentionally data-driven and delegates every mutation to
 * existing RPG owners through action names. It is useful both for the shipped
 * vertical slice and for deterministic acceptance tests.
 */
import { getSettlementService, getSettlementRecipe, getSettlementRoute, getSettlementQuestObjective } from './settlementCampaignContent.js';
import { evaluateActionRule, evaluateDialogueConditions, evaluateObjectiveRule, evaluateEncumbrance, normalizeRpgSnapshot } from './settlementCampaignRules.js';
import { buildSettlementShopCatalog, quoteSettlementPurchase, quoteSettlementSale } from './settlementCampaignShop.js';
import { buildSettlementJourney, getSettlementJourneyStage } from './settlementCampaignJourney.js';
import { buildSettlementDialogueGraph, getSettlementDialogueBranch } from './settlementCampaignDialogue.js';
import { buildSurvivalReport, calculateFoodNeed, calculateTravelSurvival } from './settlementCampaignSurvival.js';
import { calculateActionXp, calculateQuestObjectiveXp, buildSettlementProgressionEnvelope } from './settlementCampaignProgression.js';

export const SETTLEMENT_SCENARIO_VERSION = 1;
export const SETTLEMENT_SCENARIO_ID = 'north-settlement-iron-and-road';
export const SETTLEMENT_SCENARIO_LIMITS = Object.freeze({ steps: 48, branches: 16, objectives: 16, rewards: 32, hints: 64 });

const text = (value, fallback = '') => {
  const v = String(value ?? '').trim();
  return v ? v.slice(0, 160) : fallback;
};
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const integer = (value, min = 0, max = 999999) => Math.max(min, Math.min(max, Math.trunc(Number(value) || 0)));

const STEP_DEFINITIONS = Object.freeze([
  { id: 'arrival', stage: 'arrival', service: 'gate', action: 'enter', node: 'settlement', title: 'Kapıdan giriş', objective: 'settlement-objective-01', reward: 18, hint: 'Kapıdaki etkileşimi tamamla.' },
  { id: 'orientation', stage: 'orientation', service: 'tavern', action: 'talk', node: 'tavern', objective: 'settlement-objective-02', reward: 22, hint: 'Han sahibinden yerleşimi öğren.' },
  { id: 'market-scout', stage: 'commerce', service: 'market', action: 'talk', node: 'market', objective: 'settlement-objective-03', reward: 18, hint: 'Pazarın stoklarını incele.' },
  { id: 'market-buy', stage: 'commerce', service: 'market', action: 'buy', node: 'market', objective: 'settlement-objective-04', reward: 26, hint: 'Yol için temel yiyecek al.' },
  { id: 'market-sell', stage: 'commerce', service: 'market', action: 'sell', node: 'market', objective: 'settlement-objective-05', reward: 24, hint: 'Fazla malzemeyi sat.' },
  { id: 'blacksmith-talk', stage: 'crafting', service: 'blacksmith', action: 'talk', node: 'blacksmith', objective: 'settlement-objective-06', reward: 24, hint: 'Demirciden üretim işini öğren.' },
  { id: 'iron-sword', stage: 'crafting', service: 'blacksmith', action: 'craft', node: 'blacksmith', recipe: 'iron_sword', objective: 'settlement-objective-07', reward: 44, hint: 'Demir kılıcı üret.' },
  { id: 'equip-sword', stage: 'crafting', service: 'blacksmith', action: 'equip', node: 'blacksmith', item: 'iron_sword', objective: 'settlement-objective-08', reward: 34, hint: 'Üretilen silahı kuşan.' },
  { id: 'tavern-quest', stage: 'dialogue', service: 'tavern', action: 'acceptQuest', node: 'tavern', objective: 'settlement-objective-09', reward: 30, hint: 'Yerel tedarik görevini kabul et.' },
  { id: 'tavern-advance', stage: 'quest', service: 'tavern', action: 'advanceQuest', node: 'tavern', objective: 'settlement-objective-10', reward: 46, hint: 'Görev adımını ilerlet.' },
  { id: 'recover', stage: 'recovery', service: 'tavern', action: 'rest', node: 'tavern', objective: 'settlement-objective-11', reward: 16, hint: 'Yorgunluğu düşür.' },
  { id: 'house-save', stage: 'recovery', service: 'house', action: 'save', node: 'house', objective: 'settlement-objective-12', reward: 20, hint: 'İlerlemeni kaydet.' },
  { id: 'stable-check', stage: 'departure', service: 'stable', action: 'talk', node: 'stable', objective: 'settlement-objective-13', reward: 22, hint: 'Binek yol hazırlığını doğrula.' },
  { id: 'gate-travel', stage: 'departure', service: 'gate', action: 'travel', node: 'gate', objective: 'settlement-objective-14', reward: 52, hint: 'Kuzey geçidine çık.' },
  { id: 'road-report', stage: 'departure', service: 'gate', action: 'travel', node: 'gate', objective: 'settlement-objective-15', reward: 28, hint: 'Yol riskini ve yorgunluğu tekrar değerlendir.' },
  { id: 'return-tavern', stage: 'orientation', service: 'tavern', action: 'talk', node: 'tavern', objective: 'settlement-objective-16', reward: 36, hint: 'Döndüğünde yerel zinciri kapat.' },
]);

const REWARD_TABLE = Object.freeze({
  'settlement-objective-01': { xp: 18, copper: 8 },
  'settlement-objective-02': { xp: 22, copper: 6 },
  'settlement-objective-03': { xp: 18, copper: 4 },
  'settlement-objective-04': { xp: 26, copper: 0 },
  'settlement-objective-05': { xp: 24, copper: 5 },
  'settlement-objective-06': { xp: 24, copper: 8 },
  'settlement-objective-07': { xp: 44, copper: 12 },
  'settlement-objective-08': { xp: 34, copper: 4 },
  'settlement-objective-09': { xp: 30, copper: 10 },
  'settlement-objective-10': { xp: 46, copper: 18 },
  'settlement-objective-11': { xp: 16, copper: 2 },
  'settlement-objective-12': { xp: 20, copper: 0 },
  'settlement-objective-13': { xp: 22, copper: 4 },
  'settlement-objective-14': { xp: 52, copper: 24 },
  'settlement-objective-15': { xp: 28, copper: 6 },
  'settlement-objective-16': { xp: 36, copper: 12 },
});

const HINTS = Object.freeze({
  arrival: 'Kapıdan gir; haritadaki iç mekân düğümlerine git.',
  orientation: 'Tavern NPC diyalogu yerel görev zincirinin girişidir.',
  commerce: 'Alış ve satışta quote önce hesaplanır, economy sahibi son commit’i yapar.',
  crafting: 'Blacksmith craft action yalnızca recipe + inventory doğrulandıktan sonra gönderilir.',
  dialogue: 'Diyalog seçenekleri flag, reputation, quest, item ve skill koşullarına göre açılır.',
  quest: 'QuestSystem gerçek ilerlemeyi tutar; scenario yalnızca objective projection üretir.',
  recovery: 'Rest ve save mevcut survival/save owner’larına devredilir.',
  departure: 'Travel quote cost + fatigue + risk bilgisini birlikte gösterir.',
});

export function listSettlementScenarioSteps() {
  return STEP_DEFINITIONS.map(step => step.id);
}

export function getSettlementScenarioStep(id) {
  const step = STEP_DEFINITIONS.find(value => value.id === id);
  return step ? clone(step) : null;
}

export function getSettlementScenarioReward(objectiveId) {
  const reward = REWARD_TABLE[objectiveId];
  return reward ? { objectiveId, ...clone(reward) } : null;
}

export function getSettlementScenarioHint(stage) {
  return text(HINTS[stage], 'Bu aşamada mevcut authoritative handler üzerinden devam et.');
}

export function buildSettlementScenarioManifest() {
  return {
    version: SETTLEMENT_SCENARIO_VERSION,
    id: SETTLEMENT_SCENARIO_ID,
    limits: { ...SETTLEMENT_SCENARIO_LIMITS },
    steps: STEP_DEFINITIONS.map(step => ({ ...clone(step), service: getSettlementService(step.service)?.id ?? step.service })),
    rewards: clone(REWARD_TABLE),
    hints: clone(HINTS),
  };
}

export function validateSettlementScenario() {
  const errors = [];
  if (STEP_DEFINITIONS.length !== 16) errors.push('step-count');
  if (Object.keys(REWARD_TABLE).length !== STEP_DEFINITIONS.length) errors.push('reward-count');
  for (const step of STEP_DEFINITIONS) {
    if (!getSettlementService(step.service)) errors.push(`service:${step.id}`);
    if (step.recipe && !getSettlementRecipe(step.recipe)) errors.push(`recipe:${step.id}`);
    if (step.objective && !getSettlementQuestObjective(step.objective)) errors.push(`objective:${step.id}`);
    if (!REWARD_TABLE[step.objective]) errors.push(`reward:${step.id}`);
    if (!getSettlementScenarioHint(step.stage)) errors.push(`hint:${step.id}`);
  }
  return { ok: errors.length === 0, errors };
}

function snapshotOf(runtime) {
  return normalizeRpgSnapshot(runtime.getViewModel().player);
}

export function evaluateSettlementScenarioStep(stepId, runtime, context = {}) {
  const step = getSettlementScenarioStep(stepId);
  if (!step) return { ok: false, reason: 'unknown-step' };
  if (!runtime || typeof runtime.getViewModel !== 'function') return { ok: false, reason: 'runtime-required' };
  const snapshot = snapshotOf(runtime);
  const service = getSettlementService(step.service);
  const base = { step: clone(step), service: service ? clone(service) : null, snapshot, hint: getSettlementScenarioHint(step.stage) };
  const actionContext = {
    snapshot,
    serviceId: step.service,
    recipeId: step.recipe,
    itemId: step.item,
    quantity: context.quantity ?? 1,
    direction: context.direction ?? (step.action === 'sell' ? 'sell' : 'buy'),
    routeId: context.routeId ?? 'north_gate',
    questId: context.questId,
    conditions: context.conditions ?? [],
  };
  if (step.action === 'buy' || step.action === 'sell' || step.action === 'trade') base.rule = evaluateActionRule(step.action, actionContext);
  else if (step.action === 'craft') base.rule = evaluateActionRule('craft', actionContext);
  else if (step.action === 'travel') base.rule = evaluateActionRule('travel', actionContext);
  else if (step.action === 'rest') base.rule = evaluateActionRule('rest', actionContext);
  else if (step.action === 'talk') base.rule = context.conditions ? evaluateDialogueConditions(context.conditions, snapshot) : { ok: true, reason: 'dialogue-not-gated' };
  else if (step.action === 'equip') base.rule = evaluateActionRule('equip', actionContext);
  else base.rule = { ok: true, reason: '' };
  base.reward = getSettlementScenarioReward(step.objective);
  return { ok: true, ...base };
}

export function buildSettlementScenarioRun(runtime, options = {}) {
  if (!runtime || typeof runtime.getViewModel !== 'function') throw new TypeError('Runtime is required.');
  const startStep = text(options.startStep, STEP_DEFINITIONS[0].id);
  const startIndex = Math.max(0, STEP_DEFINITIONS.findIndex(step => step.id === startStep));
  const snapshot = snapshotOf(runtime);
  const steps = STEP_DEFINITIONS.slice(startIndex, startIndex + SETTLEMENT_SCENARIO_LIMITS.steps).map(step => evaluateSettlementScenarioStep(step.id, runtime, options.context ?? {}));
  const route = options.routeId ? getSettlementRoute(options.routeId) : getSettlementRoute('north_gate');
  return {
    version: SETTLEMENT_SCENARIO_VERSION,
    id: SETTLEMENT_SCENARIO_ID,
    startStep,
    snapshot,
    route: route ? clone(route) : null,
    journey: buildSettlementJourney(runtime, { startStage: options.startStage ?? 'arrival', routeId: route?.id }),
    steps,
    dialogue: buildSettlementDialogueGraph(snapshot, { root: options.dialogueRoot ?? 'tavern_arrival' }),
    shop: buildSettlementShopCatalog(snapshot, { direction: options.shopDirection ?? 'sell' }),
    survival: buildSurvivalReport(snapshot, { restService: options.restService ?? 'tavern' }),
  };
}

export function evaluateSettlementScenario(runtime, options = {}) {
  const run = buildSettlementScenarioRun(runtime, options);
  const stepResults = run.steps.map(value => ({ id: value.step.id, ready: value.rule?.ok === true, reason: text(value.rule?.reason) }));
  return { ok: stepResults.length > 0 && stepResults.every(value => value.ready || value.reason === 'dialogue-not-gated'), run, stepResults };
}

export function buildSettlementScenarioCheckpoint(runtime, completed = []) {
  const snapshot = snapshotOf(runtime);
  const known = new Set(Array.isArray(completed) ? completed.map(text) : []);
  const checklist = STEP_DEFINITIONS.map(step => ({ id: step.id, objective: step.objective, completed: known.has(step.id), reward: getSettlementScenarioReward(step.objective), stage: step.stage }));
  return { version: SETTLEMENT_SCENARIO_VERSION, completedCount: checklist.filter(value => value.completed).length, total: checklist.length, complete: checklist.every(value => value.completed), checklist, snapshot }; 
}

export function planSettlementScenarioObjective(objectiveId, runtime, options = {}) {
  const objective = getSettlementQuestObjective(objectiveId);
  if (!objective) return { ok: false, reason: 'unknown-objective' };
  const snapshot = snapshotOf(runtime);
  const evaluation = evaluateObjectiveRule(objective.id, snapshot);
  const reward = getSettlementScenarioReward(objective.id);
  return { ok: true, objective: clone(objective), evaluation, reward, hint: getSettlementScenarioHint(options.stage ?? 'quest') };
}

export function buildSettlementScenarioEconomyPreview(runtime, options = {}) {
  const snapshot = snapshotOf(runtime);
  const sellIds = options.sellItems ?? ['iron_ore', 'leather'];
  const buyIds = options.buyItems ?? ['bread', 'travel_rations'];
  const sells = sellIds.map(id => quoteSettlementSale(id, options.sellQuantity ?? 1, snapshot));
  const buys = buyIds.map(id => quoteSettlementPurchase(id, options.buyQuantity ?? 1, snapshot));
  return { version: 1, wallet: snapshot.copper, sells, buys, catalog: buildSettlementShopCatalog(snapshot, { direction: 'sell', items: [...sellIds, ...buyIds] }) };
}

export function buildSettlementScenarioCraftPreview(runtime, recipeId = 'iron_sword') {
  const snapshot = snapshotOf(runtime);
  const recipe = getSettlementRecipe(recipeId);
  if (!recipe) return { ok: false, reason: 'unknown-recipe' };
  const rule = evaluateActionRule('craft', { recipeId, snapshot });
  const progression = buildSettlementProgressionEnvelope({ action: 'craft', snapshot, skillXp: snapshot.skillXp });
  return { ok: true, recipe: clone(recipe), rule, progression };
}

export function buildSettlementScenarioTravelPreview(runtime, routeId = 'north_gate') {
  const snapshot = snapshotOf(runtime);
  const route = getSettlementRoute(routeId);
  if (!route) return { ok: false, reason: 'unknown-route' };
  const quote = evaluateActionRule('travel', { routeId, snapshot }).quote ?? { cost: route.cost, fatigue: route.fatigue };
  const survival = calculateTravelSurvival(snapshot, routeId, quote);
  const food = calculateFoodNeed(snapshot, 1);
  return { ok: true, route: clone(route), quote: clone(quote), survival, food };
}

export function buildSettlementScenarioSurvivalPreview(runtime, options = {}) {
  const snapshot = snapshotOf(runtime);
  return { version: 1, report: buildSurvivalReport(snapshot, options), food: calculateFoodNeed(snapshot, options.days ?? 1), encumbrance: evaluateEncumbrance(snapshot, options.incomingWeight ?? 0) };
}

export function buildSettlementScenarioProgressionPreview(runtime, action = 'talk', options = {}) {
  const snapshot = snapshotOf(runtime);
  const award = calculateActionXp(action, options);
  return { version: 1, action, award, envelope: buildSettlementProgressionEnvelope({ action, snapshot, skillXp: snapshot.skillXp, quality: options.quality, difficulty: options.difficulty, chain: options.chain }) };
}

export function buildSettlementScenarioDialoguePreview(runtime, root = 'tavern_arrival') {
  const snapshot = snapshotOf(runtime);
  const graph = buildSettlementDialogueGraph(snapshot, { root });
  return { version: 1, root, graph, firstAvailable: graph.nodes.find(node => node.available)?.id ?? null, branch: getSettlementDialogueBranch(root) };
}

export function buildSettlementScenarioJourneyPreview(runtime, stage = 'arrival') {
  return { version: 1, stage: getSettlementJourneyStage(stage), journey: buildSettlementJourney(runtime, { startStage: stage }) };
}

export function buildSettlementScenarioSummary(runtime) {
  const snapshot = snapshotOf(runtime);
  const scenario = buildSettlementScenarioManifest();
  return {
    version: SETTLEMENT_SCENARIO_VERSION,
    id: SETTLEMENT_SCENARIO_ID,
    steps: scenario.steps.length,
    services: [...new Set(scenario.steps.map(step => step.service))],
    currentSettlement: snapshot.settlementId,
    currentLocation: snapshot.locationId,
    copper: integer(snapshot.copper),
    fatigue: Math.round(snapshot.fatigue),
    inventoryLoad: `${Math.round(snapshot.carryWeight)}/${Math.round(snapshot.maxCarryWeight)}`,
    survival: buildSurvivalReport(snapshot).recommendedAction,
    journeyStart: scenario.steps[0]?.stage ?? 'arrival',
  };
}

export function validateSettlementScenarioRun(run) {
  const errors = [];
  if (run?.version !== SETTLEMENT_SCENARIO_VERSION) errors.push('version');
  if (run?.id !== SETTLEMENT_SCENARIO_ID) errors.push('id');
  if (!Array.isArray(run?.steps) || run.steps.length < 1) errors.push('steps');
  if (!run?.journey || !Array.isArray(run.journey.steps)) errors.push('journey');
  if (!run?.dialogue || !Array.isArray(run.dialogue.nodes)) errors.push('dialogue');
  if (!run?.shop || !Array.isArray(run.shop.entries)) errors.push('shop');
  if (!run?.survival || typeof run.survival.healthy !== 'boolean') errors.push('survival');
  return { ok: errors.length === 0, errors };
}
