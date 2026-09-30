/** Production TypeScript owner for player runtime budget policy. Legacy JS remains compatibility-only.
 *
 * This policy is deliberately detached from gameplay simulation: it consumes measured frame timing
 * and returns bounded verification guidance without mutating rendering, physics, animation or clocks.
 */

export const PLAYER_RUNTIME_BUDGET_VERSION = '2026-09-15-v2' as const;

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
} as const);

export type RuntimeEnvironmentClassification =
  | 'normal'
  | 'constrained'
  | 'severely-constrained'
  | 'extremely-constrained';

export interface RuntimeFrameSummary {
  readonly count: number;
  readonly minSeconds: number;
  readonly medianSeconds: number;
  readonly p95Seconds: number;
  readonly maxSeconds: number;
  readonly meanSeconds: number;
  readonly fps: number;
}

export interface RuntimeBudgetOptions {
  readonly extraMultiplier?: unknown;
  readonly targetFramesPerPoll?: unknown;
  readonly requiredSamples?: unknown;
  readonly minimumFps?: unknown;
  readonly simulationSeconds?: unknown;
}

export interface RuntimeBudgetDecision {
  readonly version: typeof PLAYER_RUNTIME_BUDGET_VERSION;
  readonly classification: RuntimeEnvironmentClassification;
  readonly probeReady: boolean;
  readonly softSkip: boolean;
  readonly summary: RuntimeFrameSummary;
  readonly simulationSeconds: number;
  readonly estimatedWallSeconds: number;
  readonly timeoutMs: number;
  readonly pollIntervalMs: number;
  readonly simulationWallRatio: number;
  readonly reason: string;
}

export interface RuntimeBudgetReceipt {
  readonly version: typeof PLAYER_RUNTIME_BUDGET_VERSION;
  readonly classification: RuntimeEnvironmentClassification;
  readonly probeReady: boolean;
  readonly softSkip: boolean;
  readonly timeoutMs: number;
  readonly pollIntervalMs: number;
  readonly simulationWallRatio: number;
  readonly sampleCount: number;
  readonly fps: number;
  readonly evidence: Readonly<{
    medianFrameSeconds: number;
    p95FrameSeconds: number;
    maxFrameSeconds: number;
    simulationSeconds: number;
    estimatedWallSeconds: number;
  }>;
}

export interface RuntimeBudgetValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export interface RuntimeBudgetComparison {
  readonly classificationChanged: boolean;
  readonly timeoutDeltaMs: number;
  readonly fpsDelta: number;
  readonly ratioDelta: number;
  readonly moreConstrained: boolean;
  readonly left: RuntimeBudgetDecision;
  readonly right: RuntimeBudgetDecision;
}

export const PLAYER_RUNTIME_BUDGET_OWNERSHIP = Object.freeze({
  reads: ['measured frame deltas', 'verification intent', 'simulation duration'],
  writes: [],
  owns: ['test timeout derivation', 'poll pacing recommendation', 'environment classification'],
  delegates: ['browser rendering', 'gameplay simulation', 'test assertion execution'],
} as const);

const clamp = (value: unknown, min: number, max: number): number => {
  const numeric = Number(value);
  const safe = Number.isFinite(numeric) ? numeric : min;
  return Math.max(min, Math.min(max, safe));
};

const finite = (value: unknown, fallback = 0): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const round = (value: number, digits = 4): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const normalizeDelta = (delta: unknown): number =>
  clamp(delta, PLAYER_RUNTIME_BUDGET_LIMITS.minimumFrameSeconds, PLAYER_RUNTIME_BUDGET_LIMITS.maximumFrameSeconds);

export function normalizeRuntimeFrameSamples(samples: readonly unknown[] = []): readonly number[] {
  const values = Array.isArray(samples) ? samples : [];
  return Object.freeze(
    values
      .slice(-PLAYER_RUNTIME_BUDGET_LIMITS.maximumSampleCount)
      .map(normalizeDelta)
      .filter(Number.isFinite),
  );
}

