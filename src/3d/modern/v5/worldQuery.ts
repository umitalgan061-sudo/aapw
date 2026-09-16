import { Aabb, EntityId, EntityRecord, Sphere, Vec3, distanceSq3, sub3, add3, scale3 } from './domain.ts';
import { EcsWorldV5 } from './ecs.ts';

export interface Ray3 {
  readonly origin: Vec3;
  readonly direction: Vec3;
  readonly maxDistance: number;
}

export interface RayHit {
  readonly entity: EntityId;
  readonly distance: number;
  readonly point: Vec3;
  readonly normal: Vec3;
}

export interface WorldBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface SpatialRecord {
  readonly id: EntityId;
  readonly sphere: Sphere;
  readonly bounds: Aabb;
}

const cellKey = (x: number, y: number, z: number): string => `${x}|${y}|${z}`;

export class SpatialIndexV5 {
  readonly #cells = new Map<string, Set<EntityId>>();
  readonly #records = new Map<EntityId, SpatialRecord>();
  readonly cellSize: number;

  constructor(cellSize = 32) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) throw new RangeError('cellSize must be positive');
    this.cellSize = cellSize;
  }

  upsert(record: SpatialRecord): void {
    this.remove(record.id);
    this.#records.set(record.id, record);
    for (const key of this.#coveredCells(record.bounds)) {
      const ids = this.#cells.get(key) ?? new Set<EntityId>();
      ids.add(record.id);
      this.#cells.set(key, ids);
    }
  }

  remove(id: EntityId): boolean {
    const record = this.#records.get(id);
    if (!record) return false;
    this.#records.delete(id);
    for (const key of this.#coveredCells(record.bounds)) {
      const ids = this.#cells.get(key);
      ids?.delete(id);
      if (ids && ids.size === 0) this.#cells.delete(key);
    }
    return true;
  }

  querySphere(sphere: Sphere): readonly EntityId[] {
    const candidates = new Set<EntityId>();
    const bounds = {
      min: sub3(sphere.center, { x: sphere.radius, y: sphere.radius, z: sphere.radius }),
      max: add3(sphere.center, { x: sphere.radius, y: sphere.radius, z: sphere.radius }),
    };
    for (const key of this.#coveredCells(bounds)) for (const id of this.#cells.get(key) ?? []) candidates.add(id);
    return [...candidates].filter((id) => {
      const record = this.#records.get(id);
      if (!record) return false;
      return distanceSq3(record.sphere.center, sphere.center) <= (record.sphere.radius + sphere.radius) ** 2;
    }).sort((a, b) => Number(a) - Number(b));
  }

  queryAabb(bounds: Aabb): readonly EntityId[] {
    const candidates = new Set<EntityId>();
    for (const key of this.#coveredCells(bounds)) for (const id of this.#cells.get(key) ?? []) candidates.add(id);
    return [...candidates].filter((id) => {
      const record = this.#records.get(id);
      return !!record && intersectsAabb(record.bounds, bounds);
    }).sort((a, b) => Number(a) - Number(b));
  }

  get(id: EntityId): SpatialRecord | undefined {
    return this.#records.get(id);
  }

  clear(): void {
    this.#cells.clear();
    this.#records.clear();
  }

  size(): number {
    return this.#records.size;
  }

  cellCount(): number {
    return this.#cells.size;
  }

  private #cellCoord(value: number): number {
    return Math.floor(value / this.cellSize);
  }

  private #coveredCells(bounds: Aabb): readonly string[] {
    const minX = this.#cellCoord(bounds.min.x);
    const minY = this.#cellCoord(bounds.min.y);
    const minZ = this.#cellCoord(bounds.min.z);
    const maxX = this.#cellCoord(bounds.max.x);
    const maxY = this.#cellCoord(bounds.max.y);
    const maxZ = this.#cellCoord(bounds.max.z);
    const keys: string[] = [];
    for (let x = minX; x <= maxX; x += 1) for (let y = minY; y <= maxY; y += 1) for (let z = minZ; z <= maxZ; z += 1) keys.push(cellKey(x, y, z));
    return keys;
  }
}

export const intersectsAabb = (a: Aabb, b: Aabb): boolean =>
  a.min.x <= b.max.x && a.max.x >= b.min.x && a.min.y <= b.max.y && a.max.y >= b.min.y && a.min.z <= b.max.z && a.max.z >= b.min.z;

