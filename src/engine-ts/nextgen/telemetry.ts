import { RuntimeHealth, RuntimeBudgets, TaskLane, TelemetrySample, Tick, clamp, stableNumber } from './contracts.ts';

export interface HistogramBucket { readonly upperBound: number; readonly count: number }
export interface HistogramSnapshot { readonly count: number; readonly total: number; readonly mean: number; readonly p50: number; readonly p95: number; readonly p99: number; readonly buckets: readonly HistogramBucket[] }

export class Histogram {
  readonly #bounds: readonly number[];
  readonly #values: number[] = [];
  readonly #capacity: number;
  constructor(bounds: readonly number[] = [0.5, 1, 2, 4, 8, 16, 33, 66, 100], capacity = 512) { this.#bounds = Object.freeze([...bounds].filter(Number.isFinite).sort((a, b) => a - b)); this.#capacity = Math.max(16, Math.floor(capacity)); }
  observe(value: number): void { this.#values.push(Math.max(0, value)); if (this.#values.length > this.#capacity) this.#values.shift(); }
  snapshot(): HistogramSnapshot {
    const sorted = [...this.#values].sort((a, b) => a - b);
    const percentile = (ratio: number): number => sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))]!;
    const total = sorted.reduce((sum, value) => sum + value, 0);
    return Object.freeze({ count: sorted.length, total: stableNumber(total), mean: stableNumber(sorted.length ? total / sorted.length : 0), p50: stableNumber(percentile(0.5)), p95: stableNumber(percentile(0.95)), p99: stableNumber(percentile(0.99)), buckets: Object.freeze(this.#bounds.map((upperBound) => Object.freeze({ upperBound, count: sorted.filter((value) => value <= upperBound).length }))) });
  }
  clear(): void { this.#values.length = 0; }
}

export interface CounterSnapshot { readonly values: Readonly<Record<string, number>> }
export class CounterSet {
  readonly #values = new Map<string, number>();
  add(key: string, amount = 1): number { const next = (this.#values.get(key) ?? 0) + amount; this.#values.set(key, next); return next; }
  set(key: string, value: number): void { this.#values.set(key, value); }
  get(key: string): number { return this.#values.get(key) ?? 0; }
  snapshot(): CounterSnapshot { return Object.freeze({ values: Object.freeze(Object.fromEntries([...this.#values.entries()].sort((a, b) => a[0].localeCompare(b[0])))) }); }
}

export interface TelemetrySnapshot { readonly tick: Tick; readonly samples: readonly TelemetrySample[]; readonly counters: CounterSnapshot; readonly frame: HistogramSnapshot; readonly lane: Readonly<Record<TaskLane, HistogramSnapshot>> }

const LANES: readonly TaskLane[] = ['simulation', 'gameplay', 'streaming', 'render', 'telemetry', 'background'];

export class TelemetryCollector {
  readonly #frame = new Histogram();
  readonly #lane = new Map<TaskLane, Histogram>();
  readonly #samples: TelemetrySample[] = [];
  readonly #counters = new CounterSet();
  #tick: Tick = 0 as Tick;
  constructor() { for (const lane of LANES) this.#lane.set(lane, new Histogram()); }
  beginTick(tick: Tick): void { this.#tick = tick; }
  record(sample: TelemetrySample): void { this.#samples.push(Object.freeze({ ...sample })); this.#lane.get(sample.lane)?.observe(sample.durationMs); this.#counters.add(`${sample.lane}:runs`); if (sample.overBudget) this.#counters.add(`${sample.lane}:overBudget`); if (this.#samples.length > 2048) this.#samples.splice(0, this.#samples.length - 2048); }
  recordFrame(durationMs: number): void { this.#frame.observe(durationMs); }
  snapshot(): TelemetrySnapshot { const lane = {} as Record<TaskLane, HistogramSnapshot>; for (const taskLane of LANES) lane[taskLane] = this.#lane.get(taskLane)!.snapshot(); return Object.freeze({ tick: this.#tick, samples: Object.freeze([...this.#samples]), counters: this.#counters.snapshot(), frame: this.#frame.snapshot(), lane: Object.freeze(lane) }); }
  clear(): void { this.#samples.length = 0; this.#frame.clear(); for (const histogram of this.#lane.values()) histogram.clear(); }
}

export interface RuntimeHealthInput {
  readonly frameMs: number;
  readonly simulationMs: number;
  readonly memoryBytes: number;
  readonly networkBytes: number;
  readonly activeEntities: number;
  readonly queuedStreams: number;
  readonly assetBytes: number;
}

export class HealthMonitor {
  #last: RuntimeHealth | null = null;
  #samples = 0;

  evaluate(input: RuntimeHealthInput, budgets: RuntimeBudgets, limits: { readonly maxEntities: number; readonly maxAssetBytes: number; readonly maxNetworkBytes: number }): RuntimeHealth {
    const warnings: string[] = [];
    const lanes: TaskLane[] = [];
    const framePressure = input.frameMs / Math.max(1, budgets.frameMs);
    const simulationPressure = input.simulationMs / Math.max(1, budgets.simulationMs);
    if (framePressure > 1) lanes.push('render');
    if (simulationPressure > 1) lanes.push('simulation');
    if (input.networkBytes > limits.maxNetworkBytes) { warnings.push('network-byte-budget'); lanes.push('network' as TaskLane); }
    if (input.activeEntities > limits.maxEntities) warnings.push('entity-cap');
    if (input.assetBytes > limits.maxAssetBytes) warnings.push('asset-memory-cap');
    if (input.queuedStreams > Math.max(4, limits.maxEntities / 1000)) warnings.push('stream-backlog');
    const pressurePenalty = Math.min(65, Math.max(0, framePressure - 1) * 35 + Math.max(0, simulationPressure - 1) * 25);
    const memoryPressure = Math.max(0, input.assetBytes / Math.max(1, limits.maxAssetBytes) - 0.75) * 20;
    const entityPressure = Math.max(0, input.activeEntities / Math.max(1, limits.maxEntities) - 0.8) * 20;
    const score = clamp(100 - pressurePenalty - memoryPressure - entityPressure - warnings.length * 4, 0, 100);
    this.#samples += 1;
    this.#last = Object.freeze({ score: stableNumber(score), frameMs: stableNumber(input.frameMs), simulationMs: stableNumber(input.simulationMs), memoryBytes: Math.max(0, input.memoryBytes), networkBytes: Math.max(0, input.networkBytes), activeEntities: Math.max(0, input.activeEntities), queuedStreams: Math.max(0, input.queuedStreams), assetBytes: Math.max(0, input.assetBytes), overBudgetLanes: Object.freeze([...new Set(lanes)]), warnings: Object.freeze(warnings) });
    return this.#last;
  }

  last(): RuntimeHealth | null { return this.#last; }
  samples(): number { return this.#samples; }
}

export const healthGrade = (score: number): 'excellent' | 'good' | 'degraded' | 'critical' => score >= 90 ? 'excellent' : score >= 75 ? 'good' : score >= 50 ? 'degraded' : 'critical';
