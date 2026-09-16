export const FRAME = Object.freeze({
  DEFAULT_MS: 1000 / 60,
  MAX_DELTA_MS: 200,
  MAX_CATCH_UP_STEPS: 5,
  MIN_RENDER_SCALE: 0.25,
  MAX_RENDER_SCALE: 1,
});

export const MEMORY = Object.freeze({
  KB: 1024,
  MB: 1024 * 1024,
  GB: 1024 * 1024 * 1024,
});

export const QUALITY_ORDER = Object.freeze(['safe', 'low', 'medium', 'high', 'ultra'] as const);
export const BACKEND_ORDER = Object.freeze(['webgl2', 'webgpu'] as const);
export const STREAM_STATES = Object.freeze(['cold', 'queued', 'loading', 'resident', 'stale', 'evicting'] as const);
export const REGION_STATES = Object.freeze(['unloaded', 'queued', 'loading', 'active', 'hibernating', 'unloading', 'failed'] as const);
export const INPUT_SOURCES = Object.freeze(['keyboard', 'mouse', 'touch', 'gamepad', 'xr', 'synthetic'] as const);
export const ERROR_SEVERITIES = Object.freeze(['warning', 'error', 'fatal'] as const);

export const DEFAULT_LIMITS = Object.freeze({
  visibleObjects: 2400,
  animatedObjects: 360,
  shadowCasters: 400,
  workerConcurrency: 4,
  assetConcurrency: 4,
  cacheEntries: 512,
  telemetryEvents: 512,
});

export function qualityIndex(value: typeof QUALITY_ORDER[number]): number { return QUALITY_ORDER.indexOf(value); }
export function isAtLeastQuality(value: typeof QUALITY_ORDER[number], minimum: typeof QUALITY_ORDER[number]): boolean { return qualityIndex(value) >= qualityIndex(minimum); }
export function nextLowerQuality(value: typeof QUALITY_ORDER[number]): typeof QUALITY_ORDER[number] {
  const index = qualityIndex(value); return QUALITY_ORDER[Math.max(0, index - 1)] ?? 'safe';
}
export function nextHigherQuality(value: typeof QUALITY_ORDER[number]): typeof QUALITY_ORDER[number] {
  const index = qualityIndex(value); return QUALITY_ORDER[Math.min(QUALITY_ORDER.length - 1, index + 1)] ?? 'ultra';
}
