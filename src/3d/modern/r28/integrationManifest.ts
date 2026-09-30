import type { BrowserCapabilities } from './environment.ts';
import type { RenderBudget } from './renderScheduler.ts';
import type { SecurityLimits } from '../r27/security.ts';

export interface R28IntegrationManifest {
  readonly version: 'r28';
  readonly runtime: {
    readonly tickRate: number;
    readonly maxStepsPerFrame: number;
    readonly maxEntities: number;
    readonly maxEventsPerFrame: number;
  };
  readonly rendering: RenderBudget;
  readonly security: SecurityLimits;
  readonly browser: BrowserCapabilities;
  readonly features: Readonly<Record<string, boolean>>;
}

export interface ManifestOverride {
  readonly tickRate?: number;
  readonly maxStepsPerFrame?: number;
  readonly maxEntities?: number;
  readonly maxEventsPerFrame?: number;
  readonly rendering?: Partial<RenderBudget>;
  readonly security?: Partial<SecurityLimits>;
  readonly features?: Readonly<Record<string, boolean>>;
}

const DEFAULT_RENDER: RenderBudget = {
  frameTargetMs: 16.67,
  maxSubmissions: 512,
  maxShadowUpdates: 64,
};

const DEFAULT_SECURITY: SecurityLimits = {
  maxStringLength: 64,
  maxArrayLength: 256,
  maxAnalogKeys: 64,
  maxButtons: 32,
  maxEventsPerFrame: 512,
  maxPayloadBytes: 65536,
};

export function createR28IntegrationManifest(
  browser: BrowserCapabilities,
  override: ManifestOverride = {},
): R28IntegrationManifest {
  const quality = browser.webgpu && browser.hardwareConcurrency >= 8 ? 4 :
    browser.hardwareConcurrency >= 4 ? 3 :
    browser.touch || browser.hardwareConcurrency <= 2 ? 1 : 2;

  const defaults = {
    tickRate: 60,
    maxStepsPerFrame: quality >= 3 ? 6 : 4,
    maxEntities: quality >= 3 ? 8192 : quality >= 2 ? 4096 : 2048,
    maxEventsPerFrame: quality >= 3 ? 1024 : 512,
  };

  return Object.freeze({
    version: 'r28',
    runtime: {
      tickRate: Math.max(1, Math.floor(override.tickRate ?? defaults.tickRate)),
      maxStepsPerFrame: Math.max(1, Math.floor(override.maxStepsPerFrame ?? defaults.maxStepsPerFrame)),
      maxEntities: Math.max(1, Math.floor(override.maxEntities ?? defaults.maxEntities)),
      maxEventsPerFrame: Math.max(1, Math.floor(override.maxEventsPerFrame ?? defaults.maxEventsPerFrame)),
    },
    rendering: {
      frameTargetMs: Math.max(1, override.rendering?.frameTargetMs ?? DEFAULT_RENDER.frameTargetMs),
      maxSubmissions: Math.max(1, Math.floor(override.rendering?.maxSubmissions ?? DEFAULT_RENDER.maxSubmissions)),
      maxShadowUpdates: Math.max(0, Math.floor(override.rendering?.maxShadowUpdates ?? DEFAULT_RENDER.maxShadowUpdates)),
    },
    security: {
      maxStringLength: Math.max(8, Math.floor(override.security?.maxStringLength ?? DEFAULT_SECURITY.maxStringLength)),
      maxArrayLength: Math.max(8, Math.floor(override.security?.maxArrayLength ?? DEFAULT_SECURITY.maxArrayLength)),
      maxAnalogKeys: Math.max(1, Math.floor(override.security?.maxAnalogKeys ?? DEFAULT_SECURITY.maxAnalogKeys)),
      maxButtons: Math.max(1, Math.floor(override.security?.maxButtons ?? DEFAULT_SECURITY.maxButtons)),
      maxEventsPerFrame: Math.max(1, Math.floor(override.security?.maxEventsPerFrame ?? DEFAULT_SECURITY.maxEventsPerFrame)),
      maxPayloadBytes: Math.max(1024, Math.floor(override.security?.maxPayloadBytes ?? DEFAULT_SECURITY.maxPayloadBytes)),
    },
    browser,
    features: {
      workers: browser.worker,
      sharedArrayBuffer: browser.sharedArrayBuffer,
      webgpu: browser.webgpu,
      persistence: browser.saveStorage,
      touch: browser.touch,
      ...(override.features ?? {}),
    },
  });
}

export function validateR28IntegrationManifest(manifest: R28IntegrationManifest): readonly string[] {
  const errors: string[] = [];
  if (manifest.version !== 'r28') errors.push('version');
  if (manifest.runtime.tickRate <= 0) errors.push('tickRate');
  if (manifest.runtime.maxStepsPerFrame < 1) errors.push('maxStepsPerFrame');
  if (manifest.runtime.maxEntities < 1) errors.push('maxEntities');
  if (manifest.runtime.maxEventsPerFrame < 1) errors.push('maxEventsPerFrame');
  if (manifest.rendering.maxSubmissions < 1) errors.push('maxSubmissions');
  if (manifest.rendering.frameTargetMs <= 0) errors.push('frameTargetMs');
  if (manifest.security.maxPayloadBytes < 1024) errors.push('maxPayloadBytes');
  return errors.sort();
}
