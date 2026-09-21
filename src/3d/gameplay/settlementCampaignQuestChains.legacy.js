/**
 * Authored settlement quest chains.
 * These are content contracts consumed by the existing QuestSystem.
 */
import { getSettlementQuestObjective, getSettlementService, getSettlementDialogueCondition, getSettlementRecipe, getSettlementRoute } from './settlementCampaignContent.js';

export const SETTLEMENT_QUEST_CHAIN_VERSION = 1;
export const SETTLEMENT_QUEST_CHAIN_LIMITS = Object.freeze({
  chains: 6,
  stepsPerChain: 8,
  rewards: 6,
  conditionsPerStep: 3,
});

const text = (value, fallback = '') => {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, 160) : fallback;
};
const clone = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));

const CHAINS = Object.freeze({
  iron_and_oath: Object.freeze({
    id: 'iron_and_oath',
    title: 'Demir ve Yemin',
    giver: 'blacksmith',
    service: 'blacksmith',
    summary: 'Yerleşimin demirci stoğunu toparlayıp bir savunma ekipmanı hazırlama zinciri.',
    steps: Object.freeze([
      Object.freeze({ id: 'iron-01', objective: 'settlement-objective-02', action: 'talk', conditions: ['flag_01'], rewardXp: 20 }),
      Object.freeze({ id: 'iron-02', objective: 'settlement-objective-06', action: 'talk', conditions: ['reputation_02'], rewardXp: 24 }),
      Object.freeze({ id: 'iron-03', objective: 'settlement-objective-18', action: 'collect', target: 'iron_ore', quantity: 4, conditions: ['item_03'], rewardXp: 28 }),
      Object.freeze({ id: 'iron-04', objective: 'settlement-objective-20', action: 'collect', target: 'coal', quantity: 2, conditions: ['item_04'], rewardXp: 28 }),
      Object.freeze({ id: 'iron-05', objective: 'settlement-objective-07', action: 'craft', recipe: 'iron_sword', conditions: ['skill_09'], rewardXp: 46 }),
      Object.freeze({ id: 'iron-06', objective: 'settlement-objective-08', action: 'equip', target: 'iron_sword', conditions: ['item_13'], rewardXp: 36 }),
      Object.freeze({ id: 'iron-07', objective: 'settlement-objective-11', action: 'rest', conditions: ['skill_14'], rewardXp: 18 }),
      Object.freeze({ id: 'iron-08', objective: 'settlement-objective-16', action: 'talk', conditions: ['quest_16'], rewardXp: 44 }),
    ]),
    reward: Object.freeze({ xp: 120, copper: 60, perk: 'iron_hand' }),
  }),
  market_routes: Object.freeze({
    id: 'market_routes',
    title: 'Pazar ve Yollar',
    giver: 'market',
    service: 'market',
    summary: 'Pazar ekonomisini kullanarak yol hazırlığı ve kervan bağlantısını güçlendirme zinciri.',
    steps: Object.freeze([
      Object.freeze({ id: 'market-01', objective: 'settlement-objective-03', action: 'talk', conditions: ['reputation_07'], rewardXp: 18 }),
      Object.freeze({ id: 'market-02', objective: 'settlement-objective-04', action: 'buy', target: 'bread', quantity: 3, conditions: ['copper_11'], rewardXp: 20 }),
      Object.freeze({ id: 'market-03', objective: 'settlement-objective-05', action: 'sell', target: 'iron_ore', quantity: 2, conditions: ['item_18'], rewardXp: 26 }),
      Object.freeze({ id: 'market-04', objective: 'settlement-objective-21', action: 'trade', target: 'travel_rations', quantity: 2, conditions: ['reputation_12'], rewardXp: 28 }),
      Object.freeze({ id: 'market-05', objective: 'settlement-objective-23', action: 'talk', conditions: ['skill_13'], rewardXp: 22 }),
      Object.freeze({ id: 'market-06', objective: 'settlement-objective-24', action: 'travel', route: 'river_market', conditions: ['skill_19'], rewardXp: 40 }),
      Object.freeze({ id: 'market-07', objective: 'settlement-objective-25', action: 'sell', target: 'leather', quantity: 2, conditions: ['item_28'], rewardXp: 30 }),
      Object.freeze({ id: 'market-08', objective: 'settlement-objective-26', action: 'talk', conditions: ['quest_31'], rewardXp: 48 }),
    ]),
    reward: Object.freeze({ xp: 140, copper: 90, perk: 'merchant_road' }),
  }),
  road_watch: Object.freeze({
    id: 'road_watch',
    title: 'Yol Nöbeti',
    giver: 'barracks',
    service: 'barracks',
    summary: 'Kışla ve kapı arasında gidip gelen savunma devriyesi ve güvenli seyahat zinciri.',
    steps: Object.freeze([
      Object.freeze({ id: 'watch-01', objective: 'settlement-objective-27', action: 'talk', conditions: ['reputation_22'], rewardXp: 22 }),
      Object.freeze({ id: 'watch-02', objective: 'settlement-objective-28', action: 'train', conditions: ['skill_24'], rewardXp: 34 }),
      Object.freeze({ id: 'watch-03', objective: 'settlement-objective-29', action: 'equip', target: 'iron_sword', conditions: ['item_33'], rewardXp: 30 }),
      Object.freeze({ id: 'watch-04', objective: 'settlement-objective-30', action: 'talk', conditions: ['flag_36'], rewardXp: 26 }),
      Object.freeze({ id: 'watch-05', objective: 'settlement-objective-31', action: 'travel', route: 'hill_fort', conditions: ['skill_39'], rewardXp: 50 }),
      Object.freeze({ id: 'watch-06', objective: 'settlement-objective-32', action: 'travel', route: 'north_gate', conditions: ['quest_34'], rewardXp: 36 }),
      Object.freeze({ id: 'watch-07', objective: 'settlement-objective-13', action: 'talk', conditions: ['reputation_27'], rewardXp: 24 }),
      Object.freeze({ id: 'watch-08', objective: 'settlement-objective-14', action: 'travel', route: 'north_gate', conditions: ['skill_39'], rewardXp: 54 }),
    ]),
    reward: Object.freeze({ xp: 160, copper: 75, perk: 'watchful' }),
  }),
  hearth_and_home: Object.freeze({
    id: 'hearth_and_home',
    title: 'Ocak ve Ev',
    giver: 'house',
    service: 'house',
    summary: 'Güvenli ev, kayıt ve dinlenme döngüsünü kalıcı bir oyuncu alışkanlığına dönüştüren zincir.',
    steps: Object.freeze([
      Object.freeze({ id: 'home-01', objective: 'settlement-objective-11', action: 'rest', conditions: ['skill_39'], rewardXp: 16 }),
      Object.freeze({ id: 'home-02', objective: 'settlement-objective-12', action: 'save', conditions: ['flag_36'], rewardXp: 20 }),
      Object.freeze({ id: 'home-03', objective: 'settlement-objective-34', action: 'interact', conditions: ['reputation_31'], rewardXp: 18 }),
      Object.freeze({ id: 'home-04', objective: 'settlement-objective-35', action: 'talk', conditions: ['flag_36'], rewardXp: 22 }),
      Object.freeze({ id: 'home-05', objective: 'settlement-objective-36', action: 'rest', conditions: ['skill_39'], rewardXp: 20 }),
      Object.freeze({ id: 'home-06', objective: 'settlement-objective-37', action: 'save', conditions: ['quest_34'], rewardXp: 24 }),
      Object.freeze({ id: 'home-07', objective: 'settlement-objective-38', action: 'interact', conditions: ['item_18'], rewardXp: 18 }),
      Object.freeze({ id: 'home-08', objective: 'settlement-objective-39', action: 'talk', conditions: ['skill_04'], rewardXp: 36 }),
    ]),
    reward: Object.freeze({ xp: 100, copper: 45, perk: 'keepsake' }),
  }),
  winter_supply: Object.freeze({
    id: 'winter_supply',
    title: 'Kış İkmalı',
    giver: 'farm',
    service: 'farm',
    summary: 'Çiftlikten yiyecek toplayıp yüksek riskli rota öncesi hayatta kalma stoğunu tamamlama zinciri.',
    steps: Object.freeze([
      Object.freeze({ id: 'winter-01', objective: 'settlement-objective-02', action: 'talk', conditions: ['reputation_02'], rewardXp: 18 }),
      Object.freeze({ id: 'winter-02', objective: 'settlement-objective-40', action: 'collect', target: 'herb', quantity: 2, conditions: ['item_03'], rewardXp: 24 }),
      Object.freeze({ id: 'winter-03', objective: 'settlement-objective-41', action: 'collect', target: 'bread', quantity: 4, conditions: ['item_04'], rewardXp: 22 }),
      Object.freeze({ id: 'winter-04', objective: 'settlement-objective-42', action: 'craft', recipe: 'travel_rations', conditions: ['skill_04'], rewardXp: 30 }),
      Object.freeze({ id: 'winter-05', objective: 'settlement-objective-43', action: 'trade', target: 'horse_feed', quantity: 1, conditions: ['reputation_07'], rewardXp: 28 }),
      Object.freeze({ id: 'winter-06', objective: 'settlement-objective-44', action: 'rest', conditions: ['skill_14'], rewardXp: 18 }),
      Object.freeze({ id: 'winter-07', objective: 'settlement-objective-45', action: 'travel', route: 'winter_pass', conditions: ['skill_39'], rewardXp: 64 }),
      Object.freeze({ id: 'winter-08', objective: 'settlement-objective-46', action: 'talk', conditions: ['quest_34'], rewardXp: 50 }),
    ]),
    reward: Object.freeze({ xp: 170, copper: 85, perk: 'field_cook' }),
  }),
  stable_master: Object.freeze({
    id: 'stable_master',
    title: 'Ahır Ustası',
    giver: 'stable',
    service: 'stable',
    summary: 'Binek hazırlığı, yem yönetimi ve orta mesafeli seyahatin güvenli döngüsü.',
    steps: Object.freeze([
      Object.freeze({ id: 'stable-01', objective: 'settlement-objective-47', action: 'talk', conditions: ['reputation_07'], rewardXp: 20 }),
      Object.freeze({ id: 'stable-02', objective: 'settlement-objective-48', action: 'trade', target: 'horse_feed', quantity: 2, conditions: ['copper_11'], rewardXp: 22 }),
      Object.freeze({ id: 'stable-03', objective: 'settlement-objective-49', action: 'rest', conditions: ['skill_14'], rewardXp: 16 }),
      Object.freeze({ id: 'stable-04', objective: 'settlement-objective-50', action: 'talk', conditions: ['skill_13'], rewardXp: 24 }),
      Object.freeze({ id: 'stable-05', objective: 'settlement-objective-51', action: 'travel', route: 'old_mill', conditions: ['skill_24'], rewardXp: 34 }),
      Object.freeze({ id: 'stable-06', objective: 'settlement-objective-52', action: 'travel', route: 'river_market', conditions: ['skill_39'], rewardXp: 40 }),
      Object.freeze({ id: 'stable-07', objective: 'settlement-objective-53', action: 'talk', conditions: ['quest_31'], rewardXp: 28 }),
      Object.freeze({ id: 'stable-08', objective: 'settlement-objective-54', action: 'travel', route: 'east_road', conditions: ['skill_39'], rewardXp: 50 }),
    ]),
    reward: Object.freeze({ xp: 125, copper: 70, perk: 'stable_hand' }),
  }),
});

