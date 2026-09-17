import { checksumP, finiteP, integerP, nowP, type CameraFrameP, type RenderCapabilitiesP, type RenderPlanP } from './contracts.ts';

export interface RendererLikeP {
  readonly domElement?: HTMLElement;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  setPixelRatio(ratio: number): void;
  render?(scene: unknown, camera: unknown): void;
  dispose?(): void;
}

export interface SceneBridgeConfigP {
  readonly antialias: boolean;
  readonly alpha: boolean;
  readonly powerPreference: 'default' | 'high-performance' | 'low-power';
  readonly maxDpr: number;
  readonly resizeDebounceMs: number;
}

export interface SceneBridgeFrameP {
  readonly frame: number;
  readonly frameMs: number;
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly renderPlan: RenderPlanP;
  readonly camera: CameraFrameP;
  readonly digest: number;
}

export interface SceneBridgeStatsP {
  readonly frames: number;
  readonly lastFrameMs: number;
  readonly averageFrameMs: number;
  readonly resizeCount: number;
  readonly capabilityProbeCount: number;
  readonly disposed: boolean;
  readonly checksum: number;
}

const DEFAULTS: SceneBridgeConfigP = Object.freeze({ antialias: true, alpha: false, powerPreference: 'high-performance', maxDpr: 2.5, resizeDebounceMs: 50 });

export class ProductionSceneBridge {
  readonly canvas: HTMLCanvasElement;
  readonly config: SceneBridgeConfigP;
  #renderer: RendererLikeP | undefined;
  #capabilities: RenderCapabilitiesP | undefined;
  #frame = 0;
  #lastFrameMs = 0;
  #frameSamples: number[] = [];
  #resizeCount = 0;
  #capabilityProbeCount = 0;
  #disposed = false;
  #resizeObserver?: ResizeObserver;
  #resizeTimer?: ReturnType<typeof setTimeout>;

  constructor(canvas: HTMLCanvasElement, config: Partial<SceneBridgeConfigP> = {}) {
    this.canvas = canvas;
    this.config = Object.freeze({ ...DEFAULTS, ...config, maxDpr: Math.max(1, finiteP(config.maxDpr ?? DEFAULTS.maxDpr)), resizeDebounceMs: Math.max(0, integerP(config.resizeDebounceMs ?? DEFAULTS.resizeDebounceMs)) });
  }

  attachRenderer(renderer: RendererLikeP): void { this.#ensureLive(); this.#renderer = renderer; this.applyViewport(); this.installResizeObserver(); }
  get renderer(): RendererLikeP | undefined { return this.#renderer; }

  probeCapabilities(): RenderCapabilitiesP {
    this.#ensureLive();
    const gl = this.canvas.getContext('webgl2') ?? this.canvas.getContext('webgl');
    const webgl2 = Boolean(this.canvas.getContext('webgl2'));
    const maxTextureSize = gl ? Number(gl.getParameter(gl.MAX_TEXTURE_SIZE) ?? 4096) : 2048;
    const instancing = webgl2 || Boolean(gl && gl.getExtension('ANGLE_instanced_arrays'));
    const memory = typeof navigator !== 'undefined' && 'deviceMemory' in navigator ? Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4) : 4;
    const cores = typeof navigator !== 'undefined' ? Number(navigator.hardwareConcurrency ?? 4) : 4;
    this.#capabilityProbeCount += 1;
    this.#capabilities = Object.freeze({ webgl2, instancing, maxTextureSize: Number.isFinite(maxTextureSize) ? Math.max(256, maxTextureSize) : 2048, deviceMemoryGb: Number.isFinite(memory) ? Math.max(0.25, memory) : 4, hardwareConcurrency: Number.isFinite(cores) ? Math.max(1, cores) : 4 });
    return this.#capabilities;
  }

  capabilities(): RenderCapabilitiesP { return this.#capabilities ?? this.probeCapabilities(); }

  applyViewport(): void {
    this.#ensureLive();
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || this.canvas.clientWidth || 1));
    const height = Math.max(1, Math.round(rect.height || this.canvas.clientHeight || 1));
    const dpr = Math.min(this.config.maxDpr, Math.max(1, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1));
    this.#renderer?.setPixelRatio(dpr);
    this.#renderer?.setSize(width, height, false);
    this.#resizeCount += 1;
  }

