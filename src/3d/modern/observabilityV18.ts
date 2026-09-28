/**
 * AAPW Observability V18.
 *
 * Bounded local metrics, trace spans, counters and structured events for the
 * runtime. The module deliberately avoids external telemetry vendors and keeps
 * all data immutable and memory bounded.
 */

export type TelemetrySeverityV18 = 'debug' | 'info' | 'warn' | 'error';
export type TelemetryKindV18 = 'counter' | 'gauge' | 'histogram' | 'event' | 'span';

export interface TelemetryEventV18 {
  readonly id: number;
  readonly timestampMs: number;
  readonly frame: number;
  readonly severity: TelemetrySeverityV18;
  readonly kind: TelemetryKindV18;
  readonly name: string;
  readonly durationMs: number;
  readonly value: number;
  readonly attributes: Readonly<Record<string, string | number | boolean | null>>;
}

export interface TelemetryMetricV18 {
  readonly name: string;
  readonly count: number;
  readonly sum: number;
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  readonly last: number;
  readonly p50: number;
  readonly p95: number;
}

export interface TelemetrySnapshotV18 {
  readonly revision: number;
  readonly events: readonly TelemetryEventV18[];
  readonly metrics: readonly TelemetryMetricV18[];
  readonly droppedEvents: number;
  readonly activeSpans: number;
}

export interface ObservabilityOptionsV18 {
  readonly maxEvents?: number;
  readonly maxMetrics?: number;
  readonly clock?: () => number;
}

interface MetricStateV18 {
  readonly values: number[];
  last: number;
  sum: number;
  min: number;
  max: number;
  count: number;
}

interface SpanStateV18 {
  readonly name: string;
  readonly startMs: number;
  readonly frame: number;
  readonly attributes: Readonly<Record<string, string | number | boolean | null>>;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\\s+/g, '.');
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = clamp(
    Math.ceil((sorted.length - 1) * ratio),
    0,
    sorted.length - 1,
  );
  return sorted[index] ?? 0;
}

function freeze<T>(value: T): T {
  return Object.freeze(value);
}

export class ObservabilityV18 {
  readonly #events: TelemetryEventV18[] = [];
  readonly #metrics = new Map<string, MetricStateV18>();
  readonly #spans = new Map<number, SpanStateV18>();
  readonly #clock: () => number;
  readonly #maxEvents: number;
  readonly #maxMetrics: number;

  #nextId = 1;
  #nextSpan = 1;
  #revision = 0;
  #droppedEvents = 0;

  public constructor(options: ObservabilityOptionsV18 = {}) {
    this.#clock = options.clock ?? (() => performance.now());
    this.#maxEvents = Math.max(128, Math.trunc(options.maxEvents ?? 4096));
    this.#maxMetrics = Math.max(32, Math.trunc(options.maxMetrics ?? 512));
  }

  public counter(
    name: string,
    delta = 1,
    frame = 0,
    attributes: Readonly<Record<string, string | number | boolean | null>> = {},
  ): void {
    this.#recordMetric(name, delta);
    this.event({
      name,
      severity: 'debug',
      kind: 'counter',
      frame,
      value: delta,
      attributes,
    });
  }

  public gauge(
    name: string,
    value: number,
    frame = 0,
    attributes: Readonly<Record<string, string | number | boolean | null>> = {},
  ): void {
    this.#recordMetric(name, value);
    this.event({
      name,
      severity: 'debug',
      kind: 'gauge',
      frame,
      value,
      attributes,
    });
  }

  public timing(
    name: string,
    durationMs: number,
    frame = 0,
    attributes: Readonly<Record<string, string | number | boolean | null>> = {},
  ): void {
    this.#recordMetric(name, durationMs);
    this.event({
      name,
      severity: durationMs > 100 ? 'warn' : 'debug',
      kind: 'histogram',
      frame,
      durationMs,
      value: durationMs,
      attributes,
    });
  }

  public event(input: {
    readonly name: string;
    readonly severity?: TelemetrySeverityV18;
    readonly kind?: TelemetryKindV18;
    readonly frame?: number;
    readonly durationMs?: number;
    readonly value?: number;
    readonly attributes?: Readonly<Record<string, string | number | boolean | null>>;
    readonly timestampMs?: number;
  }): TelemetryEventV18 {
    const event = freeze({
      id: this.#nextId++,
      timestampMs: Math.max(0, finite(input.timestampMs, this.#clock())),
      frame: Math.max(0, Math.trunc(finite(input.frame, 0))),
      severity: input.severity ?? 'info',
      kind: input.kind ?? 'event',
      name: normalize(input.name),
      durationMs: Math.max(0, finite(input.durationMs, 0)),
      value: finite(input.value, 0),
      attributes: freeze({ ...(input.attributes ?? {}) }),
    });

    this.#events.push(event);
    while (this.#events.length > this.#maxEvents) {
      this.#events.shift();
      this.#droppedEvents += 1;
    }

    this.#revision += 1;
    return event;
  }

  public startSpan(
    name: string,
    frame = 0,
    attributes: Readonly<Record<string, string | number | boolean | null>> = {},
  ): number {
    const id = this.#nextSpan++;
    this.#spans.set(id, {
      name: normalize(name),
      startMs: this.#clock(),
      frame: Math.max(0, Math.trunc(frame)),
      attributes: freeze({ ...attributes }),
    });
    this.#revision += 1;
    return id;
  }

