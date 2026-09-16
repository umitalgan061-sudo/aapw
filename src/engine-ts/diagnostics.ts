import type { Disposable, HistogramSnapshot, RuntimeHealth, SystemId, TelemetrySample } from './types.js';
import { RingBuffer } from './collections.js';
import { clamp, stableSort, toHex32, hashString } from './deterministic.js';

export interface DiagnosticEvent {
  readonly level: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  readonly code: string;
  readonly message: string;
  readonly frame: number;
  readonly tick: number;
  readonly subsystem: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface InvariantDefinition {
  readonly id: string;
  readonly severity: DiagnosticEvent['level'];
  readonly subsystem: string;
  readonly description: string;
  readonly check: () => boolean;
}

export interface InvariantResult {
  readonly id: string;
  readonly passed: boolean;
  readonly severity: DiagnosticEvent['level'];
  readonly subsystem: string;
  readonly description: string;
  readonly durationMs: number;
}

export interface DiagnosticSnapshot {
  readonly events: readonly DiagnosticEvent[];
  readonly invariants: readonly InvariantResult[];
  readonly health: RuntimeHealth;
  readonly frame: number;
  readonly tick: number;
  readonly droppedEvents: number;
  readonly revision: number;
}

export interface HealthPolicy {
  readonly warnScore: number;
  readonly failScore: number;
  readonly maxFaults: number;
  readonly maxInvariantFailures: number;
  readonly decayPerSecond: number;
}

export class DiagnosticHub implements Disposable {
  private readonly maxEvents: number;
  private readonly maxInvariants: number;
  private readonly events: RingBuffer<DiagnosticEvent>;
  private readonly invariantResults: RingBuffer<InvariantResult>;
  private readonly definitions = new Map<string, InvariantDefinition>();
  private readonly onceCodes = new Set<string>();
  private readonly policy: HealthPolicy;
  private frame = 0;
  private tick = 0;
  private faults = 0;
  private invariantFailures = 0;
  private healthScore = 1;
  private revision = 0;
  private droppedEvents = 0;
  private _disposed = false;
  private lastFault: string | undefined;

  public constructor(options: { maxEvents?: number; maxInvariants?: number; health?: Partial<HealthPolicy> } = {}) {
    this.maxEvents = Math.max(64, Math.trunc(options.maxEvents ?? 4096));
    this.maxInvariants = Math.max(64, Math.trunc(options.maxInvariants ?? 2048));
    this.events = new RingBuffer(this.maxEvents);
    this.invariantResults = new RingBuffer(this.maxInvariants);
    this.policy = Object.freeze({ warnScore: clamp(options.health?.warnScore ?? 0.75, 0.1, 0.95), failScore: clamp(options.health?.failScore ?? 0.35, 0.05, 0.8), maxFaults: Math.max(1, Math.trunc(options.health?.maxFaults ?? 32)), maxInvariantFailures: Math.max(1, Math.trunc(options.health?.maxInvariantFailures ?? 8)), decayPerSecond: clamp(options.health?.decayPerSecond ?? 0.01, 0, 1) });
  }

  public get disposed(): boolean { return this._disposed; }
  public setClock(frame: number, tick: number): void {
    if (this._disposed) return;
    this.frame = Math.max(0, Math.trunc(frame));
    this.tick = Math.max(0, Math.trunc(tick));
  }

  public registerInvariant(definition: InvariantDefinition): boolean {
    if (this._disposed || !definition.id || this.definitions.has(definition.id) || typeof definition.check !== 'function') return false;
    this.definitions.set(definition.id, Object.freeze({ ...definition }));
    return true;
  }

  public unregisterInvariant(id: string): boolean {
    if (this._disposed) return false;
    return this.definitions.delete(id);
  }

