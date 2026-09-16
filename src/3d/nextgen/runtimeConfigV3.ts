/** Validated device-aware presets for the next-generation runtime. */

export type DeviceClass = 'desktop' | 'laptop' | 'tablet' | 'mobile';
export type QualityPreset = 'cinematic' | 'high' | 'balanced' | 'performance' | 'battery';

export interface RuntimeDeviceProfile { deviceClass: DeviceClass; hardwareConcurrency: number; deviceMemoryGb: number | null; coarsePointer: boolean; reducedMotion: boolean }
export interface RuntimeConfigV3 {
  device: RuntimeDeviceProfile;
  quality: QualityPreset;
  fixedDeltaSeconds: number;
  maxCatchUpSteps: number;
  maxEntities: number;
  maxNetworkEntities: number;
  maxConcurrentAssets: number;
  maxResidentAssetBytes: number;
  navigationCellSize: number;
  navigationSearchBudget: number;
  aiThinkerBudget: number;
  telemetryHistory: number;
}

const PRESETS: Record<QualityPreset, Omit<RuntimeConfigV3, 'device' | 'quality'>> = {
  cinematic: { fixedDeltaSeconds: 1 / 60, maxCatchUpSteps: 4, maxEntities: 4096, maxNetworkEntities: 512, maxConcurrentAssets: 8, maxResidentAssetBytes: 512 * 1024 * 1024, navigationCellSize: 1.5, navigationSearchBudget: 16384, aiThinkerBudget: 12, telemetryHistory: 600 },
  high: { fixedDeltaSeconds: 1 / 60, maxCatchUpSteps: 4, maxEntities: 3072, maxNetworkEntities: 384, maxConcurrentAssets: 6, maxResidentAssetBytes: 384 * 1024 * 1024, navigationCellSize: 1.8, navigationSearchBudget: 12000, aiThinkerBudget: 10, telemetryHistory: 480 },
  balanced: { fixedDeltaSeconds: 1 / 60, maxCatchUpSteps: 3, maxEntities: 2048, maxNetworkEntities: 256, maxConcurrentAssets: 5, maxResidentAssetBytes: 256 * 1024 * 1024, navigationCellSize: 2, navigationSearchBudget: 8192, aiThinkerBudget: 8, telemetryHistory: 360 },
  performance: { fixedDeltaSeconds: 1 / 60, maxCatchUpSteps: 2, maxEntities: 1536, maxNetworkEntities: 192, maxConcurrentAssets: 4, maxResidentAssetBytes: 192 * 1024 * 1024, navigationCellSize: 2.5, navigationSearchBudget: 6144, aiThinkerBudget: 6, telemetryHistory: 240 },
  battery: { fixedDeltaSeconds: 1 / 50, maxCatchUpSteps: 2, maxEntities: 1024, maxNetworkEntities: 128, maxConcurrentAssets: 3, maxResidentAssetBytes: 128 * 1024 * 1024, navigationCellSize: 3, navigationSearchBudget: 4096, aiThinkerBudget: 4, telemetryHistory: 180 },
};

function isDeviceClass(value: string): value is DeviceClass { return ['desktop', 'laptop', 'tablet', 'mobile'].includes(value); }
function inferDeviceClass(profile: RuntimeDeviceProfile): DeviceClass {
  if (profile.deviceClass && isDeviceClass(profile.deviceClass)) return profile.deviceClass;
  if (profile.coarsePointer && profile.hardwareConcurrency <= 4) return 'mobile';
  if (profile.coarsePointer) return 'tablet';
  if (profile.hardwareConcurrency >= 12) return 'desktop';
  return 'laptop';
}

export function validateRuntimeConfig(config: RuntimeConfigV3): string[] {
  const errors: string[] = [];
  if (config.fixedDeltaSeconds <= 0 || config.fixedDeltaSeconds > 0.1) errors.push('fixedDeltaSeconds must be between 0 and 0.1');
  if (!Number.isInteger(config.maxCatchUpSteps) || config.maxCatchUpSteps < 1 || config.maxCatchUpSteps > 8) errors.push('maxCatchUpSteps must be 1..8');
  if (!Number.isInteger(config.maxEntities) || config.maxEntities < 128) errors.push('maxEntities must be >= 128');
  if (!Number.isInteger(config.maxNetworkEntities) || config.maxNetworkEntities < 32) errors.push('maxNetworkEntities must be >= 32');
  if (!Number.isInteger(config.maxConcurrentAssets) || config.maxConcurrentAssets < 1 || config.maxConcurrentAssets > 32) errors.push('maxConcurrentAssets must be 1..32');
  if (config.maxResidentAssetBytes < 16 * 1024 * 1024) errors.push('maxResidentAssetBytes is below the minimum supported memory budget');
  if (config.navigationCellSize <= 0) errors.push('navigationCellSize must be > 0');
  if (!Number.isInteger(config.navigationSearchBudget) || config.navigationSearchBudget < 256) errors.push('navigationSearchBudget must be >= 256');
  if (!Number.isInteger(config.aiThinkerBudget) || config.aiThinkerBudget < 1 || config.aiThinkerBudget > 32) errors.push('aiThinkerBudget must be 1..32');
  if (!Number.isInteger(config.telemetryHistory) || config.telemetryHistory < 30) errors.push('telemetryHistory must be >= 30');
  return errors;
}

export function chooseQuality(profile: RuntimeDeviceProfile): QualityPreset {
  const device = inferDeviceClass(profile);
  if (profile.reducedMotion && device === 'mobile') return 'battery';
  if (device === 'desktop' && profile.hardwareConcurrency >= 16) return 'cinematic';
  if (device === 'desktop' || device === 'laptop') return profile.hardwareConcurrency >= 8 ? 'high' : 'balanced';
  if (device === 'tablet') return 'performance';
  return 'battery';
}

export function createRuntimeConfig(profile: RuntimeDeviceProfile, quality = chooseQuality(profile)): RuntimeConfigV3 {
  const deviceClass = inferDeviceClass(profile);
  const config: RuntimeConfigV3 = { device: { ...profile, deviceClass }, quality, ...PRESETS[quality] };
  const errors = validateRuntimeConfig(config);
  if (errors.length) throw new Error(`invalid runtime config: ${errors.join('; ')}`);
  return config;
}

export function browserDeviceProfile(): RuntimeDeviceProfile {
  const globalNavigator = typeof navigator !== 'undefined' ? navigator : undefined;
  const globalWindow = typeof window !== 'undefined' ? window : undefined;
  const coarsePointer = typeof globalWindow?.matchMedia === 'function' && globalWindow.matchMedia('(pointer: coarse)').matches;
  const reducedMotion = typeof globalWindow?.matchMedia === 'function' && globalWindow.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hardwareConcurrency = globalNavigator?.hardwareConcurrency ?? 8;
  const deviceMemory = 'deviceMemory' in (globalNavigator ?? {}) && typeof (globalNavigator as Navigator & { deviceMemory?: number }).deviceMemory === 'number' ? (globalNavigator as Navigator & { deviceMemory?: number }).deviceMemory! : null;
  return { deviceClass: coarsePointer && hardwareConcurrency <= 4 ? 'mobile' : coarsePointer ? 'tablet' : hardwareConcurrency >= 12 ? 'desktop' : 'laptop', hardwareConcurrency, deviceMemoryGb: deviceMemory, coarsePointer, reducedMotion };
}
