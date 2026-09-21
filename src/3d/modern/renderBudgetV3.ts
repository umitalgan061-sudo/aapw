/**
 * Adaptive render budget V3.
 *
 * Turns frame-time telemetry into explicit quality decisions. The controller
 * uses EMA smoothing and hysteresis so a temporary spike does not cause visible
 * quality thrashing.
 *
 * @module renderBudgetV3
 */

export type RenderTier = 'ultra' | 'high' | 'balanced' | 'performance' | 'safe';

export type RenderFeature =
  | 'shadows'
  | 'contactShadows'
  | 'volumetrics'
  | 'waterReflections'
  | 'vegetationDensity'
  | 'particleDensity'
  | 'postProcessing'
  | 'ambientOcclusion'
  | 'animationRate'
  | 'terrainDetail';

export type RenderBudgetSample = {
  readonly cpuMs: number;
  readonly gpuMs: number;
  readonly frameMs: number;
  readonly memoryMb?: number;
  readonly drawCalls?: number;
  readonly triangles?: number;
  readonly timestampMs?: number;
};

export type RenderBudgetDecision = {
  readonly tier: RenderTier;
  readonly changed: boolean;
  readonly reason:
    | 'initial'
    | 'stable'
    | 'cpu-pressure'
    | 'gpu-pressure'
    | 'memory-pressure'
    | 'recovery';
  readonly scale: number;
  readonly pixelRatioCap: number;
  readonly features: Readonly<Record<RenderFeature, boolean>>;
  readonly budgets: Readonly<{
    frameMs: number;
    cpuMs: number;
    gpuMs: number;
    drawCalls: number;
    triangles: number;
    memoryMb: number;
  }>;
};

export type RenderBudgetOptions = {
  readonly initialTier?: RenderTier;
  readonly targetFrameMs?: number;
  readonly upshiftDelaySamples?: number;
  readonly downshiftDelaySamples?: number;
  readonly smoothingFactor?: number;
  readonly minScale?: number;
  readonly maxScale?: number;
};

type TierConfig = {
  readonly scale: number;
  readonly pixelRatioCap: number;
  readonly frameMs: number;
  readonly cpuMs: number;
  readonly gpuMs: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly memoryMb: number;
  readonly features: Readonly<Record<RenderFeature, boolean>>;
};

const FEATURES: readonly RenderFeature[] = [
  'shadows',
  'contactShadows',
  'volumetrics',
  'waterReflections',
  'vegetationDensity',
  'particleDensity',
  'postProcessing',
  'ambientOcclusion',
  'animationRate',
  'terrainDetail',
];

const TIERS: Readonly<Record<RenderTier, TierConfig>> = {
  ultra: {
    scale: 1,
    pixelRatioCap: 2,
    frameMs: 16.67,
    cpuMs: 7.5,
    gpuMs: 10,
    drawCalls: 3000,
    triangles: 4_500_000,
    memoryMb: 900,
    features: {
      shadows: true,
      contactShadows: true,
      volumetrics: true,
      waterReflections: true,
      vegetationDensity: true,
      particleDensity: true,
      postProcessing: true,
      ambientOcclusion: true,
      animationRate: true,
      terrainDetail: true,
    },
  },
  high: {
    scale: 0.94,
    pixelRatioCap: 1.75,
    frameMs: 18,
    cpuMs: 8,
    gpuMs: 11,
    drawCalls: 2400,
    triangles: 3_600_000,
    memoryMb: 760,
    features: {
      shadows: true,
      contactShadows: true,
      volumetrics: true,
      waterReflections: true,
      vegetationDensity: true,
      particleDensity: true,
      postProcessing: true,
      ambientOcclusion: true,
      animationRate: true,
      terrainDetail: true,
    },
  },
  balanced: {
    scale: 0.87,
    pixelRatioCap: 1.5,
    frameMs: 20,
    cpuMs: 9,
    gpuMs: 12.5,
    drawCalls: 1900,
    triangles: 2_800_000,
    memoryMb: 640,
    features: {
      shadows: true,
      contactShadows: true,
      volumetrics: false,
      waterReflections: true,
      vegetationDensity: true,
      particleDensity: true,
      postProcessing: true,
      ambientOcclusion: true,
      animationRate: true,
      terrainDetail: true,
    },
  },
  performance: {
    scale: 0.76,
    pixelRatioCap: 1.25,
    frameMs: 24,
    cpuMs: 10.5,
    gpuMs: 15,
    drawCalls: 1350,
    triangles: 1_950_000,
    memoryMb: 520,
    features: {
      shadows: false,
      contactShadows: false,
      volumetrics: false,
      waterReflections: false,
      vegetationDensity: true,
      particleDensity: false,
      postProcessing: false,
      ambientOcclusion: false,
      animationRate: true,
      terrainDetail: false,
    },
  },
  safe: {
    scale: 0.62,
    pixelRatioCap: 1,
    frameMs: 30,
    cpuMs: 12,
    gpuMs: 19,
    drawCalls: 900,
    triangles: 1_200_000,
    memoryMb: 420,
    features: {
      shadows: false,
      contactShadows: false,
      volumetrics: false,
      waterReflections: false,
      vegetationDensity: false,
      particleDensity: false,
      postProcessing: false,
      ambientOcclusion: false,
      animationRate: false,
      terrainDetail: false,
    },
  },
};

