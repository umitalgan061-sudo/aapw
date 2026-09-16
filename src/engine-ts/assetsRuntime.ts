import type { AssetKey, Budget, Disposable, EngineResult } from './types.js';
import { hashTuple, toHex32 } from './deterministic.js';

export type AssetKind = 'model' | 'texture' | 'audio' | 'shader' | 'json' | 'font' | 'binary';
export type AssetState = 'registered' | 'queued' | 'loading' | 'ready' | 'stale' | 'failed' | 'evicted';

export interface AssetManifestEntry {
  readonly id: AssetKey;
  readonly url: string;
  readonly kind: AssetKind;
  readonly bytes: number;
  readonly priority: number;
  readonly optional: boolean;
  readonly digest: string;
  readonly dependencies: readonly AssetKey[];
}

export interface AssetRecord extends AssetManifestEntry {
  readonly state: AssetState;
  readonly generation: number;
  readonly lastUsedAt: number;
  readonly failureCount: number;
  readonly loadedBytes: number;
}

export interface AssetLoadAdapter {
  load(entry: AssetManifestEntry, signal: AbortSignal): Promise<ArrayBuffer>;
}

export interface AssetRequest {
  readonly id: AssetKey;
  readonly priority: number;
  readonly queuedAt: number;
  readonly reason: 'visible' | 'prefetch' | 'dependency' | 'restore' | 'manual';
}

export interface AssetRuntimeOptions {
  readonly now?: () => number;
  readonly maxConcurrent?: number;
  readonly maxQueue?: number;
  readonly maxBytes?: number;
  readonly budget?: Partial<Budget>;
  readonly adapter?: AssetLoadAdapter;
}

export interface AssetRuntimeStats {
  readonly registered: number;
  readonly queued: number;
  readonly loading: number;
  readonly ready: number;
  readonly failed: number;
  readonly residentBytes: number;
  readonly evictions: number;
  readonly rejected: number;
}

const noopAdapter: AssetLoadAdapter = Object.freeze({
  async load() { return new ArrayBuffer(0); },
});

function digestBytes(buffer: ArrayBuffer): string {
  return toHex32(hashTuple(...new Uint8Array(buffer).slice(0, 4096)));
}

function validUrl(url: string): boolean {
  try {
    const parsed = new URL(url, typeof location !== 'undefined' ? location.href : 'https://aapw.invalid/');
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' || parsed.protocol === 'file:';
  } catch {
    return false;
  }
}

function kindBudget(kind: AssetKind, budget: Budget): number {
  switch (kind) {
    case 'texture': return Math.max(1024, budget.assetBytes * 0.55);
    case 'model': return Math.max(1024, budget.assetBytes * 0.75);
    case 'audio': return Math.max(1024, budget.assetBytes * 0.35);
    default: return Math.max(1024, budget.assetBytes);
  }
}

export class AssetRuntime implements Disposable {
  readonly adapter: AssetLoadAdapter;
  readonly maxConcurrent: number;
  readonly maxQueue: number;
  readonly maxBytes: number;
  readonly budget: Budget;
  #now: () => number;
  #assets = new Map<AssetKey, AssetRecord>();
  #queue: AssetRequest[] = [];
  #active = new Map<AssetKey, AbortController>();
  #residentBytes = 0;
  #evictions = 0;
  #rejected = 0;
  #disposed = false;

  constructor(options: AssetRuntimeOptions = {}) {
    this.adapter = options.adapter ?? noopAdapter;
    this.maxConcurrent = Math.max(1, Math.min(16, Math.trunc(options.maxConcurrent ?? 4)));
    this.maxQueue = Math.max(16, Math.min(4096, Math.trunc(options.maxQueue ?? 512)));
    this.maxBytes = Math.max(1024 * 1024, Math.trunc(options.maxBytes ?? 256 * 1024 * 1024));
    this.budget = { cpuMs: 12, gpuMs: 12, networkBytes: 256_000, assetBytes: 16_000_000, drawCalls: 800, triangles: 900_000, ...options.budget };
    this.#now = options.now ?? (() => typeof performance !== 'undefined' ? performance.now() : Date.now());
  }

