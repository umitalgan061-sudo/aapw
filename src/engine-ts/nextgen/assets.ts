import { AssetDescriptor, AssetHandle, AssetKind, AssetPriority, clamp, hashString, stableJson } from './contracts.ts';

export interface AssetFetcher {
  fetch(url: string, signal: AbortSignal): Promise<ArrayBuffer>;
}

export interface AssetDecoder<T> {
  readonly kind: AssetKind;
  decode(bytes: ArrayBuffer, descriptor: AssetDescriptor, signal: AbortSignal): Promise<T>;
}

export interface AssetIntegrityPolicy {
  readonly maxBytes: number;
  readonly allowedProtocols: readonly string[];
  readonly allowedExtensions: readonly string[];
  readonly maxRetries: number;
  readonly retryBaseMs: number;
}

export interface AssetMetrics {
  readonly requested: number;
  readonly cacheHits: number;
  readonly decoded: number;
  readonly failed: number;
  readonly bytesDownloaded: number;
  readonly bytesRetained: number;
  readonly evictions: number;
}

interface CacheEntry<T> {
  readonly descriptor: AssetDescriptor;
  readonly value: T;
  readonly bytes: number;
  readonly insertedAt: number;
  lastUsedAt: number;
  refs: number;
}

export const DEFAULT_ASSET_POLICY: AssetIntegrityPolicy = Object.freeze({
  maxBytes: 256 * 1024 * 1024,
  allowedProtocols: Object.freeze(['https:', 'http:', 'blob:']),
  allowedExtensions: Object.freeze(['.glb', '.gltf', '.png', '.jpg', '.jpeg', '.webp', '.ogg', '.mp3', '.json', '.bin', '.ktx2']),
  maxRetries: 2,
  retryBaseMs: 80,
});

export const validateAssetDescriptor = (descriptor: AssetDescriptor, policy = DEFAULT_ASSET_POLICY): readonly string[] => {
  const issues: string[] = [];
  if (!descriptor.id.trim()) issues.push('id-empty');
  if (!Number.isFinite(descriptor.bytes) || descriptor.bytes < 0 || descriptor.bytes > policy.maxBytes) issues.push('size-invalid');
  if (!Number.isInteger(descriptor.version) || descriptor.version < 1) issues.push('version-invalid');
  try {
    const url = new URL(descriptor.url, 'https://aapw.invalid');
    if (!policy.allowedProtocols.includes(url.protocol)) issues.push('protocol-denied');
    const hasExtension = policy.allowedExtensions.some((extension) => url.pathname.toLowerCase().endsWith(extension));
    if (descriptor.kind !== 'data' && !hasExtension) issues.push('extension-denied');
  } catch { issues.push('url-invalid'); }
  if (descriptor.dependencies.some((id) => id === descriptor.id || !id.trim())) issues.push('dependency-invalid');
  return Object.freeze(issues);
};

export const descriptorKey = (descriptor: AssetDescriptor): string => `${descriptor.id}@${descriptor.version}:${hashString(stableJson({ url: descriptor.url, sha256: descriptor.sha256 ?? null, bytes: descriptor.bytes }))}`;

export class MemoryAssetCache<T> {
  readonly #limitBytes: number;
  readonly #entries = new Map<string, CacheEntry<T>>();
  #bytes = 0;
  #evictions = 0;

