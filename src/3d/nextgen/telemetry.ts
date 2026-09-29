import { clamp, stableHash } from './kernelTypes.ts';

export type MetricKind = 'counter' | 'gauge' | 'histogram';
export interface MetricSample {
  readonly name: string;
  readonly kind: MetricKind;
  readonly value: number;
  readonly tick: number;
  readonly tags?: Readonly<Record<string, string>>;
}

export interface HistogramSummary {
  readonly count: number;
  readonly sum: number;
  readonly min: number;
  readonly max: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
}

export interface TelemetryPolicy {
  readonly maxSamples: number;
  readonly maxSpans: number;
  readonly maxLogs: number;
}

export const DEFAULT_TELEMETRY_POLICY: TelemetryPolicy = Object.freeze({
  maxSamples: 8192,
  maxSpans: 2048,
  maxLogs: 1024,
});

export interface TraceSpan {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly startTick: number;
  readonly endTick: number | null;
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
}

export interface TelemetrySnapshot {
  readonly counters: Readonly<Record<string, number>>;
  readonly gauges: Readonly<Record<string, number>>;
  readonly histograms: Readonly<Record<string, HistogramSummary>>;
  readonly spanCount: number;
  readonly logCount: number;
  readonly digest: string;
}

const percentile = (values: readonly number[], ratio: number): number => {
  if (!values.length) return 0;
  const index = clamp(Math.ceil(values.length * ratio) - 1, 0, values.length - 1);
  return values[index]!;
};

export class TelemetryRuntime {
  readonly policy: TelemetryPolicy;
  #counters = new Map<string, number>();
  #gauges = new Map<string, number>();
  #histograms = new Map<string, number[]>();
  #samples: MetricSample[] = [];
  #spans = new Map<string, TraceSpan>();
  #logs: string[] = [];
  #disposed = false;

  constructor(policy: TelemetryPolicy = DEFAULT_TELEMETRY_POLICY) {
    this.policy = Object.freeze({ ...policy });
  }

  increment(name: string, value = 1, tick = 0, tags?: Readonly<Record<string, string>>): void {
    if (this.#disposed) return;
    const key = name.trim();
    if (!key) return;
    this.#counters.set(key, (this.#counters.get(key) ?? 0) + value);
    this.#pushSample({ name: key, kind: 'counter', value, tick, ...(tags ? { tags } : {}) });
  }

  gauge(name: string, value: number, tick = 0, tags?: Readonly<Record<string, string>>): void {
    if (this.#disposed) return;
    const key = name.trim();
    if (!key) return;
    this.#gauges.set(key, Number.isFinite(value) ? value : 0);
    this.#pushSample({ name: key, kind: 'gauge', value: Number.isFinite(value) ? value : 0, tick, ...(tags ? { tags } : {}) });
  }

  observe(name: string, value: number, tick = 0, tags?: Readonly<Record<string, string>>): void {
    if (this.#disposed) return;
    const key = name.trim();
    if (!key) return;
    const safe = Number.isFinite(value) ? value : 0;
    const values = this.#histograms.get(key) ?? [];
    values.push(safe);
    if (values.length > 4096) values.splice(0, values.length - 4096);
    this.#histograms.set(key, values);
    this.#pushSample({ name: key, kind: 'histogram', value: safe, tick, ...(tags ? { tags } : {}) });
  }

  #pushSample(sample: MetricSample): void {
    this.#samples.push(Object.freeze(sample));
    if (this.#samples.length > this.policy.maxSamples) this.#samples.splice(0, this.#samples.length - this.policy.maxSamples);
  }

  startSpan(name: string, startTick: number, attributes: Readonly<Record<string, string | number | boolean>> = {}): string {
    if (this.#disposed) return '';
    const id = stableHash({ name, startTick, size: this.#spans.size });
    this.#spans.set(id, Object.freeze({
      id,
      parentId: null,
      name: name.slice(0, 128),
      startTick,
      endTick: null,
      attributes,
    }));
    while (this.#spans.size > this.policy.maxSpans) {
      const oldest = this.#spans.keys().next().value as string | undefined;
      if (!oldest) break;
      this.#spans.delete(oldest);
    }
    return id;
  }

  endSpan(id: string, endTick: number): boolean {
    const span = this.#spans.get(id);
    if (!span) return false;
    this.#spans.set(id, Object.freeze({ ...span, endTick: Math.max(span.startTick, endTick) }));
    return true;
  }

  log(message: string): void {
    if (this.#disposed) return;
    this.#logs.push(message.slice(0, 512));
    if (this.#logs.length > this.policy.maxLogs) this.#logs.splice(0, this.#logs.length - this.policy.maxLogs);
  }

  histogram(name: string): HistogramSummary {
    const values = [...(this.#histograms.get(name) ?? [])].sort((a, b) => a - b);
    const count = values.length;
    const sum = values.reduce((a, b) => a + b, 0);
    return Object.freeze({
      count,
      sum,
      min: values[0] ?? 0,
      max: values.at(-1) ?? 0,
      p50: percentile(values, 0.5),
      p95: percentile(values, 0.95),
      p99: percentile(values, 0.99),
    });
  }

  snapshot(): TelemetrySnapshot {
    const histograms: Record<string, HistogramSummary> = {};
    for (const name of this.#histograms.keys()) histograms[name] = this.histogram(name);
    const counters = Object.fromEntries([...this.#counters.entries()].sort(([a], [b]) => a.localeCompare(b)));
    const gauges = Object.fromEntries([...this.#gauges.entries()].sort(([a], [b]) => a.localeCompare(b)));
    const digest = stableHash({
      counters,
      gauges,
      histograms,
      samples: this.#samples.slice(-64),
      spans: [...this.#spans.values()].slice(-64),
      logCount: this.#logs.length,
    });
    return Object.freeze({
      counters,
      gauges,
      histograms,
      spanCount: this.#spans.size,
      logCount: this.#logs.length,
      digest,
    });
  }

  samples(): readonly MetricSample[] { return Object.freeze([...this.#samples]); }
  logs(): readonly string[] { return Object.freeze([...this.#logs]); }

  reset(): void {
    this.#counters.clear();
    this.#gauges.clear();
    this.#histograms.clear();
    this.#samples = [];
    this.#spans.clear();
    this.#logs = [];
  }

  dispose(): void { this.#disposed = true; this.reset(); }
}
