/**
 * Deterministic plan builder for interactive player-runtime assertions.
 *
 * This module bridges measured environment evidence to individual verification scenarios such as
 * stamina+dodge, dodge i-frames, guard impact, and melee recovery. It does not run Playwright,
 * advance game time, mutate player state, or decide whether a gameplay assertion is true.
 */

import {
  buildRuntimeBudgetDecision,
  PLAYER_RUNTIME_BUDGET_LIMITS,
} from './playerRuntimeBudgetPolicy.js';
import { buildRuntimeGateDecision } from './playerRuntimeEnvironmentGate.js';

export const PLAYER_RUNTIME_ASSERTION_PLAN_VERSION = '2026-09-15-v1';

export const PLAYER_RUNTIME_ASSERTION_SCENARIOS = Object.freeze({
  'stamina-dodge': Object.freeze({ simulationSeconds: 1.25, minimumFps: 0.5, actionWindowSeconds: 0.75, warmupSeconds: 0.5 }),
  'dodge-iframe': Object.freeze({ simulationSeconds: 1.1, minimumFps: 0.5, actionWindowSeconds: 0.55, warmupSeconds: 0.45 }),
  'guard-impact': Object.freeze({ simulationSeconds: 1.4, minimumFps: 0.5, actionWindowSeconds: 0.9, warmupSeconds: 0.5 }),
  'melee-combo': Object.freeze({ simulationSeconds: 2.2, minimumFps: 0.5, actionWindowSeconds: 1.6, warmupSeconds: 0.6 }),
  'hit-stagger': Object.freeze({ simulationSeconds: 1.3, minimumFps: 0.5, actionWindowSeconds: 0.8, warmupSeconds: 0.5 }),
  'parry-recovery': Object.freeze({ simulationSeconds: 1.5, minimumFps: 0.5, actionWindowSeconds: 1.0, warmupSeconds: 0.5 }),
});

const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
};
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const round = (value, digits = 4) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export function normalizeAssertionScenario(name) {
  const key = String(name ?? '').trim().toLowerCase();
  return PLAYER_RUNTIME_ASSERTION_SCENARIOS[key] ? key : 'stamina-dodge';
}

export function buildAssertionScenarioIntent(name, overrides = {}) {
  const scenario = normalizeAssertionScenario(name);
  const defaults = PLAYER_RUNTIME_ASSERTION_SCENARIOS[scenario];
  return freeze({
    scenario,
    simulationSeconds: round(clamp(Math.max(0, finite(overrides.simulationSeconds, defaults.simulationSeconds)), 0, 10), 3),
    minimumFps: round(clamp(Math.max(0.1, finite(overrides.minimumFps, defaults.minimumFps)), 0.1, 120), 3),
    actionWindowSeconds: round(clamp(Math.max(0, finite(overrides.actionWindowSeconds, defaults.actionWindowSeconds)), 0, 10), 3),
    warmupSeconds: round(clamp(Math.max(0, finite(overrides.warmupSeconds, defaults.warmupSeconds)), 0, 10), 3),
  });
}

export function calculateScenarioWallBudget(name, frameSamples = [], overrides = {}) {
  const intent = buildAssertionScenarioIntent(name, overrides);
  const budget = buildRuntimeBudgetDecision(frameSamples, {
    simulationSeconds: intent.simulationSeconds + intent.actionWindowSeconds + intent.warmupSeconds,
    minimumFps: intent.minimumFps,
    requiredSamples: overrides.requiredSamples ?? 4,
  });
  const totalWallMs = Math.round(clamp(
    budget.estimatedWallSeconds * 1000,
    PLAYER_RUNTIME_BUDGET_LIMITS.minimumTimeoutMs,
    PLAYER_RUNTIME_BUDGET_LIMITS.maximumTimeoutMs,
  ));
  return freeze({
    scenario: intent.scenario,
    budget,
    simulationSeconds: intent.simulationSeconds,
    actionWindowSeconds: intent.actionWindowSeconds,
    warmupSeconds: intent.warmupSeconds,
    totalWallMs,
    assertionTimeoutMs: budget.timeoutMs,
    pollIntervalMs: budget.pollIntervalMs,
  });
}

export function buildAssertionPlan(name, frameSamples = [], overrides = {}) {
  const intent = buildAssertionScenarioIntent(name, overrides);
  const gate = buildRuntimeGateDecision(frameSamples, {
    action: intent.scenario,
    simulationSeconds: intent.simulationSeconds + intent.actionWindowSeconds + intent.warmupSeconds,
    minimumFps: intent.minimumFps,
    requiredSamples: overrides.requiredSamples ?? 4,
    maxSamples: overrides.maxSamples ?? 32,
    windowSize: overrides.windowSize ?? 8,
  });
  const wallBudget = calculateScenarioWallBudget(intent.scenario, frameSamples, intent);
  return freeze({
    version: PLAYER_RUNTIME_ASSERTION_PLAN_VERSION,
    scenario: intent.scenario,
    status: gate.status,
    reliable: gate.reliable,
    executeAssertions: gate.executeAssertions,
    classification: gate.classification,
    timeoutMs: gate.timeoutMs,
    pollIntervalMs: gate.pollIntervalMs,
    timing: freeze({
      simulationSeconds: intent.simulationSeconds,
      warmupSeconds: intent.warmupSeconds,
      actionWindowSeconds: intent.actionWindowSeconds,
      totalWallMs: wallBudget.totalWallMs,
    }),
    gate,
    wallBudget,
  });
}

