/**
 * Composition root for the next-generation rendering stack.
 *
 * Connects the existing backend adapter/pipeline policy with dynamic resolution, visibility,
 * instancing, texture residency, shader variant tracking, frame-graph resources, device recovery and
 * bounded metrics. It emits a renderer-neutral frame packet; actual Three.js scene rendering remains
 * the application renderer's responsibility.
 *
 * @module nextGenRenderOrchestrator
 */

import { buildRenderPipelinePolicy, estimatePipelineCost } from './renderPipelinePolicy.js';
import { createDynamicResolutionGovernor } from './dynamicResolutionGovernor.js';
import { createRenderVisibilityScheduler, groupRenderCandidates } from './renderVisibilityScheduler.js';
import { createGpuInstanceBatchPlanner, estimateInstanceUploadBytes } from './gpuInstanceBatchPlanner.js';
import { createTextureResidencyPlanner, estimateTexturePressure } from './textureResidencyPlanner.js';
import { createShaderVariantRegistry } from './shaderVariantRegistry.js';
import { createFrameGraphResourcePlanner } from './frameGraphResourcePlanner.js';
import { createRenderDeviceRecovery } from './renderDeviceRecovery.js';
import { createRenderMetricsCollector } from './renderMetricsCollector.js';
import { compileRenderPipelineDescriptor } from './renderPipelineComposer.js';

const freeze = Object.freeze;
const finite = (v, f = 0) => Number.isFinite(Number(v)) ? Number(v) : f;
const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, finite(v, min)));

export const NEXT_GEN_RENDER_ORCHESTRATOR_POLICY = freeze({
  id: 'next-gen-render-orchestrator-2026-09-v1',
  maxVisibleCandidates: 2048,
  maxInstanceCandidates: 8192,
  maxTextureCandidates: 4096,
  maxShaderRequests: 512,
  maxFrameGraphPasses: 64,
});

function buildFrameGraph(scene = {}, policy = {}) {
  const graph = createFrameGraphResourcePlanner({ policy: { maxPasses: 64, maxResources: 96 } });
  graph.addResource({ id: 'scene-color', width: scene.width, height: scene.height, format: policy.outputBuffer === 'half-float' ? 'rgba16float' : 'rgba8unorm', usage: 'color', transient: true });
  graph.addResource({ id: 'scene-depth', width: scene.width, height: scene.height, format: 'depth24plus', usage: 'depth', transient: true });
  graph.addResource({ id: 'scene-velocity', width: scene.width, height: scene.height, format: 'rgba16float', usage: 'velocity', transient: true });
  graph.addResource({ id: 'history-color', width: scene.width, height: scene.height, format: 'rgba16float', usage: 'history', transient: false });
  graph.addPass({ id: 'geometry', order: 0, writes: ['scene-color', 'scene-depth', 'scene-velocity'] });
  if (policy.temporalHistory) graph.addPass({ id: 'temporal', order: 1, reads: ['scene-color', 'scene-depth', 'scene-velocity', 'history-color'], writes: ['history-color', 'scene-color'] });
  graph.addPass({ id: 'post', order: 2, reads: ['scene-color', 'scene-depth'], writes: ['scene-color'] });
  return graph.snapshot();
}

