import type { PlatformError, ResourceDescriptor, Result } from './types';
import { checksum, stableStringify } from './deterministic';
import { validateAssetUrl, validateManifest, type AssetManifestEntry, DEFAULT_ASSET_POLICY, type AssetPolicy } from './assetPolicy';
import { Diagnostics } from './diagnostics';
import { ResourceRegistry, type ResourceLoader } from './resourceRegistry';

export interface AssetLoadOptions {
  readonly signal?: AbortSignal;
  readonly baseUrl?: string;
  readonly expectedBytes?: number;
  readonly cache?: RequestCache;
}

export interface AssetFetchResult {
  readonly url: string;
  readonly status: number;
  readonly bytes: number;
  readonly mime: string;
  readonly checksum: string;
  readonly buffer: ArrayBuffer;
}

export interface AssetRuntimeStats {
  readonly manifestEntries: number;
  readonly residentBytes: number;
  readonly budgetBytes: number;
  readonly ready: number;
  readonly requests: number;
  readonly cacheHits: number;
  readonly failures: number;
  readonly digest: string;
}

export interface AssetRuntimeOptions {
  readonly registry?: ResourceRegistry<unknown>;
  readonly policy?: AssetPolicy;
  readonly diagnostics?: Diagnostics;
  readonly baseUrl?: string;
  readonly fetcher?: typeof fetch;
}

function normalizeBaseUrl(baseUrl?: string): string {
  if (baseUrl) return new URL(baseUrl, typeof location !== 'undefined' ? location.href : 'http://localhost/').href;
  return typeof location !== 'undefined' ? location.href : 'http://localhost/';
}

function failure(code: string, message: string, retryable = false, cause?: unknown): Result<never> {
  const error: PlatformError = { code, message, retryable, cause };
  return { ok: false, error };
}

/**
 * Asset boundary that combines manifest validation, URL policy and bounded resource residency.
 * The class never silently trusts a remote manifest and never bypasses ResourceRegistry lifecycle.
 */
export class AssetRuntime {
  readonly registry: ResourceRegistry<unknown>;
  readonly policy: AssetPolicy;
  readonly diagnostics: Diagnostics;

  #baseUrl: string;
  #fetcher: typeof fetch;
  #manifest = new Map<string, AssetManifestEntry>();
  #requests = 0;
  #cacheHits = 0;
  #failures = 0;
  #inflight = new Map<string, Promise<Result<unknown>>>();

  constructor(options: AssetRuntimeOptions = {}) {
    this.registry = options.registry ?? new ResourceRegistry({ budgetBytes: options.policy?.maxAssetBytes ?? DEFAULT_ASSET_POLICY.maxAssetBytes });
    this.policy = options.policy ?? DEFAULT_ASSET_POLICY;
    this.diagnostics = options.diagnostics ?? new Diagnostics();
    this.#baseUrl = normalizeBaseUrl(options.baseUrl);
    this.#fetcher = options.fetcher ?? fetch;
  }

