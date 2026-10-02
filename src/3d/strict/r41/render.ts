
import type { QualityTier, RenderFeature, RenderInput, RenderPlan } from './types.ts';
import { clamp, finite } from './types.ts';

export interface RenderGovernorOptions {
  readonly initialTier?: QualityTier;
  readonly minScale?: number;
  readonly maxScale?: number;
  readonly targetFrameMs?: number;
}

const ORDER: readonly QualityTier[] = Object.freeze(['minimal', 'low', 'balanced', 'high', 'ultra']);

const FEATURES: Readonly<Record<QualityTier, readonly RenderFeature[]>> = Object.freeze({
  minimal: Object.freeze(['fog', 'instancing']),
  low: Object.freeze(['fog', 'instancing', 'dynamicResolution']),
  balanced: Object.freeze(['fog', 'instancing', 'dynamicResolution', 'taa', 'occlusionHints']),
  high: Object.freeze(['fog', 'instancing', 'dynamicResolution', 'taa', 'temporalHistory', 'occlusionHints', 'motionVectors', 'ssao', 'bloom']),
  ultra: Object.freeze(['fog', 'instancing', 'dynamicResolution', 'taa', 'temporalHistory', 'occlusionHints', 'motionVectors', 'ssao', 'bloom', 'multiview', 'textureCompression']),
});

export class RenderGovernorR41 {
  #tier: QualityTier;
  #scale: number;
  readonly minScale: number;
  readonly maxScale: number;
  readonly targetFrameMs: number;
  #badFrames = 0;
  #goodFrames = 0;
  #historyValid = false;

  constructor(options: RenderGovernorOptions = {}) {
    this.#tier = options.initialTier ?? 'balanced';
    this.minScale = clamp(finite(options.minScale, 0.55), 0.35, 1);
    this.maxScale = clamp(finite(options.maxScale, 1), this.minScale, 1.2);
    this.targetFrameMs = clamp(finite(options.targetFrameMs, 16.67), 8, 33.33);
    this.#scale = clamp(0.9, this.minScale, this.maxScale);
  }

