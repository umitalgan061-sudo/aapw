/**
 * World Streaming V3.
 *
 * Provides an explicit residency controller for terrain, settlements, NPC
 * clusters and render-only effects. Interest sources can be combined, ranked
 * and diffed without depending on scene graph implementations.
 *
 * @module worldStreamingV3
 */

export type StreamCategory =
  | 'terrain'
  | 'settlement'
  | 'npc'
  | 'vegetation'
  | 'effects'
  | 'audio'
  | 'navigation';

export type StreamPriority =
  | 'critical'
  | 'near'
  | 'mid'
  | 'far'
  | 'background';

export type StreamChunkId = \`\${number}:\${number}\`;

export type StreamChunk = {
  readonly id: StreamChunkId;
  readonly x: number;
  readonly z: number;
  readonly distanceMeters: number;
  readonly priority: StreamPriority;
  readonly categories: readonly StreamCategory[];
  readonly desired: boolean;
  readonly pinned: boolean;
  readonly score: number;
};

export type StreamInterestSource = {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly radiusMeters: number;
  readonly weight: number;
  readonly categories?: readonly StreamCategory[];
  readonly pinRadiusMeters?: number;
};

export type StreamBudget = {
  readonly maxResidentChunks: number;
  readonly maxLoadsPerStep: number;
  readonly maxUnloadsPerStep: number;
  readonly maxConcurrentLoads: number;
  readonly prefetchRings: readonly number[];
};

export type StreamPlan = {
  readonly requested: readonly StreamChunkId[];
  readonly load: readonly StreamChunkId[];
  readonly unload: readonly StreamChunkId[];
  readonly retained: readonly StreamChunkId[];
  readonly skipped: readonly StreamChunkId[];
  readonly active: readonly StreamChunkId[];
};

export type StreamRuntimeStats = {
  readonly residentCount: number;
  readonly loadingCount: number;
  readonly pendingCount: number;
  readonly desiredCount: number;
  readonly pinnedCount: number;
  readonly loadThroughputPerStep: number;
  readonly unloadThroughputPerStep: number;
};

export type StreamLifecycleListener = {
  readonly onLoadRequested?: (chunk: StreamChunk) => void;
  readonly onUnloadRequested?: (chunk: StreamChunk) => void;
  readonly onRetained?: (chunk: StreamChunk) => void;
};

const PRIORITY_SCORE: Readonly<Record<StreamPriority, number>> = {
  critical: 100,
  near: 85,
  mid: 60,
  far: 35,
  background: 10,
};

const CATEGORY_SCORE: Readonly<Record<StreamCategory, number>> = {
  terrain: 12,
  settlement: 10,
  npc: 9,
  navigation: 8,
  vegetation: 6,
  effects: 4,
  audio: 5,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function chunkId(x: number, z: number): StreamChunkId {
  return \`\${Math.trunc(x)}:\${Math.trunc(z)}\`;
}

function parseChunk(id: StreamChunkId): { readonly x: number; readonly z: number } {
  const [x, z] = id.split(':').map(Number);
  return { x: Number.isFinite(x) ? x : 0, z: Number.isFinite(z) ? z : 0 };
}

export class WorldStreamingV3 {
  readonly #budget: StreamBudget;
  readonly #chunkSizeMeters: number;
  readonly #sources = new Map<string, StreamInterestSource>();
  readonly #resident = new Map<StreamChunkId, StreamChunk>();
  readonly #loading = new Set<StreamChunkId>();
  readonly #pending = new Map<StreamChunkId, StreamChunk>();
  readonly #listeners: StreamLifecycleListener[] = [];

  #lastLoadCount = 0;
  #lastUnloadCount = 0;

  constructor(
    chunkSizeMeters: number,
    budget: StreamBudget,
  ) {
    this.#chunkSizeMeters = Math.max(1, chunkSizeMeters);
    this.#budget = {
      maxResidentChunks: clamp(Math.floor(budget.maxResidentChunks), 1, 100_000),
      maxLoadsPerStep: clamp(Math.floor(budget.maxLoadsPerStep), 1, 10_000),
      maxUnloadsPerStep: clamp(Math.floor(budget.maxUnloadsPerStep), 1, 10_000),
      maxConcurrentLoads: clamp(Math.floor(budget.maxConcurrentLoads), 1, 256),
      prefetchRings: [...budget.prefetchRings].filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b),
    };
  }

  addListener(listener: StreamLifecycleListener): () => void {
    this.#listeners.push(listener);
    return () => {
      const index = this.#listeners.indexOf(listener);
      if (index >= 0) {
        this.#listeners.splice(index, 1);
      }
    };
  }

  setSource(source: StreamInterestSource): () => void {
    if (!source.id.trim()) {
      throw new Error('Streaming interest source id cannot be empty');
    }
    if (source.radiusMeters <= 0) {
      throw new Error('Streaming interest source radius must be positive');
    }

    const normalized: StreamInterestSource = {
      ...source,
      id: source.id.trim(),
      x: Number.isFinite(source.x) ? source.x : 0,
      z: Number.isFinite(source.z) ? source.z : 0,
      radiusMeters: Math.max(1, source.radiusMeters),
      weight: Math.max(0, source.weight),
      categories: source.categories ? [...new Set(source.categories)] : undefined,
      pinRadiusMeters:
        source.pinRadiusMeters === undefined
          ? undefined
          : Math.max(0, source.pinRadiusMeters),
    };

    this.#sources.set(normalized.id, normalized);
    return () => {
      if (this.#sources.get(normalized.id) === normalized) {
        this.#sources.delete(normalized.id);
      }
    };
  }

  getSource(id: string): StreamInterestSource | undefined {
    return this.#sources.get(id);
  }

  sourceCount(): number {
    return this.#sources.size;
  }

  clearSources(): void {
    this.#sources.clear();
  }

  #priorityFor(distanceMeters: number, radiusMeters: number): StreamPriority {
    if (distanceMeters <= radiusMeters * 0.35) return 'critical';
    if (distanceMeters <= radiusMeters * 0.65) return 'near';
    if (distanceMeters <= radiusMeters) return 'mid';
    if (distanceMeters <= radiusMeters * 1.5) return 'far';
    return 'background';
  }

  #scoreFor(
    distanceMeters: number,
    source: StreamInterestSource,
    categories: readonly StreamCategory[],
    priority: StreamPriority,
  ): number {
    const distanceRatio = clamp(distanceMeters / source.radiusMeters, 0, 4);
    const distanceScore = Math.max(0, 60 - distanceRatio * 24);
    const categoryScore = categories.reduce(
      (total, category) => total + CATEGORY_SCORE[category],
      0,
    );
    return PRIORITY_SCORE[priority] + distanceScore + categoryScore + source.weight * 10;
  }

  plan(
    originX: number,
    originZ: number,
    visibleRadiusChunks: number,
  ): StreamPlan {
    const desired = new Map<StreamChunkId, StreamChunk>();
    const radius = clamp(Math.floor(visibleRadiusChunks), 0, 512);
    const size = this.#chunkSizeMeters;

    const minX = Math.floor(originX / size) - radius;
    const maxX = Math.floor(originX / size) + radius;
    const minZ = Math.floor(originZ / size) - radius;
    const maxZ = Math.floor(originZ / size) + radius;

    for (let x = minX; x <= maxX; x += 1) {
      for (let z = minZ; z <= maxZ; z += 1) {
        const worldX = (x + 0.5) * size;
        const worldZ = (z + 0.5) * size;
        const candidate = this.#bestChunkCandidate(x, z, worldX, worldZ);
        if (candidate) {
          desired.set(candidate.id, candidate);
        }
      }
    }

    const requested = [...desired.values()]
      .sort(compareChunks)
      .slice(0, this.#budget.maxResidentChunks);

    this.#pending.clear();
    for (const chunk of requested) {
      this.#pending.set(chunk.id, chunk);
    }

    const requestedIds = requested.map((chunk) => chunk.id);
    const load = requested
      .filter((chunk) => !this.#resident.has(chunk.id) && !this.#loading.has(chunk.id))
      .sort(compareChunks)
      .slice(0, this.#budget.maxLoadsPerStep)
      .map((chunk) => chunk.id);

    const retain = requested
      .filter((chunk) => this.#resident.has(chunk.id))
      .sort(compareChunks);

    const unloadCandidates = [...this.#resident.values()]
      .filter((chunk) => !desired.has(chunk.id) && !chunk.pinned)
      .sort((a, b) => a.score - b.score);

    const unload = unloadCandidates
      .slice(0, this.#budget.maxUnloadsPerStep)
      .map((chunk) => chunk.id);

    const skipped = requested
      .filter((chunk) => !retain.some((current) => current.id === chunk.id) && !load.includes(chunk.id))
      .map((chunk) => chunk.id);

    const active = [
      ...retain.map((chunk) => chunk.id),
      ...load,
    ].sort(compareIds);

    return {
      requested: requestedIds,
      load,
      unload,
      retained: retain.map((chunk) => chunk.id),
      skipped,
      active,
    };
  }

  #bestChunkCandidate(
    x: number,
    z: number,
    worldX: number,
    worldZ: number,
  ): StreamChunk | null {
    let best: StreamChunk | null = null;

    for (const source of this.#sources.values()) {
      const dx = worldX - source.x;
      const dz = worldZ - source.z;
      const distanceMeters = Math.hypot(dx, dz);
      const priority = this.#priorityFor(distanceMeters, source.radiusMeters);
      const categories = source.categories ?? ['terrain', 'navigation'];
      const pinned = Boolean(
        source.pinRadiusMeters !== undefined &&
        distanceMeters <= source.pinRadiusMeters,
      );

      if (distanceMeters > source.radiusMeters * 1.5 && !pinned) {
        continue;
      }

      const candidate: StreamChunk = {
        id: chunkId(x, z),
        x,
        z,
        distanceMeters,
        priority,
        categories,
        desired: true,
        pinned,
        score: this.#scoreFor(distanceMeters, source, categories, priority),
      };

      if (!best || candidate.score > best.score) {
        best = candidate;
      }
    }

    return best;
  }

  requestLoad(id: StreamChunkId): boolean {
    const chunk = this.#pending.get(id);
    if (!chunk || this.#resident.has(id) || this.#loading.has(id)) {
      return false;
    }
    if (this.#loading.size >= this.#budget.maxConcurrentLoads) {
      return false;
    }
    this.#loading.add(id);
    for (const listener of this.#listeners) {
      listener.onLoadRequested?.(chunk);
    }
    this.#lastLoadCount += 1;
    return true;
  }

  completeLoad(id: StreamChunkId, metadata: Partial<StreamChunk> = {}): boolean {
    const pending = this.#pending.get(id);
    if (!pending || !this.#loading.has(id)) {
      return false;
    }
    this.#loading.delete(id);
    const chunk: StreamChunk = {
      ...pending,
      ...metadata,
      id,
      desired: metadata.desired ?? true,
    };
    this.#resident.set(id, chunk);
    return true;
  }

  failLoad(id: StreamChunkId): boolean {
    return this.#loading.delete(id);
  }

  requestUnload(id: StreamChunkId): boolean {
    const chunk = this.#resident.get(id);
    if (!chunk || chunk.pinned) {
      return false;
    }
    this.#resident.delete(id);
    for (const listener of this.#listeners) {
      listener.onUnloadRequested?.(chunk);
    }
    this.#lastUnloadCount += 1;
    return true;
  }

  reconcile(plan: StreamPlan): {
    readonly loadRequested: readonly StreamChunkId[];
    readonly unloadRequested: readonly StreamChunkId[];
    readonly retained: readonly StreamChunkId[];
  } {
    const loadRequested = plan.load.filter((id) => this.requestLoad(id));
    const unloadRequested = plan.unload.filter((id) => this.requestUnload(id));

    const retained: StreamChunkId[] = [];
    for (const id of plan.retained) {
      const chunk = this.#resident.get(id);
      if (!chunk) {
        continue;
      }
      retained.push(id);
      for (const listener of this.#listeners) {
        listener.onRetained?.(chunk);
      }
    }

    return { loadRequested, unloadRequested, retained };
  }

  resident(id: StreamChunkId): StreamChunk | undefined {
    return this.#resident.get(id);
  }

  residentIds(): readonly StreamChunkId[] {
    return [...this.#resident.keys()].sort(compareIds);
  }

  loadingIds(): readonly StreamChunkId[] {
    return [...this.#loading].sort(compareIds);
  }

  pendingIds(): readonly StreamChunkId[] {
    return [...this.#pending.keys()].sort(compareIds);
  }

  stats(): StreamRuntimeStats {
    let pinnedCount = 0;
    for (const chunk of this.#resident.values()) {
      if (chunk.pinned) {
        pinnedCount += 1;
      }
    }
    return {
      residentCount: this.#resident.size,
      loadingCount: this.#loading.size,
      pendingCount: this.#pending.size,
      desiredCount: this.#pending.size,
      pinnedCount,
      loadThroughputPerStep: this.#lastLoadCount,
      unloadThroughputPerStep: this.#lastUnloadCount,
    };
  }

  resetStepCounters(): void {
    this.#lastLoadCount = 0;
    this.#lastUnloadCount = 0;
  }

  clearResidency(): void {
    this.#resident.clear();
    this.#loading.clear();
    this.#pending.clear();
  }

  forceResident(chunk: StreamChunk): boolean {
    if (this.#resident.size >= this.#budget.maxResidentChunks && !this.#resident.has(chunk.id)) {
      const evictable = [...this.#resident.values()]
        .filter((item) => !item.pinned)
        .sort((a, b) => a.score - b.score)[0];
      if (!evictable) {
        return false;
      }
      this.#resident.delete(evictable.id);
    }
    this.#loading.delete(chunk.id);
    this.#resident.set(chunk.id, chunk);
    return true;
  }

  serialize(): {
    readonly sources: readonly StreamInterestSource[];
    readonly resident: readonly StreamChunk[];
  } {
    return {
      sources: [...this.#sources.values()]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((source) => ({ ...source })),
      resident: [...this.#resident.values()]
        .sort(compareChunks)
        .map((chunk) => ({ ...chunk, categories: [...chunk.categories] })),
    };
  }
}

function compareIds(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

function compareChunks(a: StreamChunk, b: StreamChunk): number {
  return b.score - a.score || a.distanceMeters - b.distanceMeters || compareIds(a.id, b.id);
}

export function createRadialStreamBudget(
  radiusChunks: number,
  maxResidentChunks: number,
): StreamBudget {
  const radius = clamp(Math.floor(radiusChunks), 1, 256);
  return {
    maxResidentChunks: clamp(Math.floor(maxResidentChunks), 1, 100_000),
    maxLoadsPerStep: Math.max(1, Math.min(64, Math.ceil(radius / 2))),
    maxUnloadsPerStep: Math.max(1, Math.min(64, Math.ceil(radius / 3))),
    maxConcurrentLoads: 6,
    prefetchRings: [0.55, 0.8, 1, 1.25, 1.5],
  };
}

export function distanceBetweenChunks(
  a: StreamChunkId,
  b: StreamChunkId,
  chunkSizeMeters: number,
): number {
  const first = parseChunk(a);
  const second = parseChunk(b);
  return Math.hypot(
    (first.x - second.x) * chunkSizeMeters,
    (first.z - second.z) * chunkSizeMeters,
  );
}
