export type BrowserFeatureV5 = 'webgpu' | 'webgl2' | 'worker' | 'offscreenCanvas' | 'serviceWorker' | 'indexedDb' | 'broadcastChannel' | 'sharedArrayBuffer' | 'gamepad' | 'touch' | 'webAudio';
export type DeviceClassV5 = 'desktop' | 'tablet' | 'mobile' | 'constrained' | 'unknown';
export interface BrowserSignalsV5 { readonly features: Readonly<Record<BrowserFeatureV5, boolean>>; readonly hardwareConcurrency: number; readonly deviceMemoryGb: number | null; readonly dpr: number; readonly width: number; readonly height: number; readonly reducedMotion: boolean; readonly saveData: boolean; }
export interface BrowserProfileV5 { readonly device: DeviceClassV5; readonly graphics: 'webgpu' | 'webgl2' | 'none'; readonly workers: number; readonly persistentStorage: boolean; readonly sharedMemory: boolean; readonly quality: 'minimal' | 'balanced' | 'high' | 'ultra'; readonly maxTextureBytes: number; readonly maxConcurrentAssets: number; readonly renderScale: number; }

const features: readonly BrowserFeatureV5[] = ['webgpu', 'webgl2', 'worker', 'offscreenCanvas', 'serviceWorker', 'indexedDb', 'broadcastChannel', 'sharedArrayBuffer', 'gamepad', 'touch', 'webAudio'];
const boolFeature = (key: BrowserFeatureV5): boolean => typeof navigator !== 'undefined' && key === 'webgpu' ? 'gpu' in navigator : key === 'webgl2' ? (() => { try { const canvas = document.createElement('canvas'); return Boolean(canvas.getContext('webgl2')); } catch { return false; } })() : key === 'worker' ? typeof Worker !== 'undefined' : key === 'offscreenCanvas' ? typeof OffscreenCanvas !== 'undefined' : key === 'serviceWorker' ? 'serviceWorker' in navigator : key === 'indexedDb' ? 'indexedDB' in globalThis : key === 'broadcastChannel' ? 'BroadcastChannel' in globalThis : key === 'sharedArrayBuffer' ? typeof SharedArrayBuffer !== 'undefined' : key === 'gamepad' ? 'getGamepads' in navigator : key === 'touch' ? 'ontouchstart' in globalThis || (navigator.maxTouchPoints ?? 0) > 0 : 'AudioContext' in globalThis || 'webkitAudioContext' in globalThis;

export function detectBrowserSignalsV5(): BrowserSignalsV5 {
  const record = Object.fromEntries(features.map((feature) => [feature, boolFeature(feature)])) as Record<BrowserFeatureV5, boolean>;
  const width = typeof window !== 'undefined' ? window.innerWidth : 1280; const height = typeof window !== 'undefined' ? window.innerHeight : 720;
  const memory = typeof navigator !== 'undefined' && 'deviceMemory' in navigator ? Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory) : null;
  const reducedMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)').matches : false;
  const saveData = typeof navigator !== 'undefined' && 'connection' in navigator ? Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) : false;
  return Object.freeze({ features: Object.freeze(record), hardwareConcurrency: Math.max(1, Math.min(128, navigator?.hardwareConcurrency ?? 4)), deviceMemoryGb: Number.isFinite(memory ?? NaN) ? memory : null, dpr: Math.max(1, Math.min(4, window?.devicePixelRatio ?? 1)), width, height, reducedMotion, saveData });
}

export function resolveBrowserProfileV5(signals: BrowserSignalsV5): BrowserProfileV5 {
  const touch = signals.features.touch; const small = signals.width < 900 || signals.height < 700; const constrained = signals.saveData || (signals.deviceMemoryGb !== null && signals.deviceMemoryGb < 3) || signals.hardwareConcurrency <= 2;
  const device: DeviceClassV5 = constrained ? 'constrained' : small && touch ? 'mobile' : small ? 'tablet' : 'desktop';
  const graphics = signals.features.webgpu ? 'webgpu' : signals.features.webgl2 ? 'webgl2' : 'none';
  const workers = constrained ? 1 : Math.max(1, Math.min(12, signals.hardwareConcurrency - 1));
  const quality = graphics === 'none' || constrained ? 'minimal' : device === 'mobile' ? 'balanced' : signals.deviceMemoryGb !== null && signals.deviceMemoryGb >= 12 && signals.hardwareConcurrency >= 8 ? 'ultra' : 'high';
  const maxTextureBytes = quality === 'ultra' ? 256 * 1024 * 1024 : quality === 'high' ? 128 * 1024 * 1024 : quality === 'balanced' ? 64 * 1024 * 1024 : 32 * 1024 * 1024;
  const maxConcurrentAssets = quality === 'ultra' ? 12 : quality === 'high' ? 8 : quality === 'balanced' ? 4 : 2;
  const renderScale = signals.reducedMotion ? 0.95 : quality === 'ultra' ? 1 : quality === 'high' ? 0.92 : quality === 'balanced' ? 0.82 : 0.7;
  return Object.freeze({ device, graphics, workers, persistentStorage: signals.features.indexedDb, sharedMemory: signals.features.sharedArrayBuffer, quality, maxTextureBytes, maxConcurrentAssets, renderScale });
}

export function browserCompatibilityV5(signals: BrowserSignalsV5): Readonly<Record<BrowserFeatureV5, 'native' | 'polyfilled' | 'unavailable'>> {
  return Object.freeze(Object.fromEntries(features.map((feature) => [feature, signals.features[feature] ? 'native' : feature === 'webgpu' || feature === 'offscreenCanvas' ? 'unavailable' : 'polyfilled'])) as Record<BrowserFeatureV5, 'native' | 'polyfilled' | 'unavailable'>);
}
