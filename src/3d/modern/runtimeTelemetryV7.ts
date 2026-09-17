import { checksumV7, traceIdV7, type RuntimeEventV7, type RuntimeSourceV7, type TickV7, tickV7 } from './runtimeContractsV7';

export interface MetricSampleV7 {
  readonly name: string;
  readonly value: number;
  readonly unit: string;
  readonly tick: TickV7;
  readonly tags: Readonly<Record<string, string>>;
}

export interface SpanV7 {
  readonly id: string;
  readonly trace: string;
  readonly name: string;
  readonly startMs: number;
  readonly durationMs: number;
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
}

export interface TelemetrySnapshotV7 {
  readonly samples: readonly MetricSampleV7[];
  readonly spans: readonly SpanV7[];
  readonly events: readonly RuntimeEventV7[];
  readonly droppedSamples: number;
  readonly droppedSpans: number;
  readonly droppedEvents: number;
  readonly checksum: string;
}

export interface TelemetryOptionsV7 {
  readonly maxSamples?: number;
  readonly maxSpans?: number;
  readonly maxEvents?: number;
  readonly now?: () => number;
}

export class RuntimeTelemetryV7 {
  readonly maxSamples: number;
  readonly maxSpans: number;
  readonly maxEvents: number;
  #now: () => number;
  #samples: MetricSampleV7[] = [];
  #spans: SpanV7[] = [];
  #events: RuntimeEventV7[] = [];
  #droppedSamples = 0;
  #droppedSpans = 0;
  #droppedEvents = 0;
  #sequence = 0;

  constructor(options: TelemetryOptionsV7 = {}) {
    this.maxSamples = Math.max(32, Math.trunc(options.maxSamples ?? 2048));
    this.maxSpans = Math.max(16, Math.trunc(options.maxSpans ?? 1024));
    this.maxEvents = Math.max(64, Math.trunc(options.maxEvents ?? 4096));
    this.#now = options.now ?? (() => Date.now());
  }

  sample(name: string, value: number, unit = 'count', tick: TickV7 | number = 0, tags: Readonly<Record<string, string>> = {}): void {
    if (!name.trim() || !Number.isFinite(value)) return;
    const sample = Object.freeze({ name: name.trim(), value, unit, tick: tickV7(Number(tick)), tags: Object.freeze({ ...tags }) });
    this.#samples.push(sample);
    if (this.#samples.length > this.maxSamples) { this.#samples.shift(); this.#droppedSamples += 1; }
  }

  span(name: string, startMs: number, durationMs: number, attributes: Readonly<Record<string, string | number | boolean>> = {}): string {
    const trace = traceIdV7(`trace:${++this.#sequence}:${name}`);
    const span = Object.freeze({ id: `span:${this.#sequence}`, trace: String(trace), name, startMs, durationMs: Math.max(0, durationMs), attributes: Object.freeze({ ...attributes }) });
    this.#spans.push(span);
    if (this.#spans.length > this.maxSpans) { this.#spans.shift(); this.#droppedSpans += 1; }
    return span.id;
  }

  event<T>(type: string, tick: TickV7 | number, source: RuntimeSourceV7, payload: T): RuntimeEventV7<T> {
    const event = Object.freeze({ sequence: ++this.#sequence, trace: traceIdV7(`event:${this.#sequence}`), tick: tickV7(Number(tick)), source, type, payload });
    this.#events.push(event as RuntimeEventV7);
    if (this.#events.length > this.maxEvents) { this.#events.shift(); this.#droppedEvents += 1; }
    return event;
  }

  gauge(name: string, value: number, tick: TickV7 | number, tags: Readonly<Record<string, string>> = {}): void { this.sample(name, value, 'gauge', tick, tags); }
  counter(name: string, delta: number, tick: TickV7 | number, tags: Readonly<Record<string, string>> = {}): void { this.sample(name, delta, 'delta', tick, tags); }

  snapshot(): TelemetrySnapshotV7 {
    const samples = Object.freeze(this.#samples.slice());
    const spans = Object.freeze(this.#spans.slice());
    const events = Object.freeze(this.#events.slice());
    return Object.freeze({
      samples,
      spans,
      events,
      droppedSamples: this.#droppedSamples,
      droppedSpans: this.#droppedSpans,
      droppedEvents: this.#droppedEvents,
      checksum: checksumV7({ samples, spans, events, droppedSamples: this.#droppedSamples, droppedSpans: this.#droppedSpans, droppedEvents: this.#droppedEvents }),
    });
  }

  metrics(): Readonly<{ samples: number; spans: number; events: number; dropped: number; now: number }> {
    return Object.freeze({ samples: this.#samples.length, spans: this.#spans.length, events: this.#events.length, dropped: this.#droppedSamples + this.#droppedSpans + this.#droppedEvents, now: this.#now() });
  }

  clear(): void { this.#samples.length = 0; this.#spans.length = 0; this.#events.length = 0; this.#droppedSamples = 0; this.#droppedSpans = 0; this.#droppedEvents = 0; }
}

export function aggregateSamplesV7(samples: readonly MetricSampleV7[]): ReadonlyMap<string, Readonly<{ count: number; sum: number; min: number; max: number; avg: number }>> {
  const buckets = new Map<string, { count: number; sum: number; min: number; max: number }>();
  for (const sample of samples) {
    const current = buckets.get(sample.name) ?? { count: 0, sum: 0, min: Infinity, max: -Infinity };
    current.count += 1; current.sum += sample.value; current.min = Math.min(current.min, sample.value); current.max = Math.max(current.max, sample.value);
    buckets.set(sample.name, current);
  }
  return new Map([...buckets.entries()].map(([name, bucket]) => [name, Object.freeze({ ...bucket, avg: bucket.sum / Math.max(1, bucket.count) })]));
}
