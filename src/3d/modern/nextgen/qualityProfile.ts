import { clamp } from './types.ts';

export type QualityTier = 'ultra' | 'high' | 'balanced' | 'performance' | 'mobile';

export interface DeviceSignals {
  coarsePointer: boolean;
  hardwareConcurrency: number;
  deviceMemoryGb?: number;
  pixelRatio: number;
  maxTextureSize?: number;
  supportsWebGPU: boolean;
  reducedMotion: boolean;
}

export interface QualityProfile {
  tier: QualityTier;
  renderScale: number;
  pixelRatioCap: number;
  shadowMapSize: number;
  maxVisibleEntities: number;
  maxLights: number;
  terrainSegments: number;
  vegetationDensity: number;
  effectDensity: number;
  animationBudgetMs: number;
  simulationBudgetMs: number;
}

const PROFILES: Record<QualityTier, QualityProfile> = {
  ultra: { tier: 'ultra', renderScale: 1, pixelRatioCap: 2.5, shadowMapSize: 4096, maxVisibleEntities: 18000, maxLights: 256, terrainSegments: 192, vegetationDensity: 1, effectDensity: 1, animationBudgetMs: 3.5, simulationBudgetMs: 5 },
  high: { tier: 'high', renderScale: 1, pixelRatioCap: 2, shadowMapSize: 3072, maxVisibleEntities: 12000, maxLights: 192, terrainSegments: 160, vegetationDensity: 0.85, effectDensity: 0.9, animationBudgetMs: 3, simulationBudgetMs: 6 },
  balanced: { tier: 'balanced', renderScale: 0.92, pixelRatioCap: 1.75, shadowMapSize: 2048, maxVisibleEntities: 9000, maxLights: 128, terrainSegments: 128, vegetationDensity: 0.7, effectDensity: 0.8, animationBudgetMs: 2.5, simulationBudgetMs: 7 },
  performance: { tier: 'performance', renderScale: 0.8, pixelRatioCap: 1.5, shadowMapSize: 1536, maxVisibleEntities: 6500, maxLights: 96, terrainSegments: 96, vegetationDensity: 0.55, effectDensity: 0.65, animationBudgetMs: 2, simulationBudgetMs: 8 },
  mobile: { tier: 'mobile', renderScale: 0.72, pixelRatioCap: 1.25, shadowMapSize: 1024, maxVisibleEntities: 3500, maxLights: 48, terrainSegments: 72, vegetationDensity: 0.35, effectDensity: 0.5, animationBudgetMs: 1.25, simulationBudgetMs: 10 },
};

export function detectQualityTier(signals: DeviceSignals): QualityTier {
  if (signals.coarsePointer || signals.reducedMotion) return 'mobile';
  const memory = signals.deviceMemoryGb ?? 8;
  const cores = Math.max(1, signals.hardwareConcurrency || 1);
  const texture = signals.maxTextureSize ?? 2048;
  if (signals.supportsWebGPU && memory >= 12 && cores >= 12 && texture >= 4096 && signals.pixelRatio <= 2) return 'ultra';
  if (memory >= 8 && cores >= 8 && texture >= 4096) return 'high';
  if (memory >= 6 && cores >= 6) return 'balanced';
  return 'performance';
}

export function resolveQualityProfile(signals: DeviceSignals, requested?: QualityTier): QualityProfile {
  const tier = requested && isTier(requested) ? requested : detectQualityTier(signals);
  return { ...PROFILES[tier] };
}

export function tuneProfile(profile: QualityProfile, frameTimeMs: number, targetFrameTimeMs = 16.67): QualityProfile {
  const ratio = clamp(targetFrameTimeMs / Math.max(1, frameTimeMs), 0.65, 1.15);
  if (ratio > 1.03) {
    return {
      ...profile,
      renderScale: clamp(profile.renderScale * Math.min(1.05, ratio), 0.6, 1),
      vegetationDensity: clamp(profile.vegetationDensity * 1.03, 0.2, 1),
      effectDensity: clamp(profile.effectDensity * 1.03, 0.2, 1),
    };
  }
  if (ratio < 0.97) {
    return {
      ...profile,
      renderScale: clamp(profile.renderScale * Math.max(0.9, ratio), 0.6, 1),
      vegetationDensity: clamp(profile.vegetationDensity * 0.92, 0.15, 1),
      effectDensity: clamp(profile.effectDensity * 0.92, 0.15, 1),
      maxVisibleEntities: Math.max(1500, Math.floor(profile.maxVisibleEntities * 0.95)),
    };
  }
  return { ...profile };
}

export class AdaptiveQualityController {
  #profile: QualityProfile;
  #samples = 0;
  #stableFrames = 0;

  constructor(initial: QualityProfile) { this.#profile = { ...initial }; }

  observe(frameTimeMs: number, target = 16.67): QualityProfile {
    this.#samples += 1;
    const next = tuneProfile(this.#profile, frameTimeMs, target);
    const materiallyChanged = Math.abs(next.renderScale - this.#profile.renderScale) > 0.01 || next.maxVisibleEntities !== this.#profile.maxVisibleEntities;
    if (materiallyChanged) this.#profile = next;
    else this.#stableFrames += 1;
    return { ...this.#profile };
  }

  get profile(): QualityProfile { return { ...this.#profile }; }
  get samples(): number { return this.#samples; }
  get stableFrames(): number { return this.#stableFrames; }
}

function isTier(value: string): value is QualityTier {
  return value === 'ultra' || value === 'high' || value === 'balanced' || value === 'performance' || value === 'mobile';
}
