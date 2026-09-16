import { tick, type ResourceHandle, type ResourceRecord, type ResourceState, type Tick } from './types.ts';

interface Entry<T> {
  key: string;
  generation: number;
  state: ResourceState;
  value?: T;
  bytes: number;
  lastUsedTick: number;
  pinCount: number;
  promise?: Promise<T>;
  error?: string;
  abort?: AbortController;
}

export interface ResourceLoaderContext { readonly signal: AbortSignal; readonly key: string; readonly generation: number; }
export type ResourceLoader<T> = (context: ResourceLoaderContext) => Promise<{ value: T; bytes?: number }>;

export interface ResourceCacheConfig {
  readonly maxBytes: number;
  readonly maxEntries: number;
  readonly maxConcurrentLoads: number;
}

export interface CacheStats {
  readonly entries: number;
  readonly ready: number;
  readonly pending: number;
  readonly bytes: number;
  readonly pinnedEntries: number;
  readonly evictions: number;
  readonly loadFailures: number;
}

export class ResourceCache<T = unknown> {
  readonly config: ResourceCacheConfig;
  #entries = new Map<string, Entry<T>>();
  #inFlight = 0;
  #evictions = 0;
  #loadFailures = 0;

  constructor(config: ResourceCacheConfig) {
    if (!(config.maxBytes > 0) || !Number.isFinite(config.maxBytes)) throw new RangeError('maxBytes must be positive');
    if (!(config.maxEntries > 0) || !Number.isInteger(config.maxEntries)) throw new RangeError('maxEntries must be a positive integer');
    if (!(config.maxConcurrentLoads > 0) || !Number.isInteger(config.maxConcurrentLoads)) throw new RangeError('maxConcurrentLoads must be a positive integer');
    this.config = { ...config };
  }

  async acquire(key: string, currentTick: Tick, loader: ResourceLoader<T>): Promise<ResourceHandle> {
    const normalized = key.trim();
    if (!normalized) throw new TypeError('resource key is empty');
    let entry = this.#entries.get(normalized);
    if (entry?.state === 'ready') {
      entry.lastUsedTick = currentTick;
      return { key: normalized, generation: entry.generation };
    }
    if (entry?.state === 'pending' && entry.promise) {
      entry.lastUsedTick = currentTick;
      await entry.promise;
      return { key: normalized, generation: entry.generation };
    }
    if (this.#inFlight >= this.config.maxConcurrentLoads) throw new Error('resource load concurrency budget exhausted');

    const generation = (entry?.generation ?? 0) + 1;
    entry?.abort?.abort();
    const abort = new AbortController();
    entry = {
      key: normalized,
      generation,
      state: 'pending',
      bytes: 0,
      lastUsedTick: currentTick,
      pinCount: 0,
      abort,
    };
    this.#entries.set(normalized, entry);
    this.#inFlight += 1;
    const promise = loader({ signal: abort.signal, key: normalized, generation }).then((result) => {
      if (abort.signal.aborted) throw new DOMException('resource load aborted', 'AbortError');
      entry!.state = 'ready';
      entry!.value = result.value;
      entry!.bytes = Math.max(0, result.bytes ?? 0);
      entry!.error = undefined;
      this.#inFlight -= 1;
      this.#enforceLimits();
      return result.value;
    }).catch((error: unknown) => {
      entry!.state = 'failed';
      entry!.error = error instanceof Error ? error.message : String(error);
      entry!.promise = undefined;
      this.#inFlight = Math.max(0, this.#inFlight - 1);
      this.#loadFailures += 1;
      throw error;
    });
    entry.promise = promise;
    await promise;
    return { key: normalized, generation };
  }

  get(handle: ResourceHandle, currentTick: Tick): T | undefined {
    const entry = this.#entries.get(handle.key);
    if (!entry || entry.generation !== handle.generation || entry.state !== 'ready') return undefined;
    entry.lastUsedTick = currentTick;
    return entry.value;
  }

  pin(handle: ResourceHandle): boolean {
    const entry = this.#entries.get(handle.key);
    if (!entry || entry.generation !== handle.generation || entry.state !== 'ready') return false;
    entry.pinCount += 1;
    return true;
  }

  unpin(handle: ResourceHandle): boolean {
    const entry = this.#entries.get(handle.key);
    if (!entry || entry.generation !== handle.generation || entry.pinCount < 1) return false;
    entry.pinCount -= 1;
    return true;
  }

  invalidate(key: string): boolean {
    const entry = this.#entries.get(key);
    if (!entry) return false;
    entry.abort?.abort();
    entry.state = 'disposed';
    entry.value = undefined;
    entry.bytes = 0;
    this.#entries.delete(key);
    return true;
  }

  clearUnpinned(): number {
    let removed = 0;
    for (const [key, entry] of this.#entries) {
      if (entry.pinCount > 0 || entry.state === 'pending') continue;
      this.#entries.delete(key);
      removed += 1;
      this.#evictions += 1;
    }
    return removed;
  }

  records(currentTick: Tick): Array<ResourceRecord<T>> {
    return [...this.#entries.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((entry) => ({
        handle: { key: entry.key, generation: entry.generation },
        state: entry.state,
        value: entry.value,
        bytes: entry.bytes,
        lastUsedTick: tick(Math.min(entry.lastUsedTick, currentTick)),
        pinCount: entry.pinCount,
        error: entry.error,
      }));
  }

  stats(): CacheStats {
    let ready = 0; let pending = 0; let bytes = 0; let pinnedEntries = 0;
    for (const entry of this.#entries.values()) {
      if (entry.state === 'ready') ready += 1;
      if (entry.state === 'pending') pending += 1;
      bytes += entry.bytes;
      if (entry.pinCount > 0) pinnedEntries += 1;
    }
    return { entries: this.#entries.size, ready, pending, bytes, pinnedEntries, evictions: this.#evictions, loadFailures: this.#loadFailures };
  }

  #enforceLimits(): void {
    while (this.stats().entries > this.config.maxEntries || this.stats().bytes > this.config.maxBytes) {
      let victim: Entry<T> | undefined;
      for (const entry of this.#entries.values()) {
        if (entry.state !== 'ready' || entry.pinCount > 0) continue;
        if (!victim || entry.lastUsedTick < victim.lastUsedTick || (entry.lastUsedTick === victim.lastUsedTick && entry.key > victim.key)) victim = entry;
      }
      if (!victim) break;
      this.#entries.delete(victim.key);
      this.#evictions += 1;
    }
  }
}

export function estimateObjectBytes(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'string') return value.length * 2;
  if (typeof value === 'number' || typeof value === 'boolean') return 8;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  try { return JSON.stringify(value).length * 2; } catch { return 0; }
}
