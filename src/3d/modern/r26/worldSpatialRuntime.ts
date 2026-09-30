export interface SpatialItemR26 {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
  readonly layer: string;
  readonly priority: number;
  readonly tags: readonly string[];
}

export interface SpatialBoundsR26 {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface SpatialQueryR26 {
  readonly center: { readonly x: number; readonly y: number; readonly z: number };
  readonly radius: number;
  readonly layer?: string;
  readonly tags?: readonly string[];
  readonly limit?: number;
}

export interface SpatialResultR26 {
  readonly id: string;
  readonly distance: number;
  readonly score: number;
}

export interface SpatialSnapshotR26 {
  readonly version: 1;
  readonly cellSize: number;
  readonly items: readonly SpatialItemR26[];
  readonly digest: string;
}

const clean = (value: string): string => value.trim().slice(0, 128);
const finite = (value: number): number => Number.isFinite(value) ? value : 0;

const cellKey = (x: number, y: number, z: number, size: number): string =>
  String(Math.floor(x / size)) + ':' + String(Math.floor(y / size)) + ':' + String(Math.floor(z / size));

const dist = (a: SpatialItemR26, b: { x: number; y: number; z: number }): number =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

const digest = (value: unknown): string => {
  let hash = 2166136261;
  const source = JSON.stringify(value);
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export class WorldSpatialRuntimeR26 {
  readonly #cellSize: number;
  readonly #items = new Map<string, SpatialItemR26>();
  readonly #cells = new Map<string, Set<string>>();
  #maxRadius = 0;
  #revision = 0;

  constructor(cellSizeMeters = 32) {
    this.#cellSize = Math.max(1, finite(cellSizeMeters));
  }

  get cellSize(): number {
    return this.#cellSize;
  }

  insert(item: SpatialItemR26): void {
    const id = clean(item.id);
    if (!id) throw new Error('R26_SPATIAL_ID_EMPTY');
    this.remove(id);
    const normalized = Object.freeze({
      id,
      x: finite(item.x),
      y: finite(item.y),
      z: finite(item.z),
      radius: Math.max(0, finite(item.radius)),
      layer: clean(item.layer),
      priority: finite(item.priority),
      tags: Object.freeze([...new Set(item.tags.map(clean).filter(Boolean))].sort()),
    });
    this.#items.set(id, normalized);
    this.#maxRadius = Math.max(this.#maxRadius, normalized.radius);
    this.#cellAdd(normalized);
    this.#revision += 1;
  }

  insertMany(items: readonly SpatialItemR26[]): void {
    for (const item of items) this.insert(item);
  }

  update(id: string, patch: Partial<Omit<SpatialItemR26, 'id'>>): boolean {
    const current = this.#items.get(clean(id));
    if (!current) return false;
    this.remove(current.id);
    this.insert({
      ...current,
      ...patch,
      id: current.id,
      tags: patch.tags ?? current.tags,
    });
    return true;
  }

  remove(id: string): boolean {
    const key = clean(id);
    const current = this.#items.get(key);
    if (!current) return false;
    this.#items.delete(key);
    this.#cellRemove(current);
    if (current.radius >= this.#maxRadius) {
      this.#maxRadius = 0;
      for (const item of this.#items.values()) this.#maxRadius = Math.max(this.#maxRadius, item.radius);
    }
    this.#revision += 1;
    return true;
  }

  get(id: string): SpatialItemR26 | undefined {
    const value = this.#items.get(clean(id));
    return value ? Object.freeze({ ...value, tags: Object.freeze([...value.tags]) }) : undefined;
  }

  size(): number {
    return this.#items.size;
  }

  query(query: SpatialQueryR26): readonly SpatialResultR26[] {
    const radius = Math.max(0, finite(query.radius));
    const center = {
      x: finite(query.center.x),
      y: finite(query.center.y),
      z: finite(query.center.z),
    };
    const ids = this.#candidateIds(center, radius);
    const tagSet = new Set((query.tags ?? []).map(clean));
    const result: SpatialResultR26[] = [];

    for (const id of ids) {
      const item = this.#items.get(id);
      if (!item) continue;
      if (query.layer && item.layer !== clean(query.layer)) continue;
      if (tagSet.size && ![...tagSet].every((tag) => item.tags.includes(tag))) continue;

      const distance = dist(item, center);
      if (distance > radius + item.radius) continue;

      const normalizedDistance = 1 / (1 + distance);
      const priority = Math.max(0, item.priority);
      result.push({
        id: item.id,
        distance,
        score: normalizedDistance * 100 + priority,
      });
    }

    result.sort((a, b) =>
      b.score - a.score ||
      a.distance - b.distance ||
      a.id.localeCompare(b.id),
    );

    return Object.freeze(result.slice(0, Math.max(0, Math.floor(query.limit ?? 256))));
  }

  nearest(
    center: { x: number; y: number; z: number },
    options: { layer?: string; tags?: readonly string[] } = {},
  ): SpatialResultR26 | null {
    return this.query({
      center,
      radius: this.#cellSize * 3,
      layer: options.layer,
      tags: options.tags,
      limit: 1,
    })[0] ?? null;
  }

  withinBounds(bounds: SpatialBoundsR26): readonly SpatialItemR26[] {
    const normalized = {
      minX: Math.min(finite(bounds.minX), finite(bounds.maxX)),
      maxX: Math.max(finite(bounds.minX), finite(bounds.maxX)),
      minY: Math.min(finite(bounds.minY), finite(bounds.maxY)),
      maxY: Math.max(finite(bounds.minY), finite(bounds.maxY)),
      minZ: Math.min(finite(bounds.minZ), finite(bounds.maxZ)),
      maxZ: Math.max(finite(bounds.minZ), finite(bounds.maxZ)),
    };
    const result: SpatialItemR26[] = [];
    for (const item of this.#items.values()) {
      if (item.x < normalized.minX || item.x > normalized.maxX) continue;
      if (item.y < normalized.minY || item.y > normalized.maxY) continue;
      if (item.z < normalized.minZ || item.z > normalized.maxZ) continue;
      result.push(item);
    }
    return Object.freeze(result.sort((a, b) => a.id.localeCompare(b.id)));
  }

  queryCells(center: { x: number; y: number; z: number }, cellRadius: number): readonly string[] {
    const radius = Math.max(0, Math.floor(cellRadius));
    const cx = Math.floor(finite(center.x) / this.#cellSize);
    const cy = Math.floor(finite(center.y) / this.#cellSize);
    const cz = Math.floor(finite(center.z) / this.#cellSize);
    const cells: string[] = [];

    for (let x = -radius; x <= radius; x += 1) {
      for (let y = -radius; y <= radius; y += 1) {
        for (let z = -radius; z <= radius; z += 1) {
          cells.push(String(cx + x) + ':' + String(cy + y) + ':' + String(cz + z));
        }
      }
    }

    return Object.freeze(cells.sort());
  }

  snapshot(): SpatialSnapshotR26 {
    const items = Object.freeze(
      [...this.#items.values()]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((item) => Object.freeze({ ...item, tags: Object.freeze([...item.tags]) })),
    );
    const payload = {
      version: 1 as const,
      cellSize: this.#cellSize,
      items,
    };
    return Object.freeze({
      ...payload,
      digest: digest(payload),
    });
  }

  restore(snapshot: SpatialSnapshotR26): void {
    if (snapshot.version !== 1) throw new Error('R26_SPATIAL_VERSION');
    this.#items.clear();
    this.#cells.clear();
    this.#maxRadius = 0;
    for (const item of snapshot.items) {
      const normalized = Object.freeze({
        ...item,
        tags: Object.freeze([...item.tags].sort()),
      });
      this.#items.set(normalized.id, normalized);
      this.#maxRadius = Math.max(this.#maxRadius, normalized.radius);
      this.#cellAdd(normalized);
    }
    this.#revision += 1;
  }

  digest(): string {
    return this.snapshot().digest;
  }

  stats(): Readonly<{
    items: number;
    cells: number;
    revision: number;
    largestCell: number;
    averageCellLoad: number;
  }> {
    let largest = 0;
    let total = 0;
    for (const cell of this.#cells.values()) {
      largest = Math.max(largest, cell.size);
      total += cell.size;
    }
    return Object.freeze({
      items: this.#items.size,
      cells: this.#cells.size,
      revision: this.#revision,
      largestCell: largest,
      averageCellLoad: this.#cells.size ? total / this.#cells.size : 0,
    });
  }

  clear(): void {
    this.#items.clear();
    this.#cells.clear();
    this.#maxRadius = 0;
    this.#revision += 1;
  }

  #candidateIds(center: { x: number; y: number; z: number }, radius: number): readonly string[] {
    const searchRadius = radius + this.#maxRadius;
    const cells = this.queryCells(center, Math.ceil(searchRadius / this.#cellSize));
    const ids = new Set<string>();
    for (const cell of cells) {
      for (const id of this.#cells.get(cell) ?? []) ids.add(id);
    }
    return [...ids].sort();
  }

  #cellAdd(item: SpatialItemR26): void {
    const key = cellKey(item.x, item.y, item.z, this.#cellSize);
    const set = this.#cells.get(key) ?? new Set<string>();
    set.add(item.id);
    this.#cells.set(key, set);
  }

  #cellRemove(item: SpatialItemR26): void {
    const key = cellKey(item.x, item.y, item.z, this.#cellSize);
    const set = this.#cells.get(key);
    if (!set) return;
    set.delete(item.id);
    if (set.size === 0) this.#cells.delete(key);
  }
}

export const distanceSquaredR26 = (
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number => {
  const dx = finite(a.x) - finite(b.x);
  const dy = finite(a.y) - finite(b.y);
  const dz = finite(a.z) - finite(b.z);
  return dx * dx + dy * dy + dz * dz;
};
