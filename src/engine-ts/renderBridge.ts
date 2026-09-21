import type { Disposable, FrameContext, Result } from './coreTypes.ts';
import { clamp, err, ok } from './coreTypes.ts';

export type RenderBackend = 'webgpu' | 'webgl2' | 'headless' | 'unavailable';
export type RenderQuality = 'safe' | 'low' | 'medium' | 'high' | 'ultra';
export type RenderEffect = 'taa' | 'fxaa' | 'bloom' | 'ssao' | 'ssgi' | 'dof' | 'lut' | 'vignette' | 'fog';

export interface RendererLike extends Disposable {
  readonly backend: Exclude<RenderBackend, 'unavailable' | 'headless'>;
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly pixelRatio: number;
  render(scene: unknown, camera: unknown): void | Promise<void>;
  setSize(width: number, height: number, pixelRatio?: number): void;
  setPixelRatio(value: number): void;
  setAnimationLoop(callback: ((time: number) => void) | null): void;
}

export interface RenderDeviceCapabilities {
  readonly secureContext: boolean;
  readonly webGpu: boolean;
  readonly webGl2: boolean;
  readonly maxTextureSize: number;
  readonly maxSamples: number;
  readonly mobile: boolean;
  readonly memoryGiB: number;
  readonly hardwareConcurrency: number;
}

export interface RenderPolicy {
  readonly backend: Exclude<RenderBackend, 'unavailable'>;
  readonly quality: RenderQuality;
  readonly pixelRatio: number;
  readonly dynamicResolution: boolean;
  readonly renderScale: number;
  readonly effects: readonly RenderEffect[];
  readonly maxVisibleObjects: number;
  readonly maxShadowCasters: number;
  readonly maxAnimatedObjects: number;
  readonly maxTextureBytes: number;
  readonly temporalHistory: boolean;
  readonly mrt: boolean;
  readonly lodBias: number;
}

const QUALITY_FACTOR: Record<RenderQuality, number> = Object.freeze({ safe: 0.55, low: 0.7, medium: 0.82, high: 1, ultra: 1.14 });
const EFFECTS: Record<RenderQuality, readonly RenderEffect[]> = Object.freeze({
  safe: ['fxaa', 'fog'],
  low: ['fxaa', 'bloom', 'fog'],
  medium: ['taa', 'bloom', 'ssao', 'fog'],
  high: ['taa', 'bloom', 'ssao', 'ssgi', 'lut', 'fog'],
  ultra: ['taa', 'bloom', 'ssao', 'ssgi', 'dof', 'lut', 'vignette', 'fog'],
});

export const detectCapabilities = (input: Partial<RenderDeviceCapabilities> = {}): RenderDeviceCapabilities => {
  const navigatorValue = typeof navigator !== 'undefined' ? navigator : undefined;
  const ua = navigatorValue?.userAgent ?? '';
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  const memoryGiB = Math.max(1, Number((navigatorValue as Navigator & { deviceMemory?: number } | undefined)?.deviceMemory) || (mobile ? 4 : 8));
  const hardwareConcurrency = Math.max(1, Number(navigatorValue?.hardwareConcurrency) || 4);
  const webGpu = input.webGpu ?? (typeof navigator !== 'undefined' && 'gpu' in navigator);
  const webGl2 = input.webGl2 ?? canCreateWebGl2();
  return Object.freeze({
    secureContext: input.secureContext ?? (typeof window === 'undefined' ? true : window.isSecureContext),
    webGpu,
    webGl2,
    maxTextureSize: Math.max(1024, Math.trunc(input.maxTextureSize ?? (mobile ? 4096 : 8192))),
    maxSamples: Math.max(1, Math.trunc(input.maxSamples ?? (mobile ? 4 : 8))),
    mobile: input.mobile ?? mobile,
    memoryGiB: Math.max(1, input.memoryGiB ?? memoryGiB),
    hardwareConcurrency: Math.max(1, Math.trunc(input.hardwareConcurrency ?? hardwareConcurrency)),
  });
};

const canCreateWebGl2 = (): boolean => {
  try {
    if (typeof document === 'undefined') return false;
    const canvas = document.createElement('canvas');
    return !!canvas.getContext('webgl2');
  } catch {
    return false;
  }
};

export const chooseBackend = (capabilities: RenderDeviceCapabilities, preference: 'auto' | 'webgpu' | 'webgl2' = 'auto'): RenderBackend => {
  if (preference === 'webgpu' && capabilities.secureContext && capabilities.webGpu) return 'webgpu';
  if (preference === 'webgl2' && capabilities.webGl2) return 'webgl2';
  if (preference === 'auto' && capabilities.secureContext && capabilities.webGpu) return 'webgpu';
  if (capabilities.webGl2) return 'webgl2';
  return 'headless';
};

