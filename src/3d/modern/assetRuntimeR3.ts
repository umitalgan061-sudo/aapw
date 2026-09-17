import type { AssetPort, AssetStats, PortResult, ResourceDescriptor } from './portsR3.ts';

export interface AssetLoaderR3 {
  load(descriptor: ResourceDescriptor, signal: AbortSignal): Promise<unknown>;
}

export interface AssetRuntimeOptions {
  readonly maxEntries?: number;
  readonly maxResidentBytes?: number;
  readonly defaultTtlMs?: number;
}

interface AssetEntry {
  readonly descriptor: ResourceDescriptor;
  state: 'registered' | 'loading' | 'ready' | 'failed' | 'evicted';
  value?: unknown;
  error?: unknown;
  residentBytes: number;
  refCount: number;
  lastUsedAt: number;
  expiresAt: number;
  request?: Promise<PortResult<unknown>>;
}

export interface AssetRuntimeSnapshot {
  readonly entries: readonly {
    readonly id: string;
    readonly state: AssetEntry['state'];
    readonly refCount: number;
    readonly residentBytes: number;
    readonly lastUsedAt: number;
  }[];
  readonly stats: AssetStats;
  readonly pressure: number;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

function defaultLoader(): AssetLoaderR3 {
  return {
    async load(descriptor, signal) {
      const response = await fetch(descriptor.url, { signal });
      if (!response.ok) throw new Error(`Asset request failed: ${response.status} ${response.statusText}`);
      if (descriptor.kind === 'json' || descriptor.url.endsWith('.json')) return response.json();
      return response.arrayBuffer();
    },
  };
}

export class AssetRuntimeR3 implements AssetPort {
  readonly #entries = new Map<string, AssetEntry>();
  readonly #loader: AssetLoaderR3;
  readonly #maxEntries: number;
  readonly #maxResidentBytes: number;
  readonly #defaultTtlMs: number;
  #requested = 0;
  #ready = 0;
  #failed = 0;
  #residentBytes = 0;
  #logicalNow = 0;

  constructor(loader = defaultLoader(), options: AssetRuntimeOptions = {}) {
    this.#loader = loader;
    this.#maxEntries = Math.max(8, Math.floor(options.maxEntries ?? 512));
    this.#maxResidentBytes = Math.max(1_048_576, Math.floor(options.maxResidentBytes ?? 256 * 1024 * 1024));
    this.#defaultTtlMs = Math.max(1000, Math.floor(options.defaultTtlMs ?? 120_000));
  }

  register(descriptor: ResourceDescriptor): void {
    if (!descriptor.id.trim() || !descriptor.url.trim()) throw new Error('Asset descriptor id and url are required.');
    if (this.#entries.has(descriptor.id)) return;
    this.#entries.set(descriptor.id, {
      descriptor: { ...descriptor, tags: [...new Set(descriptor.tags)] },
      state: 'registered',
      residentBytes: 0,
      refCount: 0,
      lastUsedAt: this.#logicalNow,
      expiresAt: this.#logicalNow + this.#defaultTtlMs,
    });
    this.#trimEntries();
  }

  async load<T>(id: string, signal?: AbortSignal): Promise<PortResult<T>> {
    const entry = this.#entries.get(id);
    if (!entry) return { ok: false, error: { code: 'ASSET_UNKNOWN', message: `Unknown asset: ${id}`, retryable: false } };
    this.#logicalNow = Math.max(this.#logicalNow, performance.now?.() ?? 0);
    entry.lastUsedAt = this.#logicalNow;
    entry.expiresAt = this.#logicalNow + this.#defaultTtlMs;
    if (entry.state === 'ready' && entry.value !== undefined) return { ok: true, value: entry.value as T };
    if (entry.request) return (await entry.request) as PortResult<T>;

    entry.state = 'loading';
    this.#requested += 1;
    const request = this.#loader.load(entry.descriptor, signal ?? new AbortController().signal)
      .then((value): PortResult<unknown> => {
        entry.state = 'ready';
        entry.value = value;
        entry.residentBytes = this.#estimateBytes(value, entry.descriptor.bytes);
        this.#residentBytes += entry.residentBytes;
        this.#ready += 1;
        this.#trimResidentMemory(id);
        return { ok: true, value };
      })
      .catch((error): PortResult<unknown> => {
        entry.state = 'failed';
        entry.error = error;
        this.#failed += 1;
        return { ok: false, error: { code: 'ASSET_LOAD', message: error instanceof Error ? error.message : String(error), retryable: true } };
      })
      .finally(() => { entry.request = undefined; });
    entry.request = request;
    return (await request) as PortResult<T>;
  }

