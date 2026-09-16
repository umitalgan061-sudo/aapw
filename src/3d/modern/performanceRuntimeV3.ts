/**
 * Adaptive performance governance for AAPW v3.
 *
 * Budgets are treated as runtime contracts rather than advisory numbers. The controller observes
 * frame and simulation cost, applies hysteresis to avoid oscillation, and emits an immutable quality
 * decision that render/streaming systems can consume without knowing how the decision was made.
 */

export type PerformanceTier = 'ultra' | 'high' | 'balanced' | 'performance' | 'battery';
export type QualityDirection = 'up' | 'down' | 'hold';

export interface PerformanceBudgetV3 {
  readonly frameMs: number;
  readonly simulationMs: number;
  readonly renderMs: number;
  readonly streamingMs: number;
  readonly memoryMb: number;
  readonly gpuPressure: number;
}

export interface PerformanceSampleV3 {
  readonly frameMs: number;
  readonly simulationMs: number;
  readonly renderMs: number;
  readonly streamingMs: number;
  readonly memoryMb: number;
  readonly gpuPressure: number;
  readonly visibleEntities: number;
  readonly loadedChunks: number;
}

export interface QualityDecisionV3 {
  readonly tier: PerformanceTier;
  readonly direction: QualityDirection;
  readonly scale: number;
  readonly reason: string;
  readonly violationCount: number;
  readonly recoveryCount: number;
  readonly sampleCount: number;
}

export interface PerformanceMetricsV3 {
  sampleCount: number;
  violationFrames: number;
  recoveryFrames: number;
  downgrades: number;
  upgrades: number;
  worstFrameMs: number;
  worstMemoryMb: number;
}

export const DEFAULT_BUDGETS_V3: Record<PerformanceTier, PerformanceBudgetV3> = {
  ultra: { frameMs: 12.5, simulationMs: 4, renderMs: 7.5, streamingMs: 2.5, memoryMb: 1536, gpuPressure: 0.9 },
  high: { frameMs: 16.7, simulationMs: 5, renderMs: 10.5, streamingMs: 3, memoryMb: 1024, gpuPressure: 0.82 },
  balanced: { frameMs: 20, simulationMs: 6, renderMs: 12.5, streamingMs: 4, memoryMb: 768, gpuPressure: 0.74 },
  performance: { frameMs: 25, simulationMs: 7, renderMs: 16, streamingMs: 5, memoryMb: 512, gpuPressure: 0.66 },
  battery: { frameMs: 33.3, simulationMs: 8, renderMs: 22, streamingMs: 4, memoryMb: 384, gpuPressure: 0.58 },
};

const orderedTiers: readonly PerformanceTier[] = ['battery', 'performance', 'balanced', 'high', 'ultra'];
const tierScale: Record<PerformanceTier, number> = {
  battery: 0.65,
  performance: 0.8,
  balanced: 1,
  high: 1.15,
  ultra: 1.3,
};

const finiteNonNegative = (value: number): boolean => Number.isFinite(value) && value >= 0;
const ratio = (value: number, budget: number): number => budget > 0 ? value / budget : Number.POSITIVE_INFINITY;

