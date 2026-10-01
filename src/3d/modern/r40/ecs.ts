import type { EntityId, EntityLod, EntityState, Tick, Vec3 } from './types';
import { cloneEntityState, entityId } from './types';
import { stableSort, hashJson } from './deterministic';

export interface ComponentMap<T> { readonly entity: EntityId; readonly value: T; }
export type System<T = void> = (world: EcsWorld, tick: Tick, dt: number) => T;
export interface EcsStats { readonly entities: number; readonly components: number; readonly systems: number; readonly digest: string; }

export class EcsWorld {
  readonly maxEntities: number;
  #entities = new Map<EntityId, EntityState>();
  #components = new Map<string, Map<EntityId, unknown>>();
  #systems: { readonly id: string; readonly run: System }[] = [];
  constructor(maxEntities = 100000) { this.maxEntities = Math.max(1, Math.trunc(maxEntities)); }

  spawn(entity: EntityState): boolean {
    if (this.#entities.size >= this.maxEntities && !this.#entities.has(entity.id)) return false;
    if (this.#entities.has(entity.id)) return false;
    this.#entities.set(entity.id, cloneEntityState(entity)); return true;
  }
  destroy(id: EntityId): boolean {
    const deleted = this.#entities.delete(id);
    for (const component of this.#components.values()) component.delete(id);
    return deleted;
  }
  get(id: EntityId): EntityState | null { return this.#entities.get(id) ?? null; }
  set(entity: EntityState): boolean { if (!this.#entities.has(entity.id)) return false; this.#entities.set(entity.id, cloneEntityState(entity)); return true; }
  query(predicate: (entity: EntityState) => boolean, limit = 4096): readonly EntityState[] {
    return Object.freeze(stableSort([...this.#entities.values()].filter(predicate).slice(0, Math.max(1, Math.trunc(limit))), (a, b) => a.id.localeCompare(b.id)));
  }
  addComponent<T>(name: string, entity: EntityId, value: T): boolean {
    if (!this.#entities.has(entity) || !/^[A-Za-z0-9_.:-]{1,64}$/.test(name)) return false;
    const storage = this.#components.get(name) ?? new Map<EntityId, unknown>();
    storage.set(entity, value); this.#components.set(name, storage); return true;
  }
  getComponent<T>(name: string, entity: EntityId): T | null { return (this.#components.get(name)?.get(entity) as T | undefined) ?? null; }
  removeComponent(name: string, entity: EntityId): boolean { return this.#components.get(name)?.delete(entity) ?? false; }
  registerSystem(id: string, run: System): boolean {
    if (!id || this.#systems.some((system) => system.id === id)) return false;
    this.#systems.push(Object.freeze({ id, run })); return true;
  }
  step(tick: Tick, dt: number): void {
    for (const system of stableSort(this.#systems, (a, b) => a.id.localeCompare(b.id))) system.run(this, tick, dt);
  }
  stats(): EcsStats {
    const componentCount = [...this.#components.values()].reduce((sum, storage) => sum + storage.size, 0);
    return Object.freeze({ entities: this.#entities.size, components: componentCount, systems: this.#systems.length, digest: hashJson({ entities: [...this.#entities.keys()].sort(), componentCount, systems: this.#systems.map((s) => s.id).sort() }) });
  }
  clear(): void { this.#entities.clear(); this.#components.clear(); this.#systems.length = 0; }
}

export function defaultPlayerEntity(id = entityId('player-r40'), position: Vec3 = { x: 0, y: 0, z: 0 }): EntityState {
  return Object.freeze({
    id,
    transform: Object.freeze({ position: Object.freeze({ ...position }), rotation: Object.freeze({ x: 0, y: 0, z: 0, w: 1 }), scale: Object.freeze({ x: 1, y: 1, z: 1 }) }),
    velocity: Object.freeze({ linear: Object.freeze({ x: 0, y: 0, z: 0 }), angular: Object.freeze({ x: 0, y: 0, z: 0 }) }),
    bounds: Object.freeze({ min: Object.freeze({ x: position.x - 1, y: position.y - 1, z: position.z - 1 }), max: Object.freeze({ x: position.x + 1, y: position.y + 1, z: position.z + 1 }), radius: 1 }),
    lod: 'near' as EntityLod,
    active: true,
    revision: 0 as never,
    tags: Object.freeze(['player']),
  });
}
