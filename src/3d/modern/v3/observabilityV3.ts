import {
  clampNumber,
  type BudgetSnapshot,
  type MetricSample,
  type RuntimeDiagnosticReport,
  type RuntimeHealth,
  type RuntimeClockState,
  type SystemMetrics,
  type Tick,
  type TraceSpan,
} from './coreContracts';

export interface HistogramSnapshot {
  readonly count: number;
  readonly sum: number;
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  readonly p50: number;
  readonly p90: number;
  readonly p95: number;
  readonly p99: number;
}

export class RollingHistogram {
  #capacity: number;
  #values: number[] = [];

  constructor(capacity = 240) {
    if (capacity < 8) throw new Error('histogram capacity must be >= 8');
    this.#capacity = capacity;
  }

  push(value: number): void {
    if (!Number.isFinite(value)) return;
    this.#values.push(value);
    if (this.#values.length > this.#capacity) this.#values.splice(0, this.#values.length - this.#capacity);
  }

  snapshot(): HistogramSnapshot {
    if (this.#values.length === 0) return { count: 0, sum: 0, min: 0, max: 0, mean: 0, p50: 0, p90: 0, p95: 0, p99: 0 };
    const values = [...this.#values].sort((a, b) => a - b);
    const percentile = (ratio: number): number => {
      const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * ratio) - 1));
      return values[index]!;
    };
    const sum = this.#values.reduce((total, value) => total + value, 0);
    return {
      count: values.length,
      sum,
      min: values[0]!,
      max: values.at(-1)!,
      mean: sum / values.length,
      p50: percentile(0.5),
      p90: percentile(0.9),
      p95: percentile(0.95),
      p99: percentile(0.99),
    };
  }

  clear(): void {
    this.#values = [];
  }
}

export interface MetricAccumulator {
  readonly name: string;
  readonly unit: MetricSample['unit'];
  readonly value: number;
  readonly count: number;
  readonly last: number;
}

export class MetricRegistryV3 {
  #metrics = new Map<string, { unit: MetricSample['unit']; sum: number; count: number; last: number; tags: Readonly<Record<string, string>> }>();
  #clock: () => { tick: Tick; timestampMs: number };

  constructor(clock: () => { tick: Tick; timestampMs: number }) {
    this.#clock = clock;
  }

  observe(name: string, value: number, unit: MetricSample['unit'], tags: Readonly<Record<string, string>> = {}): void {
    if (!Number.isFinite(value)) return;
    const prior = this.#metrics.get(name);
    if (prior) {
      prior.sum += value;
      prior.count += 1;
      prior.last = value;
      return;
    }
    this.#metrics.set(name, { unit, sum: value, count: 1, last: value, tags });
  }

  set(name: string, value: number, unit: MetricSample['unit'], tags: Readonly<Record<string, string>> = {}): void {
    if (!Number.isFinite(value)) return;
    this.#metrics.set(name, { unit, sum: value, count: 1, last: value, tags });
  }

  get(name: string): MetricAccumulator | undefined {
    const metric = this.#metrics.get(name);
    if (!metric) return undefined;
    return { name, unit: metric.unit, value: metric.sum / Math.max(1, metric.count), count: metric.count, last: metric.last };
  }

  samples(): readonly MetricSample[] {
    const clock = this.#clock();
    return [...this.#metrics.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, metric]) => ({
      timestampMs: clock.timestampMs,
      tick: clock.tick,
      name,
      value: metric.sum / Math.max(1, metric.count),
      unit: metric.unit,
      tags: metric.tags,
    }));
  }

  clear(): void {
    this.#metrics.clear();
  }
}

export class FrameProfilerV3 {
  readonly frame = new RollingHistogram(300);
  readonly simulation = new RollingHistogram(300);
  readonly render = new RollingHistogram(300);
  readonly network = new RollingHistogram(300);
  readonly streaming = new RollingHistogram(300);
  readonly persistence = new RollingHistogram(300);
  #lastStart = 0;

  beginFrame(): void {
    this.#lastStart = performance.now();
  }

  endFrame(): number {
    const elapsed = performance.now() - this.#lastStart;
    this.frame.push(elapsed);
    return elapsed;
  }

  measure<T>(target: RollingHistogram, operation: () => T): T {
    const start = performance.now();
    try {
      return operation();
    } finally {
      target.push(performance.now() - start);
    }
  }

  snapshot(): Readonly<Record<string, HistogramSnapshot>> {
    return {
      frame: this.frame.snapshot(),
      simulation: this.simulation.snapshot(),
      render: this.render.snapshot(),
      network: this.network.snapshot(),
      streaming: this.streaming.snapshot(),
      persistence: this.persistence.snapshot(),
    };
  }
}

export class TraceRecorderV3 {
  #capacity: number;
  #spans: TraceSpan[] = [];
  #stack: string[] = [];
  #sequence = 0;

  constructor(capacity = 1000) {
    this.#capacity = capacity;
  }

  start(name: string, phase: TraceSpan['phase'], attributes: Readonly<Record<string, string | number | boolean>> = {}): string {
    const id = `span-${(++this.#sequence).toString(36)}`;
    const start = performance.now();
    const parentId = this.#stack.at(-1);
    this.#spans.push({ id, ...(parentId ? { parentId } : {}), name, startMs: start, endMs: start, phase, attributes });
    this.#stack.push(id);
    return id;
  }

