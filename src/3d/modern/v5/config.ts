import { DEFAULT_RUNTIME_CONFIG, RuntimeConfig, clamp } from './domain.ts';
import { AssetPolicy } from './assetGraph.ts';
import { NetworkLimits } from './network.ts';
import { SecurityLimits } from './security.ts';
import { RenderBudget } from './render.ts';

export interface QualityTier {
  readonly id: 'ultra' | 'high' | 'medium' | 'low' | 'mobile';
  readonly renderScale: number;
  readonly maxVisibleEntities: number;
  readonly maxShadowCasters: number;
  readonly terrainSegments: number;
  readonly particleBudget: number;
  readonly postProcess: boolean;
}

export const QUALITY_TIERS: readonly QualityTier[] = Object.freeze([
  { id: 'ultra', renderScale: 1, maxVisibleEntities: 10_000, maxShadowCasters: 2_000, terrainSegments: 256, particleBudget: 50_000, postProcess: true },
  { id: 'high', renderScale: 0.95, maxVisibleEntities: 7_500, maxShadowCasters: 1_500, terrainSegments: 192, particleBudget: 35_000, postProcess: true },
  { id: 'medium', renderScale: 0.85, maxVisibleEntities: 5_000, maxShadowCasters: 1_000, terrainSegments: 128, particleBudget: 20_000, postProcess: true },
  { id: 'low', renderScale: 0.72, maxVisibleEntities: 3_000, maxShadowCasters: 600, terrainSegments: 96, particleBudget: 10_000, postProcess: false },
  { id: 'mobile', renderScale: 0.62, maxVisibleEntities: 1_500, maxShadowCasters: 250, terrainSegments: 64, particleBudget: 4_000, postProcess: false },
]);

export interface PlatformConfigV5 {
  readonly runtime: RuntimeConfig;
  readonly assets: AssetPolicy;
  readonly network: NetworkLimits;
  readonly security: SecurityLimits;
  readonly render: RenderBudget;
  readonly quality: QualityTier;
}

export const tierForDevice = (hardwareConcurrency: number, devicePixelRatio: number, touch = false): QualityTier => {
  if (touch || hardwareConcurrency <= 4) return QUALITY_TIERS.at(-1)!;
  if (hardwareConcurrency <= 6 || devicePixelRatio > 2) return QUALITY_TIERS[2]!;
  if (hardwareConcurrency <= 8) return QUALITY_TIERS[1]!;
  return QUALITY_TIERS[0]!;
};

export const createPlatformConfig = (options: { hardwareConcurrency?: number; devicePixelRatio?: number; touch?: boolean } = {}): PlatformConfigV5 => {
  const quality = tierForDevice(options.hardwareConcurrency ?? 8, options.devicePixelRatio ?? 1, options.touch ?? false);
  const runtime: RuntimeConfig = { ...DEFAULT_RUNTIME_CONFIG, maxEntities: Math.min(DEFAULT_RUNTIME_CONFIG.maxEntities, quality.maxVisibleEntities * 20) };
  const assets: AssetPolicy = { maxBytes: quality.id === 'mobile' ? 96 * 1024 * 1024 : 256 * 1024 * 1024, maxConcurrentLoads: quality.id === 'mobile' ? 3 : 8, maxAssetSize: quality.id === 'mobile' ? 32 * 1024 * 1024 : 64 * 1024 * 1024, allowCrossOrigin: [], requireHashForRemote: false };
  const network: NetworkLimits = { maxEntities: runtime.maxEntities, maxBytesPerTick: quality.id === 'mobile' ? 96 * 1024 : 256 * 1024, maxHistory: runtime.snapshotHistory, maxDeltaEntities: Math.min(2048, quality.maxVisibleEntities) };
  const security: SecurityLimits = { maxCommandBytes: 32 * 1024, maxStringLength: 1024, maxArrayLength: 4096, maxObjectKeys: 256, maxCommandsPerSecond: quality.id === 'mobile' ? 120 : 240, maxSnapshotEntities: network.maxEntities };
  const render: RenderBudget = { maxVisibleEntities: quality.maxVisibleEntities, maxShadowCasters: quality.maxShadowCasters, maxOpaqueDraws: Math.round(quality.maxVisibleEntities * 0.42), maxTransparentDraws: Math.round(quality.maxVisibleEntities * 0.08) };
  return { runtime, assets, network, security, render, quality };
};

export const qualityScaleForFrameTime = (frameMs: number, currentScale: number, targetMs = 16.67): number => {
  const pressure = targetMs <= 0 ? 0 : (frameMs - targetMs) / targetMs;
  return clamp(currentScale * (1 - pressure * 0.12), 0.5, 1);
};

export const clampQualityScale = (scale: number): number => clamp(scale, 0.5, 1);
