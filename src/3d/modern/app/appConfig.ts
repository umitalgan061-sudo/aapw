import { clamp, clamp01, DEFAULT_APP_FRAME_POLICY, type AppBudget, type AppCapabilities, type AppFeatureConfig, type AppFramePolicy } from './appTypes.ts';

export type QualityTier = 'ultra' | 'high' | 'balanced' | 'performance' | 'battery';

export interface AppQualityProfile {
  readonly tier: QualityTier;
  readonly pixelRatioCap: number;
  readonly targetFrameMs: number;
  readonly worldChunkRadius: number;
  readonly maxVisibleEntities: number;
  readonly shadowMapSize: number;
  readonly shadowCascades: number;
  readonly particleScale: number;
  readonly vegetationScale: number;
  readonly animationHz: number;
  readonly aiHz: number;
  readonly audioVoices: number;
  readonly postProcessing: boolean;
  readonly volumetricEffects: boolean;
  readonly reflections: boolean;
  readonly textureBudgetMb: number;
}

export interface ApplicationSecurityConfig {
  readonly maxCommandBytes: number;
  readonly maxPayloadBytes: number;
  readonly maxSaveBytes: number;
  readonly maxTelemetryEvents: number;
  readonly maxNetworkEntities: number;
  readonly maxUserTextLength: number;
}

export interface ApplicationPersistenceConfig {
  readonly schemaVersion: number;
  readonly slotCount: number;
  readonly autosaveIntervalMs: number;
  readonly maxDirtyMs: number;
  readonly saveDebounceMs: number;
}

export interface ApplicationRuntimeConfig {
  readonly version: string;
  readonly worldSeed: number;
  readonly fixedStepMs: number;
  readonly frame: AppFramePolicy;
  readonly initialBudget: AppBudget;
  readonly quality: AppQualityProfile;
  readonly capabilities: AppCapabilities;
  readonly features: readonly AppFeatureConfig[];
  readonly security: ApplicationSecurityConfig;
  readonly persistence: ApplicationPersistenceConfig;
}

const profile = (tier: QualityTier, patch: Omit<AppQualityProfile, 'tier'>): AppQualityProfile => Object.freeze({ tier, ...patch });

export const QUALITY_PROFILES: Readonly<Record<QualityTier, AppQualityProfile>> = Object.freeze({
  ultra: profile('ultra', { pixelRatioCap: 2, targetFrameMs: 13.89, worldChunkRadius: 8, maxVisibleEntities: 12000, shadowMapSize: 4096, shadowCascades: 4, particleScale: 1, vegetationScale: 1, animationHz: 60, aiHz: 30, audioVoices: 96, postProcessing: true, volumetricEffects: true, reflections: true, textureBudgetMb: 2048 }),
  high: profile('high', { pixelRatioCap: 1.75, targetFrameMs: 16.67, worldChunkRadius: 7, maxVisibleEntities: 8500, shadowMapSize: 3072, shadowCascades: 3, particleScale: 0.9, vegetationScale: 0.9, animationHz: 60, aiHz: 30, audioVoices: 72, postProcessing: true, volumetricEffects: true, reflections: true, textureBudgetMb: 1536 }),
  balanced: profile('balanced', { pixelRatioCap: 1.5, targetFrameMs: 16.67, worldChunkRadius: 6, maxVisibleEntities: 6000, shadowMapSize: 2048, shadowCascades: 2, particleScale: 0.75, vegetationScale: 0.78, animationHz: 60, aiHz: 20, audioVoices: 56, postProcessing: false, volumetricEffects: false, reflections: true, textureBudgetMb: 1024 }),
  performance: profile('performance', { pixelRatioCap: 1.25, targetFrameMs: 16.67, worldChunkRadius: 5, maxVisibleEntities: 4200, shadowMapSize: 1536, shadowCascades: 2, particleScale: 0.55, vegetationScale: 0.6, animationHz: 45, aiHz: 15, audioVoices: 40, postProcessing: false, volumetricEffects: false, reflections: false, textureBudgetMb: 768 }),
  battery: profile('battery', { pixelRatioCap: 1, targetFrameMs: 33.33, worldChunkRadius: 4, maxVisibleEntities: 2600, shadowMapSize: 1024, shadowCascades: 1, particleScale: 0.35, vegetationScale: 0.4, animationHz: 30, aiHz: 10, audioVoices: 24, postProcessing: false, volumetricEffects: false, reflections: false, textureBudgetMb: 512 }),
});

