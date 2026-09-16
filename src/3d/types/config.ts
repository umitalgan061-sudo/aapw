import type { Backend, DeviceCapabilities, QualityTier, RuntimeBudgets, RuntimeMode } from './platform.js';
import { normalizeBackend, normalizeQuality } from './platform.js';

export interface QualityConfig {
  readonly tier: QualityTier;
  readonly pixelRatio: number;
  readonly renderScale: number;
  readonly shadowDistance: number;
  readonly vegetationDistance: number;
  readonly textureBudgetBytes: number;
  readonly meshBudgetBytes: number;
  readonly maxVisible: number;
  readonly maxAnimated: number;
  readonly maxShadowCasters: number;
}

export interface StreamingConfig {
  readonly enabled: boolean;
  readonly concurrentLoads: number;
  readonly bytesPerFrame: number;
  readonly maxRetries: number;
  readonly preloadDistance: number;
  readonly activationDistance: number;
  readonly unloadDistance: number;
}

export interface RecoveryConfig {
  readonly enabled: boolean;
  readonly integrityIntervalMs: number;
  readonly maxConsecutiveFailures: number;
  readonly checkpointCooldownMs: number;
  readonly reloadAssetsOnPressure: boolean;
  readonly rebuildRendererOnDeviceLoss: boolean;
}

export interface TelemetryConfig {
  readonly enabled: boolean;
  readonly sampleRate: number;
  readonly maxEvents: number;
  readonly maxKeys: number;
}

export interface RuntimeConfig {
  readonly mode: RuntimeMode;
  readonly backend: Backend;
  readonly quality: QualityTier;
  readonly worldId: string;
  readonly seed: number;
  readonly frameBudgetMs: number;
  readonly budgets: RuntimeBudgets;
  readonly qualityConfig: QualityConfig;
  readonly streaming: StreamingConfig;
  readonly recovery: RecoveryConfig;
  readonly telemetry: TelemetryConfig;
}

export interface RuntimeConfigInput {
  readonly mode?: unknown;
  readonly backend?: unknown;
  readonly quality?: unknown;
  readonly worldId?: unknown;
  readonly seed?: unknown;
  readonly frameBudgetMs?: unknown;
  readonly budgets?: Partial<RuntimeBudgets>;
  readonly qualityConfig?: Partial<QualityConfig>;
  readonly streaming?: Partial<StreamingConfig>;
  readonly recovery?: Partial<RecoveryConfig>;
  readonly telemetry?: Partial<TelemetryConfig>;
  readonly capabilities?: Partial<DeviceCapabilities>;
}

const finite = (value: unknown, fallback: number): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const integer = (value: unknown, fallback: number, min = 0): number => Math.max(min, Math.floor(finite(value, fallback)));
const bool = (value: unknown, fallback: boolean): boolean => typeof value === 'boolean' ? value : fallback;
const clamp = (value: unknown, fallback: number, min: number, max: number): number => Math.min(max, Math.max(min, finite(value, fallback)));
const text = (value: unknown, fallback: string): string => typeof value === 'string' && value.trim() ? value.trim() : fallback;

