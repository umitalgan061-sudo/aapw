/**
 * Deterministic UX projection for the authored settlement quest-chain content.
 * It consumes existing QuestSystem/content evidence and never mutates runtime state.
 */
import {
  getSettlementQuestChain,
  getSettlementQuestChainStep,
  getSettlementQuestChainReward,
} from './settlementCampaignQuestChains.legacy.js';

const SERVICES = new Set(['blacksmith','tavern','market','farm','barracks','stable','house','gate']);
const ACTIONS = new Set(['talk','collect','craft','equip','rest','buy','sell','trade','travel','train','save','interact']);
const text = (value, fallback = '') => {
  const v = String(value ?? '').trim();
  return v ? v.slice(0, 160) : fallback;
};
const integer = (value, fallback = 0) => Number.isInteger(value) ? value : fallback;
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const sortUnique = (values) => [...new Set((Array.isArray(values) ? values : []).map((v) => text(v)).filter(Boolean))].sort();

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) freeze(nested);
  return value;
}

function digest(value) {
  const source = JSON.stringify(value);
  let hash = 2166136261;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function evaluateStep(step, context) {
  const required = sortUnique(step?.conditions);
  const available = new Set(sortUnique(context?.satisfiedConditions));
  const missingConditions = required.filter((id) => !available.has(id));
  const serviceReady = SERVICES.has(text(context?.serviceId));
  const actionReady = ACTIONS.has(text(step?.action));
  return {
    serviceReady,
    actionReady,
    missingConditions,
    ready: serviceReady && actionReady && missingConditions.length === 0,
  };
}

export function createSettlementQuestChainInteractionPlan(input = {}) {
  const chainId = text(input.chainId);
  const chain = getSettlementQuestChain(chainId);
  if (!chain) return freeze({
    version: 1,
    status: 'invalid-input',
    reason: 'unknown-chain',
    chainId,
    planKey: digest({ status: 'invalid-input', chainId }),
  });

  const stepIndex = Math.max(0, Math.min(chain.steps.length, integer(input.stepIndex, 0)));
  const completed = Math.min(chain.steps.length, Math.max(0, integer(input.completedCount, stepIndex)));
  const step = stepIndex < chain.steps.length
    ? getSettlementQuestChainStep(chainId, chain.steps[stepIndex].id)
    : null;
  const stepResult = step ? evaluateStep(step, input) : {
    serviceReady: true, actionReady: true, missingConditions: [], ready: false,
  };
  const completedChain = step == null || completed >= chain.steps.length;
  const reward = completedChain ? getSettlementQuestChainReward(chainId) : null;
  const status = completedChain
    ? 'complete'
    : stepResult.ready
      ? 'ready'
      : stepResult.missingConditions.length > 0
        ? 'condition-blocked'
        : !stepResult.serviceReady
          ? 'service-blocked'
          : 'action-blocked';

  const plan = {
    version: 1,
    chainId,
    title: text(chain.title, chainId),
    service: text(chain.service),
    stepIndex,
    completedCount: completed,
    status,
    currentStep: step ? {
      id: text(step.id),
      objective: text(step.objective),
      action: text(step.action),
      target: text(step.target),
      quantity: Math.max(0, integer(step.quantity, 0)),
      recipe: text(step.recipe),
      route: text(step.route),
      rewardXp: Math.max(0, integer(step.rewardXp, 0)),
    } : null,
    missingConditions: stepResult.missingConditions,
    rewardPreview: reward ? clone(reward) : null,
  };
  return freeze({ ...plan, planKey: digest(plan) });
}

export function isSettlementQuestChainInteractionPlan(value) {
  try {
    return Boolean(value)
      && value.version === 1
      && typeof value.chainId === 'string'
      && typeof value.planKey === 'string'
      && ['ready','condition-blocked','service-blocked','action-blocked','complete','invalid-input'].includes(value.status)
      && Array.isArray(value.missingConditions)
      && Object.isFrozen(value)
      && value.planKey === digest({
        ...value,
        planKey: undefined,
      });
  } catch {
    return false;
  }
}
