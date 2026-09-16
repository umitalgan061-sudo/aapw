import type { BudgetUsage, CapabilitySnapshot } from './types.js';
import { clamp } from './deterministic.js';

export type QualityTier = 'ultra' | 'high' | 'balanced' | 'low' | 'safe';
export type QualityFeature = 'shadows' | 'ssao' | 'ssgi' | 'bloom' | 'fog' | 'taa' | 'particles' | 'foliage' | 'animation' | 'water' | 'clouds' | 'volumetrics';

export interface QualityProfile {
  readonly tier: QualityTier;
  readonly renderScale: number;
  readonly pixelRatioCap: number;
  readonly shadowMapSize: number;
  readonly shadowCascades: number;
  readonly maxLights: number;
  readonly maxFoliageInstances: number;
  readonly maxAnimatedEntities: number;
  readonly postProcess: readonly QualityFeature[];
  readonly textureBudgetBytes: number;
  readonly gpuPassBudgetMs: number;
  readonly cpuBudgetMs: number;
}

export interface PressureInput {
  readonly cpuRatio?: number;
  readonly gpuRatio?: number;
  readonly frameRatio?: number;
  readonly memoryRatio?: number;
  readonly thermalRatio?: number;
  readonly droppedFrames?: number;
  readonly budget?: Partial<BudgetUsage>;
}

export interface PressureState {
  readonly cpu: number;
  readonly gpu: number;
  readonly frame: number;
  readonly memory: number;
  readonly thermal: number;
  readonly composite: number;
  readonly class: 'nominal' | 'warm' | 'strained' | 'critical';
}

export interface QualityDecision {
  readonly previous: QualityTier;
  readonly next: QualityTier;
  readonly changed: boolean;
  readonly reason: string;
  readonly profile: QualityProfile;
  readonly pressure: PressureState;
  readonly revision: number;
}

export interface AdaptiveQualityOptions {
  readonly initialTier?: QualityTier;
  readonly minTier?: QualityTier;
  readonly maxTier?: QualityTier;
  readonly downThreshold?: number;
  readonly upThreshold?: number;
  readonly hysteresis?: number;
  readonly dwellFrames?: number;
  readonly smoothing?: number;
}

const TIER_ORDER: readonly QualityTier[] = Object.freeze(['safe', 'low', 'balanced', 'high', 'ultra']);
const BASE_PROFILES: Readonly<Record<QualityTier, QualityProfile>> = Object.freeze({
  ultra: Object.freeze({ tier: 'ultra', renderScale: 1.0, pixelRatioCap: 2.5, shadowMapSize: 4096, shadowCascades: 4, maxLights: 64, maxFoliageInstances: 120_000, maxAnimatedEntities: 1200, postProcess: Object.freeze(['shadows', 'ssao', 'ssgi', 'bloom', 'fog', 'taa', 'particles', 'foliage', 'animation', 'water', 'clouds', 'volumetrics']), textureBudgetBytes: 1024 ** 3, gpuPassBudgetMs: 12.5, cpuBudgetMs: 10.0 }),
  high: Object.freeze({ tier: 'high', renderScale: 0.95, pixelRatioCap: 2.0, shadowMapSize: 3072, shadowCascades: 4, maxLights: 48, maxFoliageInstances: 90_000, maxAnimatedEntities: 900, postProcess: Object.freeze(['shadows', 'ssao', 'bloom', 'fog', 'taa', 'particles', 'foliage', 'animation', 'water', 'clouds']), textureBudgetBytes: 768 * 1024 ** 2, gpuPassBudgetMs: 13.5, cpuBudgetMs: 11.0 }),
  balanced: Object.freeze({ tier: 'balanced', renderScale: 0.88, pixelRatioCap: 1.65, shadowMapSize: 2048, shadowCascades: 3, maxLights: 32, maxFoliageInstances: 65_000, maxAnimatedEntities: 700, postProcess: Object.freeze(['shadows', 'ssao', 'bloom', 'fog', 'taa', 'particles', 'foliage', 'animation', 'water']), textureBudgetBytes: 512 * 1024 ** 2, gpuPassBudgetMs: 14.5, cpuBudgetMs: 12.0 }),
  low: Object.freeze({ tier: 'low', renderScale: 0.75, pixelRatioCap: 1.35, shadowMapSize: 1536, shadowCascades: 2, maxLights: 24, maxFoliageInstances: 42_000, maxAnimatedEntities: 500, postProcess: Object.freeze(['shadows', 'fog', 'particles', 'foliage', 'animation', 'water']), textureBudgetBytes: 320 * 1024 ** 2, gpuPassBudgetMs: 15.5, cpuBudgetMs: 13.0 }),
  safe: Object.freeze({ tier: 'safe', renderScale: 0.62, pixelRatioCap: 1.15, shadowMapSize: 1024, shadowCascades: 1, maxLights: 12, maxFoliageInstances: 24_000, maxAnimatedEntities: 280, postProcess: Object.freeze(['fog', 'animation']), textureBudgetBytes: 192 * 1024 ** 2, gpuPassBudgetMs: 16.0, cpuBudgetMs: 15.0 }),
});

export const deriveInitialQuality = (capabilities: CapabilitySnapshot): QualityTier => {
  const score = (capabilities.webgpu ? 3 : capabilities.webgl2 ? 1 : 0) + Math.min(2, Math.floor(capabilities.hardwareConcurrency / 8)) + Math.min(2, Math.floor(capabilities.deviceMemoryGb / 8));
  if (capabilities.webgpu && score >= 6) return 'ultra';
  if (score >= 5) return 'high';
  if (score >= 3) return 'balanced';
  if (score >= 1) return 'low';
  return 'safe';
};

