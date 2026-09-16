import type { Backend, DeviceCapabilities, FramePlan, QualityTier, RenderFeatures, RenderObject, RenderResolution } from './platform.js';

export interface RendererCanvasLike {
  width: number;
  height: number;
  clientWidth?: number;
  clientHeight?: number;
}

export interface RendererHandle {
  readonly backend: Backend;
  readonly quality: QualityTier;
  readonly canvas: RendererCanvasLike;
  readonly capabilities: DeviceCapabilities;
  resize(width: number, height: number, pixelRatio: number): void;
  render(frame: FramePlan): void | Promise<void>;
  dispose(): void;
}

export interface RendererFactoryOptions {
  readonly canvas: RendererCanvasLike;
  readonly preferWebGPU: boolean;
  readonly powerPreference?: 'high-performance' | 'low-power';
  readonly antialias: boolean;
  readonly alpha: boolean;
  readonly preserveDrawingBuffer: boolean;
}

export interface RendererBackendProbe {
  readonly webgpuAvailable: boolean;
  readonly webgl2Available: boolean;
  readonly secureContext: boolean;
  readonly reason?: string;
}

export interface RenderFeatureDecision {
  readonly backend: Backend;
  readonly tier: QualityTier;
  readonly features: RenderFeatures;
  readonly rejected: readonly string[];
}

export interface FrameInput {
  readonly frameId: number;
  readonly resolution: RenderResolution;
  readonly objects: readonly RenderObject[];
  readonly camera: { readonly x: number; readonly y: number; readonly z: number; readonly near: number; readonly far: number };
  readonly timeSeconds: number;
}

export interface RenderBridgeMetrics {
  readonly frameId: number;
  readonly backend: Backend;
  readonly cpuFrameMs: number;
  readonly gpuFrameMs: number;
  readonly visible: number;
  readonly submitted: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly textureBytes: number;
}

export interface RenderBridge {
  readonly probe: RendererBackendProbe;
  readonly handle: RendererHandle;
  readonly decision: RenderFeatureDecision;
  prepare(input: FrameInput): FramePlan;
  render(frame: FramePlan): Promise<RenderBridgeMetrics>;
  recover(reason: string): Promise<boolean>;
}

type NavigatorWithGpu = Navigator & { readonly gpu?: unknown };

export function probeRendererBackends(env: { readonly isSecureContext?: boolean; readonly navigator?: NavigatorWithGpu } = {}): RendererBackendProbe {
  const secureContext = env.isSecureContext ?? (typeof globalThis.isSecureContext === 'boolean' ? globalThis.isSecureContext : false);
  const navigatorLike = env.navigator ?? (typeof navigator !== 'undefined' ? navigator as NavigatorWithGpu : undefined);
  const webgpuAvailable = secureContext && Boolean(navigatorLike?.gpu);
  let webgl2Available = false;
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    webgl2Available = Boolean(canvas.getContext('webgl2'));
  }
  return { webgpuAvailable, webgl2Available, secureContext, reason: webgpuAvailable ? undefined : 'WebGPU unavailable; retain WebGL2 fallback' };
}

export function chooseBackend(probe: RendererBackendProbe, preferWebGPU = true): Backend {
  if (preferWebGPU && probe.webgpuAvailable) return 'webgpu';
  if (probe.webgl2Available) return 'webgl2';
  return 'webgl2';
}

export function deriveRenderFeatures(backend: Backend, tier: QualityTier): RenderFeatureDecision {
  const webgpu = backend === 'webgpu';
  const highTier = tier === 'ultra' || tier === 'high';
  const mediumTier = tier === 'medium';
  const features: RenderFeatures = {
    backend,
    hdr: highTier,
    mrt: webgpu && highTier,
    temporalHistory: highTier,
    compute: webgpu,
    ssao: highTier || mediumTier,
    ssgi: webgpu && tier === 'ultra',
    bloom: highTier || mediumTier,
    depthOfField: tier === 'ultra',
    volumetricFog: webgpu && highTier,
    antiAliasing: highTier ? 'taa' : 'fxaa',
    toneMapping: highTier ? 'agx' : 'neutral',
  };
  const rejected: string[] = [];
  if (!webgpu) rejected.push('compute', 'mrt');
  if (!webgpu || tier !== 'ultra') rejected.push('ssgi');
  if (!webgpu || !highTier) rejected.push('volumetricFog');
  return { backend, tier, features, rejected: [...new Set(rejected)] };
}

