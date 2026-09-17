import type { EventHandlerP, EventKeyP, EventSinkP, ProductionEventMapP } from './contracts.ts';

interface Bucket<K extends EventKeyP> {
  readonly handlers: Set<EventHandlerP<K>>;
  queued: ProductionEventMapP[K][];
  dispatching: boolean;
}

export interface EventHubStatsP {
  readonly listeners: number;
  readonly queued: number;
  readonly emitted: number;
  readonly dropped: number;
  readonly peakQueue: number;
}

export interface EventHubConfigP {
  readonly maxQueuePerEvent: number;
  readonly maxListenersPerEvent: number;
}

const DEFAULTS: EventHubConfigP = Object.freeze({ maxQueuePerEvent: 256, maxListenersPerEvent: 128 });

export class ProductionEventHub implements EventSinkP {
  readonly #config: EventHubConfigP;
  readonly #buckets = new Map<EventKeyP, Bucket<EventKeyP>>();
  #emitted = 0;
  #dropped = 0;
  #peakQueue = 0;

  constructor(config: Partial<EventHubConfigP> = {}) {
    this.#config = Object.freeze({
      maxQueuePerEvent: Math.max(8, Math.trunc(config.maxQueuePerEvent ?? DEFAULTS.maxQueuePerEvent)),
      maxListenersPerEvent: Math.max(1, Math.trunc(config.maxListenersPerEvent ?? DEFAULTS.maxListenersPerEvent)),
    });
  }

  on<K extends EventKeyP>(event: K, handler: EventHandlerP<K>): () => void {
    const bucket = this.#getBucket(event);
    if (bucket.handlers.size >= this.#config.maxListenersPerEvent) throw new Error(`event listener budget exceeded: ${String(event)}`);
    bucket.handlers.add(handler as EventHandlerP<EventKeyP>);
    return () => bucket.handlers.delete(handler as EventHandlerP<EventKeyP>);
  }

  once<K extends EventKeyP>(event: K, handler: EventHandlerP<K>): () => void {
    let unsubscribe: (() => void) | undefined;
    unsubscribe = this.on(event, (payload) => {
      unsubscribe?.();
      handler(payload);
    });
    return () => unsubscribe?.();
  }

  emit<K extends EventKeyP>(event: K, payload: ProductionEventMapP[K]): void {
    const bucket = this.#getBucket(event);
    this.#emitted += 1;
    if (bucket.dispatching || bucket.queued.length > 0) {
      if (bucket.queued.length >= this.#config.maxQueuePerEvent) {
        bucket.queued.shift();
        this.#dropped += 1;
      }
      bucket.queued.push(payload);
      this.#peakQueue = Math.max(this.#peakQueue, bucket.queued.length);
      if (!bucket.dispatching) this.#drain(event, bucket);
      return;
    }
    bucket.dispatching = true;
    try {
      for (const handler of [...bucket.handlers]) handler(payload as never);
    } finally {
      bucket.dispatching = false;
      this.#drain(event, bucket);
    }
  }

  clear(event?: EventKeyP): void {
    if (event) {
      const bucket = this.#buckets.get(event);
      if (bucket) { bucket.handlers.clear(); bucket.queued.length = 0; }
      return;
    }
    for (const bucket of this.#buckets.values()) { bucket.handlers.clear(); bucket.queued.length = 0; }
  }

  stats(): EventHubStatsP {
    let listeners = 0;
    let queued = 0;
    for (const bucket of this.#buckets.values()) { listeners += bucket.handlers.size; queued += bucket.queued.length; }
    return Object.freeze({ listeners, queued, emitted: this.#emitted, dropped: this.#dropped, peakQueue: this.#peakQueue });
  }

  listenerCount(event?: EventKeyP): number {
    if (event) return this.#buckets.get(event)?.handlers.size ?? 0;
    return this.stats().listeners;
  }

  #getBucket<K extends EventKeyP>(event: K): Bucket<K> {
    const existing = this.#buckets.get(event) as Bucket<K> | undefined;
    if (existing) return existing;
    const bucket: Bucket<K> = { handlers: new Set<EventHandlerP<K>>(), queued: [], dispatching: false };
    this.#buckets.set(event, bucket as Bucket<EventKeyP>);
    return bucket;
  }

  #drain<K extends EventKeyP>(event: K, bucket: Bucket<K>): void {
    while (bucket.queued.length > 0 && !bucket.dispatching) {
      const payload = bucket.queued.shift()!;
      bucket.dispatching = true;
      try {
        for (const handler of [...bucket.handlers]) handler(payload);
      } finally {
        bucket.dispatching = false;
      }
    }
    if (bucket.handlers.size === 0 && bucket.queued.length === 0) this.#buckets.delete(event);
  }
}
