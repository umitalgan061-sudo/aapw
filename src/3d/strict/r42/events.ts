/**
 * Bounded deterministic event bus for R42.
 * Production TypeScript owner.
 */
import type { RuntimeEvent } from './types.ts';
import { deepFreeze, safeInteger } from './types.ts';

export type EventPayload = Readonly<Record<string, unknown>>;
export type EventType = RuntimeEvent['type'] | 'custom';

export interface RuntimeBusEvent {
  readonly type: EventType;
  readonly tick: number;
  readonly sequence: number;
  readonly payload: EventPayload;
}

export interface EventSubscription {
  readonly id: string;
  readonly type: EventType | '*';
  readonly callback: (event: RuntimeBusEvent) => void;
}

export class RuntimeEventBusR42 {
  readonly maxQueue: number;
  readonly maxSubscriptions: number;
  #queue: RuntimeBusEvent[] = [];
  #subscriptions = new Map<string, EventSubscription>();
  #sequence = 0;

  constructor(maxQueue = 1024, maxSubscriptions = 256) {
    this.maxQueue = Math.max(16, Math.trunc(maxQueue));
    this.maxSubscriptions = Math.max(1, Math.trunc(maxSubscriptions));
  }

  subscribe(type: EventSubscription['type'], callback: EventSubscription['callback'], id?: string): () => void {
    if (this.#subscriptions.size >= this.maxSubscriptions) throw new Error('R42 event subscription capacity exhausted.');
    const subscriptionId = (id ?? 'sub') + ':' + (this.#subscriptions.size + 1);
    this.#subscriptions.set(subscriptionId, Object.freeze({
      id: subscriptionId,
      type,
      callback,
    }));
    return () => { this.#subscriptions.delete(subscriptionId); };
  }

  publish(type: EventType, tick: number, payload: EventPayload = {}): RuntimeBusEvent {
    this.#sequence += 1;
    const event = deepFreeze({
      type,
      tick: Math.max(0, safeInteger(tick)),
      sequence: this.#sequence,
      payload: Object.freeze({ ...payload }),
    });
    if (this.#queue.length >= this.maxQueue) {
      this.#queue.shift();
    }
    this.#queue.push(event);
    for (const subscription of this.#subscriptions.values()) {
      if (subscription.type === '*' || subscription.type === type) subscription.callback(event);
    }
    return event;
  }

  drain(max = this.maxQueue): readonly RuntimeBusEvent[] {
    const count = Math.max(0, Math.trunc(max));
    return Object.freeze(this.#queue.splice(0, count));
  }

  peek(): readonly RuntimeBusEvent[] {
    return Object.freeze([...this.#queue]);
  }

  clear(): void {
    this.#queue = [];
  }

  snapshot(): Readonly<{
    queued: number;
    subscriptions: number;
    sequence: number;
  }> {
    return Object.freeze({
      queued: this.#queue.length,
      subscriptions: this.#subscriptions.size,
      sequence: this.#sequence,
    });
  }
}
