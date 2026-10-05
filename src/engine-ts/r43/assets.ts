import { stableDigest, type AssetDescriptor, type Result, type WorkPriority } from './contracts.ts';

export interface LoadedAsset<T = unknown> {
  readonly key: string;
  readonly value: T;
  readonly bytes: number;
  readonly loadedAtTick: number;
  readonly lastUsedAtTick: number;
}

export interface AssetProvider<T = unknown> {
  load(descriptor: AssetDescriptor, signal?: AbortSignal): Promise<{ readonly value: T; readonly bytes: number }>;
}

interface CacheEntry<T> extends LoadedAsset<T> {
  touches: number;
}

const PRIORITY_WEIGHT: Record<WorkPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
  background: 4,
};

export class AssetCache<T = unknown> {
  readonly maxBytes: number;
  #entries = new Map<string, CacheEntry<T>>();
  #bytes = 0;

  constructor(maxBytes = 256 * 1024 * 1024) {
    this.maxBytes = Math.max(1024 * 1024, Math.trunc(maxBytes));
  }

  get(key: string, tick = 0): LoadedAsset<T> | undefined {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    entry.touches += 1;
    entry.lastUsedAtTick = Math.max(entry.lastUsedAtTick, tick);
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return Object.freeze({ ...entry });
  }

  set(key: string, value: T, bytes: number, tick = 0): LoadedAsset<T> {
    const safeBytes = Math.max(0, Math.trunc(bytes));
    const existing = this.#entries.get(key);
    if (existing) this.#bytes -= existing.bytes;
    const entry: CacheEntry<T> = {
      key,
      value,
      bytes: safeBytes,
      loadedAtTick: tick,
      lastUsedAtTick: tick,
      touches: existing?.touches ?? 0,
    };
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    this.#bytes += safeBytes;
    this.#evict();
    const current = this.#entries.get(key) ?? entry;
    return Object.freeze({ ...current });
  }

  remove(key: string): boolean {
    const entry = this.#entries.get(key);
    if (!entry) return false;
    this.#entries.delete(key);
    this.#bytes -= entry.bytes;
    return true;
  }

  clear(): void {
    this.#entries.clear();
    this.#bytes = 0;
  }

  has(key: string): boolean {
    return this.#entries.has(key);
  }

  size(): number {
    return this.#entries.size;
  }

  bytes(): number {
    return this.#bytes;
  }

  keys(): readonly string[] {
    return Object.freeze([...this.#entries.keys()]);
  }

  stats(): Readonly<{ entries: number; bytes: number; capacityBytes: number; utilization: number }> {
    return Object.freeze({
      entries: this.size(),
      bytes: this.#bytes,
      capacityBytes: this.maxBytes,
      utilization: Math.min(1, this.#bytes / this.maxBytes),
    });
  }

  #evict(): void {
    while (this.#bytes > this.maxBytes && this.#entries.size > 0) {
      const first = this.#entries.keys().next().value as string | undefined;
      if (first === undefined) break;
      this.remove(first);
    }
  }
}

export interface AssetRequest<T> {
  readonly descriptor: AssetDescriptor;
  readonly provider: AssetProvider<T>;
  readonly tick: number;
  readonly signal?: AbortSignal;
}

interface QueueTask<T> extends AssetRequest<T> {
  readonly resolve: (result: Result<LoadedAsset<T>>) => void;
}

export class AssetOrchestrator<T = unknown> {
  readonly cache: AssetCache<T>;
  readonly concurrency: number;

  #active = 0;
  #queue: QueueTask<T>[] = [];
  #inflight = new Map<string, Promise<Result<LoadedAsset<T>>>>();

  constructor(options: { readonly maxBytes?: number; readonly concurrency?: number } = {}) {
    this.cache = new AssetCache<T>(options.maxBytes);
    this.concurrency = Math.max(1, Math.min(32, Math.trunc(options.concurrency ?? 4)));
  }

  request(request: AssetRequest<T>): Promise<Result<LoadedAsset<T>>> {
    const cached = this.cache.get(request.descriptor.key, request.tick);
    if (cached) return Promise.resolve({ ok: true, value: cached });
    const existing = this.#inflight.get(request.descriptor.key);
    if (existing) return existing;
    const promise = new Promise<Result<LoadedAsset<T>>>((resolve) => {
      this.#queue.push({ ...request, resolve });
      this.#queue.sort(this.#compareQueue);
      this.#drain();
    });
    this.#inflight.set(request.descriptor.key, promise);
    void promise.finally(() => {
      this.#inflight.delete(request.descriptor.key);
    });
    return promise;
  }

  cancel(key: string): boolean {
    const before = this.#queue.length;
    this.#queue = this.#queue.filter((task) => task.descriptor.key !== key);
    return before !== this.#queue.length;
  }

  clear(): void {
    this.#queue = [];
    this.cache.clear();
  }

  stats(): Readonly<{ active: number; queued: number; inflight: number; cache: ReturnType<AssetCache<T>['stats']> }> {
    return Object.freeze({
      active: this.#active,
      queued: this.#queue.length,
      inflight: this.#inflight.size,
      cache: this.cache.stats(),
    });
  }

  #compareQueue = (a: QueueTask<T>, b: QueueTask<T>): number => {
    const pa = PRIORITY_WEIGHT[a.descriptor.priority];
    const pb = PRIORITY_WEIGHT[b.descriptor.priority];
    if (pa !== pb) return pa - pb;
    if (a.tick !== b.tick) return a.tick - b.tick;
    return a.descriptor.key.localeCompare(b.descriptor.key);
  };

  #drain(): void {
    while (this.#active < this.concurrency && this.#queue.length > 0) {
      const task = this.#queue.shift();
      if (!task) break;
      this.#active += 1;
      void this.#load(task).finally(() => {
        this.#active -= 1;
        this.#drain();
      });
    }
  }

  async #load(task: QueueTask<T>): Promise<void> {
    try {
      if (task.signal?.aborted) {
        task.resolve({
          ok: false,
          error: { code: 'ASSET_ABORTED', message: 'Asset request aborted.', retryable: true },
        });
        return;
      }
      const loaded = await task.provider.load(task.descriptor, task.signal);
      const expectedBytes = Math.max(0, Math.trunc(task.descriptor.bytes));
      const actualBytes = Math.max(0, Math.trunc(loaded.bytes));
      if (expectedBytes > 0 && actualBytes > expectedBytes * 2) {
        task.resolve({
          ok: false,
          error: { code: 'ASSET_SIZE_LIMIT', message: 'Asset exceeded declared size envelope.', retryable: false },
        });
        return;
      }
      if (task.descriptor.hash) {
        const actualDigest = stableDigest(loaded.value);
        if (actualDigest !== task.descriptor.hash) {
          task.resolve({
            ok: false,
            error: { code: 'ASSET_HASH_MISMATCH', message: 'Asset integrity digest mismatch.', retryable: false },
          });
          return;
        }
      }
      const value = this.cache.set(task.descriptor.key, loaded.value, actualBytes, task.tick);
      task.resolve({ ok: true, value });
    } catch (cause) {
      task.resolve({
        ok: false,
        error: { code: 'ASSET_LOAD_FAILED', message: String(cause), retryable: true, cause },
      });
    }
  }
}
