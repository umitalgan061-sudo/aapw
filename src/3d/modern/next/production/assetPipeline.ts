import { checksumP, integerP, nonNegativeP, type AssetManifestItemP, type AssetRecordP, type AssetPriority, type EventSinkP } from './contracts.ts';

export interface AssetLoaderP<T = unknown> {
  load(item: AssetManifestItemP, signal: AbortSignal): Promise<T>;
  dispose?(value: T): void;
}

export interface AssetPipelineConfigP {
  readonly maxBytes: number;
  readonly maxEntries: number;
  readonly maxConcurrent: number;
  readonly maxRetries: number;
  readonly baseRetryDelayMs: number;
}

export interface AssetPipelineStatsP {
  readonly queued: number;
  readonly loading: number;
  readonly ready: number;
  readonly failed: number;
  readonly residentBytes: number;
  readonly evictions: number;
  readonly retries: number;
  readonly checksum: number;
}

interface Entry<T> {
  item: AssetManifestItemP;
  state: AssetRecordP['state'];
  value?: T;
  bytes: number;
  pinCount: number;
  lastUsedTick: number;
  generation: number;
  error?: string;
  retries: number;
  sequence: number;
}

const priorityWeight: Record<AssetPriority, number> = { critical: 1000, near: 700, normal: 400, background: 100 };

export class ProductionAssetPipeline<T = unknown> {
  readonly config: AssetPipelineConfigP;
  readonly #entries = new Map<string, Entry<T>>();
  readonly #queue: string[] = [];
  readonly #loaders = new Map<string, AssetLoaderP<T>>();
  readonly #controllers = new Map<string, AbortController>();
  readonly #events?: EventSinkP;
  #loading = 0;
  #residentBytes = 0;
  #sequence = 0;
  #evictions = 0;
  #retries = 0;

  constructor(config: Partial<AssetPipelineConfigP> = {}, events?: EventSinkP) {
    this.config = Object.freeze({ maxBytes: Math.max(1, nonNegativeP(config.maxBytes ?? 512 * 1024 * 1024)), maxEntries: Math.max(16, integerP(config.maxEntries ?? 2048)), maxConcurrent: Math.max(1, integerP(config.maxConcurrent ?? 8)), maxRetries: Math.max(0, integerP(config.maxRetries ?? 2)), baseRetryDelayMs: Math.max(0, nonNegativeP(config.baseRetryDelayMs ?? 150)) });
    this.#events = events;
  }

  registerLoader(scheme: string, loader: AssetLoaderP<T>): void {
    const key = String(scheme).trim().toLowerCase();
    if (!key) throw new Error('asset loader scheme cannot be empty');
    this.#loaders.set(key, loader);
  }

