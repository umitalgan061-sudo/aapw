/**
 * V6 adaptive performance governor.
 * Translates frame-time and memory pressure observations into bounded quality
 * changes with hysteresis so the renderer does not oscillate between presets.
 */

export type QualityLevel = 0 | 1 | 2 | 3 | 4;
export type Pressure = 'nominal' | 'elevated' | 'critical';
export type GovernorMode = 'automatic' | 'locked';

export interface PerformanceSample {
  readonly frameMs: number;
  readonly gpuMs?: number;
  readonly memoryMb?: number;
  readonly drawCalls?: number;
  readonly visibleObjects?: number;
  readonly networkRttMs?: number;
}

export interface PerformanceBudget {
  readonly frameMs: number;
  readonly gpuMs: number;
  readonly memoryMb: number;
  readonly drawCalls: number;
  readonly visibleObjects: number;
}

export interface QualityPreset {
  readonly level: QualityLevel;
  readonly name: 'minimal' | 'low' | 'medium' | 'high' | 'ultra';
  readonly pixelRatio: number;
  readonly shadowMapSize: number;
  readonly vegetationDensity: number;
  readonly effectsDensity: number;
  readonly animationRate: number;
  readonly streamingRadius: number;
}

export interface GovernorState {
  readonly level: QualityLevel;
  readonly targetLevel: QualityLevel;
  readonly mode: GovernorMode;
  readonly pressure: Pressure;
  readonly score: number;
  readonly stableFrames: number;
  readonly downgradeCount: number;
  readonly upgradeCount: number;
}

const PRESETS: readonly QualityPreset[] = [
  { level: 0, name: 'minimal', pixelRatio: 0.7, shadowMapSize: 512, vegetationDensity: 0.25, effectsDensity: 0.25, animationRate: 0.65, streamingRadius: 1 },
  { level: 1, name: 'low', pixelRatio: 0.85, shadowMapSize: 1024, vegetationDensity: 0.45, effectsDensity: 0.45, animationRate: 0.8, streamingRadius: 1.5 },
  { level: 2, name: 'medium', pixelRatio: 1, shadowMapSize: 1536, vegetationDensity: 0.65, effectsDensity: 0.65, animationRate: 0.9, streamingRadius: 2 },
  { level: 3, name: 'high', pixelRatio: 1.25, shadowMapSize: 2048, vegetationDensity: 0.82, effectsDensity: 0.82, animationRate: 1, streamingRadius: 2.5 },
  { level: 4, name: 'ultra', pixelRatio: 1.5, shadowMapSize: 4096, vegetationDensity: 1, effectsDensity: 1, animationRate: 1, streamingRadius: 3 },
];

export interface GovernorConfig {
  readonly budgets: PerformanceBudget;
  readonly historySize: number;
  readonly downgradeThreshold: number;
  readonly upgradeThreshold: number;
  readonly holdFrames: number;
  readonly maxStep: 1 | 2;
  readonly minLevel: QualityLevel;
  readonly maxLevel: QualityLevel;
}

const DEFAULT_CONFIG: GovernorConfig = {
  budgets: { frameMs: 16.67, gpuMs: 14, memoryMb: 1536, drawCalls: 1800, visibleObjects: 600 },
  historySize: 90,
  downgradeThreshold: 0.72,
  upgradeThreshold: 0.92,
  holdFrames: 45,
  maxStep: 1,
  minLevel: 0,
  maxLevel: 4,
};

function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }
function finite(value: number): number { return Number.isFinite(value) ? Math.max(0, value) : 0; }

function pressureFor(ratio: number): Pressure {
  if (ratio >= 1.15) return 'critical';
  if (ratio >= 0.9) return 'elevated';
  return 'nominal';
}

export class PerformanceGovernor {
  readonly #config: GovernorConfig;
  readonly #samples: PerformanceSample[] = [];
  #level: QualityLevel;
  #targetLevel: QualityLevel;
  #mode: GovernorMode = 'automatic';
  #stableFrames = 0;
  #downgradeCount = 0;
  #upgradeCount = 0;
  #score = 0;
  #pressure: Pressure = 'nominal';

