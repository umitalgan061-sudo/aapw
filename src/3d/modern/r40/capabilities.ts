import type { BrowserCapabilities, GraphicsBackend, PlatformClass } from './types';

function bool(value: unknown): boolean { return Boolean(value); }
function num(value: unknown, fallback: number): number { return typeof value === 'number' && Number.isFinite(value) ? value : fallback; }

export function detectR40Capabilities(): BrowserCapabilities {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  const gl2 = Boolean(canvas?.getContext('webgl2'));
  const gpu = Boolean(nav && 'gpu' in nav);
  const backend: GraphicsBackend = gpu ? 'webgpu' : gl2 ? 'webgl2' : 'headless';
  const connection = nav && 'connection' in nav ? (nav as Navigator & { connection?: { saveData?: boolean } }).connection : undefined;
  return Object.freeze({
    backend,
    workers: typeof Worker !== 'undefined',
    offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    indexedDb: typeof indexedDB !== 'undefined',
    broadcastChannel: typeof BroadcastChannel !== 'undefined',
    deviceMemoryGb: nav && 'deviceMemory' in nav ? num((nav as Navigator & { deviceMemory?: number }).deviceMemory, 0) || null : null,
    hardwareConcurrency: Math.max(1, Math.trunc(num(nav?.hardwareConcurrency, 4))),
    reducedMotion: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
    saveData: bool(connection?.saveData),
  });
}

export function classifyPlatform(capabilities: BrowserCapabilities, viewportWidth = 1280, touchPoints = 0): PlatformClass {
  const constrained = Boolean(capabilities.saveData) || (capabilities.deviceMemoryGb !== null && capabilities.deviceMemoryGb <= 2) || capabilities.hardwareConcurrency <= 2;
  if (constrained) return 'constrained';
  if (touchPoints > 0 && viewportWidth < 900) return 'mobile';
  if (touchPoints > 0 || viewportWidth < 1200) return 'tablet';
  return 'desktop';
}

export interface CapabilityDecision {
  readonly backend: GraphicsBackend;
  readonly workers: boolean;
  readonly persistentStorage: boolean;
  readonly sharedMemory: boolean;
  readonly qualityCeiling: 0 | 1 | 2 | 3 | 4;
}
export function resolveCapabilityDecision(cap: BrowserCapabilities): CapabilityDecision {
  const qualityCeiling = cap.backend === 'webgpu' && cap.hardwareConcurrency >= 8 ? 4 : cap.backend !== 'headless' && cap.hardwareConcurrency >= 4 ? 3 : cap.hardwareConcurrency >= 2 ? 2 : 1;
  return Object.freeze({
    backend: cap.backend,
    workers: cap.workers && cap.offscreenCanvas,
    persistentStorage: cap.indexedDb,
    sharedMemory: cap.sharedArrayBuffer && cap.hardwareConcurrency >= 4,
    qualityCeiling,
  });
}
