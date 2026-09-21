import type { UnixMillis } from './types';
import { RuntimeSecurityBoundary } from './runtimeSecurity';

export type CacheState = 'cold' | 'warming' | 'ready' | 'stale' | 'evicted' | 'failed';

export interface CacheEntry {
  readonly key: string;
  readonly url: string;
  readonly state: CacheState;
  readonly bytes: number;
  readonly createdAt: UnixMillis;
  readonly accessedAt: UnixMillis;
  readonly expiresAt: UnixMillis | null;
  readonly hits: number;
  readonly misses: number;
  readonly etag: string | null;
}

export interface CacheStats {
  readonly entries: number;
  readonly bytes: number;
  readonly hits: number;
  readonly misses: number;
  readonly stale: number;
  readonly evictions: number;
  readonly hitRate: number;
}

export interface CacheCoordinatorOptions {
  readonly cacheName?: string;
  readonly maxBytes?: number;
  readonly maxEntries?: number;
  readonly ttlMs?: number;
  readonly now?: () => UnixMillis;
  readonly security?: RuntimeSecurityBoundary;
}

function finite(value: number, fallback = 0): number { return Number.isFinite(value) ? value : fallback; }
function keyFor(url: string): string {
  try { return new URL(url, typeof location !== 'undefined' ? location.href : 'https://aapw.invalid/').toString(); }
  catch { return url.slice(0, 1024); }
}

/**
 * Browser Cache API coordinator with explicit memory/entry bounds. It is safe to disable in tests or
 * unsupported browsers and never assumes CacheStorage exists.
 */
export class CacheCoordinator {
  readonly cacheName: string;
  readonly maxBytes: number;
  readonly maxEntries: number;
  readonly ttlMs: number;
  readonly security: RuntimeSecurityBoundary;
  #now: () => UnixMillis;
  #entries = new Map<string, CacheEntry>();
  #bytes = 0;
  #hits = 0;
  #misses = 0;
  #evictions = 0;
  #cache: Cache | null = null;

  constructor(options: CacheCoordinatorOptions = {}) {
    this.cacheName = options.cacheName ?? 'aapw-runtime-v1';
    this.maxBytes = Math.max(1 * 1024 * 1024, Math.min(1024 * 1024 * 1024, Math.trunc(options.maxBytes ?? 256 * 1024 * 1024)));
    this.maxEntries = Math.max(8, Math.min(10_000, Math.trunc(options.maxEntries ?? 2048)));
    this.ttlMs = Math.max(1_000, Math.min(30 * 24 * 60 * 60 * 1000, Math.trunc(options.ttlMs ?? 7 * 24 * 60 * 60 * 1000)));
    this.#now = options.now ?? (() => Date.now() as UnixMillis);
    this.security = options.security ?? new RuntimeSecurityBoundary();
  }

  get supported(): boolean { return typeof caches !== 'undefined'; }

