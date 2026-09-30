import { clampR29, R29_DEFAULT_BUDGET, type R29BudgetPressure, type R29BudgetUsage, type R29QualityDecision, type R29QualityTier, type R29RenderObservation, type R29RuntimeBudget } from './contracts.ts';

const TIER_SCORE: Readonly<Record<R29QualityTier, number>> = Object.freeze({
  safe: 0,
  low: 1,
  medium: 2,
  high: 3,
  ultra: 4,
});

const SCORE_TIER: readonly R29QualityTier[] = Object.freeze(['safe', 'low', 'medium', 'high', 'ultra']);

export interface R29BudgetDirectorOptions {
  readonly budget?: Partial<R29RuntimeBudget>;
  readonly initialTier?: R29QualityTier;
  readonly minTier?: R29QualityTier;
  readonly maxTier?: R29QualityTier;
  readonly recoveryFrames?: number;
  readonly degradeFrames?: number;
}

export interface R29BudgetSnapshot {
  readonly budget: R29RuntimeBudget;
  readonly usage: R29BudgetUsage;
  readonly pressure: R29BudgetPressure;
  readonly quality: R29QualityDecision;
  readonly overloadFrames: number;
  readonly healthyFrames: number;
}

export class R29BudgetDirector {
  readonly budget: R29RuntimeBudget;
  readonly minTier: R29QualityTier;
  readonly maxTier: R29QualityTier;
  readonly recoveryFrames: number;
  readonly degradeFrames: number;

  #tier: R29QualityTier;
  #overloadFrames = 0;
  #healthyFrames = 0;
  #lastPressure: R29BudgetPressure = Object.freeze(this.#zeroPressure());
  #lastUsage: R29BudgetUsage = Object.freeze(this.#zeroUsage());
  #lastDecision: R29QualityDecision;

  constructor(options: R29BudgetDirectorOptions = {}) {
    this.budget = Object.freeze({
      ...R29_DEFAULT_BUDGET,
      ...sanitizeBudget(options.budget ?? {}),
    });
    this.minTier = options.minTier ?? 'safe';
    this.maxTier = options.maxTier ?? 'ultra';
    this.recoveryFrames = clampR29(Math.floor(options.recoveryFrames ?? 45), 4, 600);
    this.degradeFrames = clampR29(Math.floor(options.degradeFrames ?? 6), 2, 120);
    this.#tier = this.#clampTier(options.initialTier ?? 'high');
    this.#lastDecision = this.#buildDecision('initial');
  }

  observe(usage: Partial<R29BudgetUsage>, observation?: Partial<R29RenderObservation>): R29BudgetSnapshot {
    const normalized = Object.freeze({
      ...this.#zeroUsage(),
      ...sanitizeUsage(usage),
    });
    const pressure = this.#calculatePressure(normalized);
    this.#lastUsage = normalized;
    this.#lastPressure = pressure;

    const overloaded = pressure.aggregate >= 1 || (observation?.frameMs ?? 0) > this.budget.targetFrameMs * 1.2;
    const comfortable = pressure.aggregate < 0.72 && (observation?.frameMs ?? 0) < this.budget.targetFrameMs * 0.9;

    if (overloaded) {
      this.#overloadFrames += 1;
      this.#healthyFrames = 0;
    } else if (comfortable) {
      this.#healthyFrames += 1;
      this.#overloadFrames = Math.max(0, this.#overloadFrames - 1);
    } else {
      this.#overloadFrames = Math.max(0, this.#overloadFrames - 1);
      this.#healthyFrames = Math.max(0, this.#healthyFrames - 1);
    }

    if (this.#overloadFrames >= this.degradeFrames) {
      this.#moveTier(-1);
      this.#overloadFrames = 0;
      this.#healthyFrames = 0;
      this.#lastDecision = this.#buildDecision('sustained-pressure');
    } else if (this.#healthyFrames >= this.recoveryFrames) {
      this.#moveTier(1);
      this.#healthyFrames = 0;
      this.#lastDecision = this.#buildDecision('sustained-headroom');
    } else {
      this.#lastDecision = this.#buildDecision(overloaded ? 'pressure' : 'stable');
    }

    return this.snapshot();
  }

  decide(observation: R29RenderObservation): R29QualityDecision {
    const usage: R29BudgetUsage = {
      ...this.#lastUsage,
      frameMs: observation.frameMs,
      renderMs: observation.cpuMs + observation.gpuMs,
      memoryBytes: observation.textureBytes + observation.geometryBytes,
      visibleObjects: observation.visibleObjects,
      drawCalls: observation.drawCalls,
    };
    return this.observe(usage, observation).quality;
  }

