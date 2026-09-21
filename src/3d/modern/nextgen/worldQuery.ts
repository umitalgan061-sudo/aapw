import { Aabb, EntityId, Transform, Vec3, distanceSquared, vec3, normalizeVec3 } from './types.ts';
import { EntityComponentWorld, TransformComponent } from './ecs.ts';

export interface HeightSample {
  height: number;
  normal: Vec3;
  walkable: boolean;
  material: string;
}

export type HeightSampler = (x: number, z: number) => HeightSample;

export interface RaycastHit {
  entity: EntityId;
  distance: number;
  point: Vec3;
  normal: Vec3;
}

export interface SpatialNode {
  id: EntityId;
  bounds: Aabb;
  layer: string;
}

export class UniformSpatialGrid {
  readonly #cellSize: number;
  readonly #cells = new Map<string, Set<EntityId>>();
  readonly #nodes = new Map<EntityId, SpatialNode>();

  constructor(cellSize = 32) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) throw new RangeError('cellSize must be positive');
    this.#cellSize = cellSize;
  }

  insert(node: SpatialNode): void {
    this.remove(node.id);
    this.#nodes.set(node.id, node);
    for (const key of this.#cellsFor(node.bounds)) {
      const bucket = this.#cells.get(key) ?? new Set<EntityId>();
      bucket.add(node.id);
      this.#cells.set(key, bucket);
    }
  }

  remove(id: EntityId): boolean {
    const node = this.#nodes.get(id);
    if (!node) return false;
    for (const key of this.#cellsFor(node.bounds)) {
      const bucket = this.#cells.get(key);
      bucket?.delete(id);
      if (bucket?.size === 0) this.#cells.delete(key);
    }
    this.#nodes.delete(id);
    return true;
  }

  queryAabb(bounds: Aabb, layer?: string): EntityId[] {
    const candidates = new Set<EntityId>();
    for (const key of this.#cellsFor(bounds)) {
      for (const id of this.#cells.get(key) ?? []) candidates.add(id);
    }
    return [...candidates]
      .filter((id) => {
        const node = this.#nodes.get(id);
        return node !== undefined && (!layer || node.layer === layer) && intersects(node.bounds, bounds);
      })
      .sort((a, b) => Number(a) - Number(b));
  }

  querySphere(center: Vec3, radius: number, layer?: string): EntityId[] {
    const bounds: Aabb = {
      min: vec3(center.x - radius, center.y - radius, center.z - radius),
      max: vec3(center.x + radius, center.y + radius, center.z + radius),
    };
    return this.queryAabb(bounds, layer).filter((id) => {
      const node = this.#nodes.get(id)!;
      return distanceSquared(center, closestPoint(center, node.bounds)) <= radius * radius;
    });
  }

  get size(): number { return this.#nodes.size; }

  #cellsFor(bounds: Aabb): string[] {
    const minX = Math.floor(bounds.min.x / this.#cellSize);
    const maxX = Math.floor(bounds.max.x / this.#cellSize);
    const minY = Math.floor(bounds.min.y / this.#cellSize);
    const maxY = Math.floor(bounds.max.y / this.#cellSize);
    const minZ = Math.floor(bounds.min.z / this.#cellSize);
    const maxZ = Math.floor(bounds.max.z / this.#cellSize);
    const result: string[] = [];
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        for (let z = minZ; z <= maxZ; z += 1) result.push(`${x}:${y}:${z}`);
      }
    }
    return result;
  }
}

export class TerrainQuery {
  readonly #sample: HeightSampler;
  readonly #cache = new Map<string, HeightSample>();
  readonly #cacheCapacity: number;

  constructor(sample: HeightSampler, cacheCapacity = 512) {
    this.#sample = sample;
    this.#cacheCapacity = Math.max(16, Math.floor(cacheCapacity));
  }

  heightAt(x: number, z: number): HeightSample {
    const key = `${Math.round(x * 10) / 10}:${Math.round(z * 10) / 10}`;
    const cached = this.#cache.get(key);
    if (cached) return cached;
    const sample = this.#sanitize(this.#sample(x, z));
    this.#cache.set(key, sample);
    while (this.#cache.size > this.#cacheCapacity) {
      const oldest = this.#cache.keys().next().value;
      if (oldest === undefined) break;
      this.#cache.delete(oldest);
    }
    return sample;
  }

  snapToGround(position: Vec3, clearance = 0): Vec3 {
    const sample = this.heightAt(position.x, position.z);
    return { x: position.x, y: sample.height + Math.max(0, clearance), z: position.z };
  }

  canWalk(position: Vec3, maxSlopeDegrees = 42): boolean {
    const sample = this.heightAt(position.x, position.z);
    const slope = Math.acos(Math.max(-1, Math.min(1, sample.normal.y))) * 180 / Math.PI;
    return sample.walkable && slope <= maxSlopeDegrees;
  }

  raycastSurface(origin: Vec3, direction: Vec3, maxDistance = 256, step = 2): Vec3 | null {
    const dir = normalizeVec3(direction);
    if (dir.x === 0 && dir.y === 0 && dir.z === 0) return null;
    for (let distance = 0; distance <= maxDistance; distance += step) {
      const point = {
        x: origin.x + dir.x * distance,
        y: origin.y + dir.y * distance,
        z: origin.z + dir.z * distance,
      };
      if (point.y <= this.heightAt(point.x, point.z).height) return point;
    }
    return null;
  }

  clearCache(): void { this.#cache.clear(); }

  #sanitize(sample: HeightSample): HeightSample {
    const normal = normalizeVec3(sample.normal);
    return {
      height: Number.isFinite(sample.height) ? sample.height : 0,
      normal: normal.x || normal.y || normal.z ? normal : { x: 0, y: 1, z: 0 },
      walkable: Boolean(sample.walkable),
      material: sample.material || 'default',
    };
  }
}

export function createWorldQuery(world: EntityComponentWorld, terrain: TerrainQuery): {
  nearby: (center: Vec3, radius: number) => EntityId[];
  transform: (entity: EntityId) => Transform | undefined;
  snap: (position: Vec3, clearance?: number) => Vec3;
} {
  const grid = new UniformSpatialGrid();
  return {
    nearby(center, radius) {
      for (const entity of world.query({ required: [TransformComponent], excluded: [] })) {
        const transform = world.get(entity, TransformComponent);
        if (!transform) continue;
        grid.insert({ id: entity, layer: 'world', bounds: around(transform.position, 1) });
      }
      return grid.querySphere(center, radius);
    },
    transform: (entity) => world.get(entity, TransformComponent),
    snap: (position, clearance = 0) => terrain.snapToGround(position, clearance),
  };
}

function around(center: Vec3, radius: number): Aabb {
  return { min: vec3(center.x - radius, center.y - radius, center.z - radius), max: vec3(center.x + radius, center.y + radius, center.z + radius) };
}

function intersects(a: Aabb, b: Aabb): boolean {
  return a.min.x <= b.max.x && a.max.x >= b.min.x
    && a.min.y <= b.max.y && a.max.y >= b.min.y
    && a.min.z <= b.max.z && a.max.z >= b.min.z;
}

function closestPoint(point: Vec3, bounds: Aabb): Vec3 {
  return {
    x: Math.max(bounds.min.x, Math.min(bounds.max.x, point.x)),
    y: Math.max(bounds.min.y, Math.min(bounds.max.y, point.y)),
    z: Math.max(bounds.min.z, Math.min(bounds.max.z, point.z)),
  };
}
