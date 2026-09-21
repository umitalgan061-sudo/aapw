import type {
  CameraState,
  PlatformError,
  QualityTier,
  RenderBackend,
  Result,
  Vec3,
} from './types';
import { checksum, clamp01, quantize } from './deterministic';
import { Diagnostics } from './diagnostics';
import { RecoveryController } from './recoveryController';
import { RenderFrameBuilder, type DrawItem, type RenderFramePacket } from './renderPacket';
import { type FrameGraphPlan } from './frameGraph';

export interface RenderDeviceDescriptor {
  readonly backend: RenderBackend;
  readonly canvas?: HTMLCanvasElement;
  readonly label?: string;
}

export interface RenderFrameInput {
  readonly frame: number;
  readonly camera: CameraState;
  readonly quality: QualityTier;
  readonly renderScale: number;
  readonly pressure: number;
  readonly backend: RenderBackend;
  readonly draws: readonly DrawItem[];
}

export interface RenderPassExecutionContext {
  readonly packet: RenderFramePacket;
  readonly graph: FrameGraphPlan | null;
}

export interface RenderAdapterHooks {
  readonly create?: (descriptor: RenderDeviceDescriptor) => Promise<unknown> | unknown;
  readonly destroy?: (device: unknown) => void | Promise<void>;
  readonly applyQuality?: (quality: QualityTier, renderScale: number) => void | Promise<void>;
  readonly draw?: (context: RenderPassExecutionContext) => void | Promise<void>;
  readonly onFallback?: (from: RenderBackend, to: RenderBackend) => void | Promise<void>;
}

export interface RenderBridgeState {
  readonly backend: RenderBackend;
  readonly requestedBackend: RenderBackend;
  readonly quality: QualityTier;
  readonly renderScale: number;
  readonly ready: boolean;
  readonly deviceLosses: number;
  readonly recoveryStage: string;
}

export interface RenderBridgeMetrics {
  readonly frames: number;
  readonly drawItems: number;
  readonly lastFrameMs: number;
  readonly averageFrameMs: number;
  readonly droppedFrames: number;
  readonly qualityChanges: number;
  readonly fallbackCount: number;
  readonly checksum: string;
}

/**
 * Backend-neutral render adapter. It converts immutable packets into an application-owned renderer
 * call while keeping device lifetime, fallback and recovery logic outside gameplay modules.
 */
export class RenderBridge {
  readonly diagnostics: Diagnostics;
  readonly recovery: RecoveryController;
  readonly hooks: RenderAdapterHooks;

  #requestedBackend: RenderBackend;
  #backend: RenderBackend;
  #quality: QualityTier;
  #renderScale = 1;
  #device: unknown = null;
  #ready = false;
  #deviceLosses = 0;
  #graph: FrameGraphPlan | null = null;
  #frames = 0;
  #drawItems = 0;
  #lastFrameMs = 0;
  #totalFrameMs = 0;
  #droppedFrames = 0;
  #qualityChanges = 0;
  #fallbackCount = 0;

