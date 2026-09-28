/**
 * AAPW Asset Lifecycle V18.
 *
 * Typed asset residency, request coalescing, retry/backoff, integrity metadata,
 * memory budgets and deterministic eviction. The module does not decode renderer
 * objects; it owns the transport and lifecycle contract.
 */

export type AssetKindV18 =
  | 'model'
  | 'texture'
  | 'audio'
  | 'shader'
  | 'json'
  | 'binary';

export type AssetPriorityV18 =
  | 'critical'
  | 'high'
  | 'normal'
  | 'low'
  | 'background';

export type AssetStateV18 =
  | 'declared'
  | 'queued'
  | 'loading'
  | 'ready'
  | 'stale'
  | 'evicted'
  | 'failed';

export interface AssetManifestEntryV18 {
  readonly id: string;
  readonly url: string;
  readonly kind: AssetKindV18;
  readonly priority: AssetPriorityV18;
  readonly maxBytes: number;
  readonly expectedBytes?: number;
  readonly sha256?: string;
  readonly contentType?: string;
  readonly cacheable?: boolean;
  readonly critical?: boolean;
  readonly tags?: readonly string[];
}

export interface AssetLoadPayloadV18 {
  readonly value: ArrayBuffer;
  readonly bytes: number;
  readonly contentType: string | null;
  readonly sha256: string | null;
}

export interface AssetRecordV18 {
  readonly entry: AssetManifestEntryV18;
  readonly state: AssetStateV18;
  readonly bytes: number;
  readonly uses: number;
  readonly attempts: number;
  readonly lastUsedAtMs: number;
  readonly createdAtMs: number;
  readonly readyAtMs: number | null;
  readonly failureAtMs: number | null;
  readonly error: string | null;
}

export interface AssetLoadResultV18 extends AssetLoadPayloadV18 {
  readonly id: string;
  readonly attempts: number;
  readonly fromCache: boolean;
}

export interface AssetLifecycleSnapshotV18 {
  readonly revision: number;
  readonly residentBytes: number;
  readonly residentCount: number;
  readonly loadingCount: number;
  readonly queuedCount: number;
  readonly failedCount: number;
  readonly evictedCount: number;
  readonly records: readonly AssetRecordV18[];
}

export interface AssetLifecycleOptionsV18 {
  readonly maxResidentBytes?: number;
  readonly maxConcurrent?: number;
  readonly maxRetries?: number;
  readonly retryBaseMs?: number;
  readonly staleAfterMs?: number;
  readonly clock?: () => number;
  readonly fetcher?: typeof fetch;
}

interface InternalAssetV18 {
  entry: AssetManifestEntryV18;
  state: AssetStateV18;
  bytes: number;
  uses: number;
  attempts: number;
  lastUsedAtMs: number;
  createdAtMs: number;
  readyAtMs: number | null;
  failureAtMs: number | null;
  error: string | null;
  payload: AssetLoadPayloadV18 | null;
  revision: number;
}

interface PendingV18 {
  readonly promise: Promise<AssetLoadResultV18>;
  readonly controller: AbortController;
  consumers: number;
}

const PRIORITY_WEIGHT_V18: Readonly<Record<AssetPriorityV18, number>> = {
  critical: 1000,
  high: 700,
  normal: 450,
  low: 200,
  background: 50,
};