const qualityDefaults: Record<QualityTier, QualityConfig> = {
  ultra: { tier: 'ultra', pixelRatio: 2, renderScale: 1, shadowDistance: 180, vegetationDistance: 140, textureBudgetBytes: 1024 * 1024 * 1024, meshBudgetBytes: 768 * 1024 * 1024, maxVisible: 5000, maxAnimated: 700, maxShadowCasters: 800 },
  high: { tier: 'high', pixelRatio: 1.75, renderScale: 1, shadowDistance: 140, vegetationDistance: 110, textureBudgetBytes: 768 * 1024 * 1024, meshBudgetBytes: 512 * 1024 * 1024, maxVisible: 3500, maxAnimated: 520, maxShadowCasters: 600 },
  medium: { tier: 'medium', pixelRatio: 1.5, renderScale: 0.9, shadowDistance: 100, vegetationDistance: 80, textureBudgetBytes: 512 * 1024 * 1024, meshBudgetBytes: 384 * 1024 * 1024, maxVisible: 2400, maxAnimated: 360, maxShadowCasters: 400 },
  low: { tier: 'low', pixelRatio: 1.25, renderScale: 0.75, shadowDistance: 70, vegetationDistance: 50, textureBudgetBytes: 256 * 1024 * 1024, meshBudgetBytes: 192 * 1024 * 1024, maxVisible: 1500, maxAnimated: 200, maxShadowCasters: 200 },
  safe: { tier: 'safe', pixelRatio: 1, renderScale: 0.6, shadowDistance: 45, vegetationDistance: 30, textureBudgetBytes: 128 * 1024 * 1024, meshBudgetBytes: 96 * 1024 * 1024, maxVisible: 900, maxAnimated: 120, maxShadowCasters: 96 },
};

export function defaultsForQuality(tier: QualityTier): QualityConfig { return Object.freeze({ ...qualityDefaults[tier] }); }

export function normalizeMode(value: unknown): RuntimeMode {
  return value === 'headless' || value === 'replay' ? value : 'interactive';
}

export function normalizeSeed(value: unknown, fallback = 0x6d2b79f5): number {
  return integer(value, fallback, 0) >>> 0;
}

export function normalizeRuntimeConfig(input: RuntimeConfigInput = {}): RuntimeConfig {
  const quality = normalizeQuality(input.quality);
  const backend = normalizeBackend(input.backend);
  const mode = normalizeMode(input.mode);
  const qualityBase = defaultsForQuality(quality);
  const q = { ...qualityBase, ...input.qualityConfig, tier: quality };
  const budgets: RuntimeBudgets = {
    frameMs: clamp(input.budgets?.frameMs, finite(input.frameBudgetMs, 16.67), 1, 100),
    simulationMs: clamp(input.budgets?.simulationMs, 5, 0, 100),
    renderMs: clamp(input.budgets?.renderMs, 10, 0, 100),
    uploadMs: clamp(input.budgets?.uploadMs, 2, 0, 100),
    streamingMs: clamp(input.budgets?.streamingMs, 2, 0, 100),
    maxVisibleObjects: integer(input.budgets?.maxVisibleObjects, q.maxVisible, 1),
    maxAnimatedObjects: integer(input.budgets?.maxAnimatedObjects, q.maxAnimated, 1),
    maxShadowCasters: integer(input.budgets?.maxShadowCasters, q.maxShadowCasters, 1),
  };
  const qualityConfig: QualityConfig = Object.freeze({
    tier: quality,
    pixelRatio: clamp(q.pixelRatio, qualityBase.pixelRatio, 0.5, 3),
    renderScale: clamp(q.renderScale, qualityBase.renderScale, 0.25, 1),
    shadowDistance: clamp(q.shadowDistance, qualityBase.shadowDistance, 1, 1000),
    vegetationDistance: clamp(q.vegetationDistance, qualityBase.vegetationDistance, 1, 1000),
    textureBudgetBytes: integer(q.textureBudgetBytes, qualityBase.textureBudgetBytes, 1),
    meshBudgetBytes: integer(q.meshBudgetBytes, qualityBase.meshBudgetBytes, 1),
    maxVisible: integer(q.maxVisible, qualityBase.maxVisible, 1),
    maxAnimated: integer(q.maxAnimated, qualityBase.maxAnimated, 1),
    maxShadowCasters: integer(q.maxShadowCasters, qualityBase.maxShadowCasters, 1),
  });
  const streaming: StreamingConfig = Object.freeze({
    enabled: bool(input.streaming?.enabled, true),
    concurrentLoads: integer(input.streaming?.concurrentLoads, backend === 'webgpu' ? 6 : 3, 1),
    bytesPerFrame: integer(input.streaming?.bytesPerFrame, 4 * 1024 * 1024, 0),
    maxRetries: integer(input.streaming?.maxRetries, 3, 0),
    preloadDistance: clamp(input.streaming?.preloadDistance, 180, 1, 2000),
    activationDistance: clamp(input.streaming?.activationDistance, 110, 1, 1500),
    unloadDistance: clamp(input.streaming?.unloadDistance, 260, 1, 2500),
  });
  const recovery: RecoveryConfig = Object.freeze({
    enabled: bool(input.recovery?.enabled, true),
    integrityIntervalMs: integer(input.recovery?.integrityIntervalMs, 5000, 100),
    maxConsecutiveFailures: integer(input.recovery?.maxConsecutiveFailures, 3, 1),
    checkpointCooldownMs: integer(input.recovery?.checkpointCooldownMs, 30000, 1000),
    reloadAssetsOnPressure: bool(input.recovery?.reloadAssetsOnPressure, true),
    rebuildRendererOnDeviceLoss: bool(input.recovery?.rebuildRendererOnDeviceLoss, true),
  });
  const telemetry: TelemetryConfig = Object.freeze({
    enabled: bool(input.telemetry?.enabled, true),
    sampleRate: clamp(input.telemetry?.sampleRate, 1, 0, 1),
    maxEvents: integer(input.telemetry?.maxEvents, 512, 16),
    maxKeys: integer(input.telemetry?.maxKeys, 256, 16),
  });
  return Object.freeze({
    mode,
    backend,
    quality,
    worldId: text(input.worldId, 'world-default'),
    seed: normalizeSeed(input.seed),
    frameBudgetMs: budgets.frameMs,
    budgets: Object.freeze(budgets),
    qualityConfig,
    streaming,
    recovery,
    telemetry,
  });
}

