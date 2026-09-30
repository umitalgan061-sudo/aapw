import { clampR29, type R29AssetManifestEntry, type R29AssetRecord, type R29AssetState, type R29ResourceStats } from './contracts.ts';

interface MutableAsset extends R29AssetRecord {
  state: R29AssetState;
  lastUsedTick: number;
  refCount: number;
  failures: number;
  residentBytes: number;
}

export interface R29AssetCacheOptions {
  readonly maxResidentBytes?: number;
  readonly maxEntries?: number;
  readonly coldTicks?: number;
}

export interface R29AssetLoadResult {
  readonly id: string;
  readonly state: R29AssetState;
  readonly bytes: number;
  readonly fromCache: boolean;
  readonly error?: string;
}

export class R29AssetCache {
  readonly maxResidentBytes: number;
  readonly maxEntries: number;
  readonly coldTicks: number;

  #assets = new Map<string, MutableAsset>();
  #reservedBytes = 0;

  constructor(options: R29AssetCacheOptions = {}) {
    this.maxResidentBytes = Math.max(16 * 1024 * 1024, options.maxResidentBytes ?? 384 * 1024 * 1024);
    this.maxEntries = Math.max(16, Math.floor(options.maxEntries ?? 4096));
    this.coldTicks = Math.max(30, Math.floor(options.coldTicks ?? 900));
  }

