import type { FrameId, UnixMillis } from './types';
import { hash32, quantize } from './deterministic';

export type InterestKind = 'player' | 'npc' | 'animal' | 'creature' | 'structure' | 'effect' | 'terrain';
export type SimulationTier = 'near' | 'mid' | 'far' | 'sleeping';

export interface WorldEntity {
  readonly id: string;
  readonly kind: InterestKind;
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly radius: number;
  readonly priority: number;
  readonly dynamic: boolean;
}

export interface InterestSet {
  readonly frame: FrameId;
  readonly center: { readonly x: number; readonly z: number };
  readonly near: readonly string[];
  readonly mid: readonly string[];
  readonly far: readonly string[];
  readonly sleeping: readonly string[];
}

export interface WorldCoordinatorOptions {
  readonly nearRadius?: number;
  readonly midRadius?: number;
  readonly farRadius?: number;
  readonly maxNear?: number;
  readonly maxMid?: number;
  readonly maxFar?: number;
  readonly maxEntities?: number;
  readonly cellSize?: number;
  readonly now?: () => UnixMillis;
}

export interface WorldCoordinatorStats {
  readonly entities: number;
  readonly cells: number;
  readonly near: number;
  readonly mid: number;
  readonly far: number;
  readonly sleeping: number;
  readonly updates: number;
  readonly rejected: number;
}

function distanceSquared(entity: WorldEntity, x: number, z: number): number {
  const dx = entity.position.x - x;
  const dz = entity.position.z - z;
  return dx * dx + dz * dz;
}

function cellKey(x: number, z: number, size: number): string { return `${Math.floor(x / size)}:${Math.floor(z / size)}`; }

function tier(distance: number, near: number, mid: number, far: number): SimulationTier {
  if (distance <= near) return 'near';
  if (distance <= mid) return 'mid';
  if (distance <= far) return 'far';
  return 'sleeping';
}

/** Stable interest-management layer for a large open world. It does not mutate Three.js objects. */
export class RuntimeWorldCoordinator {
  readonly nearRadius: number;
  readonly midRadius: number;
  readonly farRadius: number;
  readonly maxNear: number;
  readonly maxMid: number;
  readonly maxFar: number;
  readonly maxEntities: number;
  readonly cellSize: number;
  #now: () => UnixMillis;
  #entities = new Map<string, WorldEntity>();
  #cells = new Map<string, Set<string>>();
  #interest: InterestSet | null = null;
  #updates = 0;
  #rejected = 0;

  constructor(options: WorldCoordinatorOptions = {}) {
    this.nearRadius = Math.max(1, options.nearRadius ?? 80);
    this.midRadius = Math.max(this.nearRadius, options.midRadius ?? 220);
    this.farRadius = Math.max(this.midRadius, options.farRadius ?? 640);
    this.maxNear = Math.max(1, Math.trunc(options.maxNear ?? 128));
    this.maxMid = Math.max(1, Math.trunc(options.maxMid ?? 512));
    this.maxFar = Math.max(1, Math.trunc(options.maxFar ?? 2048));
    this.maxEntities = Math.max(64, Math.trunc(options.maxEntities ?? 20_000));
    this.cellSize = Math.max(8, options.cellSize ?? 64);
    this.#now = options.now ?? (() => Date.now() as UnixMillis);
  }

