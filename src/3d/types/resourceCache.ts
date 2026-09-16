import type { AssetDescriptor, AssetId, Residency, ResidencyRecord, Result } from './platform.js';
import { err, ok } from './platform.js';

export interface CacheClock { now(): number; }
export interface CacheMetrics { hits: number; misses: number; evictions: number; bytes: number; entries: number; }
export interface CacheEntry<T> {
  readonly key: string;
  readonly value: T;
  readonly bytes: number;
  readonly createdAt: number;
  readonly lastAccessAt: number;
  readonly expiresAt?: number;
  readonly pinned: boolean;
  readonly priority: number;
  readonly assetId?: AssetId;
}
export interface CacheBudget { readonly maxBytes: number; readonly maxEntries: number; }
export interface CacheOptions<T> {
  readonly bytes?: number;
  readonly ttlMs?: number;
  readonly pinned?: boolean;
  readonly priority?: number;
  readonly assetId?: AssetId;
  readonly estimateBytes?: (value: T) => number;
}

const defaultClock: CacheClock = { now: () => Date.now() };

export class BudgetedResourceCache<T> {
  readonly #entries = new Map<string, CacheEntry<T>>();
  readonly #budget: CacheBudget;
  readonly #clock: CacheClock;
  #bytes = 0;
  #metrics: CacheMetrics = { hits: 0, misses: 0, evictions: 0, bytes: 0, entries: 0 };

  constructor(budget: CacheBudget, clock = defaultClock) {
    if (!Number.isFinite(budget.maxBytes) || budget.maxBytes < 0) throw new RangeError('maxBytes must be non-negative');
    if (!Number.isSafeInteger(budget.maxEntries) || budget.maxEntries < 1) throw new RangeError('maxEntries must be positive');
    this.#budget = Object.freeze({ ...budget });
    this.#clock = clock;
  }

