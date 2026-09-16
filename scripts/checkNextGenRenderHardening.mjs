import assert from 'node:assert/strict';
import { createDynamicResolutionGovernor, recommendDynamicResolution } from '../src/3d/rendering/dynamicResolutionGovernor.js';
import { createFrameGraphResourcePlanner, estimateTransientMemory } from '../src/3d/rendering/frameGraphResourcePlanner.js';
import { createGpuInstanceBatchPlanner, estimateInstanceUploadBytes } from '../src/3d/rendering/gpuInstanceBatchPlanner.js';
import { createRenderDeviceRecovery } from '../src/3d/rendering/renderDeviceRecovery.js';
import { createRenderMaterialMigrationRegistry, materialMigrationRisk } from '../src/3d/rendering/renderMaterialMigrationRegistry.js';
import { createRenderMetricsCollector } from '../src/3d/rendering/renderMetricsCollector.js';
import { compileRenderPipelineDescriptor, migrateLegacyPostProcess, pipelineCostClass } from '../src/3d/rendering/renderPipelineComposer.js';
import { createRenderPassBudgetPlanner, passBudgetDigest } from '../src/3d/rendering/renderPassBudgetPlanner.js';
import { createRenderVisibilityScheduler, groupRenderCandidates } from '../src/3d/rendering/renderVisibilityScheduler.js';
import { createShaderVariantRegistry, canonicalShaderVariant, parseShaderVariantKey } from '../src/3d/rendering/shaderVariantRegistry.js';
import { createTextureResidencyPlanner, textureResidencyDigest } from '../src/3d/rendering/textureResidencyPlanner.js';
import { createTemporalHistoryController, shouldInvalidateTemporalHistory } from '../src/3d/rendering/renderTemporalHistoryPolicy.js';
import { createNextGenRenderOrchestrator } from '../src/3d/rendering/nextGenRenderOrchestrator.js';
import { createOcclusionHintPlanner } from '../src/3d/rendering/occlusionHintPlanner.js';

const governor = createDynamicResolutionGovernor({ initialScale: 0.9 });
const down = governor.update({ frameMs: 40, thermalPressure: 0.9, saveData: false });
assert.ok(down.scale <= 0.9);
for (let i = 0; i < 20; i += 1) governor.update({ frameMs: 40, thermalPressure: 0.9 });
assert.ok(governor.scale >= 0.55 && governor.scale <= 1);
governor.setForcedScale(0.7);
assert.equal(governor.scale, 0.7);
governor.update({ frameMs: 4 });
assert.equal(governor.scale, 0.7);
governor.setForcedScale(null);
assert.ok(recommendDynamicResolution({ gpuMs: 40, cpuMs: 20, currentScale: 0.9 }).recommendedScale < 0.9);
governor.reset();
assert.equal(governor.frame, 0);

const graph = createFrameGraphResourcePlanner();
graph.addResource({ id: 'color-a', width: 1920, height: 1080, format: 'rgba8unorm', usage: 'color', transient: true });
graph.addResource({ id: 'color-b', width: 1920, height: 1080, format: 'rgba8unorm', usage: 'color', transient: true });
graph.addResource({ id: 'depth', width: 1920, height: 1080, format: 'depth24plus', usage: 'depth', transient: true });
graph.addPass({ id: 'opaque', order: 0, writes: ['color-a', 'depth'] });
graph.addPass({ id: 'post', order: 1, reads: ['color-a', 'depth'], writes: ['color-b'] });
graph.addPass({ id: 'present', order: 2, reads: ['color-b'] });
const graphSnapshot = graph.snapshot();
assert.deepEqual(graphSnapshot.dependencies.order, ['opaque', 'post', 'present']);
assert.ok(graphSnapshot.aliasing.peakTransientSlots >= 1);
assert.ok(estimateTransientMemory(graphSnapshot).conservativeMb >= 0);
graph.reset();
assert.equal(graph.snapshot().passes.length, 0);

const instancePlanner = createGpuInstanceBatchPlanner();
const instances = Array.from({ length: 400 }, (_, index) => ({ id: `inst-${index}`, geometryKey: `g-${index % 4}`, materialKey: `m-${index % 2}`, distance: index, screenCoverage: 1 - (index / 500), importance: index % 10 === 0 ? 1.4 : 0.5, visible: index % 31 !== 0 }));
const plannedA = instancePlanner.plan(instances, { tier: 'high' });
const plannedB = instancePlanner.plan([...instances].reverse(), { tier: 'high' });
assert.deepEqual(plannedA.batches, plannedB.batches);
assert.equal(plannedA.inputCount, instances.length);
assert.equal(plannedA.visibleCount + plannedA.deferredCount, plannedA.inputCount);
assert.ok(estimateInstanceUploadBytes(plannedA).bytes >= 0);
assert.equal(instancePlanner.compareOrder(instances, [...instances].reverse(), { tier: 'high' }).equal, true);

