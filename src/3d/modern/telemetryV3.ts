/**
 * Runtime telemetry V3.
 *
 * Lightweight metrics and structured spans for browser and worker contexts.
 * Data is bounded, names are normalised and optional sensitive fields are
 * explicitly redacted.
 *
 * @module telemetryV3
 */

export type MetricKind = 'counter' | 'gauge' | 'histogram';

export type MetricValue = {
  readonly name: string;
  readonly kind: MetricKind;
  readonly value: number;
  readonly tags: Readonly<Record<string, string>>;
  readonly timestampMs: number;
};

export type TelemetrySpan = {
  readonly id: string;
  readonly name: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly durationMs: number;
  readonly status: 'ok' | 'error';
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
};

export type TelemetryOptions = {
  readonly maxMetrics?: number;
  readonly maxSpans?: number;
  readonly clock?: () => number;
  readonly redactKeys?: readonly string[];
};

type HistogramState = {
  count: number;
  sum: number;
  min: number;
  max: number;
  buckets: number[];
};

const DEFAULT_BUCKETS = [1, 2, 4, 8, 12, 16, 24, 33, 50, 100, 250, 500];

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, '_').slice(0, 128);
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function normalizeTags(
  tags: Readonly<Record<string, unknown>> | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!tags) {
    return result;
  }
  for (const [key, value] of Object.entries(tags)) {
    const name = normalizeName(key);
    if (!name) {
      continue;
    }
    result[name] = String(value).slice(0, 128);
  }
  return result;
}