  register(entry: AssetManifestEntry): EngineResult<AssetRecord> {
    if (this.#disposed) return this.fail('ASSET_RUNTIME_DISPOSED');
    if (!entry.id || !validUrl(entry.url)) return this.fail('ASSET_MANIFEST_INVALID');
    if (!Number.isFinite(entry.bytes) || entry.bytes < 0 || entry.bytes > this.maxBytes) return this.fail('ASSET_BYTES_INVALID');
    const existing = this.#assets.get(entry.id);
    if (existing && existing.digest === entry.digest) return { ok: true, value: existing };
    const record: AssetRecord = Object.freeze({
      ...entry,
      dependencies: Object.freeze([...new Set(entry.dependencies)]),
      priority: Math.max(0, Math.min(1000, entry.priority)),
      state: 'registered', generation: (existing?.generation ?? 0) + 1,
      lastUsedAt: this.#now(), failureCount: 0, loadedBytes: 0,
    });
    this.#assets.set(entry.id, record);
    return { ok: true, value: record };
  }

  request(id: AssetKey, reason: AssetRequest['reason'] = 'manual', boost = 0): boolean {
    if (this.#disposed || this.#queue.length >= this.maxQueue) { this.#rejected += 1; return false; }
    const asset = this.#assets.get(id);
    if (!asset || asset.state === 'ready' || this.#active.has(id)) return false;
    if (this.#queue.some(item => item.id === id)) return false;
    const priority = asset.priority + boost + (reason === 'visible' ? 300 : reason === 'dependency' ? 220 : reason === 'restore' ? 150 : 0);
    this.#queue.push({ id, priority, queuedAt: this.#now(), reason });
    this.#setState(id, 'queued');
    this.#queue.sort((a, b) => b.priority - a.priority || a.queuedAt - b.queuedAt || String(a.id).localeCompare(String(b.id)));
    return true;
  }

  async pump(): Promise<void> {
    if (this.#disposed) return;
    while (this.#active.size < this.maxConcurrent && this.#queue.length > 0) {
      const request = this.#queue.shift()!;
      await this.#start(request);
    }
  }

  async load(id: AssetKey, reason: AssetRequest['reason'] = 'manual'): Promise<EngineResult<AssetRecord>> {
    const asset = this.#assets.get(id);
    if (!asset) return this.fail('ASSET_NOT_REGISTERED');
    if (asset.state === 'ready') { this.#touch(id); return { ok: true, value: asset }; }
    this.request(id, reason, 50);
    await this.pump();
    const updated = this.#assets.get(id);
    return updated?.state === 'ready' ? { ok: true, value: updated } : this.fail('ASSET_LOAD_DEFERRED');
  }

  evict(id: AssetKey): boolean {
    const asset = this.#assets.get(id);
    if (!asset || asset.state !== 'ready' || this.#active.has(id)) return false;
    this.#residentBytes = Math.max(0, this.#residentBytes - asset.loadedBytes);
    this.#assets.set(id, Object.freeze({ ...asset, state: 'evicted', loadedBytes: 0 }));
    this.#evictions += 1;
    return true;
  }

  evictToBudget(targetBytes = this.maxBytes): number {
    const target = Math.max(0, Math.min(this.maxBytes, targetBytes));
    const candidates = [...this.#assets.values()]
      .filter(asset => asset.state === 'ready' && !this.#active.has(asset.id))
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt || a.priority - b.priority);
    let count = 0;
    for (const asset of candidates) {
      if (this.#residentBytes <= target) break;
      if (this.evict(asset.id)) count += 1;
    }
    return count;
  }

  has(id: AssetKey): boolean { return this.#assets.get(id)?.state === 'ready'; }
  get(id: AssetKey): AssetRecord | undefined { return this.#assets.get(id); }
  records(): readonly AssetRecord[] { return Object.freeze([...this.#assets.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)))); }
  stats(): AssetRuntimeStats {
    let queued = 0; let loading = 0; let ready = 0; let failed = 0;
    for (const asset of this.#assets.values()) {
      if (asset.state === 'queued') queued += 1;
      else if (asset.state === 'loading') loading += 1;
      else if (asset.state === 'ready') ready += 1;
      else if (asset.state === 'failed') failed += 1;
    }
    return Object.freeze({ registered: this.#assets.size, queued, loading, ready, failed, residentBytes: this.#residentBytes, evictions: this.#evictions, rejected: this.#rejected });
  }

  dispose(): void {
    this.#disposed = true;
    for (const controller of this.#active.values()) controller.abort();
    this.#active.clear();
    this.#queue.length = 0;
    this.#assets.clear();
    this.#residentBytes = 0;
  }

  #touch(id: AssetKey): void {
    const asset = this.#assets.get(id);
    if (!asset) return;
    this.#assets.set(id, Object.freeze({ ...asset, lastUsedAt: this.#now() }));
  }

  async #start(request: AssetRequest): Promise<void> {
    const asset = this.#assets.get(request.id);
    if (!asset) return;
    const controller = new AbortController();
    this.#active.set(request.id, controller);
    this.#setState(request.id, 'loading');
    try {
      const buffer = await this.adapter.load(asset, controller.signal);
      if (controller.signal.aborted) return;
      if (buffer.byteLength !== asset.bytes) throw new Error('ASSET_SIZE_MISMATCH');
      if (asset.bytes > kindBudget(asset.kind, this.budget)) throw new Error('ASSET_KIND_BUDGET');
      if (asset.digest && asset.digest !== digestBytes(buffer)) throw new Error('ASSET_DIGEST_MISMATCH');
      this.#residentBytes += buffer.byteLength;
      this.#setState(request.id, 'ready', { loadedBytes: buffer.byteLength });
      if (this.#residentBytes > this.maxBytes) this.evictToBudget(this.maxBytes * 0.9);
    } catch {
      const failed = this.#assets.get(request.id);
      if (failed) {
        this.#assets.set(request.id, Object.freeze({ ...failed, state: 'failed', failureCount: failed.failureCount + 1, lastUsedAt: this.#now() }));
      }
    } finally {
      this.#active.delete(request.id);
    }
  }

  #setState(id: AssetKey, state: AssetState, extra: Partial<AssetRecord> = {}): void {
    const asset = this.#assets.get(id);
    if (!asset) return;
    this.#assets.set(id, Object.freeze({ ...asset, ...extra, state, lastUsedAt: this.#now() }));
  }

  #fail<T>(code: string): EngineResult<T> { return { ok: false, meta: { status: 'rejected', code } }; }
}
