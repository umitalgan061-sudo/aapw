/**
 * Integration contract between the physical Three.js renderer adapter and policy decisions.
 *
 * This module intentionally contains no Three.js imports. It validates and normalizes the boundary
 * packet that a composition root can pass to nextGenRendererAdapter.js. Keeping this seam library-free
 * allows CI to prove backend correctness without constructing a browser GPU context.
 *
 * @module renderBackendIntegrationContract
 */

const freeze = Object.freeze;
const finite = (v, f = 0) => Number.isFinite(Number(v)) ? Number(v) : f;
const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, finite(v, min)));

export const RENDER_BACKEND_INTEGRATION_POLICY = freeze({
  id: 'render-backend-integration-contract-2026-09-v1',
  maxPixelRatio: 2.5,
  minPixelRatio: 0.5,
  maxWidth: 16384,
  maxHeight: 16384,
  maxReasons: 16,
});

export function createRendererIntegrationRequest(packet = {}, options = {}) {
  const width = Math.min(RENDER_BACKEND_INTEGRATION_POLICY.maxWidth, Math.max(1, Math.floor(finite(options.width ?? packet.width, 1280))));
  const height = Math.min(RENDER_BACKEND_INTEGRATION_POLICY.maxHeight, Math.max(1, Math.floor(finite(options.height ?? packet.height, 720))));
  const pixelRatio = clamp(options.pixelRatio ?? packet.pixelRatio, RENDER_BACKEND_INTEGRATION_POLICY.minPixelRatio, RENDER_BACKEND_INTEGRATION_POLICY.maxPixelRatio);
  const requestedBackend = options.backend === 'webgpu' ? 'webgpu' : options.backend === 'webgl2' ? 'webgl2' : 'webgpu';
  const fallbackAllowed = options.fallbackAllowed !== false;
  const reasons = (Array.isArray(options.reasons) ? options.reasons : []).slice(0, RENDER_BACKEND_INTEGRATION_POLICY.maxReasons).map((value) => String(value).slice(0, 96));
  return freeze({
    schema: RENDER_BACKEND_INTEGRATION_POLICY.id,
    requestedBackend,
    fallbackAllowed,
    width,
    height,
    pixelRatio: Number(pixelRatio.toFixed(3)),
    antialias: options.antialias !== false,
    alpha: options.alpha === true,
    reversedDepthBuffer: options.reversedDepthBuffer === true,
    outputBuffer: packet.outputBuffer === 'half-float' ? 'half-float' : 'unsigned-byte',
    reasons: freeze(reasons),
  });
}

export function normalizeRendererIntegrationResult(result = {}) {
  const backend = result.backend === 'webgpu' ? 'webgpu' : 'webgl2';
  return freeze({
    backend,
    initialized: result.initialized === true,
    fallback: result.fallback === true,
    hasRenderer: Boolean(result.renderer),
    reason: String(result.reason || '').slice(0, 160),
  });
}

export function validateRendererIntegrationResult(result) {
  return Boolean(result && ['webgpu', 'webgl2'].includes(result.backend) && typeof result.initialized === 'boolean' && typeof result.fallback === 'boolean');
}

export function rendererRecoveryDecision({ requestedBackend = 'webgpu', result = {}, recoveryState = 'healthy' } = {}) {
  const normalized = normalizeRendererIntegrationResult(result);
  if (normalized.initialized) return freeze({ action: 'continue', backend: normalized.backend, fallback: normalized.fallback });
  if (recoveryState === 'exhausted') return freeze({ action: 'safe-mode', backend: 'webgl2', fallback: true });
  if (requestedBackend === 'webgpu') return freeze({ action: 'retry-or-fallback', backend: 'webgl2', fallback: true });
  return freeze({ action: 'retry', backend: 'webgl2', fallback: false });
}
