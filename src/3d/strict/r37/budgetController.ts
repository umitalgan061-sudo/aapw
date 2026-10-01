import type { QualityTier, RuntimeBudget, RuntimeMetrics } from './types.ts';
import { clamp, finite } from './math.ts';

export interface BudgetControllerConfig {
  readonly hysteresisFrames: number;
  readonly minimumQualityHoldFrames: number;
  readonly adaptationStep: number;
}

const DEFAULT_CONFIG: BudgetControllerConfig = Object.freeze({
  hysteresisFrames: 10,
  minimumQualityHoldFrames: 30,
  adaptationStep: 1,
});

const QUALITY_ORDER: readonly QualityTier[] = Object.freeze(['minimal', 'low', 'balanced', 'high', 'ultra']);

export interface BudgetDecision {
  readonly quality: QualityTier;
  readonly changed: boolean;
  readonly reason: string;
  readonly pressure: number;
}

export class BudgetControllerR37 {
  readonly config: BudgetControllerConfig;
  #quality: QualityTier;
  #badFrames = 0;
  #goodFrames = 0;
  #holdFrames = 0;

  constructor(initialQuality: QualityTier = 'balanced', config: Partial<BudgetControllerConfig> = {}) {
    this.#quality = initialQuality;
    this.config = Object.freeze({
      ...DEFAULT_CONFIG,
      ...config,
      hysteresisFrames: Math.max(1, Math.trunc(finite(config.hysteresisFrames, DEFAULT_CONFIG.hysteresisFrames))),
      minimumQualityHoldFrames: Math.max(1, Math.trunc(finite(config.minimumQualityHoldFrames, DEFAULT_CONFIG.minimumQualityHoldFrames))),
      adaptationStep: Math.max(1, Math.trunc(finite(config.adaptationStep, DEFAULT_CONFIG.adaptationStep))),
    });
  }

  get quality(): QualityTier {
    return this.#quality;
  }

  observe(metrics: RuntimeMetrics, budget: RuntimeBudget): BudgetDecision {
    const pressure = this.#pressure(metrics, budget);
    this.#holdFrames += 1;
    let changed = false;
    let reason = 'stable';
    if (pressure >= 1) {
      this.#badFrames += 1;
      this.#goodFrames = 0;
      if (this.#badFrames >= this.config.hysteresisFrames && this.#holdFrames >= this.config.minimumQualityHoldFrames) {
        changed = this.#stepDown();
        reason = changed ? 'sustained-budget-pressure' : 'minimum-quality-reached';
        this.#holdFrames = 0;
      }
    } else if (pressure <= 0.7) {
      this.#goodFrames += 1;
      this.#badFrames = 0;
      if (this.#goodFrames >= this.config.hysteresisFrames * 2 && this.#holdFrames >= this.config.minimumQualityHoldFrames) {
        changed = this.#stepUp();
        reason = changed ? 'sustained-budget-headroom' : 'maximum-quality-reached';
        this.#holdFrames = 0;
      }
    } else {
      this.#badFrames = 0;
      this.#goodFrames = 0;
    }
    return Object.freeze({ quality: this.#quality, changed, reason, pressure: Number(pressure.toFixed(4)) });
  }

  force(quality: QualityTier, reason = 'manual'): BudgetDecision {
    const changed = quality !== this.#quality;
    this.#quality = quality;
    this.#badFrames = 0;
    this.#goodFrames = 0;
    this.#holdFrames = 0;
    return Object.freeze({ quality, changed, reason, pressure: 0 });
  }

  #stepDown(): boolean {
    const index = QUALITY_ORDER.indexOf(this.#quality);
    const next = QUALITY_ORDER[Math.max(0, index - this.config.adaptationStep)]!;
    if (next === this.#quality) return false;
    this.#quality = next;
    return true;
  }

  #stepUp(): boolean {
    const index = QUALITY_ORDER.indexOf(this.#quality);
    const next = QUALITY_ORDER[Math.min(QUALITY_ORDER.length - 1, index + this.config.adaptationStep)]!;
    if (next === this.#quality) return false;
    this.#quality = next;
    return true;
  }

  #pressure(metrics: RuntimeMetrics, budget: RuntimeBudget): number {
    const ratios = [
      safeRatio(metrics.frameMs, budget.frameMs),
      safeRatio(metrics.simulationMs, budget.simulationMs),
      safeRatio(metrics.renderMs, budget.renderMs),
      safeRatio(metrics.networkMs, budget.networkMs),
      safeRatio(metrics.assetMs, budget.assetMs),
      safeRatio(metrics.entities, budget.maxEntities),
      safeRatio(metrics.commands, budget.maxCommandsPerTick),
    ];
    return Math.max(...ratios);
  }
}

function safeRatio(value: number, limit: number): number {
  return finite(limit) > 0 ? Math.max(0, finite(value) / limit) : 0;
}

export function defaultRuntimeBudget(quality: QualityTier): RuntimeBudget {
  const multiplier = quality === 'ultra' ? 1.2 : quality === 'high' ? 1.05 : quality === 'balanced' ? 1 : quality === 'low' ? 0.9 : 0.8;
  return Object.freeze({
    frameMs: 16.67,
    simulationMs: 5 * multiplier,
    renderMs: 8 * multiplier,
    networkMs: 2.5,
    assetMs: 3,
    maxEntities: Math.round(1800 * multiplier),
    maxCommandsPerTick: 64,
  });
}
