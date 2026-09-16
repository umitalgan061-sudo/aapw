/**
 * Adaptive runtime coordinator for the next-generation render policy.
 * It owns timing/quality decisions only; scene, gameplay and asset state stay elsewhere.
 */
import { buildRenderPipelinePolicy } from './renderPipelinePolicy.js';
import { chooseRendererBackend, resizeRendererAdapter, setRendererOutputPolicy } from './nextGenRendererAdapter.js';
import { buildGpuPassBudgetPlan } from './gpuPassBudget.js';

const TIERS = Object.freeze(['low', 'medium', 'high', 'ultra']);
const FEATURE_KEYS = Object.freeze(['taa', 'fxaa', 'bloom', 'ssao', 'ssgi', 'dof', 'lut', 'vignette', 'fog', 'mrt', 'temporalHistory']);
const DEFAULTS = Object.freeze({ targetFrameMs: 16.67, sampleWindow: 30, pressureSamples: 4, healthySamples: 12, minScale: 0.55, maxScale: 1, initialTier: 3 });

function n(v, fallback = 0) { const x = Number(v); return Number.isFinite(x) ? x : fallback; }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, n(v, lo))); }
function int(v, fallback = 0) { return Math.round(n(v, fallback)); }
function bool(v) { return v === true; }
function tierName(rank) { return TIERS[clamp(int(rank), 0, TIERS.length - 1)]; }
function cloneFeatures(source = {}) { const target = Object.create(null); for (const key of FEATURE_KEYS) target[key] = bool(source[key]); return target; }

function createRing(size) { return { values: new Float64Array(size), cursor: 0, count: 0, sum: 0 }; }
function pushRing(ring, value) {
  const sample = Math.max(0, n(value));
  if (ring.count < ring.values.length) { ring.values[ring.cursor] = sample; ring.sum += sample; ring.count += 1; }
  else { ring.sum -= ring.values[ring.cursor]; ring.values[ring.cursor] = sample; ring.sum += sample; }
  ring.cursor = (ring.cursor + 1) % ring.values.length;
  return ring.count ? ring.sum / ring.count : sample;
}

function normalizeOptions(options = {}) {
  const config = { ...DEFAULTS, ...options };
  config.sampleWindow = clamp(int(config.sampleWindow, DEFAULTS.sampleWindow), 8, 240);
  config.targetFrameMs = clamp(config.targetFrameMs, 8, 50);
  config.pressureSamples = clamp(int(config.pressureSamples, DEFAULTS.pressureSamples), 1, 30);
  config.healthySamples = clamp(int(config.healthySamples, DEFAULTS.healthySamples), 1, 60);
  config.minScale = clamp(config.minScale, 0.35, 1);
  config.maxScale = clamp(config.maxScale, config.minScale, 1.25);
  config.initialTier = clamp(int(config.initialTier, DEFAULTS.initialTier), 0, 3);
  return Object.freeze(config);
}

function normalizeInput(input = {}) {
  const viewport = input.viewport ?? {};
  const device = input.device ?? {};
  const scene = input.scene ?? {};
  return {
    requestedBackend: input.requestedBackend ?? 'webgpu',
    webgpuAvailable: bool(input.webgpuAvailable),
    mobile: bool(device.mobile),
    coarsePointer: bool(device.coarsePointer),
    width: Math.max(1, int(viewport.width, 1)),
    height: Math.max(1, int(viewport.height, 1)),
    dpr: clamp(device.devicePixelRatio, 0.5, 4),
    visibleObjects: Math.max(0, int(scene.visibleObjects)),
    shadowCasters: Math.max(0, int(scene.shadowCasters)),
    animatedObjects: Math.max(0, int(scene.animatedObjects)),
    textureBytes: Math.max(0, n(scene.textureBytes)),
    pressure: clamp(input.gpuMemoryPressure, 0, 1),
  };
}

function featureMask(policy, tierRank, pressure) {
  const next = cloneFeatures(policy.features);
  if (pressure === 'severe' || pressure === 'pressure') { next.ssgi = false; next.dof = false; }
  if (pressure === 'severe' && tierRank < 3) { next.bloom = false; next.temporalHistory = false; }
  return next;
}
function policySignature(state) {
  return [state.backend, state.tier, state.scale.toFixed(3), FEATURE_KEYS.map((key) => state.features[key] ? '1' : '0').join('')].join('|');
}