export const qualityProfile = (tier: QualityTier): QualityProfile => BASE_PROFILES[tier];

export const calculatePressure = (input: PressureInput): PressureState => {
  const budget = input.budget;
  const cpu = clamp(Math.max(Number(input.cpuRatio ?? 0), Number(budget?.cpuRatio ?? 0)), 0, 1.5);
  const gpu = clamp(Math.max(Number(input.gpuRatio ?? 0), Number(budget?.gpuRatio ?? 0)), 0, 1.5);
  const frame = clamp(Math.max(Number(input.frameRatio ?? 0), Number(budget?.cpuRatio ?? 0)), 0, 1.5);
  const memory = clamp(Math.max(Number(input.memoryRatio ?? 0), Number(budget?.memoryRatio ?? 0)), 0, 1.5);
  const dropped = clamp(Math.min(1.5, Math.max(0, Number(input.droppedFrames ?? 0)) / 10), 0, 1.5);
  const thermal = clamp(Number(input.thermalRatio ?? 0), 0, 1.5);
  const composite = clamp(cpu * 0.23 + gpu * 0.31 + frame * 0.23 + memory * 0.11 + thermal * 0.07 + dropped * 0.05, 0, 1.5);
  const pressureClass = composite >= 1.0 ? 'critical' : composite >= 0.8 ? 'strained' : composite >= 0.6 ? 'warm' : 'nominal';
  return Object.freeze({ cpu, gpu, frame, memory, thermal, composite, class: pressureClass });
};

export class AdaptiveQualityController {
  private readonly minTier: QualityTier;
  private readonly maxTier: QualityTier;
  private readonly downThreshold: number;
  private readonly upThreshold: number;
  private readonly hysteresis: number;
  private readonly dwellFrames: number;
  private readonly smoothing: number;
  private tier: QualityTier;
  private filteredPressure = 0;
  private lastChangeFrame = -Infinity;
  private revision = 0;

  public constructor(options: AdaptiveQualityOptions = {}) {
    this.minTier = options.minTier ?? 'safe';
    this.maxTier = options.maxTier ?? 'ultra';
    this.tier = options.initialTier ?? 'balanced';
    this.downThreshold = clamp(options.downThreshold ?? 0.86, 0.5, 1.3);
    this.upThreshold = clamp(options.upThreshold ?? 0.48, 0.1, 0.9);
    this.hysteresis = clamp(options.hysteresis ?? 0.08, 0, 0.3);
    this.dwellFrames = Math.max(1, Math.trunc(options.dwellFrames ?? 90));
    this.smoothing = clamp(options.smoothing ?? 0.12, 0.01, 1);
    this.tier = constrainTier(this.tier, this.minTier, this.maxTier);
  }

  public get currentTier(): QualityTier { return this.tier; }
  public get revisionNumber(): number { return this.revision; }
  public profile(): QualityProfile { return qualityProfile(this.tier); }

  public update(input: PressureInput, frame = 0): QualityDecision {
    const pressure = calculatePressure(input);
    this.filteredPressure += (pressure.composite - this.filteredPressure) * this.smoothing;
    const previous = this.tier;
    const canChange = frame - this.lastChangeFrame >= this.dwellFrames;
    let next = previous;
    let reason = 'within-hysteresis';
    if (canChange && this.filteredPressure >= this.downThreshold) { next = stepTier(previous, -1); reason = 'pressure-high'; }
    else if (canChange && this.filteredPressure <= this.upThreshold) { next = stepTier(previous, 1); reason = 'pressure-low'; }
    next = constrainTier(next, this.minTier, this.maxTier);
    if (next !== previous) { this.tier = next; this.lastChangeFrame = frame; this.revision += 1; reason = next < previous ? 'degraded-for-pressure' : 'recovered-after-stability'; }
    return Object.freeze({ previous, next, changed: next !== previous, reason, profile: this.profile(), pressure: Object.freeze({ ...pressure, composite: clamp(this.filteredPressure, 0, 1.5) }), revision: this.revision });
  }

  public force(tier: QualityTier, reason = 'manual'): QualityDecision {
    const previous = this.tier;
    this.tier = constrainTier(tier, this.minTier, this.maxTier);
    this.revision += Number(previous !== this.tier);
    return Object.freeze({ previous, next: this.tier, changed: previous !== this.tier, reason, profile: this.profile(), pressure: calculatePressure({}), revision: this.revision });
  }
}

export const featureEnabled = (tier: QualityTier, feature: QualityFeature): boolean => qualityProfile(tier).postProcess.includes(feature);
export const scaleForPressure = (tier: QualityTier, pressure: PressureState): number => clamp(qualityProfile(tier).renderScale * (pressure.composite >= 1 ? 0.82 : pressure.composite >= 0.85 ? 0.9 : 1), 0.5, 1);

const stepTier = (tier: QualityTier, direction: -1 | 1): QualityTier => {
  const index = TIER_ORDER.indexOf(tier);
  return TIER_ORDER[clamp(index + direction, 0, TIER_ORDER.length - 1)] ?? tier;
};
const constrainTier = (tier: QualityTier, min: QualityTier, max: QualityTier): QualityTier => {
  const lower = TIER_ORDER.indexOf(min);
  const upper = TIER_ORDER.indexOf(max);
  const index = clamp(TIER_ORDER.indexOf(tier), lower, upper);
  return TIER_ORDER[index] ?? min;
};