export const deriveQuality = (capabilities: RenderDeviceCapabilities, requested: RenderQuality = 'high'): RenderQuality => {
  if (capabilities.mobile && requested === 'ultra') return 'high';
  if (capabilities.memoryGiB <= 2) return 'safe';
  if (capabilities.memoryGiB <= 3 && requested !== 'safe' && requested !== 'low') return 'low';
  if (capabilities.hardwareConcurrency <= 2 && requested === 'ultra') return 'high';
  if (capabilities.maxTextureSize < 4096 && requested === 'ultra') return 'high';
  return requested;
};

export const buildRenderPolicy = (
  capabilities: RenderDeviceCapabilities,
  options: { preference?: 'auto' | 'webgpu' | 'webgl2'; quality?: RenderQuality; gpuBudgetMs?: number; viewportWidth?: number; viewportHeight?: number } = {},
): Result<RenderPolicy, string> => {
  const backend = chooseBackend(capabilities, options.preference ?? 'auto');
  const quality = backend === 'headless' ? 'safe' : deriveQuality(capabilities, options.quality ?? 'high');
  const factor = QUALITY_FACTOR[quality];
  const gpuBudgetMs = clamp(options.gpuBudgetMs ?? (capabilities.mobile ? 14.5 : 12), 7, 30);
  const effects = backend === 'headless' ? [] : EFFECTS[quality].filter(effect => backend === 'webgpu' || effect !== 'ssgi');
  const scaleBase = clamp(Math.sqrt(gpuBudgetMs / (quality === 'ultra' ? 14 : 11)), 0.65, 1);
  const renderScale = backend === 'headless' ? 1 : clamp(scaleBase * (backend === 'webgpu' ? 1 : 0.94), 0.55, 1);
  const width = Math.max(320, options.viewportWidth ?? 1920);
  const height = Math.max(240, options.viewportHeight ?? 1080);
  const pixels = width * height * renderScale * renderScale;
  const visibleBase = capabilities.mobile ? 1900 : 3400;
  const shadowBase = capabilities.mobile ? 260 : 560;
  const animatedBase = capabilities.mobile ? 330 : 720;
  const textureBytesBase = capabilities.memoryGiB <= 3 ? 160 : capabilities.memoryGiB <= 6 ? 384 : 768;
  return ok(Object.freeze({
    backend,
    quality,
    pixelRatio: backend === 'headless' ? 1 : clamp((typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1) * (capabilities.mobile ? 0.9 : 1), 0.75, backend === 'webgpu' ? 2.25 : 2),
    dynamicResolution: backend !== 'headless',
    renderScale,
    effects,
    maxVisibleObjects: Math.max(800, Math.trunc(visibleBase * factor)),
    maxShadowCasters: Math.max(96, Math.trunc(shadowBase * factor)),
    maxAnimatedObjects: Math.max(120, Math.trunc(animatedBase * factor)),
    maxTextureBytes: Math.max(96 * 1024 * 1024, Math.trunc(textureBytesBase * factor * 1024 * 1024)),
    temporalHistory: backend === 'webgpu' && effects.includes('taa'),
    mrt: backend === 'webgpu',
    lodBias: pixels > 2_500_000 ? 0.1 : pixels < 1_000_000 ? -0.15 : 0,
  }));
};

export interface DynamicResolutionControllerOptions { readonly targetFrameMs?: number; readonly minimumScale?: number; readonly maximumScale?: number; readonly downStep?: number; readonly upStep?: number; readonly hysteresisFrames?: number; }

export class DynamicResolutionController {
  private scaleValue: number;
  private slowFrames = 0;
  private fastFrames = 0;
  private readonly targetFrameMs: number;
  private readonly minimumScale: number;
  private readonly maximumScale: number;
  private readonly downStep: number;
  private readonly upStep: number;
  private readonly hysteresisFrames: number;

  constructor(initialScale = 1, options: DynamicResolutionControllerOptions = {}) {
    this.minimumScale = clamp(options.minimumScale ?? 0.55, 0.25, 1);
    this.maximumScale = clamp(options.maximumScale ?? 1, this.minimumScale, 1.5);
    this.scaleValue = clamp(initialScale, this.minimumScale, this.maximumScale);
    this.targetFrameMs = Math.max(4, options.targetFrameMs ?? 16.6);
    this.downStep = clamp(options.downStep ?? 0.035, 0.005, 0.2);
    this.upStep = clamp(options.upStep ?? 0.018, 0.002, 0.1);
    this.hysteresisFrames = Math.max(2, Math.trunc(options.hysteresisFrames ?? 8));
  }
  get scale(): number { return this.scaleValue; }
  update(frameMs: number): number {
    if (!Number.isFinite(frameMs)) return this.scaleValue;
    const over = frameMs > this.targetFrameMs * 1.08;
    const under = frameMs < this.targetFrameMs * 0.88;
    if (over) { this.slowFrames += 1; this.fastFrames = 0; }
    else if (under) { this.fastFrames += 1; this.slowFrames = 0; }
    else { this.slowFrames = Math.max(0, this.slowFrames - 1); this.fastFrames = Math.max(0, this.fastFrames - 1); }
    if (this.slowFrames >= this.hysteresisFrames) { this.scaleValue = clamp(this.scaleValue - this.downStep, this.minimumScale, this.maximumScale); this.slowFrames = 0; }
    else if (this.fastFrames >= this.hysteresisFrames * 2) { this.scaleValue = clamp(this.scaleValue + this.upStep, this.minimumScale, this.maximumScale); this.fastFrames = 0; }
    return this.scaleValue;
  }
  reset(scale = 1): void { this.scaleValue = clamp(scale, this.minimumScale, this.maximumScale); this.slowFrames = 0; this.fastFrames = 0; }
}

