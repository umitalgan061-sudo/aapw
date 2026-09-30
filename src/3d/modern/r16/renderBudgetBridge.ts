import { digestValue, clamp01 } from './deterministic.js';
import type { R16PerformanceDecision, R16PerformanceSignal } from './performanceGovernor.js';

export interface R16RenderBudgetInput {
  readonly frameMs: number;
  readonly cpuMs: number;
  readonly gpuMs: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly textureBytes: number;
  readonly memoryLimitBytes: number;
  readonly effectMs: number;
}
export interface R16RenderBudgetDecision {
  readonly visibleCap: number;
  readonly instanceCap: number;
  readonly effectCap: number;
  readonly textureBudgetBytes: number;
  readonly renderScale: number;
  readonly skipTemporalHistory: boolean;
  readonly pressure: number;
  readonly digest: string;
}

export class R16RenderBudgetBridge {
  evaluate(
    input: R16RenderBudgetInput,
    performance: R16PerformanceDecision,
  ): R16RenderBudgetDecision {
    const memoryPressure =
      input.memoryLimitBytes > 0
        ? clamp01(input.textureBytes / input.memoryLimitBytes)
        : 1;
    const pressure = clamp01(
      Math.max(
        input.frameMs / 16.6667,
        input.cpuMs / 12,
        input.gpuMs / 12,
        input.drawCalls / 4000,
        input.triangles / 2_000_000,
        memoryPressure,
        input.effectMs / 8,
      ),
    );
    const tierMultiplier =
      performance.tier === 'minimal'
        ? 0.45
        : performance.tier === 'balanced'
          ? 0.7
          : performance.tier === 'quality'
            ? 0.88
            : 1;
    const visibleCap = Math.max(128, Math.floor(4096 * tierMultiplier));
    const instanceCap = Math.max(64, Math.floor(8192 * tierMultiplier));
    const effectCap = performance.tier === 'minimal' ? 3 : performance.tier === 'balanced' ? 5 : performance.tier === 'quality' ? 7 : 9;
    const textureBudgetBytes = Math.max(
      16 * 1024 * 1024,
      Math.floor((performance.tier === 'ultra' ? 256 : performance.tier === 'quality' ? 192 : performance.tier === 'balanced' ? 128 : 64) * 1024 * 1024 * (1 - pressure * 0.25)),
    );
    const decision = {
      visibleCap,
      instanceCap,
      effectCap,
      textureBudgetBytes,
      renderScale: performance.renderScale,
      skipTemporalHistory: pressure > 0.95,
      pressure,
    };
    return Object.freeze({
      ...decision,
      digest: digestValue(decision),
    });
  }

  signalFromFrame(input: R16RenderBudgetInput): R16PerformanceSignal {
    const memoryPressure =
      input.memoryLimitBytes > 0
        ? clamp01(input.textureBytes / input.memoryLimitBytes)
        : 1;
    return Object.freeze({
      frameMs: Math.max(0, Number.isFinite(input.frameMs) ? input.frameMs : 0),
      cpuMs: Math.max(0, Number.isFinite(input.cpuMs) ? input.cpuMs : 0),
      gpuMs: Math.max(0, Number.isFinite(input.gpuMs) ? input.gpuMs : 0),
      memoryPressure,
      networkPressure: 0,
      simulationPressure: clamp01(input.effectMs / 8),
    });
  }
}
