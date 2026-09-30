import {
  type EntityIdV4,
  type Vec3V4,
  type BoundsV4,
  entityIdV4,
  vec3V4,
  distanceSquaredV4,
} from './runtimeContractsV4';

export interface SpatialItemV4 {
  readonly entity: EntityIdV4;
  position: Vec3V4;
  radius: number;
  layer: number;
  flags: number;
}

export interface SpatialCellV4 {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly count: number;
}

export interface SpatialQueryV4 {
  readonly center: Vec3V4;
  readonly radius: number;
  readonly maxResults?: number;
  readonly layerMask?: number;
  readonly sort?: 'distance' | 'entity' | 'none';
}

export interface SpatialHitV4 {
  readonly entity: EntityIdV4;
  readonly position: Vec3V4;
  readonly distance: number;
  readonly layer: number;
  readonly flags: number;
}

export interface SpatialMetricsV4 {
  readonly items: number;
  readonly cells: number;
  readonly inserts: number;
  readonly updates: number;
  readonly removes: number;
  readonly queries: number;
  readonly candidates: number;
  readonly hits: number;
}

const keyOf = (x: number, y: number, z: number): string => `${x},${y},${z}`;
const cellCoordinate = (value: number, size: number): number => Math.floor(value / size);
const finite = (value: number, fallback: number): number => Number.isFinite(value) ? value : fallback;
const positive = (value: number, fallback: number): number => Math.max(0.001, finite(value, fallback));

export class SpatialIndexV4 {
  readonly cellSize: number;
  #cells = new Map<string, Set<EntityIdV4>>();
  #items = new Map<EntityIdV4, SpatialItemV4>();
  #itemCell = new Map<EntityIdV4, string>();
  #metrics = { inserts: 0, updates: 0, removes: 0, queries: 0, candidates: 0, hits: 0 };

  constructor(cellSize = 32) {
    this.cellSize = positive(cellSize, 32);
  }

