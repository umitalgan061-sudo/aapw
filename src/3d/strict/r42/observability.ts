/**
 * Metrics, tracing and health evaluation for R42.
 * Production TypeScript owner.
 */
import type { FrameMetrics, HealthReport, QualityTier, RuntimeMode } from './types.ts';
import { clamp, finite, hashValue, deepFreeze } from './types.ts';

export interface Span {
  readonly id: string;
  readonly name: string;
  readonly startTick: number;
  readonly endTick: number | null;
  readonly elapsedMs: number;
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
}

export interface CounterSnapshot {
  readonly frames: number;
  readonly ticks: number;
  readonly droppedSteps: number;
  readonly commandsAccepted: number;
  readonly commandsRejected: number;
  readonly faults: number;
  readonly assetsLoaded: number;
  readonly assetsFailed: number;
  readonly networkPackets: number;
}

export interface RuntimeObservabilitySnapshot {
  readonly samples: number;
  readonly averageFrameMs: number;
  readonly p95FrameMs: number;
  readonly averageSimulationMs: number;
  readonly averageRenderMs: number;
  readonly averageMemoryBytes: number;
  readonly peakMemoryBytes: number;
  readonly latest: FrameMetrics | null;
  readonly counters: CounterSnapshot;
  readonly activeSpans: number;
  readonly digest: number;
}

export class RuntimeObservabilityR42 {
  readonly capacity: number;
  readonly frameWarningMs: number;
  readonly frameCriticalMs: number;
  readonly memoryWarningBytes: number;
  readonly memoryCriticalBytes: number;

  #samples: FrameMetrics[] = [];
  #spans = new Map<string, Span>();
  #counters: CounterSnapshot = {
    frames: 0,
    ticks: 0,
    droppedSteps: 0,
    commandsAccepted: 0,
    commandsRejected: 0,
    faults: 0,
    assetsLoaded: 0,
    assetsFailed: 0,
    networkPackets: 0,
  };

  constructor(options: Partial<{
    capacity: number;
    frameWarningMs: number;
    frameCriticalMs: number;
    memoryWarningBytes: number;
    memoryCriticalBytes: number;
  }> = {}) {
    this.capacity = Math.max(32, Math.trunc(finite(options.capacity, 512)));
    this.frameWarningMs = Math.max(1, finite(options.frameWarningMs, 20));
    this.frameCriticalMs = Math.max(this.frameWarningMs, finite(options.frameCriticalMs, 33));
    this.memoryWarningBytes = Math.max(1, finite(options.memoryWarningBytes, 512 * 1024 * 1024));
    this.memoryCriticalBytes = Math.max(this.memoryWarningBytes, finite(options.memoryCriticalBytes, 768 * 1024 * 1024));
  }

  record(sample: FrameMetrics): void {
    this.#samples.push(Object.freeze({ ...sample }));
    if (this.#samples.length > this.capacity) this.#samples.shift();
    this.#counters = Object.freeze({
      ...this.#counters,
      frames: this.#counters.frames + 1,
      ticks: this.#counters.ticks + 1,
      droppedSteps: this.#counters.droppedSteps + Math.max(0, sample.droppedSteps),
    });
  }

  increment(name: keyof CounterSnapshot, amount = 1): void {
    this.#counters = Object.freeze({
      ...this.#counters,
      [name]: Math.max(0, this.#counters[name] + Math.trunc(finite(amount))),
    });
  }

  startSpan(id: string, name: string, tick: number, attributes: Readonly<Record<string, string | number | boolean>> = {}): void {
    this.#spans.set(id.slice(0, 128), Object.freeze({
      id: id.slice(0, 128),
      name: name.slice(0, 128),
      startTick: Math.max(0, Math.trunc(tick)),
      endTick: null,
      elapsedMs: 0,
      attributes: Object.freeze({ ...attributes }),
    }));
  }

  endSpan(id: string, tick: number, elapsedMs: number): Span | null {
    const span = this.#spans.get(id);
    if (!span) return null;
    const complete = Object.freeze({
      ...span,
      endTick: Math.max(span.startTick, Math.trunc(tick)),
      elapsedMs: Math.max(0, finite(elapsedMs)),
    });
    this.#spans.delete(id);
    return complete;
  }

  snapshot(): RuntimeObservabilitySnapshot {
    const frames = this.#samples.map(value => value.frameMs);
    const simulation = this.#samples.map(value => value.simulationMs);
    const render = this.#samples.map(value => value.renderMs);
    const memory = this.#samples.map(value => value.memoryBytes);
    const latest = this.#samples[this.#samples.length - 1] ?? null;
    return deepFreeze({
      samples: this.#samples.length,
      averageFrameMs: average(frames),
      p95FrameMs: percentile(frames, 0.95),
      averageSimulationMs: average(simulation),
      averageRenderMs: average(render),
      averageMemoryBytes: average(memory),
      peakMemoryBytes: memory.length ? Math.max(...memory) : 0,
      latest,
      counters: { ...this.#counters },
      activeSpans: this.#spans.size,
      digest: hashValue(this.#samples),
    });
  }

  health(mode: RuntimeMode, tick: number, quality: QualityTier): HealthReport {
    const snapshot = this.snapshot();
    const warnings: string[] = [];
    const critical: string[] = [];
    if (snapshot.averageFrameMs >= this.frameCriticalMs) critical.push('frame-budget-critical');
    else if (snapshot.averageFrameMs >= this.frameWarningMs) warnings.push('frame-budget-warning');
    if (snapshot.peakMemoryBytes >= this.memoryCriticalBytes) critical.push('memory-critical');
    else if (snapshot.peakMemoryBytes >= this.memoryWarningBytes) warnings.push('memory-warning');
    if (snapshot.counters.droppedSteps > 0) warnings.push('simulation-dropped-steps');
    if (snapshot.counters.faults > 0) critical.push('runtime-faults');

    const score = clamp(
      100
        - warnings.length * 10
        - critical.length * 30
        - Math.max(0, snapshot.p95FrameMs - this.frameWarningMs) * 1.25
        - (quality === 'minimal' ? 3 : 0),
      0,
      100,
    );

    return deepFreeze({
      ok: critical.length === 0 && mode !== 'faulted',
      score,
      mode,
      tick,
      warnings: Object.freeze(warnings),
      critical: Object.freeze(critical),
      sampleCount: snapshot.samples,
      digest: hashValue({ snapshot, quality }),
    });
  }

  reset(): void {
    this.#samples = [];
    this.#spans.clear();
    this.#counters = {
      frames: 0,
      ticks: 0,
      droppedSteps: 0,
      commandsAccepted: 0,
      commandsRejected: 0,
      faults: 0,
      assetsLoaded: 0,
      assetsFailed: 0,
      networkPackets: 0,
    };
  }
}

function average(values: readonly number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: readonly number[], ratio: number): number {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const index = Math.min(ordered.length - 1, Math.max(0, Math.ceil((ordered.length - 1) * clamp(ratio, 0, 1))));
  return ordered[index] ?? 0;
}
