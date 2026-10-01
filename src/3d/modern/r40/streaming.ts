import type { AssetId, AssetManifestEntry, AssetRequest, AssetResidency, Tick } from './types';
import { clamp, deterministicBackoff, hashJson, stableSort } from './deterministic';

export interface StreamingLimits { readonly maxResidentBytes: number; readonly maxConcurrent: number; readonly maxQueue: number; readonly failureLimit: number; }
const DEFAULT_LIMITS: StreamingLimits = Object.freeze({ maxResidentBytes: 536870912, maxConcurrent: 8, maxQueue: 2048, failureLimit: 3 });

export class AssetCatalog {
  #entries = new Map<AssetId, AssetManifestEntry>();
  register(entry: AssetManifestEntry): boolean {
    if (!entry.id || !entry.uri || entry.bytes < 0 || !/^[a-f0-9]{8,128}$/i.test(entry.digest)) return false;
    if (this.#entries.has(entry.id)) return false;
    this.#entries.set(entry.id, Object.freeze({ ...entry, priority: clamp(entry.priority, 0, 100) })); return true;
  }
  replace(entry: AssetManifestEntry): boolean {
    if (!entry.id || !this.#entries.has(entry.id)) return false;
    this.#entries.set(entry.id, Object.freeze({ ...entry, priority: clamp(entry.priority, 0, 100) })); return true;
  }
  get(id: AssetId): AssetManifestEntry | null { return this.#entries.get(id) ?? null; }
  values(): readonly AssetManifestEntry[] { return Object.freeze(stableSort([...this.#entries.values()], (a, b) => a.id.localeCompare(b.id))); }
  digest(): string { return hashJson(this.values()); }
  clear(): void { this.#entries.clear(); }
}

interface QueueItem { readonly request: AssetRequest; readonly enqueuedTick: Tick; attempts: number; }
export class AssetStreamingController {
  readonly limits: StreamingLimits; readonly catalog: AssetCatalog; #queue: QueueItem[] = []; #residency = new Map<AssetId, AssetResidency>(); #inFlight = new Set<AssetId>(); #failures = new Map<AssetId, number>();
  constructor(catalog = new AssetCatalog(), limits: Partial<StreamingLimits> = {}) { this.catalog = catalog; this.limits = Object.freeze({ ...DEFAULT_LIMITS, ...limits }); }
  request(request: AssetRequest, tick: Tick): boolean {
    const entry = this.catalog.get(request.id); if (!entry || this.#queue.length >= this.limits.maxQueue) return false;
    const current = this.#residency.get(request.id);
    if (current?.state === 'resident' || current?.state === 'loading' || this.#queue.some((q) => q.request.id === request.id)) return false;
    this.#residency.set(request.id, Object.freeze({ id: request.id, state: 'queued', bytes: entry.bytes, lastUsedTick: tick, refCount: current?.refCount ?? 1 }));
    this.#queue.push({ request, enqueuedTick: tick, attempts: 0 }); return true;
  }
  plan(tick: Tick): readonly AssetRequest[] {
    return Object.freeze(stableSort(this.#queue, (a, b) => {
      const pa = this.#score(a, tick), pb = this.#score(b, tick); return pb - pa || a.request.id.localeCompare(b.request.id);
    }).slice(0, Math.max(0, this.limits.maxConcurrent - this.#inFlight.size)).map((item) => item.request));
  }
  begin(id: AssetId, tick: Tick): boolean {
    const item = this.#queue.find((q) => q.request.id === id); if (!item || this.#inFlight.size >= this.limits.maxConcurrent || this.#inFlight.has(id)) return false;
    item.attempts += 1; this.#inFlight.add(id); this.#residency.set(id, Object.freeze({ ...(this.#residency.get(id)!), state: 'loading', lastUsedTick: tick })); return true;
  }
  succeed(id: AssetId, tick: Tick): boolean {
    if (!this.#inFlight.delete(id)) return false;
    const itemIndex = this.#queue.findIndex((q) => q.request.id === id); if (itemIndex >= 0) this.#queue.splice(itemIndex, 1);
    const current = this.#residency.get(id); if (!current) return false;
    this.#residency.set(id, Object.freeze({ ...current, state: 'resident', lastUsedTick: tick })); this.#failures.delete(id); return true;
  }
  fail(id: AssetId, tick: Tick): { retry: boolean; delayMs: number } {
    this.#inFlight.delete(id); const item = this.#queue.find((q) => q.request.id === id); if (!item) return { retry: false, delayMs: 0 };
    const count = (this.#failures.get(id) ?? 0) + 1; this.#failures.set(id, count);
    const retry = count < this.limits.failureLimit;
    if (retry) {
      this.#residency.set(id, Object.freeze({ ...(this.#residency.get(id)!), state: 'queued', lastUsedTick: tick }));
    } else {
      this.#queue.splice(this.#queue.indexOf(item), 1); this.#residency.set(id, Object.freeze({ ...(this.#residency.get(id)!), state: 'failed', lastUsedTick: tick }));
    }
    return { retry, delayMs: deterministicBackoff(count, 100, 5000, String(id)) };
  }
  touch(id: AssetId, tick: Tick): void { const current = this.#residency.get(id); if (current) this.#residency.set(id, Object.freeze({ ...current, lastUsedTick: tick, refCount: current.refCount + 1 })); }
  release(id: AssetId): void { const current = this.#residency.get(id); if (!current) return; this.#residency.set(id, Object.freeze({ ...current, refCount: Math.max(0, current.refCount - 1) })); }
  evictToBudget(maxBytes: number, tick: Tick): readonly AssetId[] {
    let total = this.residentBytes(); const removed: AssetId[] = [];
    const candidates = stableSort([...this.#residency.values()].filter((v) => v.state === 'resident' && v.refCount === 0), (a, b) => Number(a.lastUsedTick) - Number(b.lastUsedTick) || a.id.localeCompare(b.id));
    for (const c of candidates) {
      if (total <= maxBytes) break; total -= c.bytes; removed.push(c.id); this.#residency.set(c.id, Object.freeze({ ...c, state: 'stale', lastUsedTick: tick }));
    }
    return Object.freeze(removed);
  }
  residentBytes(): number { return [...this.#residency.values()].filter((v) => v.state === 'resident').reduce((s, v) => s + v.bytes, 0); }
  residency(id: AssetId): AssetResidency | null { return this.#residency.get(id) ?? null; }
  queueDepth(): number { return this.#queue.length; }
  inFlight(): number { return this.#inFlight.size; }
  snapshot(): readonly AssetResidency[] { return Object.freeze(stableSort([...this.#residency.values()], (a, b) => a.id.localeCompare(b.id))); }
  #score(item: QueueItem, tick: Tick): number {
    const entry = this.catalog.get(item.request.id); if (!entry) return -Infinity;
    const age = Number(tick) - Number(item.enqueuedTick);
    const distance = 1 / Math.max(1, item.request.distance);
    const deadline = item.request.hardDeadlineTick === null ? 0 : Math.max(0, Number(tick) - Number(item.request.hardDeadlineTick));
    return entry.priority * 10 + item.request.priorityBias * 5 + distance * 100 + age + deadline * 50;
  }
}
export function validateAssetBytes(expected: AssetManifestEntry, actualBytes: number, actualDigest: string): boolean {
  return actualBytes === expected.bytes && actualDigest.toLowerCase() === expected.digest.toLowerCase();
}