  cellOf(position: Vec3V4): SpatialCellV4 {
    const x = cellCoordinate(position.x, this.cellSize);
    const y = cellCoordinate(position.y, this.cellSize);
    const z = cellCoordinate(position.z, this.cellSize);
    const key = keyOf(x, y, z);
    return Object.freeze({ key, x, y, z, count: this.#cells.get(key)?.size ?? 0 });
  }

  has(entity: EntityIdV4): boolean {
    return this.#items.has(entity);
  }

  upsert(item: SpatialItemV4): boolean {
    const entity = item.entity;
    const position = vec3V4(item.position.x, item.position.y, item.position.z);
    const normalized: SpatialItemV4 = {
      entity,
      position,
      radius: positive(item.radius, 0.5),
      layer: Math.max(0, Math.trunc(item.layer)),
      flags: Math.max(0, Math.trunc(item.flags)),
    };
    const old = this.#items.get(entity);
    const newKey = this.cellOf(position).key;
    if (old) {
      this.#items.set(entity, normalized);
      const oldKey = this.#itemCell.get(entity);
      if (oldKey !== newKey) {
        this.#removeFromCell(entity, oldKey);
        this.#addToCell(entity, newKey);
        this.#itemCell.set(entity, newKey);
      }
      this.#metrics.updates += 1;
      return false;
    }
    this.#items.set(entity, normalized);
    this.#addToCell(entity, newKey);
    this.#itemCell.set(entity, newKey);
    this.#metrics.inserts += 1;
    return true;
  }

  remove(entity: EntityIdV4): boolean {
    if (!this.#items.delete(entity)) return false;
    const key = this.#itemCell.get(entity);
    this.#removeFromCell(entity, key);
    this.#itemCell.delete(entity);
    this.#metrics.removes += 1;
    return true;
  }

  get(entity: EntityIdV4): SpatialItemV4 | undefined {
    const item = this.#items.get(entity);
    return item ? { ...item, position: vec3V4(item.position.x, item.position.y, item.position.z) } : undefined;
  }

  query(query: SpatialQueryV4): readonly SpatialHitV4[] {
    this.#metrics.queries += 1;
    const center = vec3V4(query.center.x, query.center.y, query.center.z);
    const radius = Math.max(0, finite(query.radius, 0));
    const maxResults = query.maxResults === undefined ? Number.POSITIVE_INFINITY : Math.max(0, Math.trunc(query.maxResults));
    const mask = query.layerMask === undefined ? 0xffff_ffff : Math.max(0, Math.trunc(query.layerMask));
    const minX = cellCoordinate(center.x - radius, this.cellSize);
    const maxX = cellCoordinate(center.x + radius, this.cellSize);
    const minY = cellCoordinate(center.y - radius, this.cellSize);
    const maxY = cellCoordinate(center.y + radius, this.cellSize);
    const minZ = cellCoordinate(center.z - radius, this.cellSize);
    const maxZ = cellCoordinate(center.z + radius, this.cellSize);
    const results: SpatialHitV4[] = [];
    const radiusWithZero = radius + 0.001;
    const radiusSq = radiusWithZero * radiusWithZero;
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        for (let z = minZ; z <= maxZ; z += 1) {
          const ids = this.#cells.get(keyOf(x, y, z));
          if (!ids) continue;
          this.#metrics.candidates += ids.size;
          for (const entity of ids) {
            const item = this.#items.get(entity);
            if (!item) continue;
            if ((mask & (1 << Math.min(30, item.layer))) === 0) continue;
            const effectiveRadius = radius + item.radius;
            const distanceSq = distanceSquaredV4(center, item.position);
            if (distanceSq > Math.max(radiusSq, effectiveRadius * effectiveRadius)) continue;
            results.push({ entity, position: item.position, distance: Math.sqrt(distanceSq), layer: item.layer, flags: item.flags });
          }
        }
      }
    }
    if (query.sort === 'distance' || query.sort === undefined) results.sort((a, b) => a.distance - b.distance || a.entity - b.entity);
    if (query.sort === 'entity') results.sort((a, b) => a.entity - b.entity);
    const selected = maxResults >= results.length ? results : results.slice(0, maxResults);
    this.#metrics.hits += selected.length;
    return Object.freeze(selected);
  }

  queryBounds(bounds: BoundsV4, maxResults = Number.POSITIVE_INFINITY): readonly EntityIdV4[] {
    const center = vec3V4((bounds.min.x + bounds.max.x) * 0.5, (bounds.min.y + bounds.max.y) * 0.5, (bounds.min.z + bounds.max.z) * 0.5);
    const half = vec3V4((bounds.max.x - bounds.min.x) * 0.5, (bounds.max.y - bounds.min.y) * 0.5, (bounds.max.z - bounds.min.z) * 0.5);
    const radius = Math.hypot(half.x, half.y, half.z);
    const hits = this.query({ center, radius, maxResults, sort: 'entity' });
    return Object.freeze(hits.filter((hit) => hit.position.x >= bounds.min.x && hit.position.x <= bounds.max.x && hit.position.y >= bounds.min.y && hit.position.y <= bounds.max.y && hit.position.z >= bounds.min.z && hit.position.z <= bounds.max.z).map((hit) => hit.entity));
  }

  nearest(center: Vec3V4, maxDistance: number, count = 1): readonly SpatialHitV4[] {
    return this.query({ center, radius: maxDistance, maxResults: count, sort: 'distance' });
  }

  cells(): readonly SpatialCellV4[] {
    const result: SpatialCellV4[] = [];
    for (const [key, ids] of this.#cells) {
      const [xText, yText, zText] = key.split(',');
      result.push(Object.freeze({ key, x: Number(xText), y: Number(yText), z: Number(zText), count: ids.size }));
    }
    result.sort((a, b) => a.key.localeCompare(b.key));
    return Object.freeze(result);
  }

  metrics(): SpatialMetricsV4 {
    return Object.freeze({ items: this.#items.size, cells: this.#cells.size, ...this.#metrics });
  }

  clear(): void {
    this.#cells.clear();
    this.#items.clear();
    this.#itemCell.clear();
  }

  #addToCell(entity: EntityIdV4, key: string): void {
    let set = this.#cells.get(key);
    if (!set) {
      set = new Set<EntityIdV4>();
      this.#cells.set(key, set);
    }
    set.add(entity);
  }

  #removeFromCell(entity: EntityIdV4, key: string | undefined): void {
    if (!key) return;
    const set = this.#cells.get(key);
    if (!set) return;
    set.delete(entity);
    if (set.size === 0) this.#cells.delete(key);
  }
}

export function buildSpatialItemV4(entity: number, x: number, y: number, z: number, radius = 0.5, layer = 0, flags = 0): SpatialItemV4 {
  return { entity: entityIdV4(Math.trunc(entity)), position: vec3V4(x, y, z), radius, layer, flags };
}
