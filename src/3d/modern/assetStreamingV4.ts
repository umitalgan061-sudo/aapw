import {
  type AssetDescriptorV4,
  type AssetIdV4,
  type AssetLeaseV4,
  type AssetLoadResultV4,
  type RuntimeErrorV4,
  type OutcomeV4,
  okV4,
  failV4,
  createRuntimeErrorV4,
} from './runtimeContractsV4';

export interface AssetFetcherV4 {
  readonly fetch: (descriptor: AssetDescriptorV4, signal: AbortSignal) => Promise<ArrayBuffer>;
}

export interface AssetCacheV4 {
  readonly get: (id: AssetIdV4) => Promise<ArrayBuffer | null>;
  readonly put: (id: AssetIdV4, bytes: ArrayBuffer) => Promise<void>;
  readonly remove: (id: AssetIdV4) => Promise<void>;
}

export interface AssetStreamOptionsV4 {
  readonly maxQueue?: number;
  readonly maxConcurrent?: number;
  readonly maxCacheBytes?: number;
  readonly leaseMs?: number;
  readonly now?: () => number;
}

export interface AssetQueueItemV4 {
  readonly descriptor: AssetDescriptorV4;
  readonly priority: number;
  readonly sequence: number;
  readonly requestedAt: number;
}

export interface AssetStreamMetricsV4 {
  readonly registered: number;
  readonly queued: number;
  readonly active: number;
  readonly completed: number;
  readonly failed: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly bytesLoaded: number;
  readonly bytesCached: number;
  readonly evictions: number;
}

export interface AssetCatalogV4 {
  readonly descriptors: readonly AssetDescriptorV4[];
  readonly bytes: number;
  readonly required: number;
  readonly optional: number;
}

const safeBytes = (value: number): number => Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
const safePriority = (value: number): number => Number.isFinite(value) ? Math.trunc(value) : 0;
const keyOf = (descriptor: AssetDescriptorV4): string => `${descriptor.id}:${descriptor.digest}`;

export class MemoryAssetCacheV4 implements AssetCacheV4 {
  #items = new Map<AssetIdV4, { readonly data: ArrayBuffer; readonly bytes: number; readonly touchedAt: number }>();
  #now: () => number;
  #maxBytes: number;
  #bytes = 0;

  constructor(maxBytes = 128 * 1024 * 1024, now = () => performance.now()) {
    this.#maxBytes = Math.max(1024, Math.trunc(maxBytes));
    this.#now = now;
  }

  async get(id: AssetIdV4): Promise<ArrayBuffer | null> {
    const item = this.#items.get(id);
    if (!item) return null;
    this.#items.set(id, { ...item, touchedAt: this.#now() });
    return item.data.slice(0);
  }

  async put(id: AssetIdV4, bytes: ArrayBuffer): Promise<void> {
    const copy = bytes.slice(0);
    const old = this.#items.get(id);
    if (old) this.#bytes -= old.bytes;
    this.#items.set(id, { data: copy, bytes: copy.byteLength, touchedAt: this.#now() });
    this.#bytes += copy.byteLength;
    this.#evict();
  }

  async remove(id: AssetIdV4): Promise<void> {
    const old = this.#items.get(id);
    if (!old) return;
    this.#items.delete(id);
    this.#bytes -= old.bytes;
  }

  get bytes(): number { return this.#bytes; }
  get size(): number { return this.#items.size; }

  #evict(): void {
    while (this.#bytes > this.#maxBytes && this.#items.size > 0) {
      let candidate: AssetIdV4 | null = null;
      let oldest = Number.POSITIVE_INFINITY;
      for (const [id, item] of this.#items) {
        if (item.touchedAt < oldest) {
          oldest = item.touchedAt;
          candidate = id;
        }
      }
      if (candidate === null) break;
      const entry = this.#items.get(candidate);
      this.#items.delete(candidate);
      this.#bytes -= entry?.bytes ?? 0;
    }
  }
}

export class AssetStreamingV4 {
  readonly maxQueue: number;
  readonly maxConcurrent: number;
  readonly maxCacheBytes: number;
  readonly leaseMs: number;
  #now: () => number;
  #fetcher: AssetFetcherV4;
  #cache: AssetCacheV4;
  #catalog = new Map<AssetIdV4, AssetDescriptorV4>();
  #queue: AssetQueueItemV4[] = [];
  #leases = new Map<AssetIdV4, AssetLeaseV4>();
  #controllers = new Map<AssetIdV4, AbortController>();
  #active = 0;
  #sequence = 0;
  #generation = new Map<AssetIdV4, number>();
  #metrics = { registered: 0, queued: 0, active: 0, completed: 0, failed: 0, cacheHits: 0, cacheMisses: 0, bytesLoaded: 0, bytesCached: 0, evictions: 0 };

