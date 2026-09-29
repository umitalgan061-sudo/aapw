import {
  AssetRecord,
  AssetId,
  Outcome,
  asAssetId,
  clamp,
  fault,
  stableHash,
} from './kernelTypes.ts';

export interface AssetRequest {
  readonly id?: string;
  readonly url: string;
  readonly kind: AssetRecord['kind'];
  readonly priority: number;
  readonly estimatedBytes: number;
  readonly maxRetries?: number;
}

export interface AssetSchedulerPolicy {
  readonly maxResidentBytes: number;
  readonly maxInflightBytes: number;
  readonly maxInflightRequests: number;
  readonly maxQueueLength: number;
  readonly staleAfterTicks: number;
  readonly baseRetryTicks: number;
  readonly maxRetryTicks: number;
}

export const DEFAULT_ASSET_SCHEDULER_POLICY: AssetSchedulerPolicy = Object.freeze({
  maxResidentBytes: 768 * 1024 * 1024,
  maxInflightBytes: 128 * 1024 * 1024,
  maxInflightRequests: 16,
  maxQueueLength: 512,
  staleAfterTicks: 1800,
  baseRetryTicks: 30,
  maxRetryTicks: 960,
});

interface QueueEntry {
  readonly id: AssetId;
  readonly score: number;
  readonly queuedTick: number;
}

export interface AssetAdmission {
  readonly accepted: boolean;
  readonly id: AssetId;
  readonly reason: 'accepted' | 'duplicate' | 'budget' | 'queue-full' | 'invalid';
  readonly evicted: readonly AssetId[];
}

export class AssetScheduler {
  readonly policy: AssetSchedulerPolicy;
  #records = new Map<AssetId, AssetRecord>();
  #queue: QueueEntry[] = [];
  #residentBytes = 0;
  #inflightBytes = 0;
  #hits = 0;
  #misses = 0;
  #retries = 0;
  #disposed = false;

  constructor(policy: AssetSchedulerPolicy = DEFAULT_ASSET_SCHEDULER_POLICY) {
    this.policy = Object.freeze({ ...policy });
  }

