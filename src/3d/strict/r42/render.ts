/**
 * Adaptive renderer policy for R42.
 * Production TypeScript owner. This module selects policy; Three.js integration remains an adapter.
 */

import type { RenderBackend, RenderCapabilities, RenderSettings, QualityTier } from './types.ts';
import { clamp, finite, deepFreeze } from './types.ts';

export interface RenderObservation {
  readonly frameMs: number;
  readonly gpuMs: number | null;
  readonly memoryPressure: number;
  readonly thermalPressure: number;
  readonly visibleObjects: number;
  readonly cameraCut: boolean;
}

const SCALE_BY_TIER: Record<QualityTier, number> = {
  minimal: 0.55,
  low: 0.7,
  balanced: 0.82,
  high: 0.94,
  ultra: 1,
};

const FRAME_BUDGET: Record<QualityTier, number> = {
  minimal: 33.3,
  low: 25,
  balanced: 16.67,
  high: 14.5,
  ultra: 11.1,
};

export class RenderGovernorR42 {
  #tier: QualityTier;
  #scale: number;
  #historyValid = false;
  #overBudgetFrames = 0;
  #underBudgetFrames = 0;

  constructor(initialTier: QualityTier = 'balanced') {
    this.#tier = initialTier;
    this.#scale = SCALE_BY_TIER[initialTier];
  }

  get tier(): QualityTier { return this.#tier; }
  get scale(): number { return this.#scale; }
  get historyValid(): boolean { return this.#historyValid; }

  evaluate(capabilities: RenderCapabilities, observation: RenderObservation, preferred?: QualityTier): RenderSettings {
    const backend = chooseBackend(capabilities);
    const targetTier = preferred ?? this.#tier;
    const budget = FRAME_BUDGET[targetTier];

    if (observation.frameMs > budget * 1.12 || observation.memoryPressure > 0.88 || observation.thermalPressure > 0.9) {
      this.#overBudgetFrames += 1;
      this.#underBudgetFrames = 0;
    } else if (observation.frameMs < budget * 0.78 && observation.memoryPressure < 0.65 && observation.thermalPressure < 0.65) {
      this.#underBudgetFrames += 1;
      this.#overBudgetFrames = 0;
    } else {
      this.#overBudgetFrames = Math.max(0, this.#overBudgetFrames - 1);
      this.#underBudgetFrames = Math.max(0, this.#underBudgetFrames - 1);
    }

    if (this.#overBudgetFrames >= 6) {
      this.#tier = lowerTier(this.#tier);
      this.#scale = Math.max(0.45, this.#scale - 0.06);
      this.#overBudgetFrames = 0;
      this.#historyValid = false;
    } else if (this.#underBudgetFrames >= 30) {
      this.#tier = higherTier(this.#tier);
      this.#scale = Math.min(1, this.#scale + 0.04);
      this.#underBudgetFrames = 0;
    }

    if (observation.cameraCut) this.#historyValid = false;
    else if (this.#scale > 0.7) this.#historyValid = true;

    const features = featureSet(this.#tier, backend, capabilities);
    return deepFreeze({
      backend,
      quality: this.#tier,
      scale: clamp(this.#scale, 0.45, 1),
      pixelRatio: clamp(Math.min(capabilities.devicePixelRatio || 1, this.#tier === 'ultra' ? 2 : 1.5), 0.75, 2),
      shadows: features.shadows,
      bloom: features.bloom,
      ssao: features.ssao,
      instancing: true,
      temporalHistory: this.#historyValid,
      reason: 'R42 adaptive quality governor',
    });
  }

  force(tier: QualityTier, scale?: number): void {
    this.#tier = tier;
    this.#scale = clamp(finite(scale, SCALE_BY_TIER[tier]), 0.45, 1);
    this.#historyValid = false;
    this.#overBudgetFrames = 0;
    this.#underBudgetFrames = 0;
  }
}

function chooseBackend(capabilities: RenderCapabilities): RenderBackend {
  if (capabilities.webgpu) return 'webgpu';
  if (capabilities.webgl2) return 'webgl2';
  return 'headless';
}

function lowerTier(tier: QualityTier): QualityTier {
  if (tier === 'ultra') return 'high';
  if (tier === 'high') return 'balanced';
  if (tier === 'balanced') return 'low';
  if (tier === 'low') return 'minimal';
  return 'minimal';
}

function higherTier(tier: QualityTier): QualityTier {
  if (tier === 'minimal') return 'low';
  if (tier === 'low') return 'balanced';
  if (tier === 'balanced') return 'high';
  if (tier === 'high') return 'ultra';
  return 'ultra';
}

function featureSet(
  tier: QualityTier,
  backend: RenderBackend,
  capabilities: RenderCapabilities,
): { readonly shadows: boolean; readonly bloom: boolean; readonly ssao: boolean } {
  const shadows = tier !== 'minimal' && backend !== 'headless';
  const bloom = (tier === 'high' || tier === 'ultra') && backend !== 'headless';
  const ssao = (tier === 'ultra' || tier === 'high') && capabilities.webgl2 && backend !== 'headless';
  return Object.freeze({ shadows, bloom, ssao });
}
