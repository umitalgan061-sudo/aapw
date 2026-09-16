export type BrowserClass = 'desktop' | 'tablet' | 'mobile' | 'constrained';
export type GraphicsPath = 'webgpu' | 'webgl2' | 'webgl1' | 'headless';

export interface CapabilitySignals {
  readonly webgpu: boolean;
  readonly webgl2: boolean;
  readonly offscreenCanvas: boolean;
  readonly worker: boolean;
  readonly serviceWorker: boolean;
  readonly indexedDb: boolean;
  readonly broadcastChannel: boolean;
  readonly sharedArrayBuffer: boolean;
  readonly hardwareConcurrency: number;
  readonly deviceMemoryGb: number | null;
  readonly saveData: boolean;
  readonly reducedMotion: boolean;
  readonly touchPoints: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly dpr: number;
}

export interface PlatformProfile {
  readonly browserClass: BrowserClass;
  readonly graphics: GraphicsPath;
  readonly workerStreaming: boolean;
  readonly persistentCache: boolean;
  readonly maxWorkers: number;
  readonly maxTextureBytes: number;
  readonly maxConcurrentAssets: number;
  readonly quality: 'minimal' | 'medium' | 'high' | 'ultra';
  readonly renderScale: number;
}

function numberOr(value: unknown, fallback: number): number { return typeof value === 'number' && Number.isFinite(value) ? value : fallback; }
function detectWebGpu(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

export function detectCapabilitySignals(): CapabilitySignals {
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  const screenWidth = typeof screen !== 'undefined' ? screen.width : 1280;
  const screenHeight = typeof screen !== 'undefined' ? screen.height : 720;
  return Object.freeze({
    webgpu: detectWebGpu(),
    webgl2: typeof document !== 'undefined' ? Boolean(document.createElement('canvas').getContext('webgl2')) : false,
    offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    worker: typeof Worker !== 'undefined',
    serviceWorker: Boolean(nav?.serviceWorker),
    indexedDb: typeof indexedDB !== 'undefined',
    broadcastChannel: typeof BroadcastChannel !== 'undefined',
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    hardwareConcurrency: Math.max(1, Math.trunc(numberOr(nav?.hardwareConcurrency, 4))),
    deviceMemoryGb: typeof nav === 'object' && nav && 'deviceMemory' in nav ? numberOr((nav as Navigator & { deviceMemory?: number }).deviceMemory, 0) || null : null,
    saveData: Boolean(nav && 'connection' in nav && ((nav as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData)),
    reducedMotion: typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)').matches : false,
    touchPoints: Math.max(0, Math.trunc(numberOr(nav?.maxTouchPoints, 0))),
    viewportWidth: Math.max(1, Math.trunc(typeof innerWidth === 'number' ? innerWidth : screenWidth)),
    viewportHeight: Math.max(1, Math.trunc(typeof innerHeight === 'number' ? innerHeight : screenHeight)),
    dpr: Math.max(1, Math.min(4, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1)),
  });
}

export function resolvePlatformProfile(signals = detectCapabilitySignals()): PlatformProfile {
  const constrained = signals.saveData || signals.hardwareConcurrency <= 2 || signals.deviceMemoryGb !== null && signals.deviceMemoryGb <= 2;
  const mobile = signals.touchPoints > 0 && signals.viewportWidth < 900;
  const tablet = signals.touchPoints > 0 && !mobile;
  const browserClass: BrowserClass = constrained ? 'constrained' : mobile ? 'mobile' : tablet ? 'tablet' : 'desktop';
  const graphics: GraphicsPath = signals.webgpu ? 'webgpu' : signals.webgl2 ? 'webgl2' : 'webgl1';
  const quality = constrained ? 'minimal' : mobile ? 'medium' : tablet ? 'high' : signals.webgpu ? 'ultra' : 'high';
  const maxWorkers = constrained ? 1 : Math.max(1, Math.min(8, signals.hardwareConcurrency - 1));
  const maxTextureBytes = constrained ? 128 * 1024 * 1024 : mobile ? 256 * 1024 * 1024 : 768 * 1024 * 1024;
  return Object.freeze({ browserClass, graphics, workerStreaming: signals.worker && signals.offscreenCanvas, persistentCache: signals.indexedDb, maxWorkers, maxTextureBytes, maxConcurrentAssets: constrained ? 2 : mobile ? 3 : 6, quality, renderScale: constrained ? 0.65 : mobile ? 0.8 : 1 });
}

export function qualityForProfile(profile: PlatformProfile): PlatformProfile['quality'] { return profile.quality; }