export function buildFramePlan(input: FrameInput, decision: RenderFeatureDecision): FramePlan {
  const objects = [...input.objects].filter((object) => object.visible).sort((a, b) => a.distance - b.distance || String(a.nodeId).localeCompare(String(b.nodeId)));
  const visibleBudget = decision.tier === 'ultra' ? 5000 : decision.tier === 'high' ? 3500 : decision.tier === 'medium' ? 2400 : 1500;
  const shadowBudget = decision.tier === 'ultra' ? 800 : decision.tier === 'high' ? 600 : decision.tier === 'medium' ? 400 : 200;
  const animationBudget = decision.tier === 'ultra' ? 700 : decision.tier === 'high' ? 520 : decision.tier === 'medium' ? 360 : 200;
  const visible = objects.slice(0, visibleBudget);
  const shadows = visible.filter((object) => object.castsShadow).slice(0, shadowBudget);
  const animated = visible.filter((object) => object.animated).slice(0, animationBudget);
  const passes: FramePlan['passes'] = ['depth','shadow','opaque'];
  if (visible.some((object) => object.transparent)) passes.push('transparent');
  if (visible.some((object) => object.materialClass === 'water')) passes.push('water');
  if (visible.some((object) => object.materialClass === 'foliage')) passes.push('foliage');
  if (decision.features.ssao || decision.features.ssgi || decision.features.bloom || decision.features.volumetricFog) passes.push('effects');
  passes.push('post','ui');
  const gpu = passes.length * 0.15 + visible.length * 0.002 + shadows.length * 0.004 + animated.length * 0.0015;
  return {
    frameId: input.frameId,
    resolution: input.resolution,
    passes,
    visibleObjectIds: visible.map((object) => object.nodeId),
    shadowObjectIds: shadows.map((object) => object.nodeId),
    animatedObjectIds: animated.map((object) => object.nodeId),
    estimatedGpuMs: Number(gpu.toFixed(4)),
    cpuUploadMs: Number((animated.length * 0.001 + visible.length * 0.0004).toFixed(4)),
  };
}

export class AdaptiveRenderScale {
  #scale = 1;
  #stableFrames = 0;
  readonly #min: number;
  readonly #max: number;

  constructor(min = 0.5, max = 1) {
    this.#min = Math.max(0.25, Math.min(1, min));
    this.#max = Math.max(this.#min, Math.min(1, max));
  }

  update(frameMs: number, budgetMs: number): number {
    if (!Number.isFinite(frameMs) || !Number.isFinite(budgetMs) || budgetMs <= 0) return this.#scale;
    const ratio = frameMs / budgetMs;
    if (ratio > 1.1) { this.#scale = Math.max(this.#min, this.#scale - 0.05); this.#stableFrames = 0; }
    else if (ratio < 0.82) { this.#stableFrames += 1; if (this.#stableFrames >= 20) { this.#scale = Math.min(this.#max, this.#scale + 0.025); this.#stableFrames = 0; } }
    else this.#stableFrames = 0;
    return this.#scale;
  }

  get scale(): number { return this.#scale; }
}

export function estimateTriangleLoad(objectCount: number, averageTriangles = 1200): number {
  if (!Number.isFinite(objectCount) || objectCount < 0 || !Number.isFinite(averageTriangles) || averageTriangles < 0) return 0;
  return Math.floor(objectCount * averageTriangles);
}