  public report(level: DiagnosticEvent['level'], code: string, message: string, subsystem = 'runtime', data: Readonly<Record<string, unknown>> = {}): void {
    if (this._disposed) return;
    if (!code) return;
    const event = Object.freeze({ level, code, message, frame: this.frame, tick: this.tick, subsystem, data: Object.freeze({ ...data }) });
    const overwritten = this.events.push(event);
    if (overwritten) this.droppedEvents += 1;
    if (level === 'error' || level === 'fatal') {
      this.faults += 1;
      this.lastFault = code;
      this.healthScore = Math.max(0, this.healthScore - (level === 'fatal' ? 0.15 : 0.05));
    } else if (level === 'warn') {
      this.healthScore = Math.max(0, this.healthScore - 0.01);
    }
    this.revision += 1;
  }

  public reportOnce(level: DiagnosticEvent['level'], code: string, message: string, subsystem = 'runtime', data: Readonly<Record<string, unknown>> = {}): void {
    if (this.onceCodes.has(code)) return;
    this.onceCodes.add(code);
    this.report(level, code, message, subsystem, data);
  }

  public observeTelemetry(samples: readonly TelemetrySample[]): void {
    if (this._disposed) return;
    for (const sample of samples) {
      if (sample.unit === 'ms' || sample.unit === 'milliseconds') {
        if (sample.value > 50) this.reportOnce('warn', `telemetry.slow.${sample.name}`, `Slow runtime measurement: ${sample.name}`, 'telemetry', { value: sample.value });
      }
      if (!Number.isFinite(sample.value)) this.report('error', 'telemetry.nonfinite', `Non-finite telemetry value: ${sample.name}`, 'telemetry', { value: sample.value });
    }
  }

  public runInvariants(): readonly InvariantResult[] {
    if (this._disposed) return [];
    const results: InvariantResult[] = [];
    for (const definition of stableSort([...this.definitions.values()], (a, b) => String(a.id).localeCompare(String(b.id)))) {
      const started = nowMs();
      let passed = false;
      try { passed = definition.check() === true; } catch { passed = false; }
      const result = Object.freeze({ id: definition.id, passed, severity: definition.severity, subsystem: definition.subsystem, description: definition.description, durationMs: Math.max(0, nowMs() - started) });
      this.invariantResults.push(result);
      results.push(result);
      if (!passed) {
        this.invariantFailures += 1;
        this.report(definition.severity, `invariant.${definition.id}`, definition.description, definition.subsystem);
      }
    }
    this.revision += 1;
    return Object.freeze(results);
  }

  public tickHealth(deltaSeconds: number): RuntimeHealth {
    if (this._disposed) return Object.freeze({ phase: 'disposed', score: 0, faults: this.faults, recoveries: 0, ...(this.lastFault ? { lastFault: this.lastFault } : {}) });
    const decay = clamp(Number.isFinite(deltaSeconds) ? deltaSeconds : 0, 0, 10) * this.policy.decayPerSecond;
    if (decay > 0 && this.invariantFailures === 0 && this.faults === 0) this.healthScore = Math.min(1, this.healthScore + decay);
    const phase: RuntimeHealth['phase'] = this.faults >= this.policy.maxFaults || this.invariantFailures >= this.policy.maxInvariantFailures || this.healthScore <= this.policy.failScore ? 'failed' : this.healthScore <= this.policy.warnScore ? 'degraded' : 'ready';
    return Object.freeze({ phase, score: clamp(this.healthScore, 0, 1), faults: this.faults, recoveries: 0, ...(this.lastFault ? { lastFault: this.lastFault } : {}) });
  }

  public resetHealth(): void {
    if (this._disposed) return;
    this.faults = 0;
    this.invariantFailures = 0;
    this.healthScore = 1;
    this.lastFault = undefined;
    this.onceCodes.clear();
    this.revision += 1;
  }

  public eventsSince(frame: number): readonly DiagnosticEvent[] {
    return this.events.toArray().filter(event => event.frame >= Math.max(0, Math.trunc(frame))).map(event => Object.freeze({ ...event, data: Object.freeze({ ...event.data }) }));
  }

