import type {
  HistogramSnapshot,
  MetricValue,
  ObservabilitySnapshot,
  TraceId,
  TraceSpan,
  RuntimeEvent,
} from './contracts.ts';
import { percentile, traceId } from './contracts.ts';

interface HistogramStore {
  readonly name: string;
  values: number[];
  readonly maxSamples: number;
}

export interface ObservabilityR25Options {
  readonly maxEvents?: number;
  readonly maxMetrics?: number;
  readonly maxSpans?: number;
  readonly maxHistogramSamples?: number;
  readonly clock?: () => number;
}

export class ObservabilityR25 {
  readonly #clock: () => number;
  readonly #maxEvents: number;
  readonly #maxMetrics: number;
  readonly #maxSpans: number;
  readonly #maxHistogramSamples: number;
  readonly #counters = new Map<string, number>();
  readonly #gauges = new Map<string, number>();
  readonly #metrics: MetricValue[] = [];
  readonly #events: RuntimeEvent[] = [];
  readonly #spans: TraceSpan[] = [];
  readonly #histograms = new Map<string, HistogramStore>();
  #eventSequence = 0;
  #traceSequence = 0;

  public constructor(options: ObservabilityR25Options = {}) {
    this.#clock = options.clock ?? (() => globalThis.performance?.now?.() ?? Date.now());
    this.#maxEvents = Math.max(32, Math.trunc(options.maxEvents ?? 1024));
    this.#maxMetrics = Math.max(32, Math.trunc(options.maxMetrics ?? 2048));
    this.#maxSpans = Math.max(32, Math.trunc(options.maxSpans ?? 1024));
    this.#maxHistogramSamples = Math.max(32, Math.trunc(options.maxHistogramSamples ?? 512));
  }

