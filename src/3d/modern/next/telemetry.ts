import type { TelemetrySample, Tick } from './types.ts';

export interface HistogramSummary { readonly count: number; readonly min: number; readonly max: number; readonly mean: number; readonly p50: number; readonly p95: number; readonly p99: number; }

class Histogram {
  #values: number[] = [];
  #maxSamples: number;
  constructor(maxSamples: number) { this.#maxSamples = Math.max(8, Math.floor(maxSamples)); }
  add(value: number): void {
    const normalized = Number.isFinite(value) ? Math.max(0, value) : 0;
    if (this.#values.length >= this.#maxSamples) this.#values.shift();
    this.#values.push(normalized);
  }
  summary(): HistogramSummary {
    if (!this.#values.length) return { count: 0, min: 0, max: 0, mean: 0, p50: 0, p95: 0, p99: 0 };
    const sorted = [...this.#values].sort((a, b) => a - b);
    const percentile = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]!;
    const total = this.#values.reduce((sum, value) => sum + value, 0);
    return { count: sorted.length, min: sorted[0]!, max: sorted.at(-1)!, mean: total / sorted.length, p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99) };
  }
  reset(): void { this.#values.length = 0; }
}

export interface MetricSnapshot { readonly name: string; readonly count: number; readonly sum: number; readonly last: number; readonly histogram: HistogramSummary; readonly tags: Readonly<Record<string, string>>; }

interface Metric { count: number; sum: number; last: number; tags: Readonly<Record<string, string>>; histogram: Histogram; }

export class TelemetryPipeline {
  readonly maxSamples: number;
  readonly flushThreshold: number;
  #queue: TelemetrySample[] = [];
  #metrics = new Map<string, Metric>();
  #dropped = 0;

  constructor(options: { maxSamples?: number; flushThreshold?: number } = {}) {
    this.maxSamples = Math.max(32, Math.floor(options.maxSamples ?? 4096));
    this.flushThreshold = Math.max(1, Math.floor(options.flushThreshold ?? 512));
  }

  record(sample: TelemetrySample): void {
    if (this.#queue.length >= this.maxSamples) { this.#queue.shift(); this.#dropped += 1; }
    this.#queue.push({ ...sample, durationMs: Math.max(0, sample.durationMs), value: sample.value === undefined ? undefined : Number.isFinite(sample.value) ? sample.value : 0 });
    const existing = this.#metrics.get(sample.name);
    const metric = existing ?? { count: 0, sum: 0, last: 0, tags: sample.tags ?? {}, histogram: new Histogram(Math.max(64, Math.min(this.maxSamples, 1024))) };
    metric.count += 1;
    metric.sum += sample.value ?? sample.durationMs;
    metric.last = sample.value ?? sample.durationMs;
    metric.tags = sample.tags ?? metric.tags;
    metric.histogram.add(sample.durationMs);
    this.#metrics.set(sample.name, metric);
  }

  scope(name: string, tick: Tick, tags: Readonly<Record<string, string>> = {}): { end(value?: number): void } {
    const start = globalThis.performance?.now?.() ?? 0;
    return { end: (value?: number) => {
      const now = globalThis.performance?.now?.() ?? start;
      this.record({ tick, name, durationMs: Math.max(0, now - start), value, tags });
    } };
  }

  drain(limit = this.#queue.length): TelemetrySample[] {
    return this.#queue.splice(0, Math.max(0, Math.floor(limit)));
  }

  shouldFlush(): boolean { return this.#queue.length >= this.flushThreshold; }
  droppedSamples(): number { return this.#dropped; }
  queuedSamples(): number { return this.#queue.length; }

  snapshot(): MetricSnapshot[] {
    return [...this.#metrics.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, metric]) => ({ name, count: metric.count, sum: metric.sum, last: metric.last, histogram: metric.histogram.summary(), tags: metric.tags }));
  }

  reset(): void { this.#queue.length = 0; this.#metrics.clear(); this.#dropped = 0; }
}

export interface RuntimeFrameSample { tick: Tick; totalMs: number; simulationMs: number; renderMs: number; streamingMs: number; networkMs: number; memoryBytes?: number; }

export class FrameTelemetry {
  #frames = new TelemetryPipeline({ maxSamples: 2048, flushThreshold: 256 });
  #lastTick = 0;
  add(sample: RuntimeFrameSample): void {
    this.#lastTick = sample.tick;
    this.#frames.record({ tick: sample.tick, name: 'frame.total', durationMs: sample.totalMs, value: sample.totalMs });
    this.#frames.record({ tick: sample.tick, name: 'frame.simulation', durationMs: sample.simulationMs });
    this.#frames.record({ tick: sample.tick, name: 'frame.render', durationMs: sample.renderMs });
    this.#frames.record({ tick: sample.tick, name: 'frame.streaming', durationMs: sample.streamingMs });
    this.#frames.record({ tick: sample.tick, name: 'frame.network', durationMs: sample.networkMs });
    if (sample.memoryBytes !== undefined) this.#frames.record({ tick: sample.tick, name: 'memory.bytes', durationMs: 0, value: Math.max(0, sample.memoryBytes) });
  }
  latestTick(): number { return this.#lastTick; }
  report(): MetricSnapshot[] { return this.#frames.snapshot(); }
}
