import type { Disposable } from './coreTypes.js';

export interface RuntimeEvent<T = unknown> { readonly id: number; readonly tick: number; readonly type: string; readonly payload: T; readonly emittedAt: number; }
export interface EventSubscription<T = unknown> { readonly id: number; readonly type: string; readonly handler: (event: RuntimeEvent<T>) => void; readonly once: boolean; }
export interface EventStats { readonly queued: number; readonly published: number; readonly delivered: number; readonly dropped: number; readonly subscribers: number; }

export class EventRuntime implements Disposable {
  #queue: RuntimeEvent[] = [];
  #subscriptions = new Map<number, EventSubscription>();
  #sequence = 1;
  #subscriptionSequence = 1;
  #maxQueue: number;
  #published = 0;
  #delivered = 0;
  #dropped = 0;
  #now: () => number;
  #disposed = false;
  constructor(maxQueue = 4096, now: () => number = () => typeof performance !== 'undefined' ? performance.now() : Date.now()) { this.#maxQueue = Math.max(32, Math.trunc(maxQueue)); this.#now = now; }
  publish<T>(type: string, payload: T, tick: number): boolean { if (this.#disposed || !type || this.#queue.length >= this.#maxQueue) { this.#dropped += 1; return false; } this.#queue.push(Object.freeze({ id: this.#sequence++, tick: Math.max(0, Math.trunc(tick)), type, payload, emittedAt: this.#now() })); this.#published += 1; return true; }
  subscribe<T>(type: string, handler: (event: RuntimeEvent<T>) => void, once = false): number { if (this.#disposed || !type || this.#subscriptions.size >= 2048) return 0; const id = this.#subscriptionSequence++; this.#subscriptions.set(id, Object.freeze({ id, type, handler: handler as (event: RuntimeEvent<unknown>) => void, once })); return id; }
  unsubscribe(id: number): boolean { return this.#subscriptions.delete(id); }
  flush(maxEvents = 512): number { if (this.#disposed) return 0; let delivered = 0; while (this.#queue.length && delivered < maxEvents) { const event = this.#queue.shift()!; const matching = [...this.#subscriptions.values()].filter(subscription => subscription.type === event.type || subscription.type === '*').sort((a, b) => a.id - b.id); for (const subscription of matching) { try { subscription.handler(event); this.#delivered += 1; delivered += 1; } catch { this.#dropped += 1; } if (subscription.once) this.#subscriptions.delete(subscription.id); } } return delivered; }
  queue(): readonly RuntimeEvent[] { return Object.freeze(this.#queue.slice()); }
  stats(): EventStats { return Object.freeze({ queued: this.#queue.length, published: this.#published, delivered: this.#delivered, dropped: this.#dropped, subscribers: this.#subscriptions.size }); }
  clear(): void { this.#queue.length = 0; }
  dispose(): void { this.#disposed = true; this.#queue.length = 0; this.#subscriptions.clear(); }
}
