import type { Aabb3, Disposable, EntityId, SpatialCellCoord, SpatialEntry, SpatialQuery, Sphere3, Vec3 } from './types.js';
import { ENTITY_ID } from './types.js';
import { clamp, distanceSqVec3, stableSort } from './deterministic.js';

interface CellBucket { readonly key: string; readonly entries: Set<EntityId>; }
export interface SpatialStats { readonly entries: number; readonly occupiedCells: number; readonly queries: number; readonly candidates: number; readonly hits: number; readonly cellSize: number; }
export interface Ray3 { readonly origin: Vec3; readonly direction: Vec3; readonly maxDistance: number; }
export interface RayHit { readonly entity: EntityId; readonly distance: number; readonly point: Vec3; readonly normal: Vec3; }

export class SpatialHash3D implements Disposable {
  private readonly cellSize: number;
  private readonly cells = new Map<string, CellBucket>();
  private readonly records = new Map<EntityId, SpatialEntry>();
  private readonly queryScratch = new Set<EntityId>();
  private _disposed = false;
  private queryCount = 0;
  private candidateCount = 0;
  private hitCount = 0;

  public constructor(cellSize = 16) { this.cellSize = Math.max(0.25, Number.isFinite(cellSize) ? cellSize : 16); }
  public get disposed(): boolean { return this._disposed; }
  public get stats(): SpatialStats {
    return Object.freeze({ entries: this.records.size, occupiedCells: this.cells.size, queries: this.queryCount, candidates: this.candidateCount, hits: this.hitCount, cellSize: this.cellSize });
  }

  public upsert(entry: SpatialEntry): boolean {
    if (this._disposed || !isValidEntry(entry)) return false;
    this.remove(entry.entity);
    this.records.set(entry.entity, Object.freeze({ ...entry, bounds: cloneAabb(entry.bounds) }));
    for (const coord of cellsForAabb(entry.bounds, this.cellSize)) this.addToCell(coord, entry.entity);
    return true;
  }

  public remove(entity: EntityId): boolean {
    const previous = this.records.get(entity);
    if (!previous) return false;
    for (const coord of cellsForAabb(previous.bounds, this.cellSize)) this.removeFromCell(coord, entity);
    this.records.delete(entity);
    return true;
  }

  public get(entity: EntityId): SpatialEntry | undefined { return this._disposed ? undefined : this.records.get(entity); }

  public query(query: SpatialQuery = {}): EntityId[] {
    if (this._disposed) return [];
    this.queryCount += 1;
    this.queryScratch.clear();
    if (query.bounds) for (const coord of cellsForAabb(query.bounds, this.cellSize)) this.collectCell(coord);
    else if (query.sphere) for (const coord of cellsForSphere(query.sphere, this.cellSize)) this.collectCell(coord);
    else for (const entity of this.records.keys()) this.queryScratch.add(entity);
    this.candidateCount += this.queryScratch.size;
    const maxResults = Math.max(0, Math.trunc(query.maxResults ?? Number.MAX_SAFE_INTEGER));
    const result: EntityId[] = [];
    for (const entity of this.queryScratch) {
      const entry = this.records.get(entity);
      if (!entry) continue;
      if (query.layerMask !== undefined && (entry.layer & query.layerMask) === 0) continue;
      if (query.bounds && !aabbIntersects(entry.bounds, query.bounds)) continue;
      if (query.sphere && !sphereIntersectsAabb(query.sphere, entry.bounds)) continue;
      result.push(entity);
      if (result.length >= maxResults) break;
    }
    const sorted = stableSort(result, (a, b) => a < b ? -1 : a > b ? 1 : 0);
    this.hitCount += sorted.length;
    return sorted;
  }

