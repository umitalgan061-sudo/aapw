import type { EntityRecord, Vec3 } from './types.ts';
import { distanceXZ, finite, lengthXZ } from './math.ts';

export interface SpatialIndexConfig {
  readonly cellSizeMeters: number;
  readonly maxResults: number;
}

const DEFAULT_CONFIG: SpatialIndexConfig = Object.freeze({
  cellSizeMeters: 64,
  maxResults: 256,
});

export interface SpatialQuery {
  readonly center: Vec3;
  readonly radiusMeters: number;
  readonly kinds?: readonly EntityRecord['kind'][];
  readonly limit?: number;
}

export class SpatialIndexR37 {
  readonly config: SpatialIndexConfig;
  #cells = new Map<string, Set<string>>();
  #positions = new Map<string, Vec3>();

  constructor(config: Partial<SpatialIndexConfig> = {}) {
    this.config = Object.freeze({
      ...DEFAULT_CONFIG,
      ...config,
      cellSizeMeters: Math.max(1, finite(config.cellSizeMeters, DEFAULT_CONFIG.cellSizeMeters)),
      maxResults: Math.max(1, Math.trunc(finite(config.maxResults, DEFAULT_CONFIG.maxResults))),
    });
  }

  upsert(id: string, position: Vec3): void {
    const normalized = { x: finite(position.x), y: finite(position.y), z: finite(position.z) };
    const previous = this.#positions.get(id);
    if (previous) this.#unlink(id, previous);
    this.#positions.set(id, Object.freeze(normalized));
    const key = this.#key(normalized);
    const bucket = this.#cells.get(key) ?? new Set<string>();
    bucket.add(id);
    this.#cells.set(key, bucket);
  }

  remove(id: string): void {
    const position = this.#positions.get(id);
    if (position) this.#unlink(id, position);
    this.#positions.delete(id);
  }

  query(request: SpatialQuery, getEntity?: (id: string) => EntityRecord | undefined): readonly EntityRecord['id'][] {
    const radius = Math.max(0, finite(request.radiusMeters));
    const center = request.center;
    const minX = Math.floor((center.x - radius) / this.config.cellSizeMeters);
    const maxX = Math.floor((center.x + radius) / this.config.cellSizeMeters);
    const minZ = Math.floor((center.z - radius) / this.config.cellSizeMeters);
    const maxZ = Math.floor((center.z + radius) / this.config.cellSizeMeters);
    const kindSet = request.kinds ? new Set(request.kinds) : null;
    const limit = Math.min(this.config.maxResults, Math.max(1, Math.trunc(request.limit ?? this.config.maxResults)));
    const matches: Array<{ id: string; distance: number }> = [];
    for (let x = minX; x <= maxX; x += 1) {
      for (let z = minZ; z <= maxZ; z += 1) {
        const bucket = this.#cells.get(`${x},${z}`);
        if (!bucket) continue;
        for (const id of bucket) {
          const position = this.#positions.get(id);
          if (!position || distanceXZ(position, center) > radius) continue;
          if (getEntity) {
            const entity = getEntity(id);
            if (!entity || (kindSet && !kindSet.has(entity.kind))) continue;
          }
          matches.push({ id, distance: distanceXZ(position, center) });
        }
      }
    }
    matches.sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
    return Object.freeze(matches.slice(0, limit).map((match) => match.id));
  }

  nearest(center: Vec3, radiusMeters: number, limit = 1): readonly string[] {
    return this.query({ center, radiusMeters, limit });
  }

  density(center: Vec3, radiusMeters: number): number {
    const ids = this.query({ center, radiusMeters, limit: this.config.maxResults });
    const area = Math.PI * Math.max(1, radiusMeters) ** 2;
    return ids.length / area;
  }

  clear(): void {
    this.#cells.clear();
    this.#positions.clear();
  }

  size(): number {
    return this.#positions.size;
  }

  #key(position: Vec3): string {
    return `${Math.floor(position.x / this.config.cellSizeMeters)},${Math.floor(position.z / this.config.cellSizeMeters)}`;
  }

  #unlink(id: string, position: Vec3): void {
    const key = this.#key(position);
    const bucket = this.#cells.get(key);
    if (!bucket) return;
    bucket.delete(id);
    if (bucket.size === 0) this.#cells.delete(key);
  }
}

export function selectByDistance<T extends { readonly id: string; readonly position: Vec3 }>(
  values: readonly T[],
  center: Vec3,
  radiusMeters: number,
  limit: number,
): readonly T[] {
  const radius = Math.max(0, finite(radiusMeters));
  return Object.freeze(
    values
      .map((value) => ({ value, distance: distanceXZ(value.position, center) }))
      .filter((entry) => entry.distance <= radius)
      .sort((a, b) => a.distance - b.distance || a.value.id.localeCompare(b.value.id))
      .slice(0, Math.max(0, Math.trunc(limit)))
      .map((entry) => entry.value),
  );
}
