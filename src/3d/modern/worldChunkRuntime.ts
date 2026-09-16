import { StreamingPlanner, type StreamCell } from './streamingPlanner.ts';

export type ChunkLifecycle = 'unloaded' | 'queued' | 'loading' | 'active' | 'retiring' | 'failed';

export interface WorldChunkId {
  readonly x: number;
  readonly z: number;
  readonly key: string;
}

export interface ChunkRecord {
  readonly id: WorldChunkId;
  readonly state: ChunkLifecycle;
  readonly priority: number;
  readonly distance: number;
  readonly lastVisibleAt: number;
  readonly loadedAt: number | null;
  readonly retiredAt: number | null;
  readonly bytes: number;
  readonly generation: number;
  readonly pinned: boolean;
  readonly failureCount: number;
}

export interface ChunkRuntimeOptions {
  readonly loadRadius: number;
  readonly unloadRadius: number;
  readonly maxLoadsPerFrame: number;
  readonly maxUnloadsPerFrame: number;
  readonly maxConcurrentLoads?: number;
  readonly maxResidentBytes?: number;
  readonly keepFailedForMs?: number;
  readonly now?: () => number;
}

export interface ChunkLoaderResult {
  readonly bytes?: number;
}

export type ChunkLoader = (id: WorldChunkId, signal: AbortSignal) => Promise<ChunkLoaderResult>;
export type ChunkUnloader = (id: WorldChunkId) => void;

export interface ChunkFramePlan {
  readonly frame: number;
  readonly load: readonly WorldChunkId[];
  readonly unload: readonly WorldChunkId[];
  readonly retain: readonly WorldChunkId[];
  readonly residentBytes: number;
  readonly loading: number;
}

export interface ChunkRuntimeMetrics {
  readonly frame: number;
  readonly declared: number;
  readonly active: number;
  readonly queued: number;
  readonly loading: number;
  readonly retiring: number;
  readonly failed: number;
  readonly residentBytes: number;
  readonly peakResidentBytes: number;
  readonly loadSuccesses: number;
  readonly loadFailures: number;
  readonly unloads: number;
  readonly evictions: number;
}

const toId = (cell: StreamCell): WorldChunkId => Object.freeze({ x: cell.x, z: cell.z, key: cell.key });
const normalizeBytes = (value: number | undefined): number => Math.max(0, Number.isFinite(value) ? Math.floor(value as number) : 0);

export class WorldChunkRuntime {
  readonly #planner: StreamingPlanner;
  readonly #loader: ChunkLoader;
  readonly #unloader: ChunkUnloader;
  readonly #maxConcurrentLoads: number;
  readonly #maxResidentBytes: number;
  readonly #keepFailedForMs: number;
  readonly #now: () => number;
  readonly #records = new Map<string, ChunkRecord>();
  readonly #controllers = new Map<string, AbortController>();
  readonly #pending: WorldChunkId[] = [];
  #frame = 0;
  #residentBytes = 0;
  #peakResidentBytes = 0;
  #loadSuccesses = 0;
  #loadFailures = 0;
  #unloads = 0;
  #evictions = 0;
  #disposed = false;

