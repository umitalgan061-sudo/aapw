import { sanitizeId, sanitizeText } from '../runtimeSecurityV2.ts';

export type AssetKind = 'model' | 'texture' | 'audio' | 'shader' | 'font' | 'data';
export type AssetState = 'declared' | 'loading' | 'ready' | 'stale' | 'failed' | 'disposed';
export interface AssetDescriptor { readonly id: string; readonly kind: AssetKind; readonly url: string; readonly bytesHint: number; readonly priority: number; readonly tags: readonly string[]; readonly critical: boolean; readonly version: string; }
export interface AssetRecord extends AssetDescriptor { readonly state: AssetState; readonly generation: number; readonly loadedBytes: number; readonly lastUsedMs: number; readonly failureCount: number; readonly error?: string; }
export interface AssetCatalogOptions { readonly maxEntries?: number; readonly maxBytes?: number; readonly now?: () => number; }

const normalizeUrl = (value: string): string => {
  const url = value.trim();
  if (!url) return '';
  try {
    const parsed = new URL(url, typeof location !== 'undefined' ? location.href : 'https://aapw.local/');
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:' && parsed.protocol !== 'blob:' && parsed.protocol !== 'data:') return '';
    return parsed.toString();
  } catch { return ''; }
};

export class AssetCatalog {
  readonly #maxEntries: number;
  readonly #maxBytes: number;
  readonly #now: () => number;
  readonly #records = new Map<string, AssetRecord>();
  #residentBytes = 0;
  #generation = 0;

  constructor(options: AssetCatalogOptions = {}) {
    this.#maxEntries = Math.max(32, Math.floor(options.maxEntries ?? 4096));
    this.#maxBytes = Math.max(8 * 1024 * 1024, Math.floor(options.maxBytes ?? 512 * 1024 * 1024));
    this.#now = options.now ?? (() => Date.now());
  }

  declare(descriptor: AssetDescriptor): AssetRecord {
    const id = sanitizeId(descriptor.id);
    if (!id) throw new Error('Asset id is required.');
    const url = normalizeUrl(descriptor.url);
    if (!url) throw new Error('Asset url is invalid for ' + id);
    const previous = this.#records.get(id);
    if (previous) this.#residentBytes -= previous.loadedBytes;
    const next: AssetRecord = Object.freeze({
      id,
      kind: descriptor.kind,
      url,
      bytesHint: Math.max(0, Math.floor(descriptor.bytesHint)),
      priority: Math.max(-1000, Math.min(1000, Math.floor(descriptor.priority))),
      tags: Object.freeze(descriptor.tags.map((tag) => sanitizeText(tag, 64))),
      critical: Boolean(descriptor.critical),
      version: sanitizeText(descriptor.version, 64),
      state: 'declared',
      generation: ++this.#generation,
      loadedBytes: 0,
      lastUsedMs: this.#now(),
      failureCount: previous?.failureCount ?? 0,
    });
    this.#records.set(id, next);
    this.#enforceEntryLimit();
    return next;
  }

