import type {
  PriorityBand,
  R35HealthMetric,
  R35HealthReport,
  R35RuntimeEvent,
  RuntimeMode,
  RuntimePhase,
} from './contracts';

export interface MetricPoint {
  readonly tick: number;
  readonly value: number;
  readonly ok: boolean;
}

export interface CounterSnapshot {
  readonly key: string;
  readonly value: number;
}

export interface SpanResult {
  readonly id: string;
  readonly phase: RuntimePhase;
  readonly durationMs: number;
  readonly ok: boolean;
  readonly tick: number;
}

export interface TraceEvent {
  readonly tick: number;
  readonly phase: RuntimePhase;
  readonly label: string;
  readonly durationMs: number;
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
}

interface SpanStart {
  readonly id: string;
  readonly phase: RuntimePhase;
  readonly label: string;
  readonly startedAt: number;
  readonly tick: number;
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
}

export interface BudgetDiagnostic {
  readonly phase: RuntimePhase;
  readonly budgetMs: number;
  readonly p95Ms: number;
  readonly maxMs: number;
  readonly utilization: number;
  readonly severity: 'ok' | 'warning' | 'critical';
}

function percentile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1));
  return sorted[index] ?? 0;
}

class BoundedSeries {
  readonly capacity: number;
  #items: MetricPoint[] = [];

  constructor(capacity: number) {
    this.capacity = Math.max(1, Math.floor(capacity));
  }

  push(point: MetricPoint): void {
    this.#items.push(point);
    if (this.#items.length > this.capacity) this.#items.shift();
  }

  values(): readonly MetricPoint[] {
    return [...this.#items];
  }

  clear(): void {
    this.#items.length = 0;
  }
}

export class R35Observability {
  readonly historyCapacity: number;
  #metrics = new Map<RuntimePhase, BoundedSeries>();
  #counters = new Map<string, number>();
  #spans = new Map<string, SpanStart>();
  #spanSequence = 0;
  #trace: TraceEvent[] = [];
  #runtimeEvents: R35RuntimeEvent[] = [];
  #warnings: string[] = [];

  constructor(historyCapacity = 240) {
    this.historyCapacity = Math.max(16, historyCapacity);
  }

  sample(phase: RuntimePhase, tick: number, valueMs: number, budgetMs: number): void {
    const series = this.#metrics.get(phase) ?? new BoundedSeries(this.historyCapacity);
    series.push({ tick, value: Math.max(0, valueMs), ok: valueMs <= budgetMs });
    this.#metrics.set(phase, series);
    if (valueMs > budgetMs) this.warn(phase + ' budget exceeded at tick ' + tick);
  }

  increment(key: string, amount = 1): number {
    const current = this.#counters.get(key) ?? 0;
    const next = current + amount;
    this.#counters.set(key, next);
    return next;
  }

  getCounter(key: string): number {
    return this.#counters.get(key) ?? 0;
  }

  counters(): readonly CounterSnapshot[] {
    return [...this.#counters.entries()]
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  beginSpan(phase: RuntimePhase, label: string, tick: number, nowMs = performance.now(), metadata: Readonly<Record<string, string | number | boolean>> = {}): string {
    const id = 'span-' + (++this.#spanSequence);
    this.#spans.set(id, { id, phase, label, startedAt: nowMs, tick, metadata });
    return id;
  }

  endSpan(id: string, nowMs = performance.now(), ok = true): SpanResult | null {
    const span = this.#spans.get(id);
    if (!span) return null;
    this.#spans.delete(id);
    const durationMs = Math.max(0, nowMs - span.startedAt);
    this.#trace.push({
      tick: span.tick,
      phase: span.phase,
      label: span.label,
      durationMs,
      metadata: span.metadata,
    });
    if (this.#trace.length > this.historyCapacity * 4) this.#trace.splice(0, this.#trace.length - this.historyCapacity * 4);
    return Object.freeze({ id, phase: span.phase, durationMs, ok, tick: span.tick });
  }

  emit(event: R35RuntimeEvent): void {
    this.#runtimeEvents.push(structuredClone(event));
    if (this.#runtimeEvents.length > this.historyCapacity * 2) this.#runtimeEvents.splice(0, this.#runtimeEvents.length - this.historyCapacity * 2);
  }

  warn(message: string): void {
    if (!message) return;
    this.#warnings.push(message);
    if (this.#warnings.length > this.historyCapacity) this.#warnings.shift();
    this.increment('warnings');
  }

  budgetDiagnostics(budgets: ReadonlyMap<RuntimePhase, number>): readonly BudgetDiagnostic[] {
    const result: BudgetDiagnostic[] = [];
    for (const [phase, budgetMs] of budgets) {
      const values = this.#metrics.get(phase)?.values().map((point) => point.value) ?? [];
      const p95Ms = percentile(values, 0.95);
      const maxMs = values.length > 0 ? Math.max(...values) : 0;
      const utilization = budgetMs > 0 ? p95Ms / budgetMs : 0;
      const severity = utilization >= 1 ? 'critical' : utilization >= 0.82 ? 'warning' : 'ok';
      result.push({ phase, budgetMs, p95Ms, maxMs, utilization, severity });
    }
    return result.sort((a, b) => b.utilization - a.utilization);
  }

  health(mode: RuntimeMode, tick: number, budgets: ReadonlyMap<RuntimePhase, number>): R35HealthReport {
    const diagnostics = this.budgetDiagnostics(budgets);
    const metrics: R35HealthMetric[] = diagnostics.map((diagnostic) => {
      const series = this.#metrics.get(diagnostic.phase)?.values() ?? [];
      const errorCount = series.filter((point) => !point.ok).length;
      return {
        domain: diagnostic.phase,
        utilization: diagnostic.utilization,
        healthy: diagnostic.severity !== 'critical' && errorCount === 0,
        sampleCount: series.length,
        errorCount,
      };
    });
    let score = 100;
    for (const metric of metrics) {
      score -= Math.min(30, Math.max(0, metric.utilization - 0.7) * 40);
      score -= Math.min(15, metric.errorCount * 0.5);
    }
    score -= Math.min(20, this.getCounter('faults') * 4);
    score = Math.max(0, Math.min(100, score));
    const warnings = [...this.#warnings.slice(-12)];
    return Object.freeze({
      ok: score >= 75 && metrics.every((metric) => metric.healthy),
      score,
      mode,
      tick,
      metrics: Object.freeze(metrics),
      warnings: Object.freeze(warnings),
    });
  }

  trace(limit = this.historyCapacity): readonly TraceEvent[] {
    return this.#trace.slice(-Math.max(0, limit));
  }

  events(limit = this.historyCapacity): readonly R35RuntimeEvent[] {
    return this.#runtimeEvents.slice(-Math.max(0, limit)).map((event) => structuredClone(event));
  }

  clear(): void {
    this.#counters.clear();
    this.#trace.length = 0;
    this.#runtimeEvents.length = 0;
    this.#warnings.length = 0;
    for (const series of this.#metrics.values()) series.clear();
    this.#spans.clear();
  }
}

export function phaseBudgetMap(
  budgets: readonly { phase: RuntimePhase; budgetMs: number }[],
): ReadonlyMap<RuntimePhase, number> {
  return new Map(budgets.map((budget) => [budget.phase, budget.budgetMs]));
}

export function priorityToWeight(priority: PriorityBand): number {
  return {
    critical: 1,
    high: 0.8,
    normal: 0.5,
    low: 0.25,
    background: 0.05,
  }[priority];
}
