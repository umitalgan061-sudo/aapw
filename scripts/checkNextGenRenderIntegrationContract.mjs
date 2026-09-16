import assert from 'node:assert/strict';
import { createRendererIntegrationRequest, normalizeRendererIntegrationResult, validateRendererIntegrationResult, rendererRecoveryDecision } from '../src/3d/rendering/renderBackendIntegrationContract.js';

const request = createRendererIntegrationRequest({ outputBuffer: 'half-float' }, {
  backend: 'webgpu', width: 3840, height: 2160, pixelRatio: 3, antialias: true,
  reasons: ['high-end', 'ultra', ...Array.from({ length: 30 }, (_, i) => `r-${i}`)],
});
assert.equal(request.requestedBackend, 'webgpu');
assert.equal(request.width, 3840);
assert.equal(request.height, 2160);
assert.ok(request.pixelRatio <= 2.5);
assert.ok(request.reasons.length <= 16);
assert.equal(request.outputBuffer, 'half-float');

const ok = normalizeRendererIntegrationResult({ backend: 'webgpu', initialized: true, fallback: false, renderer: {} });
assert.equal(validateRendererIntegrationResult(ok), true);
assert.equal(rendererRecoveryDecision({ requestedBackend: 'webgpu', result: ok, recoveryState: 'healthy' }).action, 'continue');

const fallback = rendererRecoveryDecision({ requestedBackend: 'webgpu', result: { backend: 'webgpu', initialized: false, fallback: false }, recoveryState: 'suspected-loss' });
assert.equal(fallback.action, 'retry-or-fallback');
assert.equal(fallback.backend, 'webgl2');

const safe = rendererRecoveryDecision({ requestedBackend: 'webgpu', result: { backend: 'webgpu', initialized: false, fallback: false }, recoveryState: 'exhausted' });
assert.equal(safe.action, 'safe-mode');
assert.equal(safe.backend, 'webgl2');

console.log('next-gen render integration contract: PASS');
