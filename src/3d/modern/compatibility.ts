import type { Disposable, RendererBackend, RuntimeError, RuntimePhase } from './types';

export interface LegacySceneManagerLike {
  renderer?: unknown;
  scene?: unknown;
  camera?: unknown;
  dispose?: () => void;
}

export interface ModernBridgeHooks {
  onPhase?(phase: RuntimePhase): void;
  onError?(error: RuntimeError): void;
  onBackend?(backend: RendererBackend): void;
}

/** Compatibility boundary for existing JavaScript sceneManager/camera/UI modules. */
export class LegacyRuntimeBridge implements Disposable {
  private readonly legacy: LegacySceneManagerLike;
  private readonly hooks: ModernBridgeHooks;
  private attached = false;
  private disposed = false;

  public constructor(legacy: LegacySceneManagerLike, hooks: ModernBridgeHooks = {}) {
    this.legacy = legacy;
    this.hooks = hooks;
  }

  public attach(): void {
    this.ensureActive();
    if (this.attached) return;
    this.attached = true;
    if (!this.legacy.renderer) this.hooks.onError?.({ code: 'LEGACY_RENDERER_MISSING', message: 'legacy scene manager did not expose a renderer', recoverable: true });
    this.hooks.onPhase?.('ready');
  }

  public notifyBackend(backend: RendererBackend): void { this.ensureActive(); this.hooks.onBackend?.(backend); }
  public notifyPhase(phase: RuntimePhase): void { this.ensureActive(); this.hooks.onPhase?.(phase); }
  public notifyError(error: RuntimeError): void { this.ensureActive(); this.hooks.onError?.(error); }

  public snapshot(): { readonly attached: boolean; readonly rendererPresent: boolean; readonly scenePresent: boolean; readonly cameraPresent: boolean } {
    return { attached: this.attached, rendererPresent: Boolean(this.legacy.renderer), scenePresent: Boolean(this.legacy.scene), cameraPresent: Boolean(this.legacy.camera) };
  }

  private ensureActive(): void { if (this.disposed) throw new Error('LEGACY_BRIDGE_DISPOSED'); }
  public dispose(): void { if (this.disposed) return; this.attached = false; this.disposed = true; }
}

export interface MigrationFeatureFlags {
  readonly typescriptCore: boolean;
  readonly typedInput: boolean;
  readonly typedPersistence: boolean;
  readonly adaptiveQuality: boolean;
  readonly modernRenderer: boolean;
  readonly workerSimulation: boolean;
}

export const DEFAULT_MIGRATION_FLAGS: MigrationFeatureFlags = Object.freeze({
  typescriptCore: true,
  typedInput: true,
  typedPersistence: true,
  adaptiveQuality: true,
  modernRenderer: true,
  workerSimulation: false,
});

export interface MigrationReport {
  readonly enabled: readonly string[];
  readonly disabled: readonly string[];
  readonly compatibilityMode: boolean;
}

export const describeMigration = (flags: MigrationFeatureFlags = DEFAULT_MIGRATION_FLAGS): MigrationReport => {
  const entries = Object.entries(flags);
  return {
    enabled: entries.filter(([, value]) => value).map(([key]) => key),
    disabled: entries.filter(([, value]) => !value).map(([key]) => key),
    compatibilityMode: flags.modernRenderer && !flags.workerSimulation,
  };
};

export interface BrowserFeatureMatrix {
  readonly webgpu: boolean;
  readonly webgl2: boolean;
  readonly offscreenCanvas: boolean;
  readonly worker: boolean;
  readonly indexedDb: boolean;
  readonly compressionStream: boolean;
  readonly abortSignal: boolean;
  readonly viewTransitions: boolean;
}

export const detectBrowserFeatures = (): BrowserFeatureMatrix => ({
  webgpu: Boolean((globalThis.navigator as Navigator & { gpu?: unknown })?.gpu),
  webgl2: (() => { try { const canvas = document.createElement('canvas'); return Boolean(canvas.getContext('webgl2')); } catch { return false; } })(),
  offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
  worker: typeof Worker !== 'undefined',
  indexedDb: typeof indexedDB !== 'undefined',
  compressionStream: typeof CompressionStream !== 'undefined',
  abortSignal: typeof AbortSignal !== 'undefined',
  viewTransitions: typeof (document as Document & { startViewTransition?: unknown })?.startViewTransition === 'function',
});

export const safeCanvasResize = (canvas: HTMLCanvasElement | OffscreenCanvas, width: number, height: number, maxDimension = 8192): void => {
  canvas.width = Math.min(maxDimension, Math.max(1, Math.floor(width)));
  canvas.height = Math.min(maxDimension, Math.max(1, Math.floor(height)));
};

export const safeDevicePixelRatio = (value = globalThis.devicePixelRatio || 1, min = 0.5, max = 2): number => Math.min(max, Math.max(min, Number.isFinite(value) ? value : 1));
