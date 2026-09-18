import type { AssetBudgetV7, AssetDescriptorV7, AssetRecordV7, ContentHashV7, TickV7 } from './types.ts';
import { hashV7, tickV7 } from './types.ts';
import { checksumV7 } from './deterministic.ts';

interface CacheEntry extends AssetRecordV7 {
  value: unknown;
}

export interface AssetCacheStatsV7 {
  readonly entries: number;
  readonly bytes: number;
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
  readonly inFlight: number;
}

export class AssetCacheV7 {
  readonly #budget: AssetBudgetV7;
  readonly #entries = new Map<string, CacheEntry>();
  readonly #inFlight = new Map<string, Promise<unknown>>();
  #bytes = 0;
  #hits = 0;
  #misses = 0;
  #evictions = 0;

  constructor(budget: AssetBudgetV7) {
    if (budget.maxBytes <= 0 || budget.maxEntries <= 0 || budget.reserveBytes < 0 || budget.reserveBytes >= budget.maxBytes) throw new RangeError('Invalid asset budget');
    this.#budget = Object.freeze({ ...budget });
  }

  has(id: string): boolean { return this.#entries.has(id); }

  get<T>(id: string, tick: TickV7): T | undefined {
    const entry = this.#entries.get(id);
    if (!entry) { this.#misses += 1; return undefined; }
    this.#hits += 1;
    this.#entries.set(id, { ...entry, lastUsedTick: tickV7(Number(tick)), hitCount: entry.hitCount + 1 });
    return entry.value as T;
  }

  async getOrLoad<T>(descriptor: AssetDescriptorV7, tick: TickV7, loader: () => Promise<T>): Promise<T> {
    const cached = this.get<T>(descriptor.id, tick);
    if (cached !== undefined) return cached;
    const active = this.#inFlight.get(descriptor.id);
    if (active) return active as Promise<T>;
    const promise = loader().then((value) => {
      this.put(descriptor, value, tick);
      return value;
    }).finally(() => this.#inFlight.delete(descriptor.id));
    this.#inFlight.set(descriptor.id, promise);
    return promise;
  }

  put<T>(descriptor: AssetDescriptorV7, value: T, tick: TickV7): boolean {
    if (!descriptor.id || descriptor.bytes < 0 || descriptor.bytes > this.#budget.maxBytes - this.#budget.reserveBytes) return false;
    this.remove(descriptor.id);
    this.#ensureRoom(descriptor.bytes, descriptor.critical);
    if (this.#bytes + descriptor.bytes > this.#budget.maxBytes || this.#entries.size >= this.#budget.maxEntries) return false;
    const entry: CacheEntry = Object.freeze({
      ...descriptor,
      hash: hashV7(String(descriptor.hash)),
      loaded: true,
      residentBytes: descriptor.bytes,
      lastUsedTick: tick,
      hitCount: 0,
      missCount: 0,
      value,
    });
    this.#entries.set(descriptor.id, entry);
    this.#bytes += descriptor.bytes;
    return true;
  }

  remove(id: string): boolean {
    const entry = this.#entries.get(id);
    if (!entry) return false;
    this.#entries.delete(id); this.#bytes = Math.max(0, this.#bytes - entry.residentBytes); return true;
  }

  clearNonCritical(): number {
    let removed = 0;
    for (const [id, entry] of this.#entries) if (!entry.critical) { this.remove(id); removed += 1; }
    return removed;
  }

  stats(): AssetCacheStatsV7 {
    return Object.freeze({ entries: this.#entries.size, bytes: this.#bytes, hits: this.#hits, misses: this.#misses, evictions: this.#evictions, inFlight: this.#inFlight.size });
  }

  manifest(): readonly AssetRecordV7[] {
    return Object.freeze([...this.#entries.values()].sort((a, b) => a.id.localeCompare(b.id)).map(({ value: _value, ...descriptor }) => Object.freeze(descriptor)));
  }

  digest(): number { return Number.parseInt(checksumV7(this.manifest()).slice(0, 8), 16) >>> 0; }

  #ensureRoom(required: number, critical: boolean): void {
    const target = this.#budget.maxBytes - Math.max(0, required);
    while ((this.#bytes > target || this.#entries.size >= this.#budget.maxEntries) && this.#entries.size > 0) {
      const candidates = [...this.#entries.values()]
        .filter((entry) => !entry.critical || !critical)
        .sort((a, b) => (Number(a.critical) - Number(b.critical)) || (Number(a.lastUsedTick) - Number(b.lastUsedTick)) || a.id.localeCompare(b.id));
      const victim = candidates[0];
      if (!victim) return;
      this.remove(victim.id); this.#evictions += 1;
    }
  }
}
