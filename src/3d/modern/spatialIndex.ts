import type { EntityId, Vector3Like } from './types';

export interface SpatialItem {
  readonly id: EntityId;
  readonly position: Vector3Like;
  readonly radius: number;
  readonly layer?: number;
}

export interface SpatialQueryOptions {
  readonly center: Vector3Like;
  readonly radius: number;
  readonly layer?: number;
  readonly limit?: number;
}

export interface SpatialHit { readonly id: EntityId; readonly distanceSquared: number; readonly item: SpatialItem; }

/** Uniform-grid spatial index for fauna, vegetation, pickups and proximity systems. */
export class SpatialHashGrid {
  private readonly cellSize: number;
  private readonly cells = new Map<string, Map<EntityId, SpatialItem>>();
  private readonly items = new Map<EntityId, SpatialItem>();

  public constructor(cellSize = 32) { this.cellSize = Math.max(0.25, cellSize); }

  public insert(item: SpatialItem): void {
    this.remove(item.id);
    this.items.set(item.id, item);
    this.bucket(item.position).set(item.id, item);
  }

  public update(item: SpatialItem): void { this.insert(item); }

  public remove(id: EntityId): boolean {
    const item = this.items.get(id);
    if (!item) return false;
    const bucket = this.bucket(item.position);
    bucket.delete(id);
    if (bucket.size === 0) this.cells.delete(this.keyFor(item.position));
    this.items.delete(id);
    return true;
  }

  public query(options: SpatialQueryOptions): readonly SpatialHit[] {
    const radius = Math.max(0, options.radius);
    const minX = Math.floor((options.center.x - radius) / this.cellSize);
    const maxX = Math.floor((options.center.x + radius) / this.cellSize);
    const minY = Math.floor((options.center.y - radius) / this.cellSize);
    const maxY = Math.floor((options.center.y + radius) / this.cellSize);
    const minZ = Math.floor((options.center.z - radius) / this.cellSize);
    const maxZ = Math.floor((options.center.z + radius) / this.cellSize);
    const maxDistance = radius * radius;
    const hits: SpatialHit[] = [];
    for (let x = minX; x <= maxX; x += 1) for (let y = minY; y <= maxY; y += 1) for (let z = minZ; z <= maxZ; z += 1) {
      const bucket = this.cells.get(`${x}|${y}|${z}`);
      if (!bucket) continue;
      for (const item of bucket.values()) {
        if (options.layer !== undefined && item.layer !== options.layer) continue;
        const distanceSquared = distanceSq(options.center, item.position);
        const effective = radius + Math.max(0, item.radius);
        if (distanceSquared <= Math.max(maxDistance, effective * effective)) hits.push({ id: item.id, distanceSquared, item });
      }
    }
    hits.sort((a, b) => a.distanceSquared - b.distanceSquared || a.id.localeCompare(b.id));
    return hits.slice(0, options.limit === undefined ? hits.length : Math.max(0, options.limit));
  }

  public nearest(center: Vector3Like, radius: number, limit = 1): readonly SpatialHit[] { return this.query({ center, radius, limit }); }
  public size(): number { return this.items.size; }
  public clear(): void { this.cells.clear(); this.items.clear(); }
  public cellCount(): number { return this.cells.size; }

  public validate(): { readonly valid: boolean; readonly duplicates: number } {
    const seen = new Set<EntityId>();
    let duplicates = 0;
    for (const bucket of this.cells.values()) for (const id of bucket.keys()) { if (seen.has(id)) duplicates += 1; seen.add(id); }
    return { valid: duplicates === 0 && seen.size === this.items.size, duplicates };
  }

  private bucket(position: Vector3Like): Map<EntityId, SpatialItem> {
    const key = this.keyFor(position);
    let bucket = this.cells.get(key);
    if (!bucket) { bucket = new Map(); this.cells.set(key, bucket); }
    return bucket;
  }
  private keyFor(position: Vector3Like): string {
    return `${Math.floor(position.x / this.cellSize)}|${Math.floor(position.y / this.cellSize)}|${Math.floor(position.z / this.cellSize)}`;
  }
}

export interface FrustumPlane { readonly normal: Vector3Like; readonly constant: number; }
export interface BoundingSphere { readonly center: Vector3Like; readonly radius: number; }

/** Renderer-independent frustum test; useful before handing visible IDs to the GPU planner. */
export const sphereInFrustum = (sphere: BoundingSphere, planes: readonly FrustumPlane[]): boolean => {
  for (const plane of planes) {
    const distance = plane.normal.x * sphere.center.x + plane.normal.y * sphere.center.y + plane.normal.z * sphere.center.z + plane.constant;
    if (distance < -Math.max(0, sphere.radius)) return false;
  }
  return true;
};

export interface LodBand { readonly maxDistance: number; readonly level: number; readonly updateHz: number; }
export const selectLod = (distance: number, bands: readonly LodBand[]): LodBand | null => {
  const sorted = [...bands].sort((a, b) => a.maxDistance - b.maxDistance || a.level - b.level);
  return sorted.find((band) => distance <= band.maxDistance) ?? sorted.at(-1) ?? null;
};

const distanceSq = (a: Vector3Like, b: Vector3Like): number => {
  const x = a.x - b.x; const y = a.y - b.y; const z = a.z - b.z;
  return x * x + y * y + z * z;
};