export function createNextGenRenderOrchestrator(options = {}) {
  const policy = freeze({ ...NEXT_GEN_RENDER_ORCHESTRATOR_POLICY, ...(options.policy || {}) });
  const governor = createDynamicResolutionGovernor({ initialScale: options.initialRenderScale ?? 0.85 });
  const visibility = createRenderVisibilityScheduler({ policy: { maxVisible: policy.maxVisibleCandidates } });
  const instances = createGpuInstanceBatchPlanner({ policy: { maxInput: policy.maxInstanceCandidates } });
  const textures = createTextureResidencyPlanner({ policy: { maxTextures: policy.maxTextureCandidates } });
  const shaders = createShaderVariantRegistry({ policy: { maxRequests: policy.maxShaderRequests } });
  const recovery = createRenderDeviceRecovery(options.recovery);
  const metrics = createRenderMetricsCollector(options.metrics);
  let frame = 0;
  let disposed = false;

  function renderFrame(input = {}) {
    if (disposed) return freeze({ disposed: true, frame, backend: 'webgl2' });
    frame += 1;
    const backend = input.backend === 'webgpu' ? 'webgpu' : 'webgl2';
    const target = Math.max(1, finite(input.targetFrameMs, 16.67));
    const resolution = governor.update({ frameMs: finite(input.frameMs, target), thermalPressure: input.thermalPressure, saveData: input.saveData, reducedMotion: input.reducedMotion, visibility: input.visibility });
    const runtimeTier = input.runtimeTier || (resolution.tier === 'quality' ? 'high' : resolution.tier === 'survival' ? 'minimal' : resolution.tier);
    const pipeline = buildRenderPipelinePolicy({ backend, runtimeTier, hardwareScore: input.hardwareScore ?? 0.6, reducedMotion: input.reducedMotion, batterySaver: input.batterySaver, thermalPressure: input.thermalPressure, renderScale: resolution.scale, dprScale: input.dprScale ?? 1 });
    const descriptor = compileRenderPipelineDescriptor(pipeline, { maxBudgetMs: input.postProcessBudgetMs ?? 8 });
    const candidates = visibility.schedule(input.renderables || [], frame);
    const instancePlan = instances.plan(input.instances || [], { tier: pipeline.tier, thermalPressure: input.thermalPressure });
    const texturePlan = textures.plan(input.textures || [], { tier: pipeline.tier, budgetMb: input.textureBudgetMb ?? 768 });
    for (const request of (input.shaderRequests || []).slice(0, policy.maxShaderRequests)) shaders.request(request.features || {}, { backend, quality: pipeline.tier, materialFamily: request.materialFamily, frame });
    const graph = buildFrameGraph({ width: Math.max(1, Math.floor(finite(input.width, 1280) * resolution.scale)), height: Math.max(1, Math.floor(finite(input.height, 720) * resolution.scale)) }, pipeline);
    const cost = estimatePipelineCost(pipeline, { drawCalls: candidates.visible.length, triangles: finite(input.triangles), foliageInstances: instancePlan.visibleCount });
    const recoveryState = recovery.tick(finite(input.timestampMs, frame * 16.67));
    const record = metrics.recordFrame({
      timestampMs: finite(input.timestampMs, frame * 16.67),
      frameMs: finite(input.frameMs, target), cpuMs: input.cpuMs, gpuMs: input.gpuMs || cost.gpuMs,
      drawCalls: candidates.visible.length, triangles: input.triangles, instances: instancePlan.visibleCount,
      renderScale: resolution.scale, backend, tier: pipeline.tier, recoveryState: recoveryState.state,
    });
    return freeze({
      frame,
      backend,
      resolution,
      pipeline,
      descriptor,
      visibility: freeze({ ...candidates, groups: groupRenderCandidates(candidates.visible) }),
      instances: freeze({ ...instancePlan, upload: estimateInstanceUploadBytes(instancePlan) }),
      textures: freeze({ ...texturePlan, pressure: estimateTexturePressure(texturePlan) }),
      shader: shaders.snapshot(),
      frameGraph: graph,
      cost,
      recovery: recoveryState,
      metrics: record,
    });
  }

  function diagnostics() {
    return freeze({ frame, disposed, resolution: governor.snapshot(), recovery: recovery.snapshot(), metrics: metrics.snapshot(), shader: shaders.snapshot(), visibility: visibility.snapshot() });
  }

  function dispose() {
    disposed = true;
    governor.reset();
    visibility.reset();
    recovery.dispose();
    metrics.dispose();
  }

  return freeze({ renderFrame, diagnostics, dispose, governor, visibility, instances, textures, shaders, recovery, metrics, get frame() { return frame; }, get disposed() { return disposed; } });
}