  #normalize(request: AssetRequest): Outcome<AssetRecord> {
    const url = request.url.trim();
    if (!url) return { ok: false, error: fault('asset', 'Asset URL is empty.', true) };
    if (!url.startsWith('/') && !url.startsWith('./') && !url.startsWith('../') && !/^https:\/\//i.test(url)) {
      return { ok: false, error: fault('asset', 'Asset URL protocol is not allowed.', true, { url }) };
    }
    const bytes = Math.max(0, Math.floor(request.estimatedBytes));
    if (!Number.isSafeInteger(bytes) || bytes > 2 ** 31) {
      return { ok: false, error: fault('budget', 'Asset byte estimate is outside the supported range.', true) };
    }
    const id = asAssetId(request.id?.trim() || stableHash({ url, kind: request.kind }));
    return {
      ok: true,
      value: Object.freeze({
        id,
        url,
        kind: request.kind,
        priority: clamp(request.priority, -100, 100),
        estimatedBytes: bytes,
        residentBytes: 0,
        attempts: 0,
        state: 'queued' as const,
        queuedTick: 0,
        lastUsedTick: 0,
      }),
    };
  }

  #score(record: AssetRecord, tick: number): number {
    return record.priority * 100 + Math.min(2000, tick - record.queuedTick) * 0.01 - Math.log2(Math.max(1, record.estimatedBytes));
  }

  #evictUntilFits(bytes: number): AssetId[] {
    const evicted: AssetId[] = [];
    while (this.#residentBytes + bytes > this.policy.maxResidentBytes) {
      const victim = [...this.#records.values()]
        .filter((record) => record.state === 'resident')
        .sort((a, b) =>
          a.priority - b.priority ||
          a.lastUsedTick - b.lastUsedTick ||
          a.id.localeCompare(b.id),
        )[0];
      if (!victim) break;
      this.#residentBytes = Math.max(0, this.#residentBytes - victim.residentBytes);
      this.#records.set(victim.id, Object.freeze({ ...victim, state: 'evicted', residentBytes: 0 }));
      evicted.push(victim.id);
    }
    return evicted;
  }

  admit(request: AssetRequest, tick: number): Outcome<AssetAdmission> {
    if (this.#disposed) return { ok: false, error: fault('disposed', 'Asset scheduler is disposed.', false) };
    const normalized = this.#normalize(request);
    if (!normalized.ok) return normalized;
    const record = normalized.value;
    const existing = this.#records.get(record.id);
    if (existing && existing.state !== 'evicted') {
      this.#hits += 1;
      return {
        ok: true,
        value: Object.freeze({
          accepted: true,
          id: record.id,
          reason: 'duplicate',
          evicted: [],
        }),
      };
    }
    this.#misses += 1;
    if (this.#queue.length >= this.policy.maxQueueLength) {
      return {
        ok: true,
        value: Object.freeze({
          accepted: false,
          id: record.id,
          reason: 'queue-full',
          evicted: [],
        }),
      };
    }
    if (record.estimatedBytes > this.policy.maxResidentBytes) {
      return {
        ok: true,
        value: Object.freeze({
          accepted: false,
          id: record.id,
          reason: 'budget',
          evicted: [],
        }),
      };
    }
    const evicted = this.#evictUntilFits(record.estimatedBytes);
    const queued = Object.freeze({ ...record, queuedTick: Math.max(0, Math.floor(tick)), lastUsedTick: Math.max(0, Math.floor(tick)) });
    this.#records.set(record.id, queued);
    this.#queue.push(Object.freeze({ id: record.id, score: this.#score(queued, tick), queuedTick: tick }));
    this.#sortQueue();
    return {
      ok: true,
      value: Object.freeze({
        accepted: true,
        id: record.id,
        reason: 'accepted',
        evicted,
      }),
    };
  }

  #sortQueue(): void {
    this.#queue.sort((a, b) => b.score - a.score || a.queuedTick - b.queuedTick || a.id.localeCompare(b.id));
  }

  next(tick: number): AssetRecord | null {
    const entry = this.#queue.find((candidate) => {
      const record = this.#records.get(candidate.id);
      return record?.state === 'queued' && record.retryAtTick === undefined || (
        record?.state === 'queued' && record.retryAtTick !== undefined && tick >= record.retryAtTick
      );
    });
    return entry ? this.#records.get(entry.id) ?? null : null;
  }

  begin(id: AssetId): Outcome<AssetRecord> {
    if (this.#disposed) return { ok: false, error: fault('disposed', 'Asset scheduler is disposed.', false) };
    const record = this.#records.get(id);
    if (!record) return { ok: false, error: fault('asset', 'Unknown asset id.', true, { id }) };
    if (record.state !== 'queued') return { ok: true, value: record };
    const loadingCount = [...this.#records.values()].filter((item) => item.state === 'loading').length;
    if (loadingCount >= this.policy.maxInflightRequests) return { ok: false, error: fault('budget', 'Inflight request limit reached.', true) };
    if (this.#inflightBytes + record.estimatedBytes > this.policy.maxInflightBytes) return { ok: false, error: fault('budget', 'Inflight byte budget reached.', true) };
    this.#queue = this.#queue.filter((entry) => entry.id !== id);
    this.#inflightBytes += record.estimatedBytes;
    const next = Object.freeze({ ...record, state: 'loading' as const, attempts: record.attempts + 1 });
    this.#records.set(id, next);
    return { ok: true, value: next };
  }

  complete(id: AssetId, residentBytes: number, tick: number): Outcome<AssetRecord> {
    if (this.#disposed) return { ok: false, error: fault('disposed', 'Asset scheduler is disposed.', false) };
    const record = this.#records.get(id);
    if (!record) return { ok: false, error: fault('asset', 'Unknown asset id.', true) };
    if (record.state !== 'loading') return { ok: true, value: record };
    const bytes = Math.max(0, Math.floor(residentBytes));
    this.#inflightBytes = Math.max(0, this.#inflightBytes - record.estimatedBytes);
    const evicted = this.#evictUntilFits(bytes);
    if (this.#residentBytes + bytes > this.policy.maxResidentBytes) {
      const failed = Object.freeze({ ...record, state: 'failed' as const, residentBytes: 0, lastUsedTick: tick });
      this.#records.set(id, failed);
      return { ok: false, error: fault('budget', 'Resident asset budget cannot fit completed asset.', true, { id, bytes }) };
    }
    this.#residentBytes += bytes;
    const next = Object.freeze({ ...record, state: 'resident' as const, residentBytes: bytes, lastUsedTick: tick, retryAtTick: undefined, ...('evicted' in { evicted } ? {} : {}) });
    this.#records.set(id, next);
    return { ok: true, value: next };
  }

  fail(id: AssetId, message: string, tick: number): Outcome<AssetRecord> {
    if (this.#disposed) return { ok: false, error: fault('disposed', 'Asset scheduler is disposed.', false) };
    const record = this.#records.get(id);
    if (!record) return { ok: false, error: fault('asset', 'Unknown asset id.', true) };
    this.#inflightBytes = Math.max(0, this.#inflightBytes - record.estimatedBytes);
    const maxRetries = 3;
    const canRetry = record.attempts <= maxRetries;
    const delay = Math.min(this.policy.maxRetryTicks, this.policy.baseRetryTicks * 2 ** Math.max(0, record.attempts - 1));
    const next = Object.freeze({
      ...record,
      state: canRetry ? ('queued' as const) : ('failed' as const),
      lastError: message.slice(0, 512),
      ...(canRetry ? { retryAtTick: tick + delay } : {}),
    });
    if (canRetry) {
      this.#retries += 1;
      this.#queue.push(Object.freeze({ id, score: this.#score(next, tick) - delay * 0.02, queuedTick: tick }));
      this.#sortQueue();
    }
    this.#records.set(id, next);
    return { ok: true, value: next };
  }

  touch(id: AssetId, tick: number): boolean {
    const record = this.#records.get(id);
    if (!record) return false;
    this.#records.set(id, Object.freeze({ ...record, lastUsedTick: tick }));
    return true;
  }

  tick(tick: number): void {
    if (this.#disposed) return;
    for (const [id, record] of this.#records) {
      if (record.state === 'resident' && tick - record.lastUsedTick >= this.policy.staleAfterTicks) {
        this.#residentBytes = Math.max(0, this.#residentBytes - record.residentBytes);
        this.#records.set(id, Object.freeze({ ...record, state: 'stale', residentBytes: 0 }));
      }
    }
    this.#queue = this.#queue.filter((entry) => this.#records.get(entry.id)?.state === 'queued');
    this.#sortQueue();
  }

  record(id: AssetId): AssetRecord | null { return this.#records.get(id) ?? null; }
  records(): readonly AssetRecord[] { return Object.freeze([...this.#records.values()].sort((a, b) => a.id.localeCompare(b.id))); }

  diagnostics() {
    const counts = { queued: 0, loading: 0, resident: 0, stale: 0, failed: 0, evicted: 0 };
    for (const record of this.#records.values()) counts[record.state] += 1;
    return Object.freeze({
      ...counts,
      residentBytes: this.#residentBytes,
      inflightBytes: this.#inflightBytes,
      cacheHitRate: this.#hits + this.#misses === 0 ? 1 : this.#hits / (this.#hits + this.#misses),
      retries: this.#retries,
      digest: stableHash(this.records().map((record) => ({
        id: record.id,
        state: record.state,
        attempts: record.attempts,
        residentBytes: record.residentBytes,
      }))),
    });
  }

  dispose(): void {
    this.#disposed = true;
    this.#records.clear();
    this.#queue = [];
    this.#residentBytes = 0;
    this.#inflightBytes = 0;
  }
}
