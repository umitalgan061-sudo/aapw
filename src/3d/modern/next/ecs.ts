import { componentType, entityId, type ComponentSchema, type ComponentType, type EntityId, type System, type SystemContext } from './types.ts';

interface EntityRecord { alive: boolean; generation: number; }
interface SparseComponent<T> { values: Map<EntityId, T>; schema: ComponentSchema<T>; }

export class EntityManager {
  #nextId = 1;
  #records = new Map<EntityId, EntityRecord>();
  #free: EntityId[] = [];

  create(): EntityId {
    const reused = this.#free.pop();
    const id = reused ?? entityId(this.#nextId++);
    const current = this.#records.get(id);
    this.#records.set(id, { alive: true, generation: (current?.generation ?? 0) + 1 });
    return id;
  }

  destroy(id: EntityId): boolean {
    const record = this.#records.get(id);
    if (!record?.alive) return false;
    record.alive = false;
    this.#free.push(id);
    return true;
  }

  isAlive(id: EntityId): boolean { return this.#records.get(id)?.alive === true; }
  generation(id: EntityId): number { return this.#records.get(id)?.generation ?? 0; }
  count(): number { return [...this.#records.values()].filter((record) => record.alive).length; }
  ids(): EntityId[] { return [...this.#records.entries()].filter(([, record]) => record.alive).map(([id]) => id).sort((a, b) => a - b); }
}

export class ComponentStore<T> {
  readonly schema: ComponentSchema<T>;
  readonly #values = new Map<EntityId, T>();

  constructor(schema: ComponentSchema<T> | { type: string; create: () => T; clone?: (value: T) => T }) {
    this.schema = { ...schema, type: componentType(String(schema.type)) } as ComponentSchema<T>;
  }

  set(id: EntityId, value?: T): T {
    const next = value === undefined ? this.schema.create() : value;
    this.#values.set(id, next);
    return next;
  }

  get(id: EntityId): T | undefined { return this.#values.get(id); }
  has(id: EntityId): boolean { return this.#values.has(id); }
  remove(id: EntityId): boolean { return this.#values.delete(id); }
  clear(): void { this.#values.clear(); }
  entries(): IterableIterator<[EntityId, T]> { return this.#values.entries(); }
  values(): IterableIterator<T> { return this.#values.values(); }
  size(): number { return this.#values.size; }
}

export interface QuerySpec { all: readonly ComponentType[]; none?: readonly ComponentType[]; }

export class EntityWorld {
  readonly entities = new EntityManager();
  #components = new Map<ComponentType, ComponentStore<unknown>>();
  #systems: System[] = [];
  #systemNames = new Set<string>();
  #systemOrderDirty = true;

  registerComponent<T>(schema: ComponentSchema<T>): ComponentStore<T> {
    const existing = this.#components.get(schema.type);
    if (existing) return existing as ComponentStore<T>;
    const store = new ComponentStore(schema);
    this.#components.set(schema.type, store as ComponentStore<unknown>);
    return store;
  }

  component<T>(type: ComponentType): ComponentStore<T> {
    const store = this.#components.get(type);
    if (!store) throw new Error(`Component not registered: ${type}`);
    return store as ComponentStore<T>;
  }

  createEntity(): EntityId { return this.entities.create(); }

  destroyEntity(id: EntityId): boolean {
    if (!this.entities.destroy(id)) return false;
    for (const store of this.#components.values()) store.remove(id);
    return true;
  }

  addSystem(system: System): void {
    if (this.#systemNames.has(system.name)) throw new Error(`System already registered: ${system.name}`);
    this.#systemNames.add(system.name);
    this.#systems.push(system);
    this.#systemOrderDirty = true;
  }

  removeSystem(name: string): boolean {
    const index = this.#systems.findIndex((system) => system.name === name);
    if (index < 0) return false;
    this.#systems.splice(index, 1);
    this.#systemNames.delete(name);
    return true;
  }

  update(context: SystemContext): void {
    if (this.#systemOrderDirty) {
      this.#systems.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
      this.#systemOrderDirty = false;
    }
    for (const system of this.#systems) system.update(context);
  }

  query(spec: QuerySpec): EntityId[] {
    const requiredStores = spec.all.map((type) => this.#components.get(type)).filter(Boolean) as ComponentStore<unknown>[];
    const excluded = spec.none ?? [];
    if (requiredStores.length === 0) return this.entities.ids().filter((id) => excluded.every((type) => !this.#components.get(type)?.has(id)));
    const [first, ...rest] = requiredStores;
    const result: EntityId[] = [];
    for (const [id] of first.entries()) {
      if (!this.entities.isAlive(id)) continue;
      if (!rest.every((store) => store.has(id))) continue;
      if (excluded.some((type) => this.#components.get(type)?.has(id))) continue;
      result.push(id);
    }
    result.sort((a, b) => a - b);
    return result;
  }

  forEach<T extends object>(type: ComponentType, callback: (id: EntityId, component: T) => void): void {
    const store = this.component<T>(type);
    for (const [id, value] of store.entries()) if (this.entities.isAlive(id)) callback(id, value);
  }

  snapshot<T>(type: ComponentType): Array<{ id: EntityId; value: T }> {
    const store = this.component<T>(type);
    const clone = store.schema.clone;
    return [...store.entries()]
      .filter(([id]) => this.entities.isAlive(id))
      .sort(([a], [b]) => a - b)
      .map(([id, value]) => ({ id, value: clone ? clone(value) : value }));
  }

  componentTypes(): ComponentType[] { return [...this.#components.keys()].sort(); }
}

export function defineComponent<T>(type: string, create: () => T, clone?: (value: T) => T): ComponentSchema<T> {
  return { type: componentType(type), create, clone };
}

export interface TransformComponent { position: { x: number; y: number; z: number }; rotationY: number; scale: number; }
export const Transform = defineComponent<TransformComponent>('transform', () => ({ position: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: 1 }), (value) => ({ position: { ...value.position }, rotationY: value.rotationY, scale: value.scale }));

export interface VelocityComponent { x: number; y: number; z: number; }
export const Velocity = defineComponent<VelocityComponent>('velocity', () => ({ x: 0, y: 0, z: 0 }), (value) => ({ ...value }));

export class MovementSystem implements System {
  readonly name = 'movement';
  readonly order = 100;
  constructor(private readonly world: EntityWorld) {}
  update(context: SystemContext): void {
    const transforms = this.world.component<TransformComponent>(Transform.type);
    const velocities = this.world.component<VelocityComponent>(Velocity.type);
    for (const [id, transform] of transforms.entries()) {
      if (!this.world.entities.isAlive(id)) continue;
      const velocity = velocities.get(id);
      if (!velocity) continue;
      transform.position.x += velocity.x * context.dtSeconds;
      transform.position.y += velocity.y * context.dtSeconds;
      transform.position.z += velocity.z * context.dtSeconds;
    }
  }
}
