// @ts-nocheck
/**
 * Composition root for the next-generation rendering stack.
 *
 * Connects the existing backend adapter/pipeline policy with dynamic resolution, pressure-driven
 * degradation, feature negotiation, visibility, instancing, texture residency, shader tracking,
 * frame-graph resources, temporal history, device recovery and bounded metrics. It emits both a
 * detailed renderer-neutral frame and a canonical immutable frame packet; actual Three.js scene
 * rendering remains the application renderer's responsibility.
 *
 * @module nextGenRenderOrchestrator
 */

import { buildRenderPipelinePolicy, estimatePipelineCost } from './renderPipelinePolicy.js';
import { createDynamicResolutionGovernor } from './dynamicResolutionGovernor.ts';
import { createRenderVisibilityScheduler, groupRenderCandidates } from './renderVisibilityScheduler.js';
import { createGpuInstanceBatchPlanner, estimateInstanceUploadBytes } from './gpuInstanceBatchPlanner.js';
import { createTextureResidencyPlanner, estimateTexturePressure } from './textureResidencyPlanner.js';
import { createShaderVariantRegistry } from './shaderVariantRegistry.js';
import { createFrameGraphResourcePlanner } from './frameGraphResourcePlanner.js';
import { createRenderDeviceRecovery } from './renderDeviceRecovery.js';
import { createRenderMetricsCollector } from './renderMetricsCollector.js';
import { compileRenderPipelineDescriptor } from './renderPipelineComposer.js';
import { negotiateRenderFeatures, renderFeatureDigest } from './renderFeatureNegotiator.js';
import { evaluateGpuPressure, pressureRecommendations } from './gpuPressureModel.ts';
import { createRenderDegradationPolicy, degradationDigest } from './renderDegradationPolicy.js';
import { createTemporalHistoryController } from './renderTemporalHistoryPolicy.js';
import { createRenderFramePacket, renderFramePacketDigest } from './renderFramePacket.js';

const freeze = Object.freeze;
const finite = (v, f = 0) => Number.isFinite(Number(v)) ? Number(v) : f;

