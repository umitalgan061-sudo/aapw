/**
 * Deterministic next-step planner for the existing settlement campaign runtime.
 * This module is presentation-only: authoritative handlers and state remain external.
 */
import {
  getSettlementService,
  getSettlementRoute,
  getSettlementRecipe,
  resolveCraftingRecipe,
  resolveTravelCost,
} from './settlementCampaignContent.js';

export const SETTLEMENT_NEXT_STEP_PLANNER_VERSION = 1;
const SERVICES = Object.freeze(['tavern', 'market', 'blacksmith', 'gate', 'farm', 'barracks', 'stable', 'house']);
const text = (value, fallback = '') => {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, 160) : fallback;
};
const finite = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};
const integer = (value, min, max, fallback = min) => Math.max(min, Math.min(max, Math.trunc(finite(value, fallback))));
const stable = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
};
const digest = (value) => {
  let hash = 2166136261;
  const source = stable(value);
  for (let index = 0; index < source.length; index += 1) { hash ^= source.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
};
const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
};
const normalizeSnapshot = (raw = {}) => {
  const source = raw && typeof raw === 'object' ? raw : {};
  const inventory = {};
  const quests = {};
  for (const [key, value] of Object.entries(source.inventory ?? {}).slice(0, 96)) inventory[text(key)] = integer(value, 0, 9999, 0);
  for (const [key, value] of Object.entries(source.quests ?? {}).slice(0, 64)) {
    const record = value && typeof value === 'object' ? value : {};
    quests[text(key)] = { completed: Boolean(record.completed), state: text(record.state, 'unknown'), step: integer(record.step, 0, 999, 0) };
  }
  return {
    copper: integer(source.copper, 0, 999999, 0),
    fatigue: Math.max(0, Math.min(100, finite(source.fatigue, 0))),
    health: Math.max(0, Math.min(100, finite(source.health, 100))),
    settlementId: text(source.settlementId, 'settlement'),
    unlockedServices: new Set((Array.isArray(source.unlockedServices) ? source.unlockedServices : []).map((item) => text(item))),
    inventory,
    quests,
    perks: new Set((Array.isArray(source.perks) ? source.perks : []).map((item) => text(item))),
  };
};
const objectiveState = (objective, snapshot) => {
  const quest = snapshot.quests[text(objective?.questId)];
  if (!objective) return { status: 'unknown', reason: 'unknown-objective' };
  if (quest?.completed || quest?.state === 'completed') return { status: 'complete', reason: '' };
  if (objective.requiredItem && (snapshot.inventory[objective.requiredItem] ?? 0) < integer(objective.requiredQuantity, 1, 999, 1)) return { status: 'blocked', reason: 'item-required' };
  return { status: 'available', reason: '' };
};
const candidate = (serviceId, action, label, reason = '') => ({ serviceId, action, label: text(label, action), reason: text(reason), available: !reason });
export function planSettlementNextStep(rawSnapshot = {}, rawContext = {}) {
  const snapshot = normalizeSnapshot(rawSnapshot);
  const context = rawContext && typeof rawContext === 'object' ? rawContext : {};
  const objectives = Array.isArray(context.objectives) ? context.objectives.slice(0, 12) : [];
  const objectiveRows = objectives.map((objective) => {
    const state = objectiveState(objective, snapshot);
    return { id: text(objective?.id, 'objective'), label: text(objective?.label, 'Objective'), serviceId: text(objective?.serviceId, 'tavern'), action: text(objective?.action, 'talk'), ...state };
  });
  const urgent = objectiveRows.find((row) => row.status === 'available') ?? objectiveRows.find((row) => row.status === 'blocked');
  const serviceCandidates = [];
  for (const serviceId of SERVICES) {
    const service = getSettlementService(serviceId);
    if (!service) continue;
    if (snapshot.unlockedServices.size && !snapshot.unlockedServices.has(serviceId)) continue;
    if (serviceId === 'tavern' && snapshot.fatigue >= 75) serviceCandidates.push(candidate(serviceId, 'rest', 'Dinlen', 'fatigue-high'));
    else if (serviceId === 'market' && snapshot.copper > 0) serviceCandidates.push(candidate(serviceId, 'trade', 'Takas'));
    else if (serviceId === 'blacksmith') {
      const recipeId = text(context.recipeId, 'iron_sword');
      const recipe = getSettlementRecipe(recipeId);
      const craft = recipe ? resolveCraftingRecipe(recipeId, snapshot) : null;
      serviceCandidates.push(candidate(serviceId, 'craft', recipe?.label ?? 'Üretim', craft?.ok ? '' : 'materials-missing'));
    } else if (serviceId === 'gate') {
      const routeId = text(context.routeId, 'north_gate');
      const travel = resolveTravelCost(routeId, { costRate: snapshot.perks.has('roadwise') ? -0.07 : 0, fatigueRate: snapshot.perks.has('roadwise') ? -0.07 : 0 });
      serviceCandidates.push(candidate(serviceId, 'travel', 'Seyahat', travel?.ok && snapshot.copper >= travel.cost ? '' : 'travel-unavailable'));
    } else serviceCandidates.push(candidate(serviceId, service.kind ?? serviceId, service.label ?? serviceId));
  }
  const primary = urgent ? candidate(urgent.serviceId, urgent.action, urgent.label, urgent.status === 'blocked' ? urgent.reason : '') : serviceCandidates.find((item) => item.available) ?? serviceCandidates[0] ?? candidate('house', 'save', 'Kaydet', 'no-service');
  const result = {
    version: SETTLEMENT_NEXT_STEP_PLANNER_VERSION,
    settlementId: snapshot.settlementId,
    primary,
    objectives: objectiveRows,
    alternatives: serviceCandidates.filter((item) => item.serviceId !== primary.serviceId).slice(0, 6),
    summary: { objectiveCount: objectiveRows.length, actionableObjectives: objectiveRows.filter((row) => row.status === 'available').length, availableServices: serviceCandidates.filter((item) => item.available).length },
  };
  return deepFreeze({ ...result, digest: digest(result) });
}
export const serializeSettlementNextStepPlan = (plan) => stable(plan);