  retain(id: string): void {
    const entry = this.#entries.get(id);
    if (!entry) throw new Error(`Cannot retain unknown asset: ${id}`);
    entry.refCount += 1;
    entry.lastUsedAt = this.#logicalNow;
  }

  release(id: string): void {
    const entry = this.#entries.get(id);
    if (!entry) return;
    entry.refCount = Math.max(0, entry.refCount - 1);
    entry.lastUsedAt = this.#logicalNow;
  }

  touch(id: string, now = this.#logicalNow): void {
    const entry = this.#entries.get(id);
    if (!entry) return;
    this.#logicalNow = Math.max(this.#logicalNow, Number.isFinite(now) ? now : this.#logicalNow);
    entry.lastUsedAt = this.#logicalNow;
    entry.expiresAt = this.#logicalNow + this.#defaultTtlMs;
  }

  invalidate(id?: string): void {
    if (id) {
      this.#evict(id);
      return;
    }
    for (const key of [...this.#entries.keys()]) this.#evict(key, true);
  }

  advance(nowMs: number): void {
    this.#logicalNow = Math.max(this.#logicalNow, Number.isFinite(nowMs) ? nowMs : this.#logicalNow);
    for (const [id, entry] of this.#entries) {
      if (entry.refCount === 0 && entry.state === 'ready' && entry.expiresAt <= this.#logicalNow) this.#evict(id);
    }
    this.#trimEntries();
  }

  stats(): AssetStats {
    return {
      requested: this.#requested,
      ready: this.#ready,
      failed: this.#failed,
      residentBytes: this.#residentBytes,
    };
  }

  snapshot(): AssetRuntimeSnapshot {
    const stats = this.stats();
    return {
      entries: [...this.#entries.values()]
        .map((entry) => ({ id: entry.descriptor.id, state: entry.state, refCount: entry.refCount, residentBytes: entry.residentBytes, lastUsedAt: entry.lastUsedAt }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      stats,
      pressure: clamp(stats.residentBytes / this.#maxResidentBytes, 0, 2),
    };
  }

  #estimateBytes(value: unknown, declared?: number): number {
    if (declared && Number.isFinite(declared)) return Math.max(0, Math.floor(declared));
    if (value instanceof ArrayBuffer) return value.byteLength;
    if (ArrayBuffer.isView(value)) return value.byteLength;
    try {
      return Math.max(128, JSON.stringify(value).length * 2);
    } catch {
      return 128;
    }
  }

  #trimResidentMemory(protectedId: string): void {
    if (this.#residentBytes <= this.#maxResidentBytes) return;
    const candidates = [...this.#entries.values()]
      .filter((entry) => entry.descriptor.id !== protectedId && entry.refCount === 0 && entry.state === 'ready')
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt || a.descriptor.priority - b.descriptor.priority);
    for (const entry of candidates) {
      if (this.#residentBytes <= this.#maxResidentBytes) break;
      this.#evict(entry.descriptor.id);
    }
  }

  #trimEntries(): void {
    if (this.#entries.size <= this.#maxEntries) return;
    const candidates = [...this.#entries.values()]
      .filter((entry) => entry.refCount === 0 && !entry.request)
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    for (const entry of candidates) {
      if (this.#entries.size <= this.#maxEntries) break;
      this.#evict(entry.descriptor.id);
    }
  }

  #evict(id: string, keepDescriptor = false): void {
    const entry = this.#entries.get(id);
    if (!entry) return;
    if (entry.refCount > 0 && !keepDescriptor) return;
    this.#residentBytes = Math.max(0, this.#residentBytes - entry.residentBytes);
    entry.residentBytes = 0;
    entry.value = undefined;
    entry.error = undefined;
    entry.state = 'evicted';
    entry.request = undefined;
    if (!keepDescriptor) this.#entries.delete(id);
  }
}

export function createAssetDescriptor(id: string, url: string, kind: ResourceDescriptor['kind'], priority = 2): ResourceDescriptor {
  return {
    id,
    url,
    kind,
    priority: clamp(Math.floor(priority), 0, 4) as ResourceDescriptor['priority'],
    tags: [],
  };
}
