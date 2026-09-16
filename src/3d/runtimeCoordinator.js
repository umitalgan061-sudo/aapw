/**
 * Single runtime coordinator for adaptive quality, streaming and cooperative background work.
 *
 * The coordinator is intentionally small at the integration edge: game3d.js can instantiate one
 * object, feed it frame observations and receive a declarative frame plan. Subsystem ownership is
 * unchanged; this module only coordinates budgets and diagnostics.
 * @module runtimeCoordinator
 */

import { resolveRenderBackend } from './renderBackendCapability.js';
import { createAdaptiveQualityController } from './adaptiveQualityController.js';
import { createRuntimeTelemetry } from './runtimeTelemetry.js';
import { createStreamingGovernor } from './worldStreamingGovernor.js';
import { createRuntimeWorkScheduler } from './runtimeWorkScheduler.js';

function n(value, fallback = 0) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }

export function createRuntimeCoordinator({ capabilities, qualityOptions = {}, streamingOptions = {}, workOptions = {}, telemetryOptions = {} } = {}) {
  const backend = resolveRenderBackend({ capabilities });
  const quality = createAdaptiveQualityController({ governorOptions: qualityOptions });
  const streaming = createStreamingGovernor(streamingOptions);
  const work = createRuntimeWorkScheduler(workOptions);
  const telemetry = createRuntimeTelemetry(telemetryOptions);
  let frame = 0;
  let disposed = false;
  let lastQuality = quality.profile();
  let lastStreamPlan = null;
  let lastWorkPlan = null;

  function beginFrame({ frameMs = 16.67, cpuMs = 0, gpuMs = 0, assetMs = 0, streamingMs = 0 } = {}) {
    if (disposed) throw new Error('RUNTIME_COORDINATOR_DISPOSED');
    frame += 1;
    const pressure = quality.sample(frameMs, { frame, cpuMs, gpuMs, assetMs, streamingMs });
    if (pressure.to) lastQuality = pressure.to;
    const budgetLedger = quality.createFrameBudget(gpuMs + cpuMs);
    return Object.freeze({ frame, backend, quality: lastQuality, pressure, budgetLedger });
  }

  function recordFrame({ frameMs, simulationMs = 0, streamingMs = 0, renderCalls = 0, triangles = 0, residentChunks = 0, faunaActive = 0, assetQueue = 0, memoryMb = 0 } = {}) {
    if (disposed) throw new Error('RUNTIME_COORDINATOR_DISPOSED');
    telemetry.capture({ frameMs, simulationMs, streamingMs, renderCalls, triangles, residentChunks, faunaActive, assetQueue, memoryMb });
  }

  return {
    backend,
    quality,
    streaming,
    work,
    telemetry,
    beginFrame,
    recordFrame,
    scheduleStreaming(input = {}) { lastStreamPlan = streaming.plan(input); return lastStreamPlan; },
    scheduleWork(budgetMs) { lastWorkPlan = work.plan(budgetMs); return lastWorkPlan; },
    diagnostics() {
      if (disposed) throw new Error('RUNTIME_COORDINATOR_DISPOSED');
      return Object.freeze({
        frame,
        backend,
        quality: quality.profile(),
        qualityGovernor: quality.governorSnapshot(),
        streaming: streaming.snapshot(),
        work: work.snapshot(),
        telemetry: telemetry.snapshot(),
        lastStreamPlan,
        lastWorkPlan,
      });
    },
    reset() {
      if (disposed) throw new Error('RUNTIME_COORDINATOR_DISPOSED');
      frame = 0;
      quality.reset();
      streaming.reset();
      work.reset();
      telemetry.reset();
      lastQuality = quality.profile();
      lastStreamPlan = null;
      lastWorkPlan = null;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      quality.dispose();
      streaming.dispose();
      work.dispose();
      telemetry.dispose();
    },
  };
}

export function buildDefaultRuntimeCoordinator(options = {}) {
  return createRuntimeCoordinator({
    capabilities: options.capabilities,
    qualityOptions: { targetFps: n(options.targetFps, 60), warmupFrames: n(options.warmupFrames, 20) },
    streamingOptions: { maxStartsPerFrame: n(options.maxStartsPerFrame, 2), maxEstimatedMsPerFrame: n(options.streamingBudgetMs, 3.5) },
    workOptions: { maxItems: n(options.maxWorkItems, 24), maxEstimatedMs: n(options.backgroundBudgetMs, 3) },
    telemetryOptions: { capacity: n(options.telemetryCapacity, 180) },
  });
}