export const DEFAULT_CAPABILITIES: AppCapabilities = Object.freeze({ webgl2: false, webgpu: false, sharedArrayBuffer: false, offscreenCanvas: false, gamepad: false, touch: false, reducedMotion: false, saveStorage: false });

const defaultBudget = (quality: AppQualityProfile): AppBudget => Object.freeze({
  cpuMs: Math.max(6, quality.targetFrameMs * 0.55),
  renderMs: Math.max(5, quality.targetFrameMs * 0.7),
  streamingMs: 2.5,
  networkMs: 1.5,
  memoryMb: quality.textureBudgetMb * 0.7 + 350,
  entities: quality.maxVisibleEntities,
  commands: DEFAULT_APP_FRAME_POLICY.maxCommandsPerFrame,
});

export const getQualityProfile = (tier: QualityTier): AppQualityProfile => QUALITY_PROFILES[tier];

export const inferQualityTier = (hints: Readonly<{ coarsePointer?: boolean; reducedMotion?: boolean; memoryGb?: number; cores?: number; preferred?: QualityTier }> = {}): QualityTier => {
  if (hints.preferred) return hints.preferred;
  if (hints.coarsePointer && (hints.memoryGb ?? 4) <= 4) return 'battery';
  if ((hints.memoryGb ?? 8) <= 6 || (hints.cores ?? 8) <= 4) return 'performance';
  if (hints.reducedMotion) return 'high';
  if ((hints.memoryGb ?? 8) >= 16 && (hints.cores ?? 8) >= 12) return 'ultra';
  return 'balanced';
};

export const createApplicationRuntimeConfig = (overrides: Readonly<{ version?: string; worldSeed?: number; fixedStepMs?: number; quality?: QualityTier; capabilities?: Partial<AppCapabilities>; features?: readonly AppFeatureConfig[]; frame?: Partial<AppFramePolicy>; security?: Partial<ApplicationSecurityConfig>; persistence?: Partial<ApplicationPersistenceConfig> }> = {}): ApplicationRuntimeConfig => {
  const quality = getQualityProfile(overrides.quality ?? 'balanced');
  const frame: AppFramePolicy = Object.freeze({
    ...DEFAULT_APP_FRAME_POLICY,
    ...overrides.frame,
    fixedStepMs: overrides.frame?.fixedStepMs ?? overrides.fixedStepMs ?? DEFAULT_APP_FRAME_POLICY.fixedStepMs,
    targetFrameMs: overrides.frame?.targetFrameMs ?? quality.targetFrameMs,
  });
  const capabilities = Object.freeze({ ...DEFAULT_CAPABILITIES, ...overrides.capabilities });
  const budget = defaultBudget(quality);
  return Object.freeze({
    version: overrides.version ?? '3.1.0-runtime',
    worldSeed: Math.trunc(overrides.worldSeed ?? 0x57455354),
    fixedStepMs: clamp(overrides.fixedStepMs ?? frame.fixedStepMs, 4, 33.33),
    frame,
    initialBudget: budget,
    quality,
    capabilities,
    features: Object.freeze([...(overrides.features ?? [])]),
    security: Object.freeze({
      maxCommandBytes: overrides.security?.maxCommandBytes ?? 16 * 1024,
      maxPayloadBytes: overrides.security?.maxPayloadBytes ?? 256 * 1024,
      maxSaveBytes: overrides.security?.maxSaveBytes ?? 16 * 1024 * 1024,
      maxTelemetryEvents: overrides.security?.maxTelemetryEvents ?? 4096,
      maxNetworkEntities: overrides.security?.maxNetworkEntities ?? 8192,
      maxUserTextLength: overrides.security?.maxUserTextLength ?? 512,
    }),
    persistence: Object.freeze({
      schemaVersion: overrides.persistence?.schemaVersion ?? 3,
      slotCount: overrides.persistence?.slotCount ?? 12,
      autosaveIntervalMs: overrides.persistence?.autosaveIntervalMs ?? 30_000,
      maxDirtyMs: overrides.persistence?.maxDirtyMs ?? 180_000,
      saveDebounceMs: overrides.persistence?.saveDebounceMs ?? 1500,
    }),
  });
};

