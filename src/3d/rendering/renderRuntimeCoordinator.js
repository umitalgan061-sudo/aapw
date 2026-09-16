/**
 * Runtime coordinator for the next-generation rendering stack.
 *
 * This module is intentionally renderer-agnostic: it consumes the declarative policy layer,
 * observes frame timing, applies conservative resolution/feature shedding, and exposes a stable
 * runtime snapshot for HUD/debug/telemetry consumers. It does not own scene/gameplay state.
 *
 * Design goals:
 * - no per-frame allocations in the hot path;
 * - deterministic feature decisions for identical observations;
 * - hysteresis around quality transitions to prevent oscillation;
 * - graceful operation with an existing WebGL2 renderer;
 * - optional future WebGPU pipeline attachment without changing game-loop ownership.
 *
 * @module renderRuntimeCoordinator
 */

import {
  buildRenderPipelinePolicy,
  deriveRenderTier,
  estimatePipelineCost,
  recommendDynamicResolution,
  shedOptionalPasses,
} from './renderPipelinePolicy.js';
import { chooseRendererBackend, resizeRendererAdapter, setRendererOutputPolicy } from './nextGenRendererAdapter.js';
import { planGpuPassBudget } from './gpuPassBudget.js';

const DEFAULTS = Object.freeze({
  targetFrameMs: 16.67,
  minimumFrameMs: 12,
  maximumFrameMs: 33.34,
  sampleWindow: 30,
  stableSamples: 10,
  degradeStep: 1,
  recoverStep: 1,
  resolutionMin: 0.55,
  resolutionMax: 1,
  hysteresisMs: 1.5,
  maxConsecutivePressure: 4,
  maxConsecutiveHealthy: 12,
  initialTier: 3,
});

const FEATURE_KEYS = Object.freeze([
  'taa',
  'fxaa',
  'bloom',
  'ssao',
  'ssgi',
  'dof',
  'lut',
  'vignette',
  'fog',
  'mrt',
  'temporalHistory',
]);

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, finite(value, minimum)));
}