const ORDER: readonly RenderTier[] = [
  'safe',
  'performance',
  'balanced',
  'high',
  'ultra',
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function ema(previous: number, next: number, alpha: number): number {
  return previous + (next - previous) * alpha;
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function cloneTierFeatures(
  features: Readonly<Record<RenderFeature, boolean>>,
): Record<RenderFeature, boolean> {
  return { ...features };
}

export class RenderBudgetControllerV3 {
  readonly #targetFrameMs: number;
  readonly #upshiftDelaySamples: number;
  readonly #downshiftDelaySamples: number;
  readonly #alpha: number;
  readonly #minScale: number;
  readonly #maxScale: number;

  #tier: RenderTier;
  #lastDecision: RenderBudgetDecision;
  #averageFrameMs = 0;
  #averageCpuMs = 0;
  #averageGpuMs = 0;
  #averageMemoryMb = 0;
  #stableSamples = 0;
  #pressureSamples = 0;
  #lastTimestampMs = 0;

  constructor(options: RenderBudgetOptions = {}) {
    this.#tier = options.initialTier ?? 'balanced';
    this.#targetFrameMs = clamp(
      finite(options.targetFrameMs ?? 18,
      18),
      8,
      60,
    );
    this.#upshiftDelaySamples = clamp(
      Math.floor(options.upshiftDelaySamples ?? 90),
      10,
      2000,
    );
    this.#downshiftDelaySamples = clamp(
      Math.floor(options.downshiftDelaySamples ?? 12),
      2,
      500,
    );
    this.#alpha = clamp(options.smoothingFactor ?? 0.15, 0.02, 0.8);
    this.#minScale = clamp(options.minScale ?? 0.55, 0.25, 1);
    this.#maxScale = clamp(options.maxScale ?? 1, 0.5, 1.5);
    this.#lastDecision = this.#decision('initial', false);
  }

  get tier(): RenderTier {
    return this.#tier;
  }

  get averages(): {
    readonly frameMs: number;
    readonly cpuMs: number;
    readonly gpuMs: number;
    readonly memoryMb: number;
  } {
    return {
      frameMs: this.#averageFrameMs,
      cpuMs: this.#averageCpuMs,
      gpuMs: this.#averageGpuMs,
      memoryMb: this.#averageMemoryMb,
    };
  }

  update(sample: RenderBudgetSample): RenderBudgetDecision {
    const frameMs = Math.max(0, finite(sample.frameMs, 0));
    const cpuMs = Math.max(0, finite(sample.cpuMs, frameMs));
    const gpuMs = Math.max(0, finite(sample.gpuMs, frameMs));
    const memoryMb = Math.max(0, finite(sample.memoryMb ?? this.#averageMemoryMb, 0));

    if (this.#averageFrameMs === 0) {
      this.#averageFrameMs = frameMs;
      this.#averageCpuMs = cpuMs;
      this.#averageGpuMs = gpuMs;
      this.#averageMemoryMb = memoryMb;
    } else {
      this.#averageFrameMs = ema(this.#averageFrameMs, frameMs, this.#alpha);
      this.#averageCpuMs = ema(this.#averageCpuMs, cpuMs, this.#alpha);
      this.#averageGpuMs = ema(this.#averageGpuMs, gpuMs, this.#alpha);
      this.#averageMemoryMb = ema(this.#averageMemoryMb, memoryMb, this.#alpha);
    }

    if (sample.timestampMs !== undefined) {
      this.#lastTimestampMs = Math.max(this.#lastTimestampMs, finite(sample.timestampMs, 0));
    }

    const config = TIERS[this.#tier];
    const framePressure = this.#averageFrameMs > Math.max(this.#targetFrameMs, config.frameMs);
    const cpuPressure = this.#averageCpuMs > config.cpuMs * 1.15;
    const gpuPressure = this.#averageGpuMs > config.gpuMs * 1.15;
    const memoryPressure = this.#averageMemoryMb > config.memoryMb * 1.1;

    const pressured = framePressure || cpuPressure || gpuPressure || memoryPressure;
    if (pressured) {
      this.#pressureSamples += 1;
      this.#stableSamples = 0;
    } else {
      this.#stableSamples += 1;
      this.#pressureSamples = 0;
    }

    if (this.#pressureSamples >= this.#downshiftDelaySamples) {
      const reason = memoryPressure
        ? 'memory-pressure'
        : gpuPressure
          ? 'gpu-pressure'
          : 'cpu-pressure';
      const changed = this.#shift(-1);
      this.#lastDecision = this.#decision(reason, changed);
      this.#pressureSamples = 0;
      return this.#lastDecision;
    }

    if (
      this.#stableSamples >= this.#upshiftDelaySamples &&
      this.#averageFrameMs < this.#targetFrameMs * 0.78 &&
      this.#averageCpuMs < config.cpuMs * 0.8 &&
      this.#averageGpuMs < config.gpuMs * 0.8
    ) {
      const changed = this.#shift(1);
      this.#lastDecision = this.#decision(changed ? 'recovery' : 'stable', changed);
      this.#stableSamples = 0;
      return this.#lastDecision;
    }

    this.#lastDecision = this.#decision('stable', false);
    return this.#lastDecision;
  }

  #shift(direction: -1 | 1): boolean {
    const index = ORDER.indexOf(this.#tier);
    const nextIndex = clamp(index + direction, 0, ORDER.length - 1);
    const nextTier = ORDER[nextIndex];
    if (nextTier === undefined || nextTier === this.#tier) {
      return false;
    }
    this.#tier = nextTier;
    return true;
  }

  #decision(
    reason: RenderBudgetDecision['reason'],
    changed: boolean,
  ): RenderBudgetDecision {
    const config = TIERS[this.#tier];
    const scale = clamp(config.scale, this.#minScale, this.#maxScale);
    return {
      tier: this.#tier,
      changed,
      reason,
      scale,
      pixelRatioCap: clamp(config.pixelRatioCap, 0.5, 3),
      features: cloneTierFeatures(config.features),
      budgets: {
        frameMs: config.frameMs,
        cpuMs: config.cpuMs,
        gpuMs: config.gpuMs,
        drawCalls: config.drawCalls,
        triangles: config.triangles,
        memoryMb: config.memoryMb,
      },
    };
  }

  forceTier(tier: RenderTier, reason: RenderBudgetDecision['reason'] = 'recovery'): RenderBudgetDecision {
    this.#tier = tier;
    this.#pressureSamples = 0;
    this.#stableSamples = 0;
    this.#lastDecision = this.#decision(reason, true);
    return this.#lastDecision;
  }

  featureEnabled(feature: RenderFeature): boolean {
    return this.#lastDecision.features[feature];
  }

  budget(): RenderBudgetDecision {
    return this.#lastDecision;
  }

  qualityScale(): number {
    return this.#lastDecision.scale;
  }

  serialize(): {
    readonly tier: RenderTier;
    readonly averages: RenderBudgetControllerV3['averages'];
    readonly lastTimestampMs: number;
    readonly stableSamples: number;
    readonly pressureSamples: number;
  } {
    return {
      tier: this.#tier,
      averages: this.averages,
      lastTimestampMs: this.#lastTimestampMs,
      stableSamples: this.#stableSamples,
      pressureSamples: this.#pressureSamples,
    };
  }
}

export function renderTierConfig(tier: RenderTier): TierConfig {
  const config = TIERS[tier];
  return {
    ...config,
    features: cloneTierFeatures(config.features),
  };
}

export function allRenderTiers(): readonly RenderTier[] {
  return [...ORDER].reverse();
}

export function allRenderFeatures(): readonly RenderFeature[] {
  return [...FEATURES];
}