  constructor(fetcher: AssetFetcherV4, cache: AssetCacheV4 = new MemoryAssetCacheV4(), options: AssetStreamOptionsV4 = {}) {
    this.#fetcher = fetcher;
    this.#cache = cache;
    this.maxQueue = Math.max(16, Math.trunc(options.maxQueue ?? 2048));
    this.maxConcurrent = Math.max(1, Math.trunc(options.maxConcurrent ?? 8));
    this.maxCacheBytes = Math.max(1024, Math.trunc(options.maxCacheBytes ?? 128 * 1024 * 1024));
    this.leaseMs = Math.max(100, Math.trunc(options.leaseMs ?? 30_000));
    this.#now = options.now ?? (() => performance.now());
  }

  register(descriptor: AssetDescriptorV4): OutcomeV4<AssetDescriptorV4> {
    if (!descriptor.id || !descriptor.url) return failV4(createRuntimeErrorV4('ASSET_DESCRIPTOR_INVALID', 'Asset descriptor is incomplete', false));
    const normalized: AssetDescriptorV4 = Object.freeze({
      ...descriptor,
      bytes: safeBytes(descriptor.bytes),
      priority: safePriority(descriptor.priority),
      optional: Boolean(descriptor.optional),
      digest: descriptor.digest.trim().toLowerCase(),
    });
    this.#catalog.set(descriptor.id, normalized);
    this.#metrics.registered = this.#catalog.size;
    return okV4(normalized);
  }

  unregister(id: AssetIdV4): boolean {
    this.cancel(id);
    this.#catalog.delete(id);
    this.#generation.delete(id);
    this.#leases.delete(id);
    this.#metrics.registered = this.#catalog.size;
    return true;
  }

