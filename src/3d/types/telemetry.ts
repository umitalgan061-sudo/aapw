export type MetricKind = 'counter' | 'gauge' | 'histogram' | 'event';
export type MetricPhase = 'input' | 'simulation' | 'streaming' | 'render' | 'persistence' | 'recovery' | 'system';

export interface MetricPoint {
  readonly name: string;
  readonly kind: MetricKind;
  readonly phase: MetricPhase;
  readonly value: number;
  readonly timestamp: number;
  readonly tags: Readonly<Record<string, string>>;
}

export interface HistogramSnapshot {
  readonly count: number;
  readonly sum: number;
  readonly min: number;
  readonly max: number;
  readonly p50: number;
  readonly p90: number;
  readonly p95: number;
  readonly p99: number;
}

export interface MetricSnapshot {
  readonly generatedAt: number;
  readonly counters: Readonly<Record<string, number>>;
  readonly gauges: Readonly<Record<string, number>>;
  readonly histograms: Readonly<Record<string, HistogramSnapshot>>;
  readonly events: readonly MetricPoint[];
}

export interface TelemetryConfig {
  readonly maxEvents: number;
  readonly maxKeys: number;
  readonly sampleRate: number;
  readonly flushIntervalMs: number;
}

class RunningHistogram {
  #values: number[] = [];
  #sum = 0;
  #min = Number.POSITIVE_INFINITY;
  #max = Number.NEGATIVE_INFINITY;

  add(value: number): void {
    if (!Number.isFinite(value)) return;
    this.#values.push(value);
    this.#sum += value;
    this.#min = Math.min(this.#min, value);
    this.#max = Math.max(this.#max, value);
    if (this.#values.length > 4096) this.#values.splice(0, this.#values.length - 4096);
  }

  snapshot(): HistogramSnapshot {
    const values = [...this.#values].sort((a, b) => a - b);
    const at = (q: number): number => values.length === 0 ? 0 : values[Math.min(values.length - 1, Math.floor((values.length - 1) * q))] ?? 0;
    return { count: this.#values.length, sum: this.#sum, min: Number.isFinite(this.#min) ? this.#min : 0, max: Number.isFinite(this.#max) ? this.#max : 0, p50: at(0.5), p90: at(0.9), p95: at(0.95), p99: at(0.99) };
  }
}

export class RuntimeTelemetry {
  readonly #config: TelemetryConfig;
  readonly #counters = new Map<string, number>();
  readonly #gauges = new Map<string, number>();
  readonly #histograms = new Map<string, RunningHistogram>();
  readonly #events: MetricPoint[] = [];

  constructor(config: Partial<TelemetryConfig> = {}) {
    this.#config = Object.freeze({
      maxEvents: Math.max(1, Math.floor(config.maxEvents ?? 512)),
      maxKeys: Math.max(1, Math.floor(config.maxKeys ?? 256)),
      sampleRate: Math.max(0, Math.min(1, config.sampleRate ?? 1)),
      flushIntervalMs: Math.max(100, config.flushIntervalMs ?? 5000),
    });
  }

  #allowed(name: string): boolean { return Boolean(name.trim()) && (this.#counters.has(name) || this.#gauges.has(name) || this.#histograms.has(name) || this.#keyCount() < this.#config.maxKeys); }
  #keyCount(): number { return this.#counters.size + this.#gauges.size + this.#histograms.size; }

  increment(name: string, value = 1, phase: MetricPhase = 'system', tags: Readonly<Record<string, string>> = {}): void {
    if (!Number.isFinite(value) || !this.#allowed(name)) return;
    this.#counters.set(name, (this.#counters.get(name) ?? 0) + value);
    this.event(name, value, phase, tags);
  }

  gauge(name: string, value: number): void {
    if (!Number.isFinite(value) || !this.#allowed(name)) return;
    this.#gauges.set(name, value);
  }

  observe(name: string, value: number, phase: MetricPhase = 'system', tags: Readonly<Record<string, string>> = {}): void {
    if (!Number.isFinite(value) || !this.#allowed(name)) return;
    const histogram = this.#histograms.get(name) ?? new RunningHistogram();
    histogram.add(value);
    this.#histograms.set(name, histogram);
    this.event(name, value, phase, tags);
  }

  event(name: string, value: number, phase: MetricPhase = 'system', tags: Readonly<Record<string, string>> = {}): void {
    if (!name.trim() || !Number.isFinite(value) || Math.random() > this.#config.sampleRate) return;
    this.#events.push(Object.freeze({ name, kind: 'event', phase, value, timestamp: Date.now(), tags: Object.freeze({ ...tags }) }));
    while (this.#events.length > this.#config.maxEvents) this.#events.shift();
  }

  frame(frameMs: number, gpuMs: number, visible: number, animated: number): void {
    this.observe('frame.duration_ms', frameMs, 'render');
    this.observe('frame.gpu_ms', gpuMs, 'render');
    this.gauge('frame.visible', visible);
    this.gauge('frame.animated', animated);
  }

  asset(queueDepth: number, bytes: number, latencyMs: number): void {
    this.gauge('asset.queue_depth', queueDepth);
    this.increment('asset.bytes', bytes, 'streaming');
    this.observe('asset.latency_ms', latencyMs, 'streaming');
  }

  save(bytes: number, durationMs: number, success: boolean): void {
    this.increment('save.attempts', 1, 'persistence');
    this.increment(success ? 'save.success' : 'save.failure', 1, 'persistence');
    this.gauge('save.bytes', bytes);
    this.observe('save.duration_ms', durationMs, 'persistence');
  }

  recovery(kind: string, durationMs: number): void {
    this.increment(`recovery.${kind}`, 1, 'recovery');
    this.observe('recovery.duration_ms', durationMs, 'recovery');
  }

  snapshot(): MetricSnapshot {
    const histograms: Record<string, HistogramSnapshot> = {};
    for (const [name, histogram] of this.#histograms) histograms[name] = histogram.snapshot();
    return Object.freeze({ generatedAt: Date.now(), counters: Object.fromEntries(this.#counters), gauges: Object.fromEntries(this.#gauges), histograms, events: [...this.#events] });
  }

  reset(): void {
    this.#counters.clear(); this.#gauges.clear(); this.#histograms.clear(); this.#events.length = 0;
  }
}

export function sanitizeMetricTags(tags: Record<string, unknown>, allowlist: readonly string[]): Readonly<Record<string, string>> {
  const allowed = new Set(allowlist);
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(tags)) {
    if (!allowed.has(key) || typeof value !== 'string') continue;
    const clean = value.replace(/[\r\n\t]/g, ' ').slice(0, 128);
    output[key] = clean;
  }
  return Object.freeze(output);
}
