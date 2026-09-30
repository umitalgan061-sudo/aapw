import type { QualityTier } from './types';
import { clampFinite } from './runtimeContracts';
import type { PerformanceSummary } from './performanceLab';

export interface QualityProfile {
  readonly tier: QualityTier;
  readonly renderScale: number;
  readonly shadowMapSize: number;
  readonly shadowDistance: number;
  readonly maxLights: number;
  readonly maxVisibleObjects: number;
  readonly vegetationDensity: number;
  readonly terrainLod: number;
  readonly textureAnisotropy: number;
  readonly postProcessing: boolean;
  readonly volumetrics: boolean;
  readonly reflections: boolean;
  readonly antialiasing: 'none' | 'fxaa' | 'taa' | 'msaa';
  readonly maxWorkers: number;
}

export interface QualityTransition {
  readonly previous: QualityTier;
  readonly next: QualityTier;
  readonly reason: string;
  readonly timestamp: number;
}

export interface QualityDirectorOptions {
  readonly initial?: QualityTier;
  readonly min?: QualityTier;
  readonly max?: QualityTier;
  readonly dwellFrames?: number;
  readonly now?: () => number;
}

const PROFILES: Readonly<Record<QualityTier, QualityProfile>> = Object.freeze({
  minimal: Object.freeze({ tier: 'minimal', renderScale: 0.65, shadowMapSize: 512, shadowDistance: 50, maxLights: 2, maxVisibleObjects: 500, vegetationDensity: 0.25, terrainLod: 4, textureAnisotropy: 1, postProcessing: false, volumetrics: false, reflections: false, antialiasing: 'none', maxWorkers: 1 }),
  low: Object.freeze({ tier: 'low', renderScale: 0.75, shadowMapSize: 1024, shadowDistance: 90, maxLights: 4, maxVisibleObjects: 900, vegetationDensity: 0.45, terrainLod: 3, textureAnisotropy: 2, postProcessing: false, volumetrics: false, reflections: false, antialiasing: 'fxaa', maxWorkers: 2 }),
  medium: Object.freeze({ tier: 'medium', renderScale: 0.85, shadowMapSize: 1536, shadowDistance: 140, maxLights: 8, maxVisibleObjects: 1600, vegetationDensity: 0.65, terrainLod: 2, textureAnisotropy: 4, postProcessing: true, volumetrics: false, reflections: false, antialiasing: 'fxaa', maxWorkers: 3 }),
  high: Object.freeze({ tier: 'high', renderScale: 0.95, shadowMapSize: 2048, shadowDistance: 220, maxLights: 12, maxVisibleObjects: 3000, vegetationDensity: 0.85, terrainLod: 1, textureAnisotropy: 8, postProcessing: true, volumetrics: true, reflections: true, antialiasing: 'taa', maxWorkers: 5 }),
  ultra: Object.freeze({ tier: 'ultra', renderScale: 1, shadowMapSize: 4096, shadowDistance: 350, maxLights: 20, maxVisibleObjects: 6000, vegetationDensity: 1, terrainLod: 1, textureAnisotropy: 16, postProcessing: true, volumetrics: true, reflections: true, antialiasing: 'taa', maxWorkers: 8 }),
});

const ORDER: readonly QualityTier[] = Object.freeze(['minimal', 'low', 'medium', 'high', 'ultra']);

export function getQualityProfile(tier: QualityTier): QualityProfile {
  return PROFILES[tier];
}

export function clampQualityTier(tier: QualityTier, min: QualityTier, max: QualityTier): QualityTier {
  const minIndex = ORDER.indexOf(min);
  const maxIndex = ORDER.indexOf(max);
  const index = ORDER.indexOf(tier);
  return ORDER[Math.max(minIndex, Math.min(maxIndex, index))] ?? min;
}

export class QualityDirector {
  #tier: QualityTier;
  readonly min: QualityTier;
  readonly max: QualityTier;
  readonly dwellFrames: number;
  #now: () => number;
  #framesSinceChange = 0;
  #pressureHistory: number[] = [];
  #transitions: QualityTransition[] = [];

  constructor(options: QualityDirectorOptions = {}) {
    this.min = options.min ?? 'minimal';
    this.max = options.max ?? 'ultra';
    this.#tier = clampQualityTier(options.initial ?? 'high', this.min, this.max);
    this.dwellFrames = Math.max(1, Math.trunc(options.dwellFrames ?? 30));
    this.#now = options.now ?? (() => Date.now());
  }

  get tier(): QualityTier { return this.#tier; }
  get profile(): QualityProfile { return getQualityProfile(this.#tier); }

  observe(summary: PerformanceSummary): QualityTier {
    this.#framesSinceChange += 1;
    this.#pressureHistory.push(summary.pressure);
    if (this.#pressureHistory.length > 120) this.#pressureHistory.shift();
    if (this.#framesSinceChange < this.dwellFrames) return this.#tier;
    const currentIndex = ORDER.indexOf(this.#tier);
    const desired = summary.recommendedQuality;
    const desiredIndex = ORDER.indexOf(clampQualityTier(desired, this.min, this.max));
    if (desiredIndex === currentIndex) return this.#tier;
    const direction = desiredIndex > currentIndex ? 1 : -1;
    const next = ORDER[currentIndex + direction];
    if (!next) return this.#tier;
    this.set(next, summary.health === 'critical' || summary.health === 'degraded' ? 'performance-pressure' : 'recovery');
    return this.#tier;
  }

  set(tier: QualityTier, reason = 'manual'): QualityTransition | null {
    const next = clampQualityTier(tier, this.min, this.max);
    if (next === this.#tier) return null;
    const transition: QualityTransition = Object.freeze({ previous: this.#tier, next, reason, timestamp: this.#now() });
    this.#tier = next;
    this.#framesSinceChange = 0;
    this.#transitions.push(transition);
    while (this.#transitions.length > 64) this.#transitions.shift();
    return transition;
  }

  transitionHistory(): readonly QualityTransition[] {
    return Object.freeze([...this.#transitions]);
  }

  pressureTrend(): number {
    if (this.#pressureHistory.length < 2) return 0;
    const first = this.#pressureHistory[0] ?? 0;
    const last = this.#pressureHistory[this.#pressureHistory.length - 1] ?? first;
    return clampFinite(last - first, -1, 1, 0);
  }
}

export interface RuntimeFeatureSwitches {
  readonly enableWebGPU: boolean;
  readonly enableWorkerStreaming: boolean;
  readonly enableNetworkReplication: boolean;
  readonly enableReplay: boolean;
  readonly enableAutosave: boolean;
  readonly enableDiagnostics: boolean;
  readonly enableDynamicQuality: boolean;
  readonly enableEditorBridges: boolean;
}

export const DEFAULT_RUNTIME_FEATURES: RuntimeFeatureSwitches = Object.freeze({
  enableWebGPU: true,
  enableWorkerStreaming: true,
  enableNetworkReplication: false,
  enableReplay: true,
  enableAutosave: true,
  enableDiagnostics: true,
  enableDynamicQuality: true,
  enableEditorBridges: false,
});

export function normalizeFeatureSwitches(input: Partial<RuntimeFeatureSwitches> | undefined): RuntimeFeatureSwitches {
  return Object.freeze({ ...DEFAULT_RUNTIME_FEATURES, ...(input ?? {}) });
}