export interface BudgetPressureInput {
  readonly framePressure: number;
  readonly memoryPressure?: number;
  readonly networkPressure?: number;
}

export const adaptBudget = (base: AppBudget, input: BudgetPressureInput): AppBudget => {
  const framePressure = clamp01(input.framePressure);
  const memoryPressure = clamp01(input.memoryPressure ?? 0);
  const networkPressure = clamp01(input.networkPressure ?? 0);
  const pressure = Math.max(framePressure, memoryPressure, networkPressure * 0.7);
  return Object.freeze({
    cpuMs: Math.max(4, base.cpuMs * (1 - pressure * 0.35)),
    renderMs: Math.max(3, base.renderMs * (1 - pressure * 0.45)),
    streamingMs: Math.max(0.5, base.streamingMs * (1 - pressure * 0.25)),
    networkMs: Math.max(0.5, base.networkMs * (1 - networkPressure * 0.15)),
    memoryMb: Math.max(384, base.memoryMb * (1 - memoryPressure * 0.2)),
    entities: Math.max(500, Math.floor(base.entities * (1 - pressure * 0.5))),
    commands: base.commands,
  });
};

export const scaleQuality = (quality: AppQualityProfile, pressure: number): AppQualityProfile => {
  const p = clamp01(pressure);
  const scale = 1 - p;
  return Object.freeze({
    ...quality,
    pixelRatioCap: Math.max(0.75, quality.pixelRatioCap * (0.82 + scale * 0.18)),
    worldChunkRadius: Math.max(3, Math.round(quality.worldChunkRadius * (0.65 + scale * 0.35))),
    maxVisibleEntities: Math.max(500, Math.floor(quality.maxVisibleEntities * (0.45 + scale * 0.55))),
    particleScale: Math.max(0.15, quality.particleScale * (0.35 + scale * 0.65)),
    vegetationScale: Math.max(0.2, quality.vegetationScale * (0.45 + scale * 0.55)),
    animationHz: Math.max(20, Math.round(quality.animationHz * (0.6 + scale * 0.4))),
    aiHz: Math.max(5, Math.round(quality.aiHz * (0.4 + scale * 0.6))),
    audioVoices: Math.max(16, Math.round(quality.audioVoices * (0.65 + scale * 0.35))),
    postProcessing: quality.postProcessing && p < 0.5,
    volumetricEffects: quality.volumetricEffects && p < 0.3,
    reflections: quality.reflections && p < 0.35,
  });
};

export const normalizeFeatures = (features: readonly Partial<AppFeatureConfig>[]): readonly AppFeatureConfig[] => Object.freeze(features.map((feature, index) => Object.freeze({
  id: String(feature.id ?? 'feature-' + index).slice(0, 96),
  enabled: feature.enabled ?? true,
  priority: feature.priority ?? 'normal',
  rollout: clamp01(feature.rollout ?? 1),
  tags: Object.freeze([...(feature.tags ?? [])].map((tag) => String(tag).slice(0, 32))),
})));