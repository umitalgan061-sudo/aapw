import type { Result, QualityTier, RenderCapabilities } from './types';
import { createModernRuntime, tickModernRuntime, type RuntimeServices, type RuntimeFrameInput } from './runtime';

export interface LegacyGameStateLike {
  set?: (key: string, value: unknown) => void;
  get?: (key: string) => unknown;
}

export interface LegacyRenderLike {
  capabilities?: RenderCapabilities;
  setPixelRatio?: (ratio: number) => void;
  setQuality?: (quality: QualityTier) => void;
}

/** Narrow compatibility boundary for incremental migration of the existing JavaScript engine. */
export class LegacyRuntimeBridge {
  #services: RuntimeServices | null = null;
  #legacyState: LegacyGameStateLike;
  #legacyRender: LegacyRenderLike;

  constructor(legacyState: LegacyGameStateLike = {}, legacyRender: LegacyRenderLike = {}) {
    this.#legacyState = legacyState;
    this.#legacyRender = legacyRender;
  }

  async init(canvas?: HTMLCanvasElement): Promise<Result<RuntimeServices>> {
    try {
      this.#services = await createModernRuntime({ canvas });
      this.#legacyState.set?.('renderBackend', this.#services.capabilities.backend);
      this.#legacyState.set?.('renderQuality', this.#services.quality.tier);
      this.#legacyRender.capabilities = this.#services.capabilities;
      return { ok: true, value: this.#services };
    } catch (cause) {
      return { ok: false, error: { code: 'MODERN_RUNTIME_INIT_FAILED', message: String(cause), retryable: true, cause } };
    }
  }

  frame(input: RuntimeFrameInput): Result<ReturnType<typeof tickModernRuntime>> {
    if (!this.#services) return { ok: false, error: { code: 'MODERN_RUNTIME_NOT_READY', message: 'Runtime bridge is not initialized', retryable: false } };
    const snapshot = tickModernRuntime(this.#services, input);
    this.#legacyState.set?.('renderQuality', snapshot.quality);
    this.#legacyState.set?.('renderPressure', snapshot.pressure.combined);
    this.#legacyState.set?.('frameMs', input.frameMs);
    this.#legacyRender.setQuality?.(snapshot.quality);
    this.#legacyRender.setPixelRatio?.(this.#services.quality.decision.renderScale);
    return { ok: true, value: snapshot };
  }

  services(): RuntimeServices | null { return this.#services; }
  dispose(): void { this.#services = null; }
}
