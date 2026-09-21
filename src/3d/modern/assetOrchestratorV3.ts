/**
 * Asset Orchestrator V3.
 *
 * Centralises manifest validation, request de-duplication, cancellation,
 * retries, memory accounting, integrity checks and deterministic cache policy.
 * The orchestrator never assumes a particular renderer; callers receive typed
 * payloads and lifecycle callbacks.
 *
 * @module assetOrchestratorV3
 */

export type AssetKind =
  | 'model'
  | 'texture'
  | 'audio'
  | 'shader'
  | 'json'
  | 'binary';

export type AssetPriority = 'critical' | 'high' | 'normal' | 'low' | 'background';

export type AssetState =
  | 'declared'
  | 'queued'
  | 'loading'
  | 'ready'
  | 'failed'
  | 'evicted';

export type AssetDescriptor = {
  readonly id: string;
  readonly url: string;
  readonly kind: AssetKind;
  readonly priority: AssetPriority;
  readonly expectedBytes?: number;
  readonly maxBytes?: number;
  readonly sha256?: string;
  readonly contentType?: string;
  readonly tags?: readonly string[];
  readonly cacheable?: boolean;
  readonly critical?: boolean;
};

export type AssetRecord<T = unknown> = {
  readonly descriptor: AssetDescriptor;
  readonly state: AssetState;
  readonly bytes: number;
  readonly createdAtMs: number;
  readonly readyAtMs?: number;
  readonly lastUsedAtMs: number;
  readonly useCount: number;
  readonly value?: T;
  readonly errorMessage?: string;
};

export type AssetFetcher<T> = (
  descriptor: AssetDescriptor,
  signal: AbortSignal,
) => Promise<{ readonly value: T; readonly bytes: number; readonly contentType?: string }>;

export type AssetValidator<T> = (
  descriptor: AssetDescriptor,
  payload: { readonly value: T; readonly bytes: number; readonly contentType?: string },
) => Promise<void> | void;

export type AssetOrchestratorOptions = {
  readonly maxResidentBytes?: number;
  readonly maxConcurrent?: number;
  readonly maxRetries?: number;
  readonly retryBaseMs?: number;
  readonly clock?: () => number;
};

export type AssetLoadResult<T> = {
  readonly id: string;
  readonly value: T;
  readonly bytes: number;
  readonly attempts: number;
  readonly fromCache: boolean;
};

type PendingRequest<T> = {
  readonly promise: Promise<AssetLoadResult<T>>;
  readonly controller: AbortController;
  readonly waiters: number;
};

type InternalRecord<T = unknown> = AssetRecord<T> & {
  value?: T;
};

const PRIORITY_WEIGHT: Readonly<Record<AssetPriority, number>> = {
  critical: 100,
  high: 80,
  normal: 60,
  low: 35,
  background: 10,
};

