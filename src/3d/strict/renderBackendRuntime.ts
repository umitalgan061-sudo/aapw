import type { RenderCapabilities, RenderPolicy, RendererBackend, QualityTier } from './liveCoreTypes.ts';
import { clamp, finite } from './liveCoreTypes.ts';

export interface RendererPreference {
  readonly backend: 'auto' | 'webgpu' | 'webgl2';
  readonly quality: QualityTier | 'auto';
  readonly reducedMotion?: boolean;
  readonly saveData?: boolean;
  readonly batterySaver?: boolean;
  readonly thermalPressure?: number;
}

export interface CapabilityProbe {
  readonly gpuAdapterAvailable?: boolean;
  readonly webgl2ContextAvailable?: boolean;
  readonly secureContext?: boolean;
  readonly offscreenCanvas?: boolean;
  readonly hardwareConcurrency?: number;
  readonly memoryGiB?: number;
  readonly devicePixelRatio?: number;
}

const qualityRank: Readonly<Record<QualityTier, number>> = Object.freeze({
  minimal: 0, low: 1, medium: 2, high: 3, ultra: 4,
});

const scaleForQuality: Readonly<Record<QualityTier, number>> = Object.freeze({
  minimal: 0.6, low: 0.72, medium: 0.82, high: 0.92, ultra: 1,
});

const pixelCapForQuality: Readonly<Record<QualityTier, number>> = Object.freeze({
  minimal: 1, low: 1.25, medium: 1.5, high: 2, ultra: 2.5,
});

export const probeRenderCapabilities = (input: CapabilityProbe = {}): RenderCapabilities => {
  const hardwareConcurrency = Math.max(1, Math.floor(input.hardwareConcurrency ?? 4));
  const memoryGiB = Math.max(1, input.memoryGiB ?? 4);
  const secureContext = input.secureContext ?? (typeof globalThis.isSecureContext === 'boolean' ? globalThis.isSecureContext : false);
  const webgpu = Boolean(input.gpuAdapterAvailable);
  const webgl2 = Boolean(input.webgl2ContextAvailable);
  const offscreenCanvas = Boolean(input.offscreenCanvas);
  const devicePixelRatio = clamp(input.devicePixelRatio ?? 1, 1, 3);
  return Object.freeze({
    secureContext,
    webgpu,
    webgl2,
    offscreenCanvas,
    hardwareConcurrency,
    memoryGiB,
    devicePixelRatio,
  });
};

export const chooseRendererBackend = (
  capabilities: RenderCapabilities,
  preference: RendererPreference['backend'] = 'auto',
): RendererBackend => {
  if (preference === 'webgpu' && capabilities.secureContext && capabilities.webgpu) return 'webgpu';
  if (preference === 'webgl2' && capabilities.webgl2) return 'webgl2';
  if (preference === 'auto' && capabilities.secureContext && capabilities.webgpu) return 'webgpu';
  if (capabilities.webgl2) return 'webgl2';
  return 'headless';
};

export const inferQualityTier = (
  capabilities: RenderCapabilities,
  preference: RendererPreference,
): QualityTier => {
  if (preference.quality !== 'auto') return preference.quality;
  const memoryScore = clamp((capabilities.memoryGiB - 2) / 14, 0, 1);
  const cpuScore = clamp((capabilities.hardwareConcurrency - 2) / 14, 0, 1);
  const gpuScore = capabilities.webgpu ? 1 : capabilities.webgl2 ? 0.65 : 0.2;
  const mobilePenalty = preference.saveData || preference.batterySaver ? -0.2 : 0;
  const thermalPenalty = clamp(preference.thermalPressure ?? 0, 0, 1) * -0.45;
  const motionPenalty = preference.reducedMotion ? -0.1 : 0;
  const score = clamp(memoryScore * 0.3 + cpuScore * 0.25 + gpuScore * 0.45 + mobilePenalty + thermalPenalty + motionPenalty, 0, 1);
  if (score >= 0.86) return 'ultra';
  if (score >= 0.68) return 'high';
  if (score >= 0.47) return 'medium';
  if (score >= 0.28) return 'low';
  return 'minimal';
};

export const buildStrictRenderPolicy = (
  capabilities: RenderCapabilities,
  preference: RendererPreference = { backend: 'auto', quality: 'auto' },
): RenderPolicy => {
  const backend = chooseRendererBackend(capabilities, preference.backend);
  const tier = inferQualityTier(capabilities, preference);
  const tierScale = scaleForQuality[tier];
  const thermal = clamp(preference.thermalPressure ?? 0, 0, 1);
  const renderScale = clamp(tierScale * (1 - thermal * 0.35) * (preference.saveData ? 0.88 : 1), 0.5, 1);
  const cap = Math.min(pixelCapForQuality[tier], capabilities.devicePixelRatio);
  const canPost = backend !== 'headless' && tier !== 'minimal' && !preference.reducedMotion;
  const canTemporal = backend === 'webgpu' ? tier !== 'minimal' : tier === 'ultra' || tier === 'high';
  return Object.freeze({
    backend,
    tier,
    renderScale,
    pixelRatioCap: cap,
    shadows: backend !== 'headless' && tierRankAtLeast(tier, 'medium') && thermal < 0.9,
    postProcessing: canPost,
    temporalEffects: canTemporal,
    maxVisibleInstances: visibleBudget(tier, capabilities),
    maxTextureMegabytes: textureBudget(tier, capabilities),
  });
};

