import {
  asComponentType,
  asEntityId,
  type ComponentDefinition,
  type ComponentType,
  type EntityId,
  type EntitySnapshot,
} from './coreContracts';
import { hashObject32 } from './deterministicKernel';

export interface ComponentRegistration<T> extends ComponentDefinition<T> {
  readonly type: ComponentType;
  readonly name: string;
}

export interface ComponentStoreStats {
  readonly type: ComponentType;
  readonly size: number;
  readonly bytes: number;
  readonly mutations: number;
}

export interface EntityArchetypeKey {
  readonly components: readonly ComponentType[];
}

export interface EntityQuery {
  readonly all?: readonly ComponentType[];
  readonly any?: readonly ComponentType[];
  readonly none?: readonly ComponentType[];
}

export interface QueryResult {
  readonly entities: readonly EntityId[];
  readonly count: number;
}

export type DeferredOperation =
  | { readonly kind: 'create'; readonly id?: EntityId }
  | { readonly kind: 'destroy'; readonly id: EntityId }
  | { readonly kind: 'add'; readonly id: EntityId; readonly type: ComponentType; readonly value: unknown }
  | { readonly kind: 'set'; readonly id: EntityId; readonly type: ComponentType; readonly value: unknown }
  | { readonly kind: 'remove'; readonly id: EntityId; readonly type: ComponentType };

interface EntityRecord {
  readonly id: EntityId;
  readonly createdOrder: number;
  enabled: boolean;
}

class TypedStore<T> {
  readonly definition: ComponentRegistration<T>;
  #values = new Map<EntityId, T>();
  #mutations = 0;

  constructor(definition: ComponentRegistration<T>) {
    this.definition = definition;
  }

  has(entity: EntityId): boolean {
    return this.#values.has(entity);
  }

  get(entity: EntityId): T | undefined {
    const value = this.#values.get(entity);
    return value === undefined ? undefined : this.definition.clone(value);
  }

  unsafeGet(entity: EntityId): T | undefined {
    return this.#values.get(entity);
  }

  set(entity: EntityId, value: T): void {
    if (!this.definition.validate(value)) throw new Error(`Invalid value for component ${this.definition.name}`);
    this.#values.set(entity, this.definition.clone(value));
    this.#mutations += 1;
  }

