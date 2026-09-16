export type MetricKind = 'counter' | 'gauge' | 'histogram' | 'event';

export interface MetricPoint {
  readonly name: string;
  readonly kind: MetricKind;
  readonly value: number;
  readonly tick: number;
  readonly tags: Readonly<Record<string, string>>;
}

export interface HistogramSummary {
  readonly count: number;
  readonly sum: number;
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
}

export interface RuntimeAlert {
  readonly id: string;
  readonly severity: 'info' | 'warning' | 'error';
  readonly message: string;
  readonly tick: number;
  readonly metric?: string;
}

export interface ObservabilitySnapshot {
  readonly tick: number;
  readonly counters: Readonly<Record<string, number>>;
  readonly gauges: Readonly<Record<string, number>>;
  readonly histograms: Readonly<Record<string, HistogramSummary>>;
  readonly alerts: readonly RuntimeAlert[];
}

function validateMetricName(name: string): void {
  if (!name.trim() || name.length > 128) throw new Error('invalid metric name');
  if (!/^[A-Za-z0-9_.:-]+$/.test(name)) throw new Error(`invalid metric name: ${name}`);
}

function normalizeTags(tags: Readonly<Record<string, string>> = {}): Readonly<Record<string, string>> {
  const output: Record<string, string> = {};
  const keys = Object.keys(tags).sort();
  if (keys.length > 8) throw new Error('metric tag limit exceeded');
  for (const key of keys) {
    if (!/^[A-Za-z0-9_.:-]{1,32}$/.test(key)) throw new Error(`invalid metric tag key: ${key}`);
    const value = tags[key] ?? '';
    if (value.length > 64) throw new Error(`metric tag value too long: ${key}`);
    output[key] = value;
  }
  return Object.freeze(output);
}

function seriesKey(name: string, tags: Readonly<Record<string, string>>): string {
  return `${name}|${Object.entries(tags).map(([key, value]) => `${key}=${value}`).join(',')}`;
}

class Histogram {
  readonly #values: number[] = [];
  readonly #maxSamples: number;

  public constructor(maxSamples: number) {
    this.#maxSamples = maxSamples;
  }

  public observe(value: number): void {
    if (!Number.isFinite(value)) return;
    this.#values.push(value);
    if (this.#values.length > this.#maxSamples) this.#values.shift();
  }

  public summary(): HistogramSummary {
    const values = [...this.#values].sort((a, b) => a - b);
    if (values.length === 0) {
      return { count: 0, sum: 0, min: 0, max: 0, mean: 0, p50: 0, p95: 0, p99: 0 };
    }
    const sum = values.reduce((acc, value) => acc + value, 0);
    return {
      count: values.length,
      sum,
      min: values[0]!,
      max: values.at(-1)!,
      mean: sum / values.length,
      p50: quantile(values, 0.5),
      p95: quantile(values, 0.95),
      p99: quantile(values, 0.99),
    };
  }
}

function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(q * values.length) - 1));
  return values[index]!;
}

export class ObservabilityHub {
  readonly #maxHistogramSamples: number;
  readonly #maxAlerts: number;
  readonly #counters = new Map<string, number>();
  readonly #gauges = new Map<string, number>();
  readonly #histograms = new Map<string, Histogram>();
  readonly #points: MetricPoint[] = [];
  readonly #alerts: RuntimeAlert[] = [];
  #tick = 0;

  public constructor(maxHistogramSamples = 512, maxAlerts = 128) {
    if (!Number.isInteger(maxHistogramSamples) || maxHistogramSamples < 32) throw new RangeError('maxHistogramSamples too small');
    if (!Number.isInteger(maxAlerts) || maxAlerts < 1) throw new RangeError('maxAlerts must be positive');
    this.#maxHistogramSamples = maxHistogramSamples;
    this.#maxAlerts = maxAlerts;
  }

