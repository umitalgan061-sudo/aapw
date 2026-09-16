import assert from 'node:assert/strict';
import { createDynamicResolutionGovernor } from '../src/3d/rendering/dynamicResolutionGovernor.js';
import { createRenderDeviceRecovery, recoverRendererDevice } from '../src/3d/rendering/renderDeviceRecovery.js';
import { createFrameGraphResourcePlanner } from '../src/3d/rendering/frameGraphResourcePlanner.js';
import { createShaderVariantRegistry } from '../src/3d/rendering/shaderVariantRegistry.js';
import { createTextureResidencyPlanner } from '../src/3d/rendering/textureResidencyPlanner.js';
import { createGpuInstanceBatchPlanner } from '../src/3d/rendering/gpuInstanceBatchPlanner.js';
import { createRenderVisibilityScheduler } from '../src/3d/rendering/renderVisibilityScheduler.js';
import { createRenderPassBudgetPlanner } from '../src/3d/rendering/renderPassBudgetPlanner.js';
import { createTemporalHistoryController } from '../src/3d/rendering/renderTemporalHistoryPolicy.js';
import { createRenderMaterialMigrationRegistry } from '../src/3d/rendering/renderMaterialMigrationRegistry.js';

const pathologicalNumber = { x: NaN, y: Infinity, z: -Infinity };
const renderables = Array.from({ length: 5000 }, (_, index) => ({
  id: `adv-${index}`,
  distance: index % 3 ? index * 3 : NaN,
  screenCoverage: index % 5 ? 0.1 : Infinity,
  importance: index % 7 ? 0.4 : 2,
  visible: index % 19 !== 0,
  frustumVisible: index % 31 !== 0,
  geometryKey: `g-${index % 40}`,
  materialKey: `m-${index % 20}`,
}));

const visibility = createRenderVisibilityScheduler();
const scheduled = visibility.schedule(renderables, 10);
assert.ok(scheduled.inputCount <= 4096);
assert.ok(scheduled.visible.length <= 2048);
assert.ok(scheduled.deferred.length <= 4096);
assert.ok(scheduled.visible.every((item) => Number.isFinite(item.score)));

const instances = createGpuInstanceBatchPlanner();
const instanceItems = renderables.map((item) => ({ ...item, position: pathologicalNumber }));
const instancePlan = instances.plan(instanceItems, { tier: 'ultra', thermalPressure: 1 });
assert.ok(instancePlan.inputCount <= 8192);
assert.ok(instancePlan.batches.length <= 1024);
assert.ok(instancePlan.batches.every((batch) => batch.instanceCount <= 2048));

const textures = createTextureResidencyPlanner();
const texturePlan = textures.plan(Array.from({ length: 1000 }, (_, index) => ({
  id: `adv-tex-${index}`,
  width: index % 11 === 0 ? Infinity : 4096,
  height: index % 13 === 0 ? NaN : 4096,
  format: index % 2 ? 'rgba8' : 'rgba16float',
  distance: index * 7,
  screenCoverage: index % 9 === 0 ? Infinity : 0.5,
  importance: index % 17 === 0 ? 1.5 : 0.3,
  compressed: index % 3 === 0,
  persistent: index < 3,
})), { tier: 'high', budgetMb: 128 });
assert.ok(texturePlan.resident.length > 0);
assert.ok(texturePlan.deferred.length <= 1000);
assert.ok(texturePlan.resident.length <= 1000);

const shaders = createShaderVariantRegistry();
for (let index = 0; index < 3000; index += 1) {
  shaders.request({ skinning: index % 2 === 0, normalMap: index % 3 === 0, instancing: true, fog: true }, { backend: index % 2 ? 'webgl2' : 'webgpu', quality: index % 4 ? 'high' : 'ultra', materialFamily: `family-${index % 8}`, frame: index });
}
assert.ok(shaders.snapshot().variantCount <= 2048);
assert.ok(shaders.snapshot().requestCount <= 2048);

const graph = createFrameGraphResourcePlanner();
for (let index = 0; index < 100; index += 1) {
  graph.addResource({ id: `res-${index}`, width: 1920, height: 1080, format: index % 2 ? 'rgba8unorm' : 'rgba16float', usage: 'color', transient: index % 3 !== 0 });
}
for (let index = 0; index < 100; index += 1) graph.addPass({ id: `pass-${index}`, order: index, reads: index ? [`res-${index - 1}`] : [], writes: [`res-${index}`] });
assert.ok(graph.snapshot().passes.length <= 64);
assert.ok(graph.snapshot().resources.length <= 128);

const passBudget = createRenderPassBudgetPlanner();
const budget = passBudget.plan(Array.from({ length: 100 }, (_, index) => ({ id: `pass-${index}`, costMs: 0.5 + index / 100, priority: index % 11 === 0 ? 1 : 0.2, optional: index % 7 !== 0 })), { budgetMs: 8 });
assert.ok(budget.spentMs <= 8 + 1e-6);
assert.ok(budget.accepted.length + budget.rejected.length <= 32);

const temporal = createTemporalHistoryController();
for (const timestamp of [0, 16, 32, 48, 64, 80, 96, 112]) temporal.update({ timestampMs: timestamp, renderScale: 0.85, historyAvailable: true, motionConfidence: 1 });
assert.equal(temporal.valid, true);
temporal.update({ timestampMs: 2000, renderScale: 0.85, historyAvailable: true, motionConfidence: 1 });
assert.equal(temporal.valid, false);
assert.equal(temporal.snapshot().lastReason, 'visibility-gap');

temporal.reset('manual');
assert.equal(temporal.valid, false);

const recovery = createRenderDeviceRecovery({ policy: { maxAttempts: 2, downgradeAfterAttempts: 1 } });
const success = await recoverRendererDevice({ recovery, currentBackend: 'webgpu', timestampMs: 10, rebuild: async () => ({ resources: 1 }) });
assert.equal(success.recovered, true);
const failed = await recoverRendererDevice({ recovery, currentBackend: 'webgpu', timestampMs: 20, rebuild: async () => { throw new Error('GPU_FAIL'); }, fallback: async () => ({ backend: 'webgl2' }) });
assert.equal(failed.recovered, true);
recovery.dispose();

const materials = createRenderMaterialMigrationRegistry();
for (let index = 0; index < 1500; index += 1) materials.register({ id: `mat-${index}`, shaderMaterial: index % 2 === 0, estimatedVariants: index % 32 });
assert.ok(materials.snapshot().readiness.total <= 1024);
assert.ok(materials.migrationQueue({ limit: 256 }).length <= 256);

const governor = createDynamicResolutionGovernor({ initialScale: 0.85 });
for (let index = 0; index < 200; index += 1) governor.update({ frameMs: index % 5 === 0 ? 40 : 12, thermalPressure: index % 9 === 0 ? 1 : 0.2 });
assert.ok(governor.scale >= 0.55 && governor.scale <= 1);
assert.ok(!Number.isNaN(governor.scale));

console.log('next-gen render adversarial hardening: PASS');
