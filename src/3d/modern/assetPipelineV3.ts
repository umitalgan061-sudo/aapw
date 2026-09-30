/**
 * Production asset pipeline for AAPW v3.
 *
 * The pipeline separates URL validation, fetch policy, byte-budget enforcement, integrity checks,
 * cache admission, decode lifecycle and disposal. Browser-specific decoders are injected through a
 * narrow interface, which keeps the core testable without WebGL or DOM globals.
 */

export type AssetId = string & { readonly __brand: 'AssetId' };
export type AssetKind = 'model' | 'texture' | 'audio' | 'data' | 'shader' | 'font';
export type AssetState = 'declared' | 'loading' | 'ready' | 'failed' | 'evicted' | 'disposed';
export type AssetPriority = 'critical' | 'near' | 'normal' | 'background';

export interface AssetDescriptor {
  readonly id: AssetId;
  readonly url: string;
  readonly kind: AssetKind;
  readonly bytes: number;
  readonly priority: AssetPriority;
  readonly digest?: string;
  readonly contentType?: string;
  readonly tags: readonly string[];
}

export interface AssetRecord {
  readonly descriptor: AssetDescriptor;
  state: AssetState;
  loadedBytes: number;
  lastTouchedTick: number;
  useCount: number;
  error: string | null;
  value: unknown;
}

export interface AssetBudgetV3 {
  readonly maxBytes: number;
  readonly reserveCriticalBytes: number;
  readonly maxConcurrentLoads: number;
  readonly maxAssetBytes: number;
}

export interface AssetDecoderV3<T = unknown> {
  readonly kind: AssetKind;
  decode(bytes: Uint8Array, descriptor: AssetDescriptor): Promise<T>;
  dispose?(value: T): void;
}

export interface AssetTransportV3 {
  fetch(url: string, init?: RequestInit): Promise<Response>;
}

export interface AssetPipelineMetricsV3 {
  manifestCount: number;
  readyCount: number;
  loadingCount: number;
  failedCount: number;
  cachedBytes: number;
  inflightLoads: number;
  cacheHits: number;
  cacheMisses: number;
  evictions: number;
  rejectedLoads: number;
}

export interface AssetLoadOptionsV3 {
  readonly tick?: number;
  readonly signal?: AbortSignal;
  readonly priorityOverride?: AssetPriority;
}

const assetId = (value: string): AssetId => value as AssetId;

const isFiniteNonNegative = (value: number): boolean => Number.isFinite(value) && value >= 0;

const priorityRank: Record<AssetPriority, number> = {
  critical: 4,
  near: 3,
  normal: 2,
  background: 1,
};

const allowedSchemes = new Set(['https:', 'http:']);
const forbiddenHosts = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

export function validateAssetUrlV3(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw, 'https://assets.invalid');
  } catch {
    throw new Error(`Invalid asset URL: ${raw}`);
  }
  if (!allowedSchemes.has(parsed.protocol)) throw new Error(`Unsupported asset URL scheme: ${parsed.protocol}`);
  if (forbiddenHosts.has(parsed.hostname)) throw new Error(`Forbidden asset host: ${parsed.hostname}`);
  return parsed;
}

export function normalizeAssetDescriptorV3(input: AssetDescriptor): AssetDescriptor {
  validateAssetUrlV3(input.url);
  if (!input.id.trim()) throw new Error('Asset id is required');
  if (!Number.isInteger(input.bytes) || input.bytes < 0) throw new Error(`Invalid declared byte count for ${input.id}`);
  const tags = [...new Set(input.tags.filter((tag) => tag.trim().length > 0).map((tag) => tag.trim()))].sort();
  return Object.freeze({
    id: assetId(input.id.trim()),
    url: new URL(input.url).toString(),
    kind: input.kind,
    bytes: input.bytes,
    priority: input.priority,
    digest: input.digest?.trim().toLowerCase(),
    contentType: input.contentType?.trim().toLowerCase(),
    tags,
  });
}

export function assetDigestV3(bytes: Uint8Array): string {
  let hash = 2166136261;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  let second = 0x9e3779b9;
  for (let index = 0; index < bytes.length; index += 1) {
    second ^= bytes[index] ?? 0;
    second = Math.imul(second ^ (second >>> 16), 0x85ebca6b);
    second ^= index;
  }
  return `${(hash >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}

const readResponseBytes = async (response: Response, limit: number, signal?: AbortSignal): Promise<Uint8Array> => {
  if (!response.ok) throw new Error(`Asset request failed: HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > limit) throw new Error(`Asset exceeds byte limit: ${declared} > ${limit}`);
  if (response.body && 'getReader' in response.body) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        if (signal?.aborted) throw new DOMException('Asset load aborted', 'AbortError');
        const next = await reader.read();
        if (next.done) break;
        const chunk = next.value;
        total += chunk.byteLength;
        if (total > limit) throw new Error(`Asset exceeds byte limit while streaming: ${total} > ${limit}`);
        chunks.push(chunk);
      }
    } finally {
      reader.releaseLock();
    }
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > limit) throw new Error(`Asset exceeds byte limit: ${buffer.byteLength} > ${limit}`);
  return new Uint8Array(buffer);
};

