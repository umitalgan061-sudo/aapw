import type { Vec2 } from './index.ts';

export interface SpatialItem<T = unknown> {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly value: T;
}

export interface SpatialCell<T = unknown> {
  readonly key: string;
  readonly items: readonly SpatialItem<T>[];
}

export interface SpatialQueryOptions {
  readonly maxResults?: number;
  readonly predicate?: (item: SpatialItem) => boolean;
  readonly sortByDistance?: boolean;
}

export interface SpatialMetrics {
  readonly items: number;
  readonly cells: number;
  readonly queries: number;
  readonly visitedCells: number;
  readonly returnedItems: number;
  readonly updates: number;
  readonly removals: number;
}

const safeNumber = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;
const safeRadius = (value: number): number => Math.max(0, safeNumber(value));

export class SpatialHash2D<T = unknown> {
  readonly #cellSize: number;
  readonly #cells = new Map<string, Set<string>>();
  readonly #items = new Map<string, SpatialItem<T>>();
  #queries = 0;
  #visitedCells = 0;
  #returnedItems = 0;
  #updates = 0;
  #removals = 0;

  constructor(cellSize = 32) {
    this.#cellSize = Math.max(0.25, safeNumber(cellSize, 32));
  }

  get cellSize(): number { return this.#cellSize; }
  get size(): number { return this.#items.size; }

  set(item: SpatialItem<T>): boolean {
    if (!item.id.trim()) return false;
    const normalized: SpatialItem<T> = Object.freeze({
      id: item.id,
      x: safeNumber(item.x),
      y: safeNumber(item.y),
      radius: safeRadius(item.radius),
      value: item.value,
    });
    const previous = this.#items.get(item.id);
    if (previous) this.#detach(previous);
    this.#items.set(item.id, normalized);
    this.#attach(normalized);
    this.#updates += 1;
    return true;
  }

  update(id: string, patch: Partial<Omit<SpatialItem<T>, 'id' | 'value'>> & { value?: T }): boolean {
    const current = this.#items.get(id);
    if (!current) return false;
    return this.set({
      ...current,
      ...patch,
      id,
      x: patch.x ?? current.x,
      y: patch.y ?? current.y,
      radius: patch.radius ?? current.radius,
      value: patch.value === undefined ? current.value : patch.value,
    });
  }

  remove(id: string): boolean {
    const item = this.#items.get(id);
    if (!item) return false;
    this.#detach(item);
    this.#items.delete(id);
    this.#removals += 1;
    return true;
  }

  get(id: string): SpatialItem<T> | undefined { return this.#items.get(id); }

  clear(): void {
    this.#cells.clear();
    this.#items.clear();
  }

  queryCircle(center: Vec2, radius: number, options: SpatialQueryOptions = {}): readonly SpatialItem<T>[] {
    const r = Math.max(0, safeNumber(radius));
    const maxResults = Math.max(1, Math.floor(options.maxResults ?? Number.MAX_SAFE_INTEGER));
    const minX = Math.floor((center.x - r) / this.#cellSize);
    const maxX = Math.floor((center.x + r) / this.#cellSize);
    const minY = Math.floor((center.y - r) / this.#cellSize);
    const maxY = Math.floor((center.y + r) / this.#cellSize);
    const candidates = new Map<string, SpatialItem<T>>();
    this.#queries += 1;
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        const cell = this.#cells.get(this.#cellKey(x, y));
        this.#visitedCells += 1;
        if (!cell) continue;
        for (const id of cell) {
          if (!candidates.has(id)) {
            const item = this.#items.get(id);
            if (item) candidates.set(id, item);
          }
        }
      }
    }
    const rr = r * r;
    let result = [...candidates.values()].filter((item) => {
      const dx = item.x - center.x;
      const dy = item.y - center.y;
      const distanceLimit = r + item.radius;
      if (dx * dx + dy * dy > distanceLimit * distanceLimit) return false;
      return options.predicate ? options.predicate(item) : true;
    });
    if (options.sortByDistance) {
      result = result.sort((a, b) => {
        const da = (a.x - center.x) ** 2 + (a.y - center.y) ** 2;
        const db = (b.x - center.x) ** 2 + (b.y - center.y) ** 2;
        return da - db || a.id.localeCompare(b.id);
      });
    }
    result = result.slice(0, maxResults);
    this.#returnedItems += result.length;
    void rr;
    return result;
  }

  queryBounds(min: Vec2, max: Vec2, options: SpatialQueryOptions = {}): readonly SpatialItem<T>[] {
    const left = Math.min(min.x, max.x);
    const right = Math.max(min.x, max.x);
    const bottom = Math.min(min.y, max.y);
    const top = Math.max(min.y, max.y);
    const minCellX = Math.floor(left / this.#cellSize);
    const maxCellX = Math.floor(right / this.#cellSize);
    const minCellY = Math.floor(bottom / this.#cellSize);
    const maxCellY = Math.floor(top / this.#cellSize);
    const maxResults = Math.max(1, Math.floor(options.maxResults ?? Number.MAX_SAFE_INTEGER));
    const ids = new Set<string>();
    this.#queries += 1;
    for (let x = minCellX; x <= maxCellX; x += 1) {
      for (let y = minCellY; y <= maxCellY; y += 1) {
        this.#visitedCells += 1;
        for (const id of this.#cells.get(this.#cellKey(x, y)) ?? []) ids.add(id);
      }
    }
    let result = [...ids].map((id) => this.#items.get(id)).filter((item): item is SpatialItem<T> => Boolean(item));
    result = result.filter((item) => item.x + item.radius >= left && item.x - item.radius <= right && item.y + item.radius >= bottom && item.y - item.radius <= top);
    if (options.predicate) result = result.filter(options.predicate);
    if (options.sortByDistance) {
      const cx = (left + right) / 2;
      const cy = (bottom + top) / 2;
      result.sort((a, b) => ((a.x - cx) ** 2 + (a.y - cy) ** 2) - ((b.x - cx) ** 2 + (b.y - cy) ** 2) || a.id.localeCompare(b.id));
    }
    result = result.slice(0, maxResults);
    this.#returnedItems += result.length;
    return result;
  }

  forEachInCircle(center: Vec2, radius: number, callback: (item: SpatialItem<T>) => void): number {
    const result = this.queryCircle(center, radius);
    for (const item of result) callback(item);
    return result.length;
  }

  cells(): readonly SpatialCell<T>[] {
    return [...this.#cells.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, ids]) => Object.freeze({
      key,
      items: [...ids].map((id) => this.#items.get(id)).filter((item): item is SpatialItem<T> => Boolean(item)),
    }));
  }

  metrics(): SpatialMetrics {
    return Object.freeze({
      items: this.#items.size,
      cells: this.#cells.size,
      queries: this.#queries,
      visitedCells: this.#visitedCells,
      returnedItems: this.#returnedItems,
      updates: this.#updates,
      removals: this.#removals,
    });
  }

  #attach(item: SpatialItem<T>): void {
    const minX = Math.floor((item.x - item.radius) / this.#cellSize);
    const maxX = Math.floor((item.x + item.radius) / this.#cellSize);
    const minY = Math.floor((item.y - item.radius) / this.#cellSize);
    const maxY = Math.floor((item.y + item.radius) / this.#cellSize);
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        const key = this.#cellKey(x, y);
        const bucket = this.#cells.get(key) ?? new Set<string>();
        bucket.add(item.id);
        this.#cells.set(key, bucket);
      }
    }
  }

  #detach(item: SpatialItem<T>): void {
    const minX = Math.floor((item.x - item.radius) / this.#cellSize);
    const maxX = Math.floor((item.x + item.radius) / this.#cellSize);
    const minY = Math.floor((item.y - item.radius) / this.#cellSize);
    const maxY = Math.floor((item.y + item.radius) / this.#cellSize);
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        const key = this.#cellKey(x, y);
        const bucket = this.#cells.get(key);
        if (!bucket) continue;
        bucket.delete(item.id);
        if (!bucket.size) this.#cells.delete(key);
      }
    }
  }

  #cellKey(x: number, y: number): string { return `${x}:${y}`; }
}

export interface SpatialMortonKey { readonly key: bigint; readonly x: number; readonly y: number; }

const spreadBits = (value: number): bigint => {
  let result = BigInt(value >>> 0);
  result = (result | (result << 16n)) & 0x0000ffff0000ffffn;
  result = (result | (result << 8n)) & 0x00ff00ff00ff00ffn;
  result = (result | (result << 4n)) & 0x0f0f0f0f0f0f0f0fn;
  result = (result | (result << 2n)) & 0x3333333333333333n;
  result = (result | (result << 1n)) & 0x5555555555555555n;
  return result;
};

export const mortonKey2D = (x: number, y: number): SpatialMortonKey => {
  const ix = (Math.floor(x) + 0x80000000) >>> 0;
  const iy = (Math.floor(y) + 0x80000000) >>> 0;
  return Object.freeze({ key: spreadBits(ix) | (spreadBits(iy) << 1n), x: Math.floor(x), y: Math.floor(y) });
};
