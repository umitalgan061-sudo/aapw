import type { EntityId, Vec3 } from './types';

interface CellRecord { readonly id: EntityId; readonly position: Vec3; }

/** Deterministic spatial hash for nearby-entity queries without a scene-graph dependency. */
export class SpatialHash {
  #cellSize: number;
  #cells = new Map<string, Map<EntityId, CellRecord>>();
  #entityCell = new Map<EntityId, string>();

  constructor(cellSize = 4) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) throw new RangeError('cellSize must be positive');
    this.#cellSize = cellSize;
  }

  upsert(id: EntityId, position: Vec3): void {
    const nextKey = this.#key(position);
    const currentKey = this.#entityCell.get(id);
    if (currentKey && currentKey !== nextKey) {
      const oldCell = this.#cells.get(currentKey);
      oldCell?.delete(id);
      if (oldCell?.size === 0) this.#cells.delete(currentKey);
    }
    const cell = this.#cells.get(nextKey) ?? new Map<EntityId, CellRecord>();
    cell.set(id, { id, position: { ...position } });
    this.#cells.set(nextKey, cell);
    this.#entityCell.set(id, nextKey);
  }

  remove(id: EntityId): boolean {
    const key = this.#entityCell.get(id);
    if (!key) return false;
    const cell = this.#cells.get(key);
    const removed = cell?.delete(id) ?? false;
    if (cell?.size === 0) this.#cells.delete(key);
    this.#entityCell.delete(id);
    return removed;
  }

  query(center: Vec3, radius: number): readonly CellRecord[] {
    if (!Number.isFinite(radius) || radius < 0) throw new RangeError('radius must be non-negative');
    const cells = Math.ceil(radius / this.#cellSize);
    const centerCell = this.#coords(center);
    const radiusSquared = radius * radius;
    const hits: CellRecord[] = [];
    for (let z = -cells; z <= cells; z += 1) {
      for (let y = -cells; y <= cells; y += 1) {
        for (let x = -cells; x <= cells; x += 1) {
          const key = `${centerCell.x + x}:${centerCell.y + y}:${centerCell.z + z}`;
          for (const record of this.#cells.get(key)?.values() ?? []) {
            const dx = record.position.x - center.x;
            const dy = record.position.y - center.y;
            const dz = record.position.z - center.z;
            if (dx * dx + dy * dy + dz * dz <= radiusSquared) hits.push({ id: record.id, position: { ...record.position } });
          }
        }
      }
    }
    return hits.sort((a, b) => a.id.localeCompare(b.id));
  }

  count(): number {
    return this.#entityCell.size;
  }

  clear(): void {
    this.#cells.clear();
    this.#entityCell.clear();
  }

  #coords(position: Vec3): Vec3 {
    return { x: Math.floor(position.x / this.#cellSize), y: Math.floor(position.y / this.#cellSize), z: Math.floor(position.z / this.#cellSize) };
  }

  #key(position: Vec3): string {
    const cell = this.#coords(position);
    return `${cell.x}:${cell.y}:${cell.z}`;
  }
}
