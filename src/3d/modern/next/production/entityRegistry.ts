import { entityId, tick, type EntityId, type Tick, type Vec3 } from '../types.ts';
import type {
  EntityRuntimeState,
  EntityTransformState,
  ProductionEntitySeed,
  RuntimeFault,
  VisibilityClass,
} from './contracts.ts';
import { classifyDistance, normalizeEntitySeed } from './contracts.ts';

export interface EntityRegistryLimits {
  readonly maxEntities: number;
  readonly maxVisibleEntities: number;
  readonly maxRadiusMeters: number;
}

interface RegistryRecord {
  readonly id: EntityId;
  state: EntityRuntimeState;
  lastSeenFrame: number;
  dirty: boolean;
}

export interface EntityRegistryStats {
  readonly count: number;
  readonly dirty: number;
  readonly critical: number;
  readonly visible: number;
  readonly capacity: number;
}

export class ProductionEntityRegistry {
  readonly limits: EntityRegistryLimits;
  #records = new Map<EntityId, RegistryRecord>();
  #nextId = 1;
  #frame = 0;
  #faults: RuntimeFault[] = [];

  constructor(limits: Partial<EntityRegistryLimits> = {}) {
    this.limits = {
      maxEntities: Math.max(1, Math.floor(limits.maxEntities ?? 20_000)),
      maxVisibleEntities: Math.max(1, Math.floor(limits.maxVisibleEntities ?? 5_000)),
      maxRadiusMeters: Math.max(0.1, limits.maxRadiusMeters ?? 100),
    };
  }