  constructor(options: {
    readonly backend?: RenderBackend;
    readonly quality?: QualityTier;
    readonly renderScale?: number;
    readonly hooks?: RenderAdapterHooks;
    readonly diagnostics?: Diagnostics;
    readonly recovery?: RecoveryController;
  } = {}) {
    this.#requestedBackend = options.backend ?? 'webgpu';
    this.#backend = this.#requestedBackend;
    this.#quality = options.quality ?? 'balanced';
    this.#renderScale = clamp01((options.renderScale ?? 1) * 0.5 + 0.5);
    this.hooks = options.hooks ?? {};
    this.diagnostics = options.diagnostics ?? new Diagnostics();
    this.recovery = options.recovery ?? new RecoveryController({ backend: this.#backend, diagnostics: this.diagnostics });
  }

  get state(): RenderBridgeState {
    return Object.freeze({
      backend: this.#backend,
      requestedBackend: this.#requestedBackend,
      quality: this.#quality,
      renderScale: this.#renderScale,
      ready: this.#ready,
      deviceLosses: this.#deviceLosses,
      recoveryStage: this.recovery.state().stage,
    });
  }

  get metrics(): RenderBridgeMetrics {
    const averageFrameMs = this.#frames > 0 ? this.#totalFrameMs / this.#frames : 0;
    const digest = checksum({
      frames: this.#frames,
      draws: this.#drawItems,
      averageFrameMs: quantize(averageFrameMs, 0.001),
      dropped: this.#droppedFrames,
      qualityChanges: this.#qualityChanges,
      fallbacks: this.#fallbackCount,
    });
    return Object.freeze({
      frames: this.#frames,
      drawItems: this.#drawItems,
      lastFrameMs: this.#lastFrameMs,
      averageFrameMs,
      droppedFrames: this.#droppedFrames,
      qualityChanges: this.#qualityChanges,
      fallbackCount: this.#fallbackCount,
      checksum: digest,
    });
  }

  async initialize(descriptor: RenderDeviceDescriptor): Promise<Result<unknown>> {
    this.#requestedBackend = descriptor.backend;
    try {
      this.#device = await this.hooks.create?.({ ...descriptor, backend: this.#backend });
      this.#ready = true;
      this.diagnostics.info('RENDER_READY', `Renderer ready on ${this.#backend}`, 'render', { backend: this.#backend });
      return { ok: true, value: this.#device };
    } catch (cause) {
      this.diagnostics.error('RENDER_INIT_FAILED', String(cause), 'render', { backend: this.#backend });
      const fallback = this.recovery.chooseFallback(['webgpu', 'webgl2', 'canvas2d', 'headless']);
      if (fallback) {
        this.#fallbackCount += 1;
        await this.#applyFallback(fallback, 'initialization-failed');
        return { ok: true, value: this.#device };
      }
      return { ok: false, error: { code: 'RENDER_INIT_FAILED', message: String(cause), retryable: true, cause } };
    }
  }

  async setQuality(quality: QualityTier, renderScale: number): Promise<void> {
    const normalizedScale = Math.max(0.5, Math.min(1, Number.isFinite(renderScale) ? renderScale : 1));
    if (this.#quality !== quality) this.#qualityChanges += 1;
    this.#quality = quality;
    this.#renderScale = normalizedScale;
    await this.hooks.applyQuality?.(quality, normalizedScale);
  }

  setFrameGraph(graph: FrameGraphPlan | null): void {
    this.#graph = graph;
  }

  createPacket(input: RenderFrameInput): RenderFramePacket {
    const builder = new RenderFrameBuilder()
      .reset(Math.max(0, Math.trunc(input.frame)) as never)
      .backend(input.backend)
      .quality(input.quality, input.renderScale)
      .camera(structuredClone(input.camera))
      .pressure({
        cpu: clamp01(input.pressure),
        gpu: clamp01(input.pressure),
        frame: clamp01(input.pressure),
        memory: 0,
        thermal: 0,
        combined: clamp01(input.pressure),
      });
    for (const draw of input.draws) builder.add(draw);
    return builder.build();
  }

  async render(input: RenderFrameInput, measuredFrameMs = 0): Promise<Result<RenderFramePacket>> {
    if (!this.#ready) return { ok: false, error: { code: 'RENDER_NOT_READY', message: 'Render bridge is not initialized', retryable: true } };
    try {
      const packet = this.createPacket(input);
      await this.hooks.draw?.({ packet, graph: this.#graph });
      this.#frames += 1;
      this.#drawItems += packet.draws.length;
      this.#lastFrameMs = Math.max(0, measuredFrameMs);
      this.#totalFrameMs += this.#lastFrameMs;
      this.recovery.observeHealthyFrame();
      return { ok: true, value: packet };
    } catch (cause) {
      this.#droppedFrames += 1;
      const error: PlatformError = { code: 'RENDER_FRAME_FAILED', message: String(cause), retryable: true, cause };
      this.diagnostics.error(error.code, error.message, 'render');
      return { ok: false, error };
    }
  }

  async notifyDeviceLoss(reason = 'device-lost', timestampMs = 0): Promise<Result<RenderBridgeState>> {
    this.#deviceLosses += 1;
    this.#ready = false;
    const recovery = this.recovery.notifyDeviceLoss(reason, timestampMs);
    if (!recovery.ok) return recovery;
    const next = this.recovery.chooseFallback(this.#supportedBackends());
    if (next && this.#deviceLosses > 1) {
      await this.#applyFallback(next, reason);
    }
    return { ok: true, value: this.state };
  }

  async retry(descriptor: RenderDeviceDescriptor, timestampMs: number): Promise<Result<unknown>> {
    if (!this.recovery.canRetry(timestampMs)) {
      return { ok: false, error: { code: 'RENDER_RETRY_NOT_READY', message: 'Render recovery backoff has not elapsed', retryable: true } };
    }
    this.recovery.markRetryStarted();
    await this.#destroyDevice();
    try {
      this.#device = await this.hooks.create?.({ ...descriptor, backend: this.#backend });
      this.#ready = true;
      this.recovery.markRetrySucceeded(this.#backend);
      return { ok: true, value: this.#device };
    } catch (cause) {
      this.diagnostics.warning('RENDER_RETRY_FAILED', String(cause), 'render', { backend: this.#backend });
      return { ok: false, error: { code: 'RENDER_RETRY_FAILED', message: String(cause), retryable: true, cause } };
    }
  }

  async fallbackTo(backend: RenderBackend, reason = 'manual-fallback'): Promise<boolean> {
    if (backend === this.#backend) return false;
    await this.#applyFallback(backend, reason);
    return true;
  }

  async dispose(): Promise<void> {
    await this.#destroyDevice();
    this.#graph = null;
    this.#ready = false;
  }

  #supportedBackends(): readonly RenderBackend[] {
    return this.#requestedBackend === 'headless' ? ['headless'] : ['webgpu', 'webgl2', 'canvas2d', 'headless'];
  }

  async #applyFallback(next: RenderBackend, reason: string): Promise<void> {
    const previous = this.#backend;
    await this.#destroyDevice();
    this.#backend = next;
    this.recovery.fallback(next, reason);
    try {
      this.#device = await this.hooks.create?.({ backend: next, label: `fallback:${reason}` });
      this.#ready = true;
      this.#fallbackCount += 1;
      await this.hooks.onFallback?.(previous, next);
    } catch (cause) {
      this.#ready = false;
      this.diagnostics.error('RENDER_FALLBACK_FAILED', String(cause), 'render', { previous, next });
    }
  }

  async #destroyDevice(): Promise<void> {
    if (this.#device === null) return;
    try {
      await this.hooks.destroy?.(this.#device);
    } finally {
      this.#device = null;
    }
  }
}

export function createRenderBridge(backend: RenderBackend, diagnostics?: Diagnostics): RenderBridge {
  return new RenderBridge({ backend, diagnostics });
}
