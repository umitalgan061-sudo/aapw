import type { EventMap } from './types';

export type EventKey = keyof EventMap;
export type Handler<K extends EventKey> = (payload: EventMap[K]) => void;
export type Unsubscribe = () => void;

/**
 * Typed synchronous event bus with isolated handler failures and bounded listener growth.
 *
 * The previous JavaScript bus accepted arbitrary strings and `any` payloads. This contract keeps
 * events explicit and serializable while retaining the same simple publish/subscribe semantics.
 */
export class TypedEventBus<Events extends Record<string, unknown> = EventMap> {
  #listeners = new Map<keyof Events, Set<(payload: never) => void>>();
  #maxListeners: number;

  constructor(options: { readonly maxListeners?: number } = {}) {
    this.#maxListeners = Math.max(1, Math.floor(options.maxListeners ?? 128));
  }

  on<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): Unsubscribe {
    const existing = this.#listeners.get(event) ?? new Set<(payload: never) => void>();
    if (!this.#listeners.has(event)) this.#listeners.set(event, existing);
    if (existing.size >= this.#maxListeners) {
      throw new RangeError(`Listener capacity exceeded for event ${String(event)}`);
    }
    const typed = handler as unknown as (payload: never) => void;
    existing.add(typed);
    return () => this.off(event, handler);
  }

  once<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): Unsubscribe {
    const unsubscribe = this.on(event, (payload) => {
      unsubscribe();
      handler(payload);
    });
    return unsubscribe;
  }

  off<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): boolean {
    const listeners = this.#listeners.get(event);
    if (!listeners) return false;
    const removed = listeners.delete(handler as unknown as (payload: never) => void);
    if (listeners.size === 0) this.#listeners.delete(event);
    return removed;
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): number {
    const listeners = this.#listeners.get(event);
    if (!listeners || listeners.size === 0) return 0;
    let delivered = 0;
    for (const handler of [...listeners]) {
      try {
        handler(payload as never);
        delivered += 1;
      } catch (error) {
        console.error(`[TypedEventBus] listener for ${String(event)} failed`, error);
      }
    }
    return delivered;
  }

  count(event?: keyof Events): number {
    if (event !== undefined) return this.#listeners.get(event)?.size ?? 0;
    let count = 0;
    for (const listeners of this.#listeners.values()) count += listeners.size;
    return count;
  }

  clear(event?: keyof Events): void {
    if (event === undefined) this.#listeners.clear();
    else this.#listeners.delete(event);
  }

  snapshot(): ReadonlyMap<keyof Events, number> {
    return new Map([...this.#listeners].map(([event, listeners]) => [event, listeners.size]));
  }
}

export const platformEvents = new TypedEventBus<EventMap>({ maxListeners: 256 });
