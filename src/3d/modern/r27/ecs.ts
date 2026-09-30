import {
  componentType,
  entityId,
  type ComponentType,
  type EntityId,
  type RuntimeEvent,
} from './contracts.ts';

type Constructor<T> = new (...args: never[]) => T;

interface ComponentBucket<T> {
  readonly type: ComponentType;
  readonly values: Map<EntityId, T>;
}

export interface EntityView {
  readonly id: EntityId;
  readonly components: Readonly<Record<string, unknown>>;
}

export type EntityPredicate = (entity: EntityView) => boolean;

export class ComponentStore<T extends object> {
  readonly type: ComponentType;
  readonly values = new Map<EntityId, T>();

  constructor(type: ComponentType) {
    this.type = type;
  }

  set(entity: EntityId, value: T): void {
    this.values.set(entity, value);
  }

  get(entity: EntityId): T | undefined {
    return this.values.get(entity);
  }

  has(entity: EntityId): boolean {
    return this.values.has(entity);
  }

  remove(entity: EntityId): boolean {
    return this.values.delete(entity);
  }

  clear(): void {
    this.values.clear();
  }

  entries(): readonly (readonly [EntityId, T])[] {
    return [...this.values.entries()].sort(([a], [b]) => Number(a) - Number(b));
  }

  size(): number {
    return this.values.size;
  }
}

export interface QueryResult {
  readonly entities: readonly EntityId[];
  readonly count: number;
}

export interface WorldCommand {
  readonly kind: 'spawn' | 'destroy' | 'set' | 'remove';
  readonly entity?: EntityId;
  readonly type?: ComponentType;
  readonly value?: object;
}

export class EntityWorld {
  #nextEntity = 1;
  #alive = new Set<EntityId>();
  #components = new Map<ComponentType, ComponentStore<object>>();
  #commands: WorldCommand[] = [];

  create(): EntityId {
    const id = entityId(this.#nextEntity++);
    this.#alive.add(id);
    return id;
  }

  createDeferred(): void {
    this.#commands.push({ kind: 'spawn' });
  }

  destroy(entity: EntityId): boolean {
    if (!this.#alive.delete(entity)) return false;
    for (const store of this.#components.values()) store.remove(entity);
    return true;
  }

  destroyDeferred(entity: EntityId): void {
    this.#commands.push({ kind: 'destroy', entity });
  }

  isAlive(entity: EntityId): boolean {
    return this.#alive.has(entity);
  }

  aliveEntities(): readonly EntityId[] {
    return [...this.#alive].sort((a, b) => Number(a) - Number(b));
  }

  registerComponent<T extends object>(
    type: ComponentType | string,
  ): ComponentStore<T> {
    const key = typeof type === 'string' ? componentType(type) : type;
    const existing = this.#components.get(key);
    if (existing) return existing as ComponentStore<T>;
    const store = new ComponentStore<T>(key);
    this.#components.set(key, store as ComponentStore<object>);
    return store;
  }

  store<T extends object>(type: ComponentType): ComponentStore<T> {
    return this.registerComponent<T>(type);
  }

  set<T extends object>(entity: EntityId, type: ComponentType | string, value: T): void {
    if (!this.isAlive(entity)) throw new Error('Cannot set a component on a dead entity');
    this.registerComponent<T>(type).set(entity, value);
  }

  setDeferred<T extends object>(entity: EntityId, type: ComponentType | string, value: T): void {
    const key = typeof type === 'string' ? componentType(type) : type;
    this.#commands.push({ kind: 'set', entity, type: key, value });
  }

  get<T extends object>(entity: EntityId, type: ComponentType): T | undefined {
    return this.#components.get(type)?.get(entity) as T | undefined;
  }

  has(entity: EntityId, type: ComponentType): boolean {
    return this.#components.get(type)?.has(entity) ?? false;
  }

  remove(entity: EntityId, type: ComponentType): boolean {
    return this.#components.get(type)?.remove(entity) ?? false;
  }

  removeDeferred(entity: EntityId, type: ComponentType): void {
    this.#commands.push({ kind: 'remove', entity, type });
  }

  query(required: readonly ComponentType[], predicate?: EntityPredicate): QueryResult {
    if (required.length === 0) return { entities: this.aliveEntities(), count: this.#alive.size };

    const stores = required.map((type) => this.#components.get(type)).filter(Boolean) as ComponentStore<object>[];
    if (stores.length !== required.length) return { entities: [], count: 0 };

    const smallest = stores.reduce((best, next) => (next.size() < best.size() ? next : best));
    const candidates = smallest.entries().map(([entity]) => entity);
    const result: EntityId[] = [];

    for (const entity of candidates) {
      if (!this.isAlive(entity)) continue;
      if (!stores.every((store) => store.has(entity))) continue;
      if (predicate) {
        const components = Object.fromEntries(
          required.map((type) => [String(type), this.#components.get(type)?.get(entity)]),
        );
        if (!predicate({ id: entity, components })) continue;
      }
      result.push(entity);
    }

    result.sort((a, b) => Number(a) - Number(b));
    return { entities: result, count: result.length };
  }

  flushCommands(limit = 2048): readonly RuntimeEvent[] {
    const events: RuntimeEvent[] = [];
    const commands = this.#commands.splice(0, Math.max(0, limit));
    for (const command of commands) {
      switch (command.kind) {
        case 'spawn': {
          const id = this.create();
          events.push({ type: 'entity-created', entity: id });
          break;
        }
        case 'destroy': {
          if (command.entity && this.destroy(command.entity)) {
            events.push({ type: 'entity-destroyed', entity: command.entity });
          }
          break;
        }
        case 'set': {
          if (!command.entity || !command.type || !command.value) break;
          if (!this.isAlive(command.entity)) break;
          this.registerComponent(command.type).set(command.entity, command.value);
          break;
        }
        case 'remove': {
          if (command.entity && command.type) this.remove(command.entity, command.type);
          break;
        }
        default:
          break;
      }
    }
    return events;
  }

  snapshot(): readonly EntityView[] {
    const entities = this.aliveEntities();
    const result: EntityView[] = [];
    for (const entity of entities) {
      const components: Record<string, unknown> = {};
      const keys = [...this.#components.keys()].sort((a, b) => String(a).localeCompare(String(b)));
      for (const key of keys) {
        const value = this.#components.get(key)?.get(entity);
        if (value !== undefined) components[String(key)] = structuredClone(value);
      }
      result.push(Object.freeze({ id: entity, components }));
    }
    return result;
  }

  clear(): void {
    this.#alive.clear();
    this.#commands = [];
    for (const store of this.#components.values()) store.clear();
  }
}

export function createComponentType<T extends object>(
  world: EntityWorld,
  name: string,
  defaultValue: () => T,
): ComponentStore<T> & { readonly create: (entity: EntityId) => T } {
  const store = world.registerComponent<T>(name);
  return Object.assign(store, {
    create: (entity: EntityId): T => {
      const value = defaultValue();
      store.set(entity, value);
      return value;
    },
  });
}

export function component<T extends object>(
  type: string,
  values: Iterable<readonly [EntityId, T]>,
): ComponentBucket<T> {
  return {
    type: componentType(type),
    values: new Map(values),
  };
}

// Kept as a compile-time convenience for systems migrating from class-based ECS frameworks.
export function isConstructor(value: unknown): value is Constructor<object> {
  return typeof value === 'function';
}
