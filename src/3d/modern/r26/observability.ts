export type TelemetrySeverityR26 = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface MetricPointR26 {
  readonly name: string;
  readonly value: number;
  readonly timestampMs: number;
  readonly tags: Readonly<Record<string, string>>;
}

export interface SpanR26 {
  readonly id: number;
  readonly name: string;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly durationMs: number;
  readonly severity: TelemetrySeverityR26;
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
}

export interface IncidentR26 {
  readonly id: number;
  readonly severity: TelemetrySeverityR26;
  readonly message: string;
  readonly frame: number;
  readonly timestampMs: number;
  readonly context: Readonly<Record<string, string | number | boolean>>;
}

export interface HistogramSnapshotR26 {
  readonly count: number;
  readonly min: number;
  readonly max: number;
  readonly average: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
}

export interface ObservabilitySnapshotR26 {
  readonly metrics: readonly MetricPointR26[];
  readonly spans: readonly SpanR26[];
  readonly incidents: readonly IncidentR26[];
  readonly histograms: Readonly<Record<string, HistogramSnapshotR26>>;
}

const clean = (value: string): string => value.trim().slice(0, 128);
const number = (value: number): number => Number.isFinite(value) ? value : 0;

class HistogramR26 {
  readonly #samples: number[] = [];
  readonly #capacity: number;

  constructor(capacity = 2048) {
    this.#capacity = Math.max(32, Math.floor(capacity));
  }

  observe(value: number): void {
    this.#samples.push(number(value));
    if (this.#samples.length > this.#capacity) this.#samples.shift();
  }

  snapshot(): HistogramSnapshotR26 {
    const values = [...this.#samples].sort((a, b) => a - b);
    if (!values.length) {
      return Object.freeze({
        count: 0,
        min: 0,
        max: 0,
        average: 0,
        p50: 0,
        p95: 0,
        p99: 0,
      });
    }
    const percentile = (ratio: number): number =>
      values[Math.min(values.length - 1, Math.max(0, Math.round((values.length - 1) * ratio)))]!;
    return Object.freeze({
      count: values.length,
      min: values[0]!,
      max: values.at(-1)!,
      average: values.reduce((sum, value) => sum + value, 0) / values.length,
      p50: percentile(0.5),
      p95: percentile(0.95),
      p99: percentile(0.99),
    });
  }
}

export class ObservabilityR26 {
  readonly #maxMetrics: number;
  readonly #maxSpans: number;
  readonly #maxIncidents: number;
  readonly #metrics: MetricPointR26[] = [];
  readonly #spans: SpanR26[] = [];
  readonly #incidents: IncidentR26[] = [];
  readonly #histograms = new Map<string, HistogramR26>();
  #spanId = 1;
  #incidentId = 1;

  constructor(options: { maxMetrics?: number; maxSpans?: number; maxIncidents?: number } = {}) {
    this.#maxMetrics = Math.max(128, Math.floor(options.maxMetrics ?? 4096));
    this.#maxSpans = Math.max(64, Math.floor(options.maxSpans ?? 2048));
    this.#maxIncidents = Math.max(32, Math.floor(options.maxIncidents ?? 512));
  }

  metric(
    name: string,
    value: number,
    timestampMs = globalThis.performance?.now?.() ?? Date.now(),
    tags: Readonly<Record<string, string>> = {},
  ): void {
    this.#metrics.push(Object.freeze({
      name: clean(name),
      value: number(value),
      timestampMs: number(timestampMs),
      tags: Object.freeze(Object.fromEntries(
        Object.entries(tags).slice(0, 16).map(([key, value]) => [clean(key), String(value).slice(0, 96)]),
      )),
    }));
    while (this.#metrics.length > this.#maxMetrics) this.#metrics.shift();
  }

  counter(name: string, delta = 1, timestampMs?: number): void {
    const key = clean(name);
    const current = this.latestMetric(key)?.value ?? 0;
    this.metric(key, current + number(delta), timestampMs);
  }

  gauge(name: string, value: number, timestampMs?: number): void {
    this.metric(name, value, timestampMs);
  }

  observe(name: string, value: number): void {
    const key = clean(name);
    const histogram = this.#histograms.get(key) ?? new HistogramR26();
    histogram.observe(value);
    this.#histograms.set(key, histogram);
  }

  beginSpan(name: string, startedAtMs?: number): {
    readonly id: number;
    readonly end: (
      severity?: TelemetrySeverityR26,
      attributes?: Readonly<Record<string, string | number | boolean>>,
      endedAtMs?: number,
    ) => SpanR26;
  } {
    const id = this.#spanId++;
    const started = number(startedAtMs ?? (globalThis.performance?.now?.() ?? Date.now()));
    let ended = false;
    return Object.freeze({
      id,
      end: (
        severity: TelemetrySeverityR26 = 'info',
        attributes: Readonly<Record<string, string | number | boolean>> = {},
        endedAtMs?: number,
      ): SpanR26 => {
        if (ended) throw new Error('R26_SPAN_ALREADY_ENDED');
        ended = true;
        const end = number(endedAtMs ?? (globalThis.performance?.now?.() ?? Date.now()));
        const span = Object.freeze({
          id,
          name: clean(name),
          startedAtMs: started,
          endedAtMs: end,
          durationMs: Math.max(0, end - started),
          severity,
          attributes: Object.freeze({ ...attributes }),
        });
        this.#spans.push(span);
        while (this.#spans.length > this.#maxSpans) this.#spans.shift();
        this.observe('span.' + clean(name) + '.durationMs', span.durationMs);
        return span;
      },
    });
  }

  incident(
    severity: TelemetrySeverityR26,
    message: string,
    frame: number,
    context: Readonly<Record<string, string | number | boolean>> = {},
    timestampMs?: number,
  ): IncidentR26 {
    const incident = Object.freeze({
      id: this.#incidentId++,
      severity,
      message: String(message).slice(0, 512),
      frame: Math.max(0, Math.floor(number(frame))),
      timestampMs: number(timestampMs ?? (globalThis.performance?.now?.() ?? Date.now())),
      context: Object.freeze({ ...context }),
    });
    this.#incidents.push(incident);
    while (this.#incidents.length > this.#maxIncidents) this.#incidents.shift();
    return incident;
  }

  latestMetric(name: string): MetricPointR26 | undefined {
    const key = clean(name);
    for (let index = this.#metrics.length - 1; index >= 0; index -= 1) {
      if (this.#metrics[index]!.name === key) return this.#metrics[index];
    }
    return undefined;
  }

  metrics(name?: string): readonly MetricPointR26[] {
    const key = name ? clean(name) : undefined;
    return Object.freeze(this.#metrics.filter((metric) => key === undefined || metric.name === key));
  }

  spans(): readonly SpanR26[] {
    return Object.freeze([...this.#spans]);
  }

  incidents(): readonly IncidentR26[] {
    return Object.freeze([...this.#incidents]);
  }

  snapshot(): ObservabilitySnapshotR26 {
    const histograms = Object.fromEntries(
      [...this.#histograms.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, histogram]) => [name, histogram.snapshot()]),
    );
    return Object.freeze({
      metrics: Object.freeze([...this.#metrics]),
      spans: Object.freeze([...this.#spans]),
      incidents: Object.freeze([...this.#incidents]),
      histograms: Object.freeze(histograms),
    });
  }

  clear(): void {
    this.#metrics.length = 0;
    this.#spans.length = 0;
    this.#incidents.length = 0;
    this.#histograms.clear();
  }
}