const recovery = createRenderDeviceRecovery({ policy: { maxAttempts: 2, downgradeAfterAttempts: 1 } });
recovery.signalLoss('device-lost', 100);
const attempt1 = recovery.beginRebuild(120);
assert.equal(attempt1.state, 'rebuilding');
recovery.rebuildSucceeded(130);
recovery.tick(6000);
assert.equal(recovery.state, 'healthy');
recovery.signalLoss('again', 7000);
recovery.beginRebuild(7050);
recovery.signalLoss('again', 7100);
recovery.beginRebuild(7150);
assert.ok(['rebuilding', 'exhausted'].includes(recovery.state));
assert.equal(recovery.recommendedBackend('webgpu'), 'webgl2');
recovery.dispose();
assert.equal(recovery.exhausted(), true);

const materials = createRenderMaterialMigrationRegistry();
materials.register({ id: 'legacy', shaderMaterial: true, estimatedVariants: 12 });
materials.register({ id: 'blocked', rawShaderMaterial: true });
materials.register({ id: 'node', nodeMaterial: true });
assert.equal(materials.get('node').webgpuReady, true);
assert.equal(materialMigrationRisk(materials.get('blocked')), 'critical');
assert.equal(materials.readinessSummary().total, 3);
assert.ok(materials.migrationQueue({ limit: 2 }).length > 0);
materials.reset();
assert.equal(materials.readinessSummary().total, 0);

const metrics = createRenderMetricsCollector();
for (let i = 0; i < 20; i += 1) metrics.recordFrame({ frameMs: 10 + i, gpuMs: 7 + i * 0.1, cpuMs: 3, drawCalls: 100 + i, triangles: 1000000, instances: 500, renderScale: 0.8, backend: i % 2 ? 'webgpu' : 'webgl2', tier: 'high' });
metrics.event('render.recovery', { backend: 'webgpu', retry: 1 }, 20);
assert.ok(metrics.snapshot().samples.frameMs.p95 >= metrics.snapshot().samples.frameMs.p50);
metrics.dispose();
assert.equal(metrics.disposed, true);

const descriptor = compileRenderPipelineDescriptor({ backend: 'webgpu', tier: 'ultra', effects: ['taa', 'bloom', 'ssgi', 'dof', 'lut'], mrt: true, temporalHistory: true, outputBuffer: 'half-float', toneMapping: 'aces-filmic' });
assert.ok(descriptor.effectIds.includes('ssgi'));
assert.ok(!migrateLegacyPostProcess({ backend: 'webgl2', legacyEffects: ['ssgi', 'bloom'], quality: 'balanced' }).effectIds.includes('ssgi'));
assert.ok(['light', 'medium', 'heavy'].includes(pipelineCostClass(descriptor)));

const passBudget = createRenderPassBudgetPlanner();
const passPlanA = passBudget.plan([
  { id: 'geometry', costMs: 2, priority: 1, optional: false },
  { id: 'bloom', costMs: 3, priority: 0.5 },
  { id: 'ssgi', costMs: 5, priority: 0.8 },
  { id: 'lut', costMs: 0.6, priority: 0.4 },
], { budgetMs: 5 });
const passPlanB = passBudget.plan([
  { id: 'lut', costMs: 0.6, priority: 0.4 },
  { id: 'ssgi', costMs: 5, priority: 0.8 },
  { id: 'geometry', costMs: 2, priority: 1, optional: false },
  { id: 'bloom', costMs: 3, priority: 0.5 },
], { budgetMs: 5 });
assert.equal(passBudgetDigest(passPlanA), passBudgetDigest(passPlanB));

const visibility = createRenderVisibilityScheduler();
const renderables = Array.from({ length: 300 }, (_, index) => ({ id: `r-${index}`, distance: index * 2, screenCoverage: Math.max(0.01, 1 - index / 330), importance: index % 25 === 0 ? 1.5 : 0.7, visible: index % 37 !== 0, geometryKey: `g-${index % 5}`, materialKey: `m-${index % 3}`, frustumVisible: index % 53 !== 0 }));
const visA = visibility.schedule(renderables, 1);
const visB = visibility.schedule([...renderables].reverse(), 1);
assert.deepEqual(visA.visible, visB.visible);
assert.equal(groupRenderCandidates(visA.visible).reduce((sum, group) => sum + group.count, 0), visA.visible.length);