  declare(entry: R29AssetManifestEntry): void {
    const id = entry.id.trim();
    if (!id) throw new Error('R29_ASSET_ID_EMPTY');
    if (!/^https?:|^\/|^\//.test(entry.url)) throw new Error(`R29_ASSET_URL_INVALID:${id}`);
    const normalized: R29AssetManifestEntry = Object.freeze({
      ...entry,
      id,
      url: entry.url.trim(),
      bytes: Math.max(0, Math.floor(entry.bytes)),
      priority: clampR29(Math.floor(entry.priority), 0, 100),
      version: entry.version.trim() || '1',
      required: Boolean(entry.required),
    });
    const current = this.#assets.get(id);
    if (current) {
      current.manifest = normalized;
      if (current.state === 'resident' && current.residentBytes > normalized.bytes) {
        current.residentBytes = normalized.bytes;
      }
      return;
    }
    this.#assets.set(id, {
      manifest: normalized,
      state: 'declared',
      residentBytes: 0,
      lastUsedTick: 0,
      refCount: 0,
      failures: 0,
    });
  }

  has(id: string): boolean {
    return this.#assets.has(id);
  }

  get(id: string): R29AssetRecord | null {
    const asset = this.#assets.get(id);
    return asset ? this.#public(asset) : null;
  }

  retain(id: string, tick: number): R29AssetRecord | null {
    const asset = this.#assets.get(id);
    if (!asset) return null;
    asset.refCount += 1;
    asset.lastUsedTick = Math.max(asset.lastUsedTick, tick);
    return this.#public(asset);
  }

  release(id: string): R29AssetRecord | null {
    const asset = this.#assets.get(id);
    if (!asset) return null;
    asset.refCount = Math.max(0, asset.refCount - 1);
    return this.#public(asset);
  }

  async load(
    id: string,
    fetcher: (url: string, signal?: AbortSignal) => Promise<number>,
    tick: number,
    signal?: AbortSignal,
  ): Promise<R29AssetLoadResult> {
    const asset = this.#assets.get(id);
    if (!asset) throw new Error(`R29_ASSET_UNDECLARED:${id}`);
    if (asset.state === 'resident') {
      asset.lastUsedTick = tick;
      asset.refCount += 1;
      return Object.freeze({ id, state: 'resident', bytes: asset.residentBytes, fromCache: true });
    }

    asset.state = 'loading';
    this.#reservedBytes += asset.manifest.bytes;
    try {
      const bytes = Math.max(0, Math.floor(await fetcher(asset.manifest.url, signal)));
      const projected = this.residentBytes() + bytes;
      if (projected > this.maxResidentBytes && !asset.manifest.required) {
        asset.state = 'stale';
        return Object.freeze({ id, state: asset.state, bytes: 0, fromCache: false, error: 'memory-budget' });
      }
      this.#evictUntil(projected <= this.maxResidentBytes - this.#reservedBytes + asset.manifest.bytes, tick);
      asset.residentBytes = Math.min(bytes, asset.manifest.bytes || bytes);
      asset.state = 'resident';
      asset.lastUsedTick = tick;
      asset.refCount += 1;
      return Object.freeze({ id, state: asset.state, bytes: asset.residentBytes, fromCache: false });
    } catch (error) {
      asset.failures += 1;
      asset.state = 'failed';
      return Object.freeze({
        id,
        state: asset.state,
        bytes: 0,
        fromCache: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.#reservedBytes = Math.max(0, this.#reservedBytes - asset.manifest.bytes);
    }
  }

  touch(id: string, tick: number): boolean {
    const asset = this.#assets.get(id);
    if (!asset) return false;
    asset.lastUsedTick = Math.max(asset.lastUsedTick, tick);
    return true;
  }

  sweep(tick: number, force = false): readonly string[] {
    const evicted: string[] = [];
    for (const asset of this.#assets.values()) {
      if (asset.state !== 'resident' || asset.refCount > 0) continue;
      if (!force && tick - asset.lastUsedTick < this.coldTicks) continue;
      asset.state = 'stale';
      asset.residentBytes = 0;
      evicted.push(asset.manifest.id);
    }
    this.#enforceEntryLimit();
    return Object.freeze(evicted.sort());
  }

  residentBytes(): number {
    let total = 0;
    for (const asset of this.#assets.values()) total += asset.residentBytes;
    return total;
  }

  stats(): R29ResourceStats {
    return Object.freeze({
      residentBytes: this.residentBytes(),
      reservedBytes: this.#reservedBytes,
      maxBytes: this.maxResidentBytes,
      assetCount: this.#assets.size,
      zoneCount: 0,
    });
  }

  snapshot(): readonly R29AssetRecord[] {
    return Object.freeze(
      [...this.#assets.values()]
        .sort((a, b) => a.manifest.id.localeCompare(b.manifest.id))
        .map((asset) => this.#public(asset)),
    );
  }

  dispose(id?: string): void {
    if (id) {
      const asset = this.#assets.get(id);
      if (asset) {
        asset.state = 'disposed';
        asset.residentBytes = 0;
        asset.refCount = 0;
        this.#assets.delete(id);
      }
      return;
    }
    this.#assets.clear();
    this.#reservedBytes = 0;
  }

  #evictUntil(ok: boolean, tick: number): void {
    if (ok) return;
    const candidates = [...this.#assets.values()]
      .filter((asset) => asset.state === 'resident' && asset.refCount === 0 && !asset.manifest.required)
      .sort((a, b) =>
        a.manifest.priority - b.manifest.priority ||
        a.lastUsedTick - b.lastUsedTick ||
        a.manifest.id.localeCompare(b.manifest.id),
      );
    for (const asset of candidates) {
      asset.state = 'stale';
      asset.residentBytes = 0;
      if (this.residentBytes() <= this.maxResidentBytes) break;
    }
    void tick;
  }

  #enforceEntryLimit(): void {
    if (this.#assets.size <= this.maxEntries) return;
    const candidates = [...this.#assets.values()]
      .filter((asset) => asset.refCount === 0 && !asset.manifest.required)
      .sort((a, b) =>
        a.manifest.priority - b.manifest.priority ||
        a.lastUsedTick - b.lastUsedTick ||
        a.manifest.id.localeCompare(b.manifest.id),
      );
    while (this.#assets.size > this.maxEntries && candidates.length > 0) {
      const asset = candidates.shift();
      if (!asset) break;
      this.#assets.delete(asset.manifest.id);
    }
  }

  #public(asset: MutableAsset): R29AssetRecord {
    return Object.freeze({
      manifest: Object.freeze({ ...asset.manifest }),
      state: asset.state,
      residentBytes: asset.residentBytes,
      lastUsedTick: asset.lastUsedTick,
      refCount: asset.refCount,
      failures: asset.failures,
    });
  }
}
