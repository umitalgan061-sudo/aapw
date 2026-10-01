import type { FeatureFlag, HealthSignal, MetricSample, RuntimeHealthReport, RuntimePhase, Tick, TraceSpan } from './types';
import { hashJson, RollingWindow } from './deterministic';

export class MetricRegistry {
  #windows = new Map<string, RollingWindow>();
  #latest = new Map<string, MetricSample>();
  record(sample: MetricSample): void {
    let window = this.#windows.get(sample.name);
    if (!window) { window = new RollingWindow(120); this.#windows.set(sample.name, window); }
    window.add(sample.value); this.#latest.set(sample.name, Object.freeze(sample));
  }
  latest(name: string): MetricSample | null { return this.#latest.get(name) ?? null; }
  average(name: string): number { return this.#windows.get(name)?.average() ?? 0; }
  p95(name: string): number { return this.#windows.get(name)?.percentile(0.95) ?? 0; }
  names(): readonly string[] { return Object.freeze([...this.#windows.keys()].sort()); }
  clear(): void { this.#windows.clear(); this.#latest.clear(); }
}

interface ActiveSpan { readonly id: string; readonly name: string; readonly phase: RuntimePhase; readonly start: number; readonly parent: string | null; readonly attributes: Record<string, string | number | boolean>; }
export class TraceRecorder {
  readonly maxSpans: number; #active = new Map<string, ActiveSpan>(); #finished: TraceSpan[] = []; #sequence = 0;
  constructor(maxSpans = 2000) { this.maxSpans = Math.max(16, Math.trunc(maxSpans)); }
  begin(name: string, phase: RuntimePhase, parentId: string | null = null, attributes: Record<string, string | number | boolean> = {}): string {
    const id = 'r40-span-' + String(++this.#sequence);
    this.#active.set(id, { id, name, phase, start: performance.now(), parent: parentId, attributes: { ...attributes } });
    return id;
  }
  end(id: string): TraceSpan | null {
    const span = this.#active.get(id); if (!span) return null; this.#active.delete(id);
    const finished = Object.freeze({ id: span.id, name: span.name, phase: span.phase, startedAt: span.start, endedAt: performance.now(), parentId: span.parent, attributes: Object.freeze({ ...span.attributes }) });
    this.#finished.push(finished);
    if (this.#finished.length > this.maxSpans) this.#finished.shift();
    return finished;
  }
  recent(limit = 128): readonly TraceSpan[] { return Object.freeze(this.#finished.slice(-Math.max(1, Math.trunc(limit)))); }
  clear(): void { this.#active.clear(); this.#finished.length = 0; }
}

export class HealthMonitor {
  readonly maxSignals: number; #signals: HealthSignal[] = [];
  constructor(maxSignals = 256) { this.maxSignals = Math.max(16, Math.trunc(maxSignals)); }
  push(signal: HealthSignal): void {
    this.#signals.push(Object.freeze(signal));
    if (this.#signals.length > this.maxSignals) this.#signals.shift();
  }
  latest(): readonly HealthSignal[] { return Object.freeze([...this.#signals]); }
  critical(): readonly HealthSignal[] { return Object.freeze(this.#signals.filter((s) => !s.ok && (s.severity === 'fatal' || s.severity === 'error'))); }
  healthy(): boolean { return this.critical().length === 0; }
  clear(): void { this.#signals.length = 0; }
  report(tick: Tick, quality: RuntimeHealthReport['quality'], queueDepth: number, residentAssets: number, activeEntities: number): RuntimeHealthReport {
    const signals = this.latest(); return Object.freeze({ generatedAt: Date.now() as never, tick, digest: hashJson({ tick, signals }), signals, quality, queueDepth, residentAssets, activeEntities });
  }
}

export class FeatureFlagStore {
  #flags = new Map<string, FeatureFlag>();
  set(flag: FeatureFlag): void { this.#flags.set(flag.id, Object.freeze({ ...flag, rollout: Math.max(0, Math.min(1, flag.rollout)) })); }
  resolve(id: string, subject = ''): boolean {
    const flag = this.#flags.get(id); if (!flag || !flag.enabled) return false;
    if (flag.expiresAt !== null && Number(flag.expiresAt) < Date.now()) return false;
    if (flag.rollout >= 1) return true;
    let hash = 0; const value = id + ':' + subject;
    for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) | 0;
    return ((hash >>> 0) / 0xFFFFFFFF) < flag.rollout;
  }
  snapshot(): readonly FeatureFlag[] { return Object.freeze([...this.#flags.values()].sort((a, b) => a.id.localeCompare(b.id))); }
  clear(): void { this.#flags.clear(); }
}
