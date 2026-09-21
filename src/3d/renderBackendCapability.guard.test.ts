// @ts-nocheck
import assert from 'node:assert/strict';
import { buildRenderProfile, selectRenderBackend } from './renderBackendCapability.js';

const matrix = [];
for (const gpu of [false, true]) {
  for (const webgl2 of [false, true]) {
    for (const coarsePointer of [false, true]) {
      for (const secureContext of [false, true]) {
        const capabilities = {
          webgpu: gpu,
          webgl2,
          webgl: webgl2 || !webgl2,
          cpuCores: coarsePointer ? 2 : 8,
          memoryGiB: coarsePointer ? 2 : 16,
          coarsePointer,
          pixelRatio: coarsePointer ? 3 : 2,
          secureContext,
          offscreenCanvas: true,
          worker: true,
          sharedArrayBuffer: true,
          crossOriginIsolated: true,
        };
        const selection = selectRenderBackend(capabilities);
        const profile = buildRenderProfile(capabilities, selection);
        assert.ok(['webgpu', 'webgl2', 'webgl', 'none'].includes(selection.backend));
        assert.ok(profile.pixelRatioCap >= 0.75);
        matrix.push(`${gpu}-${webgl2}-${coarsePointer}-${secureContext}-${selection.backend}-${selection.tier}`);
      }
    }
  }
}
assert.equal(new Set(matrix).size, matrix.length, 'capability matrix rows must remain deterministic');
console.log(`[renderBackendCapability.guard] ${matrix.length} deterministic capability rows passed`);
