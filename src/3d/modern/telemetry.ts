import type { PerformanceSample, PressureState, QualityTier } from './types';
import { clamp01, quantize } from './deterministic';

export interface TelemetryOptions {
  readonly maxSamples?: number;
  readonly now?: () => number;
}

export class RollingTelemetry {
  #samples: PerformanceSample[] = [];
  #maxSamples: number;
  #now: () => number;

  constructor(options: TelemetryOptions = {}) {
    this.#maxSamples = Math.max(32, Math.floor(options.maxSamples ?? 360));
    this.#now = options.now ?? (() => Date.now());
  }

  push(sample: Omit<PerformanceSample, 'timestamp'> & { readonly timestamp?: PerformanceSample['timestamp'] }): void {
    const next = { ...sample, timestamp: sample.timestamp ?? (this.#now() as PerformanceSample['timestamp']) };
    this.#samples.push(next);
    if (this.#samples.length > this.#maxSamples) this.#samples.splice(0, this.#samples.length - this.#maxSamples);
  }

  samples(): readonly PerformanceSample[] {
    return this.#samples.map((sample) => ({ ...sample }));
  }

  count(): number { return this.#samples.length; }

  percentile(field: keyof Pick<PerformanceSample, 'frameMs' | 'cpuMs' | 'gpuMs' | 'drawCalls' | 'triangles'>, percentile: number): number {
    if (this.#samples.length === 0) return 0;
    const values = this.#samples.map((sample) => Number(sample[field] ?? 0)).sort((a, b) => a - b);
    const p = clamp01(percentile);
    const index = (values.length - 1) * p;
    const lo = Math.floor(index);
    const hi = Math.ceil(index);
    if (lo === hi) return values[lo] ?? 0;
    return (values[lo] ?? 0) + ((values[hi] ?? 0) - (values[lo] ?? 0)) * (index - lo);
  }

  summary(): Readonly<Record<string, number>> {
    return {
      count: this.count(),
      frameP50: quantize(this.percentile('frameMs', 0.5), 0.01),
      frameP95: quantize(this.percentile('frameMs', 0.95), 0.01),
      frameP99: quantize(this.percentile('frameMs', 0.99), 0.01),
      cpuP95: quantize(this.percentile('cpuMs', 0.95), 0.01),
      gpuP95: quantize(this.percentile('gpuMs', 0.95), 0.01),
      drawP95: quantize(this.percentile('drawCalls', 0.95), 1),
      trianglesP95: quantize(this.percentile('triangles', 0.95), 1),
    };
  }

  clear(): void { this.#samples = []; }
}

export function calculatePressure(sample: Pick<PerformanceSample, 'frameMs' | 'cpuMs' | 'gpuMs' | 'memoryPressure' | 'thermalPressure'>, targetFrameMs = 16.6667): PressureState {
  const frame = clamp01(sample.frameMs / targetFrameMs - 0.65);
  const cpu = clamp01(sample.cpuMs / Math.max(1, targetFrameMs) - 0.55);
  const gpu = clamp01((sample.gpuMs ?? sample.frameMs) / Math.max(1, targetFrameMs) - 0.55);
  const memory = clamp01(sample.memoryPressure);
  const thermal = clamp01(sample.thermalPressure);
  const combined = clamp01(cpu * 0.22 + gpu * 0.34 + frame * 0.24 + memory * 0.12 + thermal * 0.08);
  return { cpu, gpu, frame, memory, thermal, combined };
}

const TIER_ORDER: readonly QualityTier[] = ['minimal', 'balanced', 'high', 'ultra'];

export function degradeQuality(current: QualityTier, pressure: number): QualityTier {
  const p = clamp01(pressure);
  if (p >= 0.85) return TIER_ORDER[Math.max(0, TIER_ORDER.indexOf(current) - 2)] ?? 'minimal';
  if (p >= 0.62) return TIER_ORDER[Math.max(0, TIER_ORDER.indexOf(current) - 1)] ?? 'minimal';
  return current;
}

export function recoverQuality(current: QualityTier, pressure: number): QualityTier {
  const p = clamp01(pressure);
  if (p > 0.18) return current;
  const index = TIER_ORDER.indexOf(current);
  return TIER_ORDER[Math.min(TIER_ORDER.length - 1, index + 1)] ?? 'ultra';
}