export class AssetPipelineV3 {
  readonly budget: AssetBudgetV3;
  #transport: AssetTransportV3;
  #decoders = new Map<AssetKind, AssetDecoderV3>();
  #manifest = new Map<AssetId, AssetDescriptor>();
  #records = new Map<AssetId, AssetRecord>();
  #inflight = new Map<AssetId, Promise<unknown>>();
  #metrics: AssetPipelineMetricsV3 = {
    manifestCount: 0,
    readyCount: 0,
    loadingCount: 0,
    failedCount: 0,
    cachedBytes: 0,
    inflightLoads: 0,
    cacheHits: 0,
    cacheMisses: 0,
    evictions: 0,
    rejectedLoads: 0,
  };

  constructor(transport: AssetTransportV3, budget: Partial<AssetBudgetV3> = {}) {
    this.#transport = transport;
    this.budget = {
      maxBytes: Math.max(1, Math.floor(budget.maxBytes ?? 256 * 1024 * 1024)),
      reserveCriticalBytes: Math.max(0, Math.floor(budget.reserveCriticalBytes ?? 32 * 1024 * 1024)),
      maxConcurrentLoads: Math.max(1, Math.floor(budget.maxConcurrentLoads ?? 6)),
      maxAssetBytes: Math.max(1, Math.floor(budget.maxAssetBytes ?? 32 * 1024 * 1024)),
    };
  }

  registerDecoder<T>(decoder: AssetDecoderV3<T>): void {
    if (this.#decoders.has(decoder.kind)) throw new Error(`Decoder already registered: ${decoder.kind}`);
    this.#decoders.set(decoder.kind, decoder as AssetDecoderV3);
  }

  declare(input: AssetDescriptor): AssetDescriptor {
    const descriptor = normalizeAssetDescriptorV3(input);
    if (descriptor.bytes > this.budget.maxAssetBytes) throw new Error(`Declared asset too large: ${descriptor.id}`);
    const existing = this.#manifest.get(descriptor.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(descriptor)) throw new Error(`Asset declaration collision: ${descriptor.id}`);
    this.#manifest.set(descriptor.id, descriptor);
    this.#metrics.manifestCount = this.#manifest.size;
    if (!this.#records.has(descriptor.id)) {
      this.#records.set(descriptor.id, {
        descriptor,
        state: 'declared',
        loadedBytes: 0,
        lastTouchedTick: 0,
        useCount: 0,
        error: null,
        value: null,
      });
    }
    return descriptor;
  }

  declareMany(descriptors: Iterable<AssetDescriptor>): void {
    for (const descriptor of descriptors) this.declare(descriptor);
  }

  async load<T = unknown>(id: AssetId, options: AssetLoadOptionsV3 = {}): Promise<T> {
    const descriptor = this.#manifest.get(id);
    if (!descriptor) throw new Error(`Unknown asset: ${id}`);
    const record = this.#records.get(id);
    if (!record) throw new Error(`Missing asset record: ${id}`);
    record.lastTouchedTick = options.tick ?? record.lastTouchedTick;
    record.useCount += 1;
    if (record.state === 'ready') {
      this.#metrics.cacheHits += 1;
      return record.value as T;
    }
    this.#metrics.cacheMisses += 1;
    const existing = this.#inflight.get(id);
    if (existing) return existing as Promise<T>;
    if (this.#inflight.size >= this.budget.maxConcurrentLoads) {
      this.#metrics.rejectedLoads += 1;
      throw new Error('Asset concurrency budget exhausted');
    }

    const decoder = this.#decoders.get(descriptor.kind);
    if (!decoder) throw new Error(`No decoder for ${descriptor.kind}`);
    record.state = 'loading';
    record.error = null;
    this.#metrics.loadingCount += 1;
    this.#metrics.inflightLoads = this.#inflight.size + 1;

    const task = this.#performLoad<T>(record, decoder, options)
      .finally(() => {
        this.#inflight.delete(id);
        this.#metrics.inflightLoads = this.#inflight.size;
        this.#metrics.loadingCount = [...this.#records.values()].filter((entry) => entry.state === 'loading').length;
      });
    this.#inflight.set(id, task);
    return task;
  }

  async #performLoad<T>(record: AssetRecord, decoder: AssetDecoderV3, options: AssetLoadOptionsV3): Promise<T> {
    try {
      const descriptor = record.descriptor;
      const response = await this.#transport.fetch(descriptor.url, { signal: options.signal });
      const bytes = await readResponseBytes(response, Math.min(this.budget.maxAssetBytes, this.budget.maxBytes), options.signal);
      if (descriptor.contentType) {
        const actual = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
        if (actual && !actual.includes(descriptor.contentType)) throw new Error(`Content type mismatch for ${descriptor.id}: ${actual}`);
      }
      if (descriptor.digest && assetDigestV3(bytes) !== descriptor.digest) throw new Error(`Digest mismatch for ${descriptor.id}`);
      await this.#ensureCapacity(bytes.byteLength, descriptor.priority, descriptor.id);
      const value = await decoder.decode(bytes, descriptor);
      record.value = value;
      record.loadedBytes = bytes.byteLength;
      record.state = 'ready';
      this.#metrics.readyCount = [...this.#records.values()].filter((entry) => entry.state === 'ready').length;
      this.#metrics.cachedBytes += bytes.byteLength;
      return value as T;
    } catch (error) {
      record.state = 'failed';
      record.error = error instanceof Error ? error.message : String(error);
      this.#metrics.failedCount = [...this.#records.values()].filter((entry) => entry.state === 'failed').length;
      throw error;
    }
  }

  async #ensureCapacity(requiredBytes: number, incomingPriority: AssetPriority, incomingId: AssetId): Promise<void> {
    if (requiredBytes > this.budget.maxBytes) throw new Error('Incoming asset larger than total cache budget');
    while (this.#metrics.cachedBytes + requiredBytes > this.budget.maxBytes) {
      const candidate = this.#chooseEvictionCandidate(incomingPriority, incomingId);
      if (!candidate) throw new Error('No evictable asset available');
      this.evict(candidate.descriptor.id);
    }
    if (incomingPriority === 'critical' && this.#metrics.cachedBytes + requiredBytes > this.budget.maxBytes - this.budget.reserveCriticalBytes) {
      while (this.#metrics.cachedBytes + requiredBytes > this.budget.maxBytes - this.budget.reserveCriticalBytes) {
        const candidate = this.#chooseEvictionCandidate('critical', incomingId, true);
        if (!candidate) break;
        this.evict(candidate.descriptor.id);
      }
    }
  }

  #chooseEvictionCandidate(incomingPriority: AssetPriority, incomingId: AssetId, protectCritical = false): AssetRecord | null {
    const candidates = [...this.#records.values()].filter((record) => {
      if (record.state !== 'ready' || record.descriptor.id === incomingId) return false;
      if (protectCritical && record.descriptor.priority === 'critical') return false;
      if (record.descriptor.priority === 'critical' && priorityRank[incomingPriority] < priorityRank.critical) return false;
      return true;
    });
    candidates.sort((a, b) => {
      const priority = priorityRank[a.descriptor.priority] - priorityRank[b.descriptor.priority];
      if (priority !== 0) return priority;
      if (a.useCount !== b.useCount) return a.useCount - b.useCount;
      if (a.lastTouchedTick !== b.lastTouchedTick) return a.lastTouchedTick - b.lastTouchedTick;
      return a.descriptor.id.localeCompare(b.descriptor.id);
    });
    return candidates[0] ?? null;
  }

  touch(id: AssetId, tick: number): void {
    const record = this.#records.get(id);
    if (!record) return;
    record.lastTouchedTick = tick;
    record.useCount += 1;
  }

  evict(id: AssetId): boolean {
    const record = this.#records.get(id);
    if (!record || record.state !== 'ready') return false;
    const decoder = this.#decoders.get(record.descriptor.kind);
    decoder?.dispose?.(record.value);
    this.#metrics.cachedBytes = Math.max(0, this.#metrics.cachedBytes - record.loadedBytes);
    record.loadedBytes = 0;
    record.value = null;
    record.state = 'evicted';
    this.#metrics.evictions += 1;
    this.#metrics.readyCount = [...this.#records.values()].filter((entry) => entry.state === 'ready').length;
    return true;
  }

  dispose(id: AssetId): boolean {
    const record = this.#records.get(id);
    if (!record) return false;
    if (record.state === 'ready') this.evict(id);
    record.state = 'disposed';
    this.#manifest.delete(id);
    this.#records.delete(id);
    this.#metrics.manifestCount = this.#manifest.size;
    return true;
  }

  get(id: AssetId): AssetRecord | undefined {
    return this.#records.get(id);
  }

  list(state?: AssetState): readonly AssetRecord[] {
    const result = [...this.#records.values()].filter((record) => !state || record.state === state);
    result.sort((a, b) => a.descriptor.id.localeCompare(b.descriptor.id));
    return Object.freeze(result.map((record) => ({ ...record, descriptor: { ...record.descriptor, tags: [...record.descriptor.tags] } })));
  }

  metrics(): AssetPipelineMetricsV3 {
    return { ...this.#metrics };
  }

  assertHealthy(): void {
    if (this.#metrics.cachedBytes > this.budget.maxBytes) throw new Error('Asset cache exceeded hard budget');
    if (this.#inflight.size > this.budget.maxConcurrentLoads) throw new Error('Asset concurrency exceeded hard budget');
    for (const record of this.#records.values()) {
      if (!isFiniteNonNegative(record.loadedBytes)) throw new Error(`Invalid loaded byte count: ${record.descriptor.id}`);
      if (record.state === 'ready' && record.value === null) throw new Error(`Ready asset has no value: ${record.descriptor.id}`);
    }
  }
}

export const assetDescriptor = (input: Omit<AssetDescriptor, 'id'> & { id: string }): AssetDescriptor =>
  normalizeAssetDescriptorV3({ ...input, id: assetId(input.id) });