  snapshot(): R29BudgetSnapshot {
    return Object.freeze({
      budget: this.budget,
      usage: this.#lastUsage,
      pressure: this.#lastPressure,
      quality: this.#lastDecision,
      overloadFrames: this.#overloadFrames,
      healthyFrames: this.#healthyFrames,
    });
  }

  reset(): void {
    this.#tier = this.#clampTier('high');
    this.#overloadFrames = 0;
    this.#healthyFrames = 0;
    this.#lastPressure = Object.freeze(this.#zeroPressure());
    this.#lastUsage = Object.freeze(this.#zeroUsage());
    this.#lastDecision = this.#buildDecision('reset');
  }

  #calculatePressure(usage: R29BudgetUsage): R29BudgetPressure {
    const ratio = (value: number, limit: number): number => limit <= 0 ? 0 : Math.max(0, value) / limit;
    const frame = ratio(usage.frameMs, this.budget.targetFrameMs);
    const simulation = ratio(usage.simulationMs, this.budget.simulationMs);
    const render = ratio(usage.renderMs, this.budget.renderMs);
    const network = ratio(usage.networkMs, this.budget.networkMs);
    const telemetry = ratio(usage.telemetryMs, this.budget.telemetryMs);
    const memory = ratio(usage.memoryBytes, this.budget.memoryBytes);
    const visibility = ratio(usage.visibleObjects, this.budget.visibleObjects);
    const drawCalls = ratio(usage.drawCalls, this.budget.drawCalls);
    const aggregate =
      frame * 0.28 +
      simulation * 0.18 +
      render * 0.22 +
      network * 0.08 +
      telemetry * 0.04 +
      memory * 0.08 +
      visibility * 0.06 +
      drawCalls * 0.06;
    return Object.freeze({ frame, simulation, render, network, telemetry, memory, visibility, drawCalls, aggregate });
  }

  #buildDecision(reason: string): R29QualityDecision {
    const level = TIER_SCORE[this.#tier];
    const scaleByTier: Readonly<Record<R29QualityTier, number>> = {
      safe: 0.55,
      low: 0.7,
      medium: 0.84,
      high: 1,
      ultra: 1.16,
    };
    const visibleByTier: Readonly<Record<R29QualityTier, number>> = {
      safe: 600,
      low: 850,
      medium: 1250,
      high: 1800,
      ultra: 2400,
    };
    const drawByTier: Readonly<Record<R29QualityTier, number>> = {
      safe: 1200,
      low: 1800,
      medium: 2500,
      high: 3500,
      ultra: 5000,
    };
    const workersByTier: Readonly<Record<R29QualityTier, number>> = {
      safe: 1,
      low: 1,
      medium: 2,
      high: 4,
      ultra: 6,
    };
    return Object.freeze({
      tier: this.#tier,
      scale: scaleByTier[this.#tier],
      pixelRatio: clampR29(0.9 + level * 0.3, 0.75, 2.5),
      maxVisibleObjects: visibleByTier[this.#tier],
      maxDrawCalls: drawByTier[this.#tier],
      workerConcurrency: workersByTier[this.#tier],
      reason,
    });
  }

  #moveTier(delta: number): void {
    const next = clampR29(TIER_SCORE[this.#tier] + delta, TIER_SCORE[this.minTier], TIER_SCORE[this.maxTier]);
    this.#tier = SCORE_TIER[next] ?? this.#tier;
  }

  #clampTier(tier: R29QualityTier): R29QualityTier {
    const score = clampR29(TIER_SCORE[tier], TIER_SCORE[this.minTier], TIER_SCORE[this.maxTier]);
    return SCORE_TIER[score] ?? this.minTier;
  }

  #zeroUsage(): R29BudgetUsage {
    return {
      frameMs: 0,
      simulationMs: 0,
      renderMs: 0,
      networkMs: 0,
      telemetryMs: 0,
      memoryBytes: 0,
      visibleObjects: 0,
      drawCalls: 0,
    };
  }

  #zeroPressure(): R29BudgetPressure {
    return {
      frame: 0,
      simulation: 0,
      render: 0,
      network: 0,
      telemetry: 0,
      memory: 0,
      visibility: 0,
      drawCalls: 0,
      aggregate: 0,
    };
  }
}

function sanitizeBudget(source: Partial<R29RuntimeBudget>): Partial<R29RuntimeBudget> {
  const output: Partial<R29RuntimeBudget> = {};
  for (const key of Object.keys(R29_DEFAULT_BUDGET) as Array<keyof R29RuntimeBudget>) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) output[key] = value;
  }
  return output;
}

function sanitizeUsage(source: Partial<R29BudgetUsage>): Partial<R29BudgetUsage> {
  const output: Partial<R29BudgetUsage> = {};
  for (const key of Object.keys(source) as Array<keyof R29BudgetUsage>) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) output[key] = value;
  }
  return output;
}
