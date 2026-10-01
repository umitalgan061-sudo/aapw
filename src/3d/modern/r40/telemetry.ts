import type { MetricSample, RuntimeHealthReport, RuntimePhase, Tick, TraceSpan } from './types';
import { hashJson, RollingWindow, stableSerialize } from './deterministic';

export interface TelemetryEvent { readonly name: string; readonly tick: Tick; readonly phase: RuntimePhase; readonly value: unknown; readonly digest: string; }
export interface TelemetryBudget { readonly maxEvents: number; readonly maxBytes: number; readonly maxSpans: number; }
export interface TelemetrySnapshot { readonly metrics: readonly MetricSample[]; readonly events: readonly TelemetryEvent[]; readonly spans: readonly TraceSpan[]; readonly digest: string; }

export class TelemetryHub {
  readonly budget: TelemetryBudget;
  #events: TelemetryEvent[] = [];
  #spans: TraceSpan[] = [];
  #metricWindows = new Map<string, RollingWindow>();
  #latest = new Map<string, MetricSample>();
  constructor(budget: Partial<TelemetryBudget> = {}) { this.budget = Object.freeze({ maxEvents: 4096, maxBytes: 1048576, maxSpans: 2048, ...budget }); }

  metric(sample: MetricSample): void {
    let window = this.#metricWindows.get(sample.name);
    if (!window) { window = new RollingWindow(120); this.#metricWindows.set(sample.name, window); }
    window.add(sample.value); this.#latest.set(sample.name, Object.freeze(sample));
  }

  event(name: string, value: unknown, tick: Tick, phase: RuntimePhase): boolean {
    if (!/^[A-Za-z0-9_.:-]{1,96}$/.test(name)) return false;
    const event: TelemetryEvent = Object.freeze({ name, tick, phase, value: structuredClone(value), digest: hashJson({ name, tick, phase, value }) });
    const projected = this.bytes() + stableSerialize(event).length;
    if (projected > this.budget.maxBytes) return false;
    this.#events.push(event);
    if (this.#events.length > this.budget.maxEvents) this.#events.shift();
    return true;
  }

  span(span: TraceSpan): void {
    this.#spans.push(Object.freeze(span));
    if (this.#spans.length > this.budget.maxSpans) this.#spans.shift();
  }

  average(name: string): number { return this.#metricWindows.get(name)?.average() ?? 0; }
  p95(name: string): number { return this.#metricWindows.get(name)?.percentile(0.95) ?? 0; }
  metricNames(): readonly string[] { return Object.freeze([...this.#metricWindows.keys()].sort()); }
  bytes(): number { return stableSerialize({ events: this.#events, spans: this.#spans }).length; }
  recentEvents(limit = 256): readonly TelemetryEvent[] { return Object.freeze(this.#events.slice(-Math.max(1, Math.trunc(limit)))); }
  recentSpans(limit = 256): readonly TraceSpan[] { return Object.freeze(this.#spans.slice(-Math.max(1, Math.trunc(limit)))); }

  snapshot(): TelemetrySnapshot {
    const metrics = Object.freeze([...this.#latest.values()].sort((a, b) => a.name.localeCompare(b.name)));
    const events = this.recentEvents(this.budget.maxEvents);
    const spans = this.recentSpans(this.budget.maxSpans);
    return Object.freeze({ metrics, events, spans, digest: hashJson({ metrics, events, spans }) });
  }

  reportHealth(report: RuntimeHealthReport): boolean {
    return this.event('runtime.health', report, report.tick, 'telemetry');
  }

  clear(): void { this.#events.length = 0; this.#spans.length = 0; this.#metricWindows.clear(); this.#latest.clear(); }
}