  add(entity: EntityId, value: T): void {
    if (this.#values.has(entity)) throw new Error(`Component ${this.definition.name} already exists on ${entity}`);
    this.set(entity, value);
  }

  remove(entity: EntityId): boolean {
    const removed = this.#values.delete(entity);
    if (removed) this.#mutations += 1;
    return removed;
  }

  entities(): readonly EntityId[] {
    return [...this.#values.keys()];
  }

  clear(): void {
    this.#values.clear();
    this.#mutations += 1;
  }

  stats(): ComponentStoreStats {
    return {
      type: this.definition.type,
      size: this.#values.size,
      bytes: this.#values.size * this.definition.estimatedBytes,
      mutations: this.#mutations,
    };
  }

  snapshot(): Readonly<Record<string, unknown>> {
    const output: Record<string, unknown> = {};
    const entries = [...this.#values.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [entity, value] of entries) output[entity] = this.definition.clone(value);
    return output;
  }
}

export class EntityRegistryV3 {
  #entities = new Map<EntityId, EntityRecord>();
  #stores = new Map<ComponentType, TypedStore<unknown>>();
  #definitions = new Map<ComponentType, ComponentRegistration<unknown>>();
  #sequence = 0;
  #deferred: DeferredOperation[] = [];

  register<T>(definition: ComponentRegistration<T>): void {
    if (this.#definitions.has(definition.type)) throw new Error(`Component type already registered: ${definition.name}`);
    this.#definitions.set(definition.type, definition as ComponentRegistration<unknown>);
    this.#stores.set(definition.type, new TypedStore(definition as ComponentRegistration<unknown>));
  }

  componentType(name: string): ComponentType {
    const type = asComponentType(name);
    if (!this.#definitions.has(type)) throw new Error(`Unknown component type: ${name}`);
    return type;
  }

  create(id?: EntityId): EntityId {
    const next = id ?? asEntityId(`e:${(++this.#sequence).toString(36)}`);
    if (this.#entities.has(next)) throw new Error(`Entity already exists: ${next}`);
    this.#entities.set(next, { id: next, createdOrder: this.#sequence, enabled: true });
    return next;
  }

  queueCreate(id?: EntityId): void {
    this.#deferred.push({ kind: 'create', ...(id ? { id } : {}) });
  }

  queueDestroy(id: EntityId): void {
    this.#deferred.push({ kind: 'destroy', id });
  }

  queueAdd<T>(id: EntityId, type: ComponentType, value: T): void {
    this.#deferred.push({ kind: 'add', id, type, value: structuredClone(value) });
  }

  queueSet<T>(id: EntityId, type: ComponentType, value: T): void {
    this.#deferred.push({ kind: 'set', id, type, value: structuredClone(value) });
  }

  queueRemove(id: EntityId, type: ComponentType): void {
    this.#deferred.push({ kind: 'remove', id, type });
  }

  flushDeferred(): readonly EntityId[] {
    const created: EntityId[] = [];
    const operations = this.#deferred;
    this.#deferred = [];
    for (const operation of operations) {
      switch (operation.kind) {
        case 'create': {
          created.push(this.create(operation.id));
          break;
        }
        case 'destroy': {
          this.destroy(operation.id);
          break;
        }
        case 'add': {
          this.add(operation.id, operation.type, operation.value);
          break;
        }
        case 'set': {
          this.set(operation.id, operation.type, operation.value);
          break;
        }
        case 'remove': {
          this.remove(operation.id, operation.type);
          break;
        }
      }
    }
    return created;
  }

  exists(id: EntityId): boolean {
    return this.#entities.has(id);
  }

  enable(id: EntityId, enabled = true): void {
    this.#assertEntity(id);
    this.#entities.get(id)!.enabled = enabled;
  }

  isEnabled(id: EntityId): boolean {
    return this.#entities.get(id)?.enabled ?? false;
  }

  destroy(id: EntityId): boolean {
    if (!this.#entities.delete(id)) return false;
    for (const store of this.#stores.values()) store.remove(id);
    return true;
  }

  add<T>(id: EntityId, type: ComponentType, value: T): void {
    this.#assertEntity(id);
    const store = this.#store<T>(type);
    store.add(id, value);
  }

  set<T>(id: EntityId, type: ComponentType, value: T): void {
    this.#assertEntity(id);
    const store = this.#store<T>(type);
    store.set(id, value);
  }

  get<T>(id: EntityId, type: ComponentType): T | undefined {
    return this.#store<T>(type).get(id);
  }

  unsafeGet<T>(id: EntityId, type: ComponentType): T | undefined {
    return this.#store<T>(type).unsafeGet(id) as T | undefined;
  }

  has(id: EntityId, type: ComponentType): boolean {
    return this.#store(type).has(id);
  }

  remove(id: EntityId, type: ComponentType): boolean {
    this.#assertEntity(id);
    return this.#store(type).remove(id);
  }

  query(query: EntityQuery = {}): QueryResult {
    const all = query.all ?? [];
    const any = query.any ?? [];
    const none = query.none ?? [];
    const candidates = this.#candidateEntities(all, any);
    const entities = candidates
      .filter((entity) => this.isEnabled(entity))
      .filter((entity) => all.every((type) => this.has(entity, type)))
      .filter((entity) => any.length === 0 || any.some((type) => this.has(entity, type)))
      .filter((entity) => none.every((type) => !this.has(entity, type)))
      .sort();
    return { entities, count: entities.length };
  }

  forEach(query: EntityQuery, visitor: (id: EntityId) => void): void {
    for (const entity of this.query(query).entities) visitor(entity);
  }

  snapshot(): readonly EntitySnapshot[] {
    const entities = [...this.#entities.values()].sort((a, b) => a.id.localeCompare(b.id));
    const stores = [...this.#stores.entries()].sort(([a], [b]) => String(a).localeCompare(String(b)));
    return entities.map((entity) => {
      const components: Record<string, unknown> = {};
      for (const [type, store] of stores) {
        const value = store.unsafeGet(entity.id);
        if (value !== undefined) components[type] = structuredClone(value);
      }
      return { id: entity.id, components };
    });
  }

  checksum(): number {
    return hashObject32(this.snapshot());
  }

  clear(): void {
    this.#entities.clear();
    for (const store of this.#stores.values()) store.clear();
    this.#sequence = 0;
    this.#deferred = [];
  }

  stats(): readonly ComponentStoreStats[] {
    return [...this.#stores.values()].map((store) => store.stats()).sort((a, b) => String(a.type).localeCompare(String(b.type)));
  }

  entityCount(): number {
    return this.#entities.size;
  }

  componentCount(): number {
    return this.#stores.size;
  }

  archetypeKey(id: EntityId): EntityArchetypeKey {
    this.#assertEntity(id);
    const components: ComponentType[] = [];
    for (const [type, store] of this.#stores) {
      if (store.has(id)) components.push(type);
    }
    components.sort((a, b) => String(a).localeCompare(String(b)));
    return { components };
  }

  archetypeSignature(id: EntityId): string {
    return this.archetypeKey(id).components.map(String).join('|');
  }

  #candidateEntities(all: readonly ComponentType[], any: readonly ComponentType[]): EntityId[] {
    if (all.length > 0) {
      const stores = all.map((type) => this.#store(type));
      const smallest = stores.reduce((left, right) => left.stats().size <= right.stats().size ? left : right);
      return [...smallest.entities()];
    }
    if (any.length > 0) {
      const set = new Set<EntityId>();
      for (const type of any) for (const entity of this.#store(type).entities()) set.add(entity);
      return [...set];
    }
    return [...this.#entities.keys()];
  }

  #store<T>(type: ComponentType): TypedStore<T> {
    const store = this.#stores.get(type);
    if (!store) throw new Error(`Unknown component type: ${String(type)}`);
    return store as TypedStore<T>;
  }

  #assertEntity(id: EntityId): void {
    if (!this.#entities.has(id)) throw new Error(`Unknown entity: ${id}`);
  }
}

export function defineComponent<T>(options: {
  readonly name: string;
  readonly estimatedBytes?: number;
  readonly clone?: (value: T) => T;
  readonly validate?: (value: unknown) => value is T;
  readonly defaultValue?: () => T;
}): ComponentRegistration<T> {
  const type = asComponentType(options.name);
  const clone = options.clone ?? ((value: T) => structuredClone(value));
  const validate = options.validate ?? (() => true);
  const defaultValue = options.defaultValue ?? (() => {
    throw new Error(`No default value defined for ${options.name}`);
  });
  return {
    type,
    name: options.name,
    estimatedBytes: options.estimatedBytes ?? 32,
    clone,
    validate,
    defaultValue,
  };
}

export const V3_POSITION = defineComponent<{ x: number; y: number; z: number }>({
  name: 'transform.position',
  estimatedBytes: 24,
  validate: (value): value is { x: number; y: number; z: number } =>
    typeof value === 'object' && value !== null &&
    Number.isFinite((value as { x?: unknown }).x) &&
    Number.isFinite((value as { y?: unknown }).y) &&
    Number.isFinite((value as { z?: unknown }).z),
  defaultValue: () => ({ x: 0, y: 0, z: 0 }),
});

export const V3_VELOCITY = defineComponent<{ x: number; y: number; z: number }>({
  name: 'motion.velocity',
  estimatedBytes: 24,
  validate: V3_POSITION.validate,
  defaultValue: () => ({ x: 0, y: 0, z: 0 }),
});

export const V3_HEALTH = defineComponent<{ current: number; max: number }>({
  name: 'combat.health',
  estimatedBytes: 16,
  validate: (value): value is { current: number; max: number } =>
    typeof value === 'object' && value !== null &&
    Number.isFinite((value as { current?: unknown }).current) &&
    Number.isFinite((value as { max?: unknown }).max),
  defaultValue: () => ({ current: 100, max: 100 }),
});

export const V3_TAGS = defineComponent<readonly string[]>({
  name: 'identity.tags',
  estimatedBytes: 32,
  validate: (value): value is readonly string[] => Array.isArray(value) && value.every((entry) => typeof entry === 'string'),
  defaultValue: () => [],
});
