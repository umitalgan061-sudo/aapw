import {
  QUALITY_ORDER_V15,
  clampV15,
  type FrameObservationV15,
  type QualityDecisionV15,
  type QualityTierV15,
} from "./types.ts";

export interface QualityControllerOptionsV15 {
  readonly initial?: QualityTierV15;
  readonly min?: QualityTierV15;
  readonly max?: QualityTierV15;
  readonly targetFrameMs?: number;
  readonly sampleWindow?: number;
  /** Pressure ceiling below which the controller may recover a quality tier. */
  readonly upgradeThreshold?: number;
  /** Pressure ceiling above which the controller must protect frame time. */
  readonly downgradeThreshold?: number;
}

interface QualityProfileV15 {
  readonly tier: QualityTierV15;
  readonly scale: number;
  readonly pixelRatioCap: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly visibleObjects: number;
  readonly shadows: boolean;
  readonly temporal: boolean;
}

const PROFILES: Readonly<Record<QualityTierV15, QualityProfileV15>> = Object.freeze({
  minimal: { tier: "minimal", scale: 0.64, pixelRatioCap: 1, drawCalls: 420, triangles: 650_000, visibleObjects: 550, shadows: false, temporal: false },
  balanced: { tier: "balanced", scale: 0.78, pixelRatioCap: 1.35, drawCalls: 650, triangles: 1_250_000, visibleObjects: 900, shadows: false, temporal: false },
  high: { tier: "high", scale: 0.92, pixelRatioCap: 1.75, drawCalls: 950, triangles: 2_100_000, visibleObjects: 1_450, shadows: true, temporal: true },
  ultra: { tier: "ultra", scale: 1, pixelRatioCap: 2.25, drawCalls: 1_350, triangles: 3_200_000, visibleObjects: 2_000, shadows: true, temporal: true },
});

function rank(tier: QualityTierV15): number { return QUALITY_ORDER_V15.indexOf(tier); }

export interface QualityPressureV15 {
  readonly frame: number;
  readonly cpu: number;
  readonly gpu: number;
  readonly draw: number;
  readonly triangle: number;
  readonly visible: number;
  readonly memory: number;
  readonly thermal: number;
  readonly combined: number;
}

