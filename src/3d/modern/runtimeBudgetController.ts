import type { PressureState, QualityTier } from './types';
import { clamp01, quantize } from './deterministic';
import type { RuntimeBudgets, RuntimeLimits, RuntimeProfile } from './runtimeConfig';

export interface RuntimeBudgetDecision {
  readonly budgets: RuntimeBudgets;
  readonly limits: RuntimeLimits;
  readonly quality: QualityTier;
  readonly pressure: number;
  readonly scale: number;
  readonly reason: readonly string[];
}

function scaleBudgets(budgets: RuntimeBudgets, scale: number): RuntimeBudgets {
  return Object.freeze({
    frameTargetMs: budgets.frameTargetMs,
    simulationMs: budgets.simulationMs * scale,
    renderingMs: budgets.renderingMs * scale,
    streamingMs: budgets.streamingMs * scale,
    animationMs: budgets.animationMs * scale,
    maxTasksPerFrame: Math.max(1, Math.floor(budgets.maxTasksPerFrame * Math.max(0.4, scale))),
  });
}

function scaleLimits(limits: RuntimeLimits, scale: number): RuntimeLimits {
  const objectScale = Math.max(0.35, scale);
  return Object.freeze({
    maxEntities: Math.max(256, Math.floor(limits.maxEntities * objectScale)),
    maxDrawItems: Math.max(128, Math.floor(limits.maxDrawItems * objectScale)),
    maxStreamLoadsPerFrame: Math.max(1, Math.floor(limits.maxStreamLoadsPerFrame * objectScale)),
    maxStreamUnloadsPerFrame: Math.max(1, Math.floor(limits.maxStreamUnloadsPerFrame * objectScale)),
    maxResourceBytes: Math.max(16 * 1024 * 1024, Math.floor(limits.maxResourceBytes * objectScale)),
    maxTelemetrySamples: limits.maxTelemetrySamples,
    maxReplayActions: limits.maxReplayActions,
    maxDiagnostics: limits.maxDiagnostics,
  });
}

/** Converts pressure into a single coherent budget envelope for simulation, render and streaming. */
export class RuntimeBudgetController {
  readonly profile: RuntimeProfile;
  #lastScale = 1;

  constructor(profile: RuntimeProfile) {
    this.profile = profile;
  }

  decide(pressureState: PressureState, quality: QualityTier): RuntimeBudgetDecision {
    const pressure = clamp01(pressureState.combined);
    let scale = pressure >= 0.9 ? 0.45 : pressure >= 0.75 ? 0.62 : pressure >= 0.55 ? 0.78 : 1;
    scale = quantize(scale * 0.7 + this.#lastScale * 0.3, 0.01);
    if (Math.abs(scale - this.#lastScale) < 0.03) scale = this.#lastScale;
    this.#lastScale = scale;
    const reason: string[] = [];
    if (pressure >= 0.55) reason.push('pressure');
    if (pressureState.memory >= 0.8) reason.push('memory');
    if (pressureState.thermal >= 0.75) reason.push('thermal');
    return Object.freeze({
      budgets: scaleBudgets(this.profile.budgets, scale),
      limits: scaleLimits(this.profile.limits, scale),
      quality,
      pressure,
      scale,
      reason: Object.freeze(reason),
    });
  }

  reset(): void { this.#lastScale = 1; }
}

export function budgetSummary(decision: RuntimeBudgetDecision): Readonly<Record<string, number>> {
  return Object.freeze({
    scale: decision.scale,
    pressure: decision.pressure,
    simulationMs: decision.budgets.simulationMs,
    renderingMs: decision.budgets.renderingMs,
    streamingMs: decision.budgets.streamingMs,
    animationMs: decision.budgets.animationMs,
    maxEntities: decision.limits.maxEntities,
    maxDrawItems: decision.limits.maxDrawItems,
  });
}