const shaders = createShaderVariantRegistry();
const keyA = canonicalShaderVariant({ skinning: true, normalMap: true, fog: true }, { backend: 'webgpu', quality: 'high', materialFamily: 'standard' });
const keyB = canonicalShaderVariant({ fog: true, normalMap: true, skinning: true }, { backend: 'webgpu', quality: 'high', materialFamily: 'standard' });
assert.equal(keyA, keyB);
assert.deepEqual(parseShaderVariantKey(keyA), parseShaderVariantKey(keyB));
shaders.request({ skinning: true, fog: true }, { backend: 'webgpu', quality: 'high', frame: 1 });
shaders.request({ skinning: true, fog: true }, { backend: 'webgpu', quality: 'high', frame: 2 });
assert.equal(shaders.topVariants(1)[0].hitCount, 2);
assert.ok(shaders.compileBudget({ maxCompileMs: 4 }).estimatedMs >= 0);

const textures = createTextureResidencyPlanner();
const textureInputs = Array.from({ length: 100 }, (_, index) => ({ id: `tex-${index}`, width: 2048, height: 2048, format: index % 2 ? 'rgba8' : 'rgba16float', distance: index * 4, screenCoverage: Math.max(0.01, 1 - index / 120), importance: index < 4 ? 1.5 : 0.5, compressed: index % 3 === 0, persistent: index < 2 }));
const texA = textures.plan(textureInputs, { tier: 'high', budgetMb: 256 });
const texB = textures.plan([...textureInputs].reverse(), { tier: 'high', budgetMb: 256 });
assert.equal(textureResidencyDigest(texA), textureResidencyDigest(texB));
assert.ok(texA.spentBytes <= texA.budgetBytes + texA.resident.filter((t) => t.persistent).reduce((sum, t) => sum + t.bytes, 0));

const temporal = createTemporalHistoryController({ initialScale: 0.85 });
let history = temporal.update({ timestampMs: 0, renderScale: 0.85, historyAvailable: true, motionConfidence: 1 });
assert.equal(history.valid, false);
for (let i = 1; i < 8; i += 1) history = temporal.update({ timestampMs: i * 16, renderScale: 0.85, historyAvailable: true, motionConfidence: 1 });
assert.equal(history.valid, true);
assert.equal(shouldInvalidateTemporalHistory(history, { renderScale: 0.7, timestampMs: 150 }), true);
temporal.reset('camera-cut');
assert.equal(temporal.valid, false);

const occlusion = createOcclusionHintPlanner();
occlusion.observe('hero', true, 1);
occlusion.observe('hidden', false, 1);
assert.ok(occlusion.classify({ id: 'hero', visible: true }, 2).confidence > 0.5);
assert.equal(occlusion.classify({ id: 'hidden', visible: true }, 2).visible, true);

const orchestrator = createNextGenRenderOrchestrator();
const frame = orchestrator.renderFrame({
  backend: 'webgpu', webgpuAvailable: true, width: 1280, height: 720, frameMs: 17, cpuMs: 4, gpuMs: 9, runtimeTier: 'high', hardwareScore: 0.85,
  renderables: renderables.slice(0, 120), instances: instances.slice(0, 220), textures: textureInputs.slice(0, 50),
  shaderRequests: [{ features: { skinning: true, fog: true }, materialFamily: 'standard' }],
  triangles: 1500000, timestampMs: 100,
});
assert.equal(frame.backend, 'webgpu');
assert.ok(frame.visibility.visible.length <= 2048);
assert.ok(frame.instances.batches.length >= 0);
assert.ok(frame.textures.resident.length > 0);
assert.ok(frame.frameGraph.dependencies.order.length >= 2);
assert.ok(frame.metrics.frame >= 1);
assert.ok(frame.packet);
assert.equal(typeof frame.packetDigest, 'string');
assert.ok(frame.features);
assert.ok(frame.degradation);
assert.ok(frame.temporalHistory);
assert.ok(orchestrator.diagnostics().frame >= 1);
orchestrator.dispose();
assert.equal(orchestrator.disposed, true);

console.log('next-gen render hardening: PASS');