  registerManifest(entries: readonly AssetManifestEntry[]): Result<number> {
    const validation = validateManifest(entries, this.policy);
    if (!validation.ok) {
      this.#failures += 1;
      this.diagnostics.error(validation.error.code, validation.error.message, 'assets');
      return validation;
    }
    this.#manifest.clear();
    for (const entry of entries) {
      const url = validateAssetUrl(entry.url, this.#baseUrl, this.policy);
      if (!url.ok) {
        this.#failures += 1;
        this.diagnostics.error(url.error.code, url.error.message, 'assets', { id: entry.id });
        return url;
      }
      this.#manifest.set(entry.id, Object.freeze({ ...entry, url: url.value.href, tags: [...entry.tags] }));
      this.registry.register(entry);
    }
    this.diagnostics.info('ASSET_MANIFEST_READY', `Registered ${entries.length} assets`, 'assets', { digest: checksum(entries) });
    return { ok: true, value: entries.length };
  }

  manifest(): readonly AssetManifestEntry[] {
    return [...this.#manifest.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  descriptor(id: string): AssetManifestEntry | undefined {
    const entry = this.#manifest.get(id);
    return entry ? structuredClone(entry) : undefined;
  }

  registerLoader(kind: ResourceDescriptor['kind'], loader: ResourceLoader<unknown>): void {
    this.registry.registerLoader(kind, loader);
  }

  async acquire(id: string, options: AssetLoadOptions = {}): Promise<Result<unknown>> {
    const entry = this.#manifest.get(id);
    if (!entry) return failure('ASSET_UNKNOWN_ID', `Unknown asset ${id}`);
    const current = this.#inflight.get(id);
    if (current) return current;
    const load = this.#acquireInternal(entry, options);
    this.#inflight.set(id, load);
    try {
      return await load;
    } finally {
      this.#inflight.delete(id);
    }
  }

  release(id: string): boolean {
    return this.registry.release(id);
  }

  evict(id: string): boolean {
    return this.registry.evict(id);
  }

  async prefetch(ids: readonly string[], options: AssetLoadOptions = {}): Promise<readonly Result<unknown>[]> {
    const unique = [...new Set(ids)].slice(0, 128);
    const results: Result<unknown>[] = [];
    for (const id of unique) results.push(await this.acquire(id, options));
    return results;
  }

  stats(): AssetRuntimeStats {
    const registryStats = this.registry.stats();
    return Object.freeze({
      manifestEntries: this.#manifest.size,
      residentBytes: registryStats.residentBytes,
      budgetBytes: registryStats.budgetBytes,
      ready: registryStats.ready,
      requests: this.#requests,
      cacheHits: this.#cacheHits,
      failures: this.#failures,
      digest: checksum({ manifest: this.manifest(), registry: registryStats, requests: this.#requests, hits: this.#cacheHits, failures: this.#failures }),
    });
  }

  digest(): string {
    return checksum(stableStringify({ manifest: this.manifest(), stats: this.stats() }));
  }

  async fetchBytes(url: string, options: AssetLoadOptions = {}): Promise<Result<AssetFetchResult>> {
    const validation = validateAssetUrl(url, options.baseUrl ?? this.#baseUrl, this.policy);
    if (!validation.ok) return validation;
    this.#requests += 1;
    try {
      const response = await this.#fetcher(validation.value.href, {
        method: 'GET',
        cache: options.cache ?? 'default',
        signal: options.signal,
      });
      if (!response.ok) {
        this.#failures += 1;
        return failure('ASSET_FETCH_FAILED', `Asset request returned HTTP ${response.status}`, response.status >= 500);
      }
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > this.policy.maxAssetBytes) {
        this.#failures += 1;
        return failure('ASSET_FETCH_TOO_LARGE', `Asset exceeded ${this.policy.maxAssetBytes} bytes`);
      }
      if (options.expectedBytes !== undefined && Math.max(0, Math.floor(options.expectedBytes)) !== bytes.byteLength) {
        this.#failures += 1;
        return failure('ASSET_SIZE_MISMATCH', `Expected ${options.expectedBytes} bytes but received ${bytes.byteLength}`);
      }
      const result: AssetFetchResult = {
        url: validation.value.href,
        status: response.status,
        bytes: bytes.byteLength,
        mime: response.headers.get('content-type') ?? 'application/octet-stream',
        checksum: checksum(new Uint8Array(bytes)),
        buffer: bytes,
      };
      return { ok: true, value: result };
    } catch (cause) {
      this.#failures += 1;
      return failure('ASSET_NETWORK_ERROR', String(cause), true, cause);
    }
  }

  clear(): void {
    this.#manifest.clear();
    this.registry.clear();
    this.#inflight.clear();
  }

  async #acquireInternal(entry: AssetManifestEntry, options: AssetLoadOptions): Promise<Result<unknown>> {
    const cached = this.registry.get(entry.id);
    if (cached?.state === 'ready' && cached.value !== undefined) {
      this.#cacheHits += 1;
      return this.registry.acquire(entry.id, options.signal);
    }
    return this.registry.acquire(entry.id, options.signal);
  }
}

export function createAssetRuntime(options: AssetRuntimeOptions = {}): AssetRuntime {
  return new AssetRuntime(options);
}