  public summary(): Readonly<{ readonly total: number; readonly errors: number; readonly warnings: number; readonly invariantsFailed: number; readonly fingerprint: string }> {
    const events = this.events.toArray();
    const errors = events.filter(event => event.level === 'error' || event.level === 'fatal').length;
    const warnings = events.filter(event => event.level === 'warn').length;
    const failed = this.invariantResults.toArray().filter(result => !result.passed).length;
    const fingerprint = toHex32(hashString(JSON.stringify([events.map(event => [event.frame, event.tick, event.code]), failed])));
    return Object.freeze({ total: events.length, errors, warnings, invariantsFailed: failed, fingerprint });
  }

  public snapshot(health: RuntimeHealth = this.tickHealth(0)): DiagnosticSnapshot {
    return Object.freeze({ events: Object.freeze(this.events.toArray()), invariants: Object.freeze(this.invariantResults.toArray()), health, frame: this.frame, tick: this.tick, droppedEvents: this.droppedEvents, revision: this.revision });
  }

  public dispose(): void { if (this._disposed) return; this.events.dispose(); this.invariantResults.dispose(); this.definitions.clear(); this.onceCodes.clear(); this._disposed = true; }
}

export class SystemWatchdog {
  private readonly budgets = new Map<SystemId, number>();
  private readonly recent = new Map<SystemId, number[]>();
  public setBudget(system: SystemId, milliseconds: number): void { this.budgets.set(system, Math.max(0.01, Number.isFinite(milliseconds) ? milliseconds : 1)); }
  public observe(system: SystemId, milliseconds: number): { readonly overBudget: boolean; readonly p95: number; readonly budget: number } {
    const budget = this.budgets.get(system) ?? 1;
    const values = this.recent.get(system) ?? [];
    values.push(clamp(Number.isFinite(milliseconds) ? milliseconds : 0, 0, 1000));
    if (values.length > 120) values.shift();
    this.recent.set(system, values);
    const sorted = [...values].sort((a, b) => a - b);
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
    return Object.freeze({ overBudget: p95 > budget, p95, budget });
  }
  public clear(): void { this.recent.clear(); }
}

export class DeterminismAuditor {
  private readonly digests = new Map<string, string[]>();
  private _revision = 0;
  public record(label: string, digest: string): void { const values = this.digests.get(label) ?? []; values.push(digest); if (values.length > 16) values.shift(); this.digests.set(label, values); this._revision += 1; }
  public compare(label: string): { readonly deterministic: boolean; readonly values: readonly string[]; readonly revision: number } {
    const values = this.digests.get(label) ?? [];
    return Object.freeze({ deterministic: values.every(value => value === values[0]), values: Object.freeze([...values]), revision: this._revision });
  }
  public digest(value: unknown): string { return toHex32(hashString(JSON.stringify(value, canonicalReplacer))); }
  public reset(): void { this.digests.clear(); this._revision += 1; }
}

export const percentile = (values: readonly number[], fraction: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(clamp(fraction, 0, 1) * (sorted.length - 1))))] ?? 0;
};

export const histogramFrom = (values: readonly number[], bins = 16): readonly number[] => {
  if (values.length === 0) return Object.freeze([]);
  const safeBins = Math.max(1, Math.trunc(bins));
  const finite = values.filter(Number.isFinite);
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const width = max > min ? (max - min) / safeBins : 1;
  const counts = new Array<number>(safeBins).fill(0);
  for (const value of finite) counts[Math.min(safeBins - 1, Math.max(0, Math.floor((value - min) / width)))] += 1;
  return Object.freeze(counts);
};

export const summarizeHistogram = (values: readonly number[]): HistogramSnapshot => {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return Object.freeze({ count: 0, min: 0, max: 0, mean: 0, p50: 0, p95: 0, p99: 0 });
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const mean = finite.reduce((sum, value) => sum + value, 0) / finite.length;
  return Object.freeze({ count: finite.length, min, max, mean, p50: percentile(finite, .5), p95: percentile(finite, .95), p99: percentile(finite, .99) });
};

const canonicalReplacer = (_key: string, value: unknown): unknown => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) sorted[key] = (value as Record<string, unknown>)[key];
  return sorted;
};
const nowMs = (): number => typeof performance !== 'undefined' ? performance.now() : Date.now();
