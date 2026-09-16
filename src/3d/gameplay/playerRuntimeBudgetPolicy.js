/**
 * Adaptive test-runtime policy for slow or software-rendered player sessions.
 *
 * The policy is intentionally detached from gameplay state. It consumes measured frame timing
 * and returns bounded execution guidance for verification tools. It never changes player physics,
 * simulation clocks, animation state, or browser rendering behavior.
 */

export const PLAYER_RUNTIME_BUDGET_VERSION = '2026-09-15-v1';

export const PLAYER_RUNTIME_BUDGET_LIMITS = Object.freeze({
  minimumSampleCount: 4,
  maximumSampleCount: 240,
  minimumFrameSeconds: 1 / 240,
  maximumFrameSeconds: 30,
  normalFpsFloor: 30,
  constrainedFpsFloor: 8,
  severeFpsFloor: 1,
  normalMultiplier: 1,
  constrainedMultiplier: 3,
  severeMultiplier: 8,
  maximumMultiplier: 20,
  minimumTimeoutMs: 5000,
  maximumTimeoutMs: 900000,
  maximumPollIntervalMs: 500,
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const round = (value, digits = 4) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

function normalizeDelta(delta) {
  return clamp(finite(delta, 0), PLAYER_RUNTIME_BUDGET_LIMITS.minimumFrameSeconds, PLAYER_RUNTIME_BUDGET_LIMITS.maximumFrameSeconds);
}

export function normalizeRuntimeFrameSamples(samples = []) {
  const values = Array.isArray(samples) ? samples : [];
  return Object.freeze(values
    .slice(-PLAYER_RUNTIME_BUDGET_LIMITS.maximumSampleCount)
    .map(normalizeDelta)
    .filter(Number.isFinite));
}

export function summarizeRuntimeFrameSamples(samples = []) {
  const values = normalizeRuntimeFrameSamples(samples);
  if (values.length === 0) {
    return Object.freeze({ count: 0, minSeconds: 0, medianSeconds: 0, p95Seconds: 0, maxSeconds: 0, meanSeconds: 0, fps: 0 });
  }
  const sorted = [...values].sort((a, b) => a - b);
  const at = (ratio) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
  const total = sorted.reduce((sum, value) => sum + value, 0);
  const mean = total / sorted.length;
  const median = at(0.5);
  const p95 = at(0.95);
  const max = sorted[sorted.length - 1];
  return Object.freeze({
    count: sorted.length,
    minSeconds: round(sorted[0], 5),
    medianSeconds: round(median, 5),
    p95Seconds: round(p95, 5),
    maxSeconds: round(max, 5),
    meanSeconds: round(mean, 5),
    fps: round(1 / Math.max(mean, PLAYER_RUNTIME_BUDGET_LIMITS.minimumFrameSeconds), 3),
  });
}

export function classifyRuntimeEnvironment(summary = {}) {
  const fps = Math.max(0, finite(summary.fps, 0));
  if (fps >= PLAYER_RUNTIME_BUDGET_LIMITS.normalFpsFloor) return 'normal';
  if (fps >= PLAYER_RUNTIME_BUDGET_LIMITS.constrainedFpsFloor) return 'constrained';
  if (fps >= PLAYER_RUNTIME_BUDGET_LIMITS.severeFpsFloor) return 'severely-constrained';
  return 'extremely-constrained';
}

function environmentMultiplier(classification) {
  switch (classification) {
    case 'normal': return PLAYER_RUNTIME_BUDGET_LIMITS.normalMultiplier;
    case 'constrained': return PLAYER_RUNTIME_BUDGET_LIMITS.constrainedMultiplier;
    case 'severely-constrained': return PLAYER_RUNTIME_BUDGET_LIMITS.severeMultiplier;
    default: return PLAYER_RUNTIME_BUDGET_LIMITS.maximumMultiplier;
  }
}

export function estimateSimulationWallRatio(summary = {}) {
  const mean = Math.max(PLAYER_RUNTIME_BUDGET_LIMITS.minimumFrameSeconds, finite(summary.meanSeconds, 1 / 60));
  const simulatedStep = Math.min(0.1, mean);
  return round(simulatedStep / mean, 5);
}

export function estimateWallClockForSimulation(simulationSeconds, summary = {}) {
  const seconds = Math.max(0, finite(simulationSeconds, 0));
  const ratio = Math.max(0.0001, estimateSimulationWallRatio(summary));
  return round(seconds / ratio, 3);
}

export function calculateVerificationTimeout(simulationSeconds, summary = {}, options = {}) {
  const wallSeconds = estimateWallClockForSimulation(simulationSeconds, summary);
  const classification = classifyRuntimeEnvironment(summary);
  const multiplier = clamp(finite(options.extraMultiplier, 1), 1, PLAYER_RUNTIME_BUDGET_LIMITS.maximumMultiplier);
  const safety = environmentMultiplier(classification) * multiplier;
  const baseMs = Math.max(PLAYER_RUNTIME_BUDGET_LIMITS.minimumTimeoutMs, wallSeconds * 1000 * 1.15);
  return Math.round(clamp(baseMs * safety, PLAYER_RUNTIME_BUDGET_LIMITS.minimumTimeoutMs, PLAYER_RUNTIME_BUDGET_LIMITS.maximumTimeoutMs));
}

export function calculatePollInterval(summary = {}, options = {}) {
  const mean = Math.max(PLAYER_RUNTIME_BUDGET_LIMITS.minimumFrameSeconds, finite(summary.meanSeconds, 1 / 60));
  const targetFrames = clamp(finite(options.targetFramesPerPoll, 0.5), 0.1, 4);
  return Math.round(clamp(mean * 1000 * targetFrames, 25, PLAYER_RUNTIME_BUDGET_LIMITS.maximumPollIntervalMs));
}

export function shouldSoftSkipRuntimeAssertion(summary = {}, options = {}) {
  const count = Math.max(0, finite(summary.count, 0));
  const fps = Math.max(0, finite(summary.fps, 0));
  const requiredSamples = Math.max(PLAYER_RUNTIME_BUDGET_LIMITS.minimumSampleCount, finite(options.requiredSamples, 4));
  const minimumFps = Math.max(0.1, finite(options.minimumFps, 0.5));
  return count < requiredSamples || fps < minimumFps;
}

export function buildRuntimeBudgetDecision(samples = [], options = {}) {
  const summary = summarizeRuntimeFrameSamples(samples);
  const classification = classifyRuntimeEnvironment(summary);
  const probeReady = summary.count >= PLAYER_RUNTIME_BUDGET_LIMITS.minimumSampleCount;
  const simulationSeconds = Math.max(0, finite(options.simulationSeconds, 1));
  const timeoutMs = calculateVerificationTimeout(simulationSeconds, summary, options);
  const pollIntervalMs = calculatePollInterval(summary, options);
  const softSkip = shouldSoftSkipRuntimeAssertion(summary, options);
  return Object.freeze({
    version: PLAYER_RUNTIME_BUDGET_VERSION,
    classification,
    probeReady,
    softSkip,
    summary,
    simulationSeconds: round(simulationSeconds, 3),
    estimatedWallSeconds: estimateWallClockForSimulation(simulationSeconds, summary),
    timeoutMs,
    pollIntervalMs,
    simulationWallRatio: estimateSimulationWallRatio(summary),
    reason: softSkip
      ? 'insufficient measured runtime evidence for a reliable interactive assertion'
      : classification === 'normal'
        ? 'normal rendering cadence supports standard verification budget'
        : `measured cadence is ${classification}; timeout is derived from observed wall/simulation ratio`,
  });
}

export function compareRuntimeBudgets(a = {}, b = {}) {
  const left = buildRuntimeBudgetDecision(a.samples ?? a, a);
  const right = buildRuntimeBudgetDecision(b.samples ?? b, b);
  return Object.freeze({
    classificationChanged: left.classification !== right.classification,
    timeoutDeltaMs: right.timeoutMs - left.timeoutMs,
    fpsDelta: round(right.summary.fps - left.summary.fps, 3),
    ratioDelta: round(right.simulationWallRatio - left.simulationWallRatio, 5),
    moreConstrained: right.summary.fps < left.summary.fps,
    left,
    right,
  });
}

export function createRuntimeBudgetReceipt(samples = [], options = {}) {
  const decision = buildRuntimeBudgetDecision(samples, options);
  return Object.freeze({
    version: decision.version,
    classification: decision.classification,
    probeReady: decision.probeReady,
    softSkip: decision.softSkip,
    timeoutMs: decision.timeoutMs,
    pollIntervalMs: decision.pollIntervalMs,
    simulationWallRatio: decision.simulationWallRatio,
    sampleCount: decision.summary.count,
    fps: decision.summary.fps,
    evidence: Object.freeze({
      medianFrameSeconds: decision.summary.medianSeconds,
      p95FrameSeconds: decision.summary.p95Seconds,
      maxFrameSeconds: decision.summary.maxSeconds,
      simulationSeconds: decision.simulationSeconds,
      estimatedWallSeconds: decision.estimatedWallSeconds,
    }),
  });
}

export function validateRuntimeBudgetDecision(decision = {}) {
  const errors = [];
  if (decision.version !== PLAYER_RUNTIME_BUDGET_VERSION) errors.push('version');
  if (!['normal', 'constrained', 'severely-constrained', 'extremely-constrained'].includes(decision.classification)) errors.push('classification');
  if (!Number.isInteger(decision.timeoutMs) || decision.timeoutMs < PLAYER_RUNTIME_BUDGET_LIMITS.minimumTimeoutMs || decision.timeoutMs > PLAYER_RUNTIME_BUDGET_LIMITS.maximumTimeoutMs) errors.push('timeoutMs');
  if (!Number.isInteger(decision.pollIntervalMs) || decision.pollIntervalMs < 25 || decision.pollIntervalMs > PLAYER_RUNTIME_BUDGET_LIMITS.maximumPollIntervalMs) errors.push('pollIntervalMs');
  if (!Number.isFinite(decision.simulationWallRatio) || decision.simulationWallRatio <= 0 || decision.simulationWallRatio > 1) errors.push('simulationWallRatio');
  if (!decision.summary || !Number.isInteger(decision.summary.count)) errors.push('summary');
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export const PLAYER_RUNTIME_BUDGET_OWNERSHIP = Object.freeze({
  reads: ['measured frame deltas', 'verification intent', 'simulation duration'],
  writes: [],
  owns: ['test timeout derivation', 'poll pacing recommendation', 'environment classification'],
  delegates: ['browser rendering', 'gameplay simulation', 'test assertion execution'],
});
