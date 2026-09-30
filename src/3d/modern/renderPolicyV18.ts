/**
 * AAPW Render Policy V18.
 *
 * Produces an explicit presentation decision from capability, frame, memory,
 * thermal and accessibility signals. It never mutates a renderer directly.
 */

export type RenderTierV18 = 'minimal' | 'balanced' | 'high' | 'ultra';

export type RenderBackendV18 = 'webgl2' | 'webgpu' | 'auto';

export interface RenderCapabilitiesV18 {
  readonly webgl2: boolean;
  readonly webgpu: boolean;
  readonly maxTextureSize: number;
  readonly maxSamples: number;
  readonly deviceMemoryGb?: number;
  readonly hardwareConcurrency?: number;
  readonly coarsePointer?: boolean;
  readonly prefersReducedMotion?: boolean;
  readonly saveData?: boolean;
}

export interface RenderObservationV18 {
  readonly frameMs: number;
  readonly cpuMs: number;
  readonly gpuMs: number;
  readonly memoryPressure: number;
  readonly thermalPressure: number;
  readonly drawCalls: number;
  readonly visibleObjects: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly timestampMs: number;
}

export interface RenderPolicyDecisionV18 {
  readonly tier: RenderTierV18;
  readonly backend: RenderBackendV18;
  readonly pixelRatio: number;
  readonly shadowMapSize: number;
  readonly antialiasing: boolean;
  readonly postProcessing: boolean;
  readonly volumetricEffects: boolean;
  readonly vegetationDensity: number;
  readonly particleDensity: number;
  readonly textureScale: number;
  readonly lodBias: number;
  readonly targetFrameMs: number;
  readonly pressure: number;
  readonly reason: readonly string[];
  readonly revision: number;
}

export interface RenderPolicyOptionsV18 {
  readonly initialTier?: RenderTierV18;
  readonly preferredBackend?: RenderBackendV18;
  readonly locked?: boolean;
  readonly minPixelRatio?: number;
  readonly maxPixelRatio?: number;
  readonly targetFrameMs?: number;
  readonly downgradeFrames?: number;
  readonly upgradeFrames?: number;
  readonly clock?: () => number;
}

const TIER_LEVEL: Readonly<Record<RenderTierV18, number>> = {
  minimal: 0,
  balanced: 1,
  high: 2,
  ultra: 3,
};

