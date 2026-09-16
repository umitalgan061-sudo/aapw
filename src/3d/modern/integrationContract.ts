import type { DeviceCapabilities, QualityTier, RendererBackend, RuntimePhase, RuntimeSnapshot } from './types';
import { detectBrowserFeatures } from './compatibility';

export interface RuntimeHealthSnapshot {
  readonly phase: RuntimePhase;
  readonly backend: RendererBackend | null;
  readonly quality: QualityTier;
  readonly capabilities: DeviceCapabilities;
  readonly featureFlags: ReturnType<typeof detectBrowserFeatures>;
  readonly errors: number;
  readonly warnings: number;
}

export interface RuntimeHealthCollector {
  readonly recordError: (code: string) => void;
  readonly recordWarning: (code: string) => void;
  readonly snapshot: (runtime: RuntimeSnapshot) => RuntimeHealthSnapshot;
  readonly reset: () => void;
}

export const createRuntimeHealthCollector = (): RuntimeHealthCollector => {
  const errors = new Map<string, number>();
  const warnings = new Map<string, number>();
  const record = (map: Map<string, number>, code: string) => map.set(code, (map.get(code) ?? 0) + 1);
  return {
    recordError: (code) => record(errors, code),
    recordWarning: (code) => record(warnings, code),
    snapshot: (runtime) => ({
      phase: runtime.phase,
      backend: runtime.renderer?.backend ?? null,
      quality: runtime.quality.tier,
      capabilities: runtime.renderer?.capabilities ?? {
        webgpu: false, webgl2: false, offscreenCanvas: false, sharedArrayBuffer: false,
        crossOriginIsolated: false, deviceMemoryGb: null, hardwareConcurrency: 1,
        maxTextureSize: null, maxSamples: null, powerPreference: 'default',
      },
      featureFlags: detectBrowserFeatures(),
      errors: [...errors.values()].reduce((a, b) => a + b, 0),
      warnings: [...warnings.values()].reduce((a, b) => a + b, 0),
    }),
    reset: () => { errors.clear(); warnings.clear(); },
  };
};

export interface LifecycleGuard {
  readonly start: () => void;
  readonly stop: () => void;
  readonly canMutate: () => boolean;
  readonly state: () => 'idle' | 'active' | 'stopped';
}

export const createLifecycleGuard = (): LifecycleGuard => {
  let state: 'idle' | 'active' | 'stopped' = 'idle';
  return {
    start: () => { if (state === 'stopped') throw new Error('LIFECYCLE_RESTART_FORBIDDEN'); state = 'active'; },
    stop: () => { if (state !== 'stopped') state = 'stopped'; },
    canMutate: () => state === 'active',
    state: () => state,
  };
};

export const assertFiniteVector = (value: { x: number; y: number; z: number }, label = 'vector'): void => {
  if (![value.x, value.y, value.z].every(Number.isFinite)) throw new TypeError(`${label} contains non-finite values`);
};

export const sanitizeDeltaMs = (deltaMs: number, maximum = 100): number => Math.min(maximum, Math.max(0, Number.isFinite(deltaMs) ? deltaMs : 0));
