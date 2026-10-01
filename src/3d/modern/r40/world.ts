import type { Bounds, EntityId, EntityLod, EntityState, InterestPoint, Revision, Stimulus, Tick, Transform, Vec3, Velocity, WorldDelta } from './types';
import { clamp, decay, hashJson, stableSort, vec3DistanceSquared } from './deterministic';

export interface WorldLimits { readonly maxEntities: number; readonly maxStimuli: number; readonly maxTagsPerEntity: number; readonly cellSize: number; readonly maxCellsPerQuery: number; }
const DEFAULT_LIMITS: WorldLimits = Object.freeze({ maxEntities: 100000, maxStimuli: 4096, maxTagsPerEntity: 32, cellSize: 64, maxCellsPerQuery: 256 });
interface Cell { readonly ids: Set<EntityId>; }

function cellKey(p: Vec3, size: number): string { return Math.floor(p.x / size) + ':' + Math.floor(p.y / size) + ':' + Math.floor(p.z / size); }
function lodFor(distance: number): EntityLod { if (distance <= 75) return 'near'; if (distance < 250) return 'mid'; if (distance <= 800) return 'far'; return 'sleeping'; }

export class SpatialEntityWorld {
  readonly limits: WorldLimits;
  #entities = new Map<EntityId, EntityState>();
  #cells = new Map<string, Cell>();
  #revision = 0;
  constructor(limits: Partial<WorldLimits> = {}) { this.limits = Object.freeze({ ...DEFAULT_LIMITS, ...limits, cellSize: Math.max(1, limits.cellSize ?? DEFAULT_LIMITS.cellSize) }); }

