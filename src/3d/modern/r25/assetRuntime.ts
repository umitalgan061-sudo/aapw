import type {
  AssetId,
  AssetLoadRequest,
  AssetLoadResult,
  AssetManifestEntry,
  AssetRecord,
  AssetRuntimeOptions,
  AssetRuntimeSnapshot,
  AssetState,
} from './contracts.ts';

interface MutableAssetRecord extends AssetRecord {
  state: AssetState;
  attempts: number;
  residentBytes: number;
  lastUsedFrame: number;
  lastError: string | null;
  progress: number;
}

interface QueueEntry {
  readonly request: AssetLoadRequest;
  readonly sequence: number;
}

function freeze<T>(value: T): T {
  return Object.freeze(value);
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class AssetRuntimeR25 {
  readonly #options: AssetRuntimeOptions;
  readonly #records = new Map<AssetId, MutableAssetRecord>();
  readonly #queue: QueueEntry[] = [];
  readonly #inFlight = new Map<AssetId, Promise<AssetLoadResult>>();
  #sequence = 0;
  #residentBytes = 0;
  #disposed = false;

  public constructor(options: AssetRuntimeOptions) {
    this.#options = freeze({
      ...options,
      maxResidentBytes: Math.max(1024, Math.trunc(options.maxResidentBytes)),
      maxConcurrentLoads: Math.max(1, Math.trunc(options.maxConcurrentLoads)),
      maxAttempts: Math.max(1, Math.trunc(options.maxAttempts)),
      retryBaseDelayMs: Math.max(0, finite(options.retryBaseDelayMs, 150)),
      retryMaxDelayMs: Math.max(0, finite(options.retryMaxDelayMs, 5000)),
    });
  }

  public declare(entry: AssetManifestEntry): void {
    this.#assertLive();
    this.#validateEntry(entry);

    const existing = this.#records.get(entry.id);
    if (existing) {
      const changed = existing.url !== entry.url || existing.bytes !== entry.bytes || existing.sha256 !== entry.sha256;
      if (!changed) return;
      if (existing.state === 'loading') throw new Error(`R25_ASSET_BUSY:${entry.id}`);
      this.#residentBytes = Math.max(0, this.#residentBytes - existing.residentBytes);
    }

    this.#records.set(entry.id, {
      ...freeze(entry),
      state: 'declared',
      attempts: 0,
      residentBytes: 0,
      lastUsedFrame: this.#options.clock.simulationTick(),
      lastError: null,
      progress: 0,
    });
  }

  public declareMany(entries: readonly AssetManifestEntry[]): void {
    for (const entry of entries) this.declare(entry);
  }

  public get(id: AssetId): AssetRecord | null {
    const record = this.#records.get(id);
    return record ? this.#snapshotRecord(record) : null;
  }

  public request(
    id: AssetId,
    options: Omit<Partial<AssetLoadRequest>, 'id'> = {},
  ): boolean {
    this.#assertLive();
    const record = this.#records.get(id);
    if (!record) return false;
    if (record.state === 'ready' || record.state === 'loading') {
      record.lastUsedFrame = this.#options.clock.simulationTick();
      return true;
    }

    record.state = 'queued';
    record.lastError = null;
    record.progress = 0;

    const request: AssetLoadRequest = freeze({
      id,
      requestedAtFrame: Math.max(0, Math.trunc(finite(options.requestedAtFrame, this.#options.clock.simulationTick()))),
      deadlineFrame: Math.max(
        0,
        Math.trunc(
          finite(
            options.deadlineFrame,
            this.#options.clock.simulationTick() + 180,
          ),
        ),
      ),
      priorityBoost: finite(options.priorityBoost, 0),
      ...(options.signal ? { signal: options.signal } : {}),
    });

    this.#queue.push({ request, sequence: this.#sequence++ });
    this.#queue.sort((a, b) => this.#compareQueue(a, b));
    void this.#drain();
    return true;
  }

  public async load(id: AssetId, signal?: AbortSignal): Promise<AssetLoadResult> {
    this.#assertLive();

    const record = this.#records.get(id);
    if (!record) {
      return freeze({
        id,
        ok: false,
        bytes: 0,
        durationMs: 0,
        attempts: 0,
        error: 'R25_ASSET_NOT_DECLARED',
      });
    }

    const existing = this.#inFlight.get(id);
    if (existing) return existing;

    if (record.state === 'ready') {
      record.lastUsedFrame = this.#options.clock.simulationTick();
      return freeze({
        id,
        ok: true,
        bytes: record.residentBytes,
        durationMs: 0,
        attempts: record.attempts,
        error: null,
      });
    }

    const request = freeze({
      id,
      requestedAtFrame: this.#options.clock.simulationTick(),
      deadlineFrame: this.#options.clock.simulationTick() + 180,
      priorityBoost: 1000,
      ...(signal ? { signal } : {}),
    });

    const promise = this.#execute(request);
    this.#inFlight.set(id, promise);

    try {
      return await promise;
    } finally {
      this.#inFlight.delete(id);
    }
  }

  public markUsed(id: AssetId, frame = this.#options.clock.simulationTick()): boolean {
    const record = this.#records.get(id);
    if (!record) return false;
    record.lastUsedFrame = Math.max(0, Math.trunc(frame));
    return true;
  }

  public evict(id: AssetId): boolean {
    const record = this.#records.get(id);
    if (!record || record.critical || record.state !== 'ready') return false;

    this.#residentBytes = Math.max(0, this.#residentBytes - record.residentBytes);
    record.residentBytes = 0;
    record.state = 'evicted';
    record.progress = 0;
    return true;
  }

  public sweep(frame = this.#options.clock.simulationTick()): readonly AssetId[] {
    this.#assertLive();
    const candidates = [...this.#records.values()]
      .filter((record) => record.state === 'ready' && !record.critical)
      .sort((a, b) => {
        const age = a.lastUsedFrame - b.lastUsedFrame;
        if (age !== 0) return age;
        return a.id.localeCompare(b.id);
      });

    const evicted: AssetId[] = [];

    for (const record of candidates) {
      if (this.#residentBytes <= this.#options.maxResidentBytes) break;
      if (record.lastUsedFrame >= frame - 30) continue;
      if (this.evict(record.id)) evicted.push(record.id);
    }

    return freeze(evicted);
  }

  public retryDelay(attempt: number): number {
    const safeAttempt = Math.max(1, Math.trunc(attempt));
    return Math.min(
      this.#options.retryMaxDelayMs,
      this.#options.retryBaseDelayMs * 2 ** Math.min(8, safeAttempt - 1),
    );
  }

  public snapshot(): AssetRuntimeSnapshot {
    return freeze({
      residentBytes: this.#residentBytes,
      maxResidentBytes: this.#options.maxResidentBytes,
      inFlight: this.#inFlight.size,
      queueLength: this.#queue.length,
      records: freeze(
        [...this.#records.values()]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((record) => this.#snapshotRecord(record)),
      ),
    });
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const entry of this.#queue) {
      const record = this.#records.get(entry.request.id);
      if (record && record.state === 'queued') record.state = 'aborted';
    }
    this.#queue.length = 0;
    this.#records.clear();
    this.#inFlight.clear();
    this.#residentBytes = 0;
  }

  async #drain(): Promise<void> {
    if (this.#disposed) return;

    while (this.#inFlight.size < this.#options.maxConcurrentLoads) {
      const next = this.#queue.shift();
      if (!next) break;
      if (next.request.signal?.aborted) {
        const record = this.#records.get(next.request.id);
        if (record) record.state = 'aborted';
        continue;
      }

      const promise = this.#execute(next.request);
      this.#inFlight.set(next.request.id, promise);

      void promise.finally(() => {
        this.#inFlight.delete(next.request.id);
        void this.#drain();
      }).catch(() => undefined);
    }
  }

  async #execute(request: AssetLoadRequest): Promise<AssetLoadResult> {
    const record = this.#records.get(request.id);
    if (!record) {
      return freeze({
        id: request.id,
        ok: false,
        bytes: 0,
        durationMs: 0,
        attempts: 0,
        error: 'R25_ASSET_NOT_DECLARED',
      });
    }

    const started = this.#options.clock.nowMs();
    let lastError: string | null = null;

    for (let attempt = 1; attempt <= this.#options.maxAttempts; attempt += 1) {
      if (request.signal?.aborted) {
        record.state = 'aborted';
        record.lastError = 'aborted';
        return freeze({
          id: request.id,
          ok: false,
          bytes: 0,
          durationMs: Math.max(0, this.#options.clock.nowMs() - started),
          attempts: attempt - 1,
          error: 'R25_ASSET_ABORTED',
        });
      }

      record.attempts = attempt;
      record.state = 'loading';
      record.progress = 0;

      try {
        const result = await this.#options.transport.load(record, request.signal);
        const bytes = Math.max(0, Math.trunc(finite(result.bytes, record.bytes)));

        if (bytes > this.#options.maxResidentBytes) {
          throw new Error('R25_ASSET_EXCEEDS_GLOBAL_BUDGET');
        }

        this.#makeRoom(bytes, record.id);

        this.#residentBytes += bytes;
        record.residentBytes = bytes;
        record.lastUsedFrame = this.#options.clock.simulationTick();
        record.state = 'ready';
        record.lastError = null;
        record.progress = 1;

        return freeze({
          id: request.id,
          ok: true,
          bytes,
          durationMs: Math.max(0, this.#options.clock.nowMs() - started),
          attempts: attempt,
          error: null,
        });
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        record.lastError = lastError;
        record.progress = 0;

        if (attempt < this.#options.maxAttempts) {
          const delay = this.retryDelay(attempt);
          await this.#sleep(delay, request.signal);
        }
      }
    }

    record.state = 'failed';
    return freeze({
      id: request.id,
      ok: false,
      bytes: 0,
      durationMs: Math.max(0, this.#options.clock.nowMs() - started),
      attempts: record.attempts,
      error: lastError ?? 'R25_ASSET_LOAD_FAILED',
    });
  }

  #makeRoom(requiredBytes: number, incomingId: AssetId): void {
    const available = this.#options.maxResidentBytes - this.#residentBytes;
    if (available >= requiredBytes) return;

    const requiredFree = requiredBytes - available;
    const candidates = [...this.#records.values()]
      .filter((record) => record.id !== incomingId)
      .filter((record) => record.state === 'ready' && !record.critical)
      .sort((a, b) => {
        const age = a.lastUsedFrame - b.lastUsedFrame;
        if (age !== 0) return age;
        const priority = a.priority - b.priority;
        if (priority !== 0) return priority;
        return a.id.localeCompare(b.id);
      });

    let freed = 0;
    for (const record of candidates) {
      if (freed >= requiredFree) break;
      freed += record.residentBytes;
      this.evict(record.id);
    }

    if (this.#residentBytes + requiredBytes > this.#options.maxResidentBytes) {
      throw new Error('R25_ASSET_MEMORY_PRESSURE');
    }
  }

  #sleep(delayMs: number, signal?: AbortSignal): Promise<void> {
    if (delayMs <= 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      const onAbort = () => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        reject(new Error('R25_ASSET_ABORTED'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      setTimeout(done, delayMs);
    });
  }

  #compareQueue(a: QueueEntry, b: QueueEntry): number {
    const left = this.#records.get(a.request.id);
    const right = this.#records.get(b.request.id);
    const leftScore = (left?.priority ?? 0) + a.request.priorityBoost;
    const rightScore = (right?.priority ?? 0) + b.request.priorityBoost;
    if (leftScore !== rightScore) return rightScore - leftScore;

    const deadline = a.request.deadlineFrame - b.request.deadlineFrame;
    if (deadline !== 0) return deadline;

    return a.sequence - b.sequence;
  }

  #validateEntry(entry: AssetManifestEntry): void {
    if (!entry.id?.trim()) throw new Error('R25_ASSET_ID_REQUIRED');
    if (!entry.url?.trim()) throw new Error(`R25_ASSET_URL_REQUIRED:${entry.id}`);
    if (!Number.isFinite(entry.bytes) || entry.bytes < 0) throw new Error(`R25_ASSET_BYTES_INVALID:${entry.id}`);
    if (!Number.isFinite(entry.priority)) throw new Error(`R25_ASSET_PRIORITY_INVALID:${entry.id}`);
    if (entry.dependencies.includes(entry.id)) throw new Error(`R25_ASSET_SELF_DEPENDENCY:${entry.id}`);
  }

  #snapshotRecord(record: MutableAssetRecord): AssetRecord {
    return freeze({ ...record, tags: freeze([...record.tags]), dependencies: freeze([...record.dependencies]) });
  }

  #assertLive(): void {
    if (this.#disposed) throw new Error('R25_ASSET_RUNTIME_DISPOSED');
  }
}

export function createMemoryAssetTransport(
  payloads: ReadonlyMap<string, unknown> = new Map(),
): AssetRuntimeOptions['transport'] {
  return {
    async load(entry) {
      const payload = payloads.get(entry.url) ?? new Uint8Array(0);
      const bytes = payload instanceof Uint8Array
        ? payload.byteLength
        : new TextEncoder().encode(JSON.stringify(payload)).byteLength;
      return freeze({ bytes: Math.max(entry.bytes, bytes), payload });
    },
  };
}
