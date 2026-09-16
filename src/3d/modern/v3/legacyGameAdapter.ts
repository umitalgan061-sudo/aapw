import type { V3LegacyAdapter } from './runtimeContracts.js';

interface LegacyGameModule {
  readonly initGame3D?: () => void | Promise<void>;
}

interface LegacyStateLike {
  readonly gameState?: {
    readonly get?: (key: string) => unknown;
  };
}

export interface LegacyGameAdapterOptions {
  readonly loader?: () => Promise<LegacyGameModule>;
  readonly onBridgeEvent?: (event: { readonly operation: string; readonly durationMs: number; readonly succeeded: boolean }) => void;
}

const defaultLoader = async (): Promise<LegacyGameModule> => {
  const module = await import('../../game3d.js') as unknown as LegacyGameModule;
  return module;
};

const clock = (): number => typeof performance !== 'undefined' ? performance.now() : Date.now();

export class TypeSafeLegacyGameAdapter implements V3LegacyAdapter {
  readonly #loader: () => Promise<LegacyGameModule>;
  readonly #onBridgeEvent: LegacyGameAdapterOptions['onBridgeEvent'];
  #module: LegacyGameModule | null = null;
  #loaded = false;

  constructor(options: LegacyGameAdapterOptions = {}) {
    this.#loader = options.loader ?? defaultLoader;
    this.#onBridgeEvent = options.onBridgeEvent;
  }

  async load(): Promise<boolean> {
    if (this.#loaded) return true;
    const started = clock();
    try {
      const module = await this.#loader();
      if (typeof module.initGame3D !== 'function') throw new Error('LEGACY_GAME_INIT_MISSING');
      await module.initGame3D();
      this.#module = module;
      this.#loaded = true;
      this.#emit('load', started, true);
      return true;
    } catch (error) {
      this.#emit('load', started, false);
      throw error;
    }
  }

  async unload(): Promise<void> {
    if (!this.#loaded) return;
    const started = clock();
    this.#module = null;
    this.#loaded = false;
    this.#emit('unload', started, true);
  }

  isLoaded(): boolean { return this.#loaded; }

  async invoke(operation: string, action: () => void | Promise<void>): Promise<boolean> {
    const started = clock();
    try {
      await action();
      this.#emit(operation, started, true);
      return true;
    } catch (error) {
      this.#emit(operation, started, false);
      throw error;
    }
  }

  getStateValue(key: string): unknown {
    const state = globalThis as unknown as LegacyStateLike & { readonly __AapwLegacyGameState?: LegacyStateLike };
    return state.__AapwLegacyGameState?.gameState?.get?.(key);
  }

  #emit(operation: string, started: number, succeeded: boolean): void {
    this.#onBridgeEvent?.(Object.freeze({ operation, durationMs: Math.max(0, clock() - started), succeeded }));
  }
}

export const createTypeSafeLegacyGameAdapter = (options: LegacyGameAdapterOptions = {}): TypeSafeLegacyGameAdapter => new TypeSafeLegacyGameAdapter(options);