const KIND_WEIGHT_V18: Readonly<Record<AssetKindV18, number>> = {
  model: 1.25,
  texture: 1.15,
  audio: 0.9,
  shader: 0.7,
  json: 0.5,
  binary: 1,
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function finite(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function normalizeId(value: string): string {
  return value.trim().toLowerCase().replace(/\\s+/g, ':');
}

function normalizeHash(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^[0-9a-f]{64}$/.test(normalized) ? normalized : undefined;
}

function freeze<T>(value: T): T {
  return Object.freeze(value);
}

async function sha256(buffer: ArrayBuffer): Promise<string | null> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return null;
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

export class AssetLifecycleV18 {
  readonly #records = new Map<string, InternalAssetV18>();
  readonly #pending = new Map<string, PendingV18>();
  readonly #queue = new Set<string>();
  readonly #clock: () => number;
  readonly #fetcher: typeof fetch;
  readonly #maxResidentBytes: number;
  readonly #maxConcurrent: number;
  readonly #maxRetries: number;
  readonly #retryBaseMs: number;
  readonly #staleAfterMs: number;

  #residentBytes = 0;
  #running = 0;
  #revision = 0;

  public constructor(options: AssetLifecycleOptionsV18 = {}) {
    this.#clock = options.clock ?? (() => performance.now());
    this.#fetcher = options.fetcher ?? fetch;
    this.#maxResidentBytes = Math.max(1024 * 1024, finite(options.maxResidentBytes, 256 * 1024 * 1024));
    this.#maxConcurrent = Math.max(1, Math.min(32, Math.trunc(finite(options.maxConcurrent, 4))));
    this.#maxRetries = Math.max(0, Math.min(8, Math.trunc(finite(options.maxRetries, 3))));
    this.#retryBaseMs = Math.max(10, finite(options.retryBaseMs, 150));
    this.#staleAfterMs = Math.max(1000, finite(options.staleAfterMs, 120000));
  }

  public declare(entry: AssetManifestEntryV18): AssetRecordV18 {
    const id = normalizeId(entry.id);
    if (!id) throw new TypeError('Asset id is required.');
    if (!/^https?:|^\/\//.test(entry.url) && !entry.url.startsWith('./') && !entry.url.startsWith('../')) {
      throw new TypeError(`Unsupported asset URL: ${entry.url}`);
    }
    if (entry.maxBytes <= 0 || !Number.isFinite(entry.maxBytes)) {
      throw new RangeError(`Asset maxBytes must be positive: ${id}`);
    }

    const normalized: AssetManifestEntryV18 = freeze({
      ...entry,
      id,
      url: entry.url.trim(),
      maxBytes: Math.max(1, Math.trunc(entry.maxBytes)),
      expectedBytes: entry.expectedBytes === undefined ? undefined : Math.max(0, Math.trunc(entry.expectedBytes)),
      sha256: normalizeHash(entry.sha256),
      tags: freeze([...(entry.tags ?? [])].map((tag) => tag.trim()).filter(Boolean).slice(0, 16)),
      cacheable: entry.cacheable ?? true,
      critical: entry.critical ?? false,
    });

    const now = this.#clock();
    const existing = this.#records.get(id);
    if (existing?.state === 'loading') {
      throw new Error(`Cannot replace loading asset: ${id}`);
    }

    const record: InternalAssetV18 = {
      entry: normalized,
      state: 'declared',
      bytes: 0,
      uses: 0,
      attempts: 0,
      lastUsedAtMs: now,
      createdAtMs: existing?.createdAtMs ?? now,
      readyAtMs: null,
      failureAtMs: null,
      error: null,
      payload: null,
      revision: ++this.#revision,
    };

    if (existing?.payload) {
      this.#residentBytes -= existing.bytes;
    }

    this.#records.set(id, record);
    this.#queue.delete(id);
    this.#revision += 1;
    return this.#snapshotRecord(record);
  }

  public declareMany(entries: readonly AssetManifestEntryV18[]): readonly AssetRecordV18[] {
    return freeze(entries.map((entry) => this.declare(entry)));
  }

  public get(id: string): AssetRecordV18 | undefined {
    const record = this.#records.get(normalizeId(id));
    return record ? this.#snapshotRecord(record) : undefined;
  }

  public hasReady(id: string): boolean {
    return this.#records.get(normalizeId(id))?.state === 'ready';
  }

  public async load(id: string): Promise<AssetLoadResultV18> {
    const key = normalizeId(id);
    const record = this.#records.get(key);
    if (!record) throw new Error(`Asset not declared: ${id}`);

    if (record.state === 'ready' && record.payload) {
      record.uses += 1;
      record.lastUsedAtMs = this.#clock();
      return freeze({
        id: key,
        ...record.payload,
        attempts: record.attempts,
        fromCache: true,
      });
    }

    const pending = this.#pending.get(key);
    if (pending) {
      pending.consumers += 1;
      return pending.promise;
    }

    record.state = 'queued';
    record.error = null;
    record.failureAtMs = null;
    this.#queue.add(key);
    const promise = this.#drain();
    const requested = this.#pending.get(key);
    if (requested) {
      requested.consumers += 1;
      return requested.promise;
    }

    return promise.then(() => {
      const ready = this.#records.get(key);
      if (!ready?.payload) {
        throw new Error(`Asset failed to become ready: ${key}`);
      }
      return freeze({
        id: key,
        ...ready.payload,
        attempts: ready.attempts,
        fromCache: false,
      });
    });
  }

  public async preload(ids: readonly string[]): Promise<readonly AssetLoadResultV18[]> {
    const unique = [...new Set(ids.map(normalizeId))];
    return freeze(await Promise.all(unique.map((id) => this.load(id))));
  }

  public release(id: string): boolean {
    const record = this.#records.get(normalizeId(id));
    if (!record) return false;
    record.uses = Math.max(0, record.uses - 1);
    record.lastUsedAtMs = this.#clock();
    return true;
  }

  public invalidate(id: string, reason = 'manual'): boolean {
    const record = this.#records.get(normalizeId(id));
    if (!record) return false;
    if (record.state === 'loading') return false;

    if (record.payload) {
      this.#residentBytes -= record.bytes;
    }
    record.state = 'stale';
    record.bytes = 0;
    record.uses = 0;
    record.payload = null;
    record.readyAtMs = null;
    record.error = reason;
    record.revision = ++this.#revision;
    return true;
  }

  public abort(id: string): boolean {
    const pending = this.#pending.get(normalizeId(id));
    if (!pending) return false;
    pending.controller.abort();
    return true;
  }

  public sweep(nowMs = this.#clock()): readonly string[] {
    const stale: string[] = [];

    for (const record of this.#records.values()) {
      if (record.state !== 'ready') continue;
      if (record.uses > 0) continue;
      if (nowMs - record.lastUsedAtMs < this.#staleAfterMs) continue;

      stale.push(record.entry.id);
    }

    for (const id of stale) {
      this.invalidate(id, 'stale-timeout');
      const record = this.#records.get(id);
      if (record) record.state = 'evicted';
    }

    return freeze(stale);
  }

  public evictToBudget(requiredBytes = 0): readonly string[] {
    const target = Math.max(0, requiredBytes);
    const evicted: string[] = [];

    if (this.#residentBytes + target <= this.#maxResidentBytes) {
      return freeze(evicted);
    }

    const candidates = [...this.#records.values()]
      .filter((record) => record.state === 'ready' && record.uses === 0)
      .sort((a, b) => this.#evictionScore(a) - this.#evictionScore(b));

    for (const record of candidates) {
      if (this.#residentBytes + target <= this.#maxResidentBytes) break;

      this.#residentBytes -= record.bytes;
      record.bytes = 0;
      record.payload = null;
      record.state = 'evicted';
      record.readyAtMs = null;
      record.revision = ++this.#revision;
      evicted.push(record.entry.id);
    }

    return freeze(evicted);
  }

  public snapshot(): AssetLifecycleSnapshotV18 {
    const records = [...this.#records.values()]
      .sort((a, b) => a.entry.id.localeCompare(b.entry.id))
      .map((record) => this.#snapshotRecord(record));

    return freeze({
      revision: this.#revision,
      residentBytes: this.#residentBytes,
      residentCount: records.filter((record) => record.state === 'ready').length,
      loadingCount: records.filter((record) => record.state === 'loading').length,
      queuedCount: records.filter((record) => record.state === 'queued').length,
      failedCount: records.filter((record) => record.state === 'failed').length,
      evictedCount: records.filter((record) => record.state === 'evicted').length,
      records: freeze(records),
    });
  }

  #snapshotRecord(record: InternalAssetV18): AssetRecordV18 {
    return freeze({
      entry: record.entry,
      state: record.state,
      bytes: record.bytes,
      uses: record.uses,
      attempts: record.attempts,
      lastUsedAtMs: record.lastUsedAtMs,
      createdAtMs: record.createdAtMs,
      readyAtMs: record.readyAtMs,
      failureAtMs: record.failureAtMs,
      error: record.error,
    });
  }

  #evictionScore(record: InternalAssetV18): number {
    const age = Math.max(0, this.#clock() - record.lastUsedAtMs) / 1000;
    const priority = PRIORITY_WEIGHT_V18[record.entry.priority];
    const kind = KIND_WEIGHT_V18[record.entry.kind];
    const criticalPenalty = record.entry.critical ? 10000 : 0;
    const sizePenalty = record.bytes / Math.max(1, this.#maxResidentBytes) * 100;
    return priority * kind + criticalPenalty - age * 2 - sizePenalty;
  }

  async #drain(): Promise<void> {
    while (this.#running < this.#maxConcurrent && this.#queue.size > 0) {
      const next = this.#chooseNext();
      if (!next) break;
      this.#queue.delete(next);
      void this.#startLoad(next);
    }
  }

  #chooseNext(): string | undefined {
    return [...this.#queue]
      .map((id) => this.#records.get(id))
      .filter((record): record is InternalAssetV18 => Boolean(record))
      .sort(
        (a, b) =>
          PRIORITY_WEIGHT_V18[b.entry.priority] - PRIORITY_WEIGHT_V18[a.entry.priority] ||
          Number(b.entry.critical) - Number(a.entry.critical) ||
          a.entry.id.localeCompare(b.entry.id),
      )[0]?.entry.id;
  }

  async #startLoad(id: string): Promise<void> {
    const record = this.#records.get(id);
    if (!record) return;

    this.#running += 1;
    record.state = 'loading';
    record.attempts = 0;
    record.error = null;
    record.revision = ++this.#revision;

    const controller = new AbortController();
    const promise = this.#loadWithRetry(record, controller.signal);

    this.#pending.set(id, {
      promise,
      controller,
      consumers: 0,
    });

    try {
      await promise;
    } catch {
      // The public load promise receives the concrete failure.
    } finally {
      this.#pending.delete(id);
      this.#running = Math.max(0, this.#running - 1);
      void this.#drain();
    }
  }

  async #loadWithRetry(
    record: InternalAssetV18,
    signal: AbortSignal,
  ): Promise<AssetLoadResultV18> {
    let lastError: unknown = new Error('Asset load failed.');

    for (let attempt = 0; attempt <= this.#maxRetries; attempt += 1) {
      record.attempts = attempt + 1;

      try {
        const response = await this.#fetcher(record.entry.url, {
          signal,
          headers: {
            accept: record.entry.contentType ?? '*/*',
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} for ${record.entry.id}`);
        }

        const buffer = await response.arrayBuffer();
        const bytes = buffer.byteLength;
        if (bytes <= 0 || bytes > record.entry.maxBytes) {
          throw new Error(`Asset size outside policy for ${record.entry.id}: ${bytes}`);
        }

        if (
          record.entry.expectedBytes !== undefined &&
          Math.abs(bytes - record.entry.expectedBytes) > Math.max(1024, record.entry.expectedBytes * 0.25)
        ) {
          throw new Error(`Asset size drift for ${record.entry.id}`);
        }

        const digest = await sha256(buffer);
        if (record.entry.sha256 && digest !== record.entry.sha256) {
          throw new Error(`Asset integrity mismatch for ${record.entry.id}`);
        }

        const payload: AssetLoadPayloadV18 = freeze({
          value: buffer.slice(0),
          bytes,
          contentType: response.headers.get('content-type'),
          sha256: digest,
        });

        this.#residentBytes -= record.bytes;
        this.evictToBudget(bytes);
        if (this.#residentBytes + bytes > this.#maxResidentBytes && !record.entry.critical) {
          throw new Error(`Resident asset budget exhausted for ${record.entry.id}`);
        }

        record.payload = payload;
        record.bytes = bytes;
        record.state = 'ready';
        record.readyAtMs = this.#clock();
        record.lastUsedAtMs = this.#clock();
        record.failureAtMs = null;
        record.error = null;
        record.revision = ++this.#revision;
        this.#residentBytes += bytes;

        return freeze({
          id: record.entry.id,
          ...payload,
          attempts: record.attempts,
          fromCache: false,
        });
      } catch (error) {
        lastError = error;
        record.failureAtMs = this.#clock();
        record.error = error instanceof Error ? error.message : String(error);

        if (attempt >= this.#maxRetries) break;

        const delay = this.#retryBaseMs * 2 ** attempt;
        await new Promise<void>((resolve) => setTimeout(resolve, Math.min(delay, 4000)));
      }
    }

    record.state = 'failed';
    record.revision = ++this.#revision;
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}
