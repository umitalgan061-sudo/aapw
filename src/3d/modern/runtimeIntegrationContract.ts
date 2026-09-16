import type { CameraState, InputAction, PlatformError, QualityTier, Result, RuntimeSnapshot } from './types';
import { checksum } from './deterministic';
import type { ModernRuntimeFacadeSnapshot } from './modernRuntimeFacade';

export interface LegacyFrameTelemetry {
  readonly frameMs: number;
  readonly cpuMs: number;
  readonly gpuMs?: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly visibleObjects: number;
  readonly textureBytes: number;
  readonly memoryPressure?: number;
  readonly thermalPressure?: number;
}

export interface RuntimeIntegrationFrame {
  readonly camera: CameraState;
  readonly telemetry: LegacyFrameTelemetry;
  readonly actions: readonly InputAction[];
}

export interface RuntimeIntegrationResult {
  readonly snapshot: RuntimeSnapshot;
  readonly facade: ModernRuntimeFacadeSnapshot;
  readonly consumedActions: number;
  readonly qualityChanged: boolean;
  readonly digest: string;
}

export interface RuntimeIntegrationContract {
  initialize(): Promise<Result<ModernRuntimeFacadeSnapshot>>;
  frame(frame: RuntimeIntegrationFrame): Promise<Result<RuntimeIntegrationResult>>;
  setQuality(quality: QualityTier): void;
  pause(): Promise<void>;
  resume(): Promise<void>;
  shutdown(): Promise<void>;
}

/**
 * Declarative seam for replacing the current game3d.js tick wiring.
 * The contract is intentionally tiny so the legacy runtime can be progressively migrated without
 * leaking platform implementation classes into gameplay code.
 */
export class RuntimeIntegrationGuard {
  #lastFrame = -1;
  #maxActionsPerFrame: number;
  #maxFrameMs: number;

  constructor(options: { readonly maxActionsPerFrame?: number; readonly maxFrameMs?: number } = {}) {
    this.#maxActionsPerFrame = Math.max(1, Math.min(512, Math.floor(options.maxActionsPerFrame ?? 32)));
    this.#maxFrameMs = Math.max(16, Math.min(500, options.maxFrameMs ?? 250));
  }

  validate(frame: RuntimeIntegrationFrame, frameId: number): Result<RuntimeIntegrationFrame> {
    if (!Number.isSafeInteger(frameId) || frameId < 0 || frameId <= this.#lastFrame) return this.fail('INTEGRATION_FRAME_ORDER', 'Frame ids must be strictly increasing');
    if (!Number.isFinite(frame.telemetry.frameMs) || frame.telemetry.frameMs < 0 || frame.telemetry.frameMs > this.#maxFrameMs) return this.fail('INTEGRATION_FRAME_MS', 'Frame duration exceeds integration limit');
    if (frame.actions.length > this.#maxActionsPerFrame) return this.fail('INTEGRATION_ACTION_CAP', 'Too many semantic actions in one frame');
    this.#lastFrame = frameId;
    return { ok: true, value: Object.freeze({ ...frame, actions: Object.freeze(frame.actions.map((action) => ({ ...action }))) }) };
  }

  reset(): void { this.#lastFrame = -1; }

  digest(frame: RuntimeIntegrationFrame): string {
    return checksum({ camera: frame.camera, telemetry: frame.telemetry, actions: frame.actions.map((action) => ({ action: action.action, value: action.value, source: action.source })) });
  }

  #fail(code: string, message: string): Result<never> {
    const error: PlatformError = { code, message, retryable: false };
    return { ok: false, error };
  }
}

export function createIntegrationFrame(camera: CameraState, telemetry: LegacyFrameTelemetry, actions: readonly InputAction[] = []): RuntimeIntegrationFrame {
  return Object.freeze({ camera: structuredClone(camera), telemetry: { ...telemetry }, actions: Object.freeze(actions.map((action) => ({ ...action }))) });
}