  public queryNearest(point: Vec3, maxDistance: number, options: { layerMask?: number; maxResults?: number } = {}): EntityId[] {
    const radius = Math.max(0, Number.isFinite(maxDistance) ? maxDistance : 0);
    const sphere: Sphere3 = { center: point, radius };
    const candidates = this.query({ sphere, layerMask: options.layerMask });
    const ranked = candidates.map(entity => {
      const entry = this.records.get(entity)!;
      return { entity, distance: distanceSqPointAabb(point, entry.bounds) };
    }).sort((a, b) => a.distance - b.distance || (a.entity < b.entity ? -1 : 1));
    return ranked.slice(0, Math.max(0, Math.trunc(options.maxResults ?? ranked.length))).map(item => item.entity);
  }

  public raycast(ray: Ray3, options: { layerMask?: number; maxHits?: number } = {}): RayHit[] {
    if (this._disposed || !isFiniteVec3(ray.origin) || !isFiniteVec3(ray.direction)) return [];
    const direction = normalize(ray.direction);
    if (lengthSq(direction) < 1e-12) return [];
    const queryRadius = Math.max(0, Number.isFinite(ray.maxDistance) ? ray.maxDistance : 0);
    const candidates = this.query({ sphere: { center: add(ray.origin, scale(direction, queryRadius * 0.5)), radius: queryRadius * 0.5 } });
    const hits: RayHit[] = [];
    for (const entity of candidates) {
      const entry = this.records.get(entity);
      if (!entry || options.layerMask !== undefined && (entry.layer & options.layerMask) === 0) continue;
      const hit = rayAabb(ray.origin, direction, queryRadius, entry.bounds);
      if (hit) hits.push({ entity, distance: hit.distance, point: hit.point, normal: hit.normal });
    }
    hits.sort((a, b) => a.distance - b.distance || (a.entity < b.entity ? -1 : 1));
    return hits.slice(0, Math.max(0, Math.trunc(options.maxHits ?? hits.length)));
  }

  public clear(): void { this.cells.clear(); this.records.clear(); this.queryScratch.clear(); }
  public dispose(): void { this.clear(); this._disposed = true; }

  private addToCell(coord: SpatialCellCoord, entity: EntityId): void {
    const key = cellKey(coord);
    let bucket = this.cells.get(key);
    if (!bucket) { bucket = { key, entries: new Set() }; this.cells.set(key, bucket); }
    bucket.entries.add(entity);
  }
  private removeFromCell(coord: SpatialCellCoord, entity: EntityId): void {
    const key = cellKey(coord);
    const bucket = this.cells.get(key);
    if (!bucket) return;
    bucket.entries.delete(entity);
    if (bucket.entries.size === 0) this.cells.delete(key);
  }
  private collectCell(coord: SpatialCellCoord): void {
    const bucket = this.cells.get(cellKey(coord));
    if (!bucket) return;
    for (const entity of bucket.entries) this.queryScratch.add(entity);
  }
}

export const cellForPoint = (point: Vec3, cellSize: number): SpatialCellCoord => ({ x: fastFloor(point.x / cellSize), y: fastFloor(point.y / cellSize), z: fastFloor(point.z / cellSize) });

const cellsForAabb = function* (bounds: Aabb3, cellSize: number): Iterable<SpatialCellCoord> {
  const min = cellForPoint(bounds.min, cellSize);
  const max = cellForPoint(bounds.max, cellSize);
  for (let y = min.y; y <= max.y; y += 1) for (let z = min.z; z <= max.z; z += 1) for (let x = min.x; x <= max.x; x += 1) yield { x, y, z };
};

const cellsForSphere = function* (sphere: Sphere3, cellSize: number): Iterable<SpatialCellCoord> {
  const min = cellForPoint({ x: sphere.center.x - sphere.radius, y: sphere.center.y - sphere.radius, z: sphere.center.z - sphere.radius }, cellSize);
  const max = cellForPoint({ x: sphere.center.x + sphere.radius, y: sphere.center.y + sphere.radius, z: sphere.center.z + sphere.radius }, cellSize);
  for (let y = min.y; y <= max.y; y += 1) for (let z = min.z; z <= max.z; z += 1) for (let x = min.x; x <= max.x; x += 1) yield { x, y, z };
};

