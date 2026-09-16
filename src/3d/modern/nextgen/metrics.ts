import { RuntimeHealth, RuntimeMetrics, Tick, clamp, hashString, stableStringify, tickValue } from './types.ts';

interface Sample { tick: Tick; metrics: RuntimeMetrics; }

export interface MetricWindowConfig {
  capacity: number;
  warnFrameMs: number;
  criticalFrameMs: number;
  warnSimulationMs: number;
  criticalSimulationMs: number;
}

const DEFAULT_CONFIG: MetricWindowConfig = {
  capacity: 120,
  warnFrameMs: 20,
  criticalFrameMs: 33,
  warnSimulationMs: 8,
  criticalSimulationMs: 16,
};

export class RuntimeMetricWindow {
  readonly #config: MetricWindowConfig;
  readonly #samples: Sample[] = [];

  constructor(config: Partial<MetricWindowConfig> = {}) {
    this.#config = { ...DEFAULT_CONFIG, ...config };
  }

  record(tick: Tick, metrics: RuntimeMetrics): void {
    this.#samples.push({ tick, metrics: { ...metrics } });
    while (this.#samples.length > this.#config.capacity) this.#samples.shift();
  }

  latest(): Sample | undefined { return this.#samples.at(-1); }
  samples(): Sample[] { return this.#samples.map((sample) => ({ tick: sample.tick, metrics: { ...sample.metrics } })); }

  averages(): RuntimeMetrics {
    if (!this.#samples.length) return emptyMetrics();
    const total = emptyMetrics();
    for (const sample of this.#samples) {
      total.frameTimeMs += sample.metrics.frameTimeMs;
      total.simulationTimeMs += sample.metrics.simulationTimeMs;
      total.renderTimeMs += sample.metrics.renderTimeMs;
      total.networkTimeMs += sample.metrics.networkTimeMs;
      total.entityCount += sample.metrics.entityCount;
      total.activeSystems += sample.metrics.activeSystems;
      total.pendingCommands += sample.metrics.pendingCommands;
      total.pendingResources += sample.metrics.pendingResources;
      total.snapshotBytes += sample.metrics.snapshotBytes;
    }
    const divisor = this.#samples.length;
    return {
      frameTimeMs: total.frameTimeMs / divisor,
      simulationTimeMs: total.simulationTimeMs / divisor,
      renderTimeMs: total.renderTimeMs / divisor,
      networkTimeMs: total.networkTimeMs / divisor,
      entityCount: total.entityCount / divisor,
      activeSystems: total.activeSystems / divisor,
      pendingCommands: total.pendingCommands / divisor,
      pendingResources: total.pendingResources / divisor,
      snapshotBytes: total.snapshotBytes / divisor,
    };
  }

  health(): RuntimeHealth {
    const metrics = this.averages();
    let score = 100;
    const reasons: string[] = [];
    if (metrics.frameTimeMs > this.#config.criticalFrameMs) { score -= 35; reasons.push('critical_frame_time'); }
    else if (metrics.frameTimeMs > this.#config.warnFrameMs) { score -= 12; reasons.push('frame_time_pressure'); }
    if (metrics.simulationTimeMs > this.#config.criticalSimulationMs) { score -= 30; reasons.push('critical_simulation_time'); }
    else if (metrics.simulationTimeMs > this.#config.warnSimulationMs) { score -= 12; reasons.push('simulation_time_pressure'); }
    if (metrics.pendingCommands > 512) { score -= 15; reasons.push('command_backlog'); }
    if (metrics.pendingResources > 128) { score -= 10; reasons.push('resource_backlog'); }
    score = clamp(score, 0, 100);
    return { score, status: score >= 80 ? 'healthy' : score >= 55 ? 'degraded' : 'critical', reasons, metrics };
  }

  percentile(metric: keyof RuntimeMetrics, quantile: number): number {
    if (!this.#samples.length) return 0;
    const values = this.#samples.map((sample) => Number(sample.metrics[metric])).sort((a, b) => a - b);
    const q = clamp(quantile, 0, 1);
    const index = (values.length - 1) * q;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    return values[lower] + (values[upper] - values[lower]) * (index - lower);
  }

  digest(): number {
    return hashString(stableStringify(this.#samples.map((sample) => ({ tick: sample.tick, metrics: sample.metrics }))));
  }

  clear(): void { this.#samples.length = 0; }
}

export function emptyMetrics(): RuntimeMetrics {
  return {
    frameTimeMs: 0,
    simulationTimeMs: 0,
    renderTimeMs: 0,
    networkTimeMs: 0,
    entityCount: 0,
    activeSystems: 0,
    pendingCommands: 0,
    pendingResources: 0,
    snapshotBytes: 0,
  };
}

export function tickSeries(start: Tick, count: number): Tick[] {
  if (!Number.isInteger(count) || count < 0) throw new RangeError('count must be non-negative');
  return Array.from({ length: count }, (_, index) => tickValue(Number(start) + index));
}
