import type { AssetBudget, AssetId, AssetKind, AssetRecord, AssetRequest, AssetState, Result, TickId } from './liveCoreTypes.ts';
import { assetId, clamp, err, ok, stableHash, tickId } from './liveCoreTypes.ts';export interface AssetRuntimePolicy extends AssetBudget {
  readonly baseRetryDelayTicks: number;
  readonly maxRetryDelayTicks: number;
  readonly admissionPriorityFloor: number;
}

export const DEFAULT_ASSET_POLICY: AssetRuntimePolicy = Object.freeze({
  maxResidentBytes: 512 * 1024 * 1024,
  maxInflightBytes: 96 * 1024 * 1024,
  maxInflightRequests: 12,
  maxRetriesPerAsset: 3,
  staleAfterTicks: 1800,
  baseRetryDelayTicks: 30,
  maxRetryDelayTicks: 900,
  admissionPriorityFloor: -10,
});

export interface AssetQueueEntry {
  readonly request: AssetRequest;
  readonly score: number;
  readonly queuedTick: TickId;
}

export interface AssetAdmission {
  readonly accepted: boolean;
  readonly reason: 'accepted' | 'duplicate' | 'budget' | 'invalid';
  readonly evicted: readonly AssetId[];
  readonly score: number;
}

export interface AssetRuntimeDiagnostics {
  readonly queued: number;
  readonly loading: number;
  readonly resident: number;
  readonly failed: number;
  readonly evicted: number;
  readonly residentBytes: number;
  readonly inflightBytes: number;
  readonly cacheHitRate: number;
  readonly retryCount: number;
  readonly digest: string;
}

const rankForState = (state: AssetState): number => {
  switch (state) {
    case 'resident': return 5;
    case 'loading': return 4;
    case 'queued': return 3;
    case 'stale': return 2;
    case 'failed': return 1;
    case 'evicted': return 0;
  }
};

const normalizeUrl = (value: string): string => {
  try {
    const url = new URL(value, 'https://aapw.invalid/');
    if (url.protocol !== 'https:' && url.hostname !== 'aapw.invalid') return '';
    return url.href;
  } catch {
    return '';
  }
};

const retryDelay = (attempt: number, policy: AssetRuntimePolicy): number => {
  const exponent = Math.max(0, Math.floor(attempt) - 1);
  return Math.min(policy.maxRetryDelayTicks, policy.baseRetryDelayTicks * 2 ** exponent);
};

export const makeAssetRequest = (
  input: Omit<AssetRequest, 'id' | 'url' | 'estimatedBytes' | 'maxRetries'> & {
    readonly key?: string;
    readonly url: string;
    readonly estimatedBytes?: number;
    readonly maxRetries?: number;
  },
): Result<AssetRequest> => {
  const url = normalizeUrl(input.url);
  if (!url) return err('INVALID_FRAME', 'Asset URL is invalid or uses a disallowed protocol.', true);
  const estimatedBytes = Math.max(0, Math.floor(input.estimatedBytes ?? 0));
  if (!Number.isSafeInteger(estimatedBytes) || estimatedBytes > 2 ** 31) {
    return err('ASSET_BUDGET', 'Asset byte estimate exceeds the supported range.', true);
  }
  const id = assetId(input.key?.trim() || stableHash({ kind: input.kind, url }));
  return ok(Object.freeze({
    id,
    kind: input.kind,
    url,
    priority: clamp(input.priority, -100, 100),
    estimatedBytes,
    ...(input.integrity ? { integrity: Object.freeze({ ...input.integrity }) } : {}),
    maxRetries: clamp(input.maxRetries ?? 3, 0, 8),
  }));
};

export class StrictAssetRuntime {
  #policy: AssetRuntimePolicy;
  #records = new Map<AssetId, AssetRecord>();
  #queue: AssetQueueEntry[] = [];
  #residentBytes = 0;
  #inflightBytes = 0;
  #hits = 0;
  #misses = 0;
  #retryCount = 0;
  #disposed = false;