const BASE: Readonly<Record<RenderTierV18, Omit<RenderPolicyDecisionV18, 'tier' | 'backend' | 'pressure' | 'reason' | 'revision'>>> = {
  minimal: {
    pixelRatio: 0.7,
    shadowMapSize: 512,
    antialiasing: false,
    postProcessing: false,
    volumetricEffects: false,
    vegetationDensity: 0.35,
    particleDensity: 0.2,
    textureScale: 0.6,
    lodBias: 2.5,
    targetFrameMs: 33.33,
  },
  balanced: {
    pixelRatio: 0.85,
    shadowMapSize: 1024,
    antialiasing: true,
    postProcessing: false,
    volumetricEffects: false,
    vegetationDensity: 0.6,
    particleDensity: 0.45,
    textureScale: 0.8,
    lodBias: 1.5,
    targetFrameMs: 20,
  },
  high: {
    pixelRatio: 1,
    shadowMapSize: 2048,
    antialiasing: true,
    postProcessing: true,
    volumetricEffects: false,
    vegetationDensity: 0.82,
    particleDensity: 0.7,
    textureScale: 1,
    lodBias: 0.7,
    targetFrameMs: 16.67,
  },
  ultra: {
    pixelRatio: 1.25,
    shadowMapSize: 4096,
    antialiasing: true,
    postProcessing: true,
    volumetricEffects: true,
    vegetationDensity: 1,
    particleDensity: 0.9,
    textureScale: 1.25,
    lodBias: 0,
    targetFrameMs: 16.67,
  },
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function finite(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function tier(value: RenderTierV18): RenderTierV18 {
  return TIER_LEVEL[value] >= 0 ? value : 'balanced';
}

function capTier(
  requested: RenderTierV18,
  capabilities: RenderCapabilitiesV18,
): RenderTierV18 {
  let result = requested;
  const memory = capabilities.deviceMemoryGb ?? 4;
  const cores = capabilities.hardwareConcurrency ?? 4;

  if (!capabilities.webgl2 && requested !== 'minimal') result = 'minimal';
  if (memory <= 2 && TIER_LEVEL[result] > TIER_LEVEL.balanced) result = 'balanced';
  if (cores <= 2 && TIER_LEVEL[result] > TIER_LEVEL.balanced) result = 'balanced';
  if (capabilities.saveData && TIER_LEVEL[result] > TIER_LEVEL.balanced) result = 'balanced';
  if (capabilities.prefersReducedMotion && TIER_LEVEL[result] > TIER_LEVEL.high) result = 'high';

  return result;
}

export class RenderPolicyV18 {
  readonly #capabilities: RenderCapabilitiesV18;
  readonly #clock: () => number;
  readonly #minPixelRatio: number;
  readonly #maxPixelRatio: number;
  readonly #targetFrameMs: number;
  readonly #downgradeFrames: number;
  readonly #upgradeFrames: number;
  readonly #preferredBackend: RenderBackendV18;
  readonly #locked: boolean;

  #tier: RenderTierV18;
  #revision = 0;
  #pressureFrames = 0;
  #healthyFrames = 0;
  #lastDecision: RenderPolicyDecisionV18 | null = null;
  #backend: RenderBackendV18;

  public constructor(
    capabilities: RenderCapabilitiesV18,
    options: RenderPolicyOptionsV18 = {},
  ) {
    this.#capabilities = Object.freeze({ ...capabilities });
    this.#clock = options.clock ?? (() => performance.now());
    this.#minPixelRatio = clamp(finite(options.minPixelRatio, 0.5), 0.25, 1.5);
    this.#maxPixelRatio = clamp(
      finite(options.maxPixelRatio, 1.5),
      this.#minPixelRatio,
      3,
    );
    this.#targetFrameMs = clamp(finite(options.targetFrameMs, 16.67), 8, 100);
    this.#downgradeFrames = Math.max(1, Math.trunc(finite(options.downgradeFrames, 30)));
    this.#upgradeFrames = Math.max(1, Math.trunc(finite(options.upgradeFrames, 90)));
    this.#preferredBackend = options.preferredBackend ?? 'auto';
    this.#locked = Boolean(options.locked);
    this.#tier = capTier(tier(options.initialTier ?? 'balanced'), capabilities);
    this.#backend = this.#chooseBackend();
    this.#lastDecision = this.#buildDecision(0, ['initial']);
  }

  public get currentTier(): RenderTierV18 {
    return this.#tier;
  }

  public get backend(): RenderBackendV18 {
    return this.#backend;
  }

  public observe(observation: RenderObservationV18): RenderPolicyDecisionV18 {
    const pressure = this.#pressure(observation);

    if (!this.#locked) {
      if (pressure >= 0.8) {
        this.#pressureFrames += 1;
        this.#healthyFrames = 0;
      } else if (pressure <= 0.35) {
        this.#healthyFrames += 1;
        this.#pressureFrames = 0;
      } else {
        this.#pressureFrames = Math.max(0, this.#pressureFrames - 1);
        this.#healthyFrames = Math.max(0, this.#healthyFrames - 1);
      }

      if (this.#pressureFrames >= this.#downgradeFrames) {
        this.#setTier(this.#adjacentTier(-1));
        this.#pressureFrames = 0;
        this.#healthyFrames = 0;
      } else if (this.#healthyFrames >= this.#upgradeFrames) {
        this.#setTier(this.#adjacentTier(1));
        this.#pressureFrames = 0;
        this.#healthyFrames = 0;
      }
    }

    const reasons: string[] = [];
    if (pressure >= 0.8) reasons.push('sustained-pressure');
    if (observation.memoryPressure >= 0.8) reasons.push('memory-pressure');
    if (observation.thermalPressure >= 0.8) reasons.push('thermal-pressure');
    if (observation.frameMs > this.#targetFrameMs * 1.25) reasons.push('frame-time');
    if (this.#capabilities.prefersReducedMotion) reasons.push('reduced-motion-policy');
    if (this.#capabilities.saveData) reasons.push('save-data-policy');

    this.#lastDecision = this.#buildDecision(
      pressure,
      reasons.length > 0 ? reasons : ['stable'],
    );
    return this.#lastDecision;
  }

  public forceTier(requested: RenderTierV18, reason = 'manual'): RenderPolicyDecisionV18 {
    this.#tier = capTier(tier(requested), this.#capabilities);
    this.#revision += 1;
    this.#lastDecision = this.#buildDecision(0, [reason]);
    return this.#lastDecision;
  }

  public unlockForAdaptivePolicy(): RenderPolicyV18 {
    if (this.#locked) {
      return new RenderPolicyV18(this.#capabilities, {
        initialTier: this.#tier,
        preferredBackend: this.#preferredBackend,
        locked: false,
        minPixelRatio: this.#minPixelRatio,
        maxPixelRatio: this.#maxPixelRatio,
        targetFrameMs: this.#targetFrameMs,
        downgradeFrames: this.#downgradeFrames,
        upgradeFrames: this.#upgradeFrames,
        clock: this.#clock,
      });
    }
    return this;
  }

  public lock(): RenderPolicyV18 {
    return new RenderPolicyV18(this.#capabilities, {
      initialTier: this.#tier,
      preferredBackend: this.#preferredBackend,
      locked: true,
      minPixelRatio: this.#minPixelRatio,
      maxPixelRatio: this.#maxPixelRatio,
      targetFrameMs: this.#targetFrameMs,
      downgradeFrames: this.#downgradeFrames,
      upgradeFrames: this.#upgradeFrames,
      clock: this.#clock,
    });
  }

  public diagnostics(): Readonly<{
    tier: RenderTierV18;
    backend: RenderBackendV18;
    revision: number;
    pressureFrames: number;
    healthyFrames: number;
    locked: boolean;
    lastDecision: RenderPolicyDecisionV18 | null;
  }> {
    return Object.freeze({
      tier: this.#tier,
      backend: this.#backend,
      revision: this.#revision,
      pressureFrames: this.#pressureFrames,
      healthyFrames: this.#healthyFrames,
      locked: this.#locked,
      lastDecision: this.#lastDecision,
    });
  }

  #pressure(o: RenderObservationV18): number {
    const frameRatio = clamp(o.frameMs / this.#targetFrameMs, 0, 2);
    const cpuRatio = clamp(o.cpuMs / this.#targetFrameMs, 0, 2);
    const gpuRatio = clamp(o.gpuMs / this.#targetFrameMs, 0, 2);
    const memory = clamp(o.memoryPressure, 0, 2);
    const thermal = clamp(o.thermalPressure, 0, 2);
    const drawRatio = clamp(o.drawCalls / this.#drawBudget(), 0, 2);
    const objectRatio = clamp(o.visibleObjects / this.#objectBudget(), 0, 2);

    return clamp(
      frameRatio * 0.34 +
      cpuRatio * 0.18 +
      gpuRatio * 0.22 +
      memory * 0.1 +
      thermal * 0.08 +
      drawRatio * 0.04 +
      objectRatio * 0.04,
      0,
      2,
    );
  }

  #drawBudget(): number {
    const memory = this.#capabilities.deviceMemoryGb ?? 4;
    if (memory <= 2) return 800;
    if (memory <= 4) return 1600;
    if (memory <= 8) return 2800;
    return 5000;
  }

  #objectBudget(): number {
    const cores = this.#capabilities.hardwareConcurrency ?? 4;
    return Math.max(400, cores * 350);
  }

  #adjacentTier(direction: -1 | 1): RenderTierV18 {
    const level = TIER_LEVEL[this.#tier] + direction;
    const clamped = clamp(level, 0, 3);
    return ([ 'minimal', 'balanced', 'high', 'ultra' ] as const)[clamped] ?? 'balanced';
  }

  #setTier(next: RenderTierV18): void {
    const bounded = capTier(next, this.#capabilities);
    if (bounded === this.#tier) return;
    this.#tier = bounded;
    this.#revision += 1;
  }

  #chooseBackend(): RenderBackendV18 {
    if (this.#preferredBackend === 'webgpu' && this.#capabilities.webgpu) return 'webgpu';
    if (this.#preferredBackend === 'webgl2' && this.#capabilities.webgl2) return 'webgl2';
    if (this.#preferredBackend === 'auto' && this.#capabilities.webgpu) return 'webgpu';
    if (this.#capabilities.webgl2) return 'webgl2';
    if (this.#capabilities.webgpu) return 'webgpu';
    return 'auto';
  }

  #buildDecision(pressure: number, reasons: readonly string[]): RenderPolicyDecisionV18 {
    const base = BASE[this.#tier];
    const constrained =
      (this.#capabilities.deviceMemoryGb ?? 4) <= 2 ||
      this.#capabilities.saveData ||
      this.#capabilities.coarsePointer;

    const pixelRatio = clamp(
      base.pixelRatio *
        (constrained ? 0.88 : 1) *
        (pressure > 0.8 ? clamp(1 - pressure * 0.2, 0.65, 1) : 1),
      this.#minPixelRatio,
      this.#maxPixelRatio,
    );

    return Object.freeze({
      tier: this.#tier,
      backend: this.#backend,
      pixelRatio,
      shadowMapSize: constrained ? Math.min(1024, base.shadowMapSize) : base.shadowMapSize,
      antialiasing: base.antialiasing && pressure < 1,
      postProcessing: base.postProcessing && pressure < 0.95,
      volumetricEffects: base.volumetricEffects && pressure < 0.8,
      vegetationDensity: clamp(base.vegetationDensity * (pressure > 0.8 ? 0.8 : 1), 0.1, 1),
      particleDensity: clamp(base.particleDensity * (pressure > 0.75 ? 0.7 : 1), 0.05, 1),
      textureScale: clamp(base.textureScale * (pressure > 0.85 ? 0.8 : 1), 0.5, 1.25),
      lodBias: base.lodBias + Math.max(0, pressure - 0.4) * 2,
      targetFrameMs: base.targetFrameMs,
      pressure,
      reason: Object.freeze([...new Set(reasons)]),
      revision: this.#revision,
    });
  }

  public get createdAtMs(): number {
    return this.#clock();
  }
}