  constructor(options: ChunkRuntimeOptions, loader: ChunkLoader, unloader: ChunkUnloader = () => undefined) {
    this.#planner = new StreamingPlanner({
      loadRadius: options.loadRadius,
      unloadRadius: options.unloadRadius,
      maxLoadsPerFrame: options.maxLoadsPerFrame,
      maxUnloadsPerFrame: options.maxUnloadsPerFrame,
    });
    this.#loader = loader;
    this.#unloader = unloader;
    this.#maxConcurrentLoads = Math.max(1, Math.floor(options.maxConcurrentLoads ?? 2));
    this.#maxResidentBytes = Math.max(1, Math.floor(options.maxResidentBytes ?? 1024 * 1024 * 512));
    this.#keepFailedForMs = Math.max(1000, Math.floor(options.keepFailedForMs ?? 15_000));
    this.#now = options.now ?? (() => performance.now());
  }

  plan(center: { readonly x: number; readonly y: number }): ChunkFramePlan {
    if (this.#disposed) return this.#framePlan([], [], []);
    this.#frame += 1;
    this.#pruneFailed();
    const plan = this.#planner.plan(center);
    const load: WorldChunkId[] = [];
    const unload: WorldChunkId[] = [];
    const retain: WorldChunkId[] = [];
    for (const cell of plan.retain) {
      const id = toId(cell);
      const record = this.#records.get(id.key);
      if (!record) continue;
      this.#records.set(id.key, Object.freeze({ ...record, lastVisibleAt: this.#now(), distance: cell.distance, priority: cell.priority }));
      retain.push(id);
    }
    for (const cell of plan.load) {
      const id = toId(cell);
      const existing = this.#records.get(id.key);
      if (existing?.state === 'active' || existing?.state === 'loading' || existing?.state === 'queued') continue;
      if (!existing || existing.state === 'failed') {
        this.#records.set(id.key, Object.freeze({ id, state: 'queued', priority: cell.priority, distance: cell.distance, lastVisibleAt: this.#now(), loadedAt: null, retiredAt: null, bytes: existing?.bytes ?? 0, generation: (existing?.generation ?? 0) + 1, pinned: existing?.pinned ?? false, failureCount: existing?.failureCount ?? 0 }));
        this.#pending.push(id);
        load.push(id);
      }
    }
    for (const cell of plan.unload) {
      const id = toId(cell);
      const record = this.#records.get(id.key);
      if (!record || record.pinned) continue;
      if (record.state === 'active') {
        this.#records.set(id.key, Object.freeze({ ...record, state: 'retiring', retiredAt: this.#now() }));
        unload.push(id);
      }
    }
    this.#drainLoadQueue();
    for (const id of unload) this.#retire(id);
    this.#enforceMemoryBudget();
    return this.#framePlan(load, unload, retain);
  }

  pin(id: WorldChunkId): boolean {
    const record = this.#records.get(id.key);
    if (!record) return false;
    this.#records.set(id.key, Object.freeze({ ...record, pinned: true }));
    return true;
  }

  unpin(id: WorldChunkId): boolean {
    const record = this.#records.get(id.key);
    if (!record) return false;
    this.#records.set(id.key, Object.freeze({ ...record, pinned: false }));
    return true;
  }

  get(id: WorldChunkId): ChunkRecord | undefined { return this.#records.get(id.key); }
  records(): readonly ChunkRecord[] { return [...this.#records.values()].sort((a, b) => a.id.key.localeCompare(b.id.key)); }
  loadedKeys(): readonly string[] { return this.#planner.loadedKeys(); }

  metrics(): ChunkRuntimeMetrics {
    let active = 0; let queued = 0; let loading = 0; let retiring = 0; let failed = 0;
    for (const record of this.#records.values()) {
      if (record.state === 'active') active += 1;
      if (record.state === 'queued') queued += 1;
      if (record.state === 'loading') loading += 1;
      if (record.state === 'retiring') retiring += 1;
      if (record.state === 'failed') failed += 1;
    }
    return Object.freeze({ frame: this.#frame, declared: this.#records.size, active, queued, loading, retiring, failed, residentBytes: this.#residentBytes, peakResidentBytes: this.#peakResidentBytes, loadSuccesses: this.#loadSuccesses, loadFailures: this.#loadFailures, unloads: this.#unloads, evictions: this.#evictions });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const controller of this.#controllers.values()) controller.abort();
    this.#controllers.clear();
    for (const record of this.#records.values()) if (record.state === 'active') this.#unloader(record.id);
    this.#records.clear();
    this.#pending.length = 0;
    this.#planner.reset();
    this.#residentBytes = 0;
  }

  #drainLoadQueue(): void {
    const currentLoading = [...this.#records.values()].filter((record) => record.state === 'loading').length;
    let available = Math.max(0, this.#maxConcurrentLoads - currentLoading);
    while (available > 0 && this.#pending.length > 0 && !this.#disposed) {
      const id = this.#pending.shift();
      if (!id) continue;
      const record = this.#records.get(id.key);
      if (!record || record.state !== 'queued') continue;
      this.#startLoad(id, record);
      available -= 1;
    }
  }

  #startLoad(id: WorldChunkId, record: ChunkRecord): void {
    const controller = new AbortController();
    this.#controllers.set(id.key, controller);
    const startedAt = this.#now();
    this.#records.set(id.key, Object.freeze({ ...record, state: 'loading', lastVisibleAt: startedAt }));
    void this.#loader(id, controller.signal).then((result) => {
      if (this.#disposed || controller.signal.aborted) return;
      const current = this.#records.get(id.key);
      if (!current) return;
      const bytes = normalizeBytes(result.bytes);
      if (this.#residentBytes + bytes > this.#maxResidentBytes && !current.pinned) this.#enforceMemoryBudget(bytes);
      this.#residentBytes += bytes;
      this.#peakResidentBytes = Math.max(this.#peakResidentBytes, this.#residentBytes);
      this.#records.set(id.key, Object.freeze({ ...current, state: 'active', bytes, loadedAt: this.#now(), retiredAt: null, failureCount: 0 }));
      this.#loadSuccesses += 1;
    }).catch((error) => {
      if (controller.signal.aborted || this.#disposed) return;
      const current = this.#records.get(id.key);
      if (!current) return;
      this.#records.set(id.key, Object.freeze({ ...current, state: 'failed', error: String(error), failureCount: current.failureCount + 1 } as ChunkRecord));
      this.#loadFailures += 1;
    }).finally(() => {
      this.#controllers.delete(id.key);
      this.#drainLoadQueue();
      void startedAt;
    });
  }

  #retire(id: WorldChunkId): void {
    const record = this.#records.get(id.key);
    if (!record || record.state !== 'retiring') return;
    this.#controllers.get(id.key)?.abort();
    this.#controllers.delete(id.key);
    try { this.#unloader(id); } finally {
      this.#residentBytes = Math.max(0, this.#residentBytes - record.bytes);
      this.#records.delete(id.key);
      this.#unloads += 1;
    }
  }

  #enforceMemoryBudget(incomingBytes = 0): void {
    while (this.#residentBytes + incomingBytes > this.#maxResidentBytes) {
      const candidate = [...this.#records.values()]
        .filter((record) => record.state === 'active' && !record.pinned)
        .sort((a, b) => a.lastVisibleAt - b.lastVisibleAt || b.bytes - a.bytes || a.id.key.localeCompare(b.id.key))[0];
      if (!candidate) break;
      this.#retire(candidate.id);
      this.#evictions += 1;
    }
  }

  #pruneFailed(): void {
    const cutoff = this.#now() - this.#keepFailedForMs;
    for (const [key, record] of this.#records) {
      if (record.state === 'failed' && record.lastVisibleAt < cutoff) this.#records.delete(key);
    }
  }

  #framePlan(load: readonly WorldChunkId[], unload: readonly WorldChunkId[], retain: readonly WorldChunkId[]): ChunkFramePlan {
    return Object.freeze({ frame: this.#frame, load, unload, retain, residentBytes: this.#residentBytes, loading: [...this.#records.values()].filter((record) => record.state === 'loading').length });
  }
}

export interface StreamingOrigin {
  readonly x: number;
  readonly z: number;
  readonly weight: number;
}

export const combineStreamingOrigins = (origins: readonly StreamingOrigin[]): { x: number; z: number } => {
  let weight = 0; let x = 0; let z = 0;
  for (const origin of origins) {
    const w = Math.max(0, Number.isFinite(origin.weight) ? origin.weight : 0);
    weight += w;
    x += origin.x * w;
    z += origin.z * w;
  }
  if (weight <= 0) return { x: 0, z: 0 };
  return { x: x / weight, z: z / weight };
};
