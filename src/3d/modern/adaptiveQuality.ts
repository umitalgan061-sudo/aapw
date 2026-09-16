import type { AdaptiveQualityState, FrameMetrics, QualityTier, RenderBudget } from './types';

export interface QualityObservation {
  readonly cpuMs: number;
  readonly gpuMs: number | null;
  readonly memoryBytes?: number;
  readonly droppedFrames?: number;
  readonly timestampMs?: number;
}

export interface QualityLimits {
  readonly minTier: QualityTier;
  readonly maxTier: QualityTier;
  readonly targetFps: number;
  readonly minimumResolutionScale: number;
  readonly maximumResolutionScale: number;
}

export interface QualityPlan {
  readonly quality: AdaptiveQualityState;
  readonly budget: RenderBudget;
  readonly changed: boolean;
}

const ORDER: readonly QualityTier[] = ['safe', 'low', 'medium', 'high', 'ultra', 'cinematic'];
const BUDGETS: Record<QualityTier, RenderBudget> = {
  safe: { gpuMs: 22, cpuMs: 16, drawCalls: 550, triangles: 650_000, texturesBytes: 160 * 1024 * 1024, instances: 2_500 },
  low: { gpuMs: 18, cpuMs: 12, drawCalls: 900, triangles: 1_200_000, texturesBytes: 256 * 1024 * 1024, instances: 4_000 },
  medium: { gpuMs: 15, cpuMs: 10, drawCalls: 1_400, triangles: 2_000_000, texturesBytes: 384 * 1024 * 1024, instances: 6_000 },
  high: { gpuMs: 12, cpuMs: 8, drawCalls: 1_800, triangles: 3_000_000, texturesBytes: 512 * 1024 * 1024, instances: 8_000 },
  ultra: { gpuMs: 11, cpuMs: 8, drawCalls: 2_400, triangles: 5_500_000, texturesBytes: 768 * 1024 * 1024, instances: 10_000 },
  cinematic: { gpuMs: 9.5, cpuMs: 7, drawCalls: 3_000, triangles: 7_000_000, texturesBytes: 1024 * 1024 * 1024, instances: 12_000 },
};

/** Hysteresis-based quality controller: avoids oscillating one tier every other frame. */
export class AdaptiveQualityController {
  private quality: AdaptiveQualityState;
  private readonly limits: QualityLimits;
  private pressureEma = 0;
  private headroomFrames = 0;
  private pressureFrames = 0;
  private lastChangeAt = 0;

  public constructor(initial: QualityTier = 'high', limits: Partial<QualityLimits> = {}) {
    this.limits = {
      minTier: limits.minTier ?? 'safe',
      maxTier: limits.maxTier ?? 'cinematic',
      targetFps: limits.targetFps ?? 60,
      minimumResolutionScale: limits.minimumResolutionScale ?? 0.55,
      maximumResolutionScale: limits.maximumResolutionScale ?? 1,
    };
    this.quality = makeQuality(initial, 'initial');
  }

  public observe(observation: QualityObservation): QualityPlan {
    const gpu = observation.gpuMs ?? observation.cpuMs;
    const target = 1000 / this.limits.targetFps;
    const pressure = gpu / Math.max(1, target * 0.9);
    this.pressureEma = this.pressureEma * 0.9 + pressure * 0.1;
    if (this.pressureEma > 1.08) { this.pressureFrames += 1; this.headroomFrames = 0; }
    else if (this.pressureEma < 0.72) { this.headroomFrames += 1; this.pressureFrames = 0; }
    else { this.pressureFrames = Math.max(0, this.pressureFrames - 1); this.headroomFrames = Math.max(0, this.headroomFrames - 1); }
    const now = observation.timestampMs ?? performance.now();
    const cooldown = now - this.lastChangeAt < 750;
    let tier = this.quality.tier;
    let changed = false;
    if (!cooldown && this.pressureFrames >= 12) { tier = this.step(tier, -1); changed = tier !== this.quality.tier; this.pressureFrames = 0; }
    else if (!cooldown && this.headroomFrames >= 90) { tier = this.step(tier, 1); changed = tier !== this.quality.tier; this.headroomFrames = 0; }
    if (changed) { this.lastChangeAt = now; this.quality = makeQuality(tier, `adaptive pressure ${this.pressureEma.toFixed(2)}x`); }
    const quality = this.updateResolution(observation, target, changed);
    this.quality = quality;
    return { quality, budget: BUDGETS[quality.tier], changed };
  }

  public state(): AdaptiveQualityState { return this.quality; }
  public budget(): RenderBudget { return BUDGETS[this.quality.tier]; }

  private updateResolution(observation: QualityObservation, targetMs: number, tierChanged: boolean): AdaptiveQualityState {
    const measured = observation.gpuMs ?? observation.cpuMs;
    const ratio = measured / Math.max(1, targetMs);
    let scale = this.quality.resolutionScale;
    if (ratio > 1.1) scale -= 0.04;
    else if (ratio < 0.78 && !tierChanged) scale += 0.02;
    scale = Math.min(this.limits.maximumResolutionScale, Math.max(this.limits.minimumResolutionScale, scale));
    return { ...this.quality, resolutionScale: Number(scale.toFixed(3)) };
  }

  private step(current: QualityTier, direction: -1 | 1): QualityTier {
    const index = ORDER.indexOf(current);
    const target = Math.min(ORDER.length - 1, Math.max(0, index + direction));
    const tier = ORDER[target] ?? current;
    const min = ORDER.indexOf(this.limits.minTier);
    const max = ORDER.indexOf(this.limits.maxTier);
    return ORDER[Math.min(max, Math.max(min, ORDER.indexOf(tier)))] ?? current;
  }
}

export interface FramePacingSample { readonly timestampMs: number; readonly deltaMs: number; }
export interface FramePacingStats { readonly fps: number; readonly p50Ms: number; readonly p95Ms: number; readonly p99Ms: number; readonly jankRatio: number; }

export class FramePacingMonitor {
  private readonly capacity: number;
  private readonly samples: number[] = [];
  private jankFrames = 0;
  public constructor(capacity = 240) { this.capacity = Math.max(30, Math.floor(capacity)); }
  public add(sample: FramePacingSample): void {
    if (!Number.isFinite(sample.deltaMs) || sample.deltaMs <= 0) return;
    this.samples.push(sample.deltaMs);
    if (this.samples.length > this.capacity) this.samples.shift();
    if (sample.deltaMs > 33.4) this.jankFrames += 1;
  }
  public stats(): FramePacingStats {
    const sorted = [...this.samples].sort((a, b) => a - b);
    const percentile = (p: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0 : 0;
    const mean = sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 16.667;
    return { fps: 1000 / Math.max(1, mean), p50Ms: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99), jankRatio: sorted.length ? Math.min(1, this.jankFrames / sorted.length) : 0 };
  }
  public reset(): void { this.samples.length = 0; this.jankFrames = 0; }
}

const makeQuality = (tier: QualityTier, reason: string): AdaptiveQualityState => {
  const factor: Record<QualityTier, number> = { safe: 0.3, low: 0.5, medium: 0.75, high: 1, ultra: 1.05, cinematic: 1.15 };
  return { tier, resolutionScale: tier === 'safe' ? 0.65 : 1, shadowDistance: 180 * factor[tier], foliageDensity: factor[tier], effectsLevel: factor[tier], reason };
};