  end(id: string): void {
    const index = this.#spans.findIndex((span) => span.id === id);
    if (index < 0) return;
    const span = this.#spans[index]!;
    this.#spans[index] = { ...span, endMs: performance.now() };
    const stackIndex = this.#stack.lastIndexOf(id);
    if (stackIndex >= 0) this.#stack.splice(stackIndex, 1);
    if (this.#spans.length > this.#capacity) this.#spans.splice(0, this.#spans.length - this.#capacity);
  }

  scope<T>(name: string, phase: TraceSpan['phase'], operation: () => T, attributes: Readonly<Record<string, string | number | boolean>> = {}): T {
    const id = this.start(name, phase, attributes);
    try {
      return operation();
    } finally {
      this.end(id);
    }
  }

  spans(): readonly TraceSpan[] {
    return this.#spans.map((span) => ({ ...span, ...(span.parentId ? { parentId: span.parentId } : {}) }));
  }

  clear(): void {
    this.#spans = [];
    this.#stack = [];
  }
}

export interface BudgetControllerConfig {
  readonly targetFrameMs: number;
  readonly simulationBudgetMs: number;
  readonly renderBudgetMs: number;
  readonly streamingBudgetMs: number;
  readonly networkBudgetMs: number;
  readonly persistenceBudgetMs: number;
}

export class BudgetControllerV3 {
  readonly config: BudgetControllerConfig;
  #misses = 0;
  #consecutiveMisses = 0;

  constructor(config: BudgetControllerConfig) {
    this.config = { ...config };
  }

  record(snapshot: Omit<BudgetSnapshot, 'budgetMisses'>): BudgetSnapshot {
    const exceeded = snapshot.frameMs > this.config.targetFrameMs ||
      snapshot.simulationMs > this.config.simulationBudgetMs ||
      snapshot.renderMs > this.config.renderBudgetMs ||
      snapshot.streamingMs > this.config.streamingBudgetMs ||
      snapshot.networkMs > this.config.networkBudgetMs ||
      snapshot.persistenceMs > this.config.persistenceBudgetMs;
    if (exceeded) {
      this.#misses += 1;
      this.#consecutiveMisses += 1;
    } else {
      this.#consecutiveMisses = 0;
    }
    return { ...snapshot, budgetMisses: this.#misses };
  }

  shouldThrottle(): boolean {
    return this.#consecutiveMisses >= 3;
  }

  pressure(snapshot: BudgetSnapshot): number {
    const pressures = [
      snapshot.frameMs / this.config.targetFrameMs,
      snapshot.simulationMs / this.config.simulationBudgetMs,
      snapshot.renderMs / this.config.renderBudgetMs,
      snapshot.streamingMs / this.config.streamingBudgetMs,
      snapshot.networkMs / this.config.networkBudgetMs,
      snapshot.persistenceMs / this.config.persistenceBudgetMs,
    ];
    return clampNumber(Math.max(...pressures), 0, 2) / 2;
  }

  reset(): void {
    this.#misses = 0;
    this.#consecutiveMisses = 0;
  }
}

export class HealthEvaluatorV3 {
  evaluate(input: {
    readonly frame: HistogramSnapshot;
    readonly memoryPressure: number;
    readonly networkLoss: number;
    readonly streamingPressure: number;
  }): RuntimeHealth {
    const frameRatio = clampNumber(input.frame.p95 / 33.333, 0, 2);
    const memory = clampNumber(input.memoryPressure, 0, 1);
    const network = clampNumber(input.networkLoss, 0, 1);
    const streaming = clampNumber(input.streamingPressure, 0, 1);
    const penalty = clampNumber((frameRatio * 0.55) + (memory * 0.2) + (network * 0.15) + (streaming * 0.1), 0, 1);
    const score = Math.round((1 - penalty) * 100);
    const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 55 ? 'D' : 'E';
    const recommendations: string[] = [];
    if (input.frame.p95 > 33.333) recommendations.push('Reduce renderable count, post-processing or shadow work.');
    if (memory > 0.8) recommendations.push('Evict unused assets and lower texture residency targets.');
    if (network > 0.08) recommendations.push('Increase interpolation and reduce snapshot payload frequency.');
    if (streaming > 0.8) recommendations.push('Lower far-field streaming concurrency and defer background loads.');
    return {
      score,
      grade,
      frameTimeP95Ms: input.frame.p95,
      memoryPressure: memory,
      networkPressure: network,
      streamingPressure: streaming,
      recommendations,
    };
  }
}

export function buildDiagnosticReport(options: {
  readonly clock: RuntimeClockState;
  readonly health: RuntimeHealth;
  readonly budgets: BudgetSnapshot;
  readonly systems: readonly SystemMetrics[];
  readonly assets: RuntimeDiagnosticReport['assets'];
  readonly network: RuntimeDiagnosticReport['network'];
}): RuntimeDiagnosticReport {
  return {
    generatedAtMs: Date.now(),
    clock: structuredClone(options.clock),
    health: structuredClone(options.health),
    budgets: structuredClone(options.budgets),
    systems: options.systems.map((system) => structuredClone(system)),
    assets: structuredClone(options.assets),
    network: structuredClone(options.network),
  };
}
