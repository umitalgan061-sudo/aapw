import type { EntityId, Result, Vec3 } from './types';
import { createSeededId, hash32 } from './deterministic';

export interface PositionComponent { position: Vec3 }
export interface VelocityComponent { velocity: Vec3 }
export interface HealthComponent { current: number; max: number }
export interface ActiveComponent { active: boolean }

export interface ComponentSchemaMap {
  position: PositionComponent;
  velocity: VelocityComponent;
  health: HealthComponent;
  active: ActiveComponent;
}

export type ComponentKey = keyof ComponentSchemaMap;
export type ComponentValue<K extends ComponentKey> = ComponentSchemaMap[K];

export interface EntitySnapshot {
  readonly id: EntityId;
  readonly components: Readonly<Record<string, unknown>>;
}

/** Lightweight ECS registry optimized for stable IDs, sparse components and deterministic iteration. */
export class EntityWorld {
  #entities = new Set<EntityId>();
  #components = new Map<string, Map<EntityId, unknown>>();
  #seed: number;
  #sequence = 0;

  constructor(seed = 0x57455354) {
    this.#seed = seed;
  }

  create(id?: EntityId): EntityId {
    const entity = id ?? createSeededId('entity', this.#seed, this.#sequence++) as EntityId;
    if (this.#entities.has(entity)) throw new Error(`Entity already exists: ${entity}`);
    this.#entities.add(entity);
    return entity;
  }

  exists(id: EntityId): boolean { return this.#entities.has(id); }

  destroy(id: EntityId): boolean {
    if (!this.#entities.delete(id)) return false;
    for (const store of this.#components.values()) store.delete(id);
    return true;
  }

  add<K extends ComponentKey>(entity: EntityId, component: K, value: ComponentValue<K>): void {
    this.#assertEntity(entity);
    const store = this.#store(component);
    if (store.has(entity)) throw new Error(`Component ${String(component)} already exists on ${entity}`);
    store.set(entity, structuredClone(value));
  }

  set<K extends ComponentKey>(entity: EntityId, component: K, value: ComponentValue<K>): void {
    this.#assertEntity(entity);
    this.#store(component).set(entity, structuredClone(value));
  }

  get<K extends ComponentKey>(entity: EntityId, component: K): ComponentValue<K> | undefined {
    const value = this.#store(component).get(entity) as ComponentValue<K> | undefined;
    return value === undefined ? undefined : structuredClone(value);
  }

  has<K extends ComponentKey>(entity: EntityId, component: K): boolean {
    return this.#store(component).has(entity);
  }

  remove<K extends ComponentKey>(entity: EntityId, component: K): boolean {
    return this.#store(component).delete(entity);
  }

  query<K extends readonly ComponentKey[]>(components: K): readonly EntityId[] {
    if (components.length === 0) return [...this.#entities].sort();
    const stores = components.map((component) => this.#store(component));
    const smallest = stores.reduce((a, b) => a.size <= b.size ? a : b);
    return [...smallest.keys()].filter((entity) => stores.every((store) => store.has(entity))).sort();
  }

  snapshot(): readonly EntitySnapshot[] {
    const entities = [...this.#entities].sort();
    return entities.map((id) => {
      const components: Record<string, unknown> = {};
      for (const [name, store] of this.#components) {
        const value = store.get(id);
        if (value !== undefined) components[name] = structuredClone(value);
      }
      return { id, components };
    });
  }

  checksum(): number {
    return hash32(JSON.stringify(this.snapshot()));
  }

  clear(): void {
    this.#entities.clear();
    this.#components.clear();
    this.#sequence = 0;
  }

  #store<K extends ComponentKey>(component: K): Map<EntityId, ComponentValue<K>> {
    const existing = this.#components.get(component);
    if (existing) return existing as Map<EntityId, ComponentValue<K>>;
    const created = new Map<EntityId, ComponentValue<K>>();
    this.#components.set(component, created);
    return created;
  }

  #assertEntity(entity: EntityId): void {
    if (!this.#entities.has(entity)) throw new Error(`Unknown entity: ${entity}`);
  }
}
