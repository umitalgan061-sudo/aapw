/**
 * Scene-safe bridge between the existing AAPW game loop and next-generation render policies.
 *
 * The bridge is deliberately additive. It accepts the scene state object returned by sceneManager,
 * keeps the game loop in charge of simulation, and exposes tiny hooks that can be called from the
 * existing tick/resize/dispose paths. No renderer replacement is attempted synchronously.
 */
import { createRenderRuntimeCoordinator } from './renderRuntimeCoordinator.js';
import { buildMaterialBatchKey, deriveMaterialRecipe } from './materialRuntimeOptimizer.js';
import { estimateStreamingPriority } from './streamingBudgetController.js';

function n(value, fallback = 0) { const x = Number(value); return Number.isFinite(x) ? x : fallback; }
function bool(value) { return value === true; }

function rendererCanvas(renderer) { return renderer?.domElement ?? renderer?.getContext?.()?.canvas ?? null; }

function rendererMetrics(renderer) {
  const info = renderer?.info;
  return {
    drawCalls: Math.max(0, n(info?.render?.calls)),
    triangles: Math.max(0, n(info?.render?.triangles)),
    geometries: Math.max(0, n(info?.memory?.geometries)),
    textures: Math.max(0, n(info?.memory?.textures)),
  };
}

function memoryPressureFromRenderer(renderer) {
  const info = renderer?.info;
  const textures = Math.max(0, n(info?.memory?.textures));
  const geometries = Math.max(0, n(info?.memory?.geometries));
  return Math.min(1, textures / 1500 + geometries / 5000);
}

function sceneObjectCounts(scene) {
  let visibleObjects = 0;
  let shadowCasters = 0;
  let animatedObjects = 0;
  scene?.traverse?.((object) => {
    if (object.visible !== false) visibleObjects += 1;
    if (object.castShadow === true) shadowCasters += 1;
    if (object.userData?.isAnimated === true || object.userData?.animationMixer) animatedObjects += 1;
  });
  return { visibleObjects, shadowCasters, animatedObjects };
}

function frameTimer() {
  let previous = typeof performance !== 'undefined' ? performance.now() : 0;
  return () => {
    const current = typeof performance !== 'undefined' ? performance.now() : previous + 16.67;
    const delta = Math.max(0, current - previous);
    previous = current;
    return delta;
  };
}

export function createNextGenRuntimeBridge(state, options = {}) {
  if (!state?.renderer || !state?.scene || !state?.camera) throw new TypeError('scene state must contain renderer, scene and camera');
  const coordinator = createRenderRuntimeCoordinator({
    requestedBackend: options.requestedBackend ?? 'webgpu',
    webgpuAvailable: options.webgpuAvailable ?? Boolean(globalThis.navigator?.gpu),
    initialTier: options.initialTier ?? 3,
    targetFrameMs: options.targetFrameMs ?? 16.67,
  });
  const adapter = options.adapter ?? { backend: 'webgl2', renderer: state.renderer, fallback: false };
  coordinator.attachRenderer(adapter);
  const nextFrameDuration = frameTimer();
  let disposed = false;
  let lastSnapshot = coordinator.getSnapshot();
  let sampleAccumulator = 0;
  let sampleCount = 0;

  function collectMetrics() {
    const canvas = rendererCanvas(state.renderer);
    const viewport = {
      width: canvas?.clientWidth ?? canvas?.width ?? globalThis.innerWidth ?? 1,
      height: canvas?.clientHeight ?? canvas?.height ?? globalThis.innerHeight ?? 1,
    };
    const counts = sceneObjectCounts(state.scene);
    const rendererState = rendererMetrics(state.renderer);
    return {
      viewport,
      device: {
        mobile: bool(options.mobile),
        coarsePointer: bool(options.coarsePointer),
        devicePixelRatio: globalThis.devicePixelRatio ?? 1,
      },
      scene: {
        ...counts,
        drawCalls: rendererState.drawCalls,
        triangles: rendererState.triangles,
        textureBytes: n(options.textureBytes),
      },
      gpuMemoryPressure: clampMemoryPressure(options.gpuMemoryPressure ?? memoryPressureFromRenderer(state.renderer)),
    };
  }

  function recordFrame() {
    if (disposed) return lastSnapshot;
    const frameMs = nextFrameDuration();
    const snapshot = coordinator.recordFrame(frameMs, collectMetrics());
    sampleAccumulator += frameMs;
    sampleCount += 1;
    if (sampleCount >= 8) {
      lastSnapshot = snapshot;
      sampleAccumulator = 0;
      sampleCount = 0;
    }
    return snapshot;
  }

  function recordExternalFrame(frameMs, metrics = {}) {
    if (disposed) return lastSnapshot;
    lastSnapshot = coordinator.recordFrame(frameMs, { ...collectMetrics(), ...metrics });
    return lastSnapshot;
  }

  function onResize(width, height, dpr = globalThis.devicePixelRatio ?? 1) {
    if (disposed) return lastSnapshot;
    return coordinator.setViewport(width, height, dpr);
  }

  function sceneMetrics() { return collectMetrics(); }
  function snapshot() { return coordinator.getSnapshot(); }
  function dispose() { disposed = true; coordinator.dispose(); }

  return Object.freeze({ coordinator, recordFrame, recordExternalFrame, onResize, sceneMetrics, snapshot, dispose });
}

function clampMemoryPressure(value) { return Math.min(1, Math.max(0, n(value))); }

export function describeRuntimeAsset(item = {}, context = {}) {
  const category = String(item.category ?? 'prop');
  const priority = estimateStreamingPriority(item, context);
  const recipe = deriveMaterialRecipe({
    quality: context.quality ?? 'balanced',
    backend: context.backend ?? 'webgl2',
    distanceMeters: item.distanceMeters,
    screenCoverage: item.screenCoverage,
    importance: item.importance,
    memoryPressure: context.memoryPressure,
    transparent: item.transparent,
    animated: item.animated,
  });
  return Object.freeze({
    id: String(item.id ?? item.assetUrl ?? 'unknown'),
    category,
    priority,
    materialBatchKey: buildMaterialBatchKey(item.material ?? {}, recipe),
    materialRecipe: recipe,
  });
}

export function collectRenderDiagnostics(bridge) {
  const snapshot = bridge?.snapshot?.() ?? {};
  return Object.freeze({
    backend: snapshot.backend ?? 'webgl2',
    qualityTier: snapshot.tierLabel ?? 'unknown',
    resolutionScale: snapshot.scale ?? 1,
    frameAverageMs: snapshot.averageFrameMs ?? 0,
    pressure: snapshot.pressure ?? 'neutral',
    enabledEffects: Object.entries(snapshot.features ?? {}).filter(([, enabled]) => enabled).map(([key]) => key),
    gpuBudget: snapshot.gpuBudget ?? null,
  });
}
