import type { FrameBudget, MetricSample, QualityState, Tick } from './types';
import { clamp, RollingWindow } from './deterministic';

export interface PerformanceSample { readonly frameMs: number; readonly cpuMs: number; readonly gpuMs: number; readonly drawCalls: number; readonly triangles: number; readonly memoryBytes: number; }
export interface PerformanceLimits extends FrameBudget { readonly sampleWindow: number; readonly sustainedFrames: number; }
export interface PerformanceState { readonly pressure: number; readonly fps: number; readonly stable: boolean; readonly qualityCeiling: QualityState['tier']; readonly sampleCount: number; }

export class PerformanceGovernor {
  readonly limits: PerformanceLimits;
  #frame = new RollingWindow(120);
  #gpu = new RollingWindow(120);
  #cpu = new RollingWindow(120);
  #pressure = new RollingWindow(120);
  #badStreak = 0;
  #goodStreak = 0;
  constructor(limits: Partial<PerformanceLimits> = {}) {
    this.limits = Object.freeze({ frameMs: 16.67, cpuMs: 10, gpuMs: 14, drawCalls: 12000, triangles: 8000000, memoryBytes: 536870912, sampleWindow: 120, sustainedFrames: 8, ...limits });
    this.#frame = new RollingWindow(this.limits.sampleWindow);
    this.#gpu = new RollingWindow(this.limits.sampleWindow);
    this.#cpu = new RollingWindow(this.limits.sampleWindow);
    this.#pressure = new RollingWindow(this.limits.sampleWindow);
  }
  record(sample: PerformanceSample): void {
    const normalized = this.pressure(sample);
    this.#frame.add(sample.frameMs); this.#cpu.add(sample.cpuMs); this.#gpu.add(sample.gpuMs); this.#pressure.add(normalized);
    if (normalized > 1.05) { this.#badStreak += 1; this.#goodStreak = 0; }
    else if (normalized < 0.72) { this.#goodStreak += 1; this.#badStreak = 0; }
    else { this.#badStreak = 0; this.#goodStreak = 0; }
  }
  pressure(sample: PerformanceSample): number {
    return Math.max(sample.frameMs / this.limits.frameMs, sample.cpuMs / this.limits.cpuMs, sample.gpuMs / this.limits.gpuMs, sample.drawCalls / this.limits.drawCalls, sample.triangles / this.limits.triangles, sample.memoryBytes / this.limits.memoryBytes);
  }
  state(maxQuality: QualityState['tier'] = 4): PerformanceState {
    const average = this.#pressure.average();
    const fps = this.#frame.average() > 0 ? 1000 / this.#frame.average() : 0;
    return Object.freeze({ pressure: average, fps, stable: this.#badStreak === 0 && this.#goodStreak === 0, qualityCeiling: this.#badStreak >= this.limits.sustainedFrames ? Math.max(0, maxQuality - 1) as QualityState['tier'] : maxQuality, sampleCount: this.#frame.snapshot().length });
  }
  metric(tick: Tick): MetricSample { return Object.freeze({ name: 'r40.performance.pressure', value: this.#pressure.average(), unit: 'ratio', tick, phase: 'telemetry', tags: {} }); }
  reset(): void { this.#frame.clear(); this.#cpu.clear(); this.#gpu.clear(); this.#pressure.clear(); this.#badStreak = 0; this.#goodStreak = 0; }
}

export function frameBudgetFromFps(fps: number): number { return 1000 / Math.max(1, clamp(fps, 15, 240)); }