export const pointInsideAabb = (point: Vec3, bounds: Aabb): boolean =>
  point.x >= bounds.min.x && point.x <= bounds.max.x && point.y >= bounds.min.y && point.y <= bounds.max.y && point.z >= bounds.min.z && point.z <= bounds.max.z;

export const raySphere = (ray: Ray3, sphere: Sphere): RayHit | null => {
  const offset = sub3(ray.origin, sphere.center);
  const a = ray.direction.x ** 2 + ray.direction.y ** 2 + ray.direction.z ** 2;
  if (a <= Number.EPSILON) return null;
  const b = 2 * (offset.x * ray.direction.x + offset.y * ray.direction.y + offset.z * ray.direction.z);
  const c = offset.x ** 2 + offset.y ** 2 + offset.z ** 2 - sphere.radius ** 2;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const sqrt = Math.sqrt(discriminant);
  const roots = [(-b - sqrt) / (2 * a), (-b + sqrt) / (2 * a)].filter((value) => value >= 0 && value <= ray.maxDistance);
  if (roots.length === 0) return null;
  const distance = Math.min(...roots);
  const point = add3(ray.origin, scale3(ray.direction, distance));
  const normal = sub3(point, sphere.center);
  const length = Math.hypot(normal.x, normal.y, normal.z) || 1;
  return { entity: 0 as EntityId, distance, point, normal: scale3(normal, 1 / length) };
};

export interface TerrainSample {
  readonly height: number;
  readonly normal: Vec3;
  readonly material: string;
}

export type TerrainSampler = (x: number, z: number) => TerrainSample;

export class WorldQueryV5 {
  constructor(private readonly world: EcsWorldV5, private readonly spatial: SpatialIndexV5, private readonly terrain: TerrainSampler) {}

  entitiesNear(center: Vec3, radius: number): readonly EntityRecord[] {
    return this.spatial.querySphere({ center, radius }).map((id) => this.world.get(id)).filter((entity): entity is EntityRecord => !!entity);
  }

  terrainAt(x: number, z: number): TerrainSample {
    const sample = this.terrain(x, z);
    if (!Number.isFinite(sample.height) || !Number.isFinite(sample.normal.x) || !Number.isFinite(sample.normal.y) || !Number.isFinite(sample.normal.z)) {
      return { height: 0, normal: { x: 0, y: 1, z: 0 }, material: 'unknown' };
    }
    return sample;
  }

  groundedPosition(position: Vec3, clearance = 0): Vec3 {
    const sample = this.terrainAt(position.x, position.z);
    return { x: position.x, y: sample.height + Math.max(0, clearance), z: position.z };
  }

  lineOfSight(from: Vec3, to: Vec3, blockTest: (ray: Ray3) => boolean): boolean {
    const direction = sub3(to, from);
    const distance = Math.hypot(direction.x, direction.y, direction.z);
    if (distance <= Number.EPSILON) return true;
    const normalized = scale3(direction, 1 / distance);
    return !blockTest({ origin: from, direction: normalized, maxDistance: distance });
  }

  nearestEntity(center: Vec3, radius: number, predicate?: (entity: EntityRecord) => boolean): EntityRecord | undefined {
    const entities = this.entitiesNear(center, radius).filter((entity) => !predicate || predicate(entity));
    entities.sort((a, b) => {
      const aTransform = a.components.get('transform');
      const bTransform = b.components.get('transform');
      if (aTransform?.kind !== 'transform' || bTransform?.kind !== 'transform') return Number(a.id) - Number(b.id);
      return distanceSq3(aTransform.position, center) - distanceSq3(bTransform.position, center);
    });
    return entities[0];
  }
}

export const sphereForPosition = (position: Vec3, radius: number): Sphere => ({ center: position, radius: Math.max(0, radius) });
export const aabbFromSphere = (sphere: Sphere): Aabb => ({ min: sub3(sphere.center, { x: sphere.radius, y: sphere.radius, z: sphere.radius }), max: add3(sphere.center, { x: sphere.radius, y: sphere.radius, z: sphere.radius }) });
export const worldBounds = (min: Vec3, max: Vec3): WorldBounds => ({ minX: min.x, minY: min.y, minZ: min.z, maxX: max.x, maxY: max.y, maxZ: max.z });
