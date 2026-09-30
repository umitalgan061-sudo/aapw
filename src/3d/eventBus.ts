/** Strict TypeScript EventBus production owner. */
export type EventHandler<T = unknown> = (payload: T) => void;

type StoredHandler = (payload: unknown) => void;

export class EventBus {
  private readonly _listeners = new Map<string, Set<StoredHandler>>();

  on<T = unknown>(eventName: string, handler: EventHandler<T>): () => void {
    let listeners = this._listeners.get(eventName);
    if (!listeners) {
      listeners = new Set<StoredHandler>();
      this._listeners.set(eventName, listeners);
    }
    const stored = handler as StoredHandler;
    listeners.add(stored);
    return () => {
      listeners?.delete(stored);
      if (listeners?.size === 0) this._listeners.delete(eventName);
    };
  }

  once<T = unknown>(eventName: string, handler: EventHandler<T>): () => void {
    let unsubscribe: (() => void) | undefined;
    const stored: StoredHandler = (payload) => {
      unsubscribe?.();
      handler(payload as T);
    };
    let listeners = this._listeners.get(eventName);
    if (!listeners) {
      listeners = new Set<StoredHandler>();
      this._listeners.set(eventName, listeners);
    }
    listeners.add(stored);
    unsubscribe = () => {
      listeners?.delete(stored);
      if (listeners?.size === 0) this._listeners.delete(eventName);
    };
    return unsubscribe;
  }

  off<T = unknown>(eventName: string, handler: EventHandler<T>): void {
    const listeners = this._listeners.get(eventName);
    if (!listeners) return;
    listeners.delete(handler as StoredHandler);
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
