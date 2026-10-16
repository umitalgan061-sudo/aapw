import { clamp, compareNumbers, compareStrings, err, finite, ok, stableDigest, type AssetKey, type MonotonicClock, type Priority, type Result, systemMonotonicClock } from "./contracts.ts";

export interface AssetRequest {
  readonly key: string;
  readonly url: string;
  readonly priority: Priority;
  readonly expectedBytes?: number;
  readonly version?: string;
  readonly tags?: readonly string[];
}

export interface AssetLoadValue<T> {
  readonly value: T;
  readonly bytes: number;
  readonly integrity?: string;
}

export type AssetProvider<T> = (request: AssetRequest, signal: AbortSignal) => Promise<AssetLoadValue<T>>;

export interface AssetPolicy {
  readonly maxResidentBytes: number;
  readonly maxAssetBytes: number;
  readonly maxPending: number;
  readonly concurrency: number;
  readonly cacheTtlMs: number;
  readonly maxEntries: number;
}

export interface AssetRecord<T> {
  readonly key: AssetKey;
  readonly url: string;
  readonly value: T;
  readonly bytes: number;
  readonly integrity: string;
  readonly loadedAtMs: number;
  readonly expiresAtMs: number;
  readonly generation: number;
}

export interface AssetMetrics {
  readonly queued: number;
  readonly inFlight: number;
  readonly residentEntries: number;
  readonly residentBytes: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly loadFailures: number;
  readonly evictions: number;
  readonly rejected: number;
}

interface CacheEntry<T> {
  record: AssetRecord<T>;
  lastAccess: number;
}
interface Pending<T> {
  readonly request: AssetRequest;
  readonly key: string;
  readonly sequence: number;
  readonly enqueuedAt: number;
  readonly controller: AbortController;
  readonly promise: Promise<Result<AssetRecord<T>>>;
  resolve: (result: Result<AssetRecord<T>>) => void;
  started: boolean;
}

const DEFAULT_POLICY: AssetPolicy = Object.freeze({
  maxResidentBytes: 256 * 1024 * 1024,
  maxAssetBytes: 64 * 1024 * 1024,
  maxPending: 512,
  concurrency: 6,
  cacheTtlMs: 5 * 60_000,
  maxEntries: 2048,
});

/**
 * Deduplicating asset loader with strict byte budgets and bounded LRU caching.
 * All clocks and ordering tie-breakers are explicit to make tests repeatable.
 */
export class AssetPipeline<T> {
  readonly policy: AssetPolicy;
  readonly provider: AssetProvider<T>;
  readonly clock: MonotonicClock;
  #cache = new Map<string, CacheEntry<T>>();
  #pending = new Map<string, Pending<T>>();
  #queue: Pending<T>[] = [];
  #residentBytes = 0;
  #sequence = 0;
  #generation = 1;
  #inFlight = 0;
  #metrics = { cacheHits: 0, cacheMisses: 0, loadFailures: 0, evictions: 0, rejected: 0 };

  constructor(provider: AssetProvider<T>, policy: Partial<AssetPolicy> = {}, clock: MonotonicClock = systemMonotonicClock) {
    this.provider = provider;
    this.clock = clock;
    this.policy = Object.freeze({
      maxResidentBytes: Math.max(1, Math.trunc(policy.maxResidentBytes ?? DEFAULT_POLICY.maxResidentBytes)),
      maxAssetBytes: Math.max(1, Math.trunc(policy.maxAssetBytes ?? DEFAULT_POLICY.maxAssetBytes)),
      maxPending: Math.max(1, Math.trunc(policy.maxPending ?? DEFAULT_POLICY.maxPending)),
      concurrency: Math.max(1, Math.trunc(policy.concurrency ?? DEFAULT_POLICY.concurrency)),
      cacheTtlMs: Math.max(1, Math.trunc(policy.cacheTtlMs ?? DEFAULT_POLICY.cacheTtlMs)),
      maxEntries: Math.max(1, Math.trunc(policy.maxEntries ?? DEFAULT_POLICY.maxEntries)),
    });
  }