  public endSpan(
    spanId: number,
    severity: TelemetrySeverityV18 = 'debug',
    extra: Readonly<Record<string, string | number | boolean | null>> = {},
  ): TelemetryEventV18 | null {
    const span = this.#spans.get(Math.trunc(spanId));
    if (!span) return null;

    this.#spans.delete(spanId);
    const durationMs = Math.max(0, this.#clock() - span.startMs);
    this.timing(span.name, durationMs, span.frame, {
      ...span.attributes,
      ...extra,
    });

    const event = this.event({
      name: `${span.name}.complete`,
      severity,
      kind: 'span',
      frame: span.frame,
      durationMs,
      value: durationMs,
      attributes: {
        ...span.attributes,
        ...extra,
      },
    });

    return event;
  }

  public withSpan<T>(
    name: string,
    frame: number,
    run: () => T,
    attributes: Readonly<Record<string, string | number | boolean | null>> = {},
  ): T {
    const span = this.startSpan(name, frame, attributes);
    try {
      const value = run();
      this.endSpan(span);
      return value;
    } catch (error) {
      this.endSpan(span, 'error', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  public async withAsyncSpan<T>(
    name: string,
    frame: number,
    run: () => Promise<T>,
    attributes: Readonly<Record<string, string | number | boolean | null>> = {},
  ): Promise<T> {
    const span = this.startSpan(name, frame, attributes);

    try {
      const value = await run();
      this.endSpan(span);
      return value;
    } catch (error) {
      this.endSpan(span, 'error', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  public metric(name: string): TelemetryMetricV18 | undefined {
    const state = this.#metrics.get(normalize(name));
    return state ? this.#snapshotMetric(normalize(name), state) : undefined;
  }

  public listMetrics(): readonly TelemetryMetricV18[] {
    return freeze(
      [...this.#metrics.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, state]) => this.#snapshotMetric(name, state)),
    );
  }

  public errors(): readonly TelemetryEventV18[] {
    return freeze(this.#events.filter((event) => event.severity === 'error').slice(-256));
  }

  public recent(limit = 128): readonly TelemetryEventV18[] {
    return freeze(this.#events.slice(-Math.max(1, Math.trunc(limit))));
  }

  public snapshot(): TelemetrySnapshotV18 {
    return freeze({
      revision: this.#revision,
      events: freeze([...this.#events]),
      metrics: this.listMetrics(),
      droppedEvents: this.#droppedEvents,
      activeSpans: this.#spans.size,
    });
  }

  public clearEvents(): void {
    this.#events.length = 0;
    this.#revision += 1;
  }

  public clearMetrics(): void {
    this.#metrics.clear();
    this.#revision += 1;
  }

  public reset(): void {
    this.#events.length = 0;
    this.#metrics.clear();
    this.#spans.clear();
    this.#revision += 1;
    this.#droppedEvents = 0;
  }

  #recordMetric(name: string, value: number): void {
    const key = normalize(name);
    if (!key) return;

    let state = this.#metrics.get(key);
    if (!state) {
      if (this.#metrics.size >= this.#maxMetrics) {
        const oldest = [...this.#metrics.keys()].sort()[0];
        if (oldest) this.#metrics.delete(oldest);
      }

      state = {
        values: [],
        last: 0,
        sum: 0,
        min: Number.POSITIVE_INFINITY,
        max: Number.NEGATIVE_INFINITY,
        count: 0,
      };
      this.#metrics.set(key, state);
    }

    const safe = finite(value);
    state.values.push(safe);
    while (state.values.length > 512) state.values.shift();
    state.last = safe;
    state.sum += safe;
    state.min = Math.min(state.min, safe);
    state.max = Math.max(state.max, safe);
    state.count += 1;
  }

  #snapshotMetric(name: string, state: MetricStateV18): TelemetryMetricV18 {
    return freeze({
      name,
      count: state.count,
      sum: state.sum,
      min: Number.isFinite(state.min) ? state.min : 0,
      max: Number.isFinite(state.max) ? state.max : 0,
      mean: state.count > 0 ? state.sum / state.count : 0,
      last: state.last,
      p50: percentile(state.values, 0.5),
      p95: percentile(state.values, 0.95),
    });
  }
}
