import type { FrameId, QualityTier, UnixMillis } from './types';
import { average, percentile, validateFrameMetrics, type RuntimeFrameMetrics, type SessionBudget, type SessionTelemetryPoint } from './runtimeContracts';

export type HealthLevel = 'healthy' | 'watch' | 'degraded' | 'critical';

export interface BudgetResult {
  readonly name: string;
  readonly actualMs: number;
  readonly budgetMs: number;
  readonly exceeded: boolean;
  readonly ratio: number;
}

export interface PerformanceSample extends SessionTelemetryPoint {
  readonly timestamp: UnixMillis;
  readonly memoryBytes: number;
  readonly longTaskMs: number;
  readonly frameJitterMs: number;
}

export interface PerformanceSummary {
  readonly health: HealthLevel;
  readonly frameP50Ms: number;
  readonly frameP95Ms: number;
  readonly frameP99Ms: number;
  readonly averageFrameMs: number;
  readonly maxFrameMs: number;
  readonly jankRate: number;
  readonly longTaskRate: number;
  readonly memoryRatio: number;
  readonly pressure: number;
  readonly budgetViolations: number;
  readonly recommendedQuality: QualityTier;
}

export interface PerformanceLabOptions {
  readonly capacity?: number;
  readonly now?: () => UnixMillis;
  readonly budget?: SessionBudget;
  readonly memoryLimitBytes?: number;
  readonly targetFrameMs?: number;
  readonly longTaskThresholdMs?: number;
}

const QUALITY_ORDER: readonly QualityTier[] = ['minimal', 'low', 'medium', 'high', 'ultra'];

