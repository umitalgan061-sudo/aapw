import type { Disposable, EntityId, TransformSnapshot, Vec3 } from './coreTypes.js';
import { ENTITY_ID, stableNumber } from './coreTypes.js';

export type InterestTier = 'near' | 'mid' | 'far' | 'sleeping';
export type WorldCellKey = `${number}:${number}:${number}`;

export interface WorldEntity {
  readonly id: EntityId;
  readonly position: Vec3;
  readonly radius: number;
  readonly layer: number;
  readonly tags: readonly string[];
  readonly active: boolean;
  readonly transform?: TransformSnapshot;
}

export interface InterestProfile {
  readonly nearRadius: number;
  readonly midRadius: number;
  readonly farRadius: number;
  readonly maxNear: number;
  readonly maxMid: number;
  readonly maxFar: number;
  readonly maxSleeping: number;
}

export interface InterestResult {
  readonly near: readonly EntityId[];
  readonly mid: readonly EntityId[];
  readonly far: readonly EntityId[];
  readonly sleeping: readonly EntityId[];
  readonly origin: Vec3;
  readonly touchedCells: number;
  readonly evaluated: number;
}

export interface StreamingRequest {
  readonly id: EntityId;
  readonly tier: InterestTier;
  readonly distance: number;
  readonly priority: number;
}

export interface StreamingStats {
  readonly entities: number;
  readonly cells: number;
  readonly visible: number;
  readonly active: number;
  readonly lastQueryCount: number;
  readonly lastTouchedCells: number;
}

const DEFAULT_PROFILE: InterestProfile = Object.freeze({
  nearRadius: 32,
  midRadius: 96,
  farRadius: 220,
  maxNear: 96,
  maxMid: 256,
  maxFar: 512,
  maxSleeping: 4096,
});

function distanceSquared(a: Vec3, b: Vec3): number {
  const x = a.x - b.x;
  const y = a.y - b.y;
  const z = a.z - b.z;
  return x * x + y * y + z * z;
}

function cellKey(position: Vec3, size: number): WorldCellKey {
  return `${Math.floor(position.x / size)}:${Math.floor(position.y / size)}:${Math.floor(position.z / size)}`;
}

function compareRequest(a: StreamingRequest, b: StreamingRequest): number {
  return b.priority - a.priority || a.distance - b.distance || String(a.id).localeCompare(String(b.id));
}

function tierFor(distance: number, profile: InterestProfile): InterestTier {
  if (distance <= profile.nearRadius) return 'near';
  if (distance <= profile.midRadius) return 'mid';
  if (distance <= profile.farRadius) return 'far';
  return 'sleeping';
}

export class WorldRuntime implements Disposable {
  readonly cellSize: number;
  #profile: InterestProfile;
  #entities = new Map<EntityId, WorldEntity>();
  #cells = new Map<WorldCellKey, Set<EntityId>>();
  #stats: StreamingStats = Object.freeze({ entities: 0, cells: 0, visible: 0, active: 0, lastQueryCount: 0, lastTouchedCells: 0 });

  constructor(cellSize = 32, profile: Partial<InterestProfile> = {}) {
    this.cellSize = Math.max(4, stableNumber(cellSize, 0.01));
    this.#profile = Object.freeze({ ...DEFAULT_PROFILE, ...profile });
  }

