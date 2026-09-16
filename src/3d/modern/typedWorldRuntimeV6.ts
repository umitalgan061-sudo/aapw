import type { Vec3V4 } from './runtimeContractsV4';
import { sceneChunkId, sceneObjectId, type SceneChunkId, type SceneChunkV6, type SceneObjectId, type SceneObjectV6, finiteOrV6, nonNegativeV6 } from './typedSceneContractsV6';

export interface WorldRuntimeConfigV6 {
  readonly cellSize?: number;
  readonly activeRadius?: number;
  readonly prefetchRadius?: number;
  readonly unloadRadius?: number;
  readonly maxResidentChunks?: number;
  readonly maxResidentBytes?: number;
  readonly maxChunkObjects?: number;
  readonly chunkBytes?: number;
}

export interface WorldObjectFactoryV6 {
  readonly create: (id: SceneObjectId, kind: SceneObjectV6['kind'], position: Vec3V4, chunk: SceneChunkId) => SceneObjectV6;
  readonly destroy?: (object: SceneObjectV6) => void;
}

export interface WorldStreamingRequestV6 {
  readonly chunk: SceneChunkId;
  readonly x: number;
  readonly z: number;
  readonly distance: number;
  readonly priority: number;
  readonly reason: 'active' | 'prefetch' | 'restore' | 'retry';
}

export interface WorldRuntimeMetricsV6 {
  readonly objects: number;
  readonly chunks: number;
  readonly residentChunks: number;
  readonly residentBytes: number;
  readonly queuedRequests: number;
  readonly loaded: number;
  readonly unloaded: number;
  readonly evicted: number;
  readonly failed: number;
  readonly queries: number;
}

const defaults: Required<WorldRuntimeConfigV6> = Object.freeze({ cellSize: 64, activeRadius: 3, prefetchRadius: 5, unloadRadius: 7, maxResidentChunks: 96, maxResidentBytes: 768 * 1024 * 1024, maxChunkObjects: 4096, chunkBytes: 8 * 1024 * 1024 });

interface InternalChunk extends SceneChunkV6 { objectIds: SceneObjectId[]; }
interface Cell { readonly x: number; readonly z: number; readonly ids: Set<SceneObjectId>; }

const key = (x: number, z: number): string => `${x}:${z}`;
const clampInt = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, Math.trunc(value)));
const cellOf = (position: Vec3V4, size: number): { x: number; z: number } => ({ x: Math.floor(position.x / size), z: Math.floor(position.z / size) });
const distanceXZ = (a: Vec3V4, b: Vec3V4): number => Math.hypot(a.x - b.x, a.z - b.z);

export class TypedWorldRuntimeV6 {
  readonly cellSize: number;
  readonly activeRadius: number;
  readonly prefetchRadius: number;
  readonly unloadRadius: number;
  readonly maxResidentChunks: number;
  readonly maxResidentBytes: number;
  readonly maxChunkObjects: number;
  readonly chunkBytes: number;
  #chunks = new Map<SceneChunkId, InternalChunk>();
  #objects = new Map<SceneObjectId, SceneObjectV6>();
  #cells = new Map<string, Cell>();
  #requests: WorldStreamingRequestV6[] = [];
  #player: Vec3V4 = Object.freeze({ x: 0, y: 0, z: 0 });
  #sequence = 0;
  #metrics: WorldRuntimeMetricsV6 = Object.freeze({ objects: 0, chunks: 0, residentChunks: 0, residentBytes: 0, queuedRequests: 0, loaded: 0, unloaded: 0, evicted: 0, failed: 0, queries: 0 });
  readonly factory: WorldObjectFactoryV6;

