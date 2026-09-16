import type { CameraState, PlatformError, QualityTier, Result } from './types';
import { checksum } from './deterministic';
import { RuntimeKernel, type KernelFrameInput, type KernelHooks } from './runtimeKernel';
import { RuntimeLifecycle } from './runtimeLifecycle';
import { AssetRuntime } from './assetRuntime';
import { RenderBridge } from './renderBridge';
import { RecoveryController } from './recoveryController';

export interface LegacyStateSink {
  set?: (key: string, value: unknown) => void;
  get?: (key: string) => unknown;
}

export interface LegacyRendererSink {
  setPixelRatio?: (ratio: number) => void;
  setQuality?: (quality: QualityTier) => void;
  setBackend?: (backend: string) => void;
}

export interface ModernRuntimeFacadeOptions {
  readonly seed?: number;
  readonly hooks?: KernelHooks;
  readonly legacyState?: LegacyStateSink;
  readonly legacyRenderer?: LegacyRendererSink;
  readonly canvas?: HTMLCanvasElement;
}

export interface ModernRuntimeFacadeSnapshot {
  readonly phase: string;
  readonly frame: number;
  readonly quality: QualityTier;
  readonly backend: string;
  readonly renderScale: number;
  readonly pressure: number;
  readonly streamedCells: number;
  readonly entities: number;
  readonly digest: string;
}

/**
 * Typed composition facade intended as the actual migration seam for game3d.js and future pages.
 * It mirrors legacy state into small primitive fields and never exposes mutable engine internals.
 */
export class ModernRuntimeFacade {
  readonly kernel: RuntimeKernel;
  readonly lifecycle: RuntimeLifecycle;
  readonly assets: AssetRuntime;
  readonly renderer: RenderBridge;
  readonly recovery: RecoveryController;

  #legacyState: LegacyStateSink;
  #legacyRenderer: LegacyRendererSink;
  #canvas: HTMLCanvasElement | undefined;
  #lastSnapshot: ModernRuntimeFacadeSnapshot | null = null;
  #initialized = false;

  constructor(options: ModernRuntimeFacadeOptions = {}) {
    this.#legacyState = options.legacyState ?? {};
    this.#legacyRenderer = options.legacyRenderer ?? {};
    this.#canvas = options.canvas;
    this.recovery = new RecoveryController({ backend: 'webgpu', seed: options.seed });
    this.kernel = new RuntimeKernel({ seed: options.seed, hooks: options.hooks });
    this.assets = new AssetRuntime({ registry: this.kernel.resources, diagnostics: this.kernel.diagnostics });
    this.renderer = new RenderBridge({ backend: this.kernel.profile.preferredBackend, diagnostics: this.kernel.diagnostics, recovery: this.recovery });
    this.lifecycle = new RuntimeLifecycle({ kernel: this.kernel });
    this.kernel.events.on('render:quality-changed', (change) => {
      this.#legacyState.set?.('renderQuality', change.next);
      this.#legacyRenderer.setQuality?.(change.next);
    });
    this.kernel.events.on('runtime:frame', (frame) => {
      this.#legacyState.set?.('runtimeFrame', Number(frame.frame));
      this.#legacyState.set?.('runtimeWeather', frame.weather);
    });
  }

