import { stableKey, type AppDiagnosticEvent } from './appTypes.ts';

export type TelemetryKind = 'counter' | 'gauge' | 'histogram' | 'event' | 'span';
export interface TelemetryRecord { readonly id: string; readonly kind: TelemetryKind; readonly name: string; readonly value: number; readonly timestampMs: number; readonly frame: number; readonly tick: number; readonly tags: Readonly<Record<string, string>>; readonly durationMs?: number; }
export interface HistogramSummary { readonly count: number; readonly min: number; readonly max: number; readonly average: number; readonly p50: number; readonly p95: number; readonly p99: number; }
export interface TelemetrySnapshot { readonly records: number; readonly dropped: number; readonly counters: Readonly<Record<string, number>>; readonly gauges: Readonly<Record<string, number>>; readonly histograms: Readonly<Record<string, HistogramSummary>>; readonly digest: string; }

const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;
const percentile = (values: readonly number[], p: number): number => { if (!values.length) return 0; const sorted = [...values].sort((a, b) => a - b); const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1)); return sorted[index] ?? 0; };

export class TelemetryPipeline {
  readonly #capacity: number;
  readonly #records: TelemetryRecord[] = [];
  readonly #counters = new Map<string, number>();
  readonly #gauges = new Map<string, number>();
  readonly #histograms = new Map<string, number[]>();
  #dropped = 0;
  #sequence = 0;

  constructor(capacity = 4096) { this.#capacity = Math.max(64, Math.floor(capacity)); }

  increment(name: string, value = 1, frame = 0, tick = 0, timestampMs = Date.now(), tags: Readonly<Record<string, string>> = {}): void {
    const key = stableKey(name, JSON.stringify(tags));
    const next = (this.#counters.get(key) ?? 0) + finite(value, 0);
    this.#counters.set(key, next);
    this.#push({ kind: 'counter', name, value: next, frame, tick, timestampMs, tags });
  }

  gauge(name: string, value: number, frame = 0, tick = 0, timestampMs = Date.now(), tags: Readonly<Record<string, string>> = {}): void {
    const next = finite(value);
    this.#gauges.set(stableKey(name, JSON.stringify(tags)), next);
    this.#push({ kind: 'gauge', name, value: next, frame, tick, timestampMs, tags });
  }

  observe(name: string, value: number, frame = 0, tick = 0, timestampMs = Date.now(), tags: Readonly<Record<string, string>> = {}): void {
    const key = stableKey(name, JSON.stringify(tags));
    const values = this.#histograms.get(key) ?? [];
    values.push(finite(value));
    if (values.length > 512) values.shift();
    this.#histograms.set(key, values);
    this.#push({ kind: 'histogram', name, value: finite(value), frame, tick, timestampMs, tags });
  }

  event(name: string, value = 1, frame = 0, tick = 0, timestampMs = Date.now(), tags: Readonly<Record<string, string>> = {}): void { this.#push({ kind: 'event', name, value: finite(value), frame, tick, timestampMs, tags }); }
  span(name: string, durationMs: number, frame = 0, tick = 0, timestampMs = Date.now(), tags: Readonly<Record<string, string>> = {}): void { this.#push({ kind: 'span', name, value: finite(durationMs), durationMs: finite(durationMs), frame, tick, timestampMs, tags }); }

  reportDiagnostic(event: AppDiagnosticEvent): void {
    this.event('diagnostic.' + event.code, event.value ?? 1, event.frame, event.tick, Date.now(), { subsystem: event.subsystem, severity: event.severity });
  }

  recent(limit = 256): readonly TelemetryRecord[] { return Object.freeze(this.#records.slice(Math.max(0, this.#records.length - Math.floor(limit)))); }
  clear(): void { this.#records.length = 0; this.#counters.clear(); this.#gauges.clear(); this.#histograms.clear(); this.#dropped = 0; this.#sequence = 0; }
  dropped(): number { return this.#dropped; }

  snapshot(): TelemetrySnapshot {
    const counters: Record<string, number> = {};
    const gauges: Record<string, number> = {};
    const histograms: Record<string, HistogramSummary> = {};
    for (const [key, value] of this.#counters) counters[key] = Number(value.toFixed(4));
    for (const [key, value] of this.#gauges) gauges[key] = Number(value.toFixed(4));
    for (const [key, values] of this.#histograms) {
      histograms[key] = Object.freeze({ count: values.length, min: Math.min(...values, 0), max: Math.max(...values, 0), average: values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0, p50: percentile(values, 0.5), p95: percentile(values, 0.95), p99: percentile(values, 0.99) });
    }
    const digestInput = JSON.stringify({ records: this.#records.slice(-128), counters, gauges, histograms });
    let hash = 2166136261;
    for (let i = 0; i < digestInput.length; i += 1) { hash ^= digestInput.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return Object.freeze({ records: this.#records.length, dropped: this.#dropped, counters: Object.freeze(counters), gauges: Object.freeze(gauges), histograms: Object.freeze(histograms), digest: (hash >>> 0).toString(16).padStart(8, '0') });
  }

  #push(input: Omit<TelemetryRecord, 'id'>): void {
    if (this.#records.length >= this.#capacity) { this.#records.shift(); this.#dropped += 1; }
    this.#records.push(Object.freeze({ ...input, id: 't-' + (++this.#sequence) }));
  }
}