export function createRenderRuntimeCoordinator(options = {}) {
  const config = normalizeOptions(options);
  const ring = createRing(config.sampleWindow);
  const state = {
    backend: chooseRendererBackend({ requestedBackend: options.requestedBackend ?? 'webgpu', webgpuAvailable: bool(options.webgpuAvailable) }),
    tier: config.initialTier,
    scale: 1,
    targetScale: 1,
    averageFrameMs: 0,
    lastFrameMs: 0,
    pressure: 'neutral',
    pressureStreak: 0,
    healthyStreak: 0,
    revision: 0,
    signature: '',
    features: cloneFeatures(),
    policy: null,
    budget: null,
    frames: 0,
    degraded: 0,
    recovered: 0,
    listeners: new Set(),
    adapter: null,
  };

  function emit(reason) {
    state.revision += 1;
    const snapshot = getSnapshot();
    for (const listener of state.listeners) { try { listener(snapshot, reason); } catch {} }
  }

  function rebuild(input) {
    const policy = buildRenderPipelinePolicy({ backend: state.backend, runtimeTier: tierName(state.tier), mobile: input.mobile, coarsePointer: input.coarsePointer, dynamicResolution: true, renderScale: state.scale });
    state.features = featureMask(policy, state.tier, state.pressure);
    state.policy = Object.freeze({ ...policy, features: cloneFeatures(state.features) });
    const currentGpuMs = Math.max(0.1, state.averageFrameMs * 0.72);
    const budget = buildGpuPassBudgetPlan({ targetFrameMs: config.targetFrameMs, estimatedGpuMs: currentGpuMs, qualityScale: state.scale, pressure: input.pressure, activePasses: ['base', 'shadow', 'water', 'foliage', 'effects', 'post'] });
    state.budget = budget;
    const ratio = clamp(config.targetFrameMs / Math.max(config.targetFrameMs, state.averageFrameMs || config.targetFrameMs), 0.65, 1.15);
    state.targetScale = clamp(state.scale * Math.sqrt(ratio), config.minScale, config.maxScale);
  }

  function pressureClass(avg) {
    if (avg > config.targetFrameMs * 2) return 'severe';
    if (avg > config.targetFrameMs * 1.2) return 'pressure';
    if (avg < config.targetFrameMs * 0.85) return 'healthy';
    return 'neutral';
  }

  function smoothScale() {
    const delta = clamp(state.targetScale - state.scale, -0.08, 0.08);
    state.scale = clamp(state.scale + delta, config.minScale, config.maxScale);
  }

  function transition(input) {
    let changed = false;
    if ((state.pressure === 'severe' || state.pressureStreak >= config.pressureSamples) && state.tier > 0) {
      state.tier -= 1; state.degraded += 1; state.pressureStreak = 0; changed = true;
    } else if (state.pressure === 'healthy' && state.healthyStreak >= config.healthySamples && state.tier < 3) {
      state.tier += 1; state.recovered += 1; state.healthyStreak = 0; changed = true;
    }
    if (changed) { rebuild(input); emit('quality-transition'); }
  }

  function recordFrame(frameMs, input = {}) {
    const runtime = normalizeInput({ ...options, ...input });
    state.lastFrameMs = Math.max(0, n(frameMs));
    state.averageFrameMs = pushRing(ring, state.lastFrameMs);
    state.frames += 1;
    state.pressure = pressureClass(state.averageFrameMs);
    if (state.pressure === 'pressure' || state.pressure === 'severe') { state.pressureStreak += 1; state.healthyStreak = 0; }
    else if (state.pressure === 'healthy') { state.healthyStreak += 1; state.pressureStreak = 0; }
    else { state.pressureStreak = 0; state.healthyStreak = 0; }
    rebuild(runtime);
    smoothScale();
    if (state.adapter) resizeRendererAdapter(state.adapter, { width: runtime.width, height: runtime.height, pixelRatio: runtime.dpr * state.scale });
    transition(runtime);
    const nextSignature = policySignature(state);
    if (nextSignature !== state.signature) { state.signature = nextSignature; emit('policy-change'); }
    return getSnapshot();
  }

  function attachRenderer(adapter) {
    state.adapter = adapter ?? null;
    if (!state.adapter) return false;
    state.backend = state.adapter.backend;
    setRendererOutputPolicy(state.adapter, { colorSpace: 'srgb', exposure: 1 });
    rebuild(normalizeInput({ ...options, viewport: { width: state.adapter.renderer?.domElement?.width, height: state.adapter.renderer?.domElement?.height }, device: { devicePixelRatio: 1 } }));
    emit('renderer-attached');
    return true;
  }

  function setViewport(width, height, dpr = 1) {
    if (state.adapter) resizeRendererAdapter(state.adapter, { width, height, pixelRatio: clamp(dpr, 0.5, 4) * state.scale });
    return getSnapshot();
  }

  function setSceneMetrics(metrics = {}) { rebuild(normalizeInput({ ...options, scene: metrics })); return getSnapshot(); }
  function onChange(listener) { if (typeof listener !== 'function') return () => {}; state.listeners.add(listener); return () => state.listeners.delete(listener); }
  function getSnapshot() { return Object.freeze({ revision: state.revision, backend: state.backend, tier: state.tier, tierLabel: tierName(state.tier), scale: Number(state.scale.toFixed(4)), targetScale: Number(state.targetScale.toFixed(4)), averageFrameMs: Number(state.averageFrameMs.toFixed(3)), lastFrameMs: Number(state.lastFrameMs.toFixed(3)), pressure: state.pressure, features: Object.freeze(cloneFeatures(state.features)), policy: state.policy, gpuBudget: state.budget, frames: state.frames, degraded: state.degraded, recovered: state.recovered }); }
  function dispose() { state.listeners.clear(); state.adapter = null; state.policy = null; state.budget = null; }

  const initial = normalizeInput(options);
  state.scale = clamp(initial.mobile || initial.coarsePointer ? 0.8 : 1, config.minScale, config.maxScale);
  rebuild(initial);
  state.signature = policySignature(state);

  return Object.freeze({ attachRenderer, recordFrame, setViewport, setSceneMetrics, onChange, getSnapshot, dispose });
}

export function runtimeFrameBudgetScore(frameMs, targetFrameMs = DEFAULTS.targetFrameMs) { return clamp(targetFrameMs / Math.max(0.1, n(frameMs, targetFrameMs)), 0, 2); }
export function classifyRuntimePressure(frameMs, targetFrameMs = DEFAULTS.targetFrameMs) { const ratio = n(frameMs, 0) / Math.max(1, n(targetFrameMs, DEFAULTS.targetFrameMs)); return ratio > 2 ? 'severe' : ratio > 1.2 ? 'pressure' : ratio < 0.85 ? 'healthy' : 'neutral'; }
export const RENDER_RUNTIME_DEFAULTS = DEFAULTS;