export const tierRankAtLeast = (tier: QualityTier, minimum: QualityTier): boolean =>
  qualityRank[tier] >= qualityRank[minimum];

const visibleBudget = (tier: QualityTier, capabilities: RenderCapabilities): number => {
  const base: Readonly<Record<QualityTier, number>> = Object.freeze({
    minimal: 900, low: 1800, medium: 3200, high: 5200, ultra: 8000,
  });
  const hardwareMultiplier = clamp(capabilities.hardwareConcurrency / 8, 0.5, 2);
  const memoryMultiplier = clamp(capabilities.memoryGiB / 8, 0.5, 2);
  return Math.floor(base[tier] * Math.min(hardwareMultiplier, memoryMultiplier));
};

const textureBudget = (tier: QualityTier, capabilities: RenderCapabilities): number => {
  const base: Readonly<Record<QualityTier, number>> = Object.freeze({
    minimal: 192, low: 320, medium: 512, high: 768, ultra: 1024,
  });
  return Math.floor(base[tier] * clamp(capabilities.memoryGiB / 8, 0.5, 1.5));
};

export interface BackendTransition {
  readonly from: RendererBackend;
  readonly to: RendererBackend;
  readonly reason: 'initial' | 'device-lost' | 'unavailable' | 'manual' | 'recovered';
  readonly generation: number;
}

export class StrictRenderBackendRuntime {
  #capabilities: RenderCapabilities;
  #preference: RendererPreference;
  #policy: RenderPolicy;
  #generation = 0;
  #disposed = false;
  #transitions: BackendTransition[] = [];

  constructor(
    capabilities: RenderCapabilities,
    preference: RendererPreference = { backend: 'auto', quality: 'auto' },
  ) {
    this.#capabilities = capabilities;
    this.#preference = preference;
    this.#policy = buildStrictRenderPolicy(capabilities, preference);
    this.#transitions.push(Object.freeze({
      from: 'headless',
      to: this.#policy.backend,
      reason: 'initial',
      generation: this.#generation,
    }));
  }

  policy(): RenderPolicy {
    return this.#policy;
  }

  capabilities(): RenderCapabilities {
    return this.#capabilities;
  }

  requestPreference(preference: RendererPreference): RenderPolicy {
    if (this.#disposed) return this.#policy;
    const previous = this.#policy.backend;
    this.#preference = preference;
    this.#policy = buildStrictRenderPolicy(this.#capabilities, this.#preference);
    if (previous !== this.#policy.backend) this.#recordTransition(previous, this.#policy.backend, 'manual');
    return this.#policy;
  }

  markDeviceLost(): RenderPolicy {
    if (this.#disposed) return this.#policy;
    const previous = this.#policy.backend;
    this.#generation += 1;
    this.#capabilities = Object.freeze({ ...this.#capabilities, webgpu: false });
    this.#policy = buildStrictRenderPolicy(this.#capabilities, { ...this.#preference, backend: 'auto' });
    if (previous !== this.#policy.backend) this.#recordTransition(previous, this.#policy.backend, 'device-lost');
    return this.#policy;
  }

  refreshCapabilities(capabilities: RenderCapabilities): RenderPolicy {
    if (this.#disposed) return this.#policy;
    const previous = this.#policy.backend;
    this.#capabilities = capabilities;
    this.#policy = buildStrictRenderPolicy(capabilities, this.#preference);
    const reason = previous === 'webgl2' && this.#policy.backend === 'webgpu' ? 'recovered' : 'unavailable';
    if (previous !== this.#policy.backend) this.#recordTransition(previous, this.#policy.backend, reason);
    return this.#policy;
  }

  transitions(): readonly BackendTransition[] {
    return Object.freeze([...this.#transitions]);
  }

  digest(): string {
    return JSON.stringify({
      generation: this.#generation,
      backend: this.#policy.backend,
      tier: this.#policy.tier,
      renderScale: Number(this.#policy.renderScale.toFixed(4)),
    });
  }

  dispose(): void {
    this.#disposed = true;
    this.#transitions = [];
  }

  #recordTransition(
    from: RendererBackend,
    to: RendererBackend,
    reason: BackendTransition['reason'],
  ): void {
    this.#transitions.push(Object.freeze({
      from,
      to,
      reason,
      generation: this.#generation,
    }));
    if (this.#transitions.length > 32) this.#transitions.shift();
  }
}

export const renderCostEnvelope = (
  policy: RenderPolicy,
  drawCalls: number,
  triangles: number,
): Readonly<{
  estimatedGeometryMs: number;
  estimatedPostMs: number;
  estimatedTotalMs: number;
  budgetMs: number;
}> => {
  const normalizedDraws = Math.max(0, finite(drawCalls));
  const normalizedTriangles = Math.max(0, finite(triangles));
  const geometry = normalizedDraws * (policy.backend === 'webgpu' ? 0.009 : 0.013) +
    normalizedTriangles / 1_000_000 * (policy.backend === 'webgpu' ? 0.7 : 1.1);
  const post = policy.postProcessing ? 1.1 * (1 / Math.max(0.5, policy.renderScale)) : 0.25;
  const total = geometry + post;
  return Object.freeze({
    estimatedGeometryMs: geometry,
    estimatedPostMs: post,
    estimatedTotalMs: total,
    budgetMs: 16.67,
  });
};