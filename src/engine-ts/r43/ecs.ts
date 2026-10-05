import type { ComponentKey, EntityId } from './contracts.ts';

const EMPTY_ENTITY = -1;

export interface ComponentStoreSnapshot<T> {
  readonly key: ComponentKey;
  readonly entries: readonly (readonly [EntityId, T])[];
}

export class ComponentStore<T> {
  readonly key: ComponentKey;

  #values = new Map<EntityId, T>();

  constructor(key: ComponentKey) {
    this.key = key;
  }

  set(entity: EntityId, value: T): void {
    if (!Number.isInteger(entity) || entity < 0) throw new Error('Invalid entity id');
    this.#values.set(entity, value);
  }

  get(entity: EntityId): T | undefined {
    return this.#values.get(entity);
  }

  has(entity: EntityId): boolean {
    return this.#values.has(entity);
  }

  delete(entity: EntityId): boolean {
    return this.#values.delete(entity);
  }

  clear(): void {
    this.#values.clear();
  }

  size(): number {
    return this.#values.size;
  }

  entities(): readonly EntityId[] {
    return Object.freeze([...this.#values.keys()].sort((a, b) => a - b));
  }

  entries(): readonly (readonly [EntityId, T])[] {
    return Object.freeze(
      [...this.#values.entries()]
        .sort(([a], [b]) => a - b)
        .map(([entity, value]) => [entity, value] as const),
    );
  }

  snapshot(): ComponentStoreSnapshot<T> {
    return Object.freeze({
      key: this.key,
      entries: this.entries(),
    });
  }
}

export interface QueryResult {
  readonly entities: readonly EntityId[];
  readonly stores: readonly ComponentStore<unknown>[];
}

export class EcsWorld {
  #nextEntity = 1;
  #alive = new Set<EntityId>();
  #free: number[] = [];
  #stores = new Map<ComponentKey, ComponentStore<unknown>>();
  #componentFactories = new Map<ComponentKey, () => unknown>();

  create(): EntityId {
    const recycled = this.#free.pop();
    const entity = recycled ?? this.#nextEntity++;
    this.#alive.add(entity);
    return entity;
  }

  destroy(entity: EntityId): boolean {
    if (!this.#alive.delete(entity)) return false;
    for (const store of this.#stores.values()) store.delete(entity);
    this.#free.push(entity);
    this.#free.sort((a, b) => b - a);
    return true;
  }

  alive(entity: EntityId): boolean {
    return this.#alive.has(entity);
  }

  aliveEntities(): readonly EntityId[] {
    return Object.freeze([...this.#alive].sort((a, b) => a - b));
  }

  defineComponent<T>(key: ComponentKey, factory?: () => T): ComponentStore<T> {
    if (this.#stores.has(key)) throw new Error('Component already defined: ' + key);
    const store = new ComponentStore<T>(key);
    this.#stores.set(key, store as ComponentStore<unknown>);
    if (factory) this.#componentFactories.set(key, factory);
    return store;
  }

  component<T>(key: ComponentKey): ComponentStore<T> {
    const existing = this.#stores.get(key);
    if (!existing) {
      const factory = this.#componentFactories.get(key);
      if (!factory) throw new Error('Unknown component: ' + key);
      return this.defineComponent<T>(key, factory);
    }
    return existing as ComponentStore<T>;
  }

  removeComponent(entity: EntityId, key: ComponentKey): boolean {
    return this.#stores.get(key)?.delete(entity) ?? false;
  }

  addComponent<T>(entity: EntityId, key: ComponentKey, value: T): void {
    if (!this.alive(entity)) throw new Error('Entity is not alive: ' + entity);
    this.component<T>(key).set(entity, value);
  }

  getComponent<T>(entity: EntityId, key: ComponentKey): T | undefined {
    return this.#stores.get(key)?.get(entity) as T | undefined;
  }

  hasComponent(entity: EntityId, key: ComponentKey): boolean {
    return this.#stores.get(key)?.has(entity) ?? false;
  }

  query(...keys: readonly ComponentKey[]): QueryResult {
    const stores = keys.map((key) => this.#stores.get(key)).filter(Boolean) as ComponentStore<unknown>[];
    if (stores.length !== keys.length) return Object.freeze({ entities: [], stores: [] });
    const [driver] = [...stores].sort((a, b) => a.size() - b.size());
    if (!driver) return Object.freeze({ entities: [], stores: [] });
    const entities = driver.entities().filter((entity) => stores.every((store) => store.has(entity)));
    return Object.freeze({ entities: Object.freeze(entities), stores: Object.freeze(stores) });
  }

  count(): number {
    return this.#alive.size;
  }

  componentCount(): number {
    return this.#stores.size;
  }

  clear(): void {
    this.#alive.clear();
    this.#stores.clear();
    this.#componentFactories.clear();
    this.#free = [];
    this.#nextEntity = 1;
  }

  snapshot(): readonly ComponentStoreSnapshot<unknown>[] {
    return Object.freeze(
      [...this.#stores.values()]
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((store) => store.snapshot()),
    );
  }

  restore(snapshot: {
    readonly entities: readonly EntityId[];
    readonly stores: readonly ComponentStoreSnapshot<unknown>[];
  }): void {
    this.clear();
    for (const entity of [...snapshot.entities].sort((a, b) => a - b)) {
      while (this.#nextEntity <= entity) this.#nextEntity += 1;
      this.#alive.add(entity);
    }
    for (const storeSnapshot of snapshot.stores) {
      const store = this.defineComponent<unknown>(storeSnapshot.key);
      for (const [entity, value] of storeSnapshot.entries) {
        if (this.alive(entity)) store.set(entity, value);
      }
    }
    this.#nextEntity = Math.max(this.#nextEntity, ...this.#alive, 0) + 1;
  }
}

export function recycleEntityId(entity: EntityId): EntityId {
  return Number.isInteger(entity) && entity >= 0 ? entity : EMPTY_ENTITY;
}
