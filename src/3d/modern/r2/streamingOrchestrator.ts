export type StreamPriority = 'critical' | 'visible' | 'near' | 'far' | 'background';
export type StreamState = 'queued' | 'loading' | 'ready' | 'failed' | 'cancelled';

export interface AssetRequest {
  readonly key: string;
  readonly url: string;
  readonly priority: StreamPriority;
  readonly byteEstimate: number;
  readonly distanceMeters: number;
  readonly retryLimit?: number;
  readonly tags?: readonly string[];
}

export interface AssetResult<T = unknown> {
  readonly key: string;
  readonly state: StreamState;
  readonly value?: T;
  readonly error?: string;
  readonly attempts: number;
  readonly loadedBytes: number;
  readonly durationMs: number;
}

export interface StreamBudget {
  readonly maxConcurrent: number;
  readonly maxBytesPerFrame: number;
  readonly maxQueueSize: number;
  readonly retryBackoffMs: number;
}

export interface Loader<T> {
  readonly load: (request: AssetRequest, signal: AbortSignal) => Promise<T>;
  readonly dispose?: (value: T) => void;
}

export interface CacheEntry<T = unknown> {
  readonly key: string;
  value: T;
  sizeBytes: number;
  lastAccessTick: number;
  priority: StreamPriority;
  pinned: boolean;
}

const PRIORITY_WEIGHT: Record<StreamPriority, number> = {
  critical: 1000,
  visible: 700,
  near: 450,
  far: 180,
  background: 40,
};

function validateRequest(request: AssetRequest): void {
  if (!request.key.trim()) throw new Error('asset key must not be empty');
  if (!/^https?:\/\//.test(request.url) && !request.url.startsWith('/')) {
    throw new Error(`unsupported asset URL: ${request.url}`);
  }
  if (!Number.isFinite(request.byteEstimate) || request.byteEstimate < 0) throw new RangeError('byteEstimate must be non-negative');
  if (!Number.isFinite(request.distanceMeters) || request.distanceMeters < 0) throw new RangeError('distanceMeters must be non-negative');
}

function priorityScore(request: AssetRequest, nowTick: number): number {
  const freshness = Math.max(0, 250 - nowTick % 251);
  const distancePenalty = Math.min(500, Math.sqrt(request.distanceMeters) * 8);
  return PRIORITY_WEIGHT[request.priority] + freshness - distancePenalty - request.byteEstimate / 1_000_000;
}

export class AssetCache<T = unknown> {
  readonly #entries = new Map<string, CacheEntry<T>>();
  readonly #maxBytes: number;
  #usedBytes = 0;

  public constructor(maxBytes: number) {
    if (!Number.isFinite(maxBytes) || maxBytes <= 0) throw new RangeError('maxBytes must be positive');
    this.#maxBytes = Math.floor(maxBytes);
  }

  public get usedBytes(): number {
    return this.#usedBytes;
  }

  public get maxBytes(): number {
    return this.#maxBytes;
  }

  public get<TValue extends T>(key: string, tick: number): TValue | undefined {
    const entry = this.#entries.get(key) as CacheEntry<TValue> | undefined;
    if (!entry) return undefined;
    entry.lastAccessTick = tick;
    return entry.value;
  }

