import { AabbV7, EntityIdV7, SpatialEntityV7, SpatialQueryResultV7, SpatialQueryV7, SphereV7, Vec3V7, distanceSquaredV7 } from './types.ts';

interface Cell { readonly ids: Set<EntityIdV7>; }
const keyOf = (x: number, z: number): string => `${x}:${z}`;
const normalizeBounds = (bounds: AabbV7): AabbV7 => ({
  min: { x: Math.min(bounds.min.x, bounds.max.x), y: Math.min(bounds.min.y, bounds.max.y), z: Math.min(bounds.min.z, bounds.max.z) },
  max: { x: Math.max(bounds.min.x, bounds.max.x), y: Math.max(bounds.min.y, bounds.max.y), z: Math.max(bounds.min.z, bounds.max.z) },
});
const overlapAabb = (a: AabbV7, b: AabbV7): boolean =>
  a.min.x <= b.max.x && a.max.x >= b.min.x &&
  a.min.y <= b.max.y && a.max.y >= b.min.y &&
  a.min.z <= b.max.z && a.max.z >= b.min.z;
const sphereAabb = (sphere: SphereV7): AabbV7 => ({
  min: { x: sphere.center.x - sphere.radius, y: sphere.center.y - sphere.radius, z: sphere.center.z - sphere.radius },
  max: { x: sphere.center.x + sphere.radius, y: sphere.center.y + sphere.radius, z: sphere.center.z + sphere.radius },
});

export interface SpatialIndexStatsV7 {
  readonly entities: number;
  readonly cells: number;
  readonly averageOccupancy: number;
  readonly maxOccupancy: number;
}

export class SpatialIndexV7 {
  readonly #cellMeters: number;
  readonly #cells = new Map<string, Cell>();
  readonly #entities = new Map<EntityIdV7, SpatialEntityV7>();
  readonly #entityCells = new Map<EntityIdV7, readonly string[]>();

  constructor(cellMeters = 32) {
    if (!Number.isFinite(cellMeters) || cellMeters <= 0) throw new RangeError('cellMeters must be positive');
    this.#cellMeters = cellMeters;
  }

  upsert(entity: SpatialEntityV7): void {
    this.remove(entity.id);
    const bounds = normalizeBounds(entity.bounds);
    const normalized = Object.freeze({ ...entity, bounds });
    const cells = this.#cellsForBounds(bounds);
    this.#entities.set(entity.id, normalized);
    this.#entityCells.set(entity.id, Object.freeze(cells));
    for (const key of cells) {
      let cell = this.#cells.get(key);
      if (!cell) { cell = { ids: new Set() }; this.#cells.set(key, cell); }
      cell.ids.add(entity.id);
    }
  }

  remove(id: EntityIdV7): boolean {
    const cells = this.#entityCells.get(id);
    if (!cells) return false;
    for (const key of cells) {
      const cell = this.#cells.get(key);
      if (!cell) continue;
      cell.ids.delete(id);
      if (cell.ids.size === 0) this.#cells.delete(key);
    }
    this.#entityCells.delete(id);
    return this.#entities.delete(id);
  }

  get(id: EntityIdV7): SpatialEntityV7 | undefined { return this.#entities.get(id); }

  query(query: SpatialQueryV7): readonly SpatialQueryResultV7[] {
    const filterBounds = query.bounds ?? (query.sphere ? sphereAabb(query.sphere) : undefined);
    const candidateIds = new Set<EntityIdV7>();
    if (filterBounds) for (const key of this.#cellsForBounds(filterBounds)) for (const id of this.#cells.get(key)?.ids ?? []) candidateIds.add(id);
    else for (const id of this.#entities.keys()) candidateIds.add(id);

    const results: SpatialQueryResultV7[] = [];
    for (const id of candidateIds) {
      const entity = this.#entities.get(id);
      if (!entity || !entity.active || (query.layer !== undefined && entity.layer !== query.layer)) continue;
      if (query.bounds && !overlapAabb(entity.bounds, query.bounds)) continue;
      if (query.sphere) {
        const point = {
          x: Math.max(entity.bounds.min.x, Math.min(query.sphere.center.x, entity.bounds.max.x)),
          y: Math.max(entity.bounds.min.y, Math.min(query.sphere.center.y, entity.bounds.max.y)),
          z: Math.max(entity.bounds.min.z, Math.min(query.sphere.center.z, entity.bounds.max.z)),
        };
        if (distanceSquaredV7(point, query.sphere.center) > query.sphere.radius * query.sphere.radius) continue;
      }
      const distanceSquared = query.sortByDistanceTo ? distanceSquaredV7(query.sortByDistanceTo, {
        x: (entity.bounds.min.x + entity.bounds.max.x) / 2,
        y: (entity.bounds.min.y + entity.bounds.max.y) / 2,
        z: (entity.bounds.min.z + entity.bounds.max.z) / 2,
      }) : 0;
      results.push(Object.freeze({ id, distanceSquared, cellKey: this.#entityCells.get(id)?.[0] ?? '' }));
    }
    results.sort((a, b) => a.distanceSquared - b.distanceSquared || Number(a.id) - Number(b.id));
    const limit = Math.max(0, Math.min(results.length, Math.trunc(query.limit ?? results.length)));
    return Object.freeze(results.slice(0, limit));
  }

  nearest(point: Vec3V7, radius: number, limit = 8, layer?: number): readonly SpatialQueryResultV7[] {
    return this.query({ sphere: { center: point, radius: Math.max(0, radius) }, sortByDistanceTo: point, limit, layer });
  }

  stats(): SpatialIndexStatsV7 {
    let total = 0; let max = 0;
    for (const cell of this.#cells.values()) { total += cell.ids.size; max = Math.max(max, cell.ids.size); }
    return Object.freeze({ entities: this.#entities.size, cells: this.#cells.size, averageOccupancy: this.#cells.size ? total / this.#cells.size : 0, maxOccupancy: max });
  }

  snapshot(): readonly SpatialEntityV7[] {
    return Object.freeze([...this.#entities.values()].sort((a, b) => Number(a.id) - Number(b.id)));
  }

  #cellsForBounds(bounds: AabbV7): string[] {
    const minX = Math.floor(bounds.min.x / this.#cellMeters);
    const maxX = Math.floor(bounds.max.x / this.#cellMeters);
    const minZ = Math.floor(bounds.min.z / this.#cellMeters);
    const maxZ = Math.floor(bounds.max.z / this.#cellMeters);
    const keys: string[] = [];
    for (let z = minZ; z <= maxZ; z += 1) for (let x = minX; x <= maxX; x += 1) keys.push(keyOf(x, z));
    return keys;
  }
}