  public counter(name: string, delta = 1, frame = 0, tags: Readonly<Record<string, string>> = {}): number {
    const key = this.#key(name);
    const value = (this.#counters.get(key) ?? 0) + (Number.isFinite(delta) ? delta : 0);
    this.#counters.set(key, value);
    this.#pushMetric({
      name: key,
      value,
      tags: Object.freeze({ ...tags, kind: 'counter' }),
      timestampMs: this.#clock(),
    });
    this.#voidFrame(frame);
    return value;
  }

  public gauge(name: string, value: number, tags: Readonly<Record<string, string>> = {}): number {
    const key = this.#key(name);
    const next = Number.isFinite(value) ? value : 0;
    this.#gauges.set(key, next);
    this.#pushMetric({
      name: key,
      value: next,
      tags: Object.freeze({ ...tags, kind: 'gauge' }),
      timestampMs: this.#clock(),
    });
    return next;
  }

  public sample(name: string, value: number): void {
    const key = this.#key(name);
    const safeValue = Number.isFinite(value) ? value : 0;
    const existing = this.#histograms.get(key);

    if (existing) {
      existing.values.push(safeValue);
      if (existing.values.length > existing.maxSamples) {
        existing.values.splice(0, existing.values.length - existing.maxSamples);
      }
      return;
    }

    this.#histograms.set(key, {
      name: key,
      values: [safeValue],
      maxSamples: this.#maxHistogramSamples,
    });
  }

  public event(input: Omit<RuntimeEvent, 'id' | 'timestampMs'> & { readonly timestampMs?: number }): RuntimeEvent {
    const event = Object.freeze({
      ...input,
      id: `r25-event-${(++this.#eventSequence).toString(36)}`,
      timestampMs: input.timestampMs ?? this.#clock(),
      attributes: Object.freeze({ ...input.attributes }),
    });
    this.#events.push(event);
    if (this.#events.length > this.#maxEvents) {
      this.#events.splice(0, this.#events.length - this.#maxEvents);
    }
    return event;
  }

  public startSpan(
    name: string,
    attributes: Readonly<Record<string, string | number | boolean>> = {},
  ): { readonly traceId: TraceId; readonly end: (extra?: Readonly<Record<string, string | number | boolean>>) => TraceSpan } {
    const startMs = this.#clock();
    const id = traceId(`r25-trace-${(++this.#traceSequence).toString(36)}`);

    return Object.freeze({
      traceId: id,
      end: (extra = {}) => {
        const span = Object.freeze({
          traceId: id,
          name: this.#key(name),
          startMs,
          durationMs: Math.max(0, this.#clock() - startMs),
          attributes: Object.freeze({ ...attributes, ...extra }),
        });
        this.#spans.push(span);
        if (this.#spans.length > this.#maxSpans) {
          this.#spans.splice(0, this.#spans.length - this.#maxSpans);
        }
        return span;
      },
    });
  }

  public withSpan<T>(
    name: string,
    run: () => T,
    attributes: Readonly<Record<string, string | number | boolean>> = {},
  ): T {
    const span = this.startSpan(name, attributes);
    try {
      const value = run();
      span.end({ outcome: 'ok' });
      return value;
    } catch (error) {
      span.end({
        outcome: 'error',
        error: error instanceof Error ? error.message.slice(0, 128) : String(error).slice(0, 128),
      });
      throw error;
    }
  }

  public histogram(name: string): HistogramSnapshot {
    const store = this.#histograms.get(this.#key(name));
    if (!store || store.values.length === 0) {
      return Object.freeze({
        name,
        count: 0,
        min: 0,
        max: 0,
        mean: 0,
        p50: 0,
        p95: 0,
        p99: 0,
        buckets: Object.freeze([0, 0, 0, 0, 0, 0]),
      });
    }

    const values = [...store.values].sort((a, b) => a - b);
    const sum = values.reduce((total, value) => total + value, 0);
    return Object.freeze({
      name: store.name,
      count: values.length,
      min: values[0] ?? 0,
      max: values[values.length - 1] ?? 0,
      mean: sum / values.length,
      p50: percentile(values, 0.5),
      p95: percentile(values, 0.95),
      p99: percentile(values, 0.99),
      buckets: Object.freeze([
        values.filter((value) => value <= 1).length,
        values.filter((value) => value > 1 && value <= 5).length,
        values.filter((value) => value > 5 && value <= 10).length,
        values.filter((value) => value > 10 && value <= 16.67).length,
        values.filter((value) => value > 16.67 && value <= 33.33).length,
        values.filter((value) => value > 33.33).length,
      ]),
    });
  }

  public snapshot(): ObservabilitySnapshot {
    return Object.freeze({
      counters: Object.freeze(Object.fromEntries(
        [...this.#counters.entries()].sort(([a], [b]) => a.localeCompare(b)),
      )),
      gauges: Object.freeze(Object.fromEntries(
        [...this.#gauges.entries()].sort(([a], [b]) => a.localeCompare(b)),
      )),
      histograms: Object.freeze(
        [...this.#histograms.keys()]
          .sort()
          .map((name) => this.histogram(name)),
      ),
      spans: Object.freeze([...this.#spans]),
      events: Object.freeze([...this.#events]),
    });
  }

  public reset(): void {
    this.#counters.clear();
    this.#gauges.clear();
    this.#metrics.length = 0;
    this.#events.length = 0;
    this.#spans.length = 0;
    this.#histograms.clear();
    this.#eventSequence = 0;
    this.#traceSequence = 0;
  }

  public metricHistory(): readonly MetricValue[] {
    return Object.freeze([...this.#metrics]);
  }

  #pushMetric(metric: MetricValue): void {
    this.#metrics.push(Object.freeze({
      ...metric,
      tags: Object.freeze({ ...metric.tags }),
    }));
    if (this.#metrics.length > this.#maxMetrics) {
      this.#metrics.splice(0, this.#metrics.length - this.#maxMetrics);
    }
  }

  #key(name: string): string {
    const value = name.trim();
    if (!value) throw new Error('R25_METRIC_NAME_EMPTY');
    return value.slice(0, 160);
  }

  #voidFrame(_frame: number): void {
    // Kept as an explicit hook so callers can pass frame ownership without
    // coupling counters to the global simulation clock.
  }
}

export function mergeCounterSnapshots(
  ...snapshots: readonly Readonly<Record<string, number>>[]
): Readonly<Record<string, number>> {
  const merged = new Map<string, number>();
  for (const snapshot of snapshots) {
    for (const [key, value] of Object.entries(snapshot)) {
      merged.set(key, (merged.get(key) ?? 0) + (Number.isFinite(value) ? value : 0));
    }
  }
  return Object.freeze(Object.fromEntries([...merged.entries()].sort(([a], [b]) => a.localeCompare(b))));
}

export function ratePerSecond(
  delta: number,
  elapsedMs: number,
): number {
  if (!Number.isFinite(delta) || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  return delta / (elapsedMs / 1000);
}