export function summarizeRuntimeFrameSamples(samples: readonly unknown[] = []): RuntimeFrameSummary {
  const values = normalizeRuntimeFrameSamples(samples);
  if (values.length === 0) {
    return Object.freeze({
      count: 0,
      minSeconds: 0,
      medianSeconds: 0,
      p95Seconds: 0,
      maxSeconds: 0,
      meanSeconds: 0,
      fps: 0,
    });
  }

  const sorted = [...values].sort((a, b) => a - b);
  const at = (ratio: number): number =>
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))] ?? 0;
  const total = sorted.reduce((sum, value) => sum + value, 0);
  const mean = total / sorted.length;

  return Object.freeze({
    count: sorted.length,
    minSeconds: round(sorted[0] ?? 0, 5),
    medianSeconds: round(at(0.5), 5),
    p95Seconds: round(at(0.95), 5),
    maxSeconds: round(sorted[sorted.length - 1] ?? 0, 5),
    meanSeconds: round(mean, 5),
    fps: round(1 / Math.max(mean, PLAYER_RUNTIME_BUDGET_LIMITS.minimumFrameSeconds), 3),
  });
}

export function classifyRuntimeEnvironment(summary: Partial<RuntimeFrameSummary> = {}): RuntimeEnvironmentClassification {
  const fps = Math.max(0, finite(summary.fps, 0));
  if (fps >= PLAYER_RUNTIME_BUDGET_LIMITS.normalFpsFloor) return 'normal';
  if (fps >= PLAYER_RUNTIME_BUDGET_LIMITS.constrainedFpsFloor) return 'constrained';
  if (fps >= PLAYER_RUNTIME_BUDGET_LIMITS.severeFpsFloor) return 'severely-constrained';
  return 'extremely-constrained';
}

function environmentMultiplier(classification: RuntimeEnvironmentClassification): number {
  switch (classification) {
    case 'normal': return PLAYER_RUNTIME_BUDGET_LIMITS.normalMultiplier;
    case 'constrained': return PLAYER_RUNTIME_BUDGET_LIMITS.constrainedMultiplier;
    case 'severely-constrained': return PLAYER_RUNTIME_BUDGET_LIMITS.severeMultiplier;
    case 'extremely-constrained': return PLAYER_RUNTIME_BUDGET_LIMITS.maximumMultiplier;
  }
}

export function estimateSimulationWallRatio(summary: Partial<RuntimeFrameSummary> = {}): number {
  const mean = Math.max(
    PLAYER_RUNTIME_BUDGET_LIMITS.minimumFrameSeconds,
    finite(summary.meanSeconds, 1 / 60),
  );
  const simulatedStep = Math.min(0.1, mean);
  return round(simulatedStep / mean, 5);
}

export function estimateWallClockForSimulation(
  simulationSeconds: unknown,
  summary: Partial<RuntimeFrameSummary> = {},
): number {
  const seconds = Math.max(0, finite(simulationSeconds, 0));
  const ratio = Math.max(0.0001, estimateSimulationWallRatio(summary));
  return round(seconds / ratio, 3);
}

export function calculateVerificationTimeout(
  simulationSeconds: unknown,
  summary: Partial<RuntimeFrameSummary> = {},
  options: RuntimeBudgetOptions = {},
): number {
  const wallSeconds = estimateWallClockForSimulation(simulationSeconds, summary);
  const classification = classifyRuntimeEnvironment(summary);
  const multiplier = clamp(
    options.extraMultiplier,
    1,
    PLAYER_RUNTIME_BUDGET_LIMITS.maximumMultiplier,
  );
  const safety = environmentMultiplier(classification) * multiplier;
  const baseMs = Math.max(
    PLAYER_RUNTIME_BUDGET_LIMITS.minimumTimeoutMs,
    wallSeconds * 1000 * 1.15,
  );
  return Math.round(
    clamp(
      baseMs * safety,
      PLAYER_RUNTIME_BUDGET_LIMITS.minimumTimeoutMs,
      PLAYER_RUNTIME_BUDGET_LIMITS.maximumTimeoutMs,
    ),
  );
}

