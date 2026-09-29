import { BACKENDS, createNextGenRenderer, disposeRendererAdapter, resizeRendererAdapter } from "../../rendering/nextGenRendererAdapter.ts";
import type { DeviceCapabilitiesV15, RendererBackendV15 } from "./types.ts";

interface RendererLike {
  setPixelRatio?: (value: number) => void;
  setSize?: (width: number, height: number, updateStyle?: boolean) => void;
  render?: (scene: unknown, camera: unknown) => void;
  dispose?: () => void;
  toneMapping?: unknown;
  toneMappingExposure?: number;
}

interface AdapterV15 {
  readonly backend: RendererBackendV15;
  readonly renderer: RendererLike;
  readonly three: Record<string, unknown>;
  readonly initialized: boolean;
  readonly fallback: boolean;
}

export interface RenderBackendOptionsV15 {
  readonly requested?: RendererBackendV15;
  readonly pixelRatio?: number;
  readonly antialias?: boolean;
  readonly alpha?: boolean;
}

export interface RenderBackendStateV15 {
  readonly backend: RendererBackendV15;
  readonly requested: RendererBackendV15;
  readonly initialized: boolean;
  readonly fallback: boolean;
  readonly pixelRatio: number;
  readonly width: number;
  readonly height: number;
}

export class RenderBackendControllerV15 {
  #adapter: AdapterV15 | undefined;
  #state: RenderBackendStateV15 = Object.freeze({
    backend: "webgl2",
    requested: "webgl2",
    initialized: false,
    fallback: false,
    pixelRatio: 1,
    width: 1,
    height: 1,
  });

  async initialize(
    canvas: HTMLCanvasElement,
    capabilities: DeviceCapabilitiesV15,
    options: RenderBackendOptionsV15 = {},
  ): Promise<RenderBackendStateV15> {
    const requested = options.requested ?? capabilities.backend;
    const pixelRatio = Math.min(capabilities.devicePixelRatio, Math.max(0.5, options.pixelRatio ?? (capabilities.mobile ? 1 : 2)));
    const width = Math.max(1, Math.round(canvas.clientWidth || window.innerWidth || 1));
    const height = Math.max(1, Math.round(canvas.clientHeight || window.innerHeight || 1));
    const adapter = await createNextGenRenderer({
      canvas,
      width,
      height,
      pixelRatio,
      requestedBackend: requested === "webgpu" ? BACKENDS.WEBGPU : BACKENDS.WEBGL2,
      webgpuAvailable: capabilities.webgpuAvailable,
      antialias: options.antialias ?? !capabilities.mobile,
      alpha: options.alpha ?? false,
    }) as unknown as AdapterV15;
    this.#adapter = adapter;
    this.#state = Object.freeze({
      backend: adapter.backend,
      requested,
      initialized: adapter.initialized,
      fallback: adapter.fallback,
      pixelRatio,
      width,
      height,
    });
    return this.#state;
  }

  get state(): RenderBackendStateV15 { return this.#state; }
  get adapter(): AdapterV15 | undefined { return this.#adapter; }

  resize(width: number, height: number, pixelRatio?: number): boolean {
    if (!this.#adapter) return false;
    const nextRatio = Math.max(0.5, pixelRatio ?? this.#state.pixelRatio);
    const result = resizeRendererAdapter(this.#adapter, { width, height, pixelRatio: nextRatio });
    if (!result) return false;
    this.#state = Object.freeze({
      ...this.#state,
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
      pixelRatio: nextRatio,
    });
    return true;
  }

  applyQuality(pixelRatioCap: number, renderScale: number, exposure = 1): void {
    const renderer = this.#adapter?.renderer;
    if (!renderer) return;
    const ratio = Math.max(0.5, Math.min(this.#state.pixelRatio, pixelRatioCap)) * Math.max(0.5, Math.min(1, renderScale));
    renderer.setPixelRatio?.(ratio);
    if ("toneMappingExposure" in renderer) renderer.toneMappingExposure = Math.max(0.25, Math.min(4, exposure));
  }

  render(scene: unknown, camera: unknown): boolean {
    if (!this.#adapter?.renderer.render) return false;
    this.#adapter.renderer.render(scene, camera);
    return true;
  }

  dispose(): void {
    if (this.#adapter) disposeRendererAdapter(this.#adapter);
    this.#adapter = undefined;
    this.#state = Object.freeze({ ...this.#state, initialized: false });
  }
}
