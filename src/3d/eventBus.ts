export type EventPayload = unknown;
export type EventHandler<T = EventPayload> = (payload: T) => void;

export interface EventSubscription {
  readonly event: string;
  readonly unsubscribe: () => void;
}

export interface EventBusDiagnostics {
  readonly eventCount: number;
  readonly listenerCount: number;
  readonly events: readonly { name: string; listeners: number }[];
}

export class EventBus {
  private readonly listeners = new Map<string, Set<EventHandler>>();
  private dispatching = false;
  private disposed = false;

  on<T = EventPayload>(eventName: string, handler: EventHandler<T>): () => void {
    if (this.disposed) throw new Error('EventBus has been disposed');
    if (!eventName.trim()) throw new Error('eventName must not be empty');
    const bucket = this.listeners.get(eventName) ?? new Set<EventHandler>();
    bucket.add(handler as EventHandler);
    this.listeners.set(eventName, bucket);
    return () => { this.off(eventName, handler); };
  }

  once<T = EventPayload>(eventName: string, handler: EventHandler<T>): () => void {
    let unsubscribe: (() => void) | undefined;
    const wrapped: EventHandler<T> = payload => {
      unsubscribe?.();
      handler(payload);
    };
    unsubscribe = this.on(eventName, wrapped);
    return () => unsubscribe?.();
  }

  off<T = EventPayload>(eventName: string, handler: EventHandler<T>): boolean {
    const bucket = this.listeners.get(eventName);
    if (!bucket) return false;
    const removed = bucket.delete(handler as EventHandler);
    if (bucket.size === 0) this.listeners.delete(eventName);
    return removed;
  }

  emit<T = EventPayload>(eventName: string, payload: T): void {
    if (this.disposed) return;
    const bucket = this.listeners.get(eventName);
    if (!bucket) return;
    this.dispatching = true;
    try {
      for (const handler of [...bucket]) {
        try { handler(payload); } catch (error) { console.error(`[EventBus] listener for "${eventName}" threw`, error); }
      }
    } finally {
      this.dispatching = false;
    }
  }

  clear(eventName?: string): void {
    if (eventName === undefined) this.listeners.clear();
    else this.listeners.delete(eventName);
  }

  has(eventName: string): boolean { return (this.listeners.get(eventName)?.size ?? 0) > 0; }

  listenerCount(eventName?: string): number {
    if (eventName !== undefined) return this.listeners.get(eventName)?.size ?? 0;
    let count = 0;
    for (const bucket of this.listeners.values()) count += bucket.size;
    return count;
  }

  diagnostics(): EventBusDiagnostics {
    return Object.freeze({
      eventCount: this.listeners.size,
      listenerCount: this.listenerCount(),
      events: [...this.listeners.entries()]
        .map(([name, listeners]) => ({ name, listeners: listeners.size }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    });
  }

  get isDispatching(): boolean { return this.dispatching; }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
  }
}

export const gameEvents = new EventBus();
