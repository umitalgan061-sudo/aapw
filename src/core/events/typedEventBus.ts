import type { RuntimeError } from '../domain/contracts.ts';

export type EventMap = Record<string, unknown>;
export type EventName<M extends EventMap> = Extract<keyof M, string>;
export type EventHandler<T> = (payload: T) => void | Promise<void>;
export type Unsubscribe = () => void;

export interface EventEnvelope<N extends string, T> {
  readonly id: string;
  readonly name: N;
  readonly sequence: number;
  readonly emittedAt: number;
  readonly payload: T;
}

export interface EventBusMetrics {
  readonly emitted: number;
  readonly delivered: number;
  readonly failed: number;
  readonly subscriptions: number;
  readonly queueDepth: number;
  readonly dropped: number;
}

export interface TypedEventBusOptions {
  readonly maxQueue?: number;
  readonly maxListenersPerEvent?: number;
  readonly onError?: (error: RuntimeError, envelope: EventEnvelope<string, unknown>) => void;
  readonly now?: () => number;
  readonly idFactory?: (sequence: number) => string;
}

interface Subscription<T> {
  readonly handler: EventHandler<T>;
  readonly once: boolean;
}

const safeNumber = (value: number, fallback: number): number => Number.isFinite(value) ? value : fallback;

const createRuntimeError = (error: unknown): RuntimeError => Object.freeze({
  code: 'EVENT_HANDLER_FAILURE',
  message: error instanceof Error ? error.message : String(error),
});

export class TypedEventBus<M extends EventMap> {
  readonly #subscriptions = new Map<EventName<M>, Set<Subscription<unknown>>>();
  readonly #queue: Array<EventEnvelope<string, unknown>> = [];
  readonly #maxQueue: number;
  readonly #maxListeners: number;
  readonly #now: () => number;
  readonly #idFactory: (sequence: number) => string;
  readonly #onError?: TypedEventBusOptions['onError'];
  #sequence = 0;
  #emitted = 0;
  #delivered = 0;
  #failed = 0;
  #dropped = 0;
  #processing = false;
  #disposed = false;

  constructor(options: TypedEventBusOptions = {}) {
    this.#maxQueue = Math.max(1, Math.floor(options.maxQueue ?? 512));
    this.#maxListeners = Math.max(1, Math.floor(options.maxListenersPerEvent ?? 128));
    this.#now = options.now ?? (() => performance.now());
    this.#idFactory = options.idFactory ?? ((sequence) => `evt_${sequence.toString(36)}`);
    this.#onError = options.onError;
  }

  on<K extends EventName<M>>(name: K, handler: EventHandler<M[K]>): Unsubscribe {
    return this.#subscribe(name, handler as EventHandler<unknown>, false);
  }

  once<K extends EventName<M>>(name: K, handler: EventHandler<M[K]>): Unsubscribe {
    return this.#subscribe(name, handler as EventHandler<unknown>, true);
  }

  off<K extends EventName<M>>(name: K, handler: EventHandler<M[K]>): boolean {
    const set = this.#subscriptions.get(name);
    if (!set) return false;
    for (const entry of set) {
      if (entry.handler === handler) {
        set.delete(entry);
        if (set.size === 0) this.#subscriptions.delete(name);
        return true;
      }
    }
    return false;
  }

