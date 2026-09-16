import { checksumV5, type SeverityV5, type TickV5 } from './runtimeContractV5';

export interface TelemetryEventV5 { readonly name: string; readonly category: string; readonly severity: SeverityV5; readonly tick: TickV5; readonly timestamp: number; readonly durationMs?: number; readonly attributes: Readonly<Record<string, string | number | boolean>>; }
export interface TelemetryCounterV5 { readonly name: string; readonly value: number; readonly delta: number; readonly tick: TickV5; }
export interface TelemetrySpanV5 { readonly id: string; readonly parentId: string | null; readonly name: string; readonly start: number; readonly end: number; readonly durationMs: number; readonly status: 'ok' | 'error'; readonly attributes: Readonly<Record<string, string | number | boolean>>; }
export interface TelemetryOptionsV5 { readonly maxEvents?: number; readonly maxSpans?: number; readonly maxAttributes?: number; readonly now?: () => number; }
export interface TelemetrySnapshotV5 { readonly events: readonly TelemetryEventV5[]; readonly counters: readonly TelemetryCounterV5[]; readonly spans: readonly TelemetrySpanV5[]; readonly dropped: number; readonly checksum: string; }

const cleanKey = (key: string): string => key.trim().slice(0, 64);
const cleanValue = (value: string | number | boolean): string | number | boolean => typeof value === 'string' ? value.slice(0, 256) : Number.isFinite(value) ? value : 0;
function attributes(value: Readonly<Record<string, string | number | boolean>>, max: number): Readonly<Record<string, string | number | boolean>> { const keys = Object.keys(value).sort().slice(0, max); return Object.freeze(Object.fromEntries(keys.map((key) => [cleanKey(key), cleanValue(value[key]!) ]))); }

export class TelemetryPipelineV5 {
  readonly maxEvents: number; readonly maxSpans: number; readonly maxAttributes: number;
  #now: () => number; #events: TelemetryEventV5[] = []; #spans: TelemetrySpanV5[] = []; #counters = new Map<string, number>(); #counterTicks = new Map<string, TickV5>(); #dropped = 0;
  constructor(options: TelemetryOptionsV5 = {}) { this.maxEvents = Math.max(32, Math.min(100_000, Math.floor(options.maxEvents ?? 5000))); this.maxSpans = Math.max(32, Math.min(100_000, Math.floor(options.maxSpans ?? 2500))); this.maxAttributes = Math.max(2, Math.min(128, Math.floor(options.maxAttributes ?? 24))); this.#now = options.now ?? (() => typeof performance !== 'undefined' ? performance.now() : Date.now()); }
  event(event: Omit<TelemetryEventV5, 'timestamp'> & Partial<Pick<TelemetryEventV5, 'timestamp'>>): void { const normalized = Object.freeze({ ...event, name: event.name.slice(0, 96), category: event.category.slice(0, 64), timestamp: event.timestamp ?? this.#now(), attributes: attributes(event.attributes, this.maxAttributes) }); this.#events.push(normalized); while (this.#events.length > this.maxEvents) { this.#events.shift(); this.#dropped += 1; } }
  increment(name: string, delta = 1, tick: TickV5 = 0 as TickV5): void { const key = name.slice(0, 96); const value = (this.#counters.get(key) ?? 0) + (Number.isFinite(delta) ? delta : 0); this.#counters.set(key, value); this.#counterTicks.set(key, tick); }
  beginSpan(name: string, parentId: string | null = null, attributesValue: Readonly<Record<string, string | number | boolean>> = {}): TelemetrySpanBuilderV5 { return new TelemetrySpanBuilderV5(this, name, parentId, attributesValue, this.#now()); }
  addSpan(span: TelemetrySpanV5): void { this.#spans.push(Object.freeze(span)); while (this.#spans.length > this.maxSpans) { this.#spans.shift(); this.#dropped += 1; } }
  snapshot(): TelemetrySnapshotV5 { const counters = Object.freeze([...this.#counters.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => Object.freeze({ name, value, delta: value, tick: this.#counterTicks.get(name) ?? (0 as TickV5) }))); const payload = { events: this.#events, counters, spans: this.#spans, dropped: this.#dropped }; return Object.freeze({ ...payload, checksum: checksumV5(payload) }); }
  events(): readonly TelemetryEventV5[] { return Object.freeze(this.#events.slice()); }
  spans(): readonly TelemetrySpanV5[] { return Object.freeze(this.#spans.slice()); }
  counter(name: string): number { return this.#counters.get(name) ?? 0; }
  dropped(): number { return this.#dropped; }
  clear(): void { this.#events.length = 0; this.#spans.length = 0; this.#counters.clear(); this.#counterTicks.clear(); this.#dropped = 0; }
}

export class TelemetrySpanBuilderV5 {
  #pipeline: TelemetryPipelineV5; #name: string; #parentId: string | null; #attributes: Readonly<Record<string, string | number | boolean>>; #start: number; #finished = false;
  constructor(pipeline: TelemetryPipelineV5, name: string, parentId: string | null, attributesValue: Readonly<Record<string, string | number | boolean>>, start: number) { this.#pipeline = pipeline; this.#name = name.slice(0, 96); this.#parentId = parentId?.slice(0, 96) ?? null; this.#attributes = Object.freeze({ ...attributesValue }); this.#start = start; }
  finish(status: 'ok' | 'error' = 'ok', end = this.#start): TelemetrySpanV5 { if (this.#finished) throw new Error('Span already finished'); this.#finished = true; const span: TelemetrySpanV5 = Object.freeze({ id: checksumV5(`${this.#name}:${this.#start}:${this.#parentId ?? ''}`), parentId: this.#parentId, name: this.#name, start: this.#start, end: Math.max(this.#start, end), durationMs: Math.max(0, end - this.#start), status, attributes: Object.freeze({ ...this.#attributes }) }); this.#pipeline.addSpan(span); return span; }
}

export function percentileV5(values: readonly number[], percentile: number): number { if (!values.length) return 0; const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b); if (!sorted.length) return 0; const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil((percentile / 100) * sorted.length) - 1)); return sorted[index]!; }
export function telemetryHealthV5(snapshot: TelemetrySnapshotV5): { readonly errors: number; readonly warnings: number; readonly spans: number; readonly dropped: number } { return Object.freeze({ errors: snapshot.events.filter((event) => event.severity === 'error' || event.severity === 'fatal').length, warnings: snapshot.events.filter((event) => event.severity === 'warn').length, spans: snapshot.spans.length, dropped: snapshot.dropped }); }
