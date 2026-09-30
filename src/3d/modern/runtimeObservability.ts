import type { FrameId, UnixMillis } from './types';

export type SpanKind = 'frame' | 'simulation' | 'render' | 'streaming' | 'network' | 'save' | 'input' | 'recovery';

export interface RuntimeSpan {
  readonly id: number;
  readonly kind: SpanKind;
  readonly frame: FrameId;
  readonly startedAt: UnixMillis;
  readonly endedAt: UnixMillis;
  readonly durationMs: number;
  readonly success: boolean;
  readonly metadata: Readonly<Record<string, number | string | boolean>>;
}

export interface RuntimeCounter {
  readonly name: string;
  readonly value: number;
  readonly lastFrame: FrameId | null;
}

export interface ObservabilitySnapshot {
  readonly spans: readonly RuntimeSpan[];
  readonly counters: readonly RuntimeCounter[];
  readonly errorRate: number;
  readonly avgFrameMs: number;
  readonly p95FrameMs: number;
  readonly droppedSpans: number;
}

export interface RuntimeObservabilityOptions {
  readonly now?: () => UnixMillis;
  readonly maxSpans?: number;
  readonly maxCounters?: number;
}

function percentile(values: readonly number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[index] ?? 0;
}

/** Low-overhead, bounded observability surface. No console I/O and no unbounded history. */
export class RuntimeObservability {
  readonly maxSpans: number;
  readonly maxCounters: number;
  #now: () => UnixMillis;
  #nextSpan = 0;
  #spans: RuntimeSpan[] = [];
  #counterMap = new Map<string, RuntimeCounter>();
  #dropped = 0;
  #errors = 0;
  #operations = 0;

  constructor(options: RuntimeObservabilityOptions = {}) {
    this.#now = options.now ?? (() => Date.now() as UnixMillis);
    this.maxSpans = Math.max(64, Math.min(20_000, Math.trunc(options.maxSpans ?? 5000)));
    this.maxCounters = Math.max(16, Math.min(1000, Math.trunc(options.maxCounters ?? 128)));
  }

  now(): UnixMillis { return this.#now(); }

  start(kind: SpanKind, frame: FrameId, metadata: Record<string, number | string | boolean> = {}): RuntimeSpanHandle {
    return new RuntimeSpanHandle(this, ++this.#nextSpan, kind, frame, this.#now(), metadata);
  }

  count(name: string, delta = 1, frame: FrameId | null = null): number {
    const normalized = name.slice(0, 96);
    const current = this.#counterMap.get(normalized);
    const value = Math.max(0, (current?.value ?? 0) + (Number.isFinite(delta) ? delta : 0));
    if (!current && this.#counterMap.size >= this.maxCounters) return value;
    this.#counterMap.set(normalized, Object.freeze({ name: normalized, value, lastFrame: frame ?? current?.lastFrame ?? null }));
    return value;
  }

  markError(frame: FrameId | null = null): void { this.#errors += 1; this.count('errors', 1, frame); }
  spans(kind?: SpanKind): readonly RuntimeSpan[] { return Object.freeze(kind ? this.#spans.filter((span) => span.kind === kind) : [...this.#spans]); }
  counters(): readonly RuntimeCounter[] { return Object.freeze([...this.#counterMap.values()].sort((a, b) => a.name.localeCompare(b.name))); }

  snapshot(): ObservabilitySnapshot {
    const frames = this.#spans.filter((span) => span.kind === 'frame').map((span) => span.durationMs);
    return Object.freeze({ spans: this.spans(), counters: this.counters(), errorRate: this.#operations ? this.#errors / this.#operations : 0, avgFrameMs: frames.length ? frames.reduce((sum, value) => sum + value, 0) / frames.length : 0, p95FrameMs: percentile(frames, 0.95), droppedSpans: this.#dropped });
  }

  reset(): void { this.#spans.length = 0; this.#counterMap.clear(); this.#errors = 0; this.#operations = 0; this.#dropped = 0; }

  _record(span: RuntimeSpan): void {
    this.#operations += 1;
    if (!span.success) this.#errors += 1;
    if (this.#spans.length >= this.maxSpans) { this.#spans.shift(); this.#dropped += 1; }
    this.#spans.push(Object.freeze(span));
    this.count(`span.${span.kind}`, 1, span.frame);
  }
}

export class RuntimeSpanHandle {
  #observer: RuntimeObservability;
  #id: number;
  #kind: SpanKind;
  #frame: FrameId;
  #startedAt: UnixMillis;
  #metadata: Record<string, number | string | boolean>;
  #ended = false;

  constructor(observer: RuntimeObservability, id: number, kind: SpanKind, frame: FrameId, startedAt: UnixMillis, metadata: Record<string, number | string | boolean>) {
    this.#observer = observer; this.#id = id; this.#kind = kind; this.#frame = frame; this.#startedAt = startedAt; this.#metadata = { ...metadata };
  }

  end(success = true, metadata: Record<string, number | string | boolean> = {}): RuntimeSpan {
    if (this.#ended) throw new Error('Span already ended');
    this.#ended = true;
    const endedAt = Math.max(this.#startedAt, this.#observer.now());
    const span: RuntimeSpan = { id: this.#id, kind: this.#kind, frame: this.#frame, startedAt: this.#startedAt, endedAt, durationMs: Number(endedAt) - Number(this.#startedAt), success, metadata: Object.freeze({ ...this.#metadata, ...metadata }) };
    this.#observer._record(span);
    return span;
  }

  fail(metadata: Record<string, number | string | boolean> = {}): RuntimeSpan { return this.end(false, metadata); }
}