export interface RenderFrameStats { readonly cpuMs: number; readonly gpuMs: number; readonly drawCalls: number; readonly triangles: number; readonly visibleObjects: number; readonly shadowObjects: number; readonly resolutionScale: number; }

export class RenderTelemetry implements Disposable {
  private readonly history: RenderFrameStats[] = [];
  private disposed = false;
  constructor(private readonly capacity = 240) {}
  push(stats: RenderFrameStats): void { if (this.disposed) return; this.history.push(Object.freeze({ ...stats })); while (this.history.length > this.capacity) this.history.shift(); }
  snapshot(): readonly RenderFrameStats[] { return [...this.history]; }
  summary(): Readonly<{ avgCpuMs: number; avgGpuMs: number; p95CpuMs: number; p95GpuMs: number; avgDrawCalls: number; avgTriangles: number }> {
    if (this.history.length === 0) return { avgCpuMs: 0, avgGpuMs: 0, p95CpuMs: 0, p95GpuMs: 0, avgDrawCalls: 0, avgTriangles: 0 };
    const average = (field: keyof RenderFrameStats): number => this.history.reduce((sum, row) => sum + Number(row[field]), 0) / this.history.length;
    const percentile = (field: keyof RenderFrameStats, p: number): number => { const values = this.history.map(row => Number(row[field])).sort((a, b) => a - b); return values[Math.min(values.length - 1, Math.floor(values.length * p))] ?? 0; };
    return Object.freeze({ avgCpuMs: average('cpuMs'), avgGpuMs: average('gpuMs'), p95CpuMs: percentile('cpuMs', 0.95), p95GpuMs: percentile('gpuMs', 0.95), avgDrawCalls: average('drawCalls'), avgTriangles: average('triangles') });
  }
  dispose(): void { this.disposed = true; this.history.length = 0; }
}

export interface RendererFactoryOptions { readonly canvas: HTMLCanvasElement | OffscreenCanvas; readonly policy: RenderPolicy; readonly createWebGpu?: (canvas: HTMLCanvasElement | OffscreenCanvas) => Promise<RendererLike>; readonly createWebGl2?: (canvas: HTMLCanvasElement | OffscreenCanvas) => RendererLike; }
export const createRenderer = async (options: RendererFactoryOptions): Promise<Result<RendererLike, string>> => {
  try {
    if (options.policy.backend === 'webgpu' && options.createWebGpu) return ok(await options.createWebGpu(options.canvas));
    if (options.policy.backend === 'webgl2' && options.createWebGl2) return ok(options.createWebGl2(options.canvas));
    return err(options.policy.backend === 'headless' ? 'renderer unavailable in headless mode' : 'Renderer factory is not configured');
  } catch (cause) { return err(cause instanceof Error ? cause.message : 'renderer creation failed'); }
};

export interface FramePresenter extends Disposable { begin(context: FrameContext): void; render(scene: unknown, camera: unknown): Promise<void>; end(): void; }
export class BudgetAwarePresenter implements FramePresenter {
  private lastFrameMs = 0;
  private readonly scaleController: DynamicResolutionController;
  constructor(private readonly renderer: RendererLike, initialScale = 1) { this.scaleController = new DynamicResolutionController(initialScale); }
  begin(_context: FrameContext): void { this.lastFrameMs = typeof performance !== 'undefined' ? performance.now() : Date.now(); }
  async render(scene: unknown, camera: unknown): Promise<void> {
    const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
    await this.renderer.render(scene, camera);
    const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - start;
    const previousScale = this.scaleController.scale;
    const nextScale = this.scaleController.update(elapsed);
    if (Math.abs(nextScale - previousScale) > 0.0001) this.renderer.setPixelRatio(nextScale);
  }
  end(): void { this.lastFrameMs = 0; }
  dispose(): void { this.renderer.dispose(); }
}

export const cssPixelSize = (canvas: HTMLCanvasElement | OffscreenCanvas): { width: number; height: number } => 'clientWidth' in canvas ? { width: Math.max(1, Math.trunc(canvas.clientWidth)), height: Math.max(1, Math.trunc(canvas.clientHeight)) } : { width: Math.max(1, Math.trunc(canvas.width)), height: Math.max(1, Math.trunc(canvas.height)) };
export const resizeRenderer = (renderer: RendererLike, canvas: HTMLCanvasElement | OffscreenCanvas, pixelRatio: number): void => { const size = cssPixelSize(canvas); const clampedRatio = clamp(pixelRatio, 0.5, 2.5); renderer.setPixelRatio(clampedRatio); renderer.setSize(size.width, size.height, clampedRatio); };
