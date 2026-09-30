/**
 * Environment-aware gate for slow-player runtime checks.
 *
 * The gate decides whether an interactive assertion is reliable under the observed cadence.
 * It never disables production gameplay and never modifies a test's assertion semantics.
 * Consumers may use the returned decision to classify a check as pass, inconclusive, or runnable.
 */

import {
  PLAYER_RUNTIME_BUDGET_VERSION,
  buildRuntimeBudgetDecision,
  validateRuntimeBudgetDecision,
} from './playerRuntimeBudgetPolicy.js';
import {
  PLAYER_RUNTIME_TELEMETRY_VERSION,
  createRuntimeProbeTranscript,
  validateRuntimeTelemetry,
} from './playerRuntimeTelemetry.js';

export const PLAYER_RUNTIME_GATE_VERSION = '2026-09-15-v1';

export const PLAYER_RUNTIME_GATE_LIMITS = Object.freeze({
  minimumProbeSamples: 4,
  recommendedProbeSamples: 8,
  maximumProbeSamples: 32,
  minimumReliableFps: 0.5,
  maximumProbeDurationSimulationSeconds: 4,
  defaultSimulationSeconds: 1,
  maximumAllowedWallSeconds: 900,
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

export function normalizeGateIntent(input = {}) {
  const action = String(input.action ?? 'interactive-assertion').trim() || 'interactive-assertion';
  const simulationSeconds = clamp(
    Math.max(0, finite(input.simulationSeconds, PLAYER_RUNTIME_GATE_LIMITS.defaultSimulationSeconds)),
    0,
    PLAYER_RUNTIME_GATE_LIMITS.maximumProbeDurationSimulationSeconds,
  );
  const minimumFps = clamp(Math.max(0.1, finite(input.minimumFps, PLAYER_RUNTIME_GATE_LIMITS.minimumReliableFps)), 0.1, 120);
  return freeze({ action, simulationSeconds: round(simulationSeconds, 3), minimumFps: round(minimumFps, 3) });
}

export function buildRuntimeGateDecision(frameSamples = [], input = {}) {
  const intent = normalizeGateIntent(input);
  const transcript = createRuntimeProbeTranscript(frameSamples, {
    maxSamples: input.maxSamples ?? PLAYER_RUNTIME_GATE_LIMITS.maximumProbeSamples,
    minimumSamples: input.minimumSamples ?? PLAYER_RUNTIME_GATE_LIMITS.minimumProbeSamples,
    windowSize: input.windowSize ?? PLAYER_RUNTIME_GATE_LIMITS.recommendedProbeSamples,
  });
  const decision = buildRuntimeBudgetDecision(transcript.stable.samples, {
    simulationSeconds: intent.simulationSeconds,
    minimumFps: intent.minimumFps,
    requiredSamples: intent.minimumSamples,
  });
  const reliable = transcript.stable.ready && decision.summary.fps >= intent.minimumFps;
  const status = !reliable
    ? 'inconclusive'
    : decision.classification === 'normal'
      ? 'runnable'
      : 'runnable-constrained';
  return freeze({
    version: PLAYER_RUNTIME_GATE_VERSION,
    budgetVersion: PLAYER_RUNTIME_BUDGET_VERSION,
    telemetryVersion: PLAYER_RUNTIME_TELEMETRY_VERSION,
    action: intent.action,
    status,
    reliable,
    executeAssertions: reliable,
    simulationSeconds: intent.simulationSeconds,
    minimumFps: intent.minimumFps,
    classification: decision.classification,
    timeoutMs: decision.timeoutMs,
    pollIntervalMs: decision.pollIntervalMs,
    transcript,
    budget: decision,
    reason: !reliable
      ? 'runtime cadence evidence is insufficient for a trustworthy interactive assertion'
      : status === 'runnable-constrained'
        ? 'assertion is runnable using an environment-derived extended timeout'
        : 'runtime cadence supports the normal assertion budget',
  });
}

export function shouldExecuteInteractiveAssertion(decision = {}) {
  return Boolean(decision.executeAssertions === true && decision.reliable === true && Number(decision.timeoutMs) > 0);
}

export function describeGateDecision(decision = {}) {
  if (decision.status === 'inconclusive') return 'INCONCLUSIVE: runtime cadence probe did not establish a reliable execution window.';
  if (decision.status === 'runnable-constrained') return `RUNNABLE-CONSTRAINED: ${decision.timeoutMs}ms derived timeout from measured cadence.`;
  if (decision.status === 'runnable') return `RUNNABLE: standard timeout ${decision.timeoutMs}ms supported by measured cadence.`;
  return 'UNKNOWN: gate decision is not recognized.';
}

export function createGateEvidence(decision = {}) {
  const validation = validateRuntimeBudgetDecision(decision.budget ?? {});
  const telemetryValidation = validateRuntimeTelemetry(decision.transcript?.telemetry ?? {});
  return freeze({
    valid: validation.valid && telemetryValidation.valid,
    gateVersion: decision.version ?? null,
    action: decision.action ?? null,
    status: decision.status ?? null,
    reliable: Boolean(decision.reliable),
    executeAssertions: Boolean(decision.executeAssertions),
    timeoutMs: Number(decision.timeoutMs ?? 0),
    pollIntervalMs: Number(decision.pollIntervalMs ?? 0),
    classification: decision.classification ?? null,
    budgetValidation: validation,
    telemetryValidation,
  });
}

export function replayGateDecision(samples = [], input = {}) {
  const first = buildRuntimeGateDecision(samples, input);
  const second = buildRuntimeGateDecision(samples, input);
  return freeze({
    equivalent: JSON.stringify(first) === JSON.stringify(second),
    first,
    second,
  });
}

export function compareGateWindows(firstSamples = [], secondSamples = [], input = {}) {
  const first = buildRuntimeGateDecision(firstSamples, input);
  const second = buildRuntimeGateDecision(secondSamples, input);
  return freeze({
    firstStatus: first.status,
    secondStatus: second.status,
    classificationChanged: first.classification !== second.classification,
    timeoutDeltaMs: second.timeoutMs - first.timeoutMs,
    fpsDelta: round(second.budget.summary.fps - first.budget.summary.fps, 3),
    firstReliable: first.reliable,
    secondReliable: second.reliable,
  });
}

export function buildGateScenarioMatrix() {
  return freeze([
    Object.freeze({ id: 'normal', samples: [0.016, 0.017, 0.016, 0.018], simulationSeconds: 1, expected: 'runnable' }),
    Object.freeze({ id: 'constrained', samples: [0.12, 0.11, 0.13, 0.14], simulationSeconds: 1, expected: 'runnable-constrained' }),
    Object.freeze({ id: 'slow-software', samples: [3.5, 3.7, 4.2, 8.6], simulationSeconds: 1, expected: 'runnable-constrained' }),
    Object.freeze({ id: 'insufficient', samples: [0.02, 0.03], simulationSeconds: 1, expected: 'inconclusive' }),
    Object.freeze({ id: 'non-finite', samples: [NaN, Infinity, 0.02, 0.03], simulationSeconds: 1, expected: 'inconclusive' }),
  ]);
}

export function verifyGateScenarioMatrix() {
  const results = buildGateScenarioMatrix().map((scenario) => {
    const decision = buildRuntimeGateDecision(scenario.samples, { simulationSeconds: scenario.simulationSeconds });
    return freeze({
      id: scenario.id,
      expected: scenario.expected,
      actual: decision.status,
      matches: decision.status === scenario.expected,
      timeoutMs: decision.timeoutMs,
      classification: decision.classification,
    });
  });
  return freeze({
    valid: results.every((result) => result.matches),
    count: results.length,
    results,
  });
}

export const PLAYER_RUNTIME_GATE_OWNERSHIP = Object.freeze({
  reads: ['frame timing telemetry', 'verification intent'],
  writes: [],
  owns: ['environment classification', 'assertion reliability decision', 'evidence packaging'],
  delegates: ['Playwright lifecycle', 'browser rendering', 'gameplay updates', 'assertion semantics'],
});
