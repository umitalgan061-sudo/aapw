import type {
  RuntimeEventBus,
  RuntimeEventListener,
  RuntimeEventMap,
  RuntimeEventName,
} from './contracts.ts';

type ListenerBucket<K extends RuntimeEventName> = Set<RuntimeEventListener<K>>;

export class TypedRuntimeEventRouter implements RuntimeEventBus {
  #listeners = new Map<RuntimeEventName, Set<RuntimeEventListener<any>>>();
  #sequence = 0;

  on<K extends RuntimeEventName>(event: K, listener: RuntimeEventListener<K>): () => void {
    let bucket = this.#listeners.get(event) as ListenerBucket<K> | undefined;
    if (!bucket) {
      bucket = new Set<RuntimeEventListener<K>>();
      this.#listeners.set(event, bucket as Set<RuntimeEventListener<any>>);
    }
    bucket.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      bucket?.delete(listener);
      if (bucket?.size === 0) this.#listeners.delete(event);
    };
  }

  emit<K extends RuntimeEventName>(event: K, payload: RuntimeEventMap[K]): void {
    this.#sequence += 1;
    const bucket = this.#listeners.get(event);
    if (!bucket) return;
    const listeners = [...bucket] as RuntimeEventListener<K>[];
    for (const listener of listeners) {
      try {
        listener(payload);
      } catch {
        // Event consumers are isolation boundaries. A broken HUD/diagnostic subscriber
        // must never interrupt the deterministic simulation tick.
      }
    }
  }

  clear(): void {
    for (const bucket of this.#listeners.values()) bucket.clear();
    this.#listeners.clear();
  }

  listenerCount(event?: RuntimeEventName): number {
    if (event) return this.#listeners.get(event)?.size ?? 0;
    let count = 0;
    for (const bucket of this.#listeners.values()) count += bucket.size;
    return count;
  }

  sequence(): number {
    return this.#sequence;
  }

  has(event: RuntimeEventName): boolean {
    return (this.#listeners.get(event)?.size ?? 0) > 0;
  }

  once<K extends RuntimeEventName>(event: K, listener: RuntimeEventListener<K>): () => void {
    let unsubscribe = () => {};
    unsubscribe = this.on(event, (payload) => {
      unsubscribe();
      listener(payload);
    });
    return unsubscribe;
  }

  waitFor<K extends RuntimeEventName>(event: K, timeoutMs = 5000): Promise<RuntimeEventMap[K]> {
    const timeout = Math.max(1, Math.floor(timeoutMs));
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const unsubscribe = this.once(event, (payload) => {
        if (timer) clearTimeout(timer);
        resolve(payload);
      });
      timer = setTimeout(() => {
        unsubscribe();
        reject(new Error(`Timed out waiting for runtime event: ${event}`));
      }, timeout);
    });
  }
}

export function bridgeRuntimeEvent<K extends RuntimeEventName>(
  source: RuntimeEventBus,
  target: RuntimeEventBus,
  event: K,
): () => void {
  return source.on(event, (payload) => target.emit(event, payload));
}

export function bridgeRuntimeEvents(
  source: RuntimeEventBus,
  target: RuntimeEventBus,
  events: readonly RuntimeEventName[],
): () => void {
  const unsubscribers = events.map((event) => bridgeRuntimeEvent(source, target, event));
  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
  };
}