export function buildAllAssertionPlans(frameSamples = [], overrides = {}) {
  return freeze(Object.keys(PLAYER_RUNTIME_ASSERTION_SCENARIOS).map((scenario) => buildAssertionPlan(scenario, frameSamples, overrides)));
}

export function summarizeAssertionPlans(plans = []) {
  const values = Array.isArray(plans) ? plans : [];
  const runnable = values.filter((plan) => plan.executeAssertions === true);
  const inconclusive = values.filter((plan) => plan.status === 'inconclusive');
  const constrained = values.filter((plan) => plan.status === 'runnable-constrained');
  const maximumTimeoutMs = values.reduce((max, plan) => Math.max(max, Number(plan.timeoutMs) || 0), 0);
  return freeze({
    count: values.length,
    runnableCount: runnable.length,
    inconclusiveCount: inconclusive.length,
    constrainedCount: constrained.length,
    maximumTimeoutMs,
    allReliable: values.length > 0 && values.every((plan) => plan.reliable === true),
  });
}

export function validateAssertionPlan(plan = {}) {
  const errors = [];
  if (plan.version !== PLAYER_RUNTIME_ASSERTION_PLAN_VERSION) errors.push('version');
  if (!PLAYER_RUNTIME_ASSERTION_SCENARIOS[plan.scenario]) errors.push('scenario');
  if (!['inconclusive', 'runnable', 'runnable-constrained'].includes(plan.status)) errors.push('status');
  if (typeof plan.reliable !== 'boolean') errors.push('reliable');
  if (typeof plan.executeAssertions !== 'boolean') errors.push('executeAssertions');
  if (!Number.isFinite(plan.timeoutMs) || plan.timeoutMs < 5000 || plan.timeoutMs > 900000) errors.push('timeoutMs');
  if (!Number.isFinite(plan.pollIntervalMs) || plan.pollIntervalMs < 25 || plan.pollIntervalMs > 500) errors.push('pollIntervalMs');
  if (!plan.timing || !Number.isFinite(plan.timing.totalWallMs)) errors.push('timing');
  return freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function buildScenarioEvidence(plan = {}) {
  const validation = validateAssertionPlan(plan);
  return freeze({
    valid: validation.valid,
    scenario: plan.scenario ?? null,
    status: plan.status ?? null,
    classification: plan.classification ?? null,
    reliable: Boolean(plan.reliable),
    executeAssertions: Boolean(plan.executeAssertions),
    timeoutMs: Number(plan.timeoutMs ?? 0),
    pollIntervalMs: Number(plan.pollIntervalMs ?? 0),
    simulationSeconds: Number(plan.timing?.simulationSeconds ?? 0),
    actionWindowSeconds: Number(plan.timing?.actionWindowSeconds ?? 0),
    warmupSeconds: Number(plan.timing?.warmupSeconds ?? 0),
    validation,
  });
}

export function compareAssertionPlans(first = {}, second = {}) {
  return freeze({
    sameScenario: first.scenario === second.scenario,
    statusChanged: first.status !== second.status,
    classificationChanged: first.classification !== second.classification,
    reliableChanged: first.reliable !== second.reliable,
    executeChanged: first.executeAssertions !== second.executeAssertions,
    timeoutDeltaMs: Number(second.timeoutMs ?? 0) - Number(first.timeoutMs ?? 0),
    pollDeltaMs: Number(second.pollIntervalMs ?? 0) - Number(first.pollIntervalMs ?? 0),
  });
}

export function replayAssertionPlan(name, frameSamples = [], overrides = {}) {
  const first = buildAssertionPlan(name, frameSamples, overrides);
  const second = buildAssertionPlan(name, frameSamples, overrides);
  return freeze({ equivalent: JSON.stringify(first) === JSON.stringify(second), first, second });
}

export function buildEnvironmentAwareExecutionSummary(frameSamples = [], scenarios = Object.keys(PLAYER_RUNTIME_ASSERTION_SCENARIOS)) {
  const plans = scenarios.map((scenario) => buildAssertionPlan(scenario, frameSamples));
  const summary = summarizeAssertionPlans(plans);
  return freeze({
    version: PLAYER_RUNTIME_ASSERTION_PLAN_VERSION,
    scenarios: Object.freeze(plans.map((plan) => buildScenarioEvidence(plan))),
    summary,
  });
}

export const PLAYER_RUNTIME_ASSERTION_PLAN_OWNERSHIP = Object.freeze({
  reads: ['runtime frame samples', 'verification scenario metadata'],
  writes: [],
  owns: ['scenario timing envelope', 'environment-aware execution plan', 'plan evidence'],
  delegates: ['Playwright execution', 'gameplay state transitions', 'browser scheduling', 'final assertion truth'],
});
