/** Production TypeScript owner for src/3d/eventBus.js. */

export type EventHandler<T = unknown> = (payload: T) => void;

type Handler = EventHandler<unknown>;
type ListenerSet = Set<Handler>;

export class EventBus {
  private readonly _listeners = new Map<string, ListenerSet>();

  on<T = unknown>(eventName: string, handler: EventHandler<T>): () => void {
    let listeners = this._listeners.get(eventName);
    if (!listeners) {
      listeners = new Set<Handler>();
      this._listeners.set(eventName, listeners);
    }
    const wrapped: Handler = (payload) => handler(payload as T);
    listeners.add(wrapped);
    return () => listeners.delete(wrapped);
  }

  once<T = unknown>(eventName: string, handler: EventHandler<T>): () => void {
    let unsubscribe: (() => void) | undefined;
    const wrapped: EventHandler<T> = (payload) => {
      unsubscribe?.();
      handler(payload);
    };
    unsubscribe = this.on(eventName, wrapped);
    return unsubscribe;
  }

  off<T = unknown>(eventName: string, handler: EventHandler<T>): void {
    const listeners = this._listeners.get(eventName);
    if (!listeners) return;
    for (const candidate of listeners) {
      if (candidate === handler || candidate.toString() === handler.toString()) {
        listeners.delete(candidate);
      }
    }
    if (listeners.size === 0) this._listeners.delete(eventName);
  }

  emit<T = unknown>(eventName: string, payload: T): void {
    const listeners = this._listeners.get(eventName);
    if (!listeners) return;
    for (const handler of [...listeners]) {
      try {
        handler(payload);
      } catch (error: unknown) {
        console.error(`[EventBus] listener for "${eventName}" threw:`, error);
      }
    }
  }

  clear(): void {
    this._listeners.clear();
  }
}

export const gameEvents = new EventBus();
