/**
 * Deterministic UX projection for the authored settlement scenario.
 * Authoritative quest/runtime state remains owned by existing systems.
 */
import {
  getSettlementScenarioStep,
  listSettlementScenarioSteps,
  getSettlementScenarioReward,
} from './settlementCampaignScenario.js';

export const SETTLEMENT_STAGE_TRACKER_VERSION = 1;
const MAX_VISIBLE_STEPS = 8;
const MAX_HISTORY = 24;
const text = (value, fallback = '') => {
  const v = String(value ?? '').trim();
  return v ? v.slice(0, 160) : fallback;
};
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const freeze = value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
};

function normalizedCompleted(completed) {
  return Array.isArray(completed) ? [...new Set(completed.map(value => text(value)).filter(Boolean))] : [];
}

function stepView(id, completedSet, activeId) {
  const step = getSettlementScenarioStep(id);
  if (!step) return null;
  const completed = completedSet.has(id);
  return {
    id,
    stage: text(step.stage, 'unknown'),
    service: text(step.service, 'settlement'),
    action: text(step.action, 'inspect'),
    node: text(step.node, 'settlement'),
    title: text(step.title, id),
    hint: text(step.hint, 'Mevcut görev adımını tamamla.'),
    reward: clone(getSettlementScenarioReward(step.objective)),
    state: completed ? 'complete' : id === activeId ? 'active' : 'upcoming',
  };
}

export function buildSettlementCampaignStageTracker(input = {}) {
  const ids = listSettlementScenarioSteps();
  const completed = normalizedCompleted(input.completed);
  const completedSet = new Set(completed);
  const requestedActive = text(input.activeStep);
  const activeId = ids.includes(requestedActive) && !completedSet.has(requestedActive)
    ? requestedActive
    : ids.find(id => !completedSet.has(id)) ?? null;
  const visibleIds = ids.filter(id => id === activeId || !completedSet.has(id)).slice(0, MAX_VISIBLE_STEPS);
  const steps = visibleIds.map(id => stepView(id, completedSet, activeId)).filter(Boolean);
  const history = normalizedCompleted(input.history).slice(-MAX_HISTORY);
  const completedCount = ids.filter(id => completedSet.has(id)).length;
  const complete = completedCount === ids.length;
  const summary = complete
    ? 'Yerleşim zinciri tamamlandı.'
    : activeId ? `${stepView(activeId, completedSet, activeId)?.title ?? activeId} sıradaki adım.` : 'Yerleşim zinciri hazır.';
  return freeze({
    version: SETTLEMENT_STAGE_TRACKER_VERSION,
    activeStep: activeId,
    completed: completed.slice(0, ids.length),
    history,
    completedCount,
    total: ids.length,
    complete,
    visibleSteps: steps,
    summary,
  });
}

export function recordSettlementCampaignStep(tracker, stepId, options = {}) {
  const current = tracker && typeof tracker === 'object' ? tracker : {};
  const id = text(stepId);
  const known = new Set(normalizedCompleted(current.completed));
  if (id && getSettlementScenarioStep(id)) known.add(id);
  const history = [...normalizedCompleted(current.history), id].filter(Boolean).slice(-MAX_HISTORY);
  return buildSettlementCampaignStageTracker({
    completed: [...known],
    history,
    activeStep: text(options.nextActiveStep),
  });
}

export function serializeSettlementCampaignStageTracker(tracker) {
  return JSON.stringify(buildSettlementCampaignStageTracker(tracker));
}

export function getSettlementCampaignStageTrackerLimits() {
  return { maxVisibleSteps: MAX_VISIBLE_STEPS, maxHistory: MAX_HISTORY };
}
