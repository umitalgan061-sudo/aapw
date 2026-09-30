import type {
  QualityTier,
  RenderDecision,
  RenderObservation,
  RenderProfile,
} from './contracts.ts';

const ORDER: readonly QualityTier[] = Object.freeze([
  'safe',
  'low',
  'balanced',
  'high',
  'ultra',
]);

function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface AdaptiveQualityOptionsR25 {
  readonly minTier?: QualityTier;
  readonly maxTier?: QualityTier;
  readonly targetFrameMs?: number;
  readonly downgradeSamples?: number;
  readonly upgradeSamples?: number;
  readonly cooldownFrames?: number;
  readonly clock?: () => number;
}

export interface AdaptiveQualitySnapshotR25 {
  readonly tier: QualityTier;
  readonly score: number;
  readonly frame: number;
  readonly downgradeStreak: number;
  readonly upgradeStreak: number;
  readonly cooldownUntil: number;
  readonly targetFrameMs: number;
  readonly lastDecision: RenderDecision | null;
}

const tierScale: Record<QualityTier, number> = {
  safe: 0.4,
  low: 0.56,
  balanced: 0.73,
  high: 0.88,
  ultra: 1,
};

const tierVisibleScale: Record<QualityTier, number> = {
  safe: 0.34,
  low: 0.5,
  balanced: 0.68,
  high: 0.86,
  ultra: 1,
};

export class AdaptiveQualityR25 {
  #profile: RenderProfile;
  #minTier: QualityTier;
  #maxTier: QualityTier;
  #targetFrameMs: number;
  #downgradeSamples: number;
  #upgradeSamples: number;
  #cooldownFrames: number;
  #clock: () => number;
  #frame = 0;
  #downgradeStreak = 0;
  #upgradeStreak = 0;
  #cooldownUntil = 0;
  #score = 0.5;
  #lastDecision: RenderDecision | null = null;

