import { distanceSqR29, type R29Bounds, type R29EntityRecord, type R29Vector3 } from './contracts.ts';
import type { R29WorldRuntime } from './worldRuntime.ts';

export interface R29WorldQueryOptions {
  readonly maxResults?: number;
  readonly includeInactive?: boolean;
}

export interface R29Ray {
  readonly origin: R29Vector3;
  readonly direction: R29Vector3;
  readonly maxDistance: number;
}

export interface R29RayHit {
  readonly entityId: number;
  readonly distance: number;
  readonly position: R29Vector3;
}

export class R29WorldQuery {
  readonly world: R29WorldRuntime;

  constructor(world: R29WorldRuntime) {
    this.world = world;
  }

  nearest(center: R29Vector3, radiusMeters: number, options: R29WorldQueryOptions = {}): readonly R29EntityRecord[] {
    const maxResults = Math.max(1, Math.floor(options.maxResults ?? 32));
    const includeInactive = options.includeInactive ?? false;
    const radiusSq = Math.max(0, radiusMeters) ** 2;
    const entities = this.world.snapshot().entities
      .filter((entity) => includeInactive || entity.transform.active)
      .filter((entity) => distanceSqR29(entity.transform.position, center) <= radiusSq)
      .sort((a, b) =>
        distanceSqR29(a.transform.position, center) - distanceSqR29(b.transform.position, center) ||
        b.importance - a.importance ||
        a.id - b.id,
      )
      .slice(0, maxResults);
    return Object.freeze(entities);
  }

  withinBounds(bounds: R29Bounds, options: R29WorldQueryOptions = {}): readonly R29EntityRecord[] {
    const maxResults = Math.max(1, Math.floor(options.maxResults ?? 128));
    const includeInactive = options.includeInactive ?? false;
    return Object.freeze(
      this.world.snapshot().entities
        .filter((entity) => includeInactive || entity.transform.active)
        .filter((entity) => {
          const point = entity.transform.position;
          return point.x >= bounds.minX && point.x <= bounds.maxX &&
            point.y >= bounds.minY && point.y <= bounds.maxY &&
            point.z >= bounds.minZ && point.z <= bounds.maxZ;
        })
        .sort((a, b) => a.id - b.id)
        .slice(0, maxResults),
    );
  }

  raycast(ray: R29Ray, options: { readonly maxResults?: number; readonly radiusMeters?: number } = {}): readonly R29RayHit[] {
    const maxResults = Math.max(1, Math.floor(options.maxResults ?? 16));
    const radius = Math.max(0.25, options.radiusMeters ?? 1);
    const direction = normalize(ray.direction);
    const maxDistance = Math.max(0, ray.maxDistance);
    const hits: R29RayHit[] = [];
    for (const entity of this.world.snapshot().entities) {
      if (!entity.transform.active) continue;
      const offset = {
        x: entity.transform.position.x - ray.origin.x,
        y: entity.transform.position.y - ray.origin.y,
        z: entity.transform.position.z - ray.origin.z,
      };
      const projection = offset.x * direction.x + offset.y * direction.y + offset.z * direction.z;
      if (projection < 0 || projection > maxDistance) continue;
      const closest = {
        x: ray.origin.x + direction.x * projection,
        y: ray.origin.y + direction.y * projection,
        z: ray.origin.z + direction.z * projection,
      };
      if (distanceSqR29(entity.transform.position, closest) <= radius * radius) {
        hits.push(Object.freeze({
          entityId: entity.id,
          distance: projection,
          position: Object.freeze({ ...entity.transform.position }),
        }));
      }
    }
    hits.sort((a, b) => a.distance - b.distance || a.entityId - b.entityId);
    return Object.freeze(hits.slice(0, maxResults));
  }

  snapshotDigest(): string {
    const entities = this.world.snapshot().entities
      .map((entity) => [entity.id, entity.transform.position, entity.transform.revision])
      .sort((a, b) => Number(a[0]) - Number(b[0]));
    return JSON.stringify(entities);
  }
}

function normalize(value: R29Vector3): R29Vector3 {
  const length = Math.hypot(value.x, value.y, value.z);
  if (length < 1e-9) return { x: 0, y: 0, z: 1 };
  return { x: value.x / length, y: value.y / length, z: value.z / length };
}
