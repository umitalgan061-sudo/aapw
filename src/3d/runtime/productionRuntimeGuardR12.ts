/**
 * Production Runtime Guard R12.
 *
 * Strictly typed, allocation-bounded frame accounting for the browser game loop.
 * The guard is telemetry/recovery infrastructure only: it never owns gameplay state,
 * never mutates Three.js objects, and never introduces ambient randomness.
 */

export type RuntimeGuardPhase = 'healthy' | 'degraded' | 'recovering' | 'failed';

export interface RuntimeGuardClock {
  now(): number;
}

export interface RuntimeGuardOptions {
  readonly clock?: RuntimeGuardClock;
  readonly frameBudgetMs?: number;
  readonly warningMultiplier?: number;
  readonly maxFrameSamples?: number;
  readonly maxSubsystemSamples?: number;
  readonly consecutiveOverBudgetBeforeRecovery?: number;
  readonly consecutiveErrorsBeforeFailure?: number;
  readonly recoveryWindowFrames?: number;
}

export interface RuntimeFrameToken {
  readonly sequence: number;
  readonly startedAtMs: number;
  readonly budgetMs: number;
}

export interface RuntimeSubsystemSample {
  readonly name: string;
  readonly durationMs: number;
  readonly frameSequence: number;
  readonly ok: boolean;
}

export interface RuntimeGuardSnapshot {
  readonly phase: RuntimeGuardPhase;
  readonly sequence: number;
  readonly lastFrameMs: number;
  readonly averageFrameMs: number;
  readonly p50FrameMs: number;
  readonly p95FrameMs: number;
  readonly maxFrameMs: number;
  readonly frameBudgetMs: number;
  readonly warningBudgetMs: number;
  readonly overBudgetFrames: number;
  readonly consecutiveOverBudgetFrames: number;
  readonly consecutiveErrors: number;
  readonly recoveries: number;
  readonly subsystemSamples: readonly RuntimeSubsystemSample[];
  readonly lastErrorMessage: string | null;
}

const DEFAULTS = Object.freeze({
  frameBudgetMs: 16.67,
  warningMultiplier: 1.25,
  maxFrameSamples: 120,
  maxSubsystemSamples: 240,
  consecutiveOverBudgetBeforeRecovery: 8,
  consecutiveErrorsBeforeFailure: 3,
  recoveryWindowFrames: 30,
});

function finitePositive(value: unknown, fallback: number, label: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function finiteNonNegative(value: unknown, fallback: number, label: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function defaultClock(): RuntimeGuardClock {
  const perf = globalThis.performance;
  return Object.freeze({
    now(): number {
      return perf?.now?.() ?? 0;
    },
  });
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

function percentile(values: readonly number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const p = Math.max(0, Math.min(1, percentileValue));
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower] ?? 0;
  const left = sorted[lower] ?? 0;
  const right = sorted[upper] ?? left;
  return left + (right - left) * (index - lower);
}

function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 240);
  return String(error).slice(0, 240);
}

export class ProductionRuntimeGuardR12 {
  readonly #clock: RuntimeGuardClock;
  readonly #frameBudgetMs: number;
  readonly #warningBudgetMs: number;
  readonly #maxFrameSamples: number;
  readonly #maxSubsystemSamples: number;
  readonly #consecutiveOverBudgetBeforeRecovery: number;
  readonly #consecutiveErrorsBeforeFailure: number;
  readonly #recoveryWindowFrames: number;
  readonly #frameSamples: number[] = [];
  readonly #subsystemSamples: RuntimeSubsystemSample[] = [];
  #sequence = 0;
  #lastFrameMs = 0;
  #consecutiveOverBudgetFrames = 0;
  #overBudgetFrames = 0;
  #consecutiveErrors = 0;
  #recoveries = 0;
  #phase: RuntimeGuardPhase = 'healthy';
  #lastErrorMessage: string | null = null;
  #recoveryFramesRemaining = 0;
  #disposed = false;