  public set(key: string, value: T, sizeBytes: number, priority: StreamPriority, tick: number, pinned = false): void {
    if (!Number.isFinite(sizeBytes) || sizeBytes < 0) throw new RangeError('sizeBytes must be non-negative');
    if (sizeBytes > this.#maxBytes) throw new RangeError(`asset ${key} exceeds cache capacity`);
    const previous = this.#entries.get(key);
    if (previous) this.#usedBytes -= previous.sizeBytes;
    this.#entries.set(key, { key, value, sizeBytes, lastAccessTick: tick, priority, pinned });
    this.#usedBytes += sizeBytes;
    this.#evictUntilFit();
  }

  public pin(key: string, pinned: boolean): void {
    const entry = this.#entries.get(key);
    if (entry) entry.pinned = pinned;
  }

  public delete(key: string, disposer?: (value: T) => void): boolean {
    const entry = this.#entries.get(key);
    if (!entry) return false;
    this.#entries.delete(key);
    this.#usedBytes -= entry.sizeBytes;
    disposer?.(entry.value);
    return true;
  }

  public clear(disposer?: (value: T) => void): void {
    for (const entry of this.#entries.values()) disposer?.(entry.value);
    this.#entries.clear();
    this.#usedBytes = 0;
  }

  public entries(): readonly CacheEntry<T>[] {
    return [...this.#entries.values()].map((entry) => ({ ...entry }));
  }

  public has(key: string): boolean {
    return this.#entries.has(key);
  }

  #evictUntilFit(): void {
    if (this.#usedBytes <= this.#maxBytes) return;
    const candidates = [...this.#entries.values()].filter((entry) => !entry.pinned);
    candidates.sort((a, b) => {
      const aScore = PRIORITY_WEIGHT[a.priority] + a.lastAccessTick;
      const bScore = PRIORITY_WEIGHT[b.priority] + b.lastAccessTick;
      return aScore - bScore;
    });
    for (const entry of candidates) {
      if (this.#usedBytes <= this.#maxBytes) break;
      this.#entries.delete(entry.key);
      this.#usedBytes -= entry.sizeBytes;
    }
  }
}

interface QueuedRequest {
  readonly request: AssetRequest;
  readonly enqueuedTick: number;
  state: StreamState;
  attempts: number;
  controller?: AbortController;
  error?: string;
}

export class StreamingOrchestrator<T = unknown> {
  readonly #loader: Loader<T>;
  readonly #budget: StreamBudget;
  readonly #cache: AssetCache<T>;
  readonly #queue = new Map<string, QueuedRequest>();
  readonly #active = new Map<string, QueuedRequest>();
  readonly #completed = new Map<string, AssetResult<T>>();
  #tick = 0;
  #bytesLoadedThisFrame = 0;
  #disposed = false;

  public constructor(loader: Loader<T>, cacheBytes: number, budget: Partial<StreamBudget> = {}) {
    this.#loader = loader;
    this.#budget = Object.freeze({
      maxConcurrent: budget.maxConcurrent ?? 4,
      maxBytesPerFrame: budget.maxBytesPerFrame ?? 16_000_000,
      maxQueueSize: budget.maxQueueSize ?? 256,
      retryBackoffMs: budget.retryBackoffMs ?? 125,
    });
    if (!Number.isInteger(this.#budget.maxConcurrent) || this.#budget.maxConcurrent < 1) throw new RangeError('maxConcurrent must be positive integer');
    if (!Number.isFinite(this.#budget.maxBytesPerFrame) || this.#budget.maxBytesPerFrame <= 0) throw new RangeError('maxBytesPerFrame must be positive');
    this.#cache = new AssetCache(cacheBytes);
  }

  public get cache(): AssetCache<T> {
    return this.#cache;
  }

  public get activeCount(): number {
    return this.#active.size;
  }

  public get queueCount(): number {
    return this.#queue.size;
  }

  public enqueue(request: AssetRequest, tick = this.#tick): void {
    if (this.#disposed) throw new Error('streaming orchestrator disposed');
    validateRequest(request);
    this.#tick = Math.max(this.#tick, tick);
    if (this.#cache.has(request.key)) return;
    const existing = this.#queue.get(request.key) ?? this.#active.get(request.key);
    if (existing) {
      if (PRIORITY_WEIGHT[request.priority] > PRIORITY_WEIGHT[existing.request.priority]) {
        this.#queue.set(request.key, {
          ...existing,
          request,
        });
      }
      return;
    }
    if (this.#queue.size >= this.#budget.maxQueueSize) this.#dropLowestPriority();
    this.#queue.set(request.key, {
      request,
      enqueuedTick: this.#tick,
      state: 'queued',
      attempts: 0,
    });
  }

  public cancel(key: string): boolean {
    const queued = this.#queue.get(key);
    if (queued) {
      queued.state = 'cancelled';
      this.#queue.delete(key);
      this.#completed.set(key, { key, state: 'cancelled', attempts: queued.attempts, loadedBytes: 0, durationMs: 0 });
      return true;
    }
    const active = this.#active.get(key);
    if (!active) return false;
    active.controller?.abort();
    active.state = 'cancelled';
    this.#active.delete(key);
    this.#completed.set(key, { key, state: 'cancelled', attempts: active.attempts, loadedBytes: 0, durationMs: 0 });
    return true;
  }

  public pin(key: string, pinned = true): void {
    this.#cache.pin(key, pinned);
  }

  public async pump(tick = this.#tick + 1): Promise<readonly AssetResult<T>[]> {
    if (this.#disposed) return [];
    this.#tick = tick;
    this.#bytesLoadedThisFrame = 0;
    const started: Promise<void>[] = [];
    while (this.#active.size < this.#budget.maxConcurrent) {
      const next = this.#nextQueued();
      if (!next) break;
      this.#queue.delete(next.request.key);
      this.#active.set(next.request.key, next);
      started.push(this.#run(next));
    }
    await Promise.all(started);
    return [...this.#completed.values()];
  }

  public consumeCompleted(): readonly AssetResult<T>[] {
    const results = [...this.#completed.values()];
    this.#completed.clear();
    return results;
  }

  public stats(): StreamingStats {
    const states: Record<StreamState, number> = {
      queued: 0,
      loading: 0,
      ready: 0,
      failed: 0,
      cancelled: 0,
    };
    for (const request of this.#queue.values()) states[request.state] += 1;
    for (const request of this.#active.values()) states[request.state] += 1;
    for (const result of this.#completed.values()) states[result.state] += 1;
    return {
      tick: this.#tick,
      active: this.#active.size,
      queued: this.#queue.size,
      cachedEntries: this.#cache.entries().length,
      cachedBytes: this.#cache.usedBytes,
      bytesLoadedThisFrame: this.#bytesLoadedThisFrame,
      states,
    };
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const request of this.#active.values()) request.controller?.abort();
    this.#active.clear();
    this.#queue.clear();
    this.#cache.clear(this.#loader.dispose);
  }

  async #run(item: QueuedRequest): Promise<void> {
    const startedAt = performance.now();
    item.state = 'loading';
    const retries = item.request.retryLimit ?? 2;
    const maxAttempts = Math.max(1, retries + 1);
    while (item.attempts < maxAttempts) {
      item.attempts += 1;
      const controller = new AbortController();
      item.controller = controller;
      try {
        const value = await this.#loader.load(item.request, controller.signal);
        if (controller.signal.aborted || item.state === 'cancelled') {
          this.#active.delete(item.request.key);
          return;
        }
        const bytes = Math.max(0, Math.floor(item.request.byteEstimate));
        if (this.#bytesLoadedThisFrame + bytes > this.#budget.maxBytesPerFrame && item.request.priority !== 'critical') {
          item.state = 'queued';
          this.#active.delete(item.request.key);
          this.#queue.set(item.request.key, item);
          return;
        }
        this.#bytesLoadedThisFrame += bytes;
        item.state = 'ready';
        this.#cache.set(item.request.key, value, bytes, item.request.priority, this.#tick, item.request.priority === 'critical');
        this.#completed.set(item.request.key, {
          key: item.request.key,
          state: 'ready',
          value,
          attempts: item.attempts,
          loadedBytes: bytes,
          durationMs: performance.now() - startedAt,
        });
        this.#active.delete(item.request.key);
        return;
      } catch (error) {
        if (controller.signal.aborted || item.state === 'cancelled') {
          this.#active.delete(item.request.key);
          return;
        }
        item.error = error instanceof Error ? error.message : String(error);
        if (item.attempts < maxAttempts) {
          await delay(this.#budget.retryBackoffMs * 2 ** (item.attempts - 1));
          continue;
        }
        item.state = 'failed';
        this.#completed.set(item.request.key, {
          key: item.request.key,
          state: 'failed',
          error: item.error,
          attempts: item.attempts,
          loadedBytes: 0,
          durationMs: performance.now() - startedAt,
        });
        this.#active.delete(item.request.key);
      }
    }
  }

  #nextQueued(): QueuedRequest | undefined {
    return [...this.#queue.values()]
      .filter((candidate) => candidate.state === 'queued')
      .sort((a, b) => priorityScore(b.request, this.#tick) - priorityScore(a.request, this.#tick))[0];
  }

  #dropLowestPriority(): void {
    const candidates = [...this.#queue.values()];
    if (candidates.length === 0) return;
    candidates.sort((a, b) => priorityScore(a.request, this.#tick) - priorityScore(b.request, this.#tick));
    const candidate = candidates[0];
    if (!candidate) return;
    this.#queue.delete(candidate.request.key);
    this.#completed.set(candidate.request.key, {
      key: candidate.request.key,
      state: 'cancelled',
      attempts: candidate.attempts,
      loadedBytes: 0,
      durationMs: 0,
    });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

export interface StreamingStats {
  readonly tick: number;
  readonly active: number;
  readonly queued: number;
  readonly cachedEntries: number;
  readonly cachedBytes: number;
  readonly bytesLoadedThisFrame: number;
  readonly states: Readonly<Record<StreamState, number>>;
}

export interface ChunkStreamDescriptor {
  readonly chunkId: string;
  readonly centerX: number;
  readonly centerZ: number;
  readonly radiusMeters: number;
  readonly assetKeys: readonly string[];
  readonly priority: StreamPriority;
}

export interface ChunkStreamPlan {
  readonly loads: readonly AssetRequest[];
  readonly unloadKeys: readonly string[];
  readonly retainedKeys: readonly string[];
}

export class ChunkStreamingPlanner {
  readonly #loadedChunks = new Map<string, ChunkStreamDescriptor>();

  public plan(desired: readonly ChunkStreamDescriptor[], cameraX: number, cameraZ: number, tick: number): ChunkStreamPlan {
    const desiredIds = new Set(desired.map((chunk) => chunk.chunkId));
    const unloadKeys: string[] = [];
    const retainedKeys: string[] = [];
    for (const [chunkId, chunk] of this.#loadedChunks) {
      if (!desiredIds.has(chunkId)) {
        unloadKeys.push(...chunk.assetKeys);
        this.#loadedChunks.delete(chunkId);
      } else {
        retainedKeys.push(...chunk.assetKeys);
      }
    }
    const loads: AssetRequest[] = [];
    for (const chunk of desired) {
      const dx = chunk.centerX - cameraX;
      const dz = chunk.centerZ - cameraZ;
      const distance = Math.sqrt(dx * dx + dz * dz);
      const existing = this.#loadedChunks.get(chunk.chunkId);
      if (!existing) {
        for (const key of chunk.assetKeys) {
          loads.push({
            key,
            url: key.startsWith('/') || key.startsWith('http') ? key : `/${key}`,
            priority: distance <= chunk.radiusMeters ? chunk.priority : downgrade(chunk.priority),
            byteEstimate: 256_000,
            distanceMeters: distance,
            tags: [`chunk:${chunk.chunkId}`, `tick:${tick}`],
          });
        }
        this.#loadedChunks.set(chunk.chunkId, chunk);
      }
    }
    loads.sort((a, b) => PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority] || a.distanceMeters - b.distanceMeters);
    return Object.freeze({ loads, unloadKeys, retainedKeys });
  }

  public loadedChunks(): readonly string[] {
    return [...this.#loadedChunks.keys()].sort();
  }
}

function downgrade(priority: StreamPriority): StreamPriority {
  switch (priority) {
    case 'critical': return 'visible';
    case 'visible': return 'near';
    case 'near': return 'far';
    case 'far': return 'background';
    case 'background': return 'background';
  }
}