  public constructor(
    profile: RenderProfile,
    options: AdaptiveQualityOptionsR25 = {},
  ) {
    this.#profile = Object.freeze({ ...profile });
    this.#minTier = options.minTier ?? 'safe';
    this.#maxTier = options.maxTier ?? 'ultra';
    this.#targetFrameMs = Math.max(
      5,
      finite(options.targetFrameMs, 1000 / Math.max(1, profile.targetFps)),
    );
    this.#downgradeSamples = Math.max(
      1,
      Math.trunc(finite(options.downgradeSamples, 8)),
    );
    this.#upgradeSamples = Math.max(
      1,
      Math.trunc(finite(options.upgradeSamples, 45)),
    );
    this.#cooldownFrames = Math.max(
      1,
      Math.trunc(finite(options.cooldownFrames, 30)),
    );
    this.#clock = options.clock ?? (() => globalThis.performance?.now?.() ?? Date.now());

    this.#validateTierRange();
  }

  public get profile(): RenderProfile {
    return this.#profile;
  }

  public snapshot(): AdaptiveQualitySnapshotR25 {
    return Object.freeze({
      tier: this.#profile.tier,
      score: Number(this.#score.toFixed(4)),
      frame: this.#frame,
      downgradeStreak: this.#downgradeStreak,
      upgradeStreak: this.#upgradeStreak,
      cooldownUntil: this.#cooldownUntil,
      targetFrameMs: this.#targetFrameMs,
      lastDecision: this.#lastDecision,
    });
  }

  public observe(observation: RenderObservation): RenderDecision {
    this.#frame += 1;

    const framePressure = clamp(
      finite(observation.frameMs, this.#targetFrameMs) / this.#targetFrameMs,
      0,
      3,
    );
    const cpuPressure = clamp(
      finite(observation.cpuMs, this.#targetFrameMs * 0.6) /
        (this.#targetFrameMs * 0.65),
      0,
      3,
    );
    const gpuPressure = clamp(
      finite(observation.gpuMs, this.#targetFrameMs * 0.7) /
        (this.#targetFrameMs * 0.78),
      0,
      3,
    );
    const memoryPressure = clamp(finite(observation.memoryPressure, 0), 0, 2);
    const thermalPressure = clamp(finite(observation.thermalPressure, 0), 0, 2);
    const objectPressure = clamp(
      finite(observation.visibleObjects, this.#profile.maxVisibleObjects) /
        Math.max(1, this.#profile.maxVisibleObjects),
      0,
      3,
    );

    const weightedPressure =
      framePressure * 0.42 +
      cpuPressure * 0.18 +
      gpuPressure * 0.25 +
      memoryPressure * 0.08 +
      thermalPressure * 0.04 +
      objectPressure * 0.03;

    const instantaneousScore = clamp(
      1 - (weightedPressure - 0.7) / 1.45,
      0,
      1,
    );

    this.#score =
      this.#score * 0.84 +
      instantaneousScore * 0.16;

    const overloaded =
      weightedPressure > 1.04 ||
      finite(observation.frameMs, this.#targetFrameMs) > this.#targetFrameMs * 1.15;
    const underloaded =
      weightedPressure < 0.63 &&
      finite(observation.frameMs, this.#targetFrameMs) < this.#targetFrameMs * 0.88;

    if (overloaded) {
      this.#downgradeStreak += 1;
      this.#upgradeStreak = Math.max(0, this.#upgradeStreak - 2);
    } else if (underloaded) {
      this.#upgradeStreak += 1;
      this.#downgradeStreak = Math.max(0, this.#downgradeStreak - 1);
    } else {
      this.#downgradeStreak = Math.max(0, this.#downgradeStreak - 1);
      this.#upgradeStreak = Math.max(0, this.#upgradeStreak - 1);
    }

    let changed = false;
    let reason = 'hold';

    if (
      this.#frame >= this.#cooldownUntil &&
      this.#downgradeStreak >= this.#downgradeSamples
    ) {
      const next = this.#shift(-1);
      if (next !== this.#profile.tier) {
        this.#profile = this.#forTier(next);
        this.#cooldownUntil = this.#frame + this.#cooldownFrames;
        this.#downgradeStreak = 0;
        this.#upgradeStreak = 0;
        changed = true;
        reason = `downgrade:pressure=${weightedPressure.toFixed(3)}`;
      }
    } else if (
      this.#frame >= this.#cooldownUntil &&
      this.#upgradeStreak >= this.#upgradeSamples
    ) {
      const next = this.#shift(1);
      if (next !== this.#profile.tier) {
        this.#profile = this.#forTier(next);
        this.#cooldownUntil = this.#frame + this.#cooldownFrames * 2;
        this.#downgradeStreak = 0;
        this.#upgradeStreak = 0;
        changed = true;
        reason = `upgrade:pressure=${weightedPressure.toFixed(3)}`;
      }
    }

    const decision = Object.freeze({
      ...this.#profile,
      changed,
      reason,
      score: Number(this.#score.toFixed(4)),
      timestampMs: this.#clock(),
    });

    this.#lastDecision = decision;
    return decision;
  }

  public decision(): RenderDecision {
    return this.#lastDecision ?? Object.freeze({
      ...this.#profile,
      changed: false,
      reason: 'initial',
      score: Number(this.#score.toFixed(4)),
      timestampMs: this.#clock(),
    });
  }

  public forceTier(tier: QualityTier, reason = 'manual'): RenderDecision {
    const bounded = this.#boundTier(tier);
    const changed = bounded !== this.#profile.tier;
    if (changed) {
      this.#profile = this.#forTier(bounded);
      this.#downgradeStreak = 0;
      this.#upgradeStreak = 0;
      this.#cooldownUntil = this.#frame + this.#cooldownFrames;
    }

    const decision = Object.freeze({
      ...this.#profile,
      changed,
      reason,
      score: Number(this.#score.toFixed(4)),
      timestampMs: this.#clock(),
    });

    this.#lastDecision = decision;
    return decision;
  }

  #shift(direction: number): QualityTier {
    const current = ORDER.indexOf(this.#profile.tier);
    const min = ORDER.indexOf(this.#minTier);
    const max = ORDER.indexOf(this.#maxTier);

    return ORDER[
      clamp(current + direction, min, max)
    ] ?? this.#profile.tier;
  }

  #boundTier(tier: QualityTier): QualityTier {
    const target = ORDER.indexOf(tier);
    const min = ORDER.indexOf(this.#minTier);
    const max = ORDER.indexOf(this.#maxTier);
    return ORDER[clamp(target, min, max)] ?? this.#profile.tier;
  }

  #forTier(tier: QualityTier): RenderProfile {
    const sourceScale = tierScale[this.#profile.tier];
    const nextScale = tierScale[tier];
    const ratio = clamp(
      this.#profile.pixelRatio * nextScale / Math.max(0.01, sourceScale),
      0.65,
      2.5,
    );

    return Object.freeze({
      ...this.#profile,
      tier,
      pixelRatio: Number(ratio.toFixed(3)),
      shadowResolution:
        tier === 'ultra' ? 4096 :
        tier === 'high' ? 2048 :
        tier === 'balanced' ? 1536 :
        tier === 'low' ? 1024 :
        512,
      drawDistanceMeters:
        tier === 'ultra' ? 9000 :
        tier === 'high' ? 7000 :
        tier === 'balanced' ? 5200 :
        tier === 'low' ? 3200 :
        1800,
      vegetationDensity:
        tier === 'ultra' ? 1 :
        tier === 'high' ? 0.86 :
        tier === 'balanced' ? 0.68 :
        tier === 'low' ? 0.46 :
        0.22,
      particleDensity:
        tier === 'ultra' ? 1 :
        tier === 'high' ? 0.82 :
        tier === 'balanced' ? 0.64 :
        tier === 'low' ? 0.42 :
        0.16,
      postFxQuality:
        tier === 'ultra' ? 1 :
        tier === 'high' ? 0.82 :
        tier === 'balanced' ? 0.56 :
        tier === 'low' ? 0.28 :
        0,
      temporalHistory:
        this.#profile.temporalHistory && tier !== 'safe',
      maxVisibleObjects: Math.max(
        12000,
        Math.round(this.#profile.maxVisibleObjects * tierVisibleScale[tier] /
          Math.max(0.15, tierVisibleScale[this.#profile.tier])),
      ),
      targetFps: tier === 'ultra' ? 120 : 60,
    });
  }

  #validateTierRange(): void {
    const min = ORDER.indexOf(this.#minTier);
    const max = ORDER.indexOf(this.#maxTier);
    if (min < 0 || max < 0 || min > max) {
      throw new Error('R25_INVALID_QUALITY_RANGE');
    }
  }
}

export interface FramePacerR25Options {
  readonly targetFps: number;
  readonly maxDeltaMs?: number;
  readonly smoothingAlpha?: number;
}

export class FramePacerR25 {
  readonly #targetFrameMs: number;
  readonly #maxDeltaMs: number;
  readonly #alpha: number;
  #smoothedFrameMs: number;
  #frameDebtMs = 0;

  public constructor(options: FramePacerR25Options) {
    this.#targetFrameMs = Math.max(1, 1000 / Math.max(1, options.targetFps));
    this.#maxDeltaMs = Math.max(this.#targetFrameMs, finite(options.maxDeltaMs, 250));
    this.#alpha = clamp(finite(options.smoothingAlpha, 0.12), 0.01, 1);
    this.#smoothedFrameMs = this.#targetFrameMs;
  }

  public sample(deltaMs: number): Readonly<{
    deltaMs: number;
    smoothedFrameMs: number;
    debtMs: number;
    ratio: number;
  }> {
    const delta = clamp(finite(deltaMs, this.#targetFrameMs), 0, this.#maxDeltaMs);
    this.#smoothedFrameMs =
      this.#smoothedFrameMs * (1 - this.#alpha) +
      delta * this.#alpha;

    this.#frameDebtMs = clamp(
      this.#frameDebtMs + delta - this.#targetFrameMs,
      -this.#targetFrameMs,
      this.#targetFrameMs * 6,
    );

    return Object.freeze({
      deltaMs: delta,
      smoothedFrameMs: this.#smoothedFrameMs,
      debtMs: this.#frameDebtMs,
      ratio: this.#smoothedFrameMs / this.#targetFrameMs,
    });
  }

  public reset(): void {
    this.#smoothedFrameMs = this.#targetFrameMs;
    this.#frameDebtMs = 0;
  }
}

export function estimateDynamicPixelRatio(
  current: number,
  frameMs: number,
  targetFrameMs: number,
): number {
  const ratio = Math.sqrt(
    Math.max(0.25, Math.min(4, targetFrameMs / Math.max(1, frameMs))),
  );
  return Number(
    clamp(finite(current, 1) * clamp(ratio, 0.72, 1.08), 0.65, 2.5).toFixed(3),
  );
}