  public setTick(tick: number): void {
    if (!Number.isInteger(tick) || tick < this.#tick) throw new RangeError('ticks must be monotonic');
    this.#tick = tick;
  }

  public increment(name: string, value = 1, tags: Readonly<Record<string, string>> = {}): void {
    validateMetricName(name);
    if (!Number.isFinite(value)) throw new RangeError('counter value must be finite');
    const normalized = normalizeTags(tags);
    const key = seriesKey(name, normalized);
    this.#counters.set(key, (this.#counters.get(key) ?? 0) + value);
    this.#recordPoint({ name, kind: 'counter', value, tick: this.#tick, tags: normalized });
  }

  public gauge(name: string, value: number, tags: Readonly<Record<string, string>> = {}): void {
    validateMetricName(name);
    if (!Number.isFinite(value)) throw new RangeError('gauge value must be finite');
    const normalized = normalizeTags(tags);
    this.#gauges.set(seriesKey(name, normalized), value);
    this.#recordPoint({ name, kind: 'gauge', value, tick: this.#tick, tags: normalized });
  }

  public observe(name: string, value: number, tags: Readonly<Record<string, string>> = {}): void {
    validateMetricName(name);
    if (!Number.isFinite(value)) throw new RangeError('histogram value must be finite');
    const normalized = normalizeTags(tags);
    const key = seriesKey(name, normalized);
    const histogram = this.#histograms.get(key) ?? new Histogram(this.#maxHistogramSamples);
    histogram.observe(value);
    this.#histograms.set(key, histogram);
    this.#recordPoint({ name, kind: 'histogram', value, tick: this.#tick, tags: normalized });
  }

  public event(name: string, value = 1, tags: Readonly<Record<string, string>> = {}): void {
    validateMetricName(name);
    const normalized = normalizeTags(tags);
    this.#recordPoint({ name, kind: 'event', value, tick: this.#tick, tags: normalized });
  }

  public alert(severity: RuntimeAlert['severity'], message: string, metric?: string): RuntimeAlert {
    if (!message.trim()) throw new Error('alert message must not be empty');
    const id = `${this.#tick}:${this.#alerts.length + 1}`;
    const alert: RuntimeAlert = Object.freeze({ id, severity, message, tick: this.#tick, ...(metric ? { metric } : {}) });
    this.#alerts.push(alert);
    while (this.#alerts.length > this.#maxAlerts) this.#alerts.shift();
    return alert;
  }

  public autoAlert(metric: string, value: number, threshold: number, severity: RuntimeAlert['severity'], message: string): void {
    validateMetricName(metric);
    if (!Number.isFinite(value) || !Number.isFinite(threshold)) throw new RangeError('threshold values must be finite');
    if (value > threshold) this.alert(severity, message, metric);
  }

  public snapshot(): ObservabilitySnapshot {
    const counters: Record<string, number> = {};
    for (const [key, value] of this.#counters) counters[key] = value;
    const gauges: Record<string, number> = {};
    for (const [key, value] of this.#gauges) gauges[key] = value;
    const histograms: Record<string, HistogramSummary> = {};
    for (const [key, histogram] of this.#histograms) histograms[key] = histogram.summary();
    return Object.freeze({
      tick: this.#tick,
      counters: Object.freeze(counters),
      gauges: Object.freeze(gauges),
      histograms: Object.freeze(histograms),
      alerts: [...this.#alerts],
    });
  }

  public recentPoints(limit = 128): readonly MetricPoint[] {
    return this.#points.slice(-Math.max(0, limit)).map((point) => ({ ...point, tags: { ...point.tags } }));
  }

  public clear(): void {
    this.#counters.clear();
    this.#gauges.clear();
    this.#histograms.clear();
    this.#points.length = 0;
    this.#alerts.length = 0;
  }

  #recordPoint(point: MetricPoint): void {
    this.#points.push(Object.freeze({ ...point }));
    if (this.#points.length > 4096) this.#points.shift();
  }
}

export interface PerformanceBudget {
  readonly metric: string;
  readonly warning: number;
  readonly error: number;
  readonly unit: 'ms' | 'count' | 'bytes' | 'ratio';
}

export interface BudgetCheckResult {
  readonly metric: string;
  readonly value: number;
  readonly level: 'ok' | 'warning' | 'error';
  readonly message: string;
}

export class BudgetMonitor {
  readonly #budgets = new Map<string, PerformanceBudget>();
  readonly #observability: ObservabilityHub;

  public constructor(observability: ObservabilityHub) {
    this.#observability = observability;
  }

  public register(budget: PerformanceBudget): void {
    validateMetricName(budget.metric);
    if (!Number.isFinite(budget.warning) || !Number.isFinite(budget.error) || budget.warning < 0 || budget.error < budget.warning) {
      throw new RangeError('invalid budget thresholds');
    }
    this.#budgets.set(budget.metric, Object.freeze({ ...budget }));
  }

  public check(metric: string, value: number): BudgetCheckResult {
    const budget = this.#budgets.get(metric);
    if (!budget) return { metric, value, level: 'ok', message: 'no budget registered' };
    if (value >= budget.error) {
      const result = { metric, value, level: 'error' as const, message: `${metric} exceeded error budget` };
      this.#observability.alert('error', result.message, metric);
      return result;
    }
    if (value >= budget.warning) {
      const result = { metric, value, level: 'warning' as const, message: `${metric} exceeded warning budget` };
      this.#observability.alert('warning', result.message, metric);
      return result;
    }
    return { metric, value, level: 'ok', message: 'within budget' };
  }

  public checkFrame(frameMs: number): BudgetCheckResult {
    return this.check('frame.ms', frameMs);
  }

  public checkNetworkRtt(rttMs: number): BudgetCheckResult {
    return this.check('network.rtt.ms', rttMs);
  }

  public checkHeapBytes(bytes: number): BudgetCheckResult {
    return this.check('heap.bytes', bytes);
  }
}

export interface TraceSpan {
  readonly id: number;
  readonly name: string;
  readonly startTick: number;
  readonly endTick: number;
  readonly durationMs: number;
  readonly tags: Readonly<Record<string, string>>;
}

export class TraceRecorder {
  readonly #maxSpans: number;
  readonly #spans: TraceSpan[] = [];
  #nextId = 1;

  public constructor(maxSpans = 512) {
    if (!Number.isInteger(maxSpans) || maxSpans < 1) throw new RangeError('maxSpans must be positive');
    this.#maxSpans = maxSpans;
  }

  public record(name: string, startTick: number, endTick: number, durationMs: number, tags: Readonly<Record<string, string>> = {}): TraceSpan {
    if (!name.trim()) throw new Error('span name must not be empty');
    if (!Number.isInteger(startTick) || !Number.isInteger(endTick) || endTick < startTick) throw new RangeError('invalid span ticks');
    if (!Number.isFinite(durationMs) || durationMs < 0) throw new RangeError('invalid span duration');
    const span = Object.freeze({ id: this.#nextId++, name, startTick, endTick, durationMs, tags: normalizeTags(tags) });
    this.#spans.push(span);
    while (this.#spans.length > this.#maxSpans) this.#spans.shift();
    return span;
  }

  public list(): readonly TraceSpan[] {
    return this.#spans;
  }

  public longest(limit = 10): readonly TraceSpan[] {
    return [...this.#spans].sort((a, b) => b.durationMs - a.durationMs || a.id - b.id).slice(0, limit);
  }
}
