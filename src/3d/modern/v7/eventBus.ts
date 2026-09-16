import { asTick, digest, stableSort, type Disposable, type Tick, type V7Result } from './primitives.js';

export interface V7Event<T = unknown> { readonly type: string; readonly tick: Tick; readonly serial: number; readonly source: string; readonly payload: T; readonly digest: string; }
export interface EventFilter { readonly type?: string; readonly source?: string; readonly afterSerial?: number; readonly beforeTick?: Tick; }
export interface EventBusOptions { readonly historyLimit?: number; readonly subscriberLimit?: number; readonly payloadBytes?: number; }

type Handler<T> = (event: V7Event<T>) => void;

function estimateBytes(value: unknown): number { try { return JSON.stringify(value)?.length ?? 0; } catch { return Number.POSITIVE_INFINITY; } }

export class DeterministicEventBus implements Disposable {
  readonly historyLimit: number;
  readonly subscriberLimit: number;
  readonly payloadBytes: number;
  #serial = 0;
  #history: V7Event[] = [];
  #subscriptions = new Map<string, Set<Handler>>();
  #disposed = false;

  constructor(options: EventBusOptions = {}) {
    this.historyLimit = Math.max(16, Math.min(4096, Math.trunc(options.historyLimit ?? 512)));
    this.subscriberLimit = Math.max(8, Math.min(1024, Math.trunc(options.subscriberLimit ?? 128)));
    this.payloadBytes = Math.max(256, Math.min(1_048_576, Math.trunc(options.payloadBytes ?? 65_536)));
  }

  publish<T>(type: string, tick: Tick, source: string, payload: T): V7Result<V7Event<T>> {
    if (this.#disposed) return { ok: false, code: 'EVENTS_DISPOSED', message: 'Event bus is disposed', retryable: false };
    if (!type || type.length > 128 || !source || source.length > 128) return { ok: false, code: 'EVENT_INVALID', message: 'Event type/source is invalid', retryable: false };
    if (estimateBytes(payload) > this.payloadBytes) return { ok: false, code: 'EVENT_PAYLOAD_LIMIT', message: 'Event payload exceeds the byte limit', retryable: false };
    this.#serial += 1;
    const event = Object.freeze({ type, tick, serial: this.#serial, source, payload, digest: digest(type, tick, this.#serial, source, payload) });
    this.#history.push(event); if (this.#history.length > this.historyLimit) this.#history.shift();
    this.#dispatch(event);
    return { ok: true, value: event };
  }

  subscribe<T = unknown>(type: string, handler: Handler<T>): V7Result<() => void> {
    if (this.#disposed) return { ok: false, code: 'EVENTS_DISPOSED', message: 'Event bus is disposed', retryable: false };
    if (!type || typeof handler !== 'function') return { ok: false, code: 'SUBSCRIPTION_INVALID', message: 'Subscription is invalid', retryable: false };
    const total = [...this.#subscriptions.values()].reduce((sum, set) => sum + set.size, 0);
    if (total >= this.subscriberLimit) return { ok: false, code: 'SUBSCRIBER_LIMIT', message: 'Subscriber limit exceeded', retryable: true };
    const set = this.#subscriptions.get(type) ?? new Set<Handler>(); set.add(handler as Handler); this.#subscriptions.set(type, set);
    return { ok: true, value: () => { set.delete(handler as Handler); if (!set.size) this.#subscriptions.delete(type); } };
  }

  query(filter: EventFilter = {}): readonly V7Event[] {
    if (this.#disposed) return [];
    return Object.freeze(this.#history.filter((event) =>
      (!filter.type || event.type === filter.type) &&
      (!filter.source || event.source === filter.source) &&
      (filter.afterSerial === undefined || event.serial > filter.afterSerial) &&
      (filter.beforeTick === undefined || event.tick < filter.beforeTick),
    ));
  }

  replay(handler: Handler, filter: EventFilter = {}): number {
    const events = stableSort(this.query(filter), (a, b) => a.tick - b.tick || a.serial - b.serial);
    for (const event of events) { try { handler(event); } catch { /* replay isolation */ } }
    return events.length;
  }

  serial(): number { return this.#serial; }
  history(): readonly V7Event[] { return Object.freeze([...this.#history]); }
  clearHistory(): void { this.#history.length = 0; }
  dispose(): void { this.#disposed = true; this.#history.length = 0; this.#subscriptions.clear(); }

  #dispatch(event: V7Event): void {
    const handlers = [...(this.#subscriptions.get(event.type) ?? []), ...(this.#subscriptions.get('*') ?? [])];
    for (const handler of handlers) { try { handler(event); } catch { /* consumer failures never stop the producer */ } }
  }
}
