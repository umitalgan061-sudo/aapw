import type { Disposable } from './coreTypes.js';

export type MetricUnit = 'count' | 'ms' | 'bytes' | 'ratio' | 'score';
export interface MetricSample { readonly name: string; readonly value: number; readonly unit: MetricUnit; readonly tick: number; readonly frame: number; readonly tags: Readonly<Record<string, string>>; }
export interface SpanSample { readonly name: string; readonly startMs: number; readonly durationMs: number; readonly tick: number; readonly tags: Readonly<Record<string, string>>; }
export interface HealthScore { readonly score: number; readonly phase: 'healthy' | 'degraded' | 'critical'; readonly faults: number; readonly warnings: number; readonly factors: Readonly<Record<string, number>>; }
export interface TelemetryStats { readonly samples: number; readonly spans: number; readonly dropped: number; readonly errorRate: number; readonly p95FrameMs: number; }

function percentile(values: readonly number[], p: number): number { if (!values.length) return 0; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))]!; }
function ratio(value: number, max: number): number { return Math.max(0, Math.min(1, value / Math.max(1, max))); }

export class TelemetryRuntime implements Disposable {
  #samples: MetricSample[] = [];
  #spans: SpanSample[] = [];
  #maxSamples: number;
  #maxSpans: number;
  #dropped = 0;
  #disposed = false;

  constructor(maxSamples = 4096, maxSpans = 1024) { this.#maxSamples = Math.max(128, Math.trunc(maxSamples)); this.#maxSpans = Math.max(32, Math.trunc(maxSpans)); }
  sample(sample: MetricSample): boolean { if (this.#disposed) return false; if (this.#samples.length >= this.#maxSamples) { this.#dropped += 1; return false; } if (!Number.isFinite(sample.value)) return false; this.#samples.push(Object.freeze({ ...sample, tags: Object.freeze({ ...sample.tags }) })); return true; }
  span(span: SpanSample): boolean { if (this.#disposed) return false; if (this.#spans.length >= this.#maxSpans) { this.#dropped += 1; return false; } if (!Number.isFinite(span.durationMs) || span.durationMs < 0) return false; this.#spans.push(Object.freeze({ ...span, tags: Object.freeze({ ...span.tags }) })); return true; }
  query(name: string, limit = 256): readonly MetricSample[] { return Object.freeze(this.#samples.filter(sample => sample.name === name).slice(-Math.max(0, limit))); }
  recentSpans(limit = 128): readonly SpanSample[] { return Object.freeze(this.#spans.slice(-Math.max(0, limit))); }
  health(frameBudgetMs = 16.67): HealthScore {
    const frames = this.query('runtime.frame.ms', 256).map(sample => sample.value);
    const errors = this.query('runtime.errors', 256).reduce((sum, sample) => sum + Math.max(0, sample.value), 0);
    const memory = this.query('runtime.memory.ratio', 16).at(-1)?.value ?? 0;
    const packetLoss = this.query('network.packetLoss', 16).at(-1)?.value ?? 0;
    const p95 = percentile(frames, 0.95);
    const factors = Object.freeze({ frame: ratio(p95, frameBudgetMs * 1.5), memory: Math.max(0, Math.min(1, memory)), network: Math.max(0, Math.min(1, packetLoss)), errors: Math.min(1, errors / 10) });
    const score = Math.max(0, 1 - (factors.frame * 0.4 + factors.memory * 0.2 + factors.network * 0.2 + factors.errors * 0.2));
    return Object.freeze({ score, phase: score < 0.45 ? 'critical' : score < 0.75 ? 'degraded' : 'healthy', faults: Math.round(errors), warnings: Math.round(factors.frame * 10 + factors.memory * 10), factors });
  }
  aggregate(name: string): Readonly<{ count: number; average: number; min: number; max: number; p95: number }> { const values = this.query(name, this.#maxSamples).map(sample => sample.value); if (!values.length) return Object.freeze({ count: 0, average: 0, min: 0, max: 0, p95: 0 }); return Object.freeze({ count: values.length, average: values.reduce((a, b) => a + b, 0) / values.length, min: Math.min(...values), max: Math.max(...values), p95: percentile(values, 0.95) }); }
  stats(): TelemetryStats { const frame = this.query('runtime.frame.ms', 256).map(sample => sample.value); const errors = this.query('runtime.errors', 256).reduce((sum, sample) => sum + sample.value, 0); return Object.freeze({ samples: this.#samples.length, spans: this.#spans.length, dropped: this.#dropped, errorRate: Math.min(1, errors / Math.max(1, this.#samples.length)), p95FrameMs: percentile(frame, 0.95) }); }
  export(): Readonly<{ samples: readonly MetricSample[]; spans: readonly SpanSample[] }> { return Object.freeze({ samples: Object.freeze(this.#samples.slice()), spans: Object.freeze(this.#spans.slice()) }); }
  clear(): void { this.#samples.length = 0; this.#spans.length = 0; this.#dropped = 0; }
  dispose(): void { this.#disposed = true; this.clear(); }
}
