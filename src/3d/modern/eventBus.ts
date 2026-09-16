import type { Disposable, EventHandler, EventName, RuntimeEventMap, RuntimeError, Result } from './types';
import { err, ok } from './types';

export interface EventBusOptions {
  readonly captureErrors?: boolean;
  readonly maxListenersPerEvent?: number;
}

type Listener<K extends EventName> = {
  readonly id: number;
  readonly handler: EventHandler<K>;
  readonly once: boolean;
  active: boolean;
};

/**
 * Deterministic, mutation-safe event bus used by the modern runtime.
 *
 * Listener snapshots are taken before delivery, so adding/removing handlers
 * during an event never changes the current delivery set. Handler exceptions
 * are isolated and optionally returned to the runtime error channel.
 */
export class EventBus implements Disposable {
  private readonly options: Required<EventBusOptions>;
  private readonly listeners = new Map<EventName, Listener<any>[]>();
  private nextId = 1;
  private disposed = false;
  private dispatchDepth = 0;
  private deferredCompaction = false;

  public constructor(options: EventBusOptions = {}) {
    this.options = {
      captureErrors: options.captureErrors ?? true,
      maxListenersPerEvent: options.maxListenersPerEvent ?? 256,
    };
  }

  public on<K extends EventName>(name: K, handler: EventHandler<K>): Disposable {
    return this.add(name, handler, false);
  }

  public once<K extends EventName>(name: K, handler: EventHandler<K>): Disposable {
    return this.add(name, handler, true);
  }

  private add<K extends EventName>(name: K, handler: EventHandler<K>, once: boolean): Disposable {
    if (this.disposed) throw new Error('EVENT_BUS_DISPOSED');
    if (typeof handler !== 'function') throw new TypeError('EVENT_HANDLER_REQUIRED');
    const bucket = this.listeners.get(name) ?? [];
    if (bucket.length >= this.options.maxListenersPerEvent) {
      throw new Error(`EVENT_LISTENER_LIMIT:${String(name)}`);
    }
    const entry: Listener<K> = { id: this.nextId++, handler, once, active: true };
    bucket.push(entry);
    this.listeners.set(name, bucket);
    return { dispose: () => this.removeEntry(name, entry.id) };
  }

  public emit<K extends EventName>(name: K, payload: RuntimeEventMap[K]): Result<number, RuntimeError> {
    if (this.disposed) return err(this.runtimeError('EVENT_BUS_DISPOSED', 'event bus is disposed'));
    const bucket = this.listeners.get(name);
    if (!bucket || bucket.length === 0) return ok(0);
    const snapshot = bucket.filter((listener) => listener.active);
    let delivered = 0;
    this.dispatchDepth += 1;
    try {
      for (const listener of snapshot) {
        if (!listener.active) continue;
        if (listener.once) listener.active = false;
        try {
          listener.handler(payload);
          delivered += 1;
        } catch (cause) {
          if (!this.options.captureErrors) throw cause;
          return err(this.runtimeError('EVENT_HANDLER_FAILED', `handler failed for ${String(name)}`, cause));
        }
      }
    } finally {
      this.dispatchDepth -= 1;
      if (this.dispatchDepth === 0 && this.deferredCompaction) this.compact();
    }
    if (bucket.some((listener) => !listener.active)) this.deferredCompaction = true;
    return ok(delivered);
  }

  public listenerCount(name?: EventName): number {
    if (name) return (this.listeners.get(name) ?? []).filter((listener) => listener.active).length;
    let total = 0;
    for (const bucket of this.listeners.values()) total += bucket.filter((listener) => listener.active).length;
    return total;
  }

  public removeAll(name?: EventName): void {
    if (name) {
      const bucket = this.listeners.get(name);
      if (!bucket) return;
      bucket.forEach((listener) => { listener.active = false; });
      this.deferredCompaction = true;
      if (this.dispatchDepth === 0) this.compact();
      return;
    }
    for (const bucket of this.listeners.values()) bucket.forEach((listener) => { listener.active = false; });
    this.deferredCompaction = true;
    if (this.dispatchDepth === 0) this.compact();
  }

  private removeEntry(name: EventName, id: number): void {
    const bucket = this.listeners.get(name);
    if (!bucket) return;
    const found = bucket.find((listener) => listener.id === id);
    if (!found) return;
    found.active = false;
    this.deferredCompaction = true;
    if (this.dispatchDepth === 0) this.compact();
  }

  private compact(): void {
    for (const [name, bucket] of this.listeners) {
      const active = bucket.filter((listener) => listener.active);
      if (active.length === 0) this.listeners.delete(name);
      else this.listeners.set(name, active);
    }
    this.deferredCompaction = false;
  }

  private runtimeError(code: string, message: string, cause?: unknown): RuntimeError {
    return { code, message, recoverable: true, cause };
  }

  public dispose(): void {
    if (this.disposed) return;
    this.removeAll();
    this.listeners.clear();
    this.disposed = true;
  }
}

export interface DeterministicRandom {
  next(): number;
  integer(minInclusive: number, maxInclusive: number): number;
  pick<T>(values: readonly T[]): T;
  fork(salt: number): DeterministicRandom;
  state(): number;
}

/** Small deterministic PRNG: stable across browsers and workers. */
export class XorShift32 implements DeterministicRandom {
  private value: number;

  public constructor(seed = 0x9e3779b9) {
    this.value = seed >>> 0 || 0x6d2b79f5;
  }

  public next(): number {
    let x = this.value >>> 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.value = x >>> 0;
    return this.value / 0x1_0000_0000;
  }

  public integer(minInclusive: number, maxInclusive: number): number {
    if (!Number.isInteger(minInclusive) || !Number.isInteger(maxInclusive) || minInclusive > maxInclusive) {
      throw new RangeError('INVALID_RANDOM_RANGE');
    }
    return minInclusive + Math.floor(this.next() * (maxInclusive - minInclusive + 1));
  }

  public pick<T>(values: readonly T[]): T {
    if (values.length === 0) throw new RangeError('EMPTY_RANDOM_PICK');
    return values[this.integer(0, values.length - 1)] as T;
  }

  public fork(salt: number): DeterministicRandom {
    const mixed = Math.imul(this.value ^ (salt | 0), 0x45d9f3b) >>> 0;
    const child = new XorShift32(mixed ^ (mixed >>> 16));
    child.next();
    return child;
  }

  public state(): number {
    return this.value >>> 0;
  }
}

export const stableHash = (value: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

export const stableHashObject = (value: unknown): number => {
  const normalized = JSON.stringify(value, (_key, child) => {
    if (!child || typeof child !== 'object' || Array.isArray(child)) return child;
    return Object.keys(child).sort().reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = (child as Record<string, unknown>)[key];
      return acc;
    }, {});
  });
  return stableHash(normalized ?? 'null');
};