  request(id: AssetIdV4, priority = 0): OutcomeV4<number> {
    const descriptor = this.#catalog.get(id);
    if (!descriptor) return failV4(createRuntimeErrorV4('ASSET_UNKNOWN', `Unknown asset: ${id}`, false));
    if (this.#queue.length >= this.maxQueue) {
      const lowest = this.#findLowestPriority();
      if (lowest < 0 || this.#queue[lowest]!.priority >= priority) return failV4(createRuntimeErrorV4('ASSET_QUEUE_FULL', 'Asset queue is full', true));
      this.#queue.splice(lowest, 1);
      this.#metrics.evictions += 1;
    }
    const item: AssetQueueItemV4 = Object.freeze({ descriptor, priority: safePriority(priority), sequence: this.#sequence++, requestedAt: this.#now() });
    this.#queue.push(item);
    this.#sortQueue();
    this.#metrics.queued = this.#queue.length;
    void this.pump();
    return okV4(this.#queue.length);
  }

  cancel(id: AssetIdV4): boolean {
    const before = this.#queue.length;
    this.#queue = this.#queue.filter((item) => item.descriptor.id !== id);
    this.#controllers.get(id)?.abort('cancelled');
    this.#controllers.delete(id);
    this.#metrics.queued = this.#queue.length;
    return before !== this.#queue.length;
  }

  async acquire(id: AssetIdV4): Promise<OutcomeV4<AssetLeaseV4>> {
    const descriptor = this.#catalog.get(id);
    if (!descriptor) return failV4(createRuntimeErrorV4('ASSET_UNKNOWN', 'Asset is not registered', false));
    const current = this.#leases.get(id);
    if (current && current.expiresAt > this.#now()) return okV4(current);
    const generation = (this.#generation.get(id) ?? 0) + 1;
    this.#generation.set(id, generation);
    const now = this.#now();
    const lease: AssetLeaseV4 = Object.freeze({ id, generation, acquiredAt: now, expiresAt: now + this.leaseMs });
    this.#leases.set(id, lease);
    return okV4(lease);
  }

  release(id: AssetIdV4, generation: number): boolean {
    const lease = this.#leases.get(id);
    if (!lease || lease.generation !== generation) return false;
    this.#leases.delete(id);
    return true;
  }

  async load(id: AssetIdV4, priority = 0): Promise<AssetLoadResultV4> {
    const descriptor = this.#catalog.get(id);
    const started = this.#now();
    if (!descriptor) return { id, accepted: false, fromCache: false, bytes: 0, durationMs: 0, lease: null, error: createRuntimeErrorV4('ASSET_UNKNOWN', 'Asset is not registered', false) };
    const cached = await this.#cache.get(id);
    if (cached) {
      this.#metrics.cacheHits += 1;
      this.#metrics.completed += 1;
      this.#metrics.bytesLoaded += cached.byteLength;
      const lease = (await this.acquire(id)).ok ? (await this.acquire(id)).value : null;
      return { id, accepted: true, fromCache: true, bytes: cached.byteLength, durationMs: Math.max(0, this.#now() - started), lease, error: null };
    }
    this.#metrics.cacheMisses += 1;
    const queued = this.request(id, priority);
    if (!queued.ok) return { id, accepted: false, fromCache: false, bytes: 0, durationMs: Math.max(0, this.#now() - started), lease: null, error: queued.error };
    while (this.#active > 0 || this.#queue.some((item) => item.descriptor.id === id)) {
      await Promise.resolve();
      if (!this.#queue.some((item) => item.descriptor.id === id) && !this.#controllers.has(id)) break;
    }
    const after = await this.#cache.get(id);
    if (!after) return { id, accepted: false, fromCache: false, bytes: 0, durationMs: Math.max(0, this.#now() - started), lease: null, error: createRuntimeErrorV4('ASSET_LOAD_FAILED', 'Asset did not become available', true) };
    const leaseOutcome = await this.acquire(id);
    return { id, accepted: true, fromCache: false, bytes: after.byteLength, durationMs: Math.max(0, this.#now() - started), lease: leaseOutcome.ok ? leaseOutcome.value : null, error: null };
  }

  async pump(): Promise<number> {
    let started = 0;
    while (this.#active < this.maxConcurrent && this.#queue.length > 0) {
      const next = this.#queue.shift();
      if (!next) break;
      this.#metrics.queued = this.#queue.length;
      this.#active += 1;
      this.#metrics.active = this.#active;
      started += 1;
      void this.#run(next).finally(() => {
        this.#active = Math.max(0, this.#active - 1);
        this.#metrics.active = this.#active;
        void this.pump();
      });
    }
    return started;
  }

  queue(): readonly AssetQueueItemV4[] {
    return Object.freeze(this.#queue.slice());
  }

  catalog(): AssetCatalogV4 {
    const descriptors = Object.freeze([...this.#catalog.values()].sort((a, b) => b.priority - a.priority || String(a.id).localeCompare(String(b.id))));
    return Object.freeze({ descriptors, bytes: descriptors.reduce((sum, item) => sum + item.bytes, 0), required: descriptors.filter((item) => !item.optional).length, optional: descriptors.filter((item) => item.optional).length });
  }

  lease(id: AssetIdV4): AssetLeaseV4 | null {
    const lease = this.#leases.get(id);
    if (!lease || lease.expiresAt <= this.#now()) {
      this.#leases.delete(id);
      return null;
    }
    return lease;
  }

  metrics(): AssetStreamMetricsV4 {
    return Object.freeze({ ...this.#metrics, queued: this.#queue.length, active: this.#active, registered: this.#catalog.size });
  }

  abortAll(): number {
    let count = 0;
    for (const controller of this.#controllers.values()) {
      controller.abort('shutdown');
      count += 1;
    }
    this.#controllers.clear();
    this.#queue.length = 0;
    this.#metrics.queued = 0;
    return count;
  }

  #sortQueue(): void {
    this.#queue.sort((a, b) => b.priority - a.priority || a.sequence - b.sequence);
  }

  #findLowestPriority(): number {
    if (this.#queue.length === 0) return -1;
    let index = 0;
    for (let cursor = 1; cursor < this.#queue.length; cursor += 1) {
      const current = this.#queue[cursor]!;
      const candidate = this.#queue[index]!;
      if (current.priority < candidate.priority || (current.priority === candidate.priority && current.sequence < candidate.sequence)) index = cursor;
    }
    return index;
  }

  async #run(item: AssetQueueItemV4): Promise<void> {
    const id = item.descriptor.id;
    const controller = new AbortController();
    this.#controllers.set(id, controller);
    try {
      const bytes = await this.#fetcher.fetch(item.descriptor, controller.signal);
      if (bytes.byteLength !== item.descriptor.bytes) throw new Error('Asset byte size mismatch');
      await this.#cache.put(id, bytes);
      this.#metrics.completed += 1;
      this.#metrics.bytesLoaded += bytes.byteLength;
      this.#metrics.bytesCached += bytes.byteLength;
    } catch (cause) {
      this.#metrics.failed += 1;
      const error: RuntimeErrorV4 = createRuntimeErrorV4('ASSET_FETCH_FAILED', cause instanceof Error ? cause.message.slice(0, 300) : 'Asset fetch failed', true);
      void error;
    } finally {
      this.#controllers.delete(id);
    }
  }
}

export function assetStreamingErrorV4(cause: unknown): RuntimeErrorV4 {
  return createRuntimeErrorV4('ASSET_STREAMING', cause instanceof Error ? cause.message : 'Asset streaming error', true);
}

export function descriptorKeyV4(descriptor: AssetDescriptorV4): string {
  return keyOf(descriptor);
}