  upsert(entity: EntityState): boolean {
    if (!entity.id || entity.tags.length > this.limits.maxTagsPerEntity) return false;
    if (!this.#entities.has(entity.id) && this.#entities.size >= this.limits.maxEntities) return false;
    const previous = this.#entities.get(entity.id);
    if (previous && Number(entity.revision) < Number(previous.revision)) return false;
    if (previous) this.#removeCell(previous.transform.position, entity.id);
    const normalized = Object.freeze({ ...entity, tags: Object.freeze([...entity.tags.slice(0, this.limits.maxTagsPerEntity)]) });
    this.#entities.set(entity.id, normalized); this.#addCell(normalized.transform.position, normalized.id);
    this.#revision = Math.max(this.#revision, Number(entity.revision)); return true;
  }
  remove(id: EntityId): boolean {
    const previous = this.#entities.get(id); if (!previous) return false;
    this.#removeCell(previous.transform.position, id); this.#entities.delete(id); this.#revision += 1; return true;
  }
  get(id: EntityId): EntityState | null { return this.#entities.get(id) ?? null; }
  values(): readonly EntityState[] { return Object.freeze([...this.#entities.values()]); }
  activeCount(): number { return [...this.#entities.values()].reduce((n, e) => n + (e.active ? 1 : 0), 0); }
  queryRadius(center: Vec3, radius: number, limit = 512, maxCells = this.limits.maxCellsPerQuery): readonly EntityState[] {
    const r = clamp(radius, 0, 10000), candidates = new Set<EntityId>();
    const minX = Math.floor((center.x - r) / this.limits.cellSize), maxX = Math.floor((center.x + r) / this.limits.cellSize);
    const minY = Math.floor((center.y - r) / this.limits.cellSize), maxY = Math.floor((center.y + r) / this.limits.cellSize);
    const minZ = Math.floor((center.z - r) / this.limits.cellSize), maxZ = Math.floor((center.z + r) / this.limits.cellSize);
    const cellBudget = Math.max(1, Math.trunc(maxCells));
    let touched = 0;
    for (let x = minX; x <= maxX && touched < cellBudget; x += 1) {
      for (let y = minY; y <= maxY && touched < cellBudget; y += 1) {
        for (let z = minZ; z <= maxZ && touched < cellBudget; z += 1) {
          touched += 1; const cell = this.#cells.get(x + ':' + y + ':' + z); if (!cell) continue;
          for (const id of cell.ids) candidates.add(id);
        }
      }
    }
    return Object.freeze(stableSort([...candidates].map((id) => this.#entities.get(id)).filter((e): e is EntityState => Boolean(e))
      .filter((e) => vec3DistanceSquared(e.transform.position, center) <= r * r).slice(0, Math.max(1, Math.trunc(limit))),
      (a, b) => a.id.localeCompare(b.id)));
  }
  updateInterest(point: InterestPoint): number {
    let changed = 0;
    for (const entity of this.queryRadius(point.position, point.radius, this.limits.maxEntities, Number.MAX_SAFE_INTEGER)) {
      const distance = Math.sqrt(vec3DistanceSquared(entity.transform.position, point.position));
      const next = lodFor(distance / Math.max(0.25, point.weight));
      if (next !== entity.lod) { this.upsert(Object.freeze({ ...entity, lod: next, revision: (Number(entity.revision) + 1) as Revision })); changed += 1; }
    }
    return changed;
  }
  deltaSince(revisionValue: Revision, tick: Tick): readonly WorldDelta[] {
    return Object.freeze(stableSort([...this.#entities.values()].filter((e) => Number(e.revision) > Number(revisionValue)).map((e) => Object.freeze({
      entityId: e.id, revision: e.revision, tick, transform: e.transform, velocity: e.velocity, lod: e.lod, active: e.active, digest: hashJson(e),
    })), (a, b) => Number(a.revision) - Number(b.revision)));
  }
  snapshot(tick: Tick): WorldSnapshot {
    const entities = stableSort([...this.#entities.values()], (a, b) => a.id.localeCompare(b.id));
    return Object.freeze({ tick, revision: this.#revision as Revision, entities: Object.freeze(entities), digest: hashJson({ tick, revision: this.#revision, entities }) });
  }
  clear(): void { this.#entities.clear(); this.#cells.clear(); this.#revision = 0; }
  #addCell(position: Vec3, id: EntityId): void {
    const key = cellKey(position, this.limits.cellSize), current = this.#cells.get(key);
    if (current) current.ids.add(id); else this.#cells.set(key, { ids: new Set([id]) });
  }
  #removeCell(position: Vec3, id: EntityId): void {
    const key = cellKey(position, this.limits.cellSize), current = this.#cells.get(key); if (!current) return;
    current.ids.delete(id); if (current.ids.size === 0) this.#cells.delete(key);
  }
}
export interface WorldSnapshot { readonly tick: Tick; readonly revision: Revision; readonly entities: readonly EntityState[]; readonly digest: string; }

export class StimulusMemory {
  readonly maxEntries: number; readonly halfLifeTicks: number; #entries = new Map<string, { readonly stimulus: Stimulus; readonly confidence: number; readonly relevance: number; readonly ageTicks: number }>();
  constructor(maxEntries = 512, halfLifeTicks = 180) { this.maxEntries = Math.max(1, Math.trunc(maxEntries)); this.halfLifeTicks = Math.max(1, Math.trunc(halfLifeTicks)); }
  observe(stimulus: Stimulus, tick: Tick, relevance = 1): void {
    const age = Math.max(0, Number(tick) - Number(stimulus.expiresAtTick));
    this.#entries.set(stimulus.id, Object.freeze({ stimulus, confidence: decay(stimulus.confidence, this.halfLifeTicks, age), relevance: clamp(relevance, 0, 1), ageTicks: age }));
    while (this.#entries.size > this.maxEntries) {
      const oldest = [...this.#entries.entries()].sort((a, b) => b[1].ageTicks - a[1].ageTicks || a[0].localeCompare(b[0]))[0];
      if (oldest) this.#entries.delete(oldest[0]); else break;
    }
  }
  query(type?: Stimulus['type']): readonly Stimulus[] {
    return Object.freeze([...this.#entries.values()].filter((v) => !type || v.stimulus.type === type)
      .sort((a, b) => b.confidence * b.relevance - a.confidence * a.relevance || a.stimulus.id.localeCompare(b.stimulus.id)).map((v) => v.stimulus));
  }
  confidence(id: string): number { return this.#entries.get(id)?.confidence ?? 0; }
  forget(id: string): void { this.#entries.delete(id); }
  clear(): void { this.#entries.clear(); }
}

export class WorldSimulationBudget {
  readonly limits: Readonly<Record<EntityLod, number>>;
  constructor(limits: Partial<Record<EntityLod, number>> = {}) {
    this.limits = Object.freeze({ near: limits.near ?? 512, mid: limits.mid ?? 1024, far: limits.far ?? 2048, sleeping: limits.sleeping ?? 512 });
  }
  select(entities: readonly EntityState[], center: Vec3): readonly EntityState[] {
    const used: Record<EntityLod, number> = { near: 0, mid: 0, far: 0, sleeping: 0 };
    return Object.freeze(stableSort(entities, (a, b) => vec3DistanceSquared(a.transform.position, center) - vec3DistanceSquared(b.transform.position, center) || a.id.localeCompare(b.id))
      .filter((e) => used[e.lod]++ < Math.max(0, this.limits[e.lod])));
  }
}

export function transformVelocityDelta(transform: Transform, velocity: Velocity, dt: number): Transform {
  return Object.freeze({ ...transform, position: Object.freeze({ x: transform.position.x + velocity.linear.x * dt, y: transform.position.y + velocity.linear.y * dt, z: transform.position.z + velocity.linear.z * dt }) });
}
export function boundsAt(position: Vec3, radius: number): Bounds {
  const r = Math.max(0, radius);
  return Object.freeze({ min: Object.freeze({ x: position.x - r, y: position.y - r, z: position.z - r }), max: Object.freeze({ x: position.x + r, y: position.y + r, z: position.z + r }), radius: r });
}
export function makeEntity(id: EntityId, position: Vec3, velocity: Velocity, radius = 1): EntityState {
  return Object.freeze({ id, transform: Object.freeze({ position: Object.freeze({ ...position }), rotation: Object.freeze({ x: 0, y: 0, z: 0, w: 1 }), scale: Object.freeze({ x: 1, y: 1, z: 1 }) }),
    velocity, bounds: boundsAt(position, radius), lod: 'near', active: true, revision: 0 as Revision, tags: Object.freeze([]) });
}
