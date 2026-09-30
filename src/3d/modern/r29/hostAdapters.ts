import type { R29Backend, R29RenderBackendAdapter, R29RuntimeCapabilities } from './contracts.ts';
import { createHeadlessR29Backend } from './renderCoordinator.ts';

export function detectR29Capabilities(): R29RuntimeCapabilities {
  if (typeof window === 'undefined') {
    return {
      webGpu: false,
      webGl2: false,
      worker: false,
      sharedArrayBuffer: false,
      pointerLock: false,
      devicePixelRatio: 1,
      hardwareConcurrency: 1,
    };
  }
  return {
    webGpu: typeof navigator !== 'undefined' && 'gpu' in navigator,
    webGl2: typeof document !== 'undefined',
    worker: typeof Worker !== 'undefined',
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    pointerLock: 'pointerLockElement' in document,
    devicePixelRatio: Number.isFinite(window.devicePixelRatio) ? window.devicePixelRatio : 1,
    hardwareConcurrency: Number.isFinite(navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : 1,
  };
}

export function createCanvasBackendAdapters(canvas?: HTMLCanvasElement): readonly R29RenderBackendAdapter[] {
  const capabilities = detectR29Capabilities();
  const adapters: R29RenderBackendAdapter[] = [
    {
      backend: 'webgpu',
      available: capabilities.webGpu,
      initialize: async () => {
        if (!capabilities.webGpu || !canvas || typeof navigator === 'undefined' || !('gpu' in navigator)) return;
        const gpu = (navigator as Navigator & { readonly gpu?: unknown }).gpu;
        if (!gpu) throw new Error('R29_WEBGPU_UNAVAILABLE');
      },
    },
    {
      backend: 'webgl2',
      available: capabilities.webGl2,
      initialize: () => {
        if (!canvas) return;
        const context = canvas.getContext('webgl2', { antialias: true, powerPreference: 'high-performance' });
        if (!context) throw new Error('R29_WEBGL2_CONTEXT_UNAVAILABLE');
      },
    },
    createHeadlessR29Backend(),
  ];
  return Object.freeze(adapters);
}

export function backendRank(backend: R29Backend): number {
  return backend === 'webgpu' ? 3 : backend === 'webgl2' ? 2 : backend === 'webgl1' ? 1 : 0;
}