export class AdaptiveQualityDirectorV15 {
  readonly #min: QualityTierV15;
  readonly #max: QualityTierV15;
  readonly #targetFrameMs: number;
  readonly #window: number;
  #tier: QualityTierV15;
  readonly #upgradeThreshold: number;
  readonly #downgradeThreshold: number;
  #overBudgetStreak = 0;
  #underBudgetStreak = 0;
  #ewmaFrameMs = 16.67;
  #ewmaCpuMs = 8;
  #ewmaGpuMs = 10;
  #pressure: QualityPressureV15 = Object.freeze({
    frame: 0, cpu: 0, gpu: 0, draw: 0, triangle: 0, visible: 0, memory: 0, thermal: 0, combined: 0,
  });

  constructor(options: QualityControllerOptionsV15 = {}) {
    this.#min = options.min ?? "minimal";
    this.#max = options.max ?? "ultra";
    this.#targetFrameMs = clampV15(options.targetFrameMs ?? 16.67, 8.33, 50);
    this.#window = Math.max(8, Math.min(240, Math.floor(options.sampleWindow ?? 45)));
    this.#upgradeThreshold = clampV15(options.upgradeThreshold ?? 0.65, 0.5, 0.9);
    this.#downgradeThreshold = clampV15(options.downgradeThreshold ?? 0.82, 0.7, 1);
    if (this.#upgradeThreshold >= this.#downgradeThreshold) throw new RangeError("invalid quality hysteresis bounds");
    this.#tier = this.#clampTier(options.initial ?? "balanced");
    if (rank(this.#min) > rank(this.#max)) throw new RangeError("invalid quality bounds");
  }

  get tier(): QualityTierV15 { return this.#tier; }

  observe(input: FrameObservationV15): QualityDecisionV15 {
    const alpha = 2 / (this.#window + 1);
    this.#ewmaFrameMs += (input.frameMs - this.#ewmaFrameMs) * alpha;
    this.#ewmaCpuMs += (input.cpuMs - this.#ewmaCpuMs) * alpha;
    if (input.gpuMs !== null) this.#ewmaGpuMs += (input.gpuMs - this.#ewmaGpuMs) * alpha;
    this.#pressure = this.#calculatePressure(input);
    if (this.#pressure.combined >= this.#downgradeThreshold) {
      this.#overBudgetStreak += 1;
      this.#underBudgetStreak = 0;
    } else if (this.#pressure.combined <= this.#upgradeThreshold) {
      this.#underBudgetStreak += 1;
      this.#overBudgetStreak = 0;
    } else {
      this.#overBudgetStreak = Math.max(0, this.#overBudgetStreak - 1);
      this.#underBudgetStreak = Math.max(0, this.#underBudgetStreak - 1);
    }
    if (this.#overBudgetStreak >= 3) {
      this.#tier = this.#clampTier(QUALITY_ORDER_V15[Math.max(0, rank(this.#tier) - 1)] ?? this.#min);
      this.#overBudgetStreak = 0;
    } else if (this.#underBudgetStreak >= 20) {
      this.#tier = this.#clampTier(QUALITY_ORDER_V15[Math.min(QUALITY_ORDER_V15.length - 1, rank(this.#tier) + 1)] ?? this.#max);
      this.#underBudgetStreak = 0;
    }
    return this.decision("pressure=" + this.#pressure.combined.toFixed(3));
  }

  pressure(): QualityPressureV15 { return this.#pressure; }

  decision(reason = "steady"): QualityDecisionV15 {
    const profile = PROFILES[this.#tier];
    const pressure = this.#pressure.combined;
    const renderScale = clampV15(profile.scale * (1 - Math.max(0, pressure - 0.55) * 0.3), 0.55, profile.scale);
    return Object.freeze({
      tier: this.#tier,
      renderScale: Number(renderScale.toFixed(3)),
      pixelRatioCap: profile.pixelRatioCap,
      maxDrawCalls: profile.drawCalls,
      maxTriangles: profile.triangles,
      maxVisibleObjects: profile.visibleObjects,
      dynamicResolution: true,
      shadows: profile.shadows && pressure < 0.88,
      temporalEffects: profile.temporal && pressure < 0.78,
      reason,
    });
  }

  observePressureOnly(input: FrameObservationV15): QualityPressureV15 {
    const tier = this.#tier;
    this.observe(input);
    this.#tier = tier;
    return this.#pressure;
  }

  reset(tier = this.#tier): void {
    this.#tier = this.#clampTier(tier);
    this.#overBudgetStreak = 0;
    this.#underBudgetStreak = 0;
    this.#ewmaFrameMs = this.#targetFrameMs;
    this.#ewmaCpuMs = this.#targetFrameMs * 0.5;
    this.#ewmaGpuMs = this.#targetFrameMs * 0.65;
    this.#pressure = Object.freeze({
      frame: 0, cpu: 0, gpu: 0, draw: 0, triangle: 0, visible: 0, memory: 0, thermal: 0, combined: 0,
    });
  }

  stats(): Readonly<{ tier: QualityTierV15; ewmaFrameMs: number; ewmaCpuMs: number; ewmaGpuMs: number; pressure: QualityPressureV15; overBudgetStreak: number; underBudgetStreak: number; upgradeThreshold: number; downgradeThreshold: number }> {
    return Object.freeze({
      tier: this.#tier,
      ewmaFrameMs: Number(this.#ewmaFrameMs.toFixed(3)),
      ewmaCpuMs: Number(this.#ewmaCpuMs.toFixed(3)),
      ewmaGpuMs: Number(this.#ewmaGpuMs.toFixed(3)),
      pressure: this.#pressure,
      overBudgetStreak: this.#overBudgetStreak,
      underBudgetStreak: this.#underBudgetStreak,
      upgradeThreshold: this.#upgradeThreshold,
      downgradeThreshold: this.#downgradeThreshold,
    });
  }

  #calculatePressure(input: FrameObservationV15): QualityPressureV15 {
    const profile = PROFILES[this.#tier];
    const frame = clampV15(this.#ewmaFrameMs / this.#targetFrameMs, 0, 2);
    const cpu = clampV15(this.#ewmaCpuMs / Math.max(1, this.#targetFrameMs * 0.62), 0, 2);
    const gpu = clampV15(this.#ewmaGpuMs / Math.max(1, this.#targetFrameMs * 0.72), 0, 2);
    const draw = clampV15(input.drawCalls / Math.max(1, profile.drawCalls), 0, 2);
    const triangle = clampV15(input.triangles / Math.max(1, profile.triangles), 0, 2);
    const visible = clampV15(input.visibleObjects / Math.max(1, profile.visibleObjects), 0, 2);
    const memory = clampV15(input.memoryPressure, 0, 1);
    const thermal = clampV15(input.thermalPressure, 0, 1);
    const combined = clampV15(
      frame * 0.25 + cpu * 0.16 + gpu * 0.2 + draw * 0.09 + triangle * 0.1 +
      visible * 0.06 + memory * 0.07 + thermal * 0.07,
      0, 1,
    );
    return Object.freeze({ frame, cpu, gpu, draw, triangle, visible, memory, thermal, combined });
  }

  #clampTier(value: QualityTierV15): QualityTierV15 {
    const current = rank(value);
    return QUALITY_ORDER_V15[clampV15(current, rank(this.#min), rank(this.#max))] ?? this.#min;
  }
}
