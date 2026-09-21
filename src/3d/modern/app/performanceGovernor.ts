import { clamp01, type AppBudget, type AppDiagnosticEvent, type AppFramePolicy } from './appTypes.ts';
import { scaleQuality, type AppQualityProfile } from './appConfig.ts';

export type PerformanceBand = 'excellent' | 'healthy' | 'strained' | 'degraded' | 'critical';
export interface PerformanceSample { readonly frameMs: number; readonly cpuMs: number; readonly renderMs: number; readonly gpuMs?: number; readonly memoryMb?: number; readonly timestampMs: number; }
export interface PerformanceDecision { readonly band: PerformanceBand; readonly pressure: number; readonly frameAverageMs: number; readonly cpuAverageMs: number; readonly renderAverageMs: number; readonly memoryAverageMb: number | null; readonly recommendations: readonly string[]; readonly diagnostics: readonly AppDiagnosticEvent[]; }

const bandFor = (ratio: number): PerformanceBand => ratio <= 0.85 ? 'excellent' : ratio <= 1.05 ? 'healthy' : ratio <= 1.25 ? 'strained' : ratio <= 1.6 ? 'degraded' : 'critical';

export class PerformanceGovernor {
  readonly #policy: AppFramePolicy;
  readonly #capacity: number;
  readonly #samples: PerformanceSample[] = [];
  #decision: PerformanceDecision = Object.freeze({ band: 'healthy', pressure: 0, frameAverageMs: 0, cpuAverageMs: 0, renderAverageMs: 0, memoryAverageMb: null, recommendations: [], diagnostics: [] });

  constructor(policy: AppFramePolicy, capacity = 120) { this.#policy = Object.freeze({ ...policy }); this.#capacity = Math.max(30, Math.min(600, Math.floor(capacity))); }
  push(sample: PerformanceSample): PerformanceDecision {
    this.#samples.push(Object.freeze({ frameMs: Math.max(0, Number.isFinite(sample.frameMs) ? sample.frameMs : 0), cpuMs: Math.max(0, Number.isFinite(sample.cpuMs) ? sample.cpuMs : 0), renderMs: Math.max(0, Number.isFinite(sample.renderMs) ? sample.renderMs : 0), ...(sample.gpuMs === undefined ? {} : { gpuMs: Math.max(0, sample.gpuMs) }), ...(sample.memoryMb === undefined ? {} : { memoryMb: Math.max(0, sample.memoryMb) }), timestampMs: sample.timestampMs }));
    while (this.#samples.length > this.#capacity) this.#samples.shift();
    this.#decision = this.#calculate();
    return this.#decision;
  }
  current(): PerformanceDecision { return this.#decision; }
  samples(): readonly PerformanceSample[] { return Object.freeze([...this.#samples]); }
  reset(): void { this.#samples.length = 0; this.#decision = Object.freeze({ band: 'healthy', pressure: 0, frameAverageMs: 0, cpuAverageMs: 0, renderAverageMs: 0, memoryAverageMb: null, recommendations: [], diagnostics: [] }); }

  recommendedBudget(base: AppBudget): AppBudget {
    const p = this.#decision.pressure;
    return Object.freeze({ cpuMs: Math.max(4, base.cpuMs * Math.max(0.55, 1 - p * 0.35)), renderMs: Math.max(3, base.renderMs * Math.max(0.5, 1 - p * 0.45)), streamingMs: Math.max(0.5, base.streamingMs * Math.max(0.65, 1 - p * 0.2)), networkMs: base.networkMs, memoryMb: Math.max(384, base.memoryMb * Math.max(0.65, 1 - p * 0.25)), entities: Math.max(500, Math.floor(base.entities * Math.max(0.45, 1 - p * 0.55))), commands: base.commands });
  }
  recommendedQuality(base: AppQualityProfile): AppQualityProfile { return scaleQuality(base, this.#decision.pressure); }

  #calculate(): PerformanceDecision {
    if (this.#samples.length < 5) return this.#decision;
    const frame = this.#avg('frameMs');
    const cpu = this.#avg('cpuMs');
    const render = this.#avg('renderMs');
    const memory = this.#optionalAvg('memoryMb');
    const frameRatio = frame / Math.max(1, this.#policy.targetFrameMs);
    const cpuRatio = cpu / Math.max(1, this.#policy.targetFrameMs * 0.55);
    const renderRatio = render / Math.max(1, this.#policy.targetFrameMs * 0.7);
    const memoryRatio = memory === null ? 0 : memory / 1400;
    const pressure = clamp01(Math.max(0, (frameRatio - 0.85) / 0.75, (cpuRatio - 0.9) / 0.8, (renderRatio - 0.9) / 0.8, (memoryRatio - 0.8) / 0.9));
    const diagnostics: AppDiagnosticEvent[] = [];
    const recommendations: string[] = [];
    if (frameRatio > 1.05) {
      recommendations.push('Lower dynamic resolution before reducing simulation fidelity.');
      diagnostics.push(Object.freeze({ code: 'FRAME_PRESSURE', subsystem: 'render', severity: frameRatio > 1.6 ? 'critical' : 'warning', message: 'Rolling frame time exceeds target.', frame: 0, tick: 0, value: Number(frame.toFixed(3)), limit: this.#policy.targetFrameMs }));
    }
    if (cpuRatio > 1.05) recommendations.push('Defer background services and reduce AI cadence.');
    if (renderRatio > 1.05) recommendations.push('Reduce shadow, vegetation and particle budgets.');
    if (memoryRatio > 0.9) {
      recommendations.push('Evict cold assets and shorten retained snapshot history.');
      diagnostics.push(Object.freeze({ code: 'MEMORY_PRESSURE', subsystem: 'streaming', severity: memoryRatio > 1.2 ? 'critical' : 'warning', message: 'Memory residency is above the healthy operating range.', frame: 0, tick: 0, value: Number(memory?.toFixed(1) ?? 0), limit: 1400 }));
    }
    return Object.freeze({ band: bandFor(frameRatio), pressure: Number(pressure.toFixed(4)), frameAverageMs: Number(frame.toFixed(3)), cpuAverageMs: Number(cpu.toFixed(3)), renderAverageMs: Number(render.toFixed(3)), memoryAverageMb: memory === null ? null : Number(memory.toFixed(1)), recommendations: Object.freeze([...new Set(recommendations)]), diagnostics: Object.freeze(diagnostics) });
  }
  #avg(key: 'frameMs' | 'cpuMs' | 'renderMs'): number { return this.#samples.reduce((sum, sample) => sum + sample[key], 0) / Math.max(1, this.#samples.length); }
  #optionalAvg(key: 'gpuMs' | 'memoryMb'): number | null { const values = this.#samples.map((sample) => sample[key]).filter((value): value is number => value !== undefined); return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null; }
}