function boolean(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function integer(value, fallback = 0) {
  return Math.round(finite(value, fallback));
}

function cloneFeatures(source = {}) {
  const target = Object.create(null);
  for (const key of FEATURE_KEYS) target[key] = boolean(source[key]);
  return target;
}

function createRing(size) {
  const ring = new Float64Array(size);
  return Object.seal({ values: ring, cursor: 0, count: 0, sum: 0 });
}

function pushRing(ring, value) {
  const numeric = Math.max(0, finite(value));
  if (ring.count < ring.values.length) {
    ring.values[ring.cursor] = numeric;
    ring.sum += numeric;
    ring.count += 1;
  } else {
    ring.sum -= ring.values[ring.cursor];
    ring.values[ring.cursor] = numeric;
    ring.sum += numeric;
  }
  ring.cursor = (ring.cursor + 1) % ring.values.length;
  return ring.count ? ring.sum / ring.count : 0;
}

function emptyCounters() {
  return {
    frames: 0,
    pressure: 0,
    healthy: 0,
    degraded: 0,
    recovered: 0,
    shed: 0,
    restored: 0,
    backendFallbacks: 0,
  };
}

function normalizeConfig(input = {}) {
  const config = { ...DEFAULTS, ...input };
  config.targetFrameMs = clamp(config.targetFrameMs, 8, 50);
  config.minimumFrameMs = clamp(config.minimumFrameMs, 6, config.targetFrameMs);
  config.maximumFrameMs = clamp(config.maximumFrameMs, config.targetFrameMs, 100);
  config.sampleWindow = clamp(integer(config.sampleWindow, DEFAULTS.sampleWindow), 8, 240);
  config.stableSamples = clamp(integer(config.stableSamples, DEFAULTS.stableSamples), 2, 120);
  config.resolutionMin = clamp(config.resolutionMin, 0.35, 1);
  config.resolutionMax = clamp(config.resolutionMax, config.resolutionMin, 1.5);
  config.hysteresisMs = clamp(config.hysteresisMs, 0.25, 5);
  config.maxConsecutivePressure = clamp(integer(config.maxConsecutivePressure, DEFAULTS.maxConsecutivePressure), 1, 30);
  config.maxConsecutiveHealthy = clamp(integer(config.maxConsecutiveHealthy, DEFAULTS.maxConsecutiveHealthy), 1, 60);
  return Object.freeze(config);
}

function pressureKind(averageMs, config) {
  if (averageMs > config.maximumFrameMs) return 'severe';
  if (averageMs > config.targetFrameMs + config.hysteresisMs) return 'pressure';
  if (averageMs < config.targetFrameMs - config.hysteresisMs) return 'healthy';
  return 'neutral';
}

function tierLabel(tier) {
  return ['low', 'medium', 'high', 'ultra'][clamp(integer(tier, 0), 0, 3)];
}

function normalizeRuntimeInput(input = {}) {
  const viewport = input.viewport ?? {};
  const device = input.device ?? {};
  const scene = input.scene ?? {};
  return {
    requestedBackend: input.requestedBackend ?? 'webgpu',
    webgpuAvailable: boolean(input.webgpuAvailable),
    qualityTier: clamp(integer(input.qualityTier, DEFAULTS.initialTier), 0, 3),
    coarsePointer: boolean(device.coarsePointer),
    mobile: boolean(device.mobile),
    width: Math.max(1, integer(viewport.width, 1)),
    height: Math.max(1, integer(viewport.height, 1)),
    devicePixelRatio: clamp(device.devicePixelRatio, 0.5, 4),
    visibleObjects: Math.max(0, integer(scene.visibleObjects)),
    shadowCasters: Math.max(0, integer(scene.shadowCasters)),
    animatedObjects: Math.max(0, integer(scene.animatedObjects)),
    textureBytes: Math.max(0, finite(scene.textureBytes)),
    gpuMemoryPressure: clamp(input.gpuMemoryPressure, 0, 1),
  };
}

function chooseInitialResolution(input, config) {
  const base = input.mobile || input.coarsePointer ? 0.8 : 1;
  const dprPenalty = Math.min(0.2, Math.max(0, input.devicePixelRatio - 1) * 0.1);
  return clamp(base - dprPenalty, config.resolutionMin, config.resolutionMax);
}

function chooseBackend(input) {
  return chooseRendererBackend({
    requestedBackend: input.requestedBackend,
    webgpuAvailable: input.webgpuAvailable,
  });
}

function applyFeatureMask(rendererPolicy, tier, pressure) {
  const baseline = cloneFeatures(rendererPolicy.features);
  if (pressure === 'severe') {
    baseline.ssgi = false;
    baseline.dof = false;
    baseline.bloom = tier < 3 ? false : baseline.bloom;
    baseline.temporalHistory = tier > 1 && baseline.temporalHistory;
  } else if (pressure === 'pressure') {
    baseline.ssgi = false;
    baseline.dof = false;
  }
  return baseline;
}

function signatureFromState(state) {
  return [
    state.backend,
    state.tier,
    state.resolution.toFixed(3),
    state.features.ssgi ? 1 : 0,
    state.features.dof ? 1 : 0,
    state.features.bloom ? 1 : 0,
    state.features.temporalHistory ? 1 : 0,
  ].join('|');
}

export function createRenderRuntimeCoordinator(options = {}) {
  const config = normalizeConfig(options);
  const ring = createRing(config.sampleWindow);
  const state = {
    backend: 'webgl2',
    tier: clamp(integer(options.initialTier, config.initialTier), 0, 3),
    resolution: 1,
    targetResolution: 1,
    features: cloneFeatures(),
    frameAverageMs: 0,
    lastFrameMs: 0,
    pressureKind: 'neutral',
    pressureStreak: 0,
    healthyStreak: 0,
    revision: 0,
    lastSignature: '',
    policy: null,
    counters: emptyCounters(),
  };

  let adapter = null;
  let sceneMetrics = Object.create(null);
  const listeners = new Set();
  const inputCache = { width: 1, height: 1, pixelRatio: 1 };

  function emit(reason) {
    state.revision += 1;
    const snapshot = getSnapshot();
    for (const listener of listeners) {
      try {
        listener(snapshot, reason);
      } catch {
        // Observers are non-critical and must never break the render loop.
      }
    }
  }

  function rebuildPolicy(input) {
    const quality = tierLabel(state.tier);
    const policy = buildRenderPipelinePolicy({
      backend: state.backend,
      tier: quality,
      mobile: input.mobile,
      coarsePointer: input.coarsePointer,
      dynamicResolution: true,
      viewport: {
        width: input.width,
        height: input.height,
      },
    });
    const pressure = state.pressureKind;
    const features = applyFeatureMask(policy, state.tier, pressure);
    state.features = shedOptionalPasses(features, { pressure, backend: state.backend });
    state.policy = Object.freeze({ ...policy, features: cloneFeatures(state.features) });
    state.targetResolution = recommendDynamicResolution({
      currentScale: state.resolution,
      averageFrameMs: state.frameAverageMs,
      targetFrameMs: config.targetFrameMs,
      minimumScale: config.resolutionMin,
      maximumScale: config.resolutionMax,
    });
  }

  function updatePressure() {
    const kind = pressureKind(state.frameAverageMs, config);
    state.pressureKind = kind;
    if (kind === 'pressure' || kind === 'severe') {
      state.pressureStreak += 1;
      state.healthyStreak = 0;
    } else if (kind === 'healthy') {
      state.healthyStreak += 1;
      state.pressureStreak = 0;
    } else {
      state.pressureStreak = 0;
      state.healthyStreak = 0;
    }
  }

  function transitionQuality(input) {
    let changed = false;
    const severe = state.pressureKind === 'severe';
    if ((severe || state.pressureStreak >= config.maxConsecutivePressure) && state.tier > 0) {
      state.tier -= config.degradeStep;
      state.counters.degraded += 1;
      state.counters.shed += 1;
      changed = true;
    } else if (state.healthyStreak >= config.maxConsecutiveHealthy && state.tier < 3) {
      state.tier += config.recoverStep;
      state.counters.recovered += 1;
      state.counters.restored += 1;
      changed = true;
    }
    if (changed) {
      state.tier = clamp(state.tier, 0, 3);
      rebuildPolicy(input);
      emit('quality-transition');
    }
  }

  function applyRuntimeResolution(input) {
    const recommendation = clamp(state.targetResolution, config.resolutionMin, config.resolutionMax);
    const maxStep = 0.08;
    const delta = recommendation - state.resolution;
    state.resolution = clamp(state.resolution + clamp(delta, -maxStep, maxStep), config.resolutionMin, config.resolutionMax);
    if (adapter?.renderer) {
      const effectivePixelRatio = input.devicePixelRatio * state.resolution;
      resizeRendererAdapter(adapter, {
        width: input.width,
        height: input.height,
        pixelRatio: effectivePixelRatio,
      });
    }
  }

  function attachRenderer(nextAdapter) {
    adapter = nextAdapter ?? null;
    if (!adapter) return false;
    state.backend = adapter.backend;
    if (adapter.fallback) state.counters.backendFallbacks += 1;
    setRendererOutputPolicy(adapter, { colorSpace: 'srgb', exposure: 1 });
    rebuildPolicy(normalizeRuntimeInput({ ...options, ...inputCache }));
    emit('renderer-attached');
    return true;
  }

  function recordFrame(frameMs, input = {}) {
    const runtimeInput = normalizeRuntimeInput(input);
    const average = pushRing(ring, frameMs);
    state.lastFrameMs = Math.max(0, finite(frameMs));
    state.frameAverageMs = average;
    state.counters.frames += 1;
    sceneMetrics = runtimeInput;
    updatePressure();
    rebuildPolicy(runtimeInput);
    applyRuntimeResolution(runtimeInput);
    transitionQuality(runtimeInput);
    const nextSignature = signatureFromState(state);
    if (nextSignature !== state.lastSignature) {
      state.lastSignature = nextSignature;
      emit('policy-change');
    }
    return getSnapshot();
  }

  function setViewport(width, height, pixelRatio = 1) {
    inputCache.width = Math.max(1, integer(width, 1));
    inputCache.height = Math.max(1, integer(height, 1));
    inputCache.pixelRatio = clamp(pixelRatio, 0.5, 4);
    if (adapter) resizeRendererAdapter(adapter, {
      width: inputCache.width,
      height: inputCache.height,
      pixelRatio: inputCache.pixelRatio * state.resolution,
    });
    return getSnapshot();
  }

  function setSceneMetrics(metrics = {}) {
    sceneMetrics = normalizeRuntimeInput({ scene: metrics, device: metrics.device, viewport: metrics.viewport });
    rebuildPolicy(sceneMetrics);
    return getSnapshot();
  }

  function onChange(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function getGpuBudget() {
    const policy = state.policy ?? {};
    return planGpuPassBudget({
      tier: tierLabel(state.tier),
      backend: state.backend,
      frameBudgetMs: config.targetFrameMs,
      averageFrameMs: state.frameAverageMs,
      effects: policy.features,
    });
  }

  function getSnapshot() {
    return Object.freeze({
      revision: state.revision,
      backend: state.backend,
      tier: state.tier,
      tierLabel: tierLabel(state.tier),
      resolution: Number(state.resolution.toFixed(4)),
      targetResolution: Number(state.targetResolution.toFixed(4)),
      features: Object.freeze(cloneFeatures(state.features)),
      frameAverageMs: Number(state.frameAverageMs.toFixed(3)),
      lastFrameMs: Number(state.lastFrameMs.toFixed(3)),
      pressure: state.pressureKind,
      counters: Object.freeze({ ...state.counters }),
      scene: Object.freeze({ ...sceneMetrics }),
      gpuBudget: Object.freeze({ ...getGpuBudget() }),
      policy: state.policy,
    });
  }

  function dispose() {
    listeners.clear();
    adapter = null;
    sceneMetrics = Object.create(null);
  }

  const initialInput = normalizeRuntimeInput(options);
  state.backend = chooseBackend(initialInput);
  state.resolution = chooseInitialResolution(initialInput, config);
  rebuildPolicy(initialInput);
  state.lastSignature = signatureFromState(state);

  return Object.freeze({
    attachRenderer,
    recordFrame,
    setViewport,
    setSceneMetrics,
    onChange,
    getSnapshot,
    getGpuBudget,
    dispose,
  });
}

export const RENDER_RUNTIME_DEFAULTS = DEFAULTS;
export const RENDER_RUNTIME_FEATURE_KEYS = FEATURE_KEYS;

export function runtimeFrameBudgetScore({ frameMs = 0, targetFrameMs = DEFAULTS.targetFrameMs } = {}) {
  const actual = Math.max(0.01, finite(frameMs));
  const target = Math.max(1, finite(targetFrameMs, DEFAULTS.targetFrameMs));
  return clamp(target / actual, 0, 2);
}

export function classifyRuntimePressure({ averageFrameMs = 0, targetFrameMs = DEFAULTS.targetFrameMs } = {}) {
  const average = Math.max(0, finite(averageFrameMs));
  const target = Math.max(1, finite(targetFrameMs, DEFAULTS.targetFrameMs));
  if (average > target * 2) return 'severe';
  if (average > target * 1.2) return 'pressure';
  if (average < target * 0.85) return 'healthy';
  return 'neutral';
}

export function summarizeRenderRuntime(snapshot = {}) {
  const features = snapshot.features ?? {};
  const enabledFeatures = FEATURE_KEYS.filter((feature) => features[feature]).length;
  return Object.freeze({
    backend: snapshot.backend ?? 'webgl2',
    tier: snapshot.tierLabel ?? 'low',
    resolutionScale: finite(snapshot.resolution, 1),
    frameAverageMs: finite(snapshot.frameAverageMs),
    pressure: snapshot.pressure ?? 'neutral',
    enabledFeatures,
    gpuFrameBudgetMs: finite(snapshot.gpuBudget?.targetFrameMs),
  });
}