  markLoading(id: string): AssetRecord | undefined { return this.#transition(id, 'loading'); }
  markReady(id: string, loadedBytes: number): AssetRecord | undefined {
    const record = this.#records.get(sanitizeId(id));
    if (!record) return undefined;
    this.#residentBytes -= record.loadedBytes;
    this.#residentBytes += Math.max(0, Math.floor(loadedBytes));
    const next = Object.freeze({ ...record, state: 'ready' as const, loadedBytes: Math.max(0, Math.floor(loadedBytes)), lastUsedMs: this.#now(), error: undefined });
    this.#records.set(record.id, next);
    this.#enforceByteLimit();
    return this.#records.get(record.id);
  }
  markFailed(id: string, error: unknown): AssetRecord | undefined {
    const record = this.#records.get(sanitizeId(id));
    if (!record) return undefined;
    return this.#replace(record, { state: 'failed', failureCount: record.failureCount + 1, error: sanitizeText(error instanceof Error ? error.message : String(error), 512) });
  }
  touch(id: string): AssetRecord | undefined {
    const record = this.#records.get(sanitizeId(id));
    return record ? this.#replace(record, { lastUsedMs: this.#now() }) : undefined;
  }
  dispose(id: string): AssetRecord | undefined {
    const record = this.#records.get(sanitizeId(id));
    if (!record) return undefined;
    return this.#replace(record, { state: 'disposed', loadedBytes: 0 });
  }

  get(id: string): AssetRecord | undefined { return this.#records.get(sanitizeId(id)); }
  values(): readonly AssetRecord[] { return Object.freeze([...this.#records.values()]); }
  count(): number { return this.#records.size; }
  residentBytes(): number { return this.#residentBytes; }
  utilization(): number { return Math.min(1, this.#residentBytes / this.#maxBytes); }

  selectEvictions(targetBytes = 0): readonly AssetRecord[] {
    let freed = 0;
    const candidates = [...this.#records.values()]
      .filter((record) => record.state === 'ready' && !record.critical)
      .sort((a, b) => this.#evictionScore(a) - this.#evictionScore(b));
    const result: AssetRecord[] = [];
    for (const record of candidates) {
      if (freed >= targetBytes && targetBytes > 0) break;
      result.push(record);
      freed += record.loadedBytes;
    }
    return Object.freeze(result);
  }

  evictCold(targetBytes: number): number {
    let freed = 0;
    for (const record of this.selectEvictions(targetBytes)) {
      const current = this.#records.get(record.id);
      if (!current) continue;
      this.#records.set(record.id, Object.freeze({ ...current, state: 'stale', loadedBytes: 0 }));
      this.#residentBytes -= current.loadedBytes;
      freed += current.loadedBytes;
    }
    return freed;
  }

  snapshot(): Readonly<{ count: number; residentBytes: number; maxBytes: number; utilization: number; ready: number; failed: number; stale: number }> {
    let ready = 0, failed = 0, stale = 0;
    for (const record of this.#records.values()) { if (record.state === 'ready') ready += 1; if (record.state === 'failed') failed += 1; if (record.state === 'stale') stale += 1; }
    return Object.freeze({ count: this.count(), residentBytes: this.#residentBytes, maxBytes: this.#maxBytes, utilization: this.utilization(), ready, failed, stale });
  }

  #replace(record: AssetRecord, patch: Partial<AssetRecord>): AssetRecord {
    const next = Object.freeze({ ...record, ...patch, generation: ++this.#generation, loadedBytes: Math.max(0, Number(patch.loadedBytes ?? record.loadedBytes)) });
    this.#residentBytes += next.loadedBytes - record.loadedBytes;
    this.#records.set(record.id, next);
    return next;
  }
  #transition(id: string, state: AssetState): AssetRecord | undefined { const record = this.#records.get(sanitizeId(id)); return record ? this.#replace(record, { state }) : undefined; }
  #evictionScore(record: AssetRecord): number { return record.priority * 10 + (this.#now() - record.lastUsedMs) * -0.001 + record.loadedBytes * -0.000001; }
  #enforceEntryLimit(): void { while (this.#records.size > this.#maxEntries) { const candidate = this.selectEvictions(1)[0] ?? [...this.#records.values()][0]; if (!candidate) break; this.#records.delete(candidate.id); this.#residentBytes -= candidate.loadedBytes; } }
  #enforceByteLimit(): void { if (this.#residentBytes <= this.#maxBytes) return; this.evictCold(this.#residentBytes - this.#maxBytes); }
}

export const assetDescriptor = (input: Partial<AssetDescriptor> & Pick<AssetDescriptor, 'id' | 'kind' | 'url'>): AssetDescriptor => Object.freeze({ id: input.id, kind: input.kind, url: input.url, bytesHint: input.bytesHint ?? 0, priority: input.priority ?? 0, tags: Object.freeze([...(input.tags ?? [])]), critical: input.critical ?? false, version: input.version ?? '1' });