  request(request: AssetRequest): Promise<Result<AssetRecord<T>>> {
    const normalized = this.#normalizeRequest(request);
    if (!normalized.ok) {
      this.#metrics.rejected += 1;
      return Promise.resolve(normalized);
    }
    const safe = normalized.value;
    const now = Math.max(0, finite(this.clock.now(), 0));
    this.#expire(now);
    const cached = this.#cache.get(safe.key);
    if (cached && cached.record.url === safe.url && cached.record.generation === this.#generation) {
      cached.lastAccess = now;
      this.#metrics.cacheHits += 1;
      return Promise.resolve(ok(cached.record));
    }
    this.#metrics.cacheMisses += 1;
    const existing = this.#pending.get(safe.key);
    if (existing) {
      if (existing.request.url !== safe.url) {
        return Promise.resolve(err("ASSET_KEY_COLLISION", "A different URL is already loading for this key.", false, { key: safe.key }));
      }
      return existing.promise;
    }
    if (this.#queue.length + this.#inFlight >= this.policy.maxPending) {
      this.#metrics.rejected += 1;
      return Promise.resolve(err("ASSET_QUEUE_FULL", "Pending asset limit reached.", true));
    }
    let resolve!: (result: Result<AssetRecord<T>>) => void;
    const promise = new Promise<Result<AssetRecord<T>>>((done) => { resolve = done; });
    const pending: Pending<T> = {
      request: safe,
      key: safe.key,
      sequence: this.#sequence++,
      enqueuedAt: now,
      controller: new AbortController(),
      promise,
      resolve,
      started: false,
    };
    this.#pending.set(safe.key, pending);
    this.#queue.push(pending);
    this.#sortQueue();
    this.#pump();
    return promise;
  }

  cancel(keyValue: string, reason = "cancelled by caller"): boolean {
    const key = keyValue.trim();
    const pending = this.#pending.get(key);
    if (!pending) return false;
    pending.controller.abort(reason);
    if (!pending.started) {
      this.#queue = this.#queue.filter((item) => item !== pending);
      this.#pending.delete(key);
      pending.resolve(err("ASSET_CANCELLED", reason, true, { key }));
      this.#pump();
    }
    return true;
  }

  invalidate(keyValue: string): boolean {
    const key = keyValue.trim();
    const entry = this.#cache.get(key);
    const pending = this.#pending.get(key);
    if (!entry && !pending) return false;
    if (pending) this.cancel(key, "asset invalidated");
    if (entry) {
      this.#cache.delete(key);
      this.#residentBytes = Math.max(0, this.#residentBytes - entry.record.bytes);
    }
    return true;
  }

  invalidateAll(): void {
    for (const key of [...this.#pending.keys()]) this.cancel(key, "all assets invalidated");
    this.#cache.clear();
    this.#residentBytes = 0;
    this.#generation += 1;
  }

  metrics(): AssetMetrics {
    return Object.freeze({
      queued: this.#queue.length,
      inFlight: this.#inFlight,
      residentEntries: this.#cache.size,
      residentBytes: this.#residentBytes,
      cacheHits: this.#metrics.cacheHits,
      cacheMisses: this.#metrics.cacheMisses,
      loadFailures: this.#metrics.loadFailures,
      evictions: this.#metrics.evictions,
      rejected: this.#metrics.rejected,
    });
  }

  cacheKeys(): readonly string[] {
    return Object.freeze([...this.#cache.keys()].sort(compareStrings));
  }

  async prefetch(requests: readonly AssetRequest[]): Promise<readonly Result<AssetRecord<T>>[]> {
    const bounded = requests.slice(0, this.policy.maxPending);
    return Object.freeze(await Promise.all(bounded.map((request) => this.request({ ...request, priority: Math.max(2, request.priority) as Priority }))));
  }

  dispose(reason = "asset pipeline disposed"): void {
    for (const pending of this.#pending.values()) {
      pending.controller.abort(reason);
      if (!pending.started) pending.resolve(err("ASSET_DISPOSED", reason, true));
    }
    this.#pending.clear();
    this.#queue = [];
    this.#cache.clear();
    this.#residentBytes = 0;
    this.#generation += 1;
  }

  #normalizeRequest(request: AssetRequest): Result<AssetRequest> {
    const key = request.key.trim().slice(0, 160);
    const url = request.url.trim();
    if (!key) return err("ASSET_KEY_REQUIRED", "Asset key must not be empty.");
    if (!url || url.length > 2048) return err("ASSET_URL_INVALID", "Asset URL is empty or too long.");
    if (/^(javascript|data|file):/iu.test(url)) return err("ASSET_URL_SCHEME", "Asset URL scheme is not allowed.");
    const expectedBytes = request.expectedBytes === undefined ? undefined : Math.max(0, Math.trunc(request.expectedBytes));
    if (expectedBytes !== undefined && expectedBytes > this.policy.maxAssetBytes) {
      return err("ASSET_EXPECTED_SIZE", "Declared asset size exceeds the configured limit.", false, { expectedBytes });
    }
    const normalized: AssetRequest = Object.freeze({
      key,
      url,
      priority: Math.max(0, Math.min(4, Math.trunc(request.priority))) as Priority,
      ...(expectedBytes === undefined ? {} : { expectedBytes }),
      ...(request.version === undefined ? {} : { version: request.version.slice(0, 96) }),
      ...(request.tags === undefined ? {} : { tags: Object.freeze(request.tags.slice(0, 32).map((tag) => String(tag).slice(0, 64))) }),
    });
    return ok(normalized);
  }

  #sortQueue(): void {
    this.#queue.sort((a, b) =>
      a.request.priority - b.request.priority ||
      compareNumbers(a.sequence, b.sequence) ||
      compareStrings(a.key, b.key),
    );
  }

  #pump(): void {
    while (this.#inFlight < this.policy.concurrency && this.#queue.length > 0) {
      const pending = this.#queue.shift();
      if (!pending || pending.controller.signal.aborted) continue;
      pending.started = true;
      this.#inFlight += 1;
      void this.#load(pending);
    }
  }

