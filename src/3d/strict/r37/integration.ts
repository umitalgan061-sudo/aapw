import type { RuntimeConfig, RuntimeHealth, Vec3 } from './types.ts';
import { UnifiedRuntimeR37 } from './runtimeFacade.ts';
import { clamp, finite } from './math.ts';

export interface RuntimeIntegrationHost {
  readonly getCameraPosition: () => Vec3;
  readonly onFrame?: (health: RuntimeHealth) => void;
  readonly onQualityChange?: (quality: RuntimeConfig['initialQuality']) => void;
  readonly now?: () => number;
}

export class RuntimeIntegrationR37 {
  readonly runtime: UnifiedRuntimeR37;
  #host: RuntimeIntegrationHost;
  #running = false;
  #lastTimeMs: number | null = null;
  #unsubscribe: Array<() => void> = [];

  constructor(config: Partial<RuntimeConfig>, host: RuntimeIntegrationHost) {
    this.#host = host;
    this.runtime = new UnifiedRuntimeR37(config, {
      onQualityChange: (quality) => {
        host.onQualityChange?.(quality);
      },
      onRenderFrame: () => {
        host.onFrame?.(this.runtime.health());
      },
    });
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#lastTimeMs = null;
  }

  stop(): void {
    if (!this.#running) return;
    this.#running = false;
    this.#lastTimeMs = null;
    for (const dispose of this.#unsubscribe.splice(0)) dispose();
  }

  tick(nowMs: number): RuntimeHealth {
    if (!this.#running) return this.runtime.health();
    const current = finite(nowMs);
    const previous = this.#lastTimeMs;
    this.#lastTimeMs = current;
    const delta = previous === null ? 0 : clamp((current - previous) / 1000, 0, 0.25);
    const result = this.runtime.step(delta, this.#host.getCameraPosition());
    return result.health;
  }

  dispatch(command: Parameters<UnifiedRuntimeR37['dispatchCommand']>[0]): boolean {
    return this.runtime.dispatchCommand(command) !== null;
  }

  dispose(): void {
    this.stop();
    this.runtime.dispose();
    this.#host = {
      getCameraPosition: () => ({ x: 0, y: 0, z: 0 }),
    };
  }
}

export function createR37Integration(config: Partial<RuntimeConfig>, host: RuntimeIntegrationHost): RuntimeIntegrationR37 {
  return new RuntimeIntegrationR37(config, host);
}
