import type { QualityTier } from './types.ts';
import { clamp, finite } from './math.ts';

export interface QualityProfile {
  readonly tier: QualityTier;
  readonly pixelRatio: number;
  readonly shadowMap: number;
  readonly viewDistance: number;
  readonly effectsScale: number;
  readonly maxAnimatedEntities: number;
  readonly maxAudioSources: number;
}

export interface QualityPolicyConfig {
  readonly minTier: QualityTier;
  readonly maxTier: QualityTier;
  readonly mobileTier: QualityTier;
}

const TIERS: readonly QualityTier[] = Object.freeze(['minimal', 'low', 'balanced', 'high', 'ultra']);

const DEFAULT_CONFIG: QualityPolicyConfig = Object.freeze({
  minTier: 'minimal',
  maxTier: 'ultra',
  mobileTier: 'low',
});

export class QualityPolicyR37 {
  readonly config: QualityPolicyConfig;

  constructor(config: Partial<QualityPolicyConfig> = {}) {
    this.config = Object.freeze({
      ...DEFAULT_CONFIG,
      ...config,
    });
  }

  resolve(requested: QualityTier, options: { readonly coarsePointer?: boolean; readonly reducedMotion?: boolean } = {}): QualityProfile {
    const mobile = Boolean(options.coarsePointer);
    const reducedMotion = Boolean(options.reducedMotion);
    let tier = this.clampTier(mobile ? this.config.mobileTier : requested);
    if (reducedMotion && TIERS.indexOf(tier) > TIERS.indexOf('balanced')) tier = 'balanced';
    return profileForTier(tier, reducedMotion);
  }

  nextLower(tier: QualityTier): QualityTier {
    const index = TIERS.indexOf(tier);
    return TIERS[Math.max(0, index - 1)]!;
  }

  nextHigher(tier: QualityTier): QualityTier {
    const index = TIERS.indexOf(tier);
    return TIERS[Math.min(TIERS.length - 1, index + 1)]!;
  }

  compare(a: QualityTier, b: QualityTier): number {
    return TIERS.indexOf(a) - TIERS.indexOf(b);
  }

  isWithinBounds(tier: QualityTier): boolean {
    return this.compare(tier, this.config.minTier) >= 0 && this.compare(tier, this.config.maxTier) <= 0;
  }

  clampTier(tier: QualityTier): QualityTier {
    if (!this.isKnownTier(tier)) return this.config.minTier;
    if (this.compare(tier, this.config.minTier) < 0) return this.config.minTier;
    if (this.compare(tier, this.config.maxTier) > 0) return this.config.maxTier;
    return tier;
  }

  isKnownTier(tier: string): tier is QualityTier {
    return TIERS.includes(tier as QualityTier);
  }
}

function profileForTier(tier: QualityTier, reducedMotion: boolean): QualityProfile {
  const base: Record<QualityTier, Omit<QualityProfile, 'tier'>> = {
    minimal: { pixelRatio: 0.7, shadowMap: 0, viewDistance: 600, effectsScale: 0.35, maxAnimatedEntities: 80, maxAudioSources: 8 },
    low: { pixelRatio: 0.85, shadowMap: 512, viewDistance: 900, effectsScale: 0.55, maxAnimatedEntities: 140, maxAudioSources: 12 },
    balanced: { pixelRatio: 1, shadowMap: 1024, viewDistance: 1200, effectsScale: 0.75, maxAnimatedEntities: 220, maxAudioSources: 16 },
    high: { pixelRatio: 1.15, shadowMap: 1536, viewDistance: 1800, effectsScale: 0.95, maxAnimatedEntities: 320, maxAudioSources: 24 },
    ultra: { pixelRatio: 1.35, shadowMap: 2048, viewDistance: 2400, effectsScale: 1.1, maxAnimatedEntities: 480, maxAudioSources: 32 },
  };
  const source = base[tier];
  const motionScale = reducedMotion ? 0.75 : 1;
  return Object.freeze({
    tier,
    pixelRatio: clamp(finite(source.pixelRatio), 0.5, 2),
    shadowMap: Math.max(0, Math.trunc(source.shadowMap)),
    viewDistance: Math.max(100, finite(source.viewDistance)),
    effectsScale: clamp(source.effectsScale * motionScale, 0.1, 1.2),
    maxAnimatedEntities: Math.max(1, Math.trunc(source.maxAnimatedEntities * motionScale)),
    maxAudioSources: Math.max(1, Math.trunc(source.maxAudioSources)),
  });
}