  emit<K extends EventName<M>>(name: K, payload: M[K]): boolean {
    if (this.#disposed) return false;
    const sequence = ++this.#sequence;
    const envelope: EventEnvelope<string, M[K]> = Object.freeze({
      id: this.#idFactory(sequence),
      name,
      sequence,
      emittedAt: safeNumber(this.#now(), sequence),
      payload,
    });
    if (this.#queue.length >= this.#maxQueue) {
      this.#queue.shift();
      this.#dropped += 1;
    }
    this.#queue.push(envelope as EventEnvelope<string, unknown>);
    this.#emitted += 1;
    this.#drain();
    return true;
  }

  emitBatch(events: ReadonlyArray<{ readonly name: EventName<M>; readonly payload: M[EventName<M>] }>): number {
    let accepted = 0;
    for (const event of events) {
      if (this.emit(event.name as EventName<M>, event.payload as M[typeof event.name])) accepted += 1;
    }
    return accepted;
  }

  listenerCount<K extends EventName<M>>(name?: K): number {
    if (name) return this.#subscriptions.get(name)?.size ?? 0;
    let total = 0;
    for (const set of this.#subscriptions.values()) total += set.size;
    return total;
  }

  metrics(): EventBusMetrics {
    return Object.freeze({
      emitted: this.#emitted,
      delivered: this.#delivered,
      failed: this.#failed,
      subscriptions: this.listenerCount(),
      queueDepth: this.#queue.length,
      dropped: this.#dropped,
    });
  }

  clear<K extends EventName<M>>(name?: K): void {
    if (name) this.#subscriptions.delete(name);
    else this.#subscriptions.clear();
  }

  dispose(): void {
    this.#disposed = true;
    this.#queue.length = 0;
    this.#subscriptions.clear();
  }

  #subscribe(name: EventName<M>, handler: EventHandler<unknown>, once: boolean): Unsubscribe {
    if (this.#disposed) return () => undefined;
    let set = this.#subscriptions.get(name);
    if (!set) {
      set = new Set();
      this.#subscriptions.set(name, set);
    }
    if (set.size >= this.#maxListeners) throw new Error(`Listener limit reached for ${name}`);
    const entry: Subscription<unknown> = { handler, once };
    set.add(entry);
    return () => {
      set?.delete(entry);
      if (set && set.size === 0) this.#subscriptions.delete(name);
    };
  }

  #drain(): void {
    if (this.#processing || this.#disposed) return;
    this.#processing = true;
    try {
      while (this.#queue.length && !this.#disposed) {
        const envelope = this.#queue.shift();
        if (!envelope) continue;
        const set = this.#subscriptions.get(envelope.name as EventName<M>);
        if (!set) continue;
        const snapshot = [...set];
        for (const subscription of snapshot) {
          if (!set.has(subscription)) continue;
          try {
            const result = subscription.handler(envelope.payload);
            this.#delivered += 1;
            if (subscription.once) set.delete(subscription);
            if (result && typeof (result as Promise<void>).then === 'function') {
              (result as Promise<void>).catch((error) => this.#handleError(error, envelope));
            }
          } catch (error) {
            this.#handleError(error, envelope);
          }
        }
        if (set.size === 0) this.#subscriptions.delete(envelope.name as EventName<M>);
      }
    } finally {
      this.#processing = false;
    }
  }

  #handleError(error: unknown, envelope: EventEnvelope<string, unknown>): void {
    this.#failed += 1;
    this.#onError?.(createRuntimeError(error), envelope);
  }
}

export type WorldEvents = {
  'world:ready': { readonly revision: number };
  'world:frame': { readonly frame: number; readonly dt: number };
  'world:pause': { readonly reason: string };
  'world:resume': { readonly reason: string };
  'world:save': { readonly revision: number };
  'world:load': { readonly revision: number };
  'kingdom:selected': { readonly kingdomId: string | null };
  'kingdom:updated': { readonly kingdomId: string; readonly revision: number };
  'audio:intent': { readonly cueId: string; readonly category: string };
  'render:quality': { readonly level: number; readonly reason: string };
  'runtime:warning': { readonly code: string; readonly message: string };
  'runtime:error': { readonly code: string; readonly message: string };
};

export type WorldBus = TypedEventBus<WorldEvents>;

export const createWorldBus = (options: TypedEventBusOptions = {}): WorldBus => new TypedEventBus<WorldEvents>({
  maxQueue: 1024,
  maxListenersPerEvent: 256,
  ...options,
});
