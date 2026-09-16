import { EntityId, asEntityId, compareEntity, stableJson } from './contracts.ts';

export interface ComponentStorage<T extends object> {
  has(entity: EntityId): boolean;
  get(entity: EntityId): T | undefined;
  set(entity: EntityId, value: T): void;
  delete(entity: EntityId): boolean;
  entries(): IterableIterator<readonly [EntityId, T]>;
  size: number;
  clear(): void;
}

export class MapComponentStorage<T extends object> implements ComponentStorage<T> {
  readonly #values = new Map<EntityId, T>();
  has(entity: EntityId): boolean { return this.#values.has(entity); }
  get(entity: EntityId): T | undefined { return this.#values.get(entity); }
  set(entity: EntityId, value: T): void { this.#values.set(entity, Object.freeze({ ...value })); }
  delete(entity: EntityId): boolean { return this.#values.delete(entity); }
  entries(): IterableIterator<readonly [EntityId, T]> { return this.#values.entries(); }
  get size(): number { return this.#values.size; }
  clear(): void { this.#values.clear(); }
}

export interface EntityRecord {
  readonly id: EntityId;
  readonly generation: number;
  readonly alive: boolean;
  readonly createdTick: number;
}

export interface ComponentType<T extends object> {
  readonly id: string;
  readonly create: () => T;
  readonly storage: ComponentStorage<T>;
}

export interface QuerySpec {
  readonly all?: readonly string[];
  readonly any?: readonly string[];
  readonly none?: readonly string[];
}

export interface QueryResult {
  readonly entity: EntityId;
  readonly components: Readonly<Record<string, object>>;
}

export interface EcsMetrics {
  readonly entities: number;
  readonly alive: number;
  readonly components: number;
  readonly queries: number;
  readonly writes: number;
  readonly removals: number;
  readonly destroyed: number;
}

const freeze = <T>(value: T): T => Object.freeze(value);

export class EcsWorld {
  readonly #entities = new Map<EntityId, EntityRecord>();
  readonly #componentTypes = new Map<string, ComponentType<object>>();
  readonly #entityComponents = new Map<EntityId, Set<string>>();
  #nextEntity = 1;
  #queries = 0;
  #writes = 0;
  #removals = 0;
  #destroyed = 0;
  #tick = 0;

  registerComponent<T extends object>(id: string, create: () => T, storage: ComponentStorage<T> = new MapComponentStorage<T>()): ComponentType<T> {
    const key = id.trim();
    if (!key || this.#componentTypes.has(key)) throw new Error(`component type already registered: ${id}`);
    const definition: ComponentType<T> = freeze({ id: key, create, storage });
    this.#componentTypes.set(key, definition as ComponentType<object>);
    return definition;
  }

  createEntity(createdTick = this.#tick): EntityId {
    const id = asEntityId(this.#nextEntity++);
    const record = freeze({ id, generation: 1, alive: true, createdTick });
    this.#entities.set(id, record);
    this.#entityComponents.set(id, new Set());
    return id;
  }

  reserveEntities(count: number, createdTick = this.#tick): readonly EntityId[] {
    const amount = Math.max(0, Math.floor(count));
    const ids: EntityId[] = [];
    for (let index = 0; index < amount; index += 1) ids.push(this.createEntity(createdTick));
    return freeze(ids);
  }

  isAlive(entity: EntityId): boolean { return this.#entities.get(entity)?.alive === true; }

  destroyEntity(entity: EntityId): boolean {
    const record = this.#entities.get(entity);
    if (!record?.alive) return false;
    for (const typeId of this.#entityComponents.get(entity) ?? []) this.#componentTypes.get(typeId)?.storage.delete(entity);
    this.#entityComponents.delete(entity);
    this.#entities.set(entity, freeze({ ...record, generation: record.generation + 1, alive: false }));
    this.#destroyed += 1;
    return true;
  }

  add<T extends object>(entity: EntityId, type: ComponentType<T>, value?: T): T {
    this.assertAlive(entity);
    if (!this.#componentTypes.has(type.id)) throw new Error(`unregistered component type: ${type.id}`);
    const next = value === undefined ? type.create() : value;
    type.storage.set(entity, next);
    this.#entityComponents.get(entity)?.add(type.id);
    this.#writes += 1;
    return freeze({ ...next });
  }

  remove<T extends object>(entity: EntityId, type: ComponentType<T>): boolean {
    this.assertAlive(entity);
    const removed = type.storage.delete(entity);
    if (removed) {
      this.#entityComponents.get(entity)?.delete(type.id);
      this.#removals += 1;
    }
    return removed;
  }

  get<T extends object>(entity: EntityId, type: ComponentType<T>): T | undefined {
    return this.isAlive(entity) ? type.storage.get(entity) : undefined;
  }

  patch<T extends object>(entity: EntityId, type: ComponentType<T>, patch: Partial<T>): T {
    const previous = this.get(entity, type);
    if (!previous) throw new Error(`entity ${entity} has no ${type.id}`);
    const next = freeze({ ...previous, ...patch });
    type.storage.set(entity, next);
    this.#writes += 1;
    return next;
  }

  has(entity: EntityId, type: ComponentType<object>): boolean { return this.isAlive(entity) && type.storage.has(entity); }

  query(spec: QuerySpec = {}): readonly QueryResult[] {
    this.#queries += 1;
    const all = new Set(spec.all ?? []);
    const any = new Set(spec.any ?? []);
    const none = new Set(spec.none ?? []);
    const rows: QueryResult[] = [];
    const entities = [...this.#entities.keys()].sort(compareEntity);
    for (const entity of entities) {
      const record = this.#entities.get(entity);
      if (!record?.alive) continue;
      const present = this.#entityComponents.get(entity) ?? new Set<string>();
      if ([...all].some((id) => !present.has(id))) continue;
      if (any.size > 0 && ![...any].some((id) => present.has(id))) continue;
      if ([...none].some((id) => present.has(id))) continue;
      const components: Record<string, object> = {};
      for (const id of present) {
        const component = this.#componentTypes.get(id)?.storage.get(entity);
        if (component) components[id] = component;
      }
      rows.push(freeze({ entity, components: freeze(components) }));
    }
    return freeze(rows);
  }

  each(spec: QuerySpec, visit: (entity: EntityId, components: Readonly<Record<string, object>>) => void): void {
    for (const result of this.query(spec)) visit(result.entity, result.components);
  }

  setTick(tick: number): void { this.#tick = Math.max(0, Math.floor(tick)); }
  snapshot(): string {
    const entities = [...this.#entities.values()].sort((a, b) => a.id - b.id).map((entity) => ({ id: entity.id, generation: entity.generation, alive: entity.alive, createdTick: entity.createdTick, components: [...(this.#entityComponents.get(entity.id) ?? [])].sort() }));
    return stableJson({ tick: this.#tick, entities });
  }

  metrics(): EcsMetrics {
    let alive = 0;
    for (const entity of this.#entities.values()) if (entity.alive) alive += 1;
    let components = 0;
    for (const type of this.#componentTypes.values()) components += type.storage.size;
    return freeze({ entities: this.#entities.size, alive, components, queries: this.#queries, writes: this.#writes, removals: this.#removals, destroyed: this.#destroyed });
  }

  clear(): void {
    for (const type of this.#componentTypes.values()) type.storage.clear();
    this.#entities.clear();
    this.#entityComponents.clear();
    this.#nextEntity = 1;
    this.#queries = 0;
    this.#writes = 0;
    this.#removals = 0;
    this.#destroyed = 0;
  }

  private assertAlive(entity: EntityId): void { if (!this.isAlive(entity)) throw new Error(`entity ${entity} is not alive`); }
}

export interface TransformComponent { position: { x: number; y: number; z: number }; yaw: number; pitch: number }
export interface VelocityComponent { x: number; y: number; z: number; maxSpeed: number }
export interface LifetimeComponent { expiresAtTick: number }
export interface TagComponent { tags: readonly string[] }
export interface NetworkComponent { netId: number; revision: number; dirty: boolean }
export interface LodComponent { current: number; target: number; lastUpdateTick: number }

export const registerCoreComponents = (world: EcsWorld) => freeze({
  transform: world.registerComponent<TransformComponent>('transform', () => ({ position: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0 })),
  velocity: world.registerComponent<VelocityComponent>('velocity', () => ({ x: 0, y: 0, z: 0, maxSpeed: 5 })),
  lifetime: world.registerComponent<LifetimeComponent>('lifetime', () => ({ expiresAtTick: Number.POSITIVE_INFINITY })),
  tags: world.registerComponent<TagComponent>('tags', () => ({ tags: [] })),
  network: world.registerComponent<NetworkComponent>('network', () => ({ netId: 0, revision: 0, dirty: true })),
  lod: world.registerComponent<LodComponent>('lod', () => ({ current: 0, target: 0, lastUpdateTick: 0 })),
});

export const writeTransform = (world: EcsWorld, type: ComponentType<TransformComponent>, entity: EntityId, position: TransformComponent['position'], yaw = 0, pitch = 0): void => {
  if (!world.get(entity, type)) world.add(entity, type, { position, yaw, pitch });
  else world.patch(entity, type, { position, yaw, pitch });
};
