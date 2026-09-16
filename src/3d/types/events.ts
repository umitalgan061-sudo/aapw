export interface RuntimeEventMap {
  'runtime:start': { readonly worldId: string; readonly backend: string };
  'runtime:stop': { readonly reason: string };
  'runtime:tick': { readonly tick: number; readonly deltaMs: number };
  'runtime:quality': { readonly from: string; readonly to: string; readonly reason: string };
  'runtime:memory-pressure': { readonly level: 'normal' | 'warning' | 'critical'; readonly usedBytes: number; readonly budgetBytes: number };
  'runtime:device-lost': { readonly message: string; readonly recoverable: boolean };
  'runtime:device-restored': { readonly backend: string; readonly downtimeMs: number };
  'asset:queued': { readonly assetId: string; readonly priority: number };
  'asset:ready': { readonly assetId: string; readonly bytes: number };
  'asset:evicted': { readonly assetId: string; readonly reason: string };
  'save:begin': { readonly slot: string; readonly version: number };
  'save:complete': { readonly slot: string; readonly bytes: number };
  'save:failed': { readonly slot: string; readonly code: string };
  'world:stream': { readonly regionId: string; readonly state: 'queued' | 'loading' | 'ready' | 'unloading' };
  'input:action': { readonly action: string; readonly value: number; readonly source: string };
}

export type RuntimeEventName = keyof RuntimeEventMap;
export type RuntimeListener<K extends RuntimeEventName> = (payload: RuntimeEventMap[K]) => void;
export type Unsubscribe = () => void;

interface ListenerEntry<K extends RuntimeEventName> {
  readonly listener: RuntimeListener<K>;
  readonly once: boolean;
}

export class TypedEventBus<Events extends Record<string, unknown>> {
  #listeners = new Map<keyof Events, Set<{ readonly listener: (payload: never) => void; readonly once: boolean }>>();
  #emitting = false;

  on<K extends keyof Events>(name: K, listener: (payload: Events[K]) => void): Unsubscribe {
    const entry = { listener: listener as (payload: never) => void, once: false };
    const set = this.#listeners.get(name) ?? new Set();
    set.add(entry);
    this.#listeners.set(name, set);
    return () => set.delete(entry);
  }

  once<K extends keyof Events>(name: K, listener: (payload: Events[K]) => void): Unsubscribe {
    const entry = { listener: listener as (payload: never) => void, once: true };
    const set = this.#listeners.get(name) ?? new Set();
    set.add(entry);
    this.#listeners.set(name, set);
    return () => set.delete(entry);
  }

  emit<K extends keyof Events>(name: K, payload: Events[K]): void {
    const set = this.#listeners.get(name);
    if (!set || set.size === 0) return;
    this.#emitting = true;
    try {
      for (const entry of [...set]) {
        entry.listener(payload as never);
        if (entry.once) set.delete(entry);
      }
    } finally {
      this.#emitting = false;
    }
  }

  clear<K extends keyof Events>(name?: K): void {
    if (name === undefined) this.#listeners.clear();
    else this.#listeners.delete(name);
  }

  listenerCount<K extends keyof Events>(name: K): number {
    return this.#listeners.get(name)?.size ?? 0;
  }

  get isEmitting(): boolean {
    return this.#emitting;
  }
}

export type RuntimeBus = TypedEventBus<RuntimeEventMap>;

export const createRuntimeBus = (): RuntimeBus => new TypedEventBus<RuntimeEventMap>();