  #size(value: T, options: CacheOptions<T>): number {
    const bytes = options.bytes ?? options.estimateBytes?.(value) ?? 0;
    return Number.isFinite(bytes) && bytes >= 0 ? bytes : 0;
  }

  #touch(entry: CacheEntry<T>): CacheEntry<T> {
    return { ...entry, lastAccessAt: this.#clock.now() };
  }

  #syncMetrics(): void {
    this.#metrics = { ...this.#metrics, bytes: this.#bytes, entries: this.#entries.size };
  }

  #remove(key: string, countEviction: boolean): T | undefined {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    this.#entries.delete(key);
    this.#bytes -= entry.bytes;
    if (countEviction) this.#metrics = { ...this.#metrics, evictions: this.#metrics.evictions + 1 };
    this.#syncMetrics();
    return entry.value;
  }

  #evictionScore(entry: CacheEntry<T>, now: number): number {
    const age = Math.max(0, now - entry.lastAccessAt);
    const priority = Math.max(0, Math.min(1, entry.priority));
    const pinPenalty = entry.pinned ? 0.001 : 1;
    return (age + 1) * pinPenalty * (1 - priority) / Math.max(1, entry.bytes);
  }

  #evictUntilFits(incomingBytes: number): void {
    while ((this.#bytes + incomingBytes > this.#budget.maxBytes || this.#entries.size >= this.#budget.maxEntries) && this.#entries.size > 0) {
      const now = this.#clock.now();
      const candidate = [...this.#entries.values()]
        .filter((entry) => !entry.pinned)
        .sort((a, b) => this.#evictionScore(b, now) - this.#evictionScore(a, now) || a.key.localeCompare(b.key))[0];
      if (!candidate) break;
      this.#remove(candidate.key, true);
    }
  }

  set(key: string, value: T, options: CacheOptions<T> = {}): Result<void, Error> {
    if (!key.trim()) return err(new Error('Cache key must not be empty'));
    const bytes = this.#size(value, options);
    if (bytes > this.#budget.maxBytes) return err(new Error(`Resource exceeds cache budget: ${bytes}`));
    this.#remove(key, false);
    this.#evictUntilFits(bytes);
    const now = this.#clock.now();
    const entry: CacheEntry<T> = {
      key, value, bytes, createdAt: now, lastAccessAt: now,
      ...(options.ttlMs !== undefined && options.ttlMs > 0 ? { expiresAt: now + options.ttlMs } : {}),
      pinned: options.pinned ?? false,
      priority: Math.max(0, Math.min(1, options.priority ?? 0.5)),
      ...(options.assetId ? { assetId: options.assetId } : {}),
    };
    this.#entries.set(key, entry);
    this.#bytes += bytes;
    this.#syncMetrics();
    return ok(undefined);
  }

  get(key: string): T | undefined {
    const entry = this.#entries.get(key);
    if (!entry) {
      this.#metrics = { ...this.#metrics, misses: this.#metrics.misses + 1 };
      return undefined;
    }
    if (entry.expiresAt !== undefined && this.#clock.now() >= entry.expiresAt) {
      this.#remove(key, false);
      this.#metrics = { ...this.#metrics, misses: this.#metrics.misses + 1 };
      return undefined;
    }
    this.#entries.set(key, this.#touch(entry));
    this.#metrics = { ...this.#metrics, hits: this.#metrics.hits + 1 };
    return entry.value;
  }

  peek(key: string): T | undefined { return this.#entries.get(key)?.value; }
  has(key: string): boolean { return this.#entries.has(key); }
  delete(key: string): boolean { return this.#remove(key, false) !== undefined; }
  clear(): void { this.#entries.clear(); this.#bytes = 0; this.#syncMetrics(); }
  size(): number { return this.#entries.size; }
  bytes(): number { return this.#bytes; }
  metrics(): CacheMetrics { return Object.freeze({ ...this.#metrics }); }

  sweepExpired(): number {
    const now = this.#clock.now();
    let removed = 0;
    for (const entry of [...this.#entries.values()]) {
      if (entry.expiresAt !== undefined && now >= entry.expiresAt) {
        this.#remove(entry.key, false);
        removed += 1;
      }
    }
    return removed;
  }

  promote(key: string, priority: number): boolean {
    const entry = this.#entries.get(key);
    if (!entry) return false;
    this.#entries.set(key, { ...entry, priority: Math.max(0, Math.min(1, priority)), lastAccessAt: this.#clock.now() });
    return true;
  }

  pin(key: string, pinned = true): boolean {
    const entry = this.#entries.get(key);
    if (!entry) return false;
    this.#entries.set(key, { ...entry, pinned });
    return true;
  }

  entries(): readonly CacheEntry<T>[] { return [...this.#entries.values()]; }
}

export interface ResidencyControllerConfig {
  readonly budgetBytes: number;
  readonly minResidentPriority: number;
  readonly staleAfterTicks: number;
}

export interface ResidencyDecision {
  readonly assetId: AssetId;
  readonly action: 'keep' | 'load' | 'refresh' | 'evict';
  readonly priority: number;
  readonly reason: string;
}

export class ResidencyController {
  readonly #config: ResidencyControllerConfig;
  constructor(config: ResidencyControllerConfig) {
    this.#config = Object.freeze({ ...config });
  }

  decide(records: readonly ResidencyRecord[], nowTick: number): readonly ResidencyDecision[] {
    return records.map((record) => {
      const age = Math.max(0, nowTick - record.lastUsedTick);
      const priority = Math.max(0, Math.min(1, record.priority));
      if (record.state === 'loading' || record.state === 'queued') return { assetId: record.descriptor.id, action: 'keep', priority, reason: 'load-in-flight' };
      if (record.state === 'resident' && age <= this.#config.staleAfterTicks) return { assetId: record.descriptor.id, action: 'keep', priority, reason: 'recently-used' };
      if (record.state === 'stale' && priority >= this.#config.minResidentPriority) return { assetId: record.descriptor.id, action: 'refresh', priority, reason: 'important-stale-asset' };
      if (record.state === 'cold') return { assetId: record.descriptor.id, action: 'load', priority, reason: 'cold-asset' };
      return { assetId: record.descriptor.id, action: 'evict', priority, reason: 'stale-low-priority' };
    }).sort((a, b) => b.priority - a.priority || String(a.assetId).localeCompare(String(b.assetId)));
  }
}