  constructor(policy: AssetRuntimePolicy = DEFAULT_ASSET_POLICY) {
    this.#policy = Object.freeze({ ...policy });
  }

  #assertAlive(): Result<never> | null {
    return this.#disposed ? err('RUNTIME_DISPOSED', 'Asset runtime is disposed.') : null;
  }

  #score(request: AssetRequest, tick: TickId): number {
    const age = Math.max(0, Number(tick));
    const sizePenalty = Math.log2(Math.max(1, request.estimatedBytes)) * 0.15;
    return request.priority * 10 + age * 0.002 - sizePenalty;
  }

  #evictUntilFits(bytes: number): AssetId[] {
    const evicted: AssetId[] = [];
    while (this.#residentBytes + bytes > this.#policy.maxResidentBytes) {
      const candidates = [...this.#records.values()]
        .filter((record) => record.state === 'resident')
        .sort((a, b) =>
          rankForState(a.state) - rankForState(b.state) ||
          a.request.priority - b.request.priority ||
          a.request.id.localeCompare(b.request.id),
        );
      const victim = candidates[0];
      if (!victim) break;
      this.#residentBytes = Math.max(0, this.#residentBytes - victim.residentBytes);
      this.#records.set(victim.request.id, Object.freeze({ ...victim, state: 'evicted', residentBytes: 0 }));
      evicted.push(victim.request.id);
    }
    return evicted;
  }

  admit(request: AssetRequest, tick: TickId): Result<AssetAdmission> {
    const failure = this.#assertAlive();
    if (failure) return failure;
    const existing = this.#records.get(request.id);
    if (existing && existing.state !== 'evicted') {
      this.#hits += 1;
      return ok(Object.freeze({
        accepted: true,
        reason: 'duplicate',
        evicted: [],
        score: this.#score(request, tick),
      }));
    }
    this.#misses += 1;
    if (request.priority < this.#policy.admissionPriorityFloor) {
      return ok(Object.freeze({ accepted: false, reason: 'invalid', evicted: [], score: this.#score(request, tick) }));
    }
    const evicted = this.#evictUntilFits(request.estimatedBytes);
    if (this.#residentBytes + request.estimatedBytes > this.#policy.maxResidentBytes) {
      return ok(Object.freeze({ accepted: false, reason: 'budget', evicted, score: this.#score(request, tick) }));
    }
    const record: AssetRecord = Object.freeze({
      request,
      state: 'queued',
      attempts: 0,
      residentBytes: 0,
      queuedAtTick: tick,
    });
    this.#records.set(request.id, record);
    this.#queue.push(Object.freeze({ request, queuedTick: tick, score: this.#score(request, tick) }));
    this.#queue.sort((a, b) => b.score - a.score || a.request.id.localeCompare(b.request.id));
    return ok(Object.freeze({ accepted: true, reason: 'accepted', evicted, score: this.#score(request, tick) }));
  }

  beginLoad(id: AssetId): Result<AssetRecord> {
    const failure = this.#assertAlive();
    if (failure) return failure;
    const record = this.#records.get(id);
    if (!record) return err('INVALID_FRAME', 'Asset is not admitted.', true, { id });
    if (record.state !== 'queued') return ok(record);
    if (this.#inflightBytes + record.request.estimatedBytes > this.#policy.maxInflightBytes) {
      return err('ASSET_BUDGET', 'Inflight asset byte budget would be exceeded.', true);
    }
    const loadingCount = [...this.#records.values()].filter((item) => item.state === 'loading').length;
    if (loadingCount >= this.#policy.maxInflightRequests) {
      return err('ASSET_BUDGET', 'Inflight asset request count would be exceeded.', true);
    }
    this.#queue = this.#queue.filter((entry) => entry.request.id !== id);
    this.#inflightBytes += record.request.estimatedBytes;
    const next = Object.freeze({ ...record, state: 'loading' as const, attempts: record.attempts + 1 });
    this.#records.set(id, next);
    return ok(next);
  }

  complete(id: AssetId, residentBytes: number, tick: TickId): Result<AssetRecord> {
    const failure = this.#assertAlive();
    if (failure) return failure;
    const record = this.#records.get(id);
    if (!record) return err('INVALID_FRAME', 'Cannot complete an unknown asset.', true, { id });
    const bytes = Math.max(0, Math.floor(residentBytes));
    this.#inflightBytes = Math.max(0, this.#inflightBytes - record.request.estimatedBytes);
    const space = this.#evictUntilFits(bytes);
    if (space.length && this.#residentBytes + bytes > this.#policy.maxResidentBytes) {
      this.#records.set(id, Object.freeze({ ...record, state: 'failed', residentBytes: 0, lastError: 'resident-budget' }));
      return err('ASSET_BUDGET', 'Completed asset cannot fit resident budget.', true, { id, bytes });
    }
    this.#residentBytes += bytes;
    const next = Object.freeze({ ...record, state: 'resident' as const, residentBytes: bytes, queuedAtTick: tick });
    this.#records.set(id, next);
    return ok(next);
  }

  fail(id: AssetId, message: string, tick: TickId): Result<AssetRecord> {
    const failure = this.#assertAlive();
    if (failure) return failure;
    const record = this.#records.get(id);
    if (!record) return err('INVALID_FRAME', 'Cannot fail an unknown asset.', true, { id });
    this.#inflightBytes = Math.max(0, this.#inflightBytes - record.request.estimatedBytes);
    const canRetry = record.attempts <= Math.min(this.#policy.maxRetriesPerAsset, record.request.maxRetries);
    const retryTick = tickId(Number(tick) + retryDelay(record.attempts, this.#policy));
    const next = Object.freeze({
      ...record,
      state: canRetry ? ('queued' as const) : ('failed' as const),
      lastError: message.slice(0, 512),
      ...(canRetry ? { nextRetryTick: retryTick } : {}),
    });
    if (canRetry) {
      this.#retryCount += 1;
      this.#queue.push(Object.freeze({
        request: record.request,
        queuedTick: tick,
        score: this.#score(record.request, tick) - retryDelay(record.attempts, this.#policy) * 0.01,
      }));
      this.#queue.sort((a, b) => b.score - a.score || a.request.id.localeCompare(b.request.id));
    }
    this.#records.set(id, next);
    return ok(next);
  }

  tick(tick: TickId): void {
    if (this.#disposed) return;
    for (const [id, record] of this.#records) {
      if (record.state === 'resident' && tick - record.queuedAtTick > this.#policy.staleAfterTicks) {
        this.#residentBytes = Math.max(0, this.#residentBytes - record.residentBytes);
        this.#records.set(id, Object.freeze({ ...record, state: 'stale', residentBytes: 0 }));
      }
    }
    this.#queue = this.#queue
      .filter((entry) => {
        const record = this.#records.get(entry.request.id);
        return record?.state === 'queued' && (record.nextRetryTick === undefined || tick >= record.nextRetryTick);
      })
      .sort((a, b) => b.score - a.score || a.request.id.localeCompare(b.request.id));
  }

  next(): AssetRequest | null {
    return this.#queue[0]?.request ?? null;
  }

  record(id: AssetId): AssetRecord | null {
    return this.#records.get(id) ?? null;
  }

  diagnostics(): AssetRuntimeDiagnostics {
    const counts: Record<AssetState, number> = { queued: 0, loading: 0, resident: 0, stale: 0, failed: 0, evicted: 0 };
    for (const record of this.#records.values()) counts[record.state] += 1;
    return Object.freeze({
      ...counts,
      residentBytes: this.#residentBytes,
      inflightBytes: this.#inflightBytes,
      cacheHitRate: this.#hits + this.#misses === 0 ? 1 : this.#hits / (this.#hits + this.#misses),
      retryCount: this.#retryCount,
      digest: stableHash([...this.#records.values()].map((record) => ({
        id: record.request.id, state: record.state, attempts: record.attempts, bytes: record.residentBytes,
      })).sort((a,b)=>a.id.localeCompare(b.id))),
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

export const assetStateRank = rankForState;