  async #load(pending: Pending<T>): Promise<void> {
    try {
      const loaded = await this.provider(pending.request, pending.controller.signal);
      if (pending.controller.signal.aborted) {
        pending.resolve(err("ASSET_CANCELLED", "Asset load was cancelled.", true, { key: pending.key }));
        return;
      }
      const bytes = Math.trunc(loaded.bytes);
      if (!Number.isFinite(loaded.bytes) || bytes < 0 || bytes > this.policy.maxAssetBytes) {
        this.#metrics.rejected += 1;
        pending.resolve(err("ASSET_BYTE_BUDGET", "Loaded asset exceeded the configured byte budget.", false, { bytes: finite(loaded.bytes, -1) }));
        return;
      }
      if (pending.request.expectedBytes !== undefined && bytes > pending.request.expectedBytes * 1.25 + 1024) {
        this.#metrics.rejected += 1;
        pending.resolve(err("ASSET_DECLARED_SIZE_MISMATCH", "Loaded asset is materially larger than declared.", false, { bytes, expected: pending.request.expectedBytes }));
        return;
      }
      const now = Math.max(0, finite(this.clock.now(), 0));
      const integrity = loaded.integrity?.trim() || stableDigest({ key: pending.key, url: pending.request.url, bytes, version: pending.request.version ?? "" });
      const record: AssetRecord<T> = Object.freeze({
        key: pending.key as AssetKey,
        url: pending.request.url,
        value: loaded.value,
        bytes,
        integrity,
        loadedAtMs: now,
        expiresAtMs: now + this.policy.cacheTtlMs,
        generation: this.#generation,
      });
      if (bytes <= this.policy.maxResidentBytes) {
        this.#makeRoom(bytes);
        if (this.#cache.size < this.policy.maxEntries && this.#residentBytes + bytes <= this.policy.maxResidentBytes) {
          const previous = this.#cache.get(pending.key);
          if (previous) this.#residentBytes = Math.max(0, this.#residentBytes - previous.record.bytes);
          this.#cache.set(pending.key, { record, lastAccess: now });
          this.#residentBytes += bytes;
        }
      }
      pending.resolve(ok(record));
    } catch (cause) {
      this.#metrics.loadFailures += 1;
      pending.resolve(err("ASSET_LOAD_FAILED", cause instanceof Error ? cause.message : String(cause), true, { key: pending.key }));
    } finally {
      this.#inFlight = Math.max(0, this.#inFlight - 1);
      this.#pending.delete(pending.key);
      this.#pump();
    }
  }

  #makeRoom(requiredBytes: number): void {
    while (
      this.#cache.size >= this.policy.maxEntries ||
      this.#residentBytes + requiredBytes > this.policy.maxResidentBytes
    ) {
      const victim = [...this.#cache.entries()].sort((a, b) =>
        compareNumbers(a[1].lastAccess, b[1].lastAccess) || compareStrings(a[0], b[0]),
      )[0];
      if (!victim) return;
      this.#cache.delete(victim[0]);
      this.#residentBytes = Math.max(0, this.#residentBytes - victim[1].record.bytes);
      this.#metrics.evictions += 1;
    }
  }

  #expire(now: number): void {
    for (const [key, entry] of this.#cache) {
      if (entry.record.expiresAtMs <= now || entry.record.generation !== this.#generation) {
        this.#cache.delete(key);
        this.#residentBytes = Math.max(0, this.#residentBytes - entry.record.bytes);
      }
    }
  }
}
