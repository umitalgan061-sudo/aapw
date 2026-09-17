import type { WorldMarker, WorldMutationPort, WorldPoint, WorldQueryPort } from './portsR3.ts';

export type BiomeId = 'north' | 'mountain' | 'temperate' | 'coast' | 'south' | 'marsh' | 'volcanic';

export interface WorldRuntimeConfig {
  readonly seed: number;
  readonly chunkSize: number;
  readonly maxMarkers: number;
  readonly seaLevel: number;
  readonly walkableSlopeDegrees: number;
  readonly sampleCacheSize: number;
}

export interface ChunkCoord {
  readonly x: number;
  readonly z: number;
}

export interface WorldChunk {
  readonly key: string;
  readonly coord: ChunkCoord;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly loadedAtFrame: number;
  readonly lastUsedFrame: number;
  readonly residentBytes: number;
  readonly biome: BiomeId;
}

export interface WorldRuntimeSnapshot {
  readonly seed: number;
  readonly chunks: readonly WorldChunk[];
  readonly markers: readonly WorldMarker[];
  readonly cacheEntries: number;
  readonly sampleCount: number;
  readonly walkableQueries: number;
  readonly cacheHits: number;
}

const DEFAULT_CONFIG: WorldRuntimeConfig = {
  seed: 7121995,
  chunkSize: 128,
  maxMarkers: 4096,
  seaLevel: 0,
  walkableSlopeDegrees: 42,
  sampleCacheSize: 2048,
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

function hash2(seed: number, x: number, z: number): number {
  let h = (Math.imul(Math.floor(seed) | 0, 374761393) + Math.imul(x, 668265263) + Math.imul(z, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smoothstep(value: number): number {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function valueNoise(seed: number, x: number, z: number, frequency: number): number {
  const fx = x * frequency;
  const fz = z * frequency;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = smoothstep(fx - ix);
  const tz = smoothstep(fz - iz);
  const a = hash2(seed, ix, iz);
  const b = hash2(seed, ix + 1, iz);
  const c = hash2(seed, ix, iz + 1);
  const d = hash2(seed, ix + 1, iz + 1);
  return lerp(lerp(a, b, tx), lerp(c, d, tx), tz) * 2 - 1;
}

function biomeFor(height: number, moisture: number, latitude: number): BiomeId {
  if (height < -0.1) return 'coast';
  if (height > 34) return 'mountain';
  if (latitude > 0.72 && height > 7) return 'north';
  if (moisture > 0.62 && height < 3) return 'marsh';
  if (latitude < -0.68 && height > 9) return 'volcanic';
  if (latitude < -0.35) return 'south';
  return 'temperate';
}

export class WorldRuntimeR3 implements WorldQueryPort, WorldMutationPort {
  readonly #config: WorldRuntimeConfig;
  readonly #chunks = new Map<string, WorldChunk>();
  readonly #markers = new Map<string, WorldMarker>();
  readonly #sampleCache = new Map<string, number>();
  #frame = 0;
  #sampleCount = 0;
  #walkableQueries = 0;
  #cacheHits = 0;

  constructor(options: Partial<WorldRuntimeConfig> = {}) {
    this.#config = { ...DEFAULT_CONFIG, ...options };
  }

  advance(frame: number): void {
    this.#frame = Math.max(0, Math.floor(frame));
    for (const [key, chunk] of this.#chunks) {
      if (chunk.lastUsedFrame === this.#frame) {
        this.#chunks.set(key, { ...chunk, lastUsedFrame: this.#frame });
      }
    }
  }

  ensureChunk(x: number, z: number): WorldChunk {
    const coord = this.chunkCoord(x, z);
    const key = this.chunkKey(coord.x, coord.z);
    const existing = this.#chunks.get(key);
    if (existing) {
      const refreshed = { ...existing, lastUsedFrame: this.#frame };
      this.#chunks.set(key, refreshed);
      return refreshed;
    }
    const minX = coord.x * this.#config.chunkSize;
    const minZ = coord.z * this.#config.chunkSize;
    const centerX = minX + this.#config.chunkSize / 2;
    const centerZ = minZ + this.#config.chunkSize / 2;
    const biome = biomeFor(this.terrainHeight(centerX, centerZ), this.moisture(centerX, centerZ), this.latitude(centerZ));
    const chunk: WorldChunk = {
      key,
      coord,
      minX,
      maxX: minX + this.#config.chunkSize,
      minZ,
      maxZ: minZ + this.#config.chunkSize,
      loadedAtFrame: this.#frame,
      lastUsedFrame: this.#frame,
      residentBytes: 64 * 1024,
      biome,
    };
    this.#chunks.set(key, chunk);
    return chunk;
  }

  unloadFar(centerX: number, centerZ: number, radiusChunks: number): readonly WorldChunk[] {
    const center = this.chunkCoord(centerX, centerZ);
    const radius = Math.max(0, Math.floor(radiusChunks));
    const removed: WorldChunk[] = [];
    for (const [key, chunk] of this.#chunks) {
      const distance = Math.max(Math.abs(chunk.coord.x - center.x), Math.abs(chunk.coord.z - center.z));
      if (distance > radius) {
        removed.push(chunk);
        this.#chunks.delete(key);
      }
    }
    return removed;
  }

  terrainHeight(x: number, z: number): number {
    const key = `${Math.round(x * 10)}:${Math.round(z * 10)}`;
    const cached = this.#sampleCache.get(key);
    if (cached !== undefined) {
      this.#cacheHits += 1;
      return cached;
    }
    this.#sampleCount += 1;
    const continental = valueNoise(this.#config.seed, x, z, 0.0018) * 24;
    const regional = valueNoise(this.#config.seed + 17, x, z, 0.006) * 12;
    const detail = valueNoise(this.#config.seed + 41, x, z, 0.025) * 3.5;
    const ridge = Math.abs(valueNoise(this.#config.seed + 83, x, z, 0.012));
    const latitude = this.latitude(z);
    const mountainBand = Math.max(0, 1 - Math.abs(latitude - 0.15) * 3.2);
    const height = continental + regional + detail + ridge * ridge * 26 * mountainBand - 4;
    this.#sampleCache.set(key, height);
    while (this.#sampleCache.size > this.#config.sampleCacheSize) {
      const first = this.#sampleCache.keys().next().value;
      if (first === undefined) break;
      this.#sampleCache.delete(first);
    }
    return height;
  }

  waterLevel(): number {
    return this.#config.seaLevel;
  }

  isWalkable(x: number, z: number, radius: number): boolean {
    this.#walkableQueries += 1;
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(radius) || radius < 0) return false;
    const e = Math.max(0.5, radius);
    const center = this.terrainHeight(x, z);
    const dx = this.terrainHeight(x + e, z) - center;
    const dz = this.terrainHeight(x, z + e) - center;
    const slope = Math.atan(Math.hypot(dx, dz) / Math.max(e, 0.1)) * 180 / Math.PI;
    if (slope > this.#config.walkableSlopeDegrees) return false;
    if (center < this.#config.seaLevel - 0.1) return false;
    for (const marker of this.#markers.values()) {
      if (marker.kind !== 'blocked') continue;
      if (Math.hypot(marker.x - x, marker.z - z) <= radius + 1) return false;
    }
    return true;
  }

  nearestPoint(x: number, z: number, maxDistance: number): WorldPoint | null {
    const radius = Math.max(0, maxDistance);
    let best: WorldPoint | null = null;
    let bestDistance = radius + 1;
    for (const marker of this.#markers.values()) {
      const distance = Math.hypot(marker.x - x, marker.z - z);
      if (distance > radius || distance >= bestDistance) continue;
      bestDistance = distance;
      best = { x: marker.x, z: marker.z, y: marker.y, biome: this.biomeAt(marker.x, marker.z) };
    }
    if (best) return best;
    const y = this.terrainHeight(x, z);
    return { x, z, y, biome: this.biomeAt(x, z) };
  }

  biomeAt(x: number, z: number): BiomeId {
    return biomeFor(this.terrainHeight(x, z), this.moisture(x, z), this.latitude(z));
  }

  moisture(x: number, z: number): number {
    return clamp(0.5 + valueNoise(this.#config.seed + 127, x, z, 0.004), 0, 1);
  }

  latitude(z: number): number {
    const extent = 9000;
    return clamp(z / extent, -1, 1);
  }

  chunkCoord(x: number, z: number): ChunkCoord {
    return {
      x: Math.floor(x / this.#config.chunkSize),
      z: Math.floor(z / this.#config.chunkSize),
    };
  }

  chunkKey(x: number, z: number): string {
    return `${x},${z}`;
  }

  setMarker(marker: WorldMarker): { readonly ok: true; readonly value: void } | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly retryable: boolean } } {
    if (this.#markers.size >= this.#config.maxMarkers && !this.#markers.has(marker.id)) {
      return { ok: false, error: { code: 'MARKER_CAP', message: 'World marker capacity reached.', retryable: true } };
    }
    if (!marker.id.trim()) {
      return { ok: false, error: { code: 'MARKER_ID', message: 'Marker id cannot be empty.', retryable: false } };
    }
    if (![marker.x, marker.y, marker.z].every(Number.isFinite)) {
      return { ok: false, error: { code: 'MARKER_COORDINATES', message: 'Marker coordinates must be finite.', retryable: false } };
    }
    this.#markers.set(marker.id, { ...marker, tags: [...new Set(marker.tags)] });
    return { ok: true, value: undefined };
  }

  removeMarker(id: string): { readonly ok: true; readonly value: void } | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly retryable: boolean } } {
    if (!this.#markers.delete(id)) {
      return { ok: false, error: { code: 'MARKER_MISSING', message: 'Marker does not exist.', retryable: false } };
    }
    return { ok: true, value: undefined };
  }

  listMarkers(): readonly WorldMarker[] {
    return [...this.#markers.values()].map((marker) => ({ ...marker, tags: [...marker.tags] }));
  }

  snapshot(): WorldRuntimeSnapshot {
    return {
      seed: this.#config.seed,
      chunks: [...this.#chunks.values()].sort((a, b) => a.key.localeCompare(b.key)),
      markers: this.listMarkers().sort((a, b) => a.id.localeCompare(b.id)),
      cacheEntries: this.#sampleCache.size,
      sampleCount: this.#sampleCount,
      walkableQueries: this.#walkableQueries,
      cacheHits: this.#cacheHits,
    };
  }
}

export function createWorldRuntimeR3(options: Partial<WorldRuntimeConfig> = {}): WorldRuntimeR3 {
  return new WorldRuntimeR3(options);
}