  constructor(options: RuntimeGuardOptions = {}) {
    this.#clock = options.clock ?? defaultClock();
    this.#frameBudgetMs = finitePositive(options.frameBudgetMs, DEFAULTS.frameBudgetMs, 'frameBudgetMs');
    const warningMultiplier = finitePositive(options.warningMultiplier, DEFAULTS.warningMultiplier, 'warningMultiplier');
    this.#warningBudgetMs = this.#frameBudgetMs * warningMultiplier;
    this.#maxFrameSamples = clampInteger(options.maxFrameSamples, DEFAULTS.maxFrameSamples, 30, 600);
    this.#maxSubsystemSamples = clampInteger(options.maxSubsystemSamples, DEFAULTS.maxSubsystemSamples, 30, 2000);
    this.#consecutiveOverBudgetBeforeRecovery = clampInteger(
      options.consecutiveOverBudgetBeforeRecovery,
      DEFAULTS.consecutiveOverBudgetBeforeRecovery,
      1,
      120,
    );
    this.#consecutiveErrorsBeforeFailure = clampInteger(
      options.consecutiveErrorsBeforeFailure,
      DEFAULTS.consecutiveErrorsBeforeFailure,
      1,
      32,
    );
    this.#recoveryWindowFrames = clampInteger(
      options.recoveryWindowFrames,
      DEFAULTS.recoveryWindowFrames,
      1,
      600,
    );
  }

  beginFrame(): RuntimeFrameToken {
    this.#assertActive();
    this.#sequence += 1;
    if (this.#recoveryFramesRemaining > 0) {
      this.#recoveryFramesRemaining -= 1;
      if (this.#recoveryFramesRemaining === 0 && this.#phase === 'recovering') {
        this.#phase = 'degraded';
      }
    }
    const token: RuntimeFrameToken = Object.freeze({
      sequence: this.#sequence,
      startedAtMs: this.#clock.now(),
      budgetMs: this.#frameBudgetMs,
    });
    return token;
  }

  endFrame(token: RuntimeFrameToken): number {
    this.#assertActive();
    if (token.sequence !== this.#sequence) {
      throw new Error('Runtime guard frame token is stale or out of order');
    }
    const durationMs = Math.max(0, this.#clock.now() - token.startedAtMs);
    this.#recordFrame(durationMs);
    return durationMs;
  }

  measureSubsystem<T>(name: string, operation: () => T): T {
    this.#assertActive();
    const startedAtMs = this.#clock.now();
    try {
      const result = operation();
      this.#recordSubsystem(name, Math.max(0, this.#clock.now() - startedAtMs), true);
      return result;
    } catch (error) {
      this.#recordSubsystem(name, Math.max(0, this.#clock.now() - startedAtMs), false);
      this.captureError(error);
      throw error;
    }
  }

  captureError(error: unknown): void {
    this.#assertActive();
    this.#consecutiveErrors += 1;
    this.#lastErrorMessage = sanitizeErrorMessage(error);
    if (this.#consecutiveErrors >= this.#consecutiveErrorsBeforeFailure) {
      this.#phase = 'failed';
      return;
    }
    if (this.#phase === 'healthy') this.#phase = 'degraded';
  }

  markRecovered(): void {
    this.#assertActive();
    if (this.#phase === 'failed') this.#recoveries += 1;
    this.#consecutiveErrors = 0;
    this.#consecutiveOverBudgetFrames = 0;
    this.#recoveryFramesRemaining = this.#recoveryWindowFrames;
    this.#phase = 'recovering';
  }

  clearError(): void {
    this.#assertActive();
    this.#consecutiveErrors = 0;
    this.#lastErrorMessage = null;
    if (this.#phase === 'failed' || this.#phase === 'degraded') {
      this.#phase = 'recovering';
      this.#recoveryFramesRemaining = this.#recoveryWindowFrames;
    }
  }

  shouldThrottle(): boolean {
    this.#assertActive();
    return this.#phase === 'degraded' || this.#phase === 'recovering' || this.#phase === 'failed';
  }

  snapshot(): RuntimeGuardSnapshot {
    return Object.freeze({
      phase: this.#phase,
      sequence: this.#sequence,
      lastFrameMs: this.#lastFrameMs,
      averageFrameMs: average(this.#frameSamples),
      p50FrameMs: percentile(this.#frameSamples, 0.5),
      p95FrameMs: percentile(this.#frameSamples, 0.95),
      maxFrameMs: this.#frameSamples.length ? Math.max(...this.#frameSamples) : 0,
      frameBudgetMs: this.#frameBudgetMs,
      warningBudgetMs: this.#warningBudgetMs,
      overBudgetFrames: this.#overBudgetFrames,
      consecutiveOverBudgetFrames: this.#consecutiveOverBudgetFrames,
      consecutiveErrors: this.#consecutiveErrors,
      recoveries: this.#recoveries,
      subsystemSamples: Object.freeze(this.#subsystemSamples.map((sample) => Object.freeze({ ...sample }))),
      lastErrorMessage: this.#lastErrorMessage,
    });
  }

  reset(): void {
    this.#assertActive();
    this.#frameSamples.length = 0;
    this.#subsystemSamples.length = 0;
    this.#sequence = 0;
    this.#lastFrameMs = 0;
    this.#consecutiveOverBudgetFrames = 0;
    this.#overBudgetFrames = 0;
    this.#consecutiveErrors = 0;
    this.#recoveries = 0;
    this.#phase = 'healthy';
    this.#lastErrorMessage = null;
    this.#recoveryFramesRemaining = 0;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#frameSamples.length = 0;
    this.#subsystemSamples.length = 0;
  }

  #recordFrame(durationMs: number): void {
    this.#lastFrameMs = durationMs;
    this.#frameSamples.push(durationMs);
    while (this.#frameSamples.length > this.#maxFrameSamples) this.#frameSamples.shift();

    if (durationMs > this.#frameBudgetMs) {
      this.#overBudgetFrames += 1;
      this.#consecutiveOverBudgetFrames += 1;
      if (this.#consecutiveOverBudgetFrames >= this.#consecutiveOverBudgetBeforeRecovery) {
        this.#phase = 'recovering';
        this.#recoveryFramesRemaining = Math.max(this.#recoveryFramesRemaining, this.#recoveryWindowFrames);
      } else if (durationMs > this.#warningBudgetMs && this.#phase === 'healthy') {
        this.#phase = 'degraded';
      }
    } else {
      this.#consecutiveOverBudgetFrames = 0;
      if (this.#phase === 'degraded' && this.#consecutiveErrors === 0) {
        this.#phase = 'healthy';
      }
    }
  }

  #recordSubsystem(name: string, durationMs: number, ok: boolean): void {
    const safeName = String(name || 'unknown').slice(0, 96);
    this.#subsystemSamples.push(Object.freeze({
      name: safeName,
      durationMs,
      frameSequence: this.#sequence,
      ok,
    }));
    while (this.#subsystemSamples.length > this.#maxSubsystemSamples) this.#subsystemSamples.shift();
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('Production runtime guard is disposed');
  }
}

export function createProductionRuntimeGuardR12(options: RuntimeGuardOptions = {}): ProductionRuntimeGuardR12 {
  return new ProductionRuntimeGuardR12(options);
}
