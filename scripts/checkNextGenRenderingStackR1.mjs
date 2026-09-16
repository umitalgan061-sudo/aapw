import assert from 'node:assert/strict';
import { BACKENDS, chooseRendererBackend } from '../src/3d/rendering/nextGenRendererAdapter.js';
import { buildRenderPipelinePolicy, estimatePipelineCost, migratePipelinePolicy, validatePipelinePolicy } from '../src/3d/rendering/renderPipelinePolicy.js';
import { buildInstanceBufferLayout, planInstanceBatches, validateInstancePlan } from '../src/3d/rendering/instanceBudgetPlanner.js';
import { buildTextureResidencyPlan, deriveTextureMip, estimateTextureBytes, validateTextureResidencyPlan } from '../src/3d/rendering/textureResidencyPolicy.js';

assert.equal(chooseRendererBackend({ requestedBackend: BACKENDS.WEBGPU, webgpuAvailable: true }), BACKENDS.WEBGPU);
assert.equal(chooseRendererBackend({ requestedBackend: BACKENDS.WEBGPU, webgpuAvailable: false }), BACKENDS.WEBGL2);
assert.equal(chooseRendererBackend({ requestedBackend: BACKENDS.WEBGL2, webgpuAvailable: true }), BACKENDS.WEBGL2);

const webGpuPolicy = buildRenderPipelinePolicy({ backend: 'webgpu', runtimeTier: 'ultra', hardwareScore: 0.95 });
const webGlPolicy = buildRenderPipelinePolicy({ backend: 'webgl2', runtimeTier: 'ultra', hardwareScore: 0.95 });
assert.equal(validatePipelinePolicy(webGpuPolicy), true);
assert.equal(validatePipelinePolicy(webGlPolicy), true);
assert.ok(webGpuPolicy.mrt);
assert.ok(webGpuPolicy.effects.includes('ssgi'));
assert.ok(!webGlPolicy.effects.includes('ssgi'));
assert.deepEqual(migratePipelinePolicy({ backend: 'webgpu', tier: 'high', version: 1 }).backend, 'webgpu');
const cost = estimatePipelineCost(webGpuPolicy, { drawCalls: 600, triangles: 1_800_000, foliageInstances: 4500 });
assert.ok(cost.gpuMs > 0);

const instances = Array.from({ length: 6000 }, (_, i) => ({
  id: `inst-${i}`,
  x: ((i * 17) % 1000) - 500,
  y: 2,
  z: ((i * 29) % 1000) - 500,
  geometryKey: `g-${i % 8}`,
  materialKey: `m-${i % 4}`,
  lod: i % 3,
  visible: i % 17 !== 0,
  importance: i % 101,
}));
const plan = planInstanceBatches({ items: instances, origin: { x: 0, z: 0 }, tier: 'high' });
assert.equal(validateInstancePlan(plan), true);
assert.ok(plan.instanceCount <= 8000);
assert.ok(plan.batchCount <= 180);
const reversedPlan = planInstanceBatches({ items: [...instances].reverse(), origin: { x: 0, z: 0 }, tier: 'high' });
assert.deepEqual(plan.accepted.map((x) => x.id), reversedPlan.accepted.map((x) => x.id));
const layout = buildInstanceBufferLayout({ maxInstances: 2048 });
assert.ok(layout.strideBytes > 0 && layout.estimatedBytes > layout.strideBytes);

const textures = Array.from({ length: 400 }, (_, i) => ({
  id: `tex-${i}`,
  x: ((i * 31) % 1600) - 800,
  z: ((i * 23) % 1600) - 800,
  width: 2048,
  height: 2048,
  mipLevels: 12,
  mipCount: 12,
  format: i % 2 ? 'bc7' : 'rgba8',
  importance: i % 100,
  screenCoverage: (i % 10) / 10,
}));
assert.ok(estimateTextureBytes(textures[0]) > 0);
assert.ok(deriveTextureMip({ distanceMeters: 1200, screenCoverage: 0.02, importance: 1, tier: 'balanced', maximumMip: 12 }) >= deriveTextureMip({ distanceMeters: 20, screenCoverage: 0.8, importance: 90, tier: 'balanced', maximumMip: 12 }));
const residency = buildTextureResidencyPlan({ textures, tier: 'high', maxResidentBytes: 128 * 1024 * 1024 });
assert.equal(validateTextureResidencyPlan(residency), true);
assert.ok(residency.residentBytes <= residency.capacityBytes);
assert.ok(residency.resident.length > 0);

console.log(JSON.stringify({
  renderer: { webgpu: webGpuPolicy, webgl2: webGlPolicy },
  instancing: { accepted: plan.instanceCount, batches: plan.batchCount, rejected: plan.rejectedCount },
  textures: { resident: residency.resident.length, deferred: residency.deferredCount, bytes: residency.residentBytes },
  status: 'acceptance-passed',
}, null, 2));
