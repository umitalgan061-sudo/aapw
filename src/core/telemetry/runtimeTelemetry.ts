import { deterministicDigest } from '../runtime/deterministicClock.ts';
import { clamp, freeze } from '../domain/contracts.ts';

export type MetricKind = 'counter' | 'gauge' | 'histogram';
export type TelemetryLevel = 'off' | 'errors' | 'normal' | 'verbose';

export interface MetricPoint {
  readonly name: string;
  readonly kind: MetricKind;
  readonly value: number;
  readonly timestamp: number;
  readonly tags: Readonly<Record<string, string>>;
}

export interface HistogramSummary {
  readonly count: number;
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
}

export interface TelemetrySnapshot {
  readonly sequence: number;
  readonly level: TelemetryLevel;
  readonly points: readonly MetricPoint[];
  readonly counters: Readonly<Record<string, number>>;
  readonly gauges: Readonly<Record<string, number>>;
  readonly histograms: Readonly<Record<string, HistogramSummary>>;
  readonly digest: string;
  readonly dropped: number;
}

const cleanName = (value: string): string => value.trim().replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 96) || 'unknown';
const cleanTags = (tags: Readonly<Record<string, string>> | undefined): Readonly<Record<string, string>> => {
  const result: Record<string, string> = {};
  for (const key of Object.keys(tags ?? {}).sort().slice(0, 12)) result[cleanName(key)] = String(tags?.[key] ?? '').slice(0, 96);
  return freeze(result);
};

export class RuntimeTelemetry {
  readonly #capacity: number;
  readonly #now: () => number;
  #level: TelemetryLevel;
  #sequence = 0;
  #dropped = 0;
  readonly #points: MetricPoint[] = [];
  readonly #counters = new Map<string, number>();
  readonly #gauges = new Map<string, number>();
  readonly #histograms = new Map<string, number[]>();

  constructor(options: { readonly capacity?: number; readonly level?: TelemetryLevel; readonly now?: () => number } = {}) {
    this.#capacity = Math.max(64, Math.floor(options.capacity ?? 4096));
    this.#level = options.level ?? 'normal';
    this.#now = options.now ?? (() => performance.now());
  }

  setLevel(level: TelemetryLevel): void { this.#level = level; }
  level(): TelemetryLevel { return this.#level; }

  count(name: string, increment = 1, tags?: Readonly<Record<string, string>>): void {
    if (this.#level === 'off') return;
    const key = cleanName(name);
    const next = (this.#counters.get(key) ?? 0) + (Number.isFinite(increment) ? increment : 0);
    this.#counters.set(key, Math.max(-1e12, Math.min(1e12, next)));
    this.#record({ name: key, kind: 'counter', value: increment, timestamp: this.#now(), tags: cleanTags(tags) });
  }

  gauge(name: string, value: number, tags?: Readonly<Record<string, string>>): void {
    if (this.#level === 'off') return;
    const key = cleanName(name);
    const next = Number.isFinite(value) ? value : 0;
    this.#gauges.set(key, clamp(next, -1e12, 1e12));
    this.#record({ name: key, kind: 'gauge', value: next, timestamp: this.#now(), tags: cleanTags(tags) });
  }

  sample(name: string, value: number, tags?: Readonly<Record<string, string>>): void {
    if (this.#level === 'off') return;
    const key = cleanName(name);
    if (!this.#histograms.has(key)) this.#histograms.set(key, []);
    const values = this.#histograms.get(key);
    if (!values) return;
    values.push(Number.isFinite(value) ? value : 0);
    if (values.length > 512) values.splice(0, values.length - 512);
    this.#record({ name: key, kind: 'histogram', value, timestamp: this.#now(), tags: cleanTags(tags) });
  }

  mark(name: string): void { this.count(`mark.${name}`, 1); }

  snapshot(): TelemetrySnapshot {
    const counters = Object.fromEntries([...this.#counters.entries()].sort(([a], [b]) => a.localeCompare(b)));
    const gauges = Object.fromEntries([...this.#gauges.entries()].sort(([a], [b]) => a.localeCompare(b)));
    const histograms = Object.fromEntries([...this.#histograms.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, values]) => [name, summarize(values)]));
    const points = this.#points.slice(-this.#capacity);
    const digest = deterministicDigest({ counters, gauges, histograms, points: points.map((point) => ({ name: point.name, kind: point.kind, value: point.value })) });
    return freeze({ sequence: this.#sequence, level: this.#level, points, counters, gauges, histograms, digest, dropped: this.#dropped });
  }

  reset(): void {
    this.#sequence = 0;
    this.#dropped = 0;
    this.#points.length = 0;
    this.#counters.clear();
    this.#gauges.clear();
    this.#histograms.clear();
  }

  #record(point: MetricPoint): void {
    this.#sequence += 1;
    if (this.#level === 'errors' && !point.name.includes('error')) return;
    this.#points.push(freeze({ ...point, sequence: this.#sequence }) as MetricPoint);
    if (this.#points.length > this.#capacity) { this.#points.shift(); this.#dropped += 1; }
  }
}

const percentile = (values: readonly number[], p: number): number => {
  if (!values.length) return 0;
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * p) - 1));
  return values[index] ?? 0;
};

const summarize = (input: readonly number[]): HistogramSummary => {
  const values = [...input].filter(Number.isFinite).sort((a, b) => a - b);
  if (!values.length) return freeze({ count: 0, min: 0, max: 0, mean: 0, p50: 0, p95: 0, p99: 0 });
  const sum = values.reduce((total, value) => total + value, 0);
  return freeze({
    count: values.length,
    min: values[0] ?? 0,
    max: values[values.length - 1] ?? 0,
    mean: Number((sum / values.length).toFixed(4)),
    p50: Number(percentile(values, 0.5).toFixed(4)),
    p95: Number(percentile(values, 0.95).toFixed(4)),
    p99: Number(percentile(values, 0.99).toFixed(4)),
  });
};

export interface PerformanceMarkResult {
  readonly name: string;
  readonly durationMs: number;
}

export class PerfTimer {
  readonly #telemetry: RuntimeTelemetry;
  readonly #started = new Map<string, number>();
  constructor(telemetry: RuntimeTelemetry) { this.#telemetry = telemetry; }
  start(name: string): void { this.#started.set(name, performance.now()); }
  end(name: string): PerformanceMarkResult {
    const started = this.#started.get(name) ?? performance.now();
    const durationMs = Math.max(0, performance.now() - started);
    this.#started.delete(name);
    this.#telemetry.sample(`perf.${name}`, durationMs);
    return freeze({ name, durationMs: Number(durationMs.toFixed(4)) });
  }
}