  get profile(): InterestProfile { return this.#profile; }

  register(entity: WorldEntity): boolean {
    if (this.#entities.has(entity.id)) return false;
    if (!Number.isFinite(entity.position.x) || !Number.isFinite(entity.position.y) || !Number.isFinite(entity.position.z)) return false;
    this.#entities.set(entity.id, Object.freeze({ ...entity, radius: Math.max(0, entity.radius), tags: Object.freeze([...entity.tags]) }));
    const key = cellKey(entity.position, this.cellSize);
    const cell = this.#cells.get(key) ?? new Set<EntityId>();
    cell.add(entity.id);
    this.#cells.set(key, cell);
    this.#refreshStats();
    return true;
  }

  update(entity: WorldEntity): boolean {
    const old = this.#entities.get(entity.id);
    if (!old) return false;
    const oldCell = cellKey(old.position, this.cellSize);
    const nextCell = cellKey(entity.position, this.cellSize);
    if (oldCell !== nextCell) {
      this.#cells.get(oldCell)?.delete(entity.id);
      if (this.#cells.get(oldCell)?.size === 0) this.#cells.delete(oldCell);
      const next = this.#cells.get(nextCell) ?? new Set<EntityId>();
      next.add(entity.id);
      this.#cells.set(nextCell, next);
    }
    this.#entities.set(entity.id, Object.freeze({ ...entity, radius: Math.max(0, entity.radius), tags: Object.freeze([...entity.tags]) }));
    this.#refreshStats();
    return true;
  }

  remove(id: EntityId): boolean {
    const entity = this.#entities.get(id);
    if (!entity) return false;
    this.#entities.delete(id);
    const key = cellKey(entity.position, this.cellSize);
    this.#cells.get(key)?.delete(id);
    if (this.#cells.get(key)?.size === 0) this.#cells.delete(key);
    this.#refreshStats();
    return true;
  }

  query(origin: Vec3, profile: Partial<InterestProfile> = {}): InterestResult {
    const activeProfile = { ...this.#profile, ...profile };
    const candidates = this.#collectCandidates(origin, activeProfile.farRadius);
    const requests: StreamingRequest[] = [];
    let evaluated = 0;
    for (const entity of candidates) {
      evaluated += 1;
      if (!entity.active) continue;
      const distance = Math.sqrt(distanceSquared(entity.position, origin));
      const tier = tierFor(distance, activeProfile);
      const tierWeight = tier === 'near' ? 1 : tier === 'mid' ? 0.65 : tier === 'far' ? 0.35 : 0;
      const priority = tierWeight * 100 + Math.max(0, 50 - distance) + entity.radius;
      requests.push({ id: entity.id, tier, distance, priority });
    }
    const grouped = {
      near: requests.filter(item => item.tier === 'near').sort(compareRequest).slice(0, activeProfile.maxNear).map(item => item.id),
      mid: requests.filter(item => item.tier === 'mid').sort(compareRequest).slice(0, activeProfile.maxMid).map(item => item.id),
      far: requests.filter(item => item.tier === 'far').sort(compareRequest).slice(0, activeProfile.maxFar).map(item => item.id),
      sleeping: requests.filter(item => item.tier === 'sleeping').sort(compareRequest).slice(0, activeProfile.maxSleeping).map(item => item.id),
    };
    const touchedCells = new Set(candidates.map(entity => cellKey(entity.position, this.cellSize))).size;
    this.#stats = Object.freeze({ ...this.#stats, visible: grouped.near.length + grouped.mid.length + grouped.far.length, lastQueryCount: evaluated, lastTouchedCells: touchedCells });
    return Object.freeze({
      near: Object.freeze(grouped.near),
      mid: Object.freeze(grouped.mid),
      far: Object.freeze(grouped.far),
      sleeping: Object.freeze(grouped.sleeping),
      origin: Object.freeze({ ...origin }),
      touchedCells,
      evaluated,
    });
  }

  streamingRequests(origin: Vec3): readonly StreamingRequest[] {
    const result = this.query(origin);
    const requests: StreamingRequest[] = [];
    for (const tier of ['near', 'mid', 'far', 'sleeping'] as const) {
      for (const id of result[tier]) {
        const entity = this.#entities.get(id);
        if (!entity) continue;
        const distance = Math.sqrt(distanceSquared(entity.position, origin));
        requests.push({ id, tier, distance, priority: tier === 'near' ? 100 : tier === 'mid' ? 60 : tier === 'far' ? 30 : 0 });
      }
    }
    return Object.freeze(requests.sort(compareRequest));
  }

  entity(id: EntityId): WorldEntity | undefined { return this.#entities.get(id); }
  entities(): readonly WorldEntity[] { return Object.freeze([...this.#entities.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)))); }
  stats(): StreamingStats { return this.#stats; }

  rayCandidate(origin: Vec3, direction: Vec3, maxDistance: number, maxResults = 64): readonly EntityId[] {
    const length = Math.hypot(direction.x, direction.y, direction.z) || 1;
    const dx = direction.x / length;
    const dy = direction.y / length;
    const dz = direction.z / length;
    const candidates: Array<{ id: EntityId; score: number }> = [];
    for (const entity of this.#entities.values()) {
      const vx = entity.position.x - origin.x;
      const vy = entity.position.y - origin.y;
      const vz = entity.position.z - origin.z;
      const along = vx * dx + vy * dy + vz * dz;
      if (along < 0 || along > maxDistance) continue;
      const px = vx - dx * along;
      const py = vy - dy * along;
      const pz = vz - dz * along;
      const lateral = Math.hypot(px, py, pz);
      if (lateral <= Math.max(entity.radius, 0.25)) candidates.push({ id: entity.id, score: along });
    }
    candidates.sort((a, b) => a.score - b.score || String(a.id).localeCompare(String(b.id)));
    return Object.freeze(candidates.slice(0, Math.max(1, maxResults)).map(item => item.id));
  }

  dispose(): void {
    this.#entities.clear();
    this.#cells.clear();
    this.#stats = Object.freeze({ entities: 0, cells: 0, visible: 0, active: 0, lastQueryCount: 0, lastTouchedCells: 0 });
  }

  #collectCandidates(origin: Vec3, radius: number): WorldEntity[] {
    const reach = Math.ceil(radius / this.cellSize);
    const baseX = Math.floor(origin.x / this.cellSize);
    const baseY = Math.floor(origin.y / this.cellSize);
    const baseZ = Math.floor(origin.z / this.cellSize);
    const candidates: WorldEntity[] = [];
    const radiusSq = radius * radius;
    for (let x = -reach; x <= reach; x += 1) {
      for (let y = -reach; y <= reach; y += 1) {
        for (let z = -reach; z <= reach; z += 1) {
          const cell = this.#cells.get(`${baseX + x}:${baseY + y}:${baseZ + z}` as WorldCellKey);
          if (!cell) continue;
          for (const id of cell) {
            const entity = this.#entities.get(id);
            if (entity && distanceSquared(entity.position, origin) <= (radius + entity.radius) ** 2 && distanceSquared(entity.position, origin) <= radiusSq * 1.1) candidates.push(entity);
          }
        }
      }
    }
    return candidates;
  }

  #refreshStats(): void {
    let active = 0;
    for (const entity of this.#entities.values()) if (entity.active) active += 1;
    this.#stats = Object.freeze({ ...this.#stats, entities: this.#entities.size, cells: this.#cells.size, active });
  }
}

export const makeEntityId = (value: string): EntityId => ENTITY_ID(value);
