// @ts-nocheck
import assert from 'node:assert/strict';
import { BACKENDS, buildRenderProfile, detectRenderCapabilities, selectRenderBackend } from './renderBackendCapability.js';

const desktopGpu = {
  webgpu: true,
  webgl2: true,
  webgl: true,
  cpuCores: 8,
  memoryGiB: 8,
  coarsePointer: false,
  pixelRatio: 2,
  secureContext: true,
  offscreenCanvas: true,
  worker: true,
  sharedArrayBuffer: true,
  crossOriginIsolated: true,
};
const selection = selectRenderBackend(desktopGpu);
assert.equal(selection.backend, BACKENDS.WEBGPU);
assert.equal(selection.tier, 'ultra');
const profile = buildRenderProfile(desktopGpu, selection);
assert.equal(profile.enableTemporalHistory, true);
assert.equal(profile.enableWorkerRendering, true);

const fallback = selectRenderBackend({ ...desktopGpu, webgpu: false });
assert.equal(fallback.backend, BACKENDS.WEBGL2);

const noGpu = selectRenderBackend({ ...desktopGpu, webgpu: false, webgl2: false, webgl: false });
assert.equal(noGpu.backend, BACKENDS.NONE);

const original = globalThis.navigator;
try {
  globalThis.navigator = {
    hardwareConcurrency: 4,
    deviceMemory: 4,
    gpu: { requestAdapter() {} },
  };
  globalThis.window = { devicePixelRatio: 1, matchMedia: () => ({ matches: false }) };
  globalThis.document = { createElement: () => ({ getContext: () => null }) };
  const detected = detectRenderCapabilities();
  assert.equal(detected.webgpu, true);
  assert.equal(detected.webgl2, false);
} finally {
  try { globalThis.navigator = original; } catch {}
}

console.log('[renderBackendCapability] acceptance passed');