  constructor(limitBytes: number) { this.#limitBytes = Math.max(1, Math.floor(limitBytes)); }

  get(key: string, now = performance.now()): AssetHandle<T> | undefined {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    entry.lastUsedAt = now;
    entry.refs += 1;
    return Object.freeze({ id: entry.descriptor.id, descriptor: entry.descriptor, value: entry.value, retained: true });
  }

  put(key: string, descriptor: AssetDescriptor, value: T, bytes = descriptor.bytes, now = performance.now()): void {
    const size = Math.max(0, Math.floor(bytes));
    this.delete(key);
    const entry: CacheEntry<T> = { descriptor, value, bytes: size, insertedAt: now, lastUsedAt: now, refs: 0 };
    this.#entries.set(key, entry);
    this.#bytes += size;
    this.#evict();
  }

  release(key: string): void { const entry = this.#entries.get(key); if (entry) entry.refs = Math.max(0, entry.refs - 1); }

  delete(key: string): boolean {
    const entry = this.#entries.get(key);
    if (!entry) return false;
    this.#bytes -= entry.bytes;
    this.#entries.delete(key);
    return true;
  }

  private #evict(): void {
    while (this.#bytes > this.#limitBytes && this.#entries.size > 0) {
      const victim = [...this.#entries.entries()].filter(([, entry]) => entry.refs === 0).sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt || a[0].localeCompare(b[0]))[0];
      if (!victim) break;
      this.delete(victim[0]);
      this.#evictions += 1;
    }
  }

  keys(): readonly string[] { return Object.freeze([...this.#entries.keys()].sort()); }
  bytes(): number { return this.#bytes; }
  evictions(): number { return this.#evictions; }
  clear(): void { this.#entries.clear(); this.#bytes = 0; }
}

export interface AssetPipelineOptions<T> {
  readonly policy?: AssetIntegrityPolicy;
  readonly fetcher: AssetFetcher;
  readonly decoders: readonly AssetDecoder<T>[];
  readonly cacheBytes: number;
  readonly now?: () => number;
}

export class AssetPipeline<T> {
  readonly #policy: AssetIntegrityPolicy;
  readonly #fetcher: AssetFetcher;
  readonly #decoders = new Map<AssetKind, AssetDecoder<T>>();
  readonly #cache: MemoryAssetCache<T>;
  readonly #now: () => number;
  #requested = 0;
  #hits = 0;
  #decoded = 0;
  #failed = 0;
  #downloaded = 0;

  constructor(options: AssetPipelineOptions<T>) {
    this.#policy = options.policy ?? DEFAULT_ASSET_POLICY;
    this.#fetcher = options.fetcher;
    for (const decoder of options.decoders) this.#decoders.set(decoder.kind, decoder);
    this.#cache = new MemoryAssetCache<T>(options.cacheBytes);
    this.#now = options.now ?? (() => performance.now());
  }

  async load(descriptor: AssetDescriptor, signal?: AbortSignal, priority: AssetPriority = descriptor.priority): Promise<AssetHandle<T>> {
    void priority;
    this.#requested += 1;
    const issues = validateAssetDescriptor(descriptor, this.#policy);
    if (issues.length > 0) { this.#failed += 1; throw new Error(`asset rejected: ${issues.join(',')}`); }
    const key = descriptorKey(descriptor);
    const cached = this.#cache.get(key, this.#now());
    if (cached) { this.#hits += 1; return cached; }
    const decoder = this.#decoders.get(descriptor.kind);
    if (!decoder) { this.#failed += 1; throw new Error(`no decoder for ${descriptor.kind}`); }
    const bytes = await this.#fetchWithRetry(descriptor.url, signal);
    this.#downloaded += bytes.byteLength;
    if (bytes.byteLength > this.#policy.maxBytes || (descriptor.bytes > 0 && bytes.byteLength > descriptor.bytes * 1.5)) { this.#failed += 1; throw new Error(`asset payload too large: ${descriptor.id}`); }
    const value = await decoder.decode(bytes, descriptor, signal ?? new AbortController().signal);
    this.#cache.put(key, descriptor, value, bytes.byteLength, this.#now());
    this.#decoded += 1;
    const handle = this.#cache.get(key, this.#now());
    if (!handle) throw new Error(`cache insertion failed: ${descriptor.id}`);
    return handle;
  }

  release(descriptor: AssetDescriptor): void { this.#cache.release(descriptorKey(descriptor)); }

  metrics(): AssetMetrics { return Object.freeze({ requested: this.#requested, cacheHits: this.#hits, decoded: this.#decoded, failed: this.#failed, bytesDownloaded: this.#downloaded, bytesRetained: this.#cache.bytes(), evictions: this.#cache.evictions() }); }

  cacheKeys(): readonly string[] { return this.#cache.keys(); }

  private async #fetchWithRetry(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.#policy.maxRetries; attempt += 1) {
      try { return await this.#fetcher.fetch(url, signal ?? new AbortController().signal); }
      catch (error) {
        lastError = error;
        if (signal?.aborted) throw new DOMException('asset request aborted', 'AbortError');
        if (attempt < this.#policy.maxRetries) await new Promise((resolve) => setTimeout(resolve, this.#policy.retryBaseMs * 2 ** attempt));
      }
    }
    throw lastError instanceof Error ? lastError : new Error('asset fetch failed');
  }
}

export const createFetchAssetFetcher = (): AssetFetcher => ({
  async fetch(url, signal) {
    const response = await fetch(url, { signal, cache: 'force-cache' });
    if (!response.ok) throw new Error(`asset http ${response.status}`);
    return response.arrayBuffer();
  },
});

export const rawBytesDecoder = (kind: AssetKind = 'binary'): AssetDecoder<ArrayBuffer> => ({ kind, async decode(bytes) { return bytes.slice(0); } });
