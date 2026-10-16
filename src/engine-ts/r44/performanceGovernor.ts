/**
 * Runtime performance control plane.
 *
 * Uses bounded windows and hysteresis to avoid expensive allocations and oscillating
 * quality changes. Samples are values supplied by the host; this module never reads
 * performance.now(), Date.now(), navigator, or other ambient process state.
 */
import {
  R44BoundaryError,
  R44InvariantError,
  type R44HealthGrade,
  type R44JsonValue,
  type R44PressureLevel,
  r44Clamp,
  r44FiniteInteger,
  r44FiniteNumber,
  r44SafeRatio,
} from "./contracts.js";

export interface R44PerformanceSample {
  readonly tick: number;
  readonly frameMs: number;
  readonly simulationMs: number;
  readonly renderMs: number;
  readonly memoryMb: number;
  readonly networkRttMs: number;
  readonly activeEntities: number;
  readonly queuedTasks: number;
  readonly droppedFrames?: number;
  readonly longTaskCount?: number;
}

export interface R44PerformanceBudgets {
  readonly frameMs: number;
  readonly simulationMs: number;
  readonly renderMs: number;
  readonly memoryMb: number;
  readonly networkRttMs: number;
  readonly activeEntities: number;
  readonly queuedTasks: number;
}

export interface R44PerformanceGovernorOptions {
  readonly capacity?: number;
  readonly budgets?: Partial<R44PerformanceBudgets>;
  readonly promoteAfter?: number;
  readonly recoverAfter?: number;
  readonly smoothingAlpha?: number;
  readonly minimumSamplesForPercentile?: number;
}

export interface R44PerformanceMetricSummary {
  readonly count: number;
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  readonly p50: number;
  readonly p90: number;
  readonly p95: number;
  readonly latest: number;
  readonly ewma: number;
}

export interface R44PerformanceReport {
  readonly tick: number;
  readonly state: R44PressureLevel;
  readonly health: R44HealthGrade;
  readonly score: number;
  readonly sampleCount: number;
  readonly consecutiveViolations: number;
  readonly consecutiveRecoveries: number;
  readonly metrics: Readonly<Record<keyof R44PerformanceBudgets, R44PerformanceMetricSummary>>;
  readonly exceededBudgets: readonly (keyof R44PerformanceBudgets)[];
  readonly recommendations: readonly string[];
}

interface R44MetricWindow {
  readonly values: number[];
  index: number;
  count: number;
  sum: number;
  ewma: number;
  initialized: boolean;
  latest: number;
}

const R44_METRICS: readonly (keyof R44PerformanceBudgets)[] = Object.freeze([
  "frameMs", "simulationMs", "renderMs", "memoryMb", "networkRttMs", "activeEntities", "queuedTasks",
]);

const R44_DEFAULT_BUDGETS: R44PerformanceBudgets = Object.freeze({
  frameMs: 16.667,
  simulationMs: 5.5,
  renderMs: 9.0,
  memoryMb: 1024,
  networkRttMs: 180,
  activeEntities: 25_000,
  queuedTasks: 8_000,
});

function createWindow(capacity: number): R44MetricWindow {
  return { values: new Array<number>(capacity), index: 0, count: 0, sum: 0, ewma: 0, initialized: false, latest: 0 };
}

function pushWindow(window: R44MetricWindow, value: number, alpha: number): void {
  if (window.count === window.values.length) {
    const old = window.values[window.index] ?? 0;
    window.sum -= old;
  } else {
    window.count += 1;
  }
  window.values[window.index] = value;
  window.index = (window.index + 1) % window.values.length;
  window.sum += value;
  window.latest = value;
  window.ewma = window.initialized ? alpha * value + (1 - alpha) * window.ewma : value;
  window.initialized = true;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const position = r44Clamp(p, 0, 1) * (sorted.length - 1);
  const low = Math.floor(position);
  const high = Math.ceil(position);
  const a = sorted[low] ?? sorted[sorted.length - 1] ?? 0;
  const b = sorted[high] ?? a;
  return a + (b - a) * (position - low);
}

function summarize(window: R44MetricWindow): R44PerformanceMetricSummary {
  const values = window.values.slice(0, window.count).sort((a, b) => a - b);
  return Object.freeze({
    count: window.count,
    min: values[0] ?? 0,
    max: values[values.length - 1] ?? 0,
    mean: window.count === 0 ? 0 : window.sum / window.count,
    p50: percentile(values, 0.5),
    p90: percentile(values, 0.9),
    p95: percentile(values, 0.95),
    latest: window.latest,
    ewma: window.ewma,
  });
}