export const NEXT_GEN_RENDER_ORCHESTRATOR_POLICY = freeze({
  id: 'next-gen-render-orchestrator-2026-09-v2',
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
  const degradation = createRenderDegradationPolicy(options.degradation);
  const temporalHistory = createTemporalHistoryController({ initialScale: options.initialRenderScale ?? 0.85, policy: options.temporalHistory?.policy });
  let frame = 0;
  let disposed = false;

  function renderFrame(input = {}) {
    if (disposed) return freeze({ disposed: true, frame, backend: 'webgl2' });
    frame += 1;
    const backend = input.backend === 'webgpu' ? 'webgpu' : 'webgl2';
    const target = Math.max(1, finite(input.targetFrameMs, 16.67));
    const pressure = evaluateGpuPressure({
      frameMs: finite(input.frameMs, target),
      gpuMs: input.gpuMs,
      cpuMs: input.cpuMs,
      memoryUtilization: input.memoryUtilization ?? input.memoryPressure,
      thermalPressure: input.thermalPressure,
      targetFrameMs: target,
    });
    const pressurePacket = degradation.evaluate({
      gpuPressure: pressure.overall,
      thermalPressure: pressure.thermal,
      memoryPressure: pressure.memoryRatio,
      recoveryPressure: recovery.state === 'healthy' ? 0 : 0.6,
      reducedMotion: input.reducedMotion,
    });
    const resolution = governor.update({
      frameMs: finite(input.frameMs, target),
      thermalPressure: Math.max(input.thermalPressure || 0, pressure.overall),
      saveData: input.saveData,
      reducedMotion: input.reducedMotion,
      visibility: input.visibility,
    });
    const boundedScale = Math.max(0.55, Math.min(1, resolution.scale * pressurePacket.renderScaleMultiplier));
    const runtimeTier = input.runtimeTier || (resolution.tier === 'quality' ? 'high' : resolution.tier === 'survival' ? 'minimal' : resolution.tier);
    const pipeline = buildRenderPipelinePolicy({
      backend,
      runtimeTier,
      hardwareScore: input.hardwareScore ?? 0.6,
      reducedMotion: input.reducedMotion,
      batterySaver: input.batterySaver,
      thermalPressure: Math.max(input.thermalPressure || 0, pressure.overall),
      renderScale: boundedScale,
      dprScale: input.dprScale ?? 1,
    });
    const requestedFeatures = input.requestedFeatures || ['taa', 'ssao', 'bloom', 'lut', 'fog', 'instancing', 'textureCompression', 'occlusionHints', 'dynamicResolution', 'temporalHistory'];
    const featureContract = negotiateRenderFeatures(requestedFeatures, {
      backend,
      tier: pipeline.tier,
      webgpuAvailable: input.webgpuAvailable ?? backend === 'webgpu',
      hardwareScore: input.hardwareScore ?? 0.6,
      thermalPressure: Math.max(input.thermalPressure || 0, pressure.overall),
      reducedMotion: input.reducedMotion,
      multiviewAvailable: input.multiviewAvailable,
      textureCompression: input.textureCompression,
    });
    const enabledEffects = new Set(featureContract.enabled);
    const negotiatedPipeline = freeze({
      ...pipeline,
      effects: freeze(pipeline.effects.filter((effect) => enabledEffects.has(effect))),
      temporalHistory: pipeline.temporalHistory && enabledEffects.has('temporalHistory'),
      mrt: pipeline.mrt && enabledEffects.has('mrt'),
      dynamicResolution: pipeline.dynamicResolution && enabledEffects.has('dynamicResolution'),
      renderScale: boundedScale,
      degradation: pressurePacket,
    });
    const descriptor = compileRenderPipelineDescriptor(negotiatedPipeline, { maxBudgetMs: (input.postProcessBudgetMs ?? 8) * pressurePacket.effectBudgetMultiplier });
    const candidates = visibility.schedule(input.renderables || [], frame);
    const instancePlan = instances.plan(input.instances || [], { tier: negotiatedPipeline.tier, thermalPressure: Math.max(input.thermalPressure || 0, pressure.overall) });
    const texturePlan = textures.plan(input.textures || [], { tier: negotiatedPipeline.tier, budgetMb: (input.textureBudgetMb ?? 768) * pressurePacket.textureBudgetMultiplier });
    for (const request of (input.shaderRequests || []).slice(0, policy.maxShaderRequests)) shaders.request(request.features || {}, { backend, quality: negotiatedPipeline.tier, materialFamily: request.materialFamily, frame });
    const graph = buildFrameGraph({ width: Math.max(1, Math.floor(finite(input.width, 1280) * boundedScale)), height: Math.max(1, Math.floor(finite(input.height, 720) * boundedScale)) }, negotiatedPipeline);
    const cost = estimatePipelineCost(negotiatedPipeline, { drawCalls: candidates.visible.length, triangles: finite(input.triangles), foliageInstances: instancePlan.visibleCount });
    const recoveryState = recovery.tick(finite(input.timestampMs, frame * 16.67));
    const history = temporalHistory.update({
      timestampMs: finite(input.timestampMs, frame * 16.67),
      renderScale: boundedScale,
      historyAvailable: negotiatedPipeline.temporalHistory,
      cameraCut: input.cameraCut === true,
      backendRecovered: input.backendRecovered === true,
      resized: input.resized === true,
      sceneReset: input.sceneReset === true,
      motionConfidence: input.motionConfidence,
    });
    const record = metrics.recordFrame({
      timestampMs: finite(input.timestampMs, frame * 16.67),
      frameMs: finite(input.frameMs, target), cpuMs: input.cpuMs, gpuMs: input.gpuMs || cost.gpuMs,
      drawCalls: candidates.visible.length, triangles: input.triangles, instances: instancePlan.visibleCount,
      renderScale: boundedScale, backend, tier: negotiatedPipeline.tier, recoveryState: recoveryState.state,
    });
    const detailed = freeze({
      frame,
      backend,
      pressure,
      pressureRecommendations: pressureRecommendations(pressure),
      degradation: pressurePacket,
      resolution,
      pipeline: negotiatedPipeline,
      descriptor,
      features: featureContract,
      featureDigest: renderFeatureDigest(featureContract),
      visibility: freeze({ ...candidates, groups: groupRenderCandidates(candidates.visible) }),
      instances: freeze({ ...instancePlan, upload: estimateInstanceUploadBytes(instancePlan) }),
      textures: freeze({ ...texturePlan, pressure: estimateTexturePressure(texturePlan) }),
      shader: shaders.snapshot(),
      frameGraph: graph,
      temporalHistory: history,
      cost,
      recovery: recoveryState,
      metrics: record,
    });
    const packet = createRenderFramePacket(detailed);
    return freeze({ ...detailed, packet, packetDigest: renderFramePacketDigest(packet), degradationDigest: degradationDigest(pressurePacket) });
  }

  function diagnostics() {
    return freeze({
      frame,
      disposed,
      resolution: governor.snapshot(),
      degradation: degradation.snapshot(),
      temporalHistory: temporalHistory.snapshot(),
      recovery: recovery.snapshot(),
      metrics: metrics.snapshot(),
      shader: shaders.snapshot(),
      visibility: visibility.snapshot(),
    });
  }

  function dispose() {
    disposed = true;
    governor.reset();
    visibility.reset();
    recovery.dispose();
    metrics.dispose();
    temporalHistory.reset('scene-reset');
  }

  return freeze({ renderFrame, diagnostics, dispose, governor, visibility, instances, textures, shaders, recovery, metrics, degradation, temporalHistory, get frame() { return frame; }, get disposed() { return disposed; } });
}
