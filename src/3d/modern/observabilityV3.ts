/**
 * Low-overhead runtime observability for AAPW v3.
 *
 * Metrics use fixed-size rolling buffers and data-only samples. Counters can be exported to the
 * existing telemetry layer or inspected directly by QA tooling without changing gameplay behavior.
 */

export interface MetricPointV3 {
  readonly tick: number;
  readonly value: number;
}

export interface SpanRecordV3 {
  readonly name: string;
  readonly startTick: number;
  readonly durationMs: number;
  readonly category: string;
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
}

export interface RuntimeHealthV3 {
  readonly score: number;
  readonly grade: 'A' | 'B' | 'C' | 'D' | 'F';
  readonly frameP95Ms: number;
  readonly simulationP95Ms: number;
  readonly memoryP95Mb: number;
  readonly errorRate: number;
  readonly droppedTickRate: number;
  readonly sampleCount: number;
}

export interface ObservabilityMetricsV3 {
  frames: number;
  ticks: number;
  errors: number;
  droppedTicks: number;
  spanCount: number;
}

const finiteNonNegative = (value: number): boolean => Number.isFinite(value) && value >= 0;
const percentile = (values: readonly number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower] ?? 0;
  const weight = index - lower;
  return (sorted[lower] ?? 0) * (1 - weight) + (sorted[upper] ?? 0) * weight;
};

export class RollingMetricV3 {
  readonly capacity: number;
  #points: MetricPointV3[] = [];

  constructor(capacity = 240) { this.capacity = Math.max(8, Math.floor(capacity)); }

  push(point: MetricPointV3): void {
    if (!Number.isInteger(point.tick) || point.tick < 0 || !finiteNonNegative(point.value)) throw new RangeError('Invalid metric point');
    this.#points.push(Object.freeze({ ...point }));
    if (this.#points.length > this.capacity) this.#points.splice(0, this.#points.length - this.capacity);
  }

  values(): readonly number[] { return Object.freeze(this.#points.map((point) => point.value)); }
  latest(): MetricPointV3 | null { return this.#points.at(-1) ?? null; }
  mean(): number { const values = this.values(); return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length; }
  p95(): number { return percentile(this.values(), 0.95); }
  p99(): number { return percentile(this.values(), 0.99); }
  min(): number { return Math.min(...this.values(), 0); }
  max(): number { return Math.max(...this.values(), 0); }
  clear(): void { this.#points.length = 0; }
}

export class RuntimeObservabilityV3 {
  readonly frameMs: RollingMetricV3;
  readonly simulationMs: RollingMetricV3;
  readonly memoryMb: RollingMetricV3;
  readonly networkRttMs: RollingMetricV3;
  readonly visibleEntities: RollingMetricV3;
  readonly loadedChunks: RollingMetricV3;
  #errors = 0;
  #frames = 0;
  #ticks = 0;
  #droppedTicks = 0;
  #spans: SpanRecordV3[] = [];
  #metrics: ObservabilityMetricsV3 = { frames: 0, ticks: 0, errors: 0, droppedTicks: 0, spanCount: 0 };

  constructor(capacity = 240) {
    this.frameMs = new RollingMetricV3(capacity);
    this.simulationMs = new RollingMetricV3(capacity);
    this.memoryMb = new RollingMetricV3(capacity);
    this.networkRttMs = new RollingMetricV3(capacity);
    this.visibleEntities = new RollingMetricV3(capacity);
    this.loadedChunks = new RollingMetricV3(capacity);
  }

  recordFrame(tick: number, sample: { frameMs: number; simulationMs: number; memoryMb: number; networkRttMs?: number; visibleEntities: number; loadedChunks: number }): void {
    this.frameMs.push({ tick, value: sample.frameMs });
    this.simulationMs.push({ tick, value: sample.simulationMs });
    this.memoryMb.push({ tick, value: sample.memoryMb });
    this.networkRttMs.push({ tick, value: sample.networkRttMs ?? 0 });
    this.visibleEntities.push({ tick, value: sample.visibleEntities });
    this.loadedChunks.push({ tick, value: sample.loadedChunks });
    this.#frames += 1;
    this.#metrics.frames = this.#frames;
  }

  recordTick(_tick: number, dropped = false): void {
    this.#ticks += 1;
    if (dropped) this.#droppedTicks += 1;
    this.#metrics.ticks = this.#ticks;
    this.#metrics.droppedTicks = this.#droppedTicks;
  }

  recordError(): void { this.#errors += 1; this.#metrics.errors = this.#errors; }

  addSpan(span: SpanRecordV3): void {
    if (!span.name || !span.category || !finiteNonNegative(span.durationMs) || !Number.isInteger(span.startTick)) throw new RangeError('Invalid runtime span');
    this.#spans.push(Object.freeze({ ...span, metadata: Object.freeze({ ...span.metadata }) }));
    if (this.#spans.length > 512) this.#spans.splice(0, this.#spans.length - 512);
    this.#metrics.spanCount = this.#spans.length;
  }

  health(frameBudgetMs = 16.7, simulationBudgetMs = 6, memoryBudgetMb = 768): RuntimeHealthV3 {
    const framePenalty = Math.max(0, Math.min(1, (this.frameMs.p95() / Math.max(1, frameBudgetMs)) - 1));
    const simulationPenalty = Math.max(0, Math.min(1, (this.simulationMs.p95() / Math.max(1, simulationBudgetMs)) - 1));
    const memoryPenalty = Math.max(0, Math.min(1, (this.memoryMb.p95() / Math.max(1, memoryBudgetMb)) - 1));
    const errorRate = this.#frames === 0 ? 0 : this.#errors / this.#frames;
    const droppedTickRate = this.#ticks === 0 ? 0 : this.#droppedTicks / this.#ticks;
    const score = Math.max(0, Math.min(100, 100 - framePenalty * 30 - simulationPenalty * 25 - memoryPenalty * 15 - errorRate * 20 - droppedTickRate * 10));
    const grade = score >= 92 ? 'A' : score >= 82 ? 'B' : score >= 70 ? 'C' : score >= 55 ? 'D' : 'F';
    return Object.freeze({ score, grade, frameP95Ms: this.frameMs.p95(), simulationP95Ms: this.simulationMs.p95(), memoryP95Mb: this.memoryMb.p95(), errorRate, droppedTickRate, sampleCount: this.#frames });
  }

  spans(category?: string): readonly SpanRecordV3[] {
    const values = this.#spans.filter((span) => category === undefined || span.category === category);
    return Object.freeze(values.map((span) => ({ ...span, metadata: { ...span.metadata } })));
  }

  metrics(): ObservabilityMetricsV3 { return { ...this.#metrics }; }

  reset(): void {
    this.frameMs.clear(); this.simulationMs.clear(); this.memoryMb.clear(); this.networkRttMs.clear(); this.visibleEntities.clear(); this.loadedChunks.clear();
    this.#errors = 0; this.#frames = 0; this.#ticks = 0; this.#droppedTicks = 0; this.#spans.length = 0;
    this.#metrics = { frames: 0, ticks: 0, errors: 0, droppedTicks: 0, spanCount: 0 };
  }
}

export const createRuntimeObservabilityV3 = (): RuntimeObservabilityV3 => new RuntimeObservabilityV3();