  async initialize(): Promise<Result<ModernRuntimeFacadeSnapshot>> {
    if (this.#initialized) return { ok: true, value: this.snapshot() };
    try {
      this.lifecycle.start();
      const renderResult = await this.renderer.initialize({ backend: this.kernel.profile.preferredBackend, canvas: this.#canvas, label: 'aapw-modern-facade' });
      if (!renderResult.ok) return renderResult;
      this.#legacyRenderer.setBackend?.(this.renderer.state.backend);
      this.#legacyState.set?.('renderBackend', this.renderer.state.backend);
      this.#initialized = true;
      const snapshot = this.snapshot();
      this.#writeLegacyState(snapshot);
      return { ok: true, value: snapshot };
    } catch (cause) {
      const error: PlatformError = { code: 'MODERN_FACADE_INIT_FAILED', message: String(cause), retryable: true, cause };
      this.kernel.diagnostics.error(error.code, error.message, 'facade');
      return { ok: false, error };
    }
  }

  async frame(input: KernelFrameInput): Promise<Result<ModernRuntimeFacadeSnapshot>> {
    if (!this.#initialized) {
      const init = await this.initialize();
      if (!init.ok) return init;
    }
    try {
      const result = await this.lifecycle.frame(input);
      const state = this.snapshot(result.frame, result.quality, result.backend, result.pressure.combined, result.streamPlan.retain.length);
      this.#writeLegacyState(state);
      await this.renderer.setQuality(result.quality, this.kernel.quality.decision.renderScale);
      return { ok: true, value: state };
    } catch (cause) {
      const error: PlatformError = { code: 'MODERN_FACADE_FRAME_FAILED', message: String(cause), retryable: true, cause };
      this.kernel.diagnostics.error(error.code, error.message, 'facade');
      return { ok: false, error };
    }
  }

  setQuality(quality: QualityTier): void {
    this.kernel.quality.force(quality);
    this.#legacyState.set?.('renderQuality', quality);
    this.#legacyRenderer.setQuality?.(quality);
  }

  async pause(reason = 'manual'): Promise<void> {
    this.lifecycle.suspend(reason);
    await this.renderer.setQuality(this.kernel.quality.tier, this.kernel.quality.decision.renderScale);
    this.#legacyState.set?.('paused', true);
  }

  async resume(reason = 'manual'): Promise<void> {
    this.lifecycle.resume(reason);
    this.#legacyState.set?.('paused', false);
  }

  async shutdown(): Promise<void> {
    this.lifecycle.stop('shutdown');
    await this.renderer.dispose();
    this.assets.clear();
    this.#initialized = false;
  }

  snapshot(frame = 0, quality: QualityTier = this.kernel.quality.tier, backend = this.renderer.state.backend, pressure = 0, streamedCells = this.kernel.streaming.loadedKeys().length): ModernRuntimeFacadeSnapshot {
    const entities = this.kernel.createSnapshot().entities.length;
    const state: ModernRuntimeFacadeSnapshot = Object.freeze({
      phase: this.lifecycle.state.phase,
      frame: Math.max(0, Math.trunc(frame || this.lifecycle.state.frames)),
      quality,
      backend,
      renderScale: this.kernel.quality.decision.renderScale,
      pressure,
      streamedCells,
      entities,
      digest: checksum({ phase: this.lifecycle.state.phase, frame, quality, backend, streamedCells, entities, pressure }),
    });
    this.#lastSnapshot = state;
    return state;
  }

  diagnostics(): Readonly<Record<string, unknown>> {
    return Object.freeze({
      facade: this.#lastSnapshot,
      lifecycle: this.lifecycle.report(),
      kernel: this.kernel.diagnosticsSnapshot(),
      renderer: this.renderer.metrics,
      recovery: this.recovery.state(),
      assets: this.assets.stats(),
    });
  }

  #writeLegacyState(snapshot: ModernRuntimeFacadeSnapshot): void {
    this.#legacyState.set?.('renderBackend', snapshot.backend);
    this.#legacyState.set?.('renderQuality', snapshot.quality);
    this.#legacyState.set?.('renderScale', snapshot.renderScale);
    this.#legacyState.set?.('renderPressure', snapshot.pressure);
    this.#legacyState.set?.('runtimePhase', snapshot.phase);
    this.#legacyState.set?.('runtimeDigest', snapshot.digest);
    this.#legacyRenderer.setPixelRatio?.(snapshot.renderScale);
    this.#legacyRenderer.setQuality?.(snapshot.quality);
    this.#legacyRenderer.setBackend?.(snapshot.backend);
  }
}

export function createModernRuntimeFacade(options: ModernRuntimeFacadeOptions = {}): ModernRuntimeFacade {
  return new ModernRuntimeFacade(options);
}

export function cameraFromThreeLike(camera: { position?: { x: number; y: number; z: number }; fov?: number; near?: number; far?: number }, viewport = { width: 1, height: 1, dpr: 1 }): CameraState {
  return {
    position: { x: camera.position?.x ?? 0, y: camera.position?.y ?? 0, z: camera.position?.z ?? 0 },
    target: { x: 0, y: 0, z: 0 },
    fov: camera.fov ?? 60,
    near: camera.near ?? 0.1,
    far: camera.far ?? 5_000,
    viewportWidth: Math.max(1, viewport.width),
    viewportHeight: Math.max(1, viewport.height),
    dpr: Math.max(1, viewport.dpr),
  };
}