const cellKey = (coord: SpatialCellCoord): string => `${coord.x},${coord.y},${coord.z}`;
const fastFloor = (value: number): number => Math.floor(Number.isFinite(value) ? value : 0);
const cloneVec = (v: Vec3): Vec3 => Object.freeze({ x: v.x, y: v.y, z: v.z });
const cloneAabb = (aabb: Aabb3): Aabb3 => Object.freeze({ min: cloneVec(aabb.min), max: cloneVec(aabb.max) });
const isFiniteVec3 = (v: Vec3): boolean => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
const isValidEntry = (entry: SpatialEntry): boolean => isFiniteVec3(entry.bounds.min) && isFiniteVec3(entry.bounds.max) && entry.bounds.min.x <= entry.bounds.max.x && entry.bounds.min.y <= entry.bounds.max.y && entry.bounds.min.z <= entry.bounds.max.z && Number.isFinite(entry.layer);
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const lengthSq = (a: Vec3): number => a.x * a.x + a.y * a.y + a.z * a.z;
const normalize = (a: Vec3): Vec3 => { const l = Math.sqrt(lengthSq(a)); return l > 1e-8 ? scale(a, 1 / l) : { x: 0, y: 0, z: 0 }; };

export const aabbIntersects = (a: Aabb3, b: Aabb3): boolean => a.min.x <= b.max.x && a.max.x >= b.min.x && a.min.y <= b.max.y && a.max.y >= b.min.y && a.min.z <= b.max.z && a.max.z >= b.min.z;
export const sphereIntersectsAabb = (sphere: Sphere3, box: Aabb3): boolean => distanceSqPointAabb(sphere.center, box) <= sphere.radius * sphere.radius;
export const distanceSqPointAabb = (point: Vec3, box: Aabb3): number => {
  const dx = Math.max(box.min.x - point.x, 0, point.x - box.max.x);
  const dy = Math.max(box.min.y - point.y, 0, point.y - box.max.y);
  const dz = Math.max(box.min.z - point.z, 0, point.z - box.max.z);
  return dx * dx + dy * dy + dz * dz;
};

const rayAabb = (origin: Vec3, direction: Vec3, maxDistance: number, box: Aabb3): { distance: number; point: Vec3; normal: Vec3 } | null => {
  let tMin = 0;
  let tMax = maxDistance;
  let normal: Vec3 = { x: 0, y: 0, z: 0 };
  const axes: Array<[number, number, number, number]> = [[origin.x, direction.x, box.min.x, box.max.x], [origin.y, direction.y, box.min.y, box.max.y], [origin.z, direction.z, box.min.z, box.max.z]];
  for (let axis = 0; axis < 3; axis += 1) {
    const [o, d, min, max] = axes[axis]!;
    if (Math.abs(d) < 1e-10) { if (o < min || o > max) return null; continue; }
    let near = (min - o) / d;
    let far = (max - o) / d;
    let nearNormal = axis === 0 ? { x: -Math.sign(d), y: 0, z: 0 } : axis === 1 ? { x: 0, y: -Math.sign(d), z: 0 } : { x: 0, y: 0, z: -Math.sign(d) };
    if (near > far) { [near, far] = [far, near]; nearNormal = scale(nearNormal, -1); }
    if (near > tMin) { tMin = near; normal = nearNormal; }
    tMax = Math.min(tMax, far);
    if (tMin > tMax) return null;
  }
  if (tMin < 0 || tMin > maxDistance) return null;
  return { distance: clamp(tMin, 0, maxDistance), point: add(origin, scale(direction, tMin)), normal };
};

export const spatialEntity = (value: string): EntityId => ENTITY_ID(value);