export function calculatePollInterval(
  summary: Partial<RuntimeFrameSummary> = {},
  options: RuntimeBudgetOptions = {},
): number {
  const mean = Math.max(
    PLAYER_RUNTIME_BUDGET_LIMITS.minimumFrameSeconds,
    finite(summary.meanSeconds, 1 / 60),
  );
  const targetFrames = clamp(
    options.targetFramesPerPoll,
    0.1,
    4,
  ) || 0.5;
  return Math.round(
    clamp(
      mean * 1000 * targetFrames,
      25,
      PLAYER_RUNTIME_BUDGET_LIMITS.maximumPollIntervalMs,
    ),
  );
}

export function shouldSoftSkipRuntimeAssertion(
  summary: Partial<RuntimeFrameSummary> = {},
  options: RuntimeBudgetOptions = {},
): boolean {
  const count = Math.max(0, finite(summary.count, 0));
  const fps = Math.max(0, finite(summary.fps, 0));
  const requiredSamples = Math.max(
    PLAYER_RUNTIME_BUDGET_LIMITS.minimumSampleCount,
    finite(options.requiredSamples, 4),
  );
  const minimumFps = Math.max(0.1, finite(options.minimumFps, 0.5));
  return count < requiredSamples || fps < minimumFps;
}

export function buildRuntimeBudgetDecision(
  samples: readonly unknown[] = [],
  options: RuntimeBudgetOptions = {},
): RuntimeBudgetDecision {
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

export type RuntimeBudgetInput = RuntimeBudgetOptions & { readonly samples?: readonly unknown[] };

export function compareRuntimeBudgets(
  a: RuntimeBudgetInput | readonly unknown[] = [],
  b: RuntimeBudgetInput | readonly unknown[] = [],
): RuntimeBudgetComparison {
  const leftSamples = Array.isArray(a) ? a : (a.samples ?? []);
  const rightSamples = Array.isArray(b) ? b : (b.samples ?? []);
  const leftOptions: RuntimeBudgetOptions = Array.isArray(a) ? {} : a;
  const rightOptions: RuntimeBudgetOptions = Array.isArray(b) ? {} : b;
  const left = buildRuntimeBudgetDecision(leftSamples, leftOptions);
  const right = buildRuntimeBudgetDecision(rightSamples, rightOptions);
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

export function createRuntimeBudgetReceipt(
  samples: readonly unknown[] = [],
  options: RuntimeBudgetOptions = {},
): RuntimeBudgetReceipt {
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

export function validateRuntimeBudgetDecision(
  decision: Partial<RuntimeBudgetDecision> = {},
): RuntimeBudgetValidation {
  const errors: string[] = [];
  if (decision.version !== PLAYER_RUNTIME_BUDGET_VERSION) errors.push('version');
  if (!['normal', 'constrained', 'severely-constrained', 'extremely-constrained'].includes(String(decision.classification))) errors.push('classification');
  if (!Number.isInteger(decision.timeoutMs) || decision.timeoutMs! < PLAYER_RUNTIME_BUDGET_LIMITS.minimumTimeoutMs || decision.timeoutMs! > PLAYER_RUNTIME_BUDGET_LIMITS.maximumTimeoutMs) errors.push('timeoutMs');
  if (!Number.isInteger(decision.pollIntervalMs) || decision.pollIntervalMs! < 25 || decision.pollIntervalMs! > PLAYER_RUNTIME_BUDGET_LIMITS.maximumPollIntervalMs) errors.push('pollIntervalMs');
  if (!Number.isFinite(decision.simulationWallRatio) || decision.simulationWallRatio! <= 0 || decision.simulationWallRatio! > 1) errors.push('simulationWallRatio');
  if (!decision.summary || !Number.isInteger(decision.summary.count)) errors.push('summary');
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}