  upsert(entity: WorldEntity): boolean {
    if (!entity.id || entity.id.length > 128 || !Number.isFinite(entity.position.x) || !Number.isFinite(entity.position.z)) { this.#rejected += 1; return false; }
    if (!this.#entities.has(entity.id) && this.#entities.size >= this.maxEntities) { this.#rejected += 1; return false; }
    const normalized = Object.freeze({ ...entity, position: Object.freeze({ x: quantize(entity.position.x, 0.001), y: quantize(entity.position.y, 0.001), z: quantize(entity.position.z, 0.001) }), radius: Math.max(0, entity.radius), priority: quantize(entity.priority, 0.01), dynamic: Boolean(entity.dynamic) });
    const previous = this.#entities.get(entity.id);
    if (previous) this.#removeFromCell(previous);
    this.#entities.set(entity.id, normalized);
    const key = cellKey(normalized.position.x, normalized.position.z, this.cellSize);
    const members = this.#cells.get(key) ?? new Set<string>();
    members.add(normalized.id);
    this.#cells.set(key, members);
    return true;
  }

  remove(id: string): boolean {
    const entity = this.#entities.get(id);
    if (!entity) return false;
    this.#removeFromCell(entity);
    return this.#entities.delete(id);
  }

  entity(id: string): WorldEntity | null { return this.#entities.get(id) ?? null; }

  rebuildInterest(center: { readonly x: number; readonly z: number }, frame: FrameId): InterestSet {
    const buckets: Record<SimulationTier, string[]> = { near: [], mid: [], far: [], sleeping: [] };
    const all = [...this.#entities.values()];
    for (const entity of all) {
      const distance = Math.sqrt(distanceSquared(entity, center.x, center.z));
      buckets[tier(distance, this.nearRadius, this.midRadius, this.farRadius)].push(entity.id);
    }
    const sorter = (a: string, b: string): number => {
      const ea = this.#entities.get(a)!; const eb = this.#entities.get(b)!;
      const da = distanceSquared(ea, center.x, center.z); const db = distanceSquared(eb, center.x, center.z);
      return (eb.priority - ea.priority) || (da - db) || a.localeCompare(b);
    };
    for (const bucket of Object.values(buckets)) bucket.sort(sorter);
    const trim = (items: string[], limit: number): string[] => items.slice(0, limit);
    this.#interest = Object.freeze({ frame, center: Object.freeze({ x: center.x, z: center.z }), near: Object.freeze(trim(buckets.near, this.maxNear)), mid: Object.freeze(trim(buckets.mid, this.maxMid)), far: Object.freeze(trim(buckets.far, this.maxFar)), sleeping: Object.freeze(buckets.sleeping) });
    this.#updates += 1;
    return this.#interest;
  }

  currentInterest(): InterestSet | null { return this.#interest; }

  tierFor(id: string): SimulationTier {
    const entity = this.#entities.get(id);
    const interest = this.#interest;
    if (!entity || !interest) return 'sleeping';
    return tier(Math.sqrt(distanceSquared(entity, interest.center.x, interest.center.z)), this.nearRadius, this.midRadius, this.farRadius);
  }

  queryRadius(center: { readonly x: number; readonly z: number }, radius: number, kinds?: readonly InterestKind[]): readonly WorldEntity[] {
    const squared = Math.max(0, radius) ** 2;
    const kindSet = kinds ? new Set(kinds) : null;
    const results: WorldEntity[] = [];
    const minCellX = Math.floor((center.x - radius) / this.cellSize);
    const maxCellX = Math.floor((center.x + radius) / this.cellSize);
    const minCellZ = Math.floor((center.z - radius) / this.cellSize);
    const maxCellZ = Math.floor((center.z + radius) / this.cellSize);
    const seen = new Set<string>();
    for (let cx = minCellX; cx <= maxCellX; cx += 1) for (let cz = minCellZ; cz <= maxCellZ; cz += 1) {
      const members = this.#cells.get(`${cx}:${cz}`); if (!members) continue;
      for (const id of members) {
        if (seen.has(id)) continue; seen.add(id);
        const entity = this.#entities.get(id); if (!entity || distanceSquared(entity, center.x, center.z) > squared || (kindSet && !kindSet.has(entity.kind))) continue;
        results.push(entity);
      }
    }
    results.sort((a, b) => distanceSquared(a, center.x, center.z) - distanceSquared(b, center.x, center.z));
    return Object.freeze(results);
  }

  deterministicOrder(ids: readonly string[], frame: FrameId): readonly string[] {
    return Object.freeze([...ids].sort((a, b) => hash32(`${a}:${Number(frame)}`) - hash32(`${b}:${Number(frame)}`) || a.localeCompare(b)));
  }

  stats(): WorldCoordinatorStats {
    const interest = this.#interest;
    return Object.freeze({ entities: this.#entities.size, cells: this.#cells.size, near: interest?.near.length ?? 0, mid: interest?.mid.length ?? 0, far: interest?.far.length ?? 0, sleeping: interest?.sleeping.length ?? 0, updates: this.#updates, rejected: this.#rejected });
  }

  clear(): void { this.#entities.clear(); this.#cells.clear(); this.#interest = null; }

  #removeFromCell(entity: WorldEntity): void {
    const key = cellKey(entity.position.x, entity.position.z, this.cellSize);
    const members = this.#cells.get(key);
    if (!members) return;
    members.delete(entity.id);
    if (!members.size) this.#cells.delete(key);
  }
}
