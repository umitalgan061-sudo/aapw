import { asEntityId, clamp, distanceSq, stableSort, vec3, type Disposable, type EntityId, type Vec3 } from './primitives.js';

export type InterestTier = 'near' | 'mid' | 'far' | 'sleeping';
export interface SpatialEntity { readonly id: EntityId; readonly position: Vec3; readonly radius: number; readonly active: boolean; readonly priority: number; }
export interface InterestPolicy { readonly near: number; readonly mid: number; readonly far: number; readonly maxNear: number; readonly maxMid: number; readonly maxFar: number; readonly maxSleeping: number; }
export interface InterestRecord { readonly id: EntityId; readonly tier: InterestTier; readonly distanceSq: number; readonly score: number; }
export interface SpatialStats { readonly entities: number; readonly cells: number; readonly near: number; readonly mid: number; readonly far: number; readonly sleeping: number; readonly queries: number; }

const DEFAULT_POLICY: InterestPolicy = Object.freeze({ near: 25, mid: 80, far: 180, maxNear: 128, maxMid: 256, maxFar: 512, maxSleeping: 2048 });
function cell(x: number, z: number, size: number): string { return `${Math.floor(x / size)},${Math.floor(z / size)}`; }
function tierFor(distanceValue: number, policy: InterestPolicy): InterestTier { return distanceValue <= policy.near ? 'near' : distanceValue <= policy.mid ? 'mid' : distanceValue <= policy.far ? 'far' : 'sleeping'; }
function tierPriority(tier: InterestTier): number { return tier === 'near' ? 4 : tier === 'mid' ? 3 : tier === 'far' ? 2 : 1; }

export class SpatialWorldIndex implements Disposable {
  readonly cellSize: number; readonly policy: InterestPolicy;
  #entities = new Map<EntityId, SpatialEntity>(); #cells = new Map<string, Set<EntityId>>(); #queries = 0; #disposed = false;
  constructor(cellSize = 32, policy: Partial<InterestPolicy> = {}) { this.cellSize = clamp(cellSize, 4, 256); this.policy = Object.freeze({ ...DEFAULT_POLICY, ...policy }); }
  upsert(entity: Omit<SpatialEntity, 'id'> & { id: string }): boolean {
    if (this.#disposed || !entity.id || !Number.isFinite(entity.position.x + entity.position.y + entity.position.z)) return false;
    const id = asEntityId(entity.id); const previous = this.#entities.get(id);
    if (previous) this.#removeCell(previous);
    const normalized = Object.freeze({ ...entity, id, radius: clamp(entity.radius, 0, 1000), priority: clamp(entity.priority, -1000, 1000) });
    this.#entities.set(id, normalized); const key = cell(normalized.position.x, normalized.position.z, this.cellSize); const bucket = this.#cells.get(key) ?? new Set<EntityId>(); bucket.add(id); this.#cells.set(key, bucket); return true;
  }
  remove(id: EntityId): boolean { const entity = this.#entities.get(id); if (!entity) return false; this.#removeCell(entity); return this.#entities.delete(id); }
  query(center: Vec3, radius: number): readonly SpatialEntity[] {
    if (this.#disposed) return []; this.#queries += 1; const output: SpatialEntity[] = []; const r = clamp(radius, 0, 10_000); const cells = Math.ceil(r / this.cellSize); const cx = Math.floor(center.x / this.cellSize); const cz = Math.floor(center.z / this.cellSize);
    for (let x = cx - cells; x <= cx + cells; x += 1) for (let z = cz - cells; z <= cz + cells; z += 1) for (const id of this.#cells.get(`${x},${z}`) ?? []) { const entity = this.#entities.get(id); if (entity && distanceSq(center, entity.position) <= (r + entity.radius) ** 2) output.push(entity); }
    return Object.freeze(stableSort(output, (a, b) => distanceSq(center, a.position) - distanceSq(center, b.position) || b.priority - a.priority || String(a.id).localeCompare(String(b.id))));
  }
  interest(center: Vec3): readonly InterestRecord[] {
    if (this.#disposed) return []; const records: InterestRecord[] = []; const candidates = this.query(center, this.policy.far);
    for (const entity of candidates) { const dsq = distanceSq(center, entity.position); const distanceValue = Math.sqrt(dsq); const tier = tierFor(distanceValue, this.policy); const score = tierPriority(tier) * 1000 + entity.priority - distanceValue; records.push(Object.freeze({ id: entity.id, tier, distanceSq: dsq, score })); }
    const limits: Record<InterestTier, number> = { near: this.policy.maxNear, mid: this.policy.maxMid, far: this.policy.maxFar, sleeping: this.policy.maxSleeping }; return Object.freeze(this.#cap(records, limits));
  }
  stats(): SpatialStats { const counts = { near: 0, mid: 0, far: 0, sleeping: 0 }; for (const entity of this.#entities.values()) { const tier = tierFor(Math.sqrt(distanceSq(vec3(0, 0, 0), entity.position)), this.policy); counts[tier] += 1; } return Object.freeze({ entities: this.#entities.size, cells: this.#cells.size, ...counts, queries: this.#queries }); }
  clear(): void { this.#entities.clear(); this.#cells.clear(); }
  dispose(): void { this.#disposed = true; this.clear(); }
  #removeCell(entity: SpatialEntity): void { const key = cell(entity.position.x, entity.position.z, this.cellSize); const bucket = this.#cells.get(key); bucket?.delete(entity.id); if (bucket && !bucket.size) this.#cells.delete(key); }
  #cap(records: readonly InterestRecord[], limits: Record<InterestTier, number>): InterestRecord[] { const output: InterestRecord[] = []; for (const tier of ['near', 'mid', 'far', 'sleeping'] as const) { const group = stableSort(records.filter((record) => record.tier === tier), (a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id))).slice(0, Math.max(0, limits[tier])); output.push(...group); } return output; }
}

export function createSpatialEntity(id: string, position: Vec3, priority = 0): SpatialEntity { return Object.freeze({ id: asEntityId(id), position: Object.freeze({ ...position }), radius: 0, active: true, priority }); }