  constructor(initialLevel: QualityLevel = 2, config: Partial<GovernorConfig> = {}) {
    const merged = { ...DEFAULT_CONFIG, ...config, budgets: { ...DEFAULT_CONFIG.budgets, ...(config.budgets ?? {}) } };
    this.#config = {
      budgets: merged.budgets,
      historySize: Math.max(10, Math.floor(merged.historySize)),
      downgradeThreshold: clamp(merged.downgradeThreshold, 0.1, 0.99),
      upgradeThreshold: clamp(merged.upgradeThreshold, merged.downgradeThreshold + 0.01, 1.5),
      holdFrames: Math.max(1, Math.floor(merged.holdFrames)),
      maxStep: merged.maxStep === 2 ? 2 : 1,
      minLevel: clamp(merged.minLevel, 0, 4) as QualityLevel,
      maxLevel: clamp(merged.maxLevel, 0, 4) as QualityLevel,
    };
    this.#level = clamp(initialLevel, this.#config.minLevel, this.#config.maxLevel) as QualityLevel;
    this.#targetLevel = this.#level;
  }

  setMode(mode: GovernorMode): void { this.#mode = mode; }
  lock(level: QualityLevel): void { this.#level = clamp(level, this.#config.minLevel, this.#config.maxLevel) as QualityLevel; this.#targetLevel = this.#level; this.#mode = 'locked'; }
  unlock(): void { this.#mode = 'automatic'; }

  sample(sample: PerformanceSample): GovernorState {
    const clean: PerformanceSample = {
      frameMs: finite(sample.frameMs),
      gpuMs: sample.gpuMs === undefined ? undefined : finite(sample.gpuMs),
      memoryMb: sample.memoryMb === undefined ? undefined : finite(sample.memoryMb),
      drawCalls: sample.drawCalls === undefined ? undefined : finite(sample.drawCalls),
      visibleObjects: sample.visibleObjects === undefined ? undefined : finite(sample.visibleObjects),
      networkRttMs: sample.networkRttMs === undefined ? undefined : finite(sample.networkRttMs),
    };
    this.#samples.push(clean);
    while (this.#samples.length > this.#config.historySize) this.#samples.shift();
    this.#score = this.#computeScore();
    this.#pressure = pressureFor(this.#score);
    this.#stableFrames += 1;
    if (this.#mode === 'automatic' && this.#stableFrames >= this.#config.holdFrames) this.#rebalance();
    return this.state();
  }

  update(frameMs: number, gpuMs?: number, memoryMb?: number): GovernorState {
    return this.sample({ frameMs, gpuMs, memoryMb });
  }

  state(): GovernorState {
    return {
      level: this.#level,
      targetLevel: this.#targetLevel,
      mode: this.#mode,
      pressure: this.#pressure,
      score: this.#score,
      stableFrames: this.#stableFrames,
      downgradeCount: this.#downgradeCount,
      upgradeCount: this.#upgradeCount,
    };
  }

  preset(): QualityPreset { return PRESETS[this.#level]!; }
  history(): readonly PerformanceSample[] { return this.#samples; }

  budget(): PerformanceBudget { return { ...this.#config.budgets }; }

  percentile(metric: keyof PerformanceSample, percentile = 0.95): number {
    const values = this.#samples.map((sample) => Number(sample[metric] ?? 0)).filter(Number.isFinite).sort((a, b) => a - b);
    if (values.length === 0) return 0;
    const index = clamp(Math.ceil((values.length - 1) * percentile), 0, values.length - 1);
    return values[index]!;
  }

  clearHistory(): void { this.#samples.length = 0; this.#stableFrames = 0; }

  #computeScore(): number {
    if (this.#samples.length === 0) return 0;
    const latest = this.#samples.slice(-30);
    const ratio = (metric: keyof PerformanceSample, budget: number): number => {
      const values = latest.map((sample) => Number(sample[metric] ?? budget)).filter(Number.isFinite);
      const average = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
      return average / Math.max(0.001, budget);
    };
    const ratios = [
      ratio('frameMs', this.#config.budgets.frameMs),
      ratio('gpuMs', this.#config.budgets.gpuMs),
      ratio('memoryMb', this.#config.budgets.memoryMb),
      ratio('drawCalls', this.#config.budgets.drawCalls),
      ratio('visibleObjects', this.#config.budgets.visibleObjects),
    ];
    const weighted = ratios[0]! * 0.35 + ratios[1]! * 0.25 + ratios[2]! * 0.15 + ratios[3]! * 0.15 + ratios[4]! * 0.1;
    return weighted;
  }

  #rebalance(): void {
    if (this.#score >= this.#config.downgradeThreshold && this.#level > this.#config.minLevel) {
      const step = Math.min(this.#config.maxStep, this.#level - this.#config.minLevel);
      this.#targetLevel = (this.#level - step) as QualityLevel;
      this.#level = this.#targetLevel;
      this.#downgradeCount += 1;
      this.#stableFrames = 0;
      return;
    }
    if (this.#score <= this.#config.upgradeThreshold && this.#level < this.#config.maxLevel) {
      const step = Math.min(this.#config.maxStep, this.#config.maxLevel - this.#level);
      this.#targetLevel = (this.#level + step) as QualityLevel;
      this.#level = this.#targetLevel;
      this.#upgradeCount += 1;
      this.#stableFrames = 0;
    }
  }
}

export interface DeviceProfile {
  readonly coarsePointer: boolean;
  readonly hardwareConcurrency: number;
  readonly deviceMemoryGb?: number;
  readonly screenPixels: number;
  readonly saveData: boolean;
}

export function chooseInitialQuality(profile: DeviceProfile): QualityLevel {
  if (profile.saveData) return 0;
  if (profile.coarsePointer && profile.hardwareConcurrency <= 4) return 1;
  if (profile.deviceMemoryGb !== undefined && profile.deviceMemoryGb < 4) return 1;
  if (profile.screenPixels > 8_000_000 && profile.hardwareConcurrency >= 8 && (profile.deviceMemoryGb ?? 8) >= 8) return 4;
  if (profile.hardwareConcurrency >= 8 && (profile.deviceMemoryGb ?? 6) >= 6) return 3;
  return 2;
}

export function qualityPreset(level: QualityLevel): QualityPreset { return PRESETS[clamp(level, 0, 4)]!; }

export function budgetHeadroom(sample: PerformanceSample, budget: PerformanceBudget): number {
  const ratios = [
    finite(sample.frameMs) / budget.frameMs,
    finite(sample.gpuMs ?? 0) / budget.gpuMs,
    finite(sample.memoryMb ?? 0) / budget.memoryMb,
    finite(sample.drawCalls ?? 0) / budget.drawCalls,
    finite(sample.visibleObjects ?? 0) / budget.visibleObjects,
  ];
  return clamp(1 - Math.max(...ratios), -1, 1);
}