export interface ConfigDiff { readonly path: string; readonly before: unknown; readonly after: unknown; }

export function diffRuntimeConfig(before: RuntimeConfig, after: RuntimeConfig): readonly ConfigDiff[] {
  const diffs: ConfigDiff[] = [];
  const compare = (path: string, left: unknown, right: unknown): void => {
    if (Object.is(left, right)) return;
    if (left && right && typeof left === 'object' && typeof right === 'object' && !Array.isArray(left) && !Array.isArray(right)) {
      const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
      for (const key of [...keys].sort()) compare(`${path}.${key}`, (left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]);
      return;
    }
    diffs.push({ path, before: left, after: right });
  };
  compare('config', before, after);
  return diffs;
}

export function validateRuntimeConfig(config: RuntimeConfig): readonly string[] {
  const errors: string[] = [];
  if (!config.worldId.trim()) errors.push('worldId is empty');
  if (!Number.isSafeInteger(config.seed) || config.seed < 0) errors.push('seed is invalid');
  if (!Number.isFinite(config.frameBudgetMs) || config.frameBudgetMs <= 0) errors.push('frameBudgetMs is invalid');
  if (config.budgets.simulationMs > config.frameBudgetMs) errors.push('simulation budget exceeds frame budget');
  if (config.budgets.renderMs > config.frameBudgetMs) errors.push('render budget exceeds frame budget');
  if (config.qualityConfig.renderScale < 0.25 || config.qualityConfig.renderScale > 1) errors.push('render scale is out of bounds');
  if (config.qualityConfig.pixelRatio < 0.5 || config.qualityConfig.pixelRatio > 3) errors.push('pixel ratio is out of bounds');
  if (config.streaming.activationDistance > config.streaming.unloadDistance) errors.push('activation distance exceeds unload distance');
  if (config.streaming.concurrentLoads < 1) errors.push('stream concurrency must be positive');
  if (config.recovery.maxConsecutiveFailures < 1) errors.push('recovery failure limit must be positive');
  if (config.telemetry.sampleRate < 0 || config.telemetry.sampleRate > 1) errors.push('telemetry sample rate is invalid');
  return errors;
}
