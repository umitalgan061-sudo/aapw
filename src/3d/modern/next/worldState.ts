import { deterministicChecksum } from './determinism.ts';
import type { EntityId, Tick, Vec3 } from './types.ts';

export interface WorldEntityState {
  readonly id: EntityId;
  position: Vec3;
  rotationY: number;
  velocity: Vec3;
  health: number;
  stamina: number;
  flags: number;
}

export interface WorldStateSnapshot {
  readonly tick: Tick;
  readonly entities: readonly WorldEntityState[];
  readonly checksum: string;
}

export class WorldStateStore {
  #entities = new Map<EntityId, WorldEntityState>();
  #tick: Tick = 0 as Tick;

  setTick(tickValue: Tick): void { this.#tick = tickValue; }
  get tick(): Tick { return this.#tick; }

  upsert(entity: WorldEntityState): void {
    this.#entities.set(entity.id, {
      ...entity,
      position: { ...entity.position },
      velocity: { ...entity.velocity },
      health: Math.max(0, entity.health),
      stamina: Math.max(0, entity.stamina),
      flags: entity.flags >>> 0,
    });
  }

  get(id: EntityId): WorldEntityState | undefined {
    const entity = this.#entities.get(id);
    return entity ? { ...entity, position: { ...entity.position }, velocity: { ...entity.velocity } } : undefined;
  }

  remove(id: EntityId): boolean { return this.#entities.delete(id); }
  has(id: EntityId): boolean { return this.#entities.has(id); }
  size(): number { return this.#entities.size; }

  mutate(id: EntityId, updater: (entity: WorldEntityState) => void): boolean {
    const entity = this.#entities.get(id);
    if (!entity) return false;
    updater(entity);
    entity.health = Math.max(0, entity.health);
    entity.stamina = Math.max(0, entity.stamina);
    return true;
  }

  snapshot(): WorldStateSnapshot {
    const entities = [...this.#entities.values()].sort((a, b) => a.id - b.id).map((entity) => ({
      ...entity,
      position: { ...entity.position },
      velocity: { ...entity.velocity },
    }));
    const checksum = deterministicChecksum([this.#tick, ...entities.flatMap((entity) => [entity.id, entity.position.x, entity.position.y, entity.position.z, entity.rotationY, entity.velocity.x, entity.velocity.y, entity.velocity.z, entity.health, entity.stamina, entity.flags])]);
    return { tick: this.#tick, entities, checksum };
  }

  restore(snapshot: WorldStateSnapshot): void {
    this.#entities.clear();
    this.#tick = snapshot.tick;
    for (const entity of snapshot.entities) this.upsert(entity);
    if (this.snapshot().checksum !== snapshot.checksum) throw new Error('world snapshot checksum mismatch');
  }

  clear(): void { this.#entities.clear(); this.#tick = 0 as Tick; }
}

export interface WorldPatch { readonly id: EntityId; readonly changes: Partial<Omit<WorldEntityState, 'id'>>; }

export function applyWorldPatch(store: WorldStateStore, patch: WorldPatch): boolean {
  return store.mutate(patch.id, (entity) => {
    if (patch.changes.position) entity.position = { ...patch.changes.position };
    if (patch.changes.velocity) entity.velocity = { ...patch.changes.velocity };
    if (patch.changes.rotationY !== undefined) entity.rotationY = patch.changes.rotationY;
    if (patch.changes.health !== undefined) entity.health = patch.changes.health;
    if (patch.changes.stamina !== undefined) entity.stamina = patch.changes.stamina;
    if (patch.changes.flags !== undefined) entity.flags = patch.changes.flags;
  });
}