  constructor(options: WorldRuntimeConfigV6 = {}, factory?: WorldObjectFactoryV6) {
    const config = { ...defaults, ...options };
    this.cellSize = Math.max(1, finiteOrV6(config.cellSize, defaults.cellSize));
    this.activeRadius = Math.max(0, clampInt(config.activeRadius, 0, 32));
    this.prefetchRadius = Math.max(this.activeRadius, clampInt(config.prefetchRadius, this.activeRadius, 64));
    this.unloadRadius = Math.max(this.prefetchRadius + 1, clampInt(config.unloadRadius, this.prefetchRadius + 1, 128));
    this.maxResidentChunks = Math.max(1, clampInt(config.maxResidentChunks, 1, 4096));
    this.maxResidentBytes = Math.max(1024 * 1024, nonNegativeV6(config.maxResidentBytes, defaults.maxResidentBytes));
    this.maxChunkObjects = Math.max(1, clampInt(config.maxChunkObjects, 1, 100_000));
    this.chunkBytes = Math.max(1024, nonNegativeV6(config.chunkBytes, defaults.chunkBytes));
    this.factory = factory ?? { create: (id, kind, position) => Object.freeze({ id, kind, position: { ...position }, rotation: { yaw: 0, pitch: 0, roll: 0 }, scale: { x: 1, y: 1, z: 1 }, visible: true, enabled: true, tags: [] }) };
  }

  setPlayerPosition(position: Vec3V4): readonly WorldStreamingRequestV6[] {
    this.#player = Object.freeze({ x: finiteOrV6(position.x), y: finiteOrV6(position.y), z: finiteOrV6(position.z) });
    this.#rebuildRequests();
    return this.requests();
  }

  registerChunk(chunk: Omit<SceneChunkV6, 'objectIds'> & { readonly objectIds?: readonly SceneObjectId[] }): void {
    const normalized: InternalChunk = { ...chunk, id: chunk.id, objectIds: [...(chunk.objectIds ?? [])] };
    this.#chunks.set(chunk.id, normalized);
    this.#recount();
  }