  scheduleResize(): void {
    if (this.#resizeTimer) clearTimeout(this.#resizeTimer);
    this.#resizeTimer = setTimeout(() => { this.#resizeTimer = undefined; if (!this.#disposed) this.applyViewport(); }, this.config.resizeDebounceMs);
  }

  installResizeObserver(): void {
    if (typeof ResizeObserver === 'undefined' || this.#resizeObserver) return;
    this.#resizeObserver = new ResizeObserver(() => this.scheduleResize());
    this.#resizeObserver.observe(this.canvas);
  }

  frame(camera: CameraFrameP, plan: RenderPlanP, render?: () => void): SceneBridgeFrameP {
    this.#ensureLive();
    const started = nowP();
    this.#frame += 1;
    render?.();
    const frameMs = Math.max(0, nowP() - started);
    if (this.#frameSamples.length >= 120) this.#frameSamples.shift();
    this.#frameSamples.push(frameMs);
    this.#lastFrameMs = frameMs;
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || 1)); const height = Math.max(1, Math.round(rect.height || 1)); const dpr = Math.min(this.config.maxDpr, Math.max(1, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1));
    return Object.freeze({ frame: this.#frame, frameMs, width, height, dpr, renderPlan: plan, camera, digest: checksumP({ frame: this.#frame, frameMs: Math.round(frameMs * 100) / 100, width, height, dpr, tier: plan.tier }) });
  }

  render(scene: unknown, camera: unknown, plan: RenderPlanP): SceneBridgeFrameP {
    if (!this.#renderer?.render) throw new Error('renderer is not attached');
    const cameraFrame = normalizeCamera(camera, this.canvas, plan.visibleDistance);
    return this.frame(cameraFrame, plan, () => this.#renderer?.render?.(scene, camera));
  }

  stats(): SceneBridgeStatsP {
    const averageFrameMs = this.#frameSamples.length ? this.#frameSamples.reduce((sum, value) => sum + value, 0) / this.#frameSamples.length : 0;
    return Object.freeze({ frames: this.#frame, lastFrameMs: this.#lastFrameMs, averageFrameMs, resizeCount: this.#resizeCount, capabilityProbeCount: this.#capabilityProbeCount, disposed: this.#disposed, checksum: checksumP({ frame: this.#frame, samples: this.#frameSamples, resize: this.#resizeCount }) });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#resizeTimer) clearTimeout(this.#resizeTimer);
    this.#resizeTimer = undefined;
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = undefined;
    this.#renderer?.dispose?.();
    this.#renderer = undefined;
    this.#frameSamples.length = 0;
  }

  #ensureLive(): void { if (this.#disposed) throw new Error('scene bridge disposed'); }
}

function normalizeCamera(value: unknown, canvas: HTMLCanvasElement, farScale: number): CameraFrameP {
  const candidate = value as Partial<CameraFrameP> | null;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(candidate?.width ?? rect.width || 1)); const height = Math.max(1, Math.round(candidate?.height ?? rect.height || 1));
  const position = candidate?.position ?? { x: 0, y: 80, z: 120 }; const target = candidate?.target ?? { x: 0, y: 0, z: 0 };
  return Object.freeze({ position: { ...position }, target: { ...target }, fov: finiteP(candidate?.fov ?? 60, 60), near: Math.max(0.01, finiteP(candidate?.near ?? 0.1, 0.1)), far: Math.max(100, finiteP(candidate?.far ?? 30_000 * Math.max(0.1, farScale), 30_000)), width, height, dpr: Math.min(2.5, Math.max(1, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)) });
}
