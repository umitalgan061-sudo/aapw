import { clamp, lerp } from './math.ts';
import type { FrameBudget } from './types.ts';

export type QualityTier = 'ultra' | 'high' | 'medium' | 'low' | 'safe';

export interface RenderCapabilities {
  readonly maxTextureSize: number;
  readonly supportsInstancing: boolean;
  readonly supportsWebGL2: boolean;
  readonly deviceMemoryGb?: number;
  readonly hardwareConcurrency?: number;
}

export interface RenderBudgetState {
  readonly tier: QualityTier;
  readonly pixelRatio: number;
  readonly shadowMapSize: number;
  readonly visibleDistance: number;
  readonly vegetationDensity: number;
  readonly effectsDensity: number;
  readonly lodBias: number;
}

const TIER_ORDER: QualityTier[] = ['ultra', 'high', 'medium', 'low', 'safe'];
const TARGET_MS: Record<QualityTier, number> = { ultra: 16.6, high: 16.6, medium: 16.6, low: 20, safe: 25 };

export function resolveInitialTier(capabilities: RenderCapabilities, coarsePointer = false): QualityTier {
  if (!capabilities.supportsWebGL2) return 'safe';
  const memory = capabilities.deviceMemoryGb ?? 4;
  const cores = capabilities.hardwareConcurrency ?? 4;
  if (coarsePointer || memory <= 2 || cores <= 2) return 'low';
  if (memory >= 8 && cores >= 8 && capabilities.maxTextureSize >= 8192) return 'ultra';
  if (memory >= 6 && cores >= 6) return 'high';
  return 'medium';
}

export function budgetForTier(tier: QualityTier): RenderBudgetState {
  switch (tier) {
    case 'ultra': return { tier, pixelRatio: 2, shadowMapSize: 4096, visibleDistance: 1, vegetationDensity: 1, effectsDensity: 1, lodBias: 0 };
    case 'high': return { tier, pixelRatio: 1.75, shadowMapSize: 3072, visibleDistance: 0.9, vegetationDensity: 0.85, effectsDensity: 0.9, lodBias: 0.15 };
    case 'medium': return { tier, pixelRatio: 1.5, shadowMapSize: 2048, visibleDistance: 0.75, vegetationDensity: 0.7, effectsDensity: 0.7, lodBias: 0.35 };
    case 'low': return { tier, pixelRatio: 1.15, shadowMapSize: 1024, visibleDistance: 0.55, vegetationDensity: 0.45, effectsDensity: 0.45, lodBias: 0.65 };
    case 'safe': return { tier, pixelRatio: 1, shadowMapSize: 512, visibleDistance: 0.4, vegetationDensity: 0.25, effectsDensity: 0.2, lodBias: 1 };
  }
}

export function totalFrameMs(budget: FrameBudget): number { return Math.max(0, budget.simulationMs) + Math.max(0, budget.renderMs) + Math.max(0, budget.streamingMs) + Math.max(0, budget.networkMs); }

export class AdaptiveRenderBudget {
  #state: RenderBudgetState;
  #samples: number[] = [];
  #stableFrames = 0;
  #cooldown = 0;
  readonly maxSamples: number;

  constructor(initialTier: QualityTier, maxSamples = 90) {
    this.#state = budgetForTier(initialTier);
    this.maxSamples = Math.max(30, Math.floor(maxSamples));
  }

  get state(): RenderBudgetState { return this.#state; }

  observe(frame: FrameBudget): RenderBudgetState {
    const ms = totalFrameMs(frame);
    if (this.#samples.length >= this.maxSamples) this.#samples.shift();
    this.#samples.push(ms);
    this.#cooldown = Math.max(0, this.#cooldown - 1);
    const average = this.averageMs();
    if (this.#cooldown > 0) return this.#state;
    const target = TARGET_MS[this.#state.tier];
    if (average > target * 1.18) {
      this.#stableFrames = 0;
      this.#shift(1);
      this.#cooldown = 30;
    } else if (average < target * 0.76) {
      this.#stableFrames += 1;
      if (this.#stableFrames >= 45) { this.#shift(-1); this.#stableFrames = 0; this.#cooldown = 60; }
    } else this.#stableFrames = Math.max(0, this.#stableFrames - 1);
    return this.#state;
  }

  averageMs(): number { return this.#samples.length ? this.#samples.reduce((sum, value) => sum + value, 0) / this.#samples.length : 0; }
  p95Ms(): number {
    if (!this.#samples.length) return 0;
    const sorted = [...this.#samples].sort((a, b) => a - b);
    return sorted[Math.floor((sorted.length - 1) * 0.95)]!;
  }

  smoothPixelRatio(current: number): number { return lerp(current, this.#state.pixelRatio, 0.15); }

  #shift(direction: 1 | -1): void {
    const index = TIER_ORDER.indexOf(this.#state.tier);
    const nextIndex = clamp(index + direction, 0, TIER_ORDER.length - 1);
    this.#state = budgetForTier(TIER_ORDER[nextIndex]!);
  }
}

export interface LODLevel { readonly maxDistance: number; readonly geometryScale: number; readonly animationRate: number; }
export function makeLODLevels(baseDistance: number, count = 5): LODLevel[] {
  const levels: LODLevel[] = [];
  for (let index = 0; index < Math.max(1, Math.floor(count)); index += 1) {
    const factor = 1 + index * 1.5;
    levels.push({ maxDistance: baseDistance * factor, geometryScale: 1 / (1 + index * 0.5), animationRate: index === 0 ? 1 : 1 / (1 + index * 0.75) });
  }
  return levels;
}
