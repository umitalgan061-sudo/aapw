import { clamp, integer, stableSort, type Disposable, type ResourceId, asResourceId, type V7Result } from './primitives.js';

export type ResidencyState = 'cold' | 'queued' | 'loading' | 'resident' | 'evicted' | 'failed';
export interface ResourceManifest { readonly id: ResourceId; readonly bytes: number; readonly priority: number; readonly required: boolean; readonly kind: 'model' | 'texture' | 'audio' | 'shader' | 'data'; readonly dependencies: readonly ResourceId[]; readonly digest: string; }
export interface ResourceRecord extends ResourceManifest { readonly state: ResidencyState; readonly generation: number; readonly lastUsedTick: number; readonly failureCount: number; }
export interface ResidencyOptions { readonly maxBytes?: number; readonly maxConcurrent?: number; readonly maxQueue?: number; }
export interface ResidencyStats { readonly registered: number; readonly resident: number; readonly residentBytes: number; readonly queued: number; readonly loading: number; readonly evictions: number; readonly failures: number; readonly rejected: number; }

export class ResourceResidency implements Disposable {
  readonly maxBytes: number; readonly maxConcurrent: number; readonly maxQueue: number;
  #records = new Map<ResourceId, ResourceRecord>(); #queue: ResourceId[] = []; #active = new Set<ResourceId>();
  #residentBytes = 0; #evictions = 0; #failures = 0; #rejected = 0; #disposed = false;
  constructor(options: ResidencyOptions = {}) {
    this.maxBytes = Math.max(4 * 1024 * 1024, integer(options.maxBytes ?? 512 * 1024 * 1024));
    this.maxConcurrent = clamp(integer(options.maxConcurrent ?? 4), 1, 16);
    this.maxQueue = clamp(integer(options.maxQueue ?? 256), 16, 4096);
  }
  register(manifest: Omit<ResourceManifest, 'id'> & { id: string }): V7Result<ResourceRecord> {
    if (this.#disposed) return { ok: false, code: 'RESIDENCY_DISPOSED', message: 'Residency manager is disposed', retryable: false };
    if (!manifest.id || manifest.id.length > 256) return { ok: false, code: 'RESOURCE_ID', message: 'Invalid resource id', retryable: false };
    if (!Number.isFinite(manifest.bytes) || manifest.bytes < 0 || manifest.bytes > this.maxBytes) return { ok: false, code: 'RESOURCE_BYTES', message: 'Resource byte budget is invalid', retryable: false };
    const id = asResourceId(manifest.id); const existing = this.#records.get(id);
    if (existing && existing.digest === manifest.digest && existing.bytes === manifest.bytes) return { ok: true, value: existing };
    const record: ResourceRecord = Object.freeze({ ...manifest, id, dependencies: Object.freeze([...new Set(manifest.dependencies as readonly ResourceId[])]), priority: clamp(integer(manifest.priority), 0, 1000), state: 'cold', generation: (existing?.generation ?? 0) + 1, lastUsedTick: 0, failureCount: 0 });
    this.#records.set(id, record); return { ok: true, value: record };
  }
  request(id: ResourceId): boolean {
    const record = this.#records.get(id); if (!record || this.#disposed || this.#active.has(id) || record.state === 'resident' || record.state === 'loading' || record.state === 'queued') return false;
    if (this.#queue.length >= this.maxQueue) { this.#rejected += 1; return false; }
    this.#queue.push(id); this.#queue.sort((a, b) => {
      const aa = this.#records.get(a)!; const bb = this.#records.get(b)!;
      return bb.priority - aa.priority || Number(bb.required) - Number(aa.required) || String(a).localeCompare(String(b));
    });
    this.#records.set(id, Object.freeze({ ...record, state: 'queued' })); return true;
  }
  markLoading(id: ResourceId): boolean { const record = this.#records.get(id); if (!record || record.state !== 'queued' || this.#active.size >= this.maxConcurrent) return false; this.#queue = this.#queue.filter((item) => item !== id); this.#active.add(id); this.#records.set(id, Object.freeze({ ...record, state: 'loading' })); return true; }
  complete(id: ResourceId, bytesLoaded: number, tick: number, valid = true): boolean {
    const record = this.#records.get(id); if (!record || !this.#active.has(id)) return false; this.#active.delete(id);
    if (!valid || Math.max(0, bytesLoaded) !== record.bytes) { this.#failures += 1; this.#records.set(id, Object.freeze({ ...record, state: 'failed', failureCount: record.failureCount + 1 })); return false; }
    this.#residentBytes += record.bytes; this.#records.set(id, Object.freeze({ ...record, state: 'resident', lastUsedTick: integer(tick) }));
    if (this.#residentBytes > this.maxBytes) this.evictTo(this.maxBytes * 0.88); return true;
  }
  touch(id: ResourceId, tick: number): boolean { const record = this.#records.get(id); if (!record || record.state !== 'resident') return false; this.#records.set(id, Object.freeze({ ...record, lastUsedTick: Math.max(record.lastUsedTick, integer(tick)) })); return true; }
  evict(id: ResourceId): boolean { const record = this.#records.get(id); if (!record || record.state !== 'resident' || this.#active.has(id) || record.required) return false; this.#residentBytes = Math.max(0, this.#residentBytes - record.bytes); this.#records.set(id, Object.freeze({ ...record, state: 'evicted' })); this.#evictions += 1; return true; }
  evictTo(targetBytes: number): number {
    const target = clamp(targetBytes, 0, this.maxBytes); let count = 0;
    const candidates = stableSort([...this.#records.values()].filter((record) => record.state === 'resident' && !record.required), (a, b) => a.lastUsedTick - b.lastUsedTick || a.priority - b.priority || String(a.id).localeCompare(String(b.id)));
    for (const record of candidates) { if (this.#residentBytes <= target) break; if (this.evict(record.id)) count += 1; }
    return count;
  }
  get(id: ResourceId): ResourceRecord | undefined { return this.#records.get(id); }
  records(): readonly ResourceRecord[] { return Object.freeze(stableSort([...this.#records.values()], (a, b) => String(a.id).localeCompare(String(b.id)))); }
  stats(): ResidencyStats { let resident = 0; let queued = 0; let loading = 0; for (const record of this.#records.values()) { if (record.state === 'resident') resident += 1; else if (record.state === 'queued') queued += 1; else if (record.state === 'loading') loading += 1; } return Object.freeze({ registered: this.#records.size, resident, residentBytes: this.#residentBytes, queued, loading, evictions: this.#evictions, failures: this.#failures, rejected: this.#rejected }); }
  dispose(): void { this.#disposed = true; this.#records.clear(); this.#queue.length = 0; this.#active.clear(); this.#residentBytes = 0; }
}
