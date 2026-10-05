import {RuntimeError,stableHash} from './contracts.ts';

export interface ChunkCoordinate {
  readonly x: number;
  readonly z: number;
}

export interface WorldCell {
  readonly x: number;
  readonly z: number;
  readonly height: number;
  readonly biome: string;
  readonly water: boolean;
  readonly loaded: boolean;
}

export interface WorldChunk {
  readonly key: string;
  readonly coordinate: ChunkCoordinate;
  readonly sizeMeters: number;
  readonly cells: readonly WorldCell[];
  readonly revision: number;
}

export interface WorldChunkSource {
  readonly load: (
    coordinate: ChunkCoordinate,
    signal: AbortSignal,
  ) => Promise<WorldChunk>;
  readonly unload?: (
    chunk: WorldChunk,
  ) => void | Promise<void>;
}

export interface WorldRuntimeOptions {
  readonly chunkSizeMeters: number;
  readonly viewDistance: number;
  readonly maxResidentChunks: number;
}

export interface WorldRuntimeStats {
  readonly residentChunks: number;
  readonly loadingChunks: number;
  readonly queuedLoads: number;
  readonly evictions: number;
  readonly failedLoads: number;
}

interface Entry {
  readonly coordinate: ChunkCoordinate;
  state: 'queued' | 'loading' | 'ready';
  lastAccessTick: number;
  chunk?: WorldChunk;
  controller?: AbortController;
  promise?: Promise<WorldChunk>;
}

export class WorldRuntime {
  readonly #source: WorldChunkSource;
  readonly #options: WorldRuntimeOptions;
  readonly #entries = new Map<string, Entry>();

  #evictions = 0;
  #failedLoads = 0;

  constructor(
    source: WorldChunkSource,
    options: WorldRuntimeOptions,
  ) {
    if (
      options.chunkSizeMeters <= 0
      || options.viewDistance < 0
      || options.maxResidentChunks < 1
    ) {
      throw new RuntimeError({
        code: 'R50_WORLD_OPTIONS',
        message: 'World runtime options are invalid.',
        recoverable: false,
      });
    }

    this.#source = source;
    this.#options = options;
  }

  key(coordinate: ChunkCoordinate): string {
    return (
      String(Math.floor(coordinate.x))
      + ':'
      + String(Math.floor(coordinate.z))
    );
  }

