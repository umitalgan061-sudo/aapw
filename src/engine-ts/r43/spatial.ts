import type { EntityId, Vec2 } from './contracts.ts';

export interface SpatialItem {
  readonly id: EntityId;
  readonly position: Vec2;
  readonly radius: number;
}

export interface SpatialQuery {
  readonly center: Vec2;
  readonly radius: number;
  readonly result: readonly SpatialItem[];
  readonly visitedCells: number;
}

function cellCoordinate(value: number, cellSize: number): number {
  return Math.floor(value / cellSize);
}

function cellKey(x: number, y: number): string {
  return x + ':' + y;
}

export class SpatialGrid {
  readonly cellSize: number;

  #cells = new Map<string, Set<EntityId>>();
  #items = new Map<EntityId, SpatialItem>();
  #entityCells = new Map<EntityId, string[]>();

  constructor(cellSize = 32) {
    this.cellSize = Math.max(0.25, Number.isFinite(cellSize) ? cellSize : 32);
  }

  upsert(item: SpatialItem): void {
    this.remove(item.id);
    const normalized: SpatialItem = Object.freeze({
      id: item.id,
      position: Object.freeze({
        x: Number.isFinite(item.position.x) ? item.position.x : 0,
        y: Number.isFinite(item.position.y) ? item.position.y : 0,
      }),
      radius: Math.max(0, Number.isFinite(item.radius) ? item.radius : 0),
    });
    this.#items.set(item.id, normalized);
    const cells = this.#cellsFor(normalized.position, normalized.radius);
    this.#entityCells.set(item.id, cells);
    for (const key of cells) {
      const bucket = this.#cells.get(key) ?? new Set<EntityId>();
      bucket.add(item.id);
      this.#cells.set(key, bucket);
    }
  }

  remove(id: EntityId): boolean {
    const keys = this.#entityCells.get(id);
    if (!keys) return false;
    for (const key of keys) {
      const bucket = this.#cells.get(key);
      if (!bucket) continue;
      bucket.delete(id);
      if (bucket.size === 0) this.#cells.delete(key);
    }
    this.#entityCells.delete(id);
    return this.#items.delete(id);
  }

  get(id: EntityId): SpatialItem | undefined {
    return this.#items.get(id);
  }

  queryRadius(center: Vec2, radius: number): SpatialQuery {
    const safeRadius = Math.max(0, Number.isFinite(radius) ? radius : 0);
    const minX = cellCoordinate(center.x - safeRadius, this.cellSize);
    const maxX = cellCoordinate(center.x + safeRadius, this.cellSize);
    const minY = cellCoordinate(center.y - safeRadius, this.cellSize);
    const maxY = cellCoordinate(center.y + safeRadius, this.cellSize);
    const candidateIds = new Set<EntityId>();
    let visitedCells = 0;
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        visitedCells += 1;
        for (const id of this.#cells.get(cellKey(x, y)) ?? []) candidateIds.add(id);
      }
    }
    const result = [...candidateIds]
      .map((id) => this.#items.get(id))
      .filter((item): item is SpatialItem => item !== undefined)
      .filter((item) => Math.hypot(item.position.x - center.x, item.position.y - center.y) <= safeRadius + item.radius)
      .sort((a, b) => a.id - b.id);
    return Object.freeze({
      center: Object.freeze({ x: center.x, y: center.y }),
      radius: safeRadius,
      result: Object.freeze(result),
      visitedCells,
    });
  }

  queryAabb(min: Vec2, max: Vec2): readonly SpatialItem[] {
    const minX = cellCoordinate(Math.min(min.x, max.x), this.cellSize);
    const maxX = cellCoordinate(Math.max(min.x, max.x), this.cellSize);
    const minY = cellCoordinate(Math.min(min.y, max.y), this.cellSize);
    const maxY = cellCoordinate(Math.max(min.y, max.y), this.cellSize);
    const ids = new Set<EntityId>();
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        for (const id of this.#cells.get(cellKey(x, y)) ?? []) ids.add(id);
      }
    }
    const result = [...ids]
      .map((id) => this.#items.get(id))
      .filter((item): item is SpatialItem => item !== undefined)
      .filter((item) => item.position.x + item.radius >= Math.min(min.x, max.x)
        && item.position.x - item.radius <= Math.max(min.x, max.x)
        && item.position.y + item.radius >= Math.min(min.y, max.y)
        && item.position.y - item.radius <= Math.max(min.y, max.y))
      .sort((a, b) => a.id - b.id);
    return Object.freeze(result);
  }

  size(): number {
    return this.#items.size;
  }

  cellCount(): number {
    return this.#cells.size;
  }

  clear(): void {
    this.#cells.clear();
    this.#items.clear();
    this.#entityCells.clear();
  }

  all(): readonly SpatialItem[] {
    return Object.freeze([...this.#items.values()].sort((a, b) => a.id - b.id));
  }

  #cellsFor(position: Vec2, radius: number): string[] {
    const minX = cellCoordinate(position.x - radius, this.cellSize);
    const maxX = cellCoordinate(position.x + radius, this.cellSize);
    const minY = cellCoordinate(position.y - radius, this.cellSize);
    const maxY = cellCoordinate(position.y + radius, this.cellSize);
    const cells: string[] = [];
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) cells.push(cellKey(x, y));
    }
    return cells.sort();
  }
}