  get tier(): QualityTier { return this.#tier; }
  get scale(): number { return this.#scale; }
  get historyValid(): boolean { return this.#historyValid; }

  decide(input: RenderInput): RenderPlan {
    const pressure = this.pressure(input);
    const previousTier = this.#tier;
    const previousScale = this.#scale;

    if (pressure > 1.12) {
      this.#badFrames += 1;
      this.#goodFrames = 0;
    } else if (pressure < 0.76) {
      this.#goodFrames += 1;
      this.#badFrames = 0;
    } else {
      this.#badFrames = 0;
      this.#goodFrames = 0;
    }

    let reason = 'steady';

    if (pressure > 1.8 || this.#badFrames >= 4) {
      this.#tier = stepTier(this.#tier, -1);
      this.#scale = clamp(this.#scale - 0.06, this.minScale, this.maxScale);
      this.#badFrames = 0;
      reason = pressure > 1.8 ? 'panic-downgrade' : 'sustained-pressure';
    } else if (this.#goodFrames >= 45) {
      this.#tier = stepTier(this.#tier, 1);
      this.#scale = clamp(this.#scale + 0.04, this.minScale, this.maxScale);
      this.#goodFrames = 0;
      reason = 'sustained-headroom';
    } else {
      this.#scale = clamp(this.#scale + (this.targetFrameMs - finite(input.frameMs, this.targetFrameMs)) * 0.004, this.minScale, this.maxScale);
      if (input.memoryPressure > 0.9) {
        this.#scale = clamp(this.#scale - 0.03, this.minScale, this.maxScale);
        reason = 'memory-pressure';
      }
      if (input.thermalPressure > 0.9) {
        this.#scale = clamp(this.#scale - 0.04, this.minScale, this.maxScale);
        reason = 'thermal-pressure';
      }
      if (input.cameraCut) reason = 'camera-cut';
    }

    if (input.cameraCut || previousTier !== this.#tier || Math.abs(previousScale - this.#scale) > 0.0001) this.#historyValid = false;

    const enabled = negotiateFeatures(input, this.#tier);
    if (!input.reducedMotion && enabled.includes('temporalHistory') && !input.cameraCut) this.#historyValid = true;

    return Object.freeze({
      backend: selectBackend(input),
      tier: this.#tier,
      scale: this.#scale,
      pixelRatioCap: pixelRatioFor(this.#tier),
      enabledFeatures: Object.freeze(enabled),
      disabledFeatures: Object.freeze(input.requestedFeatures.filter(feature => !enabled.includes(feature))),
      historyValid: this.#historyValid,
      reason,
      budgetMs: budgetFor(this.#tier),
    });
  }

  pressure(input: RenderInput): number {
    const frame = finite(input.frameMs, this.targetFrameMs) / this.targetFrameMs;
    const cpu = finite(input.cpuMs, this.targetFrameMs) / this.targetFrameMs;
    const gpu = input.gpuMs === null ? cpu : finite(input.gpuMs, this.targetFrameMs) / this.targetFrameMs;
    const resources = Math.max(
      1 + clamp(input.memoryPressure, 0, 1.5) * 0.65,
      1 + clamp(input.thermalPressure, 0, 1.5) * 0.75,
    );
    return Math.max(frame, cpu, gpu) * resources;
  }

  reset(tier: QualityTier = 'balanced'): void {
    this.#tier = tier;
    this.#scale = clamp(0.9, this.minScale, this.maxScale);
    this.#badFrames = 0;
    this.#goodFrames = 0;
    this.#historyValid = false;
  }

  snapshot(): Readonly<{ tier: QualityTier; scale: number; historyValid: boolean; badFrames: number; goodFrames: number }> {
    return Object.freeze({
      tier: this.#tier,
      scale: this.#scale,
      historyValid: this.#historyValid,
      badFrames: this.#badFrames,
      goodFrames: this.#goodFrames,
    });
  }
}

export class RenderFeatureNegotiatorR41 {
  negotiate(input: RenderInput, tier: QualityTier): readonly RenderFeature[] {
    return Object.freeze(negotiateFeatures(input, tier));
  }
}

function negotiateFeatures(input: RenderInput, tier: QualityTier): RenderFeature[] {
  const enabled = new Set(FEATURES[tier]);
  const requested = new Set(input.requestedFeatures);
  for (const feature of [...enabled]) if (!requested.has(feature)) enabled.delete(feature);
  if (!input.webgpuAvailable) enabled.delete('multiview');
  if (!input.textureCompression) enabled.delete('textureCompression');
  if (input.reducedMotion) enabled.delete('temporalHistory');
  if (input.saveData || input.thermalPressure > 0.75) {
    enabled.delete('bloom');
    enabled.delete('ssao');
  }
  if (input.visibility < 0.08) {
    enabled.delete('motionVectors');
    enabled.delete('ssao');
  }
  return [...enabled].sort();
}

function selectBackend(input: RenderInput): 'webgl2' | 'webgpu' | 'headless' {
  if (input.backend === 'headless') return 'headless';
  return input.backend === 'webgpu' && input.webgpuAvailable ? 'webgpu' : 'webgl2';
}

function stepTier(tier: QualityTier, direction: -1 | 1): QualityTier {
  const index = Math.max(0, Math.min(ORDER.length - 1, ORDER.indexOf(tier) + direction));
  return ORDER[index] ?? 'balanced';
}

function pixelRatioFor(tier: QualityTier): number {
  if (tier === 'minimal') return 1;
  if (tier === 'low') return 1.25;
  if (tier === 'balanced') return 1.5;
  if (tier === 'high') return 2;
  return 2.5;
}

function budgetFor(tier: QualityTier): number {
  if (tier === 'minimal') return 7;
  if (tier === 'low') return 8.5;
  if (tier === 'balanced') return 10;
  if (tier === 'high') return 12;
  return 14;
}
