/**
 * Browser/platform capability probe.
 *
 * Detection is conservative, side-effect-light and injectable for tests. It never chooses the
 * renderer; it reports facts that a composition root can use for WebGL/WebGPU, PWA, input and
 * accessibility policy.
 */

import { clamp, integerOr, finiteOr, createRuntimeCapabilities } from './modernRuntimeContract.js';

function safeMatchMedia(media, fallback = false) {
  try { return Boolean(globalThis?.matchMedia?.(media)?.matches); } catch { return fallback; }
}

function safeStorageAvailable(storage) {
  try {
    if (!storage) return false;
    const key = '__aapw_probe__';
    storage.setItem(key, '1');
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

async function probeWebGPU() {
  try {
    if (!globalThis?.navigator?.gpu?.requestAdapter) return false;
    const adapter = await globalThis.navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    return Boolean(adapter);
  } catch {
    return false;
  }
}

function probeWebGL() {
  try {
    const canvas = globalThis?.document?.createElement?.('canvas');
    if (!canvas?.getContext) return false;
    const context = canvas.getContext('webgl2', { powerPreference: 'high-performance' }) || canvas.getContext('webgl');
    const available = Boolean(context);
    context?.getExtension?.('WEBGL_lose_context')?.loseContext?.();
    return available;
  } catch {
    return false;
  }
}

function detectInput() {
  const navigatorValue = globalThis?.navigator;
  return Object.freeze({
    touch: integerOr(navigatorValue?.maxTouchPoints, 0) > 0,
    gamepad: typeof navigatorValue?.getGamepads === 'function',
    pointerLock: Boolean(globalThis?.document?.body?.requestPointerLock),
    pointerEvents: typeof globalThis?.PointerEvent === 'function',
    keyboard: typeof globalThis?.KeyboardEvent === 'function',
  });
}

function detectPwa() {
  const navigatorValue = globalThis?.navigator;
  const displayMode = safeMatchMedia('(display-mode: standalone)');
  const iosStandalone = Boolean(navigatorValue?.standalone);
  const serviceWorker = Boolean(navigatorValue?.serviceWorker);
  return Object.freeze({
    standalone: displayMode || iosStandalone,
    serviceWorker,
    online: navigatorValue?.onLine !== false,
  });
}

function detectMemory() {
  const navigatorValue = globalThis?.navigator;
  const memory = navigatorValue?.deviceMemory;
  const jsHeap = globalThis?.performance?.memory?.jsHeapSizeLimit;
  return Object.freeze({
    deviceMemoryGb: clamp(finiteOr(memory, 4), 0.25, 64),
    heapLimitMb: jsHeap ? clamp(Number(jsHeap) / (1024 * 1024), 32, 32768) : null,
  });
}

function detectNetwork() {
  const connection = globalThis?.navigator?.connection || globalThis?.navigator?.mozConnection || globalThis?.navigator?.webkitConnection;
  return Object.freeze({
    effectiveType: String(connection?.effectiveType || 'unknown'),
    saveData: Boolean(connection?.saveData),
    downlinkMbps: connection?.downlink == null ? null : clamp(finiteOr(connection.downlink, 0), 0, 10000),
    rttMs: connection?.rtt == null ? null : clamp(finiteOr(connection.rtt, 0), 0, 10000),
  });
}

export async function probePlatformCapabilities(options = {}) {
  const webgl = typeof options.webgl === 'boolean' ? options.webgl : probeWebGL();
  const webgpu = typeof options.webgpu === 'boolean' ? options.webgpu : await probeWebGPU();
  const nav = globalThis?.navigator;
  const capabilities = createRuntimeCapabilities({
    webgl,
    webgpu,
    offscreenCanvas: Boolean(globalThis?.OffscreenCanvas),
    sharedArrayBuffer: Boolean(globalThis?.SharedArrayBuffer),
    indexedDb: Boolean(globalThis?.indexedDB),
    serviceWorker: Boolean(nav?.serviceWorker),
    broadcastChannel: Boolean(globalThis?.BroadcastChannel),
    gamepad: typeof nav?.getGamepads === 'function',
    pointerLock: Boolean(globalThis?.document?.body?.requestPointerLock),
    prefersReducedMotion: safeMatchMedia('(prefers-reduced-motion: reduce)'),
    hardwareConcurrency: integerOr(nav?.hardwareConcurrency, 4),
    devicePixelRatio: finiteOr(globalThis?.devicePixelRatio, 1),
  });

  return Object.freeze({
    capabilities,
    input: detectInput(),
    pwa: detectPwa(),
    memory: detectMemory(),
    network: detectNetwork(),
    screen: Object.freeze({
      width: integerOr(globalThis?.screen?.width, 0),
      height: integerOr(globalThis?.screen?.height, 0),
      colorDepth: integerOr(globalThis?.screen?.colorDepth, 0),
    }),
    browser: Object.freeze({
      userAgent: String(nav?.userAgent || 'unknown'),
      language: String(nav?.language || 'unknown'),
      platform: String(nav?.platform || 'unknown'),
    }),
  });
}

export function classifyPlatformProfile(probe = {}) {
  const c = probe.capabilities || {};
  const memoryGb = finiteOr(probe.memory?.deviceMemoryGb, 4);
  const cores = integerOr(c.hardwareConcurrency, 4);
  const dpr = finiteOr(c.devicePixelRatio, 1);
  const saveData = Boolean(probe.network?.saveData);
  const reducedMotion = Boolean(c.prefersReducedMotion);
  if (!c.webgl && !c.webgpu) return 'compatibility';
  if (saveData || memoryGb <= 1 || cores <= 2) return 'constrained';
  if (reducedMotion || dpr >= 3 || memoryGb <= 2 || cores <= 4) return 'balanced';
  if (c.webgpu && memoryGb >= 8 && cores >= 8) return 'performance';
  return 'balanced';
}

export function capabilityWarnings(probe = {}) {
  const warnings = [];
  const c = probe.capabilities || {};
  if (!c.webgl && !c.webgpu) warnings.push('No supported 3D graphics context was detected.');
  if (!c.indexedDb) warnings.push('IndexedDB is unavailable; persistence should use a fallback adapter.');
  if (!c.serviceWorker) warnings.push('Service worker is unavailable; offline shell support may be reduced.');
  if (c.prefersReducedMotion) warnings.push('Reduced-motion preference is active.');
  if (probe.network?.saveData) warnings.push('Data-saver preference is active.');
  return Object.freeze(warnings);
}

export function createCapabilityMatrix(probe) {
  const c = probe?.capabilities || {};
  return Object.freeze([
    Object.freeze({ capability: 'webgpu', available: Boolean(c.webgpu), impact: 'renderer' }),
    Object.freeze({ capability: 'webgl', available: Boolean(c.webgl), impact: 'renderer-fallback' }),
    Object.freeze({ capability: 'offscreenCanvas', available: Boolean(c.offscreenCanvas), impact: 'worker-presentation' }),
    Object.freeze({ capability: 'indexedDb', available: Boolean(c.indexedDb), impact: 'persistence' }),
    Object.freeze({ capability: 'serviceWorker', available: Boolean(c.serviceWorker), impact: 'offline' }),
    Object.freeze({ capability: 'gamepad', available: Boolean(c.gamepad), impact: 'input' }),
    Object.freeze({ capability: 'pointerLock', available: Boolean(c.pointerLock), impact: 'look-input' }),
    Object.freeze({ capability: 'reducedMotion', available: Boolean(c.prefersReducedMotion), impact: 'accessibility' }),
  ]);
}

export function canPersistSafely({ indexedDb = false, localStorage = false } = {}) {
  return Boolean(indexedDb || localStorage);
}

export function probeStorageAvailability() {
  return Object.freeze({
    localStorage: safeStorageAvailable(globalThis?.localStorage),
    sessionStorage: safeStorageAvailable(globalThis?.sessionStorage),
    indexedDb: Boolean(globalThis?.indexedDB),
  });
}
