import type { Aabb2, EntityId } from './types.ts';
import { entityId } from './types.ts';

export interface SpatialItem { readonly id: EntityId; x: number; z: number; radius: number; }

const keyFor = (x: number, z: number): string => `${x},${z}`;

export class SpatialGrid<T extends SpatialItem = SpatialItem> {
  readonly cellSize: number;
  #cells = new Map<string, Set<EntityId>>();
  #items = new Map<EntityId, T>();
  #cellsByEntity = new Map<EntityId, string[]>();

  constructor(cellSize = 32) {
    if (!(cellSize > 0) || !Number.isFinite(cellSize)) throw new RangeError('cellSize must be positive');
    this.cellSize = cellSize;
  }

  clear(): void { this.#cells.clear(); this.#items.clear(); this.#cellsByEntity.clear(); }
  size(): number { return this.#items.size; }

  insert(item: T): void {
    if (this.#items.has(item.id)) this.remove(item.id);
    this.#items.set(item.id, item);
    const keys = this.#keysForCircle(item.x, item.z, Math.max(0, item.radius));
    this.#cellsByEntity.set(item.id, keys);
    for (const key of keys) {
      let bucket = this.#cells.get(key);
      if (!bucket) { bucket = new Set(); this.#cells.set(key, bucket); }
      bucket.add(item.id);
    }
  }

  update(item: T): void { this.insert(item); }

  remove(id: EntityId): boolean {
    if (!this.#items.delete(id)) return false;
    for (const key of this.#cellsByEntity.get(id) ?? []) {
      const bucket = this.#cells.get(key);
      bucket?.delete(id);
      if (bucket?.size === 0) this.#cells.delete(key);
    }
    this.#cellsByEntity.delete(id);
    return true;
  }

  get(id: EntityId): T | undefined { return this.#items.get(id); }

  queryCircle(x: number, z: number, radius: number): T[] {
    const ids = new Set<EntityId>();
    for (const key of this.#keysForCircle(x, z, Math.max(0, radius))) {
      for (const id of this.#cells.get(key) ?? []) ids.add(id);
    }
    const queryRadius = Math.max(0, radius);
    return [...ids]
      .map((id) => this.#items.get(id)!)
      .filter((item) => {
        const dx = item.x - x;
        const dz = item.z - z;
        const rr = queryRadius + Math.max(0, item.radius);
        return dx * dx + dz * dz <= rr * rr;
      })
      .sort((a, b) => a.id - b.id);
  }

  queryAabb(bounds: Aabb2): T[] {
    const minX = Math.floor(bounds.minX / this.cellSize);
    const maxX = Math.floor(bounds.maxX / this.cellSize);
    const minZ = Math.floor(bounds.minZ / this.cellSize);
    const maxZ = Math.floor(bounds.maxZ / this.cellSize);
    const ids = new Set<EntityId>();
    for (let z = minZ; z <= maxZ; z += 1) for (let x = minX; x <= maxX; x += 1) {
      for (const id of this.#cells.get(keyFor(x, z)) ?? []) ids.add(id);
    }
    return [...ids]
      .map((id) => this.#items.get(id)!)
      .filter((item) => item.x + item.radius >= bounds.minX && item.x - item.radius <= bounds.maxX && item.z + item.radius >= bounds.minZ && item.z - item.radius <= bounds.maxZ)
      .sort((a, b) => a.id - b.id);
  }

  nearest(x: number, z: number, radius: number, limit = 1): T[] {
    const candidates = this.queryCircle(x, z, radius);
    return candidates.sort((a, b) => {
      const da = (a.x - x) ** 2 + (a.z - z) ** 2;
      const db = (b.x - x) ** 2 + (b.z - z) ** 2;
      return da - db || a.id - b.id;
    }).slice(0, Math.max(0, Math.floor(limit)));
  }

  raycast2D(originX: number, originZ: number, directionX: number, directionZ: number, maxDistance: number, radius = 0): { item: T; distance: number } | null {
    const len = Math.hypot(directionX, directionZ);
    if (!(len > 0) || !(maxDistance > 0)) return null;
    const dx = directionX / len;
    const dz = directionZ / len;
    const steps = Math.max(1, Math.ceil(maxDistance / Math.max(1, this.cellSize * 0.5)));
    const seen = new Set<EntityId>();
    let best: { item: T; distance: number } | null = null;
    for (let step = 0; step <= steps; step += 1) {
      const distance = (step / steps) * maxDistance;
      const x = originX + dx * distance;
      const z = originZ + dz * distance;
      for (const item of this.queryCircle(x, z, Math.max(radius, this.cellSize * 0.5))) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        const relX = item.x - originX;
        const relZ = item.z - originZ;
        const along = relX * dx + relZ * dz;
        if (along < 0 || along > maxDistance) continue;
        const perp = Math.abs(relX * dz - relZ * dx);
        if (perp > radius + item.radius) continue;
        if (!best || along < best.distance) best = { item, distance: along };
      }
    }
    return best;
  }

  #keysForCircle(x: number, z: number, radius: number): string[] {
    const minX = Math.floor((x - radius) / this.cellSize);
    const maxX = Math.floor((x + radius) / this.cellSize);
    const minZ = Math.floor((z - radius) / this.cellSize);
    const maxZ = Math.floor((z + radius) / this.cellSize);
    const keys: string[] = [];
    for (let cellZ = minZ; cellZ <= maxZ; cellZ += 1) for (let cellX = minX; cellX <= maxX; cellX += 1) keys.push(keyFor(cellX, cellZ));
    return keys;
  }
}

export function createSpatialItem(id: number, x: number, z: number, radius = 0): SpatialItem {
  return { id: entityId(id), x, z, radius: Math.max(0, radius) };
}
