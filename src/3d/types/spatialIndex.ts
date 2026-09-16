import type { NodeId, Vec3 } from './platform.js';

export interface SpatialItem {
  readonly id: NodeId;
  readonly position: Vec3;
  readonly radius: number;
  readonly layer: number;
  readonly tags: readonly string[];
}

export interface SpatialQuery {
  readonly center: Vec3;
  readonly radius: number;
  readonly layer?: number;
  readonly tag?: string;
  readonly limit?: number;
}

export interface SpatialCellKey { readonly x: number; readonly y: number; readonly z: number; }
export interface SpatialStats { readonly itemCount: number; readonly occupiedCells: number; readonly queryCount: number; readonly averageCandidates: number; }

const cellCoord = (value: number, cellSize: number): number => Math.floor(value / cellSize);
const keyOf = (x: number, y: number, z: number): string => `${x}|${y}|${z}`;
const distanceSquared = (a: Vec3, b: Vec3): number => {
  const x = a.x - b.x; const y = a.y - b.y; const z = a.z - b.z;
  return x * x + y * y + z * z;
};

export class SpatialHashIndex {
  readonly #cellSize: number;
  readonly #cells = new Map<string, Set<NodeId>>();
  readonly #items = new Map<NodeId, SpatialItem>();
  #queries = 0;
  #candidates = 0;

  constructor(cellSize = 16) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) throw new RangeError('Cell size must be positive');
    this.#cellSize = cellSize;
  }

  #cell(position: Vec3): SpatialCellKey {
    return { x: cellCoord(position.x, this.#cellSize), y: cellCoord(position.y, this.#cellSize), z: cellCoord(position.z, this.#cellSize) };
  }

  #cellsFor(item: SpatialItem): SpatialCellKey[] {
    const cell = this.#cell(item.position);
    const extent = Math.max(0, Math.ceil(item.radius / this.#cellSize));
    const cells: SpatialCellKey[] = [];
    for (let x = cell.x - extent; x <= cell.x + extent; x += 1)
      for (let y = cell.y - extent; y <= cell.y + extent; y += 1)
        for (let z = cell.z - extent; z <= cell.z + extent; z += 1) cells.push({ x, y, z });
    return cells;
  }

  #insertIntoCells(item: SpatialItem): void {
    for (const cell of this.#cellsFor(item)) {
      const key = keyOf(cell.x, cell.y, cell.z);
      const bucket = this.#cells.get(key) ?? new Set<NodeId>();
      bucket.add(item.id);
      this.#cells.set(key, bucket);
    }
  }

  #removeFromCells(item: SpatialItem): void {
    for (const cell of this.#cellsFor(item)) {
      const key = keyOf(cell.x, cell.y, cell.z);
      const bucket = this.#cells.get(key);
      if (!bucket) continue;
      bucket.delete(item.id);
      if (bucket.size === 0) this.#cells.delete(key);
    }
  }

  upsert(item: SpatialItem): void {
    if (!item.id) throw new TypeError('Spatial item id is required');
    if (!Number.isFinite(item.radius) || item.radius < 0) throw new RangeError('Spatial item radius must be non-negative');
    const previous = this.#items.get(item.id);
    if (previous) this.#removeFromCells(previous);
    const normalized: SpatialItem = { ...item, radius: item.radius, layer: Math.trunc(item.layer), tags: [...item.tags] };
    this.#items.set(item.id, normalized);
    this.#insertIntoCells(normalized);
  }

  remove(id: NodeId): boolean {
    const item = this.#items.get(id);
    if (!item) return false;
    this.#removeFromCells(item);
    this.#items.delete(id);
    return true;
  }

  clear(): void { this.#cells.clear(); this.#items.clear(); }
  has(id: NodeId): boolean { return this.#items.has(id); }
  get(id: NodeId): SpatialItem | undefined { return this.#items.get(id); }
  size(): number { return this.#items.size; }

  query(query: SpatialQuery): readonly SpatialItem[] {
    if (!Number.isFinite(query.radius) || query.radius < 0) throw new RangeError('Query radius must be non-negative');
    const center = query.center;
    const radius = query.radius;
    const extent = Math.ceil(radius / this.#cellSize);
    const base = this.#cell(center);
    const ids = new Set<NodeId>();
    for (let x = base.x - extent; x <= base.x + extent; x += 1)
      for (let y = base.y - extent; y <= base.y + extent; y += 1)
        for (let z = base.z - extent; z <= base.z + extent; z += 1) {
          const bucket = this.#cells.get(keyOf(x, y, z));
          if (bucket) for (const id of bucket) ids.add(id);
        }
    this.#queries += 1;
    this.#candidates += ids.size;
    const radiusWithBounds = radius;
    const result = [...ids].map((id) => this.#items.get(id)).filter((item): item is SpatialItem => Boolean(item))
      .filter((item) => query.layer === undefined || item.layer === query.layer)
      .filter((item) => query.tag === undefined || item.tags.includes(query.tag))
      .filter((item) => distanceSquared(center, item.position) <= (radiusWithBounds + item.radius) ** 2)
      .sort((a, b) => distanceSquared(center, a.position) - distanceSquared(center, b.position) || String(a.id).localeCompare(String(b.id)));
    return query.limit === undefined ? result : result.slice(0, Math.max(0, Math.floor(query.limit)));
  }

  nearest(center: Vec3, count = 1): readonly SpatialItem[] {
    return this.query({ center, radius: Number.POSITIVE_INFINITY, limit: count });
  }

  stats(): SpatialStats {
    return { itemCount: this.#items.size, occupiedCells: this.#cells.size, queryCount: this.#queries, averageCandidates: this.#queries === 0 ? 0 : this.#candidates / this.#queries };
  }

  rebuild(items: readonly SpatialItem[]): void {
    this.clear();
    const sorted = [...items].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    for (const item of sorted) this.upsert(item);
  }
}
