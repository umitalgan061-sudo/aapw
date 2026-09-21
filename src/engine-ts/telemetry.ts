import type { Disposable, HistogramSnapshot, TelemetrySample } from './types.js';
import { RingBuffer } from './collections.js';
import { clamp, stableSort } from './deterministic.js';

export interface CounterSnapshot { readonly name: string; readonly value: number; readonly revision: number; }
export interface TimerSummary extends HistogramSnapshot { readonly budget: number; readonly budgetRatio: number; readonly overBudget: boolean; }
export interface MetricSnapshot { readonly counters: readonly CounterSnapshot[]; readonly timers: readonly TimerSummary[]; readonly samples: number; }

class RollingHistogram {
  private readonly values: RingBuffer<number>;
  private sum = 0;
  private min = Number.POSITIVE_INFINITY;
  private max = Number.NEGATIVE_INFINITY;
  public constructor(capacity: number) { this.values = new RingBuffer(Math.max(4, capacity)); }
  public add(value: number): void {
    if (!Number.isFinite(value)) return;
    const before = this.values.atNewest(0);
    const wasFull = this.values.isFull;
    this.values.push(value);
    if (wasFull && before !== undefined) this.sum -= before;
    this.sum += value;
    this.min = Math.min(this.min, value);
    this.max = Math.max(this.max, value);
    if (wasFull) this.recomputeBounds();
  }
  public snapshot(budget = Number.POSITIVE_INFINITY): TimerSummary {
    const values = this.values.toArray().sort((a, b) => a - b);
    if (values.length === 0) return { count: 0, min: 0, max: 0, mean: 0, p50: 0, p95: 0, p99: 0, budget, budgetRatio: 0, overBudget: false };
    const p = (fraction: number) => values[Math.min(values.length - 1, Math.floor((values.length - 1) * fraction))] ?? 0;
    const mean = this.sum / values.length;
    return { count: values.length, min: this.min, max: this.max, mean, p50: p(0.5), p95: p(0.95), p99: p(0.99), budget, budgetRatio: budget > 0 ? p(0.95) / budget : 0, overBudget: budget > 0 ? p(0.95) > budget : false };
  }
  public clear(): void { this.values.clear(); this.sum = 0; this.min = Number.POSITIVE_INFINITY; this.max = Number.NEGATIVE_INFINITY; }
  public dispose(): void { this.values.dispose(); }
  private recomputeBounds(): void { const values = this.values.toArray(); this.min = values.length ? Math.min(...values) : Number.POSITIVE_INFINITY; this.max = values.length ? Math.max(...values) : Number.NEGATIVE_INFINITY; }
}

export class TelemetryRegistry implements Disposable {
  private readonly maxSamples: number;
  private readonly samples: RingBuffer<TelemetrySample>;
  private readonly counters = new Map<string, { value: number; revision: number }>();
  private readonly timers = new Map<string, RollingHistogram>();
  private _disposed = false;
  private totalSamples = 0;

  public constructor(maxSamples = 4096) { this.maxSamples = Math.max(32, Math.trunc(maxSamples)); this.samples = new RingBuffer(this.maxSamples); }
  public get disposed(): boolean { return this._disposed; }
  public sample(sample: TelemetrySample): void {
    if (this._disposed || !Number.isFinite(sample.value)) return;
    this.samples.push(Object.freeze({ ...sample, tags: Object.freeze({ ...sample.tags }) }));
    this.totalSamples += 1;
    if (sample.unit === 'count') this.increment(sample.name, sample.value);
    if (sample.unit === 'ms' || sample.unit === 'milliseconds') this.observeTimer(sample.name, sample.value);
  }
  public increment(name: string, amount = 1): void {
    if (this._disposed || !Number.isFinite(amount)) return;
    const current = this.counters.get(name) ?? { value: 0, revision: 0 };
    current.value = safeAdd(current.value, amount);
    current.revision += 1;
    this.counters.set(name, current);
  }
  public set(name: string, value: number): void {
    if (this._disposed || !Number.isFinite(value)) return;
    const current = this.counters.get(name) ?? { value: 0, revision: 0 };
    current.value = value;
    current.revision += 1;
    this.counters.set(name, current);
  }
  public observeTimer(name: string, milliseconds: number, capacity = 512): void {
    if (this._disposed || !Number.isFinite(milliseconds)) return;
    let histogram = this.timers.get(name);
    if (!histogram) { histogram = new RollingHistogram(capacity); this.timers.set(name, histogram); }
    histogram.add(clamp(milliseconds, 0, 60000));
  }
  public readSamples(name?: string, max = 256): readonly TelemetrySample[] {
    const values = name ? this.samples.toArray().filter(sample => sample.name === name) : this.samples.toArray();
    return values.slice(Math.max(0, values.length - Math.max(0, Math.trunc(max))));
  }
  public snapshot(budgets: Readonly<Record<string, number>> = {}): MetricSnapshot {
    const counters = [...this.counters.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, value]) => Object.freeze({ name, value: value.value, revision: value.revision }));
    const timers = [...this.timers.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, histogram]) => Object.freeze({ ...histogram.snapshot(budgets[name] ?? Number.POSITIVE_INFINITY), name } as TimerSummary & { name: string }));
    return Object.freeze({ counters, timers, samples: this.totalSamples });
  }
  public topTimers(limit = 10): readonly (TimerSummary & { readonly name: string })[] {
    const entries = [...this.timers.entries()].map(([name, histogram]) => ({ name, ...histogram.snapshot() }));
    return stableSort(entries, (a, b) => b.p95 - a.p95 || a.name.localeCompare(b.name)).slice(0, Math.max(0, Math.trunc(limit)));
  }
  public clear(): void { this.samples.clear(); this.counters.clear(); for (const histogram of this.timers.values()) histogram.clear(); this.totalSamples = 0; }
  public dispose(): void { if (this._disposed) return; this.samples.dispose(); for (const histogram of this.timers.values()) histogram.dispose(); this.timers.clear(); this.counters.clear(); this._disposed = true; }
}

const safeAdd = (a: number, b: number): number => {
  const value = a + b;
  return Number.isFinite(value) ? value : (value > 0 ? Number.MAX_SAFE_INTEGER : Number.MIN_SAFE_INTEGER);
};
