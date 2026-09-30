import type { Aabb, EntityId, Ray, Sphere, Vec3 } from './contracts.ts';
import { UniformGridBroadphase, aabbIntersects, distanceSquared, raycastAabb, sphereIntersectsAabb } from './physics.ts';

export interface WorldQueryEntity {
  readonly entity: EntityId;
  readonly bounds: Aabb;
  readonly position: Vec3;
  readonly tags: readonly string[];
  readonly layer: number;
  readonly enabled: boolean;
}

export interface RadiusQueryOptions {
  readonly radius: number;
  readonly layers?: number;
  readonly tagsAny?: readonly string[];
  readonly tagsAll?: readonly string[];
  readonly limit?: number;
}

export interface NearestResult {
  readonly entity: EntityId;
  readonly distance: number;
  readonly position: Vec3;
}

export class WorldQueryIndex {
  readonly broadphase: UniformGridBroadphase;
  #entities = new Map<EntityId, WorldQueryEntity>();

  constructor(cellSize = 8) {
    this.broadphase = new UniformGridBroadphase(cellSize);
  }

  upsert(entity: WorldQueryEntity): void {
    this.#entities.set(entity.entity, entity);
    this.broadphase.upsert({
      entity: entity.entity,
      bounds: entity.bounds,
      layer: entity.layer,
      enabled: entity.enabled,
    });
  }

  remove(entity: EntityId): boolean {
    this.broadphase.remove(entity);
    return this.#entities.delete(entity);
  }

  radius(center: Vec3, options: RadiusQueryOptions): readonly WorldQueryEntity[] {
    const sphere: Sphere = { center, radius: Math.max(0, options.radius) };
    const tagsAny = new Set(options.tagsAny ?? []);
    const tagsAll = new Set(options.tagsAll ?? []);
    return this.broadphase.querySphere(sphere, options.layers ?? 0xffff_ffff)
      .map((entry) => this.#entities.get(entry.entity))
      .filter((entity): entity is WorldQueryEntity => Boolean(entity))
      .filter((entity) => {
        const anyMatch = tagsAny.size === 0 || entity.tags.some((tag) => tagsAny.has(tag));
        const allMatch = [...tagsAll].every((tag) => entity.tags.includes(tag));
        return anyMatch && allMatch;
      })
      .sort((a, b) =>
        distanceSquared(a.position, center) - distanceSquared(b.position, center) ||
        Number(a.entity) - Number(b.entity),
      )
      .slice(0, Math.max(1, Math.floor(options.limit ?? 1024)));
  }

  nearest(center: Vec3, limit = 8, predicate?: (entity: WorldQueryEntity) => boolean): readonly NearestResult[] {
    return [...this.#entities.values()]
      .filter((entity) => entity.enabled)
      .filter((entity) => predicate ? predicate(entity) : true)
      .map((entity) => ({
        entity: entity.entity,
        distance: Math.sqrt(distanceSquared(entity.position, center)),
        position: entity.position,
      }))
      .sort((a, b) => a.distance - b.distance || Number(a.entity) - Number(b.entity))
      .slice(0, Math.max(0, Math.floor(limit)));
  }

  raycast(ray: Ray, layers = 0xffff_ffff, predicate?: (entity: WorldQueryEntity) => boolean): readonly NearestResult[] {
    return this.broadphase.raycast(ray, layers)
      .map((hit) => {
        const entity = this.#entities.get(hit.entity);
        if (!entity || (predicate && !predicate(entity))) return null;
        return { entity: hit.entity, distance: hit.distance, position: entity.position };
      })
      .filter((value): value is NearestResult => Boolean(value));
  }

  overlapAabb(bounds: Aabb, predicate?: (entity: WorldQueryEntity) => boolean): readonly WorldQueryEntity[] {
    return this.broadphase.queryAabb(bounds)
      .map((entry) => this.#entities.get(entry.entity))
      .filter((entity): entity is WorldQueryEntity => Boolean(entity))
      .filter((entity) => aabbIntersects(entity.bounds, bounds))
      .filter((entity) => predicate ? predicate(entity) : true)
      .sort((a, b) => Number(a.entity) - Number(b.entity));
  }

  lineOfSight(
    origin: Vec3,
    target: Vec3,
    blockingLayers = 0xffff_ffff,
    ignored?: EntityId,
  ): boolean {
    const direction = {
      x: target.x - origin.x,
      y: target.y - origin.y,
      z: target.z - origin.z,
    };
    const maxDistance = Math.hypot(direction.x, direction.y, direction.z);
    if (maxDistance <= 1e-9) return true;
    const hits = this.raycast({ origin, direction, maxDistance }, blockingLayers, (entity) => entity.entity !== ignored);
    return hits.length === 0;
  }

  count(): number {
    return this.#entities.size;
  }

  snapshot(): readonly WorldQueryEntity[] {
    return [...this.#entities.values()]
      .sort((a, b) => Number(a.entity) - Number(b.entity))
      .map((entity) => structuredClone(entity));
  }
}

export function isPointObstructed(point: Vec3, radius: number, obstacles: readonly Aabb[]): boolean {
  const sphere: Sphere = { center: point, radius: Math.max(0, radius) };
  return obstacles.some((obstacle) => sphereIntersectsAabb(sphere, obstacle));
}

export function firstRayHit(ray: Ray, obstacles: readonly { readonly entity: EntityId; readonly bounds: Aabb }[]): { readonly entity: EntityId; readonly distance: number } | null {
  const hits = obstacles
    .map((obstacle) => {
      const distance = raycastAabb(ray, obstacle.bounds);
      return distance === null ? null : { entity: obstacle.entity, distance };
    })
    .filter((hit): hit is { readonly entity: EntityId; readonly distance: number } => Boolean(hit))
    .sort((a, b) => a.distance - b.distance || Number(a.entity) - Number(b.entity));
  return hits[0] ?? null;
}