const KIND_WEIGHT: Readonly<Record<AssetKind, number>> = {
  model: 1.2,
  texture: 1.1,
  audio: 0.8,
  shader: 0.9,
  json: 0.6,
  binary: 1,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeId(value: string): string {
  return value.trim().replace(/\s+/g, ':');
}

function normalizeHash(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.trim().toLowerCase();
}

async function digestValue(value: unknown): Promise<string | null> {
  if (typeof value !== 'string' && !(value instanceof Uint8Array)) {
    return null;
  }
  const bytes =
    typeof value === 'string'
      ? new TextEncoder().encode(value)
      : value;
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    return null;
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export class AssetOrchestratorV3 {
  readonly #records = new Map<string, InternalRecord>();
  readonly #pending = new Map<string, PendingRequest<unknown>>();
  readonly #descriptors = new Map<string, AssetDescriptor>();
  readonly #clock: () => number;
  readonly #maxResidentBytes: number;
  readonly #maxConcurrent: number;
  readonly #maxRetries: number;
  readonly #retryBaseMs: number;

  #residentBytes = 0;
  #activeLoads = 0;

  constructor(options: AssetOrchestratorOptions = {}) {
    this.#clock = options.clock ?? (() => performance.now());
    this.#maxResidentBytes = Math.max(1024 * 1024, Math.floor(options.maxResidentBytes ?? 256 * 1024 * 1024));
    this.#maxConcurrent = clamp(Math.floor(options.maxConcurrent ?? 6), 1, 32);
    this.#maxRetries = clamp(Math.floor(options.maxRetries ?? 2), 0, 8);
    this.#retryBaseMs = clamp(Math.floor(options.retryBaseMs ?? 150), 20, 5000);
  }

  declare(descriptor: AssetDescriptor): AssetDescriptor {
    const id = normalizeId(descriptor.id);
    if (!id) {
      throw new Error('Asset id cannot be empty');
    }
    if (!/^https?:\\/\\//i.test(descriptor.url)) {
      throw new Error(\`Asset \${id} must use an absolute http(s) URL\`);
    }
    if (this.#descriptors.has(id)) {
      throw new Error(\`Asset already declared: \${id}\`);
    }

    const normalized: AssetDescriptor = {
      ...descriptor,
      id,
      url: descriptor.url.trim(),
      priority: descriptor.priority,
      expectedBytes:
        descriptor.expectedBytes === undefined
          ? undefined
          : Math.max(0, Math.floor(descriptor.expectedBytes)),
      maxBytes:
        descriptor.maxBytes === undefined
          ? undefined
          : Math.max(1, Math.floor(descriptor.maxBytes)),
      sha256: normalizeHash(descriptor.sha256),
      contentType: descriptor.contentType?.trim().toLowerCase(),
      tags: descriptor.tags ? [...new Set(descriptor.tags.map((tag) => tag.trim()).filter(Boolean))] : undefined,
      cacheable: descriptor.cacheable ?? true,
      critical: descriptor.critical ?? descriptor.priority === 'critical',
    };

    this.#descriptors.set(id, normalized);
    this.#records.set(id, {
      descriptor: normalized,
      state: 'declared',
      bytes: 0,
      createdAtMs: this.#clock(),
      lastUsedAtMs: this.#clock(),
      useCount: 0,
    });
    return normalized;
  }

  declareMany(descriptors: readonly AssetDescriptor[]): readonly AssetDescriptor[] {
    return descriptors.map((descriptor) => this.declare(descriptor));
  }

  has(id: string): boolean {
    return this.#descriptors.has(normalizeId(id));
  }

  record(id: string): AssetRecord | undefined {
    const record = this.#records.get(normalizeId(id));
    return record ? { ...record } : undefined;
  }

  async load<T>(
    id: string,
    fetcher: AssetFetcher<T>,
    validator?: AssetValidator<T>,
  ): Promise<AssetLoadResult<T>> {
    const normalizedId = normalizeId(id);
    const descriptor = this.#descriptors.get(normalizedId);
    if (!descriptor) {
      throw new Error(\`Asset not declared: \${normalizedId}\`);
    }

    const existing = this.#records.get(normalizedId);
    if (existing?.state === 'ready' && existing.value !== undefined) {
      existing.lastUsedAtMs = this.#clock();
      existing.useCount += 1;
      return {
        id: normalizedId,
        value: existing.value as T,
        bytes: existing.bytes,
        attempts: 0,
        fromCache: true,
      };
    }

    const pending = this.#pending.get(normalizedId);
    if (pending) {
      pending.waiters += 1;
      return pending.promise as Promise<AssetLoadResult<T>>;
    }

    const controller = new AbortController();
    const promise = this.#loadWithRetries(normalizedId, fetcher, validator, controller.signal);
    this.#pending.set(normalizedId, {
      promise: promise as Promise<AssetLoadResult<unknown>>,
      controller,
      waiters: 1,
    });

    try {
      return await promise;
    } finally {
      this.#pending.delete(normalizedId);
    }
  }

  cancel(id: string): boolean {
    const normalizedId = normalizeId(id);
    const pending = this.#pending.get(normalizedId);
    if (!pending) {
      return false;
    }
    pending.controller.abort();
    return true;
  }

  async #loadWithRetries<T>(
    id: string,
    fetcher: AssetFetcher<T>,
    validator: AssetValidator<T> | undefined,
    signal: AbortSignal,
  ): Promise<AssetLoadResult<T>> {
    const descriptor = this.#descriptors.get(id);
    const record = this.#records.get(id);
    if (!descriptor || !record) {
      throw new Error(\`Asset lifecycle record missing: \${id}\`);
    }

    if (this.#activeLoads >= this.#maxConcurrent) {
      await this.#waitForCapacity(signal);
    }

    this.#activeLoads += 1;
    record.state = 'loading';

    let attempts = 0;
    let lastError: Error | undefined;

    try {
      while (attempts <= this.#maxRetries) {
        attempts += 1;
        if (signal.aborted) {
          throw new DOMException('Asset load aborted', 'AbortError');
        }

        try {
          const payload = await fetcher(descriptor, signal);
          this.#validatePayload(descriptor, payload);
          if (validator) {
            await validator(descriptor, payload);
          }
          await this.#validateDigest(descriptor, payload.value);

          this.#ensureCapacity(payload.bytes, id);
          const now = this.#clock();
          record.state = 'ready';
          record.bytes = Math.max(0, Math.floor(payload.bytes));
          record.lastUsedAtMs = now;
          record.readyAtMs = now;
          record.useCount += 1;
          record.value = payload.value;
          record.errorMessage = undefined;
          this.#residentBytes += record.bytes;

          return {
            id,
            value: payload.value,
            bytes: record.bytes,
            attempts,
            fromCache: false,
          };
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          record.errorMessage = lastError.message;
          if (attempts > this.#maxRetries || signal.aborted) {
            break;
          }
          await delayWithSignal(this.#retryBaseMs * Math.pow(2, attempts - 1), signal);
        }
      }

      record.state = 'failed';
      throw lastError ?? new Error(\`Asset load failed: \${id}\`);
    } finally {
      this.#activeLoads -= 1;
    }
  }

  #validatePayload<T>(
    descriptor: AssetDescriptor,
    payload: { readonly value: T; readonly bytes: number; readonly contentType?: string },
  ): void {
    if (!Number.isFinite(payload.bytes) || payload.bytes < 0) {
      throw new Error(\`Invalid byte count for asset \${descriptor.id}\`);
    }
    if (descriptor.maxBytes !== undefined && payload.bytes > descriptor.maxBytes) {
      throw new Error(
        \`Asset \${descriptor.id} exceeds maxBytes \${descriptor.maxBytes}\`,
      );
    }
    if (descriptor.expectedBytes !== undefined && payload.bytes > descriptor.expectedBytes * 2.5) {
      throw new Error(
        \`Asset \${descriptor.id} exceeds expected-size safety envelope\`,
      );
    }
    if (
      descriptor.contentType &&
      payload.contentType &&
      payload.contentType.toLowerCase() !== descriptor.contentType
    ) {
      throw new Error(
        \`Asset \${descriptor.id} content type mismatch: expected \${descriptor.contentType}, got \${payload.contentType}\`,
      );
    }
  }

  async #validateDigest(descriptor: AssetDescriptor, value: unknown): Promise<void> {
    if (!descriptor.sha256) {
      return;
    }
    const digest = await digestValue(value);
    if (!digest) {
      return;
    }
    if (digest !== descriptor.sha256) {
      throw new Error(\`Asset integrity mismatch for \${descriptor.id}\`);
    }
  }

  #ensureCapacity(incomingBytes: number, incomingId: string): void {
    const incoming = Math.max(0, Math.floor(incomingBytes));
    if (incoming > this.#maxResidentBytes) {
      throw new Error(
        \`Asset \${incomingId} exceeds resident memory budget\`,
      );
    }
    while (
      this.#residentBytes + incoming > this.#maxResidentBytes &&
      this.#residentBytes > 0
    ) {
      const candidate = this.#selectEvictionCandidate(incomingId);
      if (!candidate) {
        throw new Error('No evictable asset available under memory pressure');
      }
      this.evict(candidate);
    }
  }

  #selectEvictionCandidate(incomingId: string): string | null {
    let selected: { id: string; score: number } | null = null;
    for (const [id, record] of this.#records) {
      if (id === incomingId || record.state !== 'ready' || !record.value) {
        continue;
      }
      if (!record.descriptor.cacheable || record.descriptor.critical) {
        continue;
      }

      const ageMs = Math.max(0, this.#clock() - record.lastUsedAtMs);
      const priorityWeight = PRIORITY_WEIGHT[record.descriptor.priority];
      const kindWeight = KIND_WEIGHT[record.descriptor.kind];
      const frequencyPenalty = Math.log2(1 + record.useCount) * 8;
      const score =
        priorityWeight +
        kindWeight * 10 +
        frequencyPenalty -
        Math.min(ageMs / 1000, 120);

      if (!selected || score < selected.score) {
        selected = { id, score };
      }
    }
    return selected?.id ?? null;
  }

  evict(id: string): boolean {
    const normalizedId = normalizeId(id);
    const record = this.#records.get(normalizedId);
    if (!record || record.state !== 'ready') {
      return false;
    }
    this.#residentBytes = Math.max(0, this.#residentBytes - record.bytes);
    record.state = 'evicted';
    record.value = undefined;
    record.bytes = 0;
    record.lastUsedAtMs = this.#clock();
    return true;
  }

  pruneToBudget(targetBytes = this.#maxResidentBytes): readonly string[] {
    const target = clamp(
      Math.floor(targetBytes),
      0,
      this.#maxResidentBytes,
    );
    const evicted: string[] = [];
    while (this.#residentBytes > target) {
      const candidate = this.#selectEvictionCandidate('');
      if (!candidate || !this.evict(candidate)) {
        break;
      }
      evicted.push(candidate);
    }
    return evicted;
  }

  touch(id: string): boolean {
    const record = this.#records.get(normalizeId(id));
    if (!record || record.state !== 'ready') {
      return false;
    }
    record.lastUsedAtMs = this.#clock();
    record.useCount += 1;
    return true;
  }

  stats(): {
    readonly declared: number;
    readonly ready: number;
    readonly failed: number;
    readonly queued: number;
    readonly loading: number;
    readonly evicted: number;
    readonly residentBytes: number;
    readonly residentRatio: number;
    readonly activeLoads: number;
  } {
    let ready = 0;
    let failed = 0;
    let queued = 0;
    let loading = 0;
    let evicted = 0;
    for (const record of this.#records.values()) {
      if (record.state === 'ready') ready += 1;
      if (record.state === 'failed') failed += 1;
      if (record.state === 'queued') queued += 1;
      if (record.state === 'loading') loading += 1;
      if (record.state === 'evicted') evicted += 1;
    }
    return {
      declared: this.#records.size,
      ready,
      failed,
      queued,
      loading,
      evicted,
      residentBytes: this.#residentBytes,
      residentRatio: this.#residentBytes / this.#maxResidentBytes,
      activeLoads: this.#activeLoads,
    };
  }

  inspect(): readonly AssetRecord[] {
    return [...this.#records.values()]
      .map((record) => ({ ...record }))
      .sort((a, b) => a.descriptor.id.localeCompare(b.descriptor.id));
  }

  reset(id?: string): void {
    if (id) {
      const normalizedId = normalizeId(id);
      const record = this.#records.get(normalizedId);
      if (!record) {
        return;
      }
      this.#residentBytes = Math.max(0, this.#residentBytes - record.bytes);
      record.state = 'declared';
      record.bytes = 0;
      record.value = undefined;
      record.readyAtMs = undefined;
      record.lastUsedAtMs = this.#clock();
      record.useCount = 0;
      record.errorMessage = undefined;
      return;
    }

    for (const record of this.#records.values()) {
      record.state = 'declared';
      record.bytes = 0;
      record.value = undefined;
      record.readyAtMs = undefined;
      record.lastUsedAtMs = this.#clock();
      record.useCount = 0;
      record.errorMessage = undefined;
    }
    this.#residentBytes = 0;
  }

  async #waitForCapacity(signal: AbortSignal): Promise<void> {
    let waitedMs = 0;
    while (this.#activeLoads >= this.#maxConcurrent) {
      if (signal.aborted) {
        throw new DOMException('Asset queue wait aborted', 'AbortError');
      }
      await delayWithSignal(4, signal);
      waitedMs += 4;
      if (waitedMs > 30_000) {
        throw new Error('Asset scheduler capacity wait exceeded 30s');
      }
    }
  }
}

function delayWithSignal(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timeout = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function createAssetFetcherFromResponse(): AssetFetcher<Response> {
  return async (descriptor, signal) => {
    const response = await fetch(descriptor.url, {
      signal,
      credentials: 'same-origin',
      cache: descriptor.cacheable === false ? 'no-store' : 'force-cache',
    });
    if (!response.ok) {
      throw new Error(\`Asset HTTP \${response.status} for \${descriptor.id}\`);
    }
    const contentType = response.headers.get('content-type') ?? undefined;
    const bytes = Number(response.headers.get('content-length') ?? 0);
    return { value: response, bytes, contentType };
  };
}

export function assetPriorityScore(
  descriptor: AssetDescriptor,
  distanceMeters: number,
): number {
  const distancePenalty = clamp(distanceMeters / 10_000, 0, 1) * 40;
  return PRIORITY_WEIGHT[descriptor.priority] - distancePenalty;
}
