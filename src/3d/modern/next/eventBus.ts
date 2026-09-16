export type EventMap = Record<string, unknown>;

type Listener<T> = (payload: T) => void;

interface Subscription {
  readonly event: string;
  readonly id: number;
  active: boolean;
}

export class EventBus<TMap extends EventMap = EventMap> {
  #listeners = new Map<keyof TMap & string, Map<number, Listener<unknown>>>();
  #nextId = 1;
  #dispatching = 0;
  #queued: Array<{ event: keyof TMap & string; payload: unknown }> = [];

  on<K extends keyof TMap & string>(event: K, listener: Listener<TMap[K]>): () => void {
    let listeners = this.#listeners.get(event);
    if (!listeners) {
      listeners = new Map();
      this.#listeners.set(event, listeners);
    }
    const id = this.#nextId++;
    listeners.set(id, listener as Listener<unknown>);
    const subscription: Subscription = { event, id, active: true };
    return () => {
      if (!subscription.active) return;
      subscription.active = false;
      listeners?.delete(id);
    };
  }

  once<K extends keyof TMap & string>(event: K, listener: Listener<TMap[K]>): () => void {
    let off = () => {};
    off = this.on(event, (payload) => {
      off();
      listener(payload);
    });
    return off;
  }

  emit<K extends keyof TMap & string>(event: K, payload: TMap[K]): void {
    if (this.#dispatching > 0) {
      this.#queued.push({ event, payload });
      return;
    }
    this.#dispatch(event, payload);
    while (this.#queued.length) {
      const queued = this.#queued.shift()!;
      this.#dispatch(queued.event, queued.payload);
    }
  }

  clear(event?: keyof TMap & string): void {
    if (event === undefined) this.#listeners.clear();
    else this.#listeners.delete(event);
  }

  listenerCount<K extends keyof TMap & string>(event?: K): number {
    if (event !== undefined) return this.#listeners.get(event)?.size ?? 0;
    let total = 0;
    for (const listeners of this.#listeners.values()) total += listeners.size;
    return total;
  }

  #dispatch(event: keyof TMap & string, payload: TMap[keyof TMap]): void {
    const listeners = this.#listeners.get(event);
    if (!listeners?.size) return;
    this.#dispatching += 1;
    try {
      for (const listener of [...listeners.values()]) listener(payload);
    } finally {
      this.#dispatching -= 1;
    }
  }
}

export interface RuntimeEvents {
  'world:tick': { tick: number; dtSeconds: number };
  'entity:created': { id: number };
  'entity:destroyed': { id: number };
  'resource:ready': { key: string; generation: number };
  'resource:error': { key: string; error: string };
  'network:ack': { sequence: number; rttMs: number };
  'telemetry:flush': { count: number };
}
