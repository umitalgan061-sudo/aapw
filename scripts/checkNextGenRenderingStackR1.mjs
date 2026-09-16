import assert from 'node:assert/strict';
import { BACKENDS, chooseRendererBackend } from '../src/3d/rendering/nextGenRendererAdapter.js';
import { buildRenderPipelinePolicy, estimatePipelineCost, migratePipelinePolicy, validatePipelinePolicy } from '../src/3d/rendering/renderPipelinePolicy.js';
import { buildInstanceBufferLayout, planInstanceBatches, validateInstancePlan } from '../src/3d/rendering/instanceBudgetPlanner.js';
import { buildTextureResidencyPlan, deriveTextureMip, estimateTextureBytes, validateTextureResidencyPlan } from '../src/3d/rendering/textureResidencyPolicy.js';
import { buildVisibilityLodPlan, validateVisibilityLodPlan } from '../src/3d/rendering/visibilityLodPlanner.js';
import { allocateGpuPassBudget, buildGpuPassBudgetPlan, recommendDynamicResolution, validateGpuPassBudgetPlan } from '../src/3d/rendering/gpuPassBudget.js';

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

const sceneItems = Array.from({ length: 2500 }, (_, i) => ({
  id: `obj-${i}`,
  x: ((i * 13) % 1800) - 900,
  y: 2,
  z: ((i * 19) % 1800) - 900,
  radius: 1 + (i % 7) / 4,
  importance: i % 100,
  visible: i % 29 !== 0,
  castShadow: i % 3 !== 0,
  animated: i % 5 === 0,
  playerFocused: i === 0,
  velocityMetersPerSecond: i % 11,
}));
const visibility = buildVisibilityLodPlan({ items: sceneItems, camera: { x: 0, y: 4, z: 0 }, viewportHeight: 1080, tier: 'high' });
assert.equal(validateVisibilityLodPlan(visibility), true);
assert.ok(visibility.counts.visible <= 2200);
assert.ok(visibility.counts.shadows <= 360);
assert.ok(visibility.counts.animated <= 420);
const reversedVisibility = buildVisibilityLodPlan({ items: [...sceneItems].reverse(), camera: { x: 0, y: 4, z: 0 }, viewportHeight: 1080, tier: 'high' });
assert.deepEqual(visibility.visible.map((item) => item.id), reversedVisibility.visible.map((item) => item.id));

const allocations = allocateGpuPassBudget(10);
assert.ok(allocations.base > 0);
const passPlan = buildGpuPassBudgetPlan({ targetFrameMs: 16.67, estimatedGpuMs: 17, qualityScale: 0.9, pressure: 0.45 });
assert.equal(validateGpuPassBudgetPlan(passPlan), true);
assert.ok(passPlan.estimatedAfterSheddingMs < passPlan.estimatedGpuMs);
const resolution = recommendDynamicResolution({ currentScale: 1, measuredGpuMs: 18, targetGpuMs: 10 });
assert.equal(resolution.direction, 'down');

console.log(JSON.stringify({
  renderer: { webgpu: webGpuPolicy, webgl2: webGlPolicy },
  instancing: { accepted: plan.instanceCount, batches: plan.batchCount, rejected: plan.rejectedCount },
  textures: { resident: residency.resident.length, deferred: residency.deferredCount, bytes: residency.residentBytes },
  visibility: visibility.counts,
  gpuBudget: { enabled: passPlan.enabled, shed: passPlan.shed, budgetMs: passPlan.gpuBudgetMs },
  status: 'acceptance-passed',
}, null, 2));