  async open(): Promise<boolean> {
    if (!this.supported) return false;
    try {
      this.#cache = await caches.open(this.cacheName);
      return true;
    } catch { this.#cache = null; return false; }
  }

  async put(url: string, response: Response, options: { readonly etag?: string; readonly ttlMs?: number } = {}): Promise<boolean> {
    const checked = this.security.checkUrl(url, 'asset');
    if (!checked.accepted) return false;
    if (!this.#cache && !(await this.open())) return false;
    const clone = response.clone();
    let bytes: number;
    try { bytes = await this.#estimateBytes(clone); } catch { return false; }
    if (bytes > this.maxBytes) return false;
    const key = keyFor(checked.normalized!);
    await this.#evictUntil(bytes);
    try {
      await this.#cache!.put(key, response.clone());
      const now = this.#now();
      const previous = this.#entries.get(key);
      if (previous) this.#bytes = Math.max(0, this.#bytes - previous.bytes);
      const entry: CacheEntry = Object.freeze({ key, url: key, state: 'ready', bytes, createdAt: now, accessedAt: now, expiresAt: now + Math.max(1_000, Math.trunc(options.ttlMs ?? this.ttlMs)), hits: previous?.hits ?? 0, misses: previous?.misses ?? 0, etag: options.etag ?? previous?.etag ?? null });
      this.#entries.set(key, entry);
      this.#bytes += bytes;
      await this.#enforceEntryLimit();
      return true;
    } catch { return false; }
  }

  async match(url: string): Promise<Response | null> {
    const checked = this.security.checkUrl(url, 'asset');
    if (!checked.accepted || !this.#cache) { this.#misses += 1; return null; }
    const key = keyFor(checked.normalized!);
    const entry = this.#entries.get(key);
    if (entry && entry.expiresAt !== null && Number(entry.expiresAt) <= Number(this.#now())) {
      this.#entries.set(key, Object.freeze({ ...entry, state: 'stale', misses: entry.misses + 1 }));
      this.#misses += 1;
      return null;
    }
    try {
      const response = await this.#cache.match(key);
      if (!response) {
        this.#misses += 1;
        if (entry) this.#entries.set(key, Object.freeze({ ...entry, misses: entry.misses + 1 }));
        return null;
      }
      this.#hits += 1;
      const now = this.#now();
      if (entry) this.#entries.set(key, Object.freeze({ ...entry, state: 'ready', accessedAt: now, hits: entry.hits + 1 }));
      return response;
    } catch {
      this.#misses += 1;
      return null;
    }
  }

  async remove(url: string): Promise<boolean> {
    const key = keyFor(url);
    if (!this.#cache) { this.#entries.delete(key); return false; }
    const entry = this.#entries.get(key);
    try {
      const deleted = await this.#cache.delete(key);
      if (entry) this.#bytes = Math.max(0, this.#bytes - entry.bytes);
      this.#entries.delete(key);
      return deleted;
    } catch { return false; }
  }

  async clear(): Promise<void> {
    this.#entries.clear();
    this.#bytes = 0;
    if (this.#cache) {
      try { await this.#cache.keys().then((requests) => Promise.all(requests.map((request) => this.#cache!.delete(request)))); } catch { /* best effort */ }
    }
  }

  entries(): readonly CacheEntry[] { return Object.freeze([...this.#entries.values()].sort((a, b) => Number(b.accessedAt) - Number(a.accessedAt))); }

  stats(): CacheStats {
    const stale = [...this.#entries.values()].filter((entry) => entry.state === 'stale').length;
    const total = this.#hits + this.#misses;
    return Object.freeze({ entries: this.#entries.size, bytes: this.#bytes, hits: this.#hits, misses: this.#misses, stale, evictions: this.#evictions, hitRate: total ? this.#hits / total : 0 });
  }

  async pruneExpired(): Promise<number> {
    const now = this.#now();
    let removed = 0;
    for (const entry of [...this.#entries.values()]) {
      if (entry.expiresAt !== null && Number(entry.expiresAt) <= Number(now)) {
        if (await this.remove(entry.url)) removed += 1;
      }
    }
    return removed;
  }

  async revalidate(url: string, fetcher: (request: Request, etag: string | null) => Promise<Response>): Promise<Response | null> {
    const checked = this.security.checkUrl(url, 'asset');
    if (!checked.accepted) return null;
    const key = keyFor(checked.normalized!);
    const etag = this.#entries.get(key)?.etag ?? null;
    try {
      const response = await fetcher(new Request(key, { cache: 'no-cache' }), etag);
      if (response.ok) await this.put(key, response, { etag: response.headers.get('etag') ?? etag });
      return response;
    } catch { return null; }
  }

  #estimateBytes(response: Response): Promise<number> {
    const declared = finite(Number(response.headers.get('content-length')), -1);
    if (declared >= 0) return Promise.resolve(Math.trunc(declared));
    return response.arrayBuffer().then((buffer) => buffer.byteLength);
  }

  async #evictUntil(requiredBytes: number): Promise<void> {
    while (this.#bytes + requiredBytes > this.maxBytes && this.#entries.size) {
      const candidates = [...this.#entries.values()].sort((a, b) => Number(a.accessedAt) - Number(b.accessedAt));
      const victim = candidates[0];
      if (!victim) break;
      if (await this.remove(victim.url)) this.#evictions += 1; else break;
    }
  }

  async #enforceEntryLimit(): Promise<void> {
    while (this.#entries.size > this.maxEntries) {
      const victim = [...this.#entries.values()].sort((a, b) => Number(a.accessedAt) - Number(b.accessedAt))[0];
      if (!victim) break;
      if (await this.remove(victim.url)) this.#evictions += 1; else break;
    }
  }
}