export function listSettlementQuestChains() {
  return Object.keys(CHAINS);
}

export function getSettlementQuestChain(chainId) {
  const chain = CHAINS[chainId];
  if (!chain) return null;
  return {
    ...clone(chain),
    steps: chain.steps.map(step => ({ ...clone(step) })),
    reward: clone(chain.reward),
  };
}

export function getSettlementQuestChainStep(chainId, stepId) {
  const chain = CHAINS[chainId];
  const step = chain?.steps.find(value => value.id === stepId);
  return step ? { ...clone(step), chainId } : null;
}

export function getSettlementQuestChainReward(chainId) {
  const chain = CHAINS[chainId];
  return chain ? { chainId, ...clone(chain.reward) } : null;
}

export function buildSettlementQuestChainManifest() {
  return {
    version: SETTLEMENT_QUEST_CHAIN_VERSION,
    chains: listSettlementQuestChains().map(getSettlementQuestChain),
    limits: { ...SETTLEMENT_QUEST_CHAIN_LIMITS },
  };
}

export function validateSettlementQuestChains() {
  const errors = [];
  for (const chainId of listSettlementQuestChains()) {
    const chain = CHAINS[chainId];
    if (!getSettlementService(chain.service)) errors.push(`service:${chainId}`);
    if (chain.steps.length !== SETTLEMENT_QUEST_CHAIN_LIMITS.stepsPerChain) errors.push(`steps:${chainId}`);
    if (!chain.reward || chain.reward.xp <= 0) errors.push(`reward:${chainId}`);
    for (const step of chain.steps) {
      if (!getSettlementQuestObjective(step.objective)) errors.push(`objective:${step.id}`);
      for (const condition of step.conditions ?? []) if (!getSettlementDialogueCondition(condition)) errors.push(`condition:${step.id}:${condition}`);
      if (step.recipe && !getSettlementRecipe(step.recipe)) errors.push(`recipe:${step.id}`);
      if (step.route && !getSettlementRoute(step.route)) errors.push(`route:${step.id}`);
      if (step.target === '') errors.push(`target:${step.id}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function evaluateSettlementQuestChainStep(chainId, stepId, snapshot, ruleEvaluator) {
  const step = getSettlementQuestChainStep(chainId, stepId);
  if (!step) return { ok: false, reason: 'unknown-step' };
  if (typeof ruleEvaluator !== 'function') return { ok: false, reason: 'rule-evaluator-required' };
  const checks = step.conditions.map(condition => ({ condition, result: ruleEvaluator(condition, snapshot) }));
  const ready = checks.every(check => check.result?.ok === true);
  return { ok: true, chainId, stepId, action: step.action, ready, checks, rewardXp: step.rewardXp, target: text(step.target || step.recipe || step.route) };
}

export function buildSettlementQuestChainProgress(chainId, snapshot, completedStepIds = []) {
  const chain = CHAINS[chainId];
  if (!chain) return { ok: false, reason: 'unknown-chain' };
  const completed = new Set(Array.isArray(completedStepIds) ? completedStepIds : []);
  let activeIndex = chain.steps.findIndex(step => !completed.has(step.id));
  if (activeIndex < 0) activeIndex = chain.steps.length;
  return {
    ok: true,
    chainId,
    title: chain.title,
    completedCount: completed.size,
    total: chain.steps.length,
    complete: activeIndex === chain.steps.length,
    activeIndex,
    snapshot: clone(snapshot),
    steps: chain.steps.map((step, index) => ({
      id: step.id,
      action: step.action,
      objective: step.objective,
      state: completed.has(step.id) ? 'complete' : index === activeIndex ? 'active' : 'locked',
      rewardXp: step.rewardXp,
    })),
  };
}

export function summarizeQuestChain(chainId) {
  const chain = CHAINS[chainId];
  if (!chain) return { ok: false, reason: 'unknown-chain' };
  return {
    ok: true,
    id: chain.id,
    title: chain.title,
    service: chain.service,
    giver: chain.giver,
    steps: chain.steps.length,
    totalXp: chain.steps.reduce((sum, step) => sum + step.rewardXp, 0) + chain.reward.xp,
    reward: clone(chain.reward),
  };
}