function validateSample(sample: R44PerformanceSample): void {
  r44FiniteInteger(sample.tick, "tick", 0);
  r44FiniteNumber(sample.frameMs, "frameMs", 0, 60_000);
  r44FiniteNumber(sample.simulationMs, "simulationMs", 0, 60_000);
  r44FiniteNumber(sample.renderMs, "renderMs", 0, 60_000);
  r44FiniteNumber(sample.memoryMb, "memoryMb", 0, 1_000_000);
  r44FiniteNumber(sample.networkRttMs, "networkRttMs", 0, 600_000);
  r44FiniteInteger(sample.activeEntities, "activeEntities", 0, 100_000_000);
  r44FiniteInteger(sample.queuedTasks, "queuedTasks", 0, 100_000_000);
  r44FiniteInteger(sample.droppedFrames ?? 0, "droppedFrames", 0, 10_000_000);
  r44FiniteInteger(sample.longTaskCount ?? 0, "longTaskCount", 0, 10_000_000);
}

export class R44PerformanceGovernor {
  readonly #capacity: number;
  readonly #budgets: R44PerformanceBudgets;
  readonly #alpha: number;
  readonly #minimumSamplesForPercentile: number;
  readonly #promoteAfter: number;
  readonly #recoverAfter: number;
  readonly #windows: Record<keyof R44PerformanceBudgets, R44MetricWindow>;
  #state: R44PressureLevel = "nominal";
  #tick = 0;
  #sampleCount = 0;
  #consecutiveViolations = 0;
  #consecutiveRecoveries = 0;
  #lastExceeded: readonly (keyof R44PerformanceBudgets)[] = Object.freeze([]);
  #droppedFrames = 0;
  #longTasks = 0;

