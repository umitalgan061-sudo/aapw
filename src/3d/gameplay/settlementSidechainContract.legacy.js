/**
 * Authored settlement side-chain contract over the existing campaign content.
 * This is content-only: QuestSystem/economy/crafting/save owners remain authoritative.
 */
import {
  getSettlementService,
  getSettlementRecipe,
  getSettlementRoute,
  getSettlementQuestObjective,
} from './settlementCampaignContent.legacy.js';

export const SETTLEMENT_SIDECHAIN_VERSION = 1;

const STEPS = Object.freeze([
  Object.freeze({ id: 'side-arrival', service: 'gate', action: 'enter', objective: 'settlement-objective-01', next: 'side-market' }),
  Object.freeze({ id: 'side-market', service: 'market', action: 'buy', objective: 'settlement-objective-04', next: 'side-smith' }),
  Object.freeze({ id: 'side-smith', service: 'blacksmith', action: 'craft', recipe: 'iron_sword', objective: 'settlement-objective-07', next: 'side-road' }),
  Object.freeze({ id: 'side-road', service: 'gate', action: 'travel', route: 'north_gate', objective: 'settlement-objective-14', next: null }),
]);

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const id = value => String(value ?? '').trim();

export function listSettlementSidechainSteps() {
  return STEPS.map(step => step.id);
}

export function getSettlementSidechainStep(stepId) {
  const step = STEPS.find(value => value.id === id(stepId));
  if (!step) return null;
  return {
    ...clone(step),
    serviceDefinition: getSettlementService(step.service),
    recipeDefinition: step.recipe ? getSettlementRecipe(step.recipe) : null,
    routeDefinition: step.route ? getSettlementRoute(step.route) : null,
    objectiveDefinition: getSettlementQuestObjective(step.objective),
  };
}

export function buildSettlementSidechainContract() {
  return Object.freeze({
    version: SETTLEMENT_SIDECHAIN_VERSION,
    id: 'north-settlement-sidechain',
    steps: Object.freeze(STEPS.map(step => Object.freeze({
      id: step.id,
      service: step.service,
      action: step.action,
      objective: step.objective,
      next: step.next,
      recipe: step.recipe ?? null,
      route: step.route ?? null,
    }))),
  });
}

export function validateSettlementSidechainContract(contract = buildSettlementSidechainContract()) {
  const errors = [];
  if (!contract || contract.version !== SETTLEMENT_SIDECHAIN_VERSION) errors.push('version');
  const steps = Array.isArray(contract?.steps) ? contract.steps : [];
  if (steps.length !== STEPS.length) errors.push('step-count');
  const seen = new Set();
  steps.forEach((step, index) => {
    if (!step || !id(step.id) || seen.has(step.id)) errors.push(`step:${index}:id`);
    seen.add(step?.id);
    if (!getSettlementService(step?.service)) errors.push(`step:${index}:service`);
    if (step?.recipe && !getSettlementRecipe(step.recipe)) errors.push(`step:${index}:recipe`);
    if (step?.route && !getSettlementRoute(step.route)) errors.push(`step:${index}:route`);
    if (!getSettlementQuestObjective(step?.objective)) errors.push(`step:${index}:objective`);
    if (step?.next && !steps.some(candidate => candidate?.id === step.next)) errors.push(`step:${index}:next`);
  });
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}