export class PerformanceGovernorV3 {
  #tier: PerformanceTier;
  #budgets: Readonly<Record<PerformanceTier, PerformanceBudgetV3>>;
  #violationStreak = 0;
  #recoveryStreak = 0;
  #sampleCount = 0;
  #metrics: PerformanceMetricsV3 = {
    sampleCount: 0,
    violationFrames: 0,
    recoveryFrames: 0,
    downgrades: 0,
    upgrades: 0,
    worstFrameMs: 0,
    worstMemoryMb: 0,
  };

  constructor(initialTier: PerformanceTier = 'balanced', budgets: Partial<Record<PerformanceTier, PerformanceBudgetV3>> = {}) {
    this.#tier = initialTier;
    this.#budgets = {
      ...DEFAULT_BUDGETS_V3,
      ...budgets,
    };
  }

  get tier(): PerformanceTier { return this.#tier; }

  budget(): PerformanceBudgetV3 { return { ...this.#budgets[this.#tier] }; }

  metrics(): PerformanceMetricsV3 { return { ...this.#metrics }; }

  sample(sample: PerformanceSampleV3): QualityDecisionV3 {
    this.#validateSample(sample);
    this.#sampleCount += 1;
    this.#metrics.sampleCount = this.#sampleCount;
    this.#metrics.worstFrameMs = Math.max(this.#metrics.worstFrameMs, sample.frameMs);
    this.#metrics.worstMemoryMb = Math.max(this.#metrics.worstMemoryMb, sample.memoryMb);
    const budget = this.#budgets[this.#tier];
    const stress = Math.max(
      ratio(sample.frameMs, budget.frameMs),
      ratio(sample.simulationMs, budget.simulationMs),
      ratio(sample.renderMs, budget.renderMs),
      ratio(sample.streamingMs, budget.streamingMs),
      ratio(sample.memoryMb, budget.memoryMb),
      ratio(sample.gpuPressure, budget.gpuPressure),
    );
    const violation = stress > 1.05;
    const recovery = stress < 0.78;
    if (violation) {
      this.#violationStreak += 1;
      this.#recoveryStreak = 0;
      this.#metrics.violationFrames += 1;
    } else if (recovery) {
      this.#recoveryStreak += 1;
      this.#violationStreak = 0;
      this.#metrics.recoveryFrames += 1;
    } else {
      this.#violationStreak = Math.max(0, this.#violationStreak - 1);
      this.#recoveryStreak = Math.max(0, this.#recoveryStreak - 1);
    }

    if (this.#violationStreak >= 3) return this.#changeTier(-1, `sustained-stress:${stress.toFixed(2)}`);
    if (this.#recoveryStreak >= 12) return this.#changeTier(1, `sustained-headroom:${stress.toFixed(2)}`);
    return Object.freeze({
      tier: this.#tier,
      direction: 'hold',
      scale: tierScale[this.#tier],
      reason: violation ? `stress-observed:${stress.toFixed(2)}` : `stable:${stress.toFixed(2)}`,
      violationCount: this.#violationStreak,
      recoveryCount: this.#recoveryStreak,
      sampleCount: this.#sampleCount,
    });
  }

  forceTier(tier: PerformanceTier, reason = 'manual'): QualityDecisionV3 {
    const current = orderedTiers.indexOf(this.#tier);
    const next = orderedTiers.indexOf(tier);
    const direction: QualityDirection = next > current ? 'up' : next < current ? 'down' : 'hold';
    this.#tier = tier;
    this.#violationStreak = 0;
    this.#recoveryStreak = 0;
    return Object.freeze({
      tier,
      direction,
      scale: tierScale[tier],
      reason,
      violationCount: 0,
      recoveryCount: 0,
      sampleCount: this.#sampleCount,
    });
  }

  #changeTier(delta: -1 | 1, reason: string): QualityDecisionV3 {
    const index = orderedTiers.indexOf(this.#tier);
    const target = orderedTiers[Math.min(orderedTiers.length - 1, Math.max(0, index + delta))] ?? this.#tier;
    const changed = target !== this.#tier;
    if (changed) {
      if (delta < 0) this.#metrics.downgrades += 1;
      else this.#metrics.upgrades += 1;
      this.#tier = target;
    }
    this.#violationStreak = 0;
    this.#recoveryStreak = 0;
    return Object.freeze({
      tier: this.#tier,
      direction: changed ? (delta < 0 ? 'down' : 'up') : 'hold',
      scale: tierScale[this.#tier],
      reason,
      violationCount: 0,
      recoveryCount: 0,
      sampleCount: this.#sampleCount,
    });
  }

  #validateSample(sample: PerformanceSampleV3): void {
    const fields: readonly (keyof PerformanceSampleV3)[] = [
      'frameMs', 'simulationMs', 'renderMs', 'streamingMs', 'memoryMb', 'gpuPressure', 'visibleEntities', 'loadedChunks',
    ];
    for (const field of fields) {
      const value = sample[field];
      if (!finiteNonNegative(value)) throw new RangeError(`Invalid performance sample field: ${String(field)}`);
    }
    if (sample.gpuPressure > 1) throw new RangeError('gpuPressure must be in [0, 1]');
  }
}

export interface FrameBudgetTaskV3 {
  readonly name: string;
  readonly costMs: number;
  readonly priority: number;
  readonly mandatory?: boolean;
}

export interface FrameBudgetPlanV3 {
  readonly budgetMs: number;
  readonly admitted: readonly string[];
  readonly deferred: readonly string[];
  readonly usedMs: number;
}

export class FrameBudgetPlannerV3 {
  plan(tasks: Iterable<FrameBudgetTaskV3>, budgetMs: number): FrameBudgetPlanV3 {
    if (!finiteNonNegative(budgetMs)) throw new RangeError('budgetMs must be finite and non-negative');
    const ordered = [...tasks]
      .filter((task) => finiteNonNegative(task.costMs) && Number.isFinite(task.priority))
      .sort((a, b) => Number(Boolean(b.mandatory)) - Number(Boolean(a.mandatory)) || b.priority - a.priority || a.name.localeCompare(b.name));
    const admitted: string[] = [];
    const deferred: string[] = [];
    let usedMs = 0;
    for (const task of ordered) {
      const canFit = usedMs + task.costMs <= budgetMs;
      if (canFit || task.mandatory) {
        admitted.push(task.name);
        usedMs += task.costMs;
      } else {
        deferred.push(task.name);
      }
    }
    return Object.freeze({ budgetMs, admitted: Object.freeze(admitted), deferred: Object.freeze(deferred), usedMs });
  }
}

export const createPerformanceGovernorV3 = (tier: PerformanceTier = 'balanced'): PerformanceGovernorV3 =>
  new PerformanceGovernorV3(tier);