  constructor(options: R44PerformanceGovernorOptions = {}) {
    this.#capacity = r44FiniteInteger(options.capacity ?? 240, "capacity", 8, 100_000);
    this.#budgets = Object.freeze({ ...R44_DEFAULT_BUDGETS, ...(options.budgets ?? {}) });
    for (const key of R44_METRICS) {
      const value = this.#budgets[key];
      r44FiniteNumber(value, "budget." + key, 0.0001, 1_000_000_000);
    }
    this.#alpha = r44Clamp(options.smoothingAlpha ?? 0.18, 0.01, 1);
    const minimumSamplesForPercentile = options.minimumSamplesForPercentile ?? Math.min(12, this.#capacity);
    this.#minimumSamplesForPercentile = r44FiniteInteger(minimumSamplesForPercentile, "minimumSamplesForPercentile", 1, this.#capacity);
    this.#promoteAfter = r44FiniteInteger(options.promoteAfter ?? 3, "promoteAfter", 1, 1000);
    this.#recoverAfter = r44FiniteInteger(options.recoverAfter ?? 20, "recoverAfter", 1, 10_000);
    this.#windows = Object.fromEntries(R44_METRICS.map((key) => [key, createWindow(this.#capacity)])) as Record<keyof R44PerformanceBudgets, R44MetricWindow>;
  }

  get state(): R44PressureLevel { return this.#state; }
  get sampleCount(): number { return this.#sampleCount; }
  get budgets(): R44PerformanceBudgets { return this.#budgets; }

  sample(input: R44PerformanceSample): R44PerformanceReport {
    validateSample(input);
    if (input.tick < this.#tick) throw new R44BoundaryError("tick-regression", "Performance sample tick must be monotonic");
    this.#tick = input.tick;
    this.#sampleCount += 1;
    this.#droppedFrames += input.droppedFrames ?? 0;
    this.#longTasks += input.longTaskCount ?? 0;
    for (const key of R44_METRICS) pushWindow(this.#windows[key], input[key], this.#alpha);

    const summaries = this.#summaries();
    const exceeded = R44_METRICS.filter((key) => {
      const summary = summaries[key];
      const estimate = summary.count < this.#minimumSamplesForPercentile ? summary.ewma : summary.p95;
      const ratio = r44SafeRatio(estimate, this.#budgets[key], 0);
      return ratio > 1;
    });
    this.#lastExceeded = Object.freeze(exceeded);
    if (exceeded.length > 0 || (input.droppedFrames ?? 0) > 0 || (input.longTaskCount ?? 0) > 0) {
      this.#consecutiveViolations += 1;
      this.#consecutiveRecoveries = 0;
    } else {
      this.#consecutiveRecoveries += 1;
      this.#consecutiveViolations = 0;
    }
    this.#advanceState();
    return this.report();
  }

  report(): R44PerformanceReport {
    const metrics = this.#summaries();
    const exceeded = this.#lastExceeded;
    const totalPressure = R44_METRICS.reduce((sum, key) => {
      const observed = metrics[key].count < this.#minimumSamplesForPercentile ? metrics[key].ewma : metrics[key].p95;
      return sum + Math.max(0, r44SafeRatio(observed, this.#budgets[key], 0) - 1);
    }, 0);
    const score = Math.round(r44Clamp(100 - totalPressure * 18 - this.#droppedFrames * 0.2 - this.#longTasks * 0.05, 0, 100));
    const recommendations = this.#recommendations(exceeded);
    return Object.freeze({
      tick: this.#tick,
      state: this.#state,
      health: this.#health(score, this.#state),
      score,
      sampleCount: this.#sampleCount,
      consecutiveViolations: this.#consecutiveViolations,
      consecutiveRecoveries: this.#consecutiveRecoveries,
      metrics,
      exceededBudgets: exceeded,
      recommendations,
    });
  }

  reset(): void {
    for (const key of R44_METRICS) {
      const window = this.#windows[key];
      window.values.fill(0);
      window.index = 0;
      window.count = 0;
      window.sum = 0;
      window.ewma = 0;
      window.initialized = false;
      window.latest = 0;
    }
    this.#state = "nominal";
    this.#tick = 0;
    this.#sampleCount = 0;
    this.#consecutiveViolations = 0;
    this.#consecutiveRecoveries = 0;
    this.#lastExceeded = Object.freeze([]);
    this.#droppedFrames = 0;
    this.#longTasks = 0;
  }

  snapshot(): Readonly<Record<string, R44JsonValue>> {
    const report = this.report();
    const metrics: Record<string, R44JsonValue> = Object.create(null) as Record<string, R44JsonValue>;
    for (const key of R44_METRICS) metrics[key] = { ...report.metrics[key] } as unknown as R44JsonValue;
    return Object.freeze({
      tick: report.tick,
      state: report.state,
      health: report.health,
      score: report.score,
      sampleCount: report.sampleCount,
      consecutiveViolations: report.consecutiveViolations,
      consecutiveRecoveries: report.consecutiveRecoveries,
      exceededBudgets: [...report.exceededBudgets],
      recommendations: [...report.recommendations],
      metrics,
    });
  }

  assertHealthy(): void {
    const report = this.report();
    if (report.state === "emergency") {
      throw new R44InvariantError("performance-emergency", "Runtime performance entered emergency pressure", {
        tick: report.tick,
        score: report.score,
      });
    }
  }

  #advanceState(): void {
    if (this.#consecutiveViolations >= this.#promoteAfter) {
      this.#state = this.#state === "nominal" ? "elevated"
        : this.#state === "elevated" ? "constrained"
          : "emergency";
      this.#consecutiveViolations = 0;
      return;
    }
    if (this.#consecutiveRecoveries < this.#recoverAfter) return;
    this.#state = this.#state === "emergency" ? "constrained"
      : this.#state === "constrained" ? "elevated"
        : "nominal";
    this.#consecutiveRecoveries = 0;
  }

  #health(score: number, state: R44PressureLevel): R44HealthGrade {
    if (state === "emergency" || score < 35) return "critical";
    if (state === "constrained" || score < 55) return "degraded";
    if (state === "elevated" || score < 72) return "watch";
    if (score < 90) return "healthy";
    return "excellent";
  }

  #summaries(): Readonly<Record<keyof R44PerformanceBudgets, R44PerformanceMetricSummary>> {
    return Object.freeze(Object.fromEntries(R44_METRICS.map((key) => [key, summarize(this.#windows[key])])) as Record<keyof R44PerformanceBudgets, R44PerformanceMetricSummary>);
  }

  #recommendations(exceeded: readonly (keyof R44PerformanceBudgets)[]): readonly string[] {
    const messages: string[] = [];
    if (exceeded.includes("frameMs")) messages.push("Reduce non-critical frame work and lower render resolution.");
    if (exceeded.includes("simulationMs")) messages.push("Throttle distant simulation and use fixed-step catch-up caps.");
    if (exceeded.includes("renderMs")) messages.push("Reduce shadow, post-processing, and overdraw cost.");
    if (exceeded.includes("memoryMb")) messages.push("Evict cold assets and inspect resource leases.");
    if (exceeded.includes("networkRttMs")) messages.push("Prefer delta snapshots and widen interpolation buffers.");
    if (exceeded.includes("activeEntities")) messages.push("Increase distance-based LOD and interest filtering.");
    if (exceeded.includes("queuedTasks")) messages.push("Coalesce duplicate work and defer background tasks.");
    if (this.#droppedFrames > 0) messages.push("Dropped frames observed; inspect main-thread stalls.");
    if (this.#longTasks > 0) messages.push("Long tasks observed; split costly operations into bounded slices.");
    if (messages.length === 0 && this.#state !== "nominal") messages.push("Hold recovery until the stable window is complete.");
    return Object.freeze(messages);
  }
}
