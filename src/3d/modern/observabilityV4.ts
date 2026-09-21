import {
  type DiagnosticsCounterV4,
  type DiagnosticsSpanV4,
  type TraceId,
  type RuntimeHealthV4,
  type RuntimePhaseV4,
  traceId,
  clampV4,
} from './runtimeContractsV4';

export interface LogEntryV4 {
  readonly timestamp: number;
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly message: string;
  readonly trace: TraceId | null;
  readonly fields: Readonly<Record<string, string | number | boolean>>;
}

export interface MetricSampleV4 {
  readonly timestamp: number;
  readonly name: string;
  readonly value: number;
  readonly unit: 'count' | 'ms' | 'bytes' | 'ratio' | 'score';
  readonly tags: Readonly<Record<string, string>>;
}

export interface ObservabilitySnapshotV4 {
  readonly timestamp: number;
  readonly counters: readonly DiagnosticsCounterV4[];
  readonly spans: readonly DiagnosticsSpanV4[];
  readonly logs: readonly LogEntryV4[];
  readonly metrics: readonly MetricSampleV4[];
}

export interface ObservabilityOptionsV4 {
  readonly maxLogs?: number;
  readonly maxSpans?: number;
  readonly maxMetrics?: number;
  readonly now?: () => number;
}

export interface HealthWindowV4 {
  readonly phase: RuntimePhaseV4;
  readonly frameMs: readonly number[];
  readonly errors: readonly number[];
  readonly stalls: number;
}

const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;

export class ObservabilityV4 {
  readonly maxLogs: number;
  readonly maxSpans: number;
  readonly maxMetrics: number;
  #now: () => number;
  #counters = new Map<string, DiagnosticsCounterV4>();
  #spans: DiagnosticsSpanV4[] = [];
  #logs: LogEntryV4[] = [];
  #metrics: MetricSampleV4[] = [];
  #health: HealthWindowV4 = { phase: 'boot', frameMs: [], errors: [], stalls: 0 };

  constructor(options: ObservabilityOptionsV4 = {}) {
    this.maxLogs = Math.max(64, Math.trunc(options.maxLogs ?? 512));
    this.maxSpans = Math.max(64, Math.trunc(options.maxSpans ?? 1024));
    this.maxMetrics = Math.max(64, Math.trunc(options.maxMetrics ?? 2048));
    this.#now = options.now ?? (() => performance.now());
  }

  increment(name: string, value = 1, unit: DiagnosticsCounterV4['unit'] = 'count'): void {
    const current = this.#counters.get(name);
    this.#counters.set(name, Object.freeze({ name, value: (current?.value ?? 0) + finite(value), unit }));
  }

  set(name: string, value: number, unit: DiagnosticsCounterV4['unit'] = 'count'): void {
    this.#counters.set(name, Object.freeze({ name, value: finite(value), unit }));
  }

  measure<T>(name: string, operation: () => T, attributes: Readonly<Record<string, string | number | boolean>> = {}): T {
    const trace = traceId(`${name}:${this.#now()}:${this.#spans.length}`);
    const started = this.#now();
    try {
      return operation();
    } finally {
      this.span(name, Math.max(0, this.#now() - started), trace, attributes);
    }
  }

  async measureAsync<T>(name: string, operation: () => Promise<T>, attributes: Readonly<Record<string, string | number | boolean>> = {}): Promise<T> {
    const trace = traceId(`${name}:${this.#now()}:${this.#spans.length}`);
    const started = this.#now();
    try {
      return await operation();
    } finally {
      this.span(name, Math.max(0, this.#now() - started), trace, attributes);
    }
  }

  span(name: string, durationMs: number, trace: TraceId, attributes: Readonly<Record<string, string | number | boolean>> = {}): void {
    this.#spans.push(Object.freeze({ name, durationMs: Math.max(0, finite(durationMs)), trace, attributes: Object.freeze({ ...attributes }) }));
    while (this.#spans.length > this.maxSpans) this.#spans.shift();
  }

  log(level: LogEntryV4['level'], message: string, fields: Readonly<Record<string, string | number | boolean>> = {}, trace: TraceId | null = null): void {
    this.#logs.push(Object.freeze({ timestamp: this.#now(), level, message: message.slice(0, 1000), trace, fields: Object.freeze({ ...fields }) }));
    while (this.#logs.length > this.maxLogs) this.#logs.shift();
    if (level === 'error') this.increment('logs.error');
    if (level === 'warn') this.increment('logs.warn');
  }

  metric(name: string, value: number, unit: MetricSampleV4['unit'] = 'count', tags: Readonly<Record<string, string>> = {}): void {
    this.#metrics.push(Object.freeze({ timestamp: this.#now(), name, value: finite(value), unit, tags: Object.freeze({ ...tags }) }));
    while (this.#metrics.length > this.maxMetrics) this.#metrics.shift();
  }

  frame(durationMs: number, errorCount = 0, phase: RuntimePhaseV4 = this.#health.phase): void {
    const frames = [...this.#health.frameMs, Math.max(0, finite(durationMs))].slice(-120);
    const errors = [...this.#health.errors, Math.max(0, finite(errorCount))].slice(-120);
    const stalls = this.#health.stalls + (durationMs > 100 ? 1 : 0);
    this.#health = Object.freeze({ phase, frameMs: Object.freeze(frames), errors: Object.freeze(errors), stalls });
    this.metric('frame.duration', durationMs, 'ms');
    this.set('frame.p95', this.percentile(frames, 0.95), 'ms');
  }

  setPhase(phase: RuntimePhaseV4): void {
    this.#health = Object.freeze({ ...this.#health, phase });
  }

  health(): RuntimeHealthV4 {
    const frames = this.#health.frameMs;
    const errors = this.#health.errors;
    const p95 = this.percentile(frames, 0.95);
    const errorRate = errors.length ? errors.reduce((sum, value) => sum + value, 0) / errors.length : 0;
    const score = clampV4(100 - Math.max(0, p95 - 16.67) * 2 - errorRate * 20 - Math.min(30, this.#health.stalls), 0, 100);
    return Object.freeze({ phase: this.#health.phase, score, errors: Math.round(errors.reduce((sum, value) => sum + value, 0)), warnings: 0, stalled: this.#health.stalls > 2, memoryPressure: 0, networkPressure: 0, renderPressure: clampV4((p95 - 16.67) / 16.67, 0, 1), simulationDrift: clampV4((p95 - 16.67) / 16.67, 0, 1) });
  }

  snapshot(): ObservabilitySnapshotV4 {
    return Object.freeze({ timestamp: this.#now(), counters: Object.freeze([...this.#counters.values()].sort((a, b) => a.name.localeCompare(b.name))), spans: Object.freeze(this.#spans.slice()), logs: Object.freeze(this.#logs.slice()), metrics: Object.freeze(this.#metrics.slice()) });
  }

  exportJson(): string {
    return JSON.stringify(this.snapshot());
  }

  clear(): void {
    this.#counters.clear();
    this.#spans.length = 0;
    this.#logs.length = 0;
    this.#metrics.length = 0;
    this.#health = { phase: 'boot', frameMs: [], errors: [], stalls: 0 };
  }

  percentile(values: readonly number[], ratio: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(clampV4(ratio, 0, 1) * sorted.length) - 1));
    return sorted[index]!;
  }
}

export function observabilityTagsV4(source: string, phase: RuntimePhaseV4): Readonly<Record<string, string>> {
  return Object.freeze({ source, phase });
}
