import assert from 'node:assert/strict';
import { createNextGenRenderOrchestrator } from '../src/3d/rendering/nextGenRenderOrchestrator.js';
import { createRenderPassBudgetPlanner } from '../src/3d/rendering/renderPassBudgetPlanner.js';
import { createGpuInstanceBatchPlanner } from '../src/3d/rendering/gpuInstanceBatchPlanner.js';
import { createTextureResidencyPlanner } from '../src/3d/rendering/textureResidencyPlanner.js';
import { evaluateGpuPressure } from '../src/3d/rendering/gpuPressureModel.js';

const actors = Array.from({ length: 1000 }, (_, index) => ({
  id: `actor-${index}`, distance: index, screenCoverage: 1 / (1 + index / 60), importance: index % 100 === 0 ? 1.5 : 0.2,
}));
const renderables = actors.map((actor, index) => ({
  id: `renderable-${index}`, distance: actor.distance, screenCoverage: actor.screenCoverage, importance: actor.importance,
  visible: index % 17 !== 0, frustumVisible: index % 31 !== 0, geometryKey: `g-${index % 40}`, materialKey: `m-${index % 18}`,
}));
const instances = renderables.map((item) => ({ ...item, geometryKey: `instance-${item.geometryKey}` }));
const textures = renderables.slice(0, 800).map((item, index) => ({ id: `tex-${index}`, width: 2048, height: 2048, format: index % 2 ? 'rgba8' : 'rgba16float', distance: item.distance, screenCoverage: item.screenCoverage, importance: item.importance, compressed: index % 2 === 0 }));

const orchestrator = createNextGenRenderOrchestrator({ initialRenderScale: 0.9 });
let last;
for (let frame = 0; frame < 30; frame += 1) {
  last = orchestrator.renderFrame({
    frameMs: frame < 10 ? 38 : frame < 20 ? 21 : 12,
    cpuMs: frame % 4 + 3,
    gpuMs: frame < 10 ? 30 : 8,
    backend: frame % 5 === 0 ? 'webgl2' : 'webgpu',
    runtimeTier: frame < 15 ? 'high' : 'ultra',
    hardwareScore: 0.85,
    thermalPressure: frame < 8 ? 0.9 : 0.25,
    width: 2560,
    height: 1440,
    renderables,
    instances,
    textures,
    triangles: 3200000,
    shaderRequests: [{ features: { skinning: true, normalMap: true, fog: true }, materialFamily: 'environment' }],
    timestampMs: frame * 16.67,
  });
  assert.ok(last.visibility.visible.length <= 2048);
  assert.ok(last.instances.batches.length <= 1024);
  assert.ok(last.instances.batches.every((batch) => batch.instanceCount <= 2048));
  assert.ok(last.textures.resident.length <= 800);
  assert.ok(last.pipeline.effects.length <= 9);
  assert.ok(last.frameGraph.passes.length <= 64);
}
assert.ok(last.metrics.frame === 30);
assert.ok(orchestrator.diagnostics().metrics.samples.frameMs.count <= 240);

const pressure = evaluateGpuPressure({ frameMs: 40, gpuMs: 35, cpuMs: 8, memoryUtilization: 0.96, thermalPressure: 0.95 });
assert.equal(pressure.state, 'critical');

const passPlanner = createRenderPassBudgetPlanner();
const passResult = passPlanner.plan(Array.from({ length: 50 }, (_, index) => ({ id: `p-${index}`, costMs: 0.2 + index / 20, priority: index % 5 === 0 ? 1 : 0.2, optional: index % 9 !== 0 })), { budgetMs: 4, emergency: true });
assert.ok(passResult.spentMs <= 4);
assert.ok(passResult.accepted.length <= 32);

const instancePlanner = createGpuInstanceBatchPlanner();
const stressInstances = instancePlanner.plan(Array.from({ length: 12000 }, (_, index) => ({ id: `i-${index}`, geometryKey: `g-${index % 20}`, materialKey: `m-${index % 10}`, distance: index, screenCoverage: 0.5, importance: 0.4 })), { tier: 'minimal', thermalPressure: 1 });
assert.ok(stressInstances.inputCount <= 8192);
assert.ok(stressInstances.batches.every((batch) => batch.instanceCount <= 256));

const texturePlanner = createTextureResidencyPlanner();
const stressTextures = texturePlanner.plan(Array.from({ length: 12000 }, (_, index) => ({ id: `t-${index}`, width: 4096, height: 4096, distance: index * 2, screenCoverage: 0.2, importance: 0.3, compressed: true })), { tier: 'minimal', budgetMb: 64 });
assert.ok(stressTextures.resident.length <= 12000);
assert.ok(stressTextures.deferred.length <= 1024);
assert.ok(Number.isFinite(stressTextures.utilization));

orchestrator.dispose();
assert.equal(orchestrator.disposed, true);
console.log('next-gen render scene stress: PASS');