function safeNumber(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

export class PerformanceLab {
  readonly capacity: number;
  readonly budget: SessionBudget;
  readonly memoryLimitBytes: number;
  readonly targetFrameMs: number;
  readonly longTaskThresholdMs: number;
  #now: () => UnixMillis;
  #samples: PerformanceSample[] = [];
  #frameStart: number | null = null;
  #lastFrameDuration = 0;
  #longTaskMs = 0;
  #lastTimestamp = 0;
  #violations = new Map<string, number>();

  constructor(options: PerformanceLabOptions) {
    this.capacity = boundedInteger(options.capacity, 3600, 120, 50_000);
    this.budget = Object.freeze({ ...options.budget });
    this.memoryLimitBytes = Math.max(32 * 1024 * 1024, safeNumber(options.memoryLimitBytes ?? this.budget.memoryBytes, this.budget.memoryBytes));
    this.targetFrameMs = Math.max(8.333, safeNumber(options.targetFrameMs, 16.667));
    this.longTaskThresholdMs = Math.max(20, safeNumber(options.longTaskThresholdMs, 50));
    this.#now = options.now ?? (() => Date.now() as UnixMillis);
  }

  beginFrame(): void {
    this.#frameStart = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Number(this.#now());
  }

  endFrame(frame: FrameId, metrics: RuntimeFrameMetrics): PerformanceSample | null {
    const validation = validateFrameMetrics(metrics);
    if (!validation.ok) return null;
    const end = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Number(this.#now());
    const measured = this.#frameStart === null ? metrics.frameMs : Math.max(0, end - this.#frameStart);
    const frameMs = metrics.frameMs > 0 ? metrics.frameMs : measured;
    const jitter = Math.abs(frameMs - this.#lastFrameDuration);
    this.#lastFrameDuration = frameMs;
    const timestamp = this.#now();
    const memoryBytes = Math.max(0, metrics.memoryBytes ?? 0);
    const longTaskMs = metrics.frameMs >= this.longTaskThresholdMs ? metrics.frameMs : this.#longTaskMs;
    this.#longTaskMs = 0;
    const sample: PerformanceSample = Object.freeze({
      frame,
      timestamp,
      frameMs,
      simulationMs: metrics.simulationMs,
      presentationMs: metrics.presentationMs,
      inputMs: metrics.inputMs,
      saveMs: metrics.saveMs,
      entities: Math.max(0, Math.trunc(metrics.entityCount)),
      streamedCells: Math.max(0, Math.trunc(metrics.streamedCells)),
      pressure: Math.max(0, metrics.pressure),
      memoryBytes,
      longTaskMs,
      frameJitterMs: jitter,
    });
    this.#samples.push(sample);
    while (this.#samples.length > this.capacity) this.#samples.shift();
    this.#countBudget('frame', frameMs, this.targetFrameMs);
    this.#countBudget('simulation', metrics.simulationMs, this.budget.simulationMs);
    this.#countBudget('presentation', metrics.presentationMs, this.budget.presentationMs);
    this.#countBudget('input', metrics.inputMs, this.budget.inputMs);
    this.#countBudget('save', metrics.saveMs, this.budget.saveMs);
    if (memoryBytes > this.memoryLimitBytes) this.#countBudget('memory', memoryBytes, this.memoryLimitBytes);
    this.#frameStart = null;
    return sample;
  }

  reportLongTask(durationMs: number): void {
    this.#longTaskMs += Math.max(0, durationMs);
  }

  addSample(sample: PerformanceSample): void {
    this.#samples.push(Object.freeze({ ...sample }));
    while (this.#samples.length > this.capacity) this.#samples.shift();
  }

  budget(name: string, actualMs: number, budgetMs: number): BudgetResult {
    const actual = Math.max(0, safeNumber(actualMs));
    const budget = Math.max(0.001, safeNumber(budgetMs, 0.001));
    const ratio = actual / budget;
    const exceeded = actual > budget;
    if (exceeded) this.#countBudget(name, actual, budget);
    return Object.freeze({ name, actualMs: actual, budgetMs: budget, exceeded, ratio });
  }

  summary(): PerformanceSummary {
    const frames = this.#samples.map((sample) => sample.frameMs);
    const memoryRatio = this.#samples.length ? Math.min(1.5, Math.max(0, Math.max(...this.#samples.map((sample) => sample.memoryBytes)) / this.memoryLimitBytes)) : 0;
    const jankRate = this.#samples.length ? this.#samples.filter((sample) => sample.frameMs > 33.333).length / this.#samples.length : 0;
    const longTaskRate = this.#samples.length ? this.#samples.filter((sample) => sample.longTaskMs >= this.longTaskThresholdMs).length / this.#samples.length : 0;
    const pressure = this.#samples.length ? Math.min(1, average(this.#samples.map((sample) => sample.pressure))) : 0;
    const health = this.#health(frames, jankRate, longTaskRate, memoryRatio, pressure);
    return Object.freeze({
      health,
      frameP50Ms: percentile(frames, 0.5),
      frameP95Ms: percentile(frames, 0.95),
      frameP99Ms: percentile(frames, 0.99),
      averageFrameMs: average(frames),
      maxFrameMs: frames.length ? Math.max(...frames) : 0,
      jankRate,
      longTaskRate,
      memoryRatio,
      pressure,
      budgetViolations: [...this.#violations.values()].reduce((sum, value) => sum + value, 0),
      recommendedQuality: this.#recommendedQuality(health, pressure, jankRate),
    });
  }

  samples(): readonly PerformanceSample[] {
    return Object.freeze([...this.#samples]);
  }

  budgetCounts(): Readonly<Record<string, number>> {
    return Object.freeze(Object.fromEntries(this.#violations.entries()));
  }

  reset(): void {
    this.#samples = [];
    this.#violations.clear();
    this.#frameStart = null;
    this.#lastFrameDuration = 0;
    this.#longTaskMs = 0;
    this.#lastTimestamp = 0;
  }

  #countBudget(name: string, actual: number, budget: number): void {
    if (actual <= budget) return;
    this.#violations.set(name, (this.#violations.get(name) ?? 0) + 1);
  }

  #health(frames: readonly number[], jankRate: number, longTaskRate: number, memoryRatio: number, pressure: number): HealthLevel {
    if (!frames.length) return 'healthy';
    const p95 = percentile(frames, 0.95);
    if (p95 > 50 || jankRate > 0.25 || longTaskRate > 0.1 || memoryRatio > 1 || pressure > 0.9) return 'critical';
    if (p95 > 33.333 || jankRate > 0.08 || longTaskRate > 0.03 || memoryRatio > 0.85 || pressure > 0.7) return 'degraded';
    if (p95 > 22 || jankRate > 0.02 || memoryRatio > 0.7 || pressure > 0.45) return 'watch';
    return 'healthy';
  }

  #recommendedQuality(health: HealthLevel, pressure: number, jankRate: number): QualityTier {
    const high = QUALITY_ORDER.length - 1;
    const index = Math.max(0, high - (health === 'critical' ? 3 : health === 'degraded' ? 2 : health === 'watch' ? 1 : 0));
    const pressurePenalty = pressure > 0.82 || jankRate > 0.15 ? 1 : 0;
    return QUALITY_ORDER[Math.max(0, index - pressurePenalty)] ?? 'high';
  }

  observeBrowser(): void {
    if (typeof PerformanceObserver === 'undefined') return;
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === 'longtask') this.reportLongTask(entry.duration);
        }
      });
      observer.observe({ entryTypes: ['longtask'] });
    } catch {
      // Some browser implementations expose PerformanceObserver but do not support longtask.
    }
  }

  memoryUsage(): number {
    const performanceWithMemory = performance as Performance & { memory?: { usedJSHeapSize?: number } };
    return Math.max(0, performanceWithMemory.memory?.usedJSHeapSize ?? 0);
  }

  clockDrift(expectedMs: number): number {
    const now = Number(this.#now());
    if (!this.#lastTimestamp) {
      this.#lastTimestamp = now;
      return 0;
    }
    const actual = Math.max(0, now - this.#lastTimestamp);
    this.#lastTimestamp = now;
    return actual - Math.max(0, expectedMs);
  }
}

export interface FramePacerOptions {
  readonly maxCatchUpSteps?: number;
  readonly stepMs?: number;
}

/** Fixed-rate pacer used by simulation/update bridges to prevent spiral-of-death after tab throttling. */
export class FramePacer {
  readonly stepMs: number;
  readonly maxCatchUpSteps: number;
  #accumulator = 0;
  #lastTimestamp: number | null = null;
  #droppedMs = 0;

  constructor(options: FramePacerOptions = {}) {
    this.stepMs = Math.max(1, safeNumber(options.stepMs, 1000 / 60));
    this.maxCatchUpSteps = Math.max(1, Math.min(16, Math.trunc(options.maxCatchUpSteps ?? 5)));
  }

  push(timestampMs: number): readonly number[] {
    const timestamp = safeNumber(timestampMs);
    if (this.#lastTimestamp === null) {
      this.#lastTimestamp = timestamp;
      return [];
    }
    let elapsed = Math.max(0, timestamp - this.#lastTimestamp);
    this.#lastTimestamp = timestamp;
    elapsed = Math.min(elapsed, this.stepMs * (this.maxCatchUpSteps + 1));
    this.#accumulator += elapsed;
    const steps: number[] = [];
    while (this.#accumulator >= this.stepMs && steps.length < this.maxCatchUpSteps) {
      steps.push(this.stepMs / 1000);
      this.#accumulator -= this.stepMs;
    }
    if (this.#accumulator >= this.stepMs) {
      this.#droppedMs += this.#accumulator;
      this.#accumulator = 0;
    }
    return Object.freeze(steps);
  }

  interpolationAlpha(): number {
    return this.#accumulator / this.stepMs;
  }

  droppedMilliseconds(): number {
    return this.#droppedMs;
  }

  reset(): void {
    this.#accumulator = 0;
    this.#lastTimestamp = null;
    this.#droppedMs = 0;
  }
}
