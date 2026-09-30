import type { RuntimeEventR31, RuntimeSubscriptionR31 } from './applicationTypesR31.ts';

type Handler<T> = (event: RuntimeEventR31<T>) => void;

interface Bucket<T> {
  readonly handlers: Map<number, Handler<T>>;
  nextId: number;
}

export interface EventBusDiagnosticsR31 {
  readonly emitted: number;
  readonly delivered: number;
  readonly dropped: number;
  readonly listeners: number;
  readonly eventTypes: number;
}

export class EventBusR31 {
  readonly #buckets = new Map<string, Bucket<unknown>>();
  #sequence = 0;
  #emitted = 0;
  #delivered = 0;
  #dropped = 0;
  #disposed = false;
  #maxEventsPerTick: number;
  #eventsThisTick = 0;
  #currentTick = 0;

  constructor(maxEventsPerTick = 512) {
    if (!Number.isInteger(maxEventsPerTick) || maxEventsPerTick < 1) {
      throw new Error('maxEventsPerTick must be a positive integer');
    }
    this.#maxEventsPerTick = maxEventsPerTick;
  }

  setTick(tick: number): void {
    if (!Number.isFinite(tick) || tick < 0) return;
    if (tick !== this.#currentTick) {
      this.#currentTick = Math.floor(tick);
      this.#eventsThisTick = 0;
    }
  }

  on<T>(type: string, handler: Handler<T>): RuntimeSubscriptionR31 {
    if (this.#disposed) throw new Error('EventBusR31 is disposed');
    const normalized = this.#normalize(type);
    let bucket = this.#buckets.get(normalized) as Bucket<T> | undefined;
    if (!bucket) {
      bucket = { handlers: new Map(), nextId: 1 };
      this.#buckets.set(normalized, bucket as Bucket<unknown>);
    }
    const id = bucket.nextId++;
    bucket.handlers.set(id, handler);
    return Object.freeze({
      id,
      dispose: () => {
        bucket?.handlers.delete(id);
      },
    });
  }

  once<T>(type: string, handler: Handler<T>): RuntimeSubscriptionR31 {
    let subscription: RuntimeSubscriptionR31 | null = null;
    subscription = this.on<T>(type, (event) => {
      subscription?.dispose();
      subscription = null;
      handler(event);
    });
    return subscription;
  }

  emit<T>(type: string, payload: T): boolean {
    if (this.#disposed) return false;
    if (this.#eventsThisTick >= this.#maxEventsPerTick) {
      this.#dropped++;
      return false;
    }
    const normalized = this.#normalize(type);
    const bucket = this.#buckets.get(normalized) as Bucket<T> | undefined;
    this.#emitted++;
    this.#eventsThisTick++;
    if (!bucket || bucket.handlers.size === 0) return true;

    const event: RuntimeEventR31<T> = Object.freeze({
      type: normalized,
      payload,
      tick: this.#currentTick,
      sequence: ++this.#sequence,
    });

    for (const handler of [...bucket.handlers.values()]) {
      try {
        handler(event);
        this.#delivered++;
      } catch {
        this.#dropped++;
      }
    }
    return true;
  }

  listenerCount(type?: string): number {
    if (!type) {
      let total = 0;
      for (const bucket of this.#buckets.values()) total += bucket.handlers.size;
      return total;
    }
    return this.#buckets.get(this.#normalize(type))?.handlers.size ?? 0;
  }

  diagnostics(): EventBusDiagnosticsR31 {
    return Object.freeze({
      emitted: this.#emitted,
      delivered: this.#delivered,
      dropped: this.#dropped,
      listeners: this.listenerCount(),
      eventTypes: this.#buckets.size,
    });
  }

  clear(type?: string): void {
    if (!type) {
      for (const bucket of this.#buckets.values()) bucket.handlers.clear();
      return;
    }
    this.#buckets.get(this.#normalize(type))?.handlers.clear();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.clear();
    this.#buckets.clear();
    this.#disposed = true;
  }

  #normalize(type: string): string {
    const normalized = type.trim();
    if (!normalized || normalized.length > 96) throw new Error('Invalid event type');
    return normalized;
  }
}