function nowId(counter: number, now: number): string {
  return \`span:\${Math.floor(now)}:\${counter}\`;
}

export class TelemetryV3 {
  readonly #clock: () => number;
  readonly #maxMetrics: number;
  readonly #maxSpans: number;
  readonly #redactKeys: ReadonlySet<string>;
  readonly #metrics: MetricValue[] = [];
  readonly #spans: TelemetrySpan[] = [];
  readonly #counters = new Map<string, number>();
  readonly #gauges = new Map<string, number>();
  readonly #histograms = new Map<string, HistogramState>();

  #spanCounter = 0;

  constructor(options: TelemetryOptions = {}) {
    this.#clock = options.clock ?? (() => performance.now());
    this.#maxMetrics = Math.max(64, Math.floor(options.maxMetrics ?? 4096));
    this.#maxSpans = Math.max(64, Math.floor(options.maxSpans ?? 1024));
    this.#redactKeys = new Set(
      (options.redactKeys ?? ['token', 'authorization', 'password', 'secret', 'cookie'])
        .map(normalizeName),
    );
  }

  counter(
    name: string,
    delta = 1,
    tags?: Readonly<Record<string, unknown>>,
  ): number {
    const key = normalizeName(name);
    const value = (this.#counters.get(key) ?? 0) + finite(delta);
    this.#counters.set(key, value);
    this.#record({
      name: key,
      kind: 'counter',
      value,
      tags: normalizeTags(tags),
      timestampMs: this.#clock(),
    });
    return value;
  }

  gauge(
    name: string,
    value: number,
    tags?: Readonly<Record<string, unknown>>,
  ): number {
    const key = normalizeName(name);
    const numeric = finite(value);
    this.#gauges.set(key, numeric);
    this.#record({
      name: key,
      kind: 'gauge',
      value: numeric,
      tags: normalizeTags(tags),
      timestampMs: this.#clock(),
    });
    return numeric;
  }

  observe(
    name: string,
    value: number,
    tags?: Readonly<Record<string, unknown>>,
  ): number {
    const key = normalizeName(name);
    const histogram = this.#histograms.get(key) ?? {
      count: 0,
      sum: 0,
      min: Number.POSITIVE_INFINITY,
      max: Number.NEGATIVE_INFINITY,
      buckets: DEFAULT_BUCKETS.map(() => 0),
    };
    const numeric = Math.max(0, finite(value));
    histogram.count += 1;
    histogram.sum += numeric;
    histogram.min = Math.min(histogram.min, numeric);
    histogram.max = Math.max(histogram.max, numeric);
    for (let index = 0; index < DEFAULT_BUCKETS.length; index += 1) {
      const bound = DEFAULT_BUCKETS[index];
      if (bound !== undefined && numeric <= bound) {
        histogram.buckets[index] += 1;
      }
    }
    this.#histograms.set(key, histogram);

    this.#record({
      name: key,
      kind: 'histogram',
      value: numeric,
      tags: normalizeTags(tags),
      timestampMs: this.#clock(),
    });
    return numeric;
  }

  startSpan(
    name: string,
    attributes?: Readonly<Record<string, unknown>>,
  ): TelemetrySpanHandle {
    const startMs = this.#clock();
    this.#spanCounter += 1;
    const id = nowId(this.#spanCounter, startMs);
    return new TelemetrySpanHandle(
      this,
      id,
      normalizeName(name),
      startMs,
      this.#sanitizeAttributes(attributes),
    );
  }

  currentTime(): number {
    return this.#clock();
  }

  recordSpan(span: TelemetrySpan): void {
    this.#spans.push({
      ...span,
      attributes: this.#sanitizeAttributes(span.attributes),
    });
    while (this.#spans.length > this.#maxSpans) {
      this.#spans.shift();
    }
  }

  #sanitizeAttributes(
    attributes: Readonly<Record<string, unknown>> | undefined,
  ): Readonly<Record<string, string | number | boolean>> {
    const result: Record<string, string | number | boolean> = {};
    if (!attributes) {
      return result;
    }
    for (const [rawKey, rawValue] of Object.entries(attributes)) {
      const key = normalizeName(rawKey);
      if (!key || this.#redactKeys.has(key)) {
        result[key || 'redacted'] = '[REDACTED]';
        continue;
      }
      if (
        typeof rawValue === 'string' ||
        typeof rawValue === 'boolean' ||
        typeof rawValue === 'number'
      ) {
        result[key] =
          typeof rawValue === 'number' ? finite(rawValue) : String(rawValue).slice(0, 256);
      } else if (rawValue !== undefined && rawValue !== null) {
        result[key] = String(rawValue).slice(0, 256);
      }
    }
    return result;
  }

  #record(value: MetricValue): void {
    this.#metrics.push(value);
    while (this.#metrics.length > this.#maxMetrics) {
      this.#metrics.shift();
    }
  }

  metricHistory(): readonly MetricValue[] {
    return this.#metrics.map((metric) => ({
      ...metric,
      tags: { ...metric.tags },
    }));
  }

  spans(): readonly TelemetrySpan[] {
    return this.#spans.map((span) => ({
      ...span,
      attributes: { ...span.attributes },
    }));
  }

  snapshot(): {
    readonly counters: Readonly<Record<string, number>>;
    readonly gauges: Readonly<Record<string, number>>;
    readonly histograms: Readonly<Record<string, {
      readonly count: number;
      readonly sum: number;
      readonly min: number;
      readonly max: number;
      readonly p50: number;
      readonly p95: number;
      readonly p99: number;
    }>>;
    readonly metricCount: number;
    readonly spanCount: number;
  } {
    const histograms: Record<string, {
      count: number;
      sum: number;
      min: number;
      max: number;
      p50: number;
      p95: number;
      p99: number;
    }> = {};

    for (const [name, state] of this.#histograms) {
      histograms[name] = {
        count: state.count,
        sum: state.sum,
        min: state.count ? state.min : 0,
        max: state.count ? state.max : 0,
        p50: percentileFromBuckets(state, 0.5),
        p95: percentileFromBuckets(state, 0.95),
        p99: percentileFromBuckets(state, 0.99),
      };
    }

    return {
      counters: Object.fromEntries(this.#counters),
      gauges: Object.fromEntries(this.#gauges),
      histograms,
      metricCount: this.#metrics.length,
      spanCount: this.#spans.length,
    };
  }

  flush(): {
    readonly metrics: readonly MetricValue[];
    readonly spans: readonly TelemetrySpan[];
  } {
    const payload = {
      metrics: this.metricHistory(),
      spans: this.spans(),
    };
    this.#metrics.length = 0;
    this.#spans.length = 0;
    return payload;
  }

  reset(): void {
    this.#metrics.length = 0;
    this.#spans.length = 0;
    this.#counters.clear();
    this.#gauges.clear();
    this.#histograms.clear();
  }
}

export class TelemetrySpanHandle {
  readonly #telemetry: TelemetryV3;
  readonly #id: string;
  readonly #name: string;
  readonly #startMs: number;
  readonly #attributes: Readonly<Record<string, string | number | boolean>>;
  #ended = false;

  constructor(
    telemetry: TelemetryV3,
    id: string,
    name: string,
    startMs: number,
    attributes: Readonly<Record<string, string | number | boolean>>,
  ) {
    this.#telemetry = telemetry;
    this.#id = id;
    this.#name = name;
    this.#startMs = startMs;
    this.#attributes = attributes;
  }

  end(status: 'ok' | 'error' = 'ok', attributes?: Readonly<Record<string, unknown>>): TelemetrySpan {
    if (this.#ended) {
      throw new Error(\`Telemetry span already ended: \${this.#id}\`);
    }
    this.#ended = true;
    const endMs = Math.max(this.#startMs, this.#telemetry.currentTime());
    const merged: Record<string, string | number | boolean> = {
      ...this.#attributes,
    };
    if (attributes) {
      for (const [key, value] of Object.entries(attributes)) {
        if (
          typeof value === 'string' ||
          typeof value === 'number' ||
          typeof value === 'boolean'
        ) {
          merged[normalizeName(key)] = value;
        }
      }
    }
    const span: TelemetrySpan = {
      id: this.#id,
      name: this.#name,
      startMs: this.#startMs,
      endMs,
      durationMs: endMs - this.#startMs,
      status,
      attributes: merged,
    };
    this.#telemetry.recordSpan(span);
    return span;
  }

  get id(): string {
    return this.#id;
  }

  get ended(): boolean {
    return this.#ended;
  }
}

function percentileFromBuckets(state: HistogramState, target: number): number {
  if (state.count === 0) {
    return 0;
  }
  const targetCount = Math.max(1, Math.ceil(state.count * target));
  let cumulative = 0;
  for (let index = 0; index < state.buckets.length; index += 1) {
    cumulative += state.buckets[index] ?? 0;
    if (cumulative >= targetCount) {
      return DEFAULT_BUCKETS[index] ?? state.max;
    }
  }
  return state.max;
}
