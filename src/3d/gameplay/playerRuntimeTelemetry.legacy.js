/**
 * Read-only runtime cadence telemetry shared by player verification tooling.
 * It captures caller-supplied frame deltas and converts them into bounded plain-data samples.
 * It does not access Date.now, timers, rendering state, or gameplay state itself.
 */

import {
  PLAYER_RUNTIME_BUDGET_LIMITS,
  normalizeRuntimeFrameSamples,
  summarizeRuntimeFrameSamples,
  classifyRuntimeEnvironment,
  estimateSimulationWallRatio,
} from './playerRuntimeBudgetPolicy.js';

export const PLAYER_RUNTIME_TELEMETRY_VERSION = '2026-09-15-v1';

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

export function createRuntimeTelemetryState(options = {}) {
  const maxSamples = Math.round(clamp(finite(options.maxSamples, 120), 4, PLAYER_RUNTIME_BUDGET_LIMITS.maximumSampleCount));
  return freeze({
    version: PLAYER_RUNTIME_TELEMETRY_VERSION,
    maxSamples,
    samples: [],
    droppedSamples: 0,
    sequence: 0,
  });
}

export function appendRuntimeFrameSample(state, rawDeltaSeconds) {
  const source = state && typeof state === 'object' ? state : createRuntimeTelemetryState();
  const delta = finite(rawDeltaSeconds, 0);
  const valid = Number.isFinite(delta) && delta > 0;
  const normalized = valid
    ? clamp(delta, PLAYER_RUNTIME_BUDGET_LIMITS.minimumFrameSeconds, PLAYER_RUNTIME_BUDGET_LIMITS.maximumFrameSeconds)
    : null;
  const samples = [...(Array.isArray(source.samples) ? source.samples : [])];
  let droppedSamples = Math.max(0, Math.round(finite(source.droppedSamples, 0)));
  if (normalized === null) {
    droppedSamples += 1;
  } else {
    samples.push(normalized);
    const maxSamples = Math.round(clamp(finite(source.maxSamples, 120), 4, PLAYER_RUNTIME_BUDGET_LIMITS.maximumSampleCount));
    if (samples.length > maxSamples) {
      samples.splice(0, samples.length - maxSamples);
      droppedSamples += 1;
    }
  }
  return freeze({
    version: PLAYER_RUNTIME_TELEMETRY_VERSION,
    maxSamples: Math.round(clamp(finite(source.maxSamples, 120), 4, PLAYER_RUNTIME_BUDGET_LIMITS.maximumSampleCount)),
    samples: Object.freeze(samples.map((sample) => round(sample, 5))),
    droppedSamples,
    sequence: Math.max(0, Math.round(finite(source.sequence, 0))) + 1,
  });
}

export function appendRuntimeFrameSamples(state, rawDeltas = []) {
  let next = state && typeof state === 'object' ? state : createRuntimeTelemetryState();
  const values = Array.isArray(rawDeltas) ? rawDeltas : [];
  for (const delta of values) next = appendRuntimeFrameSample(next, delta);
  return next;
}

export function deriveRuntimeTelemetry(state = {}) {
  const samples = normalizeRuntimeFrameSamples(state.samples ?? []);
  const summary = summarizeRuntimeFrameSamples(samples);
  const classification = classifyRuntimeEnvironment(summary);
  return freeze({
    version: PLAYER_RUNTIME_TELEMETRY_VERSION,
    sequence: Math.max(0, Math.round(finite(state.sequence, samples.length))),
    droppedSamples: Math.max(0, Math.round(finite(state.droppedSamples, 0))),
    maxSamples: Math.round(clamp(finite(state.maxSamples, 120), 4, PLAYER_RUNTIME_BUDGET_LIMITS.maximumSampleCount)),
    summary,
    classification,
    simulationWallRatio: estimateSimulationWallRatio(summary),
    constrained: classification !== 'normal',
  });
}