  worldToChunk(
    x: number,
    z: number,
  ): ChunkCoordinate {
    return {
      x: Math.floor(x / this.#options.chunkSizeMeters),
      z: Math.floor(z / this.#options.chunkSizeMeters),
    };
  }

  chunkToWorld(
    coordinate: ChunkCoordinate,
  ): { readonly x: number; readonly z: number } {
    return {
      x: coordinate.x * this.#options.chunkSizeMeters,
      z: coordinate.z * this.#options.chunkSizeMeters,
    };
  }

  async ensure(
    coordinate: ChunkCoordinate,
    tick: number,
    signal?: AbortSignal,
  ): Promise<WorldChunk> {
    const key = this.key(coordinate);
    const existing = this.#entries.get(key);

    if (existing?.state === 'ready' && existing.chunk) {
      existing.lastAccessTick = tick;
      return existing.chunk;
    }

    if (existing?.promise) {
      existing.lastAccessTick = tick;
      return existing.promise;
    }

    const controller = new AbortController();
    const entry: Entry = {
      coordinate,
      state: 'loading',
      lastAccessTick: tick,
      controller,
    };

    this.#entries.set(key, entry);

    if (signal) {
      if (signal.aborted) {
        controller.abort(signal.reason);
      } else {
        signal.addEventListener(
          'abort',
          () => controller.abort(signal.reason),
          { once: true },
        );
      }
    }

    const promise = this.#load(
      key,
      entry,
      controller.signal,
    );

    entry.promise = promise;

    try {
      return await promise;
    } finally {
      entry.promise = undefined;
      entry.controller = undefined;
    }
  }

  async prefetchSquare(
    center: ChunkCoordinate,
    tick: number,
    signal?: AbortSignal,
  ): Promise<readonly WorldChunk[]> {
    const radius = Math.max(
      0,
      Math.floor(this.#options.viewDistance),
    );

    const coordinates: ChunkCoordinate[] = [];

    for (
      let z = center.z - radius;
      z <= center.z + radius;
      z += 1
    ) {
      for (
        let x = center.x - radius;
        x <= center.x + radius;
        x += 1
      ) {
        coordinates.push({ x, z });
      }
    }

    coordinates.sort((left, right) => {
      const leftDistance =
        Math.abs(left.x - center.x)
        + Math.abs(left.z - center.z);

      const rightDistance =
        Math.abs(right.x - center.x)
        + Math.abs(right.z - center.z);

      if (leftDistance !== rightDistance) {
        return leftDistance - rightDistance;
      }

      return this.key(left).localeCompare(
        this.key(right),
      );
    });

    const loaded: WorldChunk[] = [];

    for (const coordinate of coordinates) {
      if (signal?.aborted) {
        break;
      }

      loaded.push(
        await this.ensure(
          coordinate,
          tick,
          signal,
        ),
      );

      this.collect(tick);
    }

    return loaded;
  }

  touch(
    coordinate: ChunkCoordinate,
    tick: number,
  ): void {
    const entry = this.#entries.get(this.key(coordinate));

    if (entry) {
      entry.lastAccessTick = tick;
    }
  }

  collect(tick: number): readonly string[] {
    const candidates = [...this.#entries.values()]
      .filter((entry) => (
        entry.state === 'ready'
        && entry.chunk !== undefined
      ))
      .sort((left, right) => {
        if (left.lastAccessTick !== right.lastAccessTick) {
          return left.lastAccessTick - right.lastAccessTick;
        }

        return this.key(left.coordinate).localeCompare(
          this.key(right.coordinate),
        );
      });

    const resident = candidates.length;
    const limit = this.#options.maxResidentChunks;

    if (resident <= limit) {
      return [];
    }

    const removed: string[] = [];
    const removeCount = resident - limit;

    for (
      let index = 0;
      index < removeCount;
      index += 1
    ) {
      const candidate = candidates[index];

      if (!candidate?.chunk) {
        continue;
      }

      const key = this.key(candidate.coordinate);
      removed.push(key);

      void this.#source.unload?.(candidate.chunk);

      this.#entries.delete(key);
      this.#evictions += 1;
    }

    void tick;

    return removed;
  }

  cancel(coordinate: ChunkCoordinate): boolean {
    const entry = this.#entries.get(
      this.key(coordinate),
    );

    if (!entry?.controller) {
      return false;
    }

    entry.controller.abort(
      new RuntimeError({
        code: 'R50_WORLD_CANCEL',
        message: 'World chunk request cancelled.',
      }),
    );

    return true;
  }

  get(coordinate: ChunkCoordinate): WorldChunk | null {
    return this.#entries.get(this.key(coordinate))
      ?.chunk ?? null;
  }

  stats(): WorldRuntimeStats {
    let residentChunks = 0;
    let loadingChunks = 0;
    let queuedLoads = 0;

    for (const entry of this.#entries.values()) {
      if (entry.state === 'ready') {
        residentChunks += 1;
      }

      if (entry.state === 'loading') {
        loadingChunks += 1;
      }

      if (entry.state === 'queued') {
        queuedLoads += 1;
      }
    }

    return {
      residentChunks,
      loadingChunks,
      queuedLoads,
      evictions: this.#evictions,
      failedLoads: this.#failedLoads,
    };
  }

  manifestDigest(): string {
    const manifest = [...this.#entries.values()]
      .sort((left, right) =>
        this.key(left.coordinate).localeCompare(
          this.key(right.coordinate),
        ))
      .map((entry) => ({
        key: this.key(entry.coordinate),
        state: entry.state,
        revision: entry.chunk?.revision ?? 0,
      }));

    return stableHash(manifest);
  }

  async clear(): Promise<void> {
    const entries = [...this.#entries.values()];

    for (const entry of entries) {
      if (entry.controller) {
        entry.controller.abort();
      }

      if (entry.chunk) {
        await this.#source.unload?.(entry.chunk);
      }
    }

    this.#entries.clear();
  }

  async #load(
    key: string,
    entry: Entry,
    signal: AbortSignal,
  ): Promise<WorldChunk> {
    try {
      const chunk = await this.#source.load(
        entry.coordinate,
        signal,
      );

      if (
        chunk.key !== key
        || !Number.isFinite(chunk.revision)
        || chunk.revision < 0
      ) {
        throw new RuntimeError({
          code: 'R50_WORLD_CHUNK_INVALID',
          message: 'World chunk source returned an invalid chunk.',
          recoverable: false,
        });
      }

      entry.state = 'ready';
      entry.chunk = chunk;

      return chunk;
    } catch (error) {
      this.#failedLoads += 1;
      this.#entries.delete(key);

      if (error instanceof RuntimeError) {
        throw error;
      }

      throw new RuntimeError({
        code: 'R50_WORLD_LOAD',
        message: 'World chunk loading failed.',
        cause: error,
      });
    }
  }
}