  ensureChunk(x: number, z: number, priority = 0): SceneChunkId {
    const id = sceneChunkId(`chunk:${Math.trunc(x)}:${Math.trunc(z)}`);
    if (!this.#chunks.has(id)) this.registerChunk({ id, x: Math.trunc(x), z: Math.trunc(z), loaded: false, resident: false, distance: Number.POSITIVE_INFINITY, objectIds: [], priority, estimatedBytes: this.chunkBytes });
    return id;
  }

  queueChunk(x: number, z: number, reason: WorldStreamingRequestV6['reason'] = 'active'): boolean {
    const chunk = this.ensureChunk(x, z);
    const distance = Math.hypot(x - Math.floor(this.#player.x / this.cellSize), z - Math.floor(this.#player.z / this.cellSize));
    const priority = Math.max(0, 10_000 - Math.round(distance * 100) + (reason === 'active' ? 2000 : reason === 'restore' ? 1200 : reason === 'retry' ? 600 : 0));
    const request: WorldStreamingRequestV6 = Object.freeze({ chunk, x: Math.trunc(x), z: Math.trunc(z), distance, priority, reason });
    this.#requests = [...this.#requests.filter((entry) => entry.chunk !== chunk), request].sort((a,b) => b.priority - a.priority || String(a.chunk).localeCompare(String(b.chunk)));
    this.#metrics = Object.freeze({ ...this.#metrics, queuedRequests: this.#requests.length });
    return true;
  }

  requests(): readonly WorldStreamingRequestV6[] { return Object.freeze(this.#requests.slice()); }

  loadChunk(chunkId: SceneChunkId, objects: readonly SceneObjectV6[] = []): boolean {
    const chunk = this.#chunks.get(chunkId);
    if (!chunk || objects.length > this.maxChunkObjects) { this.#metrics = Object.freeze({ ...this.#metrics, failed: this.#metrics.failed + 1 }); return false; }
    for (const object of objects) this.#attachObject(chunk, object);
    chunk.loaded = true;
    chunk.resident = true;
    chunk.distance = this.#chunkDistance(chunk.x, chunk.z);
    this.#requests = this.#requests.filter((entry) => entry.chunk !== chunkId);
    this.#metrics = Object.freeze({ ...this.#metrics, loaded: this.#metrics.loaded + 1, queuedRequests: this.#requests.length });
    this.evictIfNeeded();
    return true;
  }

  instantiateChunk(chunkId: SceneChunkId, kinds: readonly SceneObjectV6['kind'][]): readonly SceneObjectId[] {
    const chunk = this.#chunks.get(chunkId);
    if (!chunk || kinds.length > this.maxChunkObjects) return [];
    const created: SceneObjectId[] = [];
    const center = vec3ForChunk(chunk.x, chunk.z, this.cellSize);
    kinds.forEach((kind, index) => {
      const id = sceneObjectId(`${String(chunkId)}:obj:${this.#sequence++}:${index}`);
      const jitter = ((index * 17) % 31) - 15;
      const object = this.factory.create(id, kind, { x: center.x + jitter, y: center.y, z: center.z - jitter }, chunkId);
      this.#attachObject(chunk, object); created.push(id);
    });
    chunk.loaded = true; chunk.resident = true; chunk.distance = this.#chunkDistance(chunk.x, chunk.z);
    this.#metrics = Object.freeze({ ...this.#metrics, loaded: this.#metrics.loaded + 1 });
    this.evictIfNeeded();
    return Object.freeze(created);
  }

  unloadChunk(chunkId: SceneChunkId): boolean {
    const chunk = this.#chunks.get(chunkId); if (!chunk || !chunk.resident) return false;
    for (const id of [...chunk.objectIds]) this.removeObject(id);
    chunk.resident = false; chunk.loaded = false; chunk.distance = Number.POSITIVE_INFINITY;
    this.#metrics = Object.freeze({ ...this.#metrics, unloaded: this.#metrics.unloaded + 1 });
    this.#recount();
    return true;
  }

  evictIfNeeded(): void {
    while (this.#residentChunkCount() > this.maxResidentChunks || this.#residentBytes() > this.maxResidentBytes) {
      const candidates = [...this.#chunks.values()].filter((chunk) => chunk.resident).sort((a,b) => b.distance - a.distance || a.priority - b.priority || String(a.id).localeCompare(String(b.id)));
      const victim = candidates[0]; if (!victim) break;
      this.unloadChunk(victim.id);
      this.#metrics = Object.freeze({ ...this.#metrics, evicted: this.#metrics.evicted + 1 });
    }
  }

  updateStreaming(): void {
    const centerX = Math.floor(this.#player.x / this.cellSize); const centerZ = Math.floor(this.#player.z / this.cellSize);
    for (let dz = -this.prefetchRadius; dz <= this.prefetchRadius; dz += 1) for (let dx = -this.prefetchRadius; dx <= this.prefetchRadius; dx += 1) {
      const distance = Math.hypot(dx, dz); if (distance > this.prefetchRadius) continue;
      const reason = distance <= this.activeRadius ? 'active' : 'prefetch';
      const id = this.ensureChunk(centerX + dx, centerZ + dz);
      const chunk = this.#chunks.get(id)!; chunk.distance = distance;
      if (!chunk.resident) this.queueChunk(centerX + dx, centerZ + dz, reason);
    }
    for (const chunk of this.#chunks.values()) if (chunk.resident && chunk.distance > this.unloadRadius) this.unloadChunk(chunk.id);
    this.evictIfNeeded();
  }

  upsertObject(object: SceneObjectV6, chunkId?: SceneChunkId): boolean {
    const existing = this.#objects.get(object.id); if (existing) this.removeObject(object.id);
    const chunk = chunkId ? this.#chunks.get(chunkId) : undefined;
    if (chunk) this.#attachObject(chunk, object); else this.#objects.set(object.id, object);
    this.#indexObject(object);
    this.#recount(); return true;
  }

  removeObject(id: SceneObjectId): boolean {
    const object = this.#objects.get(id); if (!object) return false;
    this.#objects.delete(id);
    for (const cell of this.#cells.values()) cell.ids.delete(id);
    for (const chunk of this.#chunks.values()) chunk.objectIds = chunk.objectIds.filter((entry) => entry !== id);
    this.factory.destroy?.(object); this.#recount(); return true;
  }

  radiusQuery(center: Vec3V4, radius: number, kind?: SceneObjectV6['kind']): readonly SceneObjectV6[] {
    this.#metrics = Object.freeze({ ...this.#metrics, queries: this.#metrics.queries + 1 });
    const safeRadius = Math.max(0, finiteOrV6(radius)); const cells = this.#candidateCells(center, safeRadius); const result: SceneObjectV6[] = [];
    for (const cell of cells) for (const id of cell.ids) { const object = this.#objects.get(id); if (!object || (kind && object.kind !== kind)) continue; if (distanceXZ(center, object.position) <= safeRadius) result.push(object); }
    result.sort((a,b) => distanceXZ(center, a.position) - distanceXZ(center, b.position) || String(a.id).localeCompare(String(b.id)));
    return Object.freeze(result);
  }

  nearest(center: Vec3V4, maxDistance: number, limit = 1): readonly SceneObjectV6[] { return this.radiusQuery(center, maxDistance).slice(0, Math.max(0, Math.trunc(limit))); }
  object(id: SceneObjectId): SceneObjectV6 | undefined { return this.#objects.get(id); }
  chunk(id: SceneChunkId): SceneChunkV6 | undefined { const chunk = this.#chunks.get(id); return chunk ? Object.freeze({ ...chunk, objectIds: Object.freeze(chunk.objectIds.slice()) }) : undefined; }
  objects(): readonly SceneObjectV6[] { return Object.freeze([...this.#objects.values()]); }
  chunks(): readonly SceneChunkV6[] { return Object.freeze([...this.#chunks.values()].map((chunk) => Object.freeze({ ...chunk, objectIds: Object.freeze(chunk.objectIds.slice()) }))); }
  metrics(): WorldRuntimeMetricsV6 { return this.#metrics; }

  #attachObject(chunk: InternalChunk, object: SceneObjectV6): void { this.#objects.set(object.id, object); if (!chunk.objectIds.includes(object.id)) chunk.objectIds.push(object.id); this.#indexObject(object); }
  #indexObject(object: SceneObjectV6): void { const cell = cellOf(object.position, this.cellSize); const cellKey = key(cell.x, cell.z); let bucket = this.#cells.get(cellKey); if (!bucket) { bucket = { x: cell.x, z: cell.z, ids: new Set() }; this.#cells.set(cellKey, bucket); } bucket.ids.add(object.id); }
  #candidateCells(center: Vec3V4, radius: number): readonly Cell[] { const min = cellOf({ x: center.x - radius, y: 0, z: center.z - radius }, this.cellSize); const max = cellOf({ x: center.x + radius, y: 0, z: center.z + radius }, this.cellSize); const result: Cell[] = []; for (let z = min.z; z <= max.z; z += 1) for (let x = min.x; x <= max.x; x += 1) { const bucket = this.#cells.get(key(x,z)); if (bucket) result.push(bucket); } return result; }
  #chunkDistance(x: number, z: number): number { const centerX = Math.floor(this.#player.x / this.cellSize); const centerZ = Math.floor(this.#player.z / this.cellSize); return Math.hypot(x - centerX, z - centerZ); }
  #residentChunkCount(): number { let count = 0; for (const chunk of this.#chunks.values()) if (chunk.resident) count += 1; return count; }
  #residentBytes(): number { let bytes = 0; for (const chunk of this.#chunks.values()) if (chunk.resident) bytes += nonNegativeV6(chunk.estimatedBytes, this.chunkBytes); return bytes; }
  #rebuildRequests(): void { this.#requests = []; this.updateStreaming(); }
  #recount(): void { this.#metrics = Object.freeze({ ...this.#metrics, objects: this.#objects.size, chunks: this.#chunks.size, residentChunks: this.#residentChunkCount(), residentBytes: this.#residentBytes(), queuedRequests: this.#requests.length }); }
}

function vec3ForChunk(x: number, z: number, size: number): Vec3V4 { return Object.freeze({ x: x * size + size / 2, y: 0, z: z * size + size / 2 }); }

export function chunkRingV6(radius: number): readonly Readonly<{ x: number; z: number; distance: number }>[] { const safe = Math.max(0, Math.min(64, Math.trunc(radius))); const result: Array<{ x: number; z: number; distance: number }> = []; for (let z = -safe; z <= safe; z += 1) for (let x = -safe; x <= safe; x += 1) { const distance = Math.hypot(x,z); if (distance <= safe) result.push({ x,z,distance }); } return Object.freeze(result.sort((a,b) => a.distance-b.distance || a.z-b.z || a.x-b.x)); }