  enqueue(items: readonly AssetManifestItemP[], tick = 0): number {
    let accepted = 0;
    for (const item of items) {
      const normalized = normalizeItem(item);
      const existing = this.#entries.get(normalized.id);
      if (existing) {
        existing.item = normalized;
        existing.lastUsedTick = Math.max(existing.lastUsedTick, integerP(tick));
        continue;
      }
      if (this.#entries.size >= this.config.maxEntries) this.evictUntilRoom(1, 0);
      if (this.#entries.size >= this.config.maxEntries) continue;
      const entry: Entry<T> = { item: normalized, state: 'queued', bytes: 0, pinCount: 0, lastUsedTick: Math.max(0, integerP(tick)), generation: 1, retries: 0, sequence: ++this.#sequence };
      this.#entries.set(normalized.id, entry);
      this.#queue.push(normalized.id);
      accepted += 1;
    }
    this.#sortQueue();
    return accepted;
  }

  async pump(tick: number, signal?: AbortSignal): Promise<number> {
    const started = this.#loading;
    while (this.#loading < this.config.maxConcurrent) {
      const id = this.#nextQueued();
      if (!id) break;
      await this.#start(id, tick, signal);
    }
    return this.#loading - started;
  }

  async loadNow(id: string, tick: number, signal?: AbortSignal): Promise<boolean> {
    const entry = this.#entries.get(id);
    if (!entry) return false;
    if (entry.state === 'ready') { entry.lastUsedTick = tick; return true; }
    if (entry.state === 'queued') this.#queue.splice(this.#queue.indexOf(id), 1);
    return this.#start(id, tick, signal);
  }

  pin(id: string): boolean { const entry = this.#entries.get(id); if (!entry) return false; entry.pinCount += 1; return true; }
  unpin(id: string): boolean { const entry = this.#entries.get(id); if (!entry || entry.pinCount <= 0) return false; entry.pinCount -= 1; return true; }

  get(id: string, tick = 0): T | undefined { const entry = this.#entries.get(id); if (!entry || entry.state !== 'ready') return undefined; entry.lastUsedTick = Math.max(entry.lastUsedTick, integerP(tick)); return entry.value; }
  record(id: string): AssetRecordP | undefined { const entry = this.#entries.get(id); return entry ? recordOf(entry) : undefined; }
  list(): readonly AssetRecordP[] { return Object.freeze([...this.#entries.values()].sort((a, b) => a.item.id.localeCompare(b.item.id)).map(recordOf)); }

  markStale(id: string): boolean {
    const entry = this.#entries.get(id);
    if (!entry || entry.state === 'loading') return false;
    if (entry.state === 'ready') this.disposeEntry(entry);
    entry.state = 'queued';
    entry.error = undefined;
    entry.retries = 0;
    entry.generation += 1;
    this.#queue.push(id);
    this.#sortQueue();
    return true;
  }

  evictUntilRoom(requiredBytes: number, tick: number): number {
    const need = Math.max(0, nonNegativeP(requiredBytes));
    let evicted = 0;
    while (this.#residentBytes + need > this.config.maxBytes) {
      const candidate = [...this.#entries.values()].filter(entry => entry.state === 'ready' && entry.pinCount === 0).sort((a, b) => a.item.priority.localeCompare(b.item.priority) || a.lastUsedTick - b.lastUsedTick || a.sequence - b.sequence)[0];
      if (!candidate) break;
      this.#residentBytes -= candidate.bytes;
      this.disposeEntry(candidate);
      candidate.state = 'disposed';
      this.#entries.delete(candidate.item.id);
      this.#evictions += 1;
      evicted += 1;
    }
    return evicted;
  }

  stats(): AssetPipelineStatsP {
    let queued = 0; let ready = 0; let failed = 0;
    for (const entry of this.#entries.values()) { if (entry.state === 'queued') queued += 1; if (entry.state === 'ready') ready += 1; if (entry.state === 'failed') failed += 1; }
    return Object.freeze({ queued, loading: this.#loading, ready, failed, residentBytes: this.#residentBytes, evictions: this.#evictions, retries: this.#retries, checksum: checksumP(this.list()) });
  }

  digest(): number { return this.stats().checksum; }

  dispose(): void {
    for (const controller of this.#controllers.values()) controller.abort();
    for (const entry of this.#entries.values()) if (entry.state === 'ready') this.disposeEntry(entry);
    this.#controllers.clear(); this.#entries.clear(); this.#queue.length = 0; this.#residentBytes = 0; this.#loading = 0;
  }

  async #start(id: string, tick: number, parentSignal?: AbortSignal): Promise<boolean> {
    const entry = this.#entries.get(id);
    if (!entry) return false;
    if (entry.state === 'ready') { entry.lastUsedTick = tick; return true; }
    const loader = this.#resolveLoader(entry.item.url);
    if (!loader) { entry.state = 'failed'; entry.error = 'NO_LOADER'; this.#emit(entry); return false; }
    this.#loading += 1;
    entry.state = 'loading'; entry.lastUsedTick = tick; this.#emit(entry);
    const controller = new AbortController();
    this.#controllers.set(id, controller);
    const abortFromParent = (): void => controller.abort(parentSignal?.reason);
    if (parentSignal) {
      if (parentSignal.aborted) controller.abort(parentSignal.reason);
      else parentSignal.addEventListener('abort', abortFromParent, { once: true });
    }
    try {
      const value = await loader.load(entry.item, controller.signal);
      const bytes = entry.item.bytes > 0 ? entry.item.bytes : estimateBytes(value);
      this.evictUntilRoom(bytes, tick);
      if (this.#residentBytes + bytes > this.config.maxBytes && entry.pinCount === 0) throw new Error('ASSET_BUDGET_EXCEEDED');
      entry.value = value;
      entry.bytes = bytes;
      entry.state = 'ready';
      entry.error = undefined;
      this.#residentBytes += bytes;
      this.#emit(entry);
      return true;
    } catch (error) {
      entry.error = normalizeError(error);
      if (entry.retries < this.config.maxRetries && !controller.signal.aborted) {
        entry.retries += 1; this.#retries += 1; entry.state = 'queued'; this.#queue.push(id); this.#sortQueue();
        await delay(this.config.baseRetryDelayMs * 2 ** (entry.retries - 1), controller.signal).catch(() => undefined);
      } else { entry.state = controller.signal.aborted ? 'disposed' : 'failed'; }
      this.#emit(entry);
      return false;
    } finally {
      if (parentSignal) parentSignal.removeEventListener('abort', abortFromParent);
      this.#controllers.delete(id); this.#loading = Math.max(0, this.#loading - 1);
    }
  }

  #nextQueued(): string | undefined { while (this.#queue.length) { const id = this.#queue.shift()!; const entry = this.#entries.get(id); if (entry?.state === 'queued') return id; } return undefined; }
  #sortQueue(): void { this.#queue.sort((a, b) => this.#score(b) - this.#score(a) || a.localeCompare(b)); }
  #score(id: string): number { const entry = this.#entries.get(id); return entry ? priorityWeight[entry.item.priority] - entry.item.bytes / 1_000_000 - entry.sequence / 1_000_000 : -Infinity; }
  #resolveLoader(url: string): AssetLoaderP<T> | undefined { const scheme = /^[a-z]+:/i.exec(url)?.[0]?.slice(0, -1).toLowerCase() ?? 'https'; return this.#loaders.get(scheme) ?? this.#loaders.get('default'); }
  #emit(entry: Entry<T>): void { this.#events?.emit('asset:state', recordOf(entry)); }
  disposeEntry(entry: Entry<T>): void { if (entry.value === undefined) return; const scheme = /^[a-z]+:/i.exec(entry.item.url)?.[0]?.slice(0, -1).toLowerCase() ?? 'https'; this.#loaders.get(scheme)?.dispose?.(entry.value); entry.value = undefined; }
}

function normalizeItem(item: AssetManifestItemP): AssetManifestItemP { const id = item.id.trim(); const url = item.url.trim(); if (!id || !url) throw new Error('invalid asset manifest item'); return Object.freeze({ ...item, id, url, bytes: Math.max(0, integerP(item.bytes)), priority: item.priority, optional: Boolean(item.optional) }); }
function recordOf<T>(entry: Entry<T>): AssetRecordP { return Object.freeze({ id: entry.item.id, url: entry.item.url, state: entry.state, bytes: entry.bytes, pinCount: entry.pinCount, lastUsedTick: entry.lastUsedTick, generation: entry.generation, ...(entry.error ? { error: entry.error } : {}) }); }
function estimateBytes(value: unknown): number { if (value instanceof ArrayBuffer) return value.byteLength; if (value instanceof Uint8Array) return value.byteLength; if (typeof Blob !== 'undefined' && value instanceof Blob) return value.size; return Math.max(0, JSON.stringify(value)?.length ?? 0); }
function normalizeError(error: unknown): string { return error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200); }
function delay(ms: number, signal: AbortSignal): Promise<void> { return new Promise((resolve, reject) => { if (signal.aborted) { reject(signal.reason); return; } const timer = setTimeout(resolve, ms); signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true }); }); }
