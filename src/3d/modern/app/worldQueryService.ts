export interface WorldPoint { readonly x: number; readonly y: number; readonly z: number; }
export interface WorldEntity { readonly id: string; readonly position: WorldPoint; readonly radius: number; readonly tags: readonly string[]; readonly active: boolean; readonly layer: number; }
export interface RayQuery { readonly origin: WorldPoint; readonly direction: WorldPoint; readonly maxDistance: number; readonly layer?: number; readonly tag?: string; }
export interface SphereQuery { readonly center: WorldPoint; readonly radius: number; readonly layer?: number; readonly tag?: string; readonly limit?: number; }
export interface WorldHit { readonly id: string; readonly distance: number; readonly point: WorldPoint; readonly normal: WorldPoint; }

const length = (value: WorldPoint): number => Math.hypot(value.x, value.y, value.z);
const normalize = (value: WorldPoint): WorldPoint => { const size = length(value); return size <= 1e-9 ? Object.freeze({ x: 0, y: 0, z: 1 }) : Object.freeze({ x: value.x / size, y: value.y / size, z: value.z / size }); };
const subtract = (a: WorldPoint, b: WorldPoint): WorldPoint => Object.freeze({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a: WorldPoint, b: WorldPoint): WorldPoint => Object.freeze({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (a: WorldPoint, factor: number): WorldPoint => Object.freeze({ x: a.x * factor, y: a.y * factor, z: a.z * factor });
const dot = (a: WorldPoint, b: WorldPoint): number => a.x * b.x + a.y * b.y + a.z * b.z;

export class WorldQueryService {
  readonly #entities = new Map<string, WorldEntity>();
  #revision = 0;

  upsert(entity: WorldEntity): WorldEntity {
    const normalized = Object.freeze({ ...entity, radius: Math.max(0, entity.radius), layer: Math.floor(entity.layer), tags: Object.freeze([...new Set(entity.tags)]) });
    this.#entities.set(entity.id, normalized);
    this.#revision += 1;
    return normalized;
  }
  remove(id: string): boolean { const removed = this.#entities.delete(id); if (removed) this.#revision += 1; return removed; }
  clear(): void { if (this.#entities.size) this.#revision += 1; this.#entities.clear(); }
  size(): number { return this.#entities.size; }
  revision(): number { return this.#revision; }
  get(id: string): WorldEntity | undefined { return this.#entities.get(id); }

  sphere(query: SphereQuery): readonly WorldEntity[] {
    const radius = Math.max(0, query.radius);
    const radiusSq = radius * radius;
    const result: Array<{ entity: WorldEntity; distanceSq: number }> = [];
    for (const entity of this.#entities.values()) {
      if (!entity.active) continue;
      if (query.layer !== undefined && entity.layer !== query.layer) continue;
      if (query.tag && !entity.tags.includes(query.tag)) continue;
      const dx = entity.position.x - query.center.x;
      const dy = entity.position.y - query.center.y;
      const dz = entity.position.z - query.center.z;
      const range = radius + entity.radius;
      const distanceSq = dx * dx + dy * dy + dz * dz;
      if (distanceSq <= range * range && distanceSq <= radiusSq + entity.radius * entity.radius + range * entity.radius) result.push({ entity, distanceSq });
    }
    result.sort((a, b) => a.distanceSq - b.distanceSq || a.entity.id.localeCompare(b.entity.id));
    const limit = Math.max(0, Math.floor(query.limit ?? result.length));
    return Object.freeze(result.slice(0, limit).map((entry) => entry.entity));
  }

  ray(query: RayQuery): readonly WorldHit[] {
    const direction = normalize(query.direction);
    const maxDistance = Math.max(0, query.maxDistance);
    const hits: WorldHit[] = [];
    for (const entity of this.#entities.values()) {
      if (!entity.active) continue;
      if (query.layer !== undefined && entity.layer !== query.layer) continue;
      if (query.tag && !entity.tags.includes(query.tag)) continue;
      const toCenter = subtract(entity.position, query.origin);
      const projection = dot(toCenter, direction);
      if (projection < 0 || projection > maxDistance) continue;
      const closest = add(query.origin, scale(direction, projection));
      const offset = subtract(entity.position, closest);
      const radial = length(offset);
      if (radial > entity.radius) continue;
      const normal = normalize(offset);
      hits.push(Object.freeze({ id: entity.id, distance: Math.max(0, projection - Math.sqrt(Math.max(0, entity.radius * entity.radius - radial * radial))), point: subtract(closest, scale(normal, Math.min(entity.radius, radial))), normal }));
    }
    hits.sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
    return Object.freeze(hits);
  }

  nearest(point: WorldPoint, maxDistance = Infinity, tag?: string): WorldEntity | undefined { return this.sphere({ center: point, radius: maxDistance, tag, limit: 1 })[0]; }

  snapshot(): readonly WorldEntity[] { return Object.freeze([...this.#entities.values()].sort((a, b) => a.id.localeCompare(b.id))); }
}
