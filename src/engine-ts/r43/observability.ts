import { clamp, stableDigest, type RuntimeHealth } from './contracts.ts';

export interface MetricPoint {
  readonly name: string;
  readonly value: number;
  readonly frame: number;
  readonly tags: Readonly<Record<string, string>>;
}

export class MetricBuffer {
  readonly capacity: number;
  #points: MetricPoint[] = [];

  constructor(capacity = 4096) {
    this.capacity = Math.max(64, Math.trunc(capacity));
  }

  add(point: MetricPoint): void {
    if (!Number.isFinite(point.value)) return;
    this.#points.push(Object.freeze({
      ...point,
      value: point.value,
      tags: Object.freeze({ ...point.tags }),
    }));
    while (this.#points.length > this.capacity) this.#points.shift();
  }

  latest(name: string): MetricPoint | undefined {
    return [...this.#points].reverse().find((point) => point.name === name);
  }

  average(name: string, window = 120): number {
    const values = this.#points.filter((point) => point.name === name).slice(-Math.max(1, window)).map((point) => point.value);
    return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  percentile(name: string, percentile = 0.95): number {
    const values = this.#points.filter((point) => point.name === name).map((point) => point.value).sort((a, b) => a - b);
    if (values.length === 0) return 0;
    const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * clamp(percentile, 0, 1)) - 1));
    return values[index] ?? 0;
  }

  snapshot(): readonly MetricPoint[] {
    return Object.freeze([...this.#points]);
  }

  clear(): void {
    this.#points = [];
  }
}

export class TelemetryRegistry {
  readonly buffer: MetricBuffer;
  #counters = new Map<string, number>();

  constructor(capacity = 4096) {
    this.buffer = new MetricBuffer(capacity);
  }

  record(name: string, value: number, frame: number, tags: Record<string, string> = {}): void {
    this.buffer.add({ name, value, frame, tags });
  }

  count(name: string, delta = 1, frame = 0): number {
    const next = (this.#counters.get(name) ?? 0) + (Number.isFinite(delta) ? delta : 0);
    this.#counters.set(name, next);
    this.record('counter.' + name, next, frame);
    return next;
  }

  counter(name: string): number {
    return this.#counters.get(name) ?? 0;
  }

  flushDigest(): string {
    return stableDigest({
      counters: [...this.#counters.entries()].sort(([a], [b]) => a.localeCompare(b)),
      points: this.buffer.snapshot().slice(-256),
    });
  }

  clear(): void {
    this.buffer.clear();
    this.#counters.clear();
  }
}

export interface HealthObservation {
  readonly frameMs: number;
  readonly cpuMs: number;
  readonly gpuMs: number;
  readonly memoryPressure: number;
  readonly networkPressure: number;
  readonly assetPressure: number;
}

export class HealthMonitor {
  readonly windowSize: number;
  #observations: HealthObservation[] = [];

  constructor(windowSize = 120) {
    this.windowSize = Math.max(8, Math.trunc(windowSize));
  }

  observe(observation: HealthObservation): RuntimeHealth {
    const safe: HealthObservation = {
      frameMs: Math.max(0, Number.isFinite(observation.frameMs) ? observation.frameMs : 99),
      cpuMs: Math.max(0, Number.isFinite(observation.cpuMs) ? observation.cpuMs : 99),
      gpuMs: Math.max(0, Number.isFinite(observation.gpuMs) ? observation.gpuMs : 99),
      memoryPressure: clamp(observation.memoryPressure, 0, 1),
      networkPressure: clamp(observation.networkPressure, 0, 1),
      assetPressure: clamp(observation.assetPressure, 0, 1),
    };
    this.#observations.push(safe);
    while (this.#observations.length > this.windowSize) this.#observations.shift();
    const average = (key: keyof HealthObservation): number => {
      const values = this.#observations.map((item) => item[key]);
      return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
    };
    const framePenalty = clamp((average('frameMs') - 16.67) / 16.67, 0, 1) * 45;
    const cpuPenalty = clamp((average('cpuMs') - 8) / 8, 0, 1) * 15;
    const gpuPenalty = clamp((average('gpuMs') - 8) / 8, 0, 1) * 15;
    const memoryPenalty = average('memoryPressure') * 10;
    const networkPenalty = average('networkPressure') * 8;
    const assetPenalty = average('assetPressure') * 7;
    const score = Math.round(clamp(100 - framePenalty - cpuPenalty - gpuPenalty - memoryPenalty - networkPenalty - assetPenalty, 0, 100));
    const grade = score >= 95 ? 'A' : score >= 85 ? 'B' : score >= 70 ? 'C' : score >= 55 ? 'D' : 'F';
    const recommendations: string[] = [];
    if (framePenalty > 10) recommendations.push('reduce.render.scale');
    if (gpuPenalty > 8) recommendations.push('reduce.post.effects');
    if (memoryPenalty > 5) recommendations.push('evict.streaming.cache');
    if (networkPenalty > 4) recommendations.push('reduce.snapshot.rate');
    if (assetPenalty > 4) recommendations.push('prioritize.visible.assets');
    return Object.freeze({
      score,
      grade,
      frameMs: Number(average('frameMs').toFixed(3)),
      cpuMs: Number(average('cpuMs').toFixed(3)),
      gpuMs: Number(average('gpuMs').toFixed(3)),
      memoryPressure: Number(average('memoryPressure').toFixed(3)),
      networkPressure: Number(average('networkPressure').toFixed(3)),
      assetPressure: Number(average('assetPressure').toFixed(3)),
      recommendations: Object.freeze([...new Set(recommendations)]),
    });
  }

  reset(): void {
    this.#observations = [];
  }
}