  create(seed: ProductionEntitySeed = {}): EntityId {
    if (this.#records.size >= this.limits.maxEntities) {
      throw new Error('entity registry capacity exceeded');
    }
    const normalized = normalizeEntitySeed({ ...seed, id: seed.id || this.#nextId++ });
    const id = entityId(normalized.id);
    if (id === 0 || this.#records.has(id)) {
      return this.create({ ...seed, id: this.#nextFreeId() });
    }
    const transform: EntityTransformState = {
      id,
      position: normalized.position,
      velocity: normalized.velocity,
      yawRadians: normalized.yawRadians,
      radiusMeters: normalized.radiusMeters,
      visibility: 'hidden',
    };
    this.#records.set(id, {
      id,
      state: {
        transform,
        health: normalized.health,
        stamina: normalized.stamina,
        flags: normalized.flags,
        residency: 'unknown',
        updatedTick: tick(0),
      },
      lastSeenFrame: this.#frame,
      dirty: true,
    });
    this.#nextId = Math.max(this.#nextId, id + 1);
    return id;
  }

  upsert(seed: ProductionEntitySeed): EntityId {
    if (seed.id !== undefined && this.#records.has(entityId(seed.id))) {
      const id = entityId(seed.id);
      const current = this.#records.get(id)!;
      const normalized = normalizeEntitySeed({ ...seed, id });
      current.state = {
        ...current.state,
        transform: {
          ...current.state.transform,
          position: normalized.position,
          velocity: normalized.velocity,
          yawRadians: normalized.yawRadians,
          radiusMeters: normalized.radiusMeters,
        },
        health: normalized.health,
        stamina: normalized.stamina,
        flags: normalized.flags,
      };
      current.lastSeenFrame = this.#frame;
      current.dirty = true;
      return id;
    }
    return this.create(seed);
  }

  remove(id: number): boolean {
    return this.#records.delete(entityId(id));
  }

  has(id: number): boolean {
    return this.#records.has(entityId(id));
  }

  get(id: number): EntityRuntimeState | undefined {
    return this.#records.get(entityId(id))?.state;
  }

  mutate(id: number, updater: (state: EntityRuntimeState) => EntityRuntimeState): boolean {
    const record = this.#records.get(entityId(id));
    if (!record) return false;
    const next = updater(record.state);
    record.state = normalizeEntityRuntimeState(next);
    record.dirty = true;
    record.lastSeenFrame = this.#frame;
    return true;
  }

  move(id: number, position: Partial<Vec3>, velocity?: Partial<Vec3>, tickValue: Tick = tick(0)): boolean {
    return this.mutate(id, (state) => ({
      ...state,
      transform: {
        ...state.transform,
        position: { ...state.transform.position, ...position },
        velocity: velocity ? { ...state.transform.velocity, ...velocity } : state.transform.velocity,
      },
      updatedTick: tickValue,
    }));
  }

  setVisibility(id: number, visibility: VisibilityClass): boolean {
    return this.mutate(id, (state) => ({ ...state, transform: { ...state.transform, visibility } }));
  }

  setResidency(id: number, residency: EntityRuntimeState['residency']): boolean {
    return this.mutate(id, (state) => ({ ...state, residency }));
  }

  frameUpdate(
    frame: number,
    tickValue: Tick,
    camera: Vec3,
    visibleDistanceMeters: number,
  ): void {
    this.#frame = Math.max(this.#frame, Math.floor(frame));
    const visible = this.#records.values();
    const candidates: RegistryRecord[] = [];
    for (const record of visible) {
      const state = record.state;
      const dx = state.transform.position.x - camera.x;
      const dy = state.transform.position.y - camera.y;
      const dz = state.transform.position.z - camera.z;
      const distance = Math.hypot(dx, dy, dz);
      const nextVisibility = distance <= visibleDistanceMeters
        ? classifyDistance(distance)
        : 'hidden';
      if (nextVisibility !== state.transform.visibility) {
        record.state = {
          ...state,
          transform: { ...state.transform, visibility: nextVisibility },
          updatedTick: tickValue,
        };
        record.dirty = true;
      }
      if (nextVisibility !== 'hidden') candidates.push(record);
    }
    candidates.sort((a, b) => {
      const aRank = visibilityRank(a.state.transform.visibility);
      const bRank = visibilityRank(b.state.transform.visibility);
      return bRank - aRank || a.id - b.id;
    });
    const visibleIds = new Set(candidates.slice(0, this.limits.maxVisibleEntities).map((record) => record.id));
    for (const record of candidates) {
      const wanted = visibleIds.has(record.id);
      if (!wanted && record.state.transform.visibility !== 'hidden') {
        record.state = {
          ...record.state,
          transform: { ...record.state.transform, visibility: 'hidden' },
          updatedTick: tickValue,
        };
        record.dirty = true;
      }
      record.lastSeenFrame = this.#frame;
    }
  }

  dirtyStates(clear = false): EntityRuntimeState[] {
    const result = [...this.#records.values()]
      .filter((record) => record.dirty)
      .sort((a, b) => a.id - b.id)
      .map((record) => cloneEntityState(record.state));
    if (clear) for (const record of this.#records.values()) record.dirty = false;
    return result;
  }

  all(): EntityRuntimeState[] {
    return [...this.#records.values()].sort((a, b) => a.id - b.id).map((record) => cloneEntityState(record.state));
  }

  stats(): EntityRegistryStats {
    let critical = 0;
    let visible = 0;
    let dirty = 0;
    for (const record of this.#records.values()) {
      if (record.state.transform.visibility === 'critical') critical += 1;
      if (record.state.transform.visibility !== 'hidden') visible += 1;
      if (record.dirty) dirty += 1;
    }
    return { count: this.#records.size, dirty, critical, visible, capacity: this.limits.maxEntities };
  }

  markClean(): void {
    for (const record of this.#records.values()) record.dirty = false;
  }

  clear(): void {
    this.#records.clear();
    this.#nextId = 1;
    this.#frame = 0;
  }

  faults(): readonly RuntimeFault[] {
    return this.#faults.slice(-32);
  }

  recordFault(fault: RuntimeFault): void {
    this.#faults.push(fault);
    if (this.#faults.length > 32) this.#faults.shift();
  }

  snapshot(): EntityRuntimeState[] {
    return this.all();
  }

  restore(states: readonly EntityRuntimeState[]): void {
    this.clear();
    for (const state of states.slice(0, this.limits.maxEntities)) {
      const id = entityId(state.transform.id);
      if (id === 0 || this.#records.has(id)) continue;
      this.#records.set(id, {
        id,
        state: normalizeEntityRuntimeState(state),
        lastSeenFrame: this.#frame,
        dirty: true,
      });
      this.#nextId = Math.max(this.#nextId, id + 1);
    }
  }

  visibleIds(): number[] {
    return [...this.#records.values()]
      .filter((record) => record.state.transform.visibility !== 'hidden')
      .map((record) => record.id)
      .sort((a, b) => a - b);
  }

  #nextFreeId(): number {
    while (this.#records.has(entityId(this.#nextId))) this.#nextId += 1;
    return this.#nextId++;
  }
}

function cloneEntityState(state: EntityRuntimeState): EntityRuntimeState {
  return {
    transform: {
      ...state.transform,
      position: { ...state.transform.position },
      velocity: { ...state.transform.velocity },
    },
    health: state.health,
    stamina: state.stamina,
    flags: state.flags,
    residency: state.residency,
    updatedTick: state.updatedTick,
  };
}

function normalizeEntityRuntimeState(state: EntityRuntimeState): EntityRuntimeState {
  return {
    transform: {
      ...state.transform,
      position: {
        x: Number.isFinite(state.transform.position.x) ? state.transform.position.x : 0,
        y: Number.isFinite(state.transform.position.y) ? state.transform.position.y : 0,
        z: Number.isFinite(state.transform.position.z) ? state.transform.position.z : 0,
      },
      velocity: {
        x: Number.isFinite(state.transform.velocity.x) ? state.transform.velocity.x : 0,
        y: Number.isFinite(state.transform.velocity.y) ? state.transform.velocity.y : 0,
        z: Number.isFinite(state.transform.velocity.z) ? state.transform.velocity.z : 0,
      },
      radiusMeters: Math.min(100, Math.max(0.05, state.transform.radiusMeters)),
    },
    health: Math.max(0, state.health),
    stamina: Math.max(0, state.stamina),
    flags: state.flags >>> 0,
    residency: state.residency,
    updatedTick: state.updatedTick,
  };
}

function visibilityRank(value: VisibilityClass): number {
  switch (value) {
    case 'critical': return 5;
    case 'near': return 4;
    case 'mid': return 3;
    case 'far': return 2;
    case 'hidden': return 0;
  }
}