export function buildRuntimeFrameWindow(state = {}, size = 12) {
  const samples = normalizeRuntimeFrameSamples(state.samples ?? []);
  const limit = Math.round(clamp(finite(size, 12), 1, 60));
  const window = samples.slice(-limit);
  return freeze({
    size: window.length,
    requestedSize: limit,
    samples: Object.freeze(window.map((sample) => round(sample, 5))),
    summary: summarizeRuntimeFrameSamples(window),
  });
}

function resolveTelemetryLike(value = {}) {
  if (value && value.summary && Number.isInteger(value.summary.count) && typeof value.classification === 'string') {
    return value;
  }
  return deriveRuntimeTelemetry(value);
}

export function detectCadenceTransition(state = {}, previousSummary = {}) {
  const next = resolveTelemetryLike(state);
  const priorFps = Math.max(0, finite(previousSummary.fps, next.summary.fps));
  const nextFps = Math.max(0, finite(next.summary.fps, 0));
  const drop = Math.max(0, priorFps - nextFps);
  const rise = Math.max(0, nextFps - priorFps);
  const previousClassification = previousSummary.classification ?? null;
  const transitionedToConstrained = previousClassification === 'normal' && next.classification !== 'normal';
  const recoveredToNormal = previousClassification !== 'normal' && next.classification === 'normal';
  return freeze({
    classification: next.classification,
    previousClassification,
    fpsBefore: round(priorFps, 3),
    fpsAfter: round(nextFps, 3),
    fpsDrop: round(drop, 3),
    fpsRise: round(rise, 3),
    transitionedToConstrained,
    recoveredToNormal,
  });
}

export function selectStableProbeSamples(state = {}, options = {}) {
  const samples = normalizeRuntimeFrameSamples(state.samples ?? []);
  const min = Math.round(clamp(finite(options.minimumSamples, 8), 4, 60));
  if (samples.length < min) return freeze({ ready: false, samples: Object.freeze(samples), reason: 'minimum sample window not reached' });
  const windowSize = Math.round(clamp(finite(options.windowSize, min), min, 60));
  const selected = samples.slice(-windowSize);
  return freeze({
    ready: selected.length >= min,
    samples: Object.freeze(selected),
    reason: 'latest bounded window selected for deterministic environment classification',
  });
}

export function createRuntimeProbeTranscript(samples = [], options = {}) {
  const state = appendRuntimeFrameSamples(createRuntimeTelemetryState({ maxSamples: options.maxSamples }), samples);
  const telemetry = deriveRuntimeTelemetry(state);
  const stable = selectStableProbeSamples(state, options);
  return freeze({
    version: PLAYER_RUNTIME_TELEMETRY_VERSION,
    stable,
    telemetry,
    environment: freeze({
      classification: telemetry.classification,
      fps: telemetry.summary.fps,
      meanFrameSeconds: telemetry.summary.meanSeconds,
      p95FrameSeconds: telemetry.summary.p95Seconds,
      simulationWallRatio: telemetry.simulationWallRatio,
    }),
  });
}

export function validateRuntimeTelemetry(report = {}) {
  const errors = [];
  if (report.version !== PLAYER_RUNTIME_TELEMETRY_VERSION) errors.push('version');
  if (!report.summary || !Number.isInteger(report.summary.count)) errors.push('summary.count');
  if (!['normal', 'constrained', 'severely-constrained', 'extremely-constrained'].includes(report.classification)) errors.push('classification');
  if (!Number.isFinite(report.simulationWallRatio) || report.simulationWallRatio <= 0 || report.simulationWallRatio > 1) errors.push('simulationWallRatio');
  return freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function replayRuntimeTelemetry(samples = [], options = {}) {
  const first = createRuntimeProbeTranscript(samples, options);
  const second = createRuntimeProbeTranscript(samples, options);
  const equivalent = JSON.stringify(first) === JSON.stringify(second);
  return freeze({ equivalent, first, second });
}

export const PLAYER_RUNTIME_TELEMETRY_OWNERSHIP = Object.freeze({
  reads: ['caller-supplied frame delta values'],
  writes: [],
  owns: ['bounded telemetry normalization', 'cadence classification', 'probe transcript'],
  delegates: ['clock source', 'browser scheduling', 'gameplay update loop', 'test assertion policy'],
});
