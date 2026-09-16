import type { EntityId } from './simulationKernel.ts';

export type ComponentType<T extends object = object> = string & { readonly __component?: T };
export type SystemPhase = 'pre' | 'simulate' | 'post' | 'render-sync';

export interface ComponentSchema<T extends object> {
  readonly type: ComponentType<T>;
  readonly version: number;
  readonly create: () => T;
  readonly clone: (value: T) => T;
  readonly validate: (value: T) => boolean;
}

export interface QueryDescriptor {
  readonly all: readonly ComponentType[];
  readonly any?: readonly ComponentType[];
  readonly none?: readonly ComponentType[];
}

export interface EntityRecord {
  readonly id: EntityId;
  readonly generation: number;
  readonly alive: boolean;
}

export interface ComponentChange {
  readonly entity: EntityId;
  readonly component: ComponentType;
  readonly kind: 'add' | 'set' | 'remove';
}

export interface WorldMutationBatch {
  readonly changes: readonly ComponentChange[];
  readonly committedAtTick: number;
}

interface StoredComponent<T extends object> {
  readonly schema: ComponentSchema<T>;
  readonly values: Map<EntityId, T>;
}

interface EntitySlot {
  generation: number;
  alive: boolean;
}

function assertComponentType(type: string): void {
  if (!type.trim() || type.length > 96) throw new Error('component type must be 1..96 characters');
  if (!/^[A-Za-z0-9_.:-]+$/.test(type)) throw new Error(`invalid component type: ${type}`);
}

export function defineComponent<T extends object>(schema: ComponentSchema<T>): ComponentType<T> {
  assertComponentType(schema.type);
  if (!Number.isInteger(schema.version) || schema.version < 1) throw new RangeError('schema version must be positive integer');
  return schema.type;
}

export class EcsWorld {
  readonly #slots: EntitySlot[] = [{ generation: 0, alive: false }];
  readonly #components = new Map<ComponentType, StoredComponent>();
  readonly #free: EntityId[] = [];
  #nextEntityId = 1;
  #mutationLog: ComponentChange[] = [];

  public registerComponent<T extends object>(schema: ComponentSchema<T>): ComponentType<T> {
    const type = defineComponent(schema);
    if (this.#components.has(type)) {
      throw new Error(`component already registered: ${type}`);
    }
    this.#components.set(type, {
      schema,
      values: new Map<EntityId, T>(),
    });
    return type;
  }

  public hasComponentType(type: ComponentType): boolean {
    return this.#components.has(type);
  }

  public createEntity(): EntityId {
    const reused = this.#free.pop();
    if (reused !== undefined) {
      const slot = this.#slots[reused];
      if (!slot) throw new Error('free entity slot missing');
      slot.alive = true;
      return reused;
    }
    const id = this.#nextEntityId++;
    this.#slots[id] = { generation: 1, alive: true };
    return id;
  }

  public destroyEntity(entity: EntityId): void {
    const slot = this.#slot(entity);
    if (!slot.alive) return;
    for (const stored of this.#components.values()) {
      if (stored.values.delete(entity)) {
        this.#mutationLog.push({ entity, component: stored.schema.type, kind: 'remove' });
      }
    }
    slot.alive = false;
    slot.generation += 1;
    this.#free.push(entity);
  }

  public isAlive(entity: EntityId): boolean {
    return this.#slots[entity]?.alive === true;
  }

  public generation(entity: EntityId): number {
    return this.#slot(entity).generation;
  }

  public add<T extends object>(entity: EntityId, schema: ComponentSchema<T>, value?: T): T {
    this.#assertAlive(entity);
    const type = defineComponent(schema);
    const stored = this.#components.get(type) as StoredComponent<T> | undefined;
    if (!stored) {
      this.#components.set(type, { schema, values: new Map() });
    }
    const collection = this.#components.get(type) as StoredComponent<T>;
    if (collection.values.has(entity)) throw new Error(`entity ${entity} already has ${type}`);
    const resolved = value ? schema.clone(value) : schema.create();
    if (!schema.validate(resolved)) throw new Error(`invalid ${type} value`);
    collection.values.set(entity, resolved);
    this.#mutationLog.push({ entity, component: type, kind: 'add' });
    return resolved;
  }

  public set<T extends object>(entity: EntityId, schema: ComponentSchema<T>, value: T): void {
    this.#assertAlive(entity);
    const collection = this.#components.get(schema.type) as StoredComponent<T> | undefined;
    if (!collection) throw new Error(`unknown component ${schema.type}`);
    const next = schema.clone(value);
    if (!schema.validate(next)) throw new Error(`invalid ${schema.type} value`);
    collection.values.set(entity, next);
    this.#mutationLog.push({ entity, component: schema.type, kind: 'set' });
  }

  public get<T extends object>(entity: EntityId, type: ComponentType<T>): T | undefined {
    const collection = this.#components.get(type) as StoredComponent<T> | undefined;
    const value = collection?.values.get(entity);
    return value as T | undefined;
  }

  public require<T extends object>(entity: EntityId, type: ComponentType<T>): T {
    const value = this.get(entity, type);
    if (!value) throw new Error(`entity ${entity} does not contain ${type}`);
    return value;
  }

  public remove(entity: EntityId, type: ComponentType): boolean {
    this.#assertAlive(entity);
    const collection = this.#components.get(type);
    if (!collection) return false;
    const removed = collection.values.delete(entity);
    if (removed) this.#mutationLog.push({ entity, component: type, kind: 'remove' });
    return removed;
  }

  public has(entity: EntityId, type: ComponentType): boolean {
    return this.#components.get(type)?.values.has(entity) === true;
  }

  public query(descriptor: QueryDescriptor): readonly EntityId[] {
    if (descriptor.all.length === 0) throw new Error('query requires at least one all component');
    const candidates = this.#smallestSet(descriptor.all);
    const result: EntityId[] = [];
    outer: for (const entity of candidates) {
      if (!this.isAlive(entity)) continue;
      for (const type of descriptor.all) {
        if (!this.has(entity, type)) continue outer;
      }
      for (const type of descriptor.any ?? []) {
        if (this.has(entity, type)) break;
        if (type === (descriptor.any ?? []).at(-1)) continue outer;
      }
      for (const type of descriptor.none ?? []) {
        if (this.has(entity, type)) continue outer;
      }
      result.push(entity);
    }
    result.sort((a, b) => a - b);
    return result;
  }

  public count(type?: ComponentType): number {
    if (type) return this.#components.get(type)?.values.size ?? 0;
    return this.#slots.reduce((count, slot) => count + (slot?.alive ? 1 : 0), 0);
  }

  public entities(): readonly EntityRecord[] {
    const records: EntityRecord[] = [];
    for (let id = 1; id < this.#slots.length; id += 1) {
      const slot = this.#slots[id];
      if (!slot) continue;
      records.push({ id, generation: slot.generation, alive: slot.alive });
    }
    return records;
  }

  public flushMutationBatch(committedAtTick: number): WorldMutationBatch {
    if (!Number.isInteger(committedAtTick) || committedAtTick < 0) throw new RangeError('invalid committed tick');
    const batch: WorldMutationBatch = {
      changes: this.#mutationLog.map((change) => Object.freeze({ ...change })),
      committedAtTick,
    };
    this.#mutationLog = [];
    return Object.freeze(batch);
  }

  public snapshot(): EcsSnapshot {
    const entities = this.entities().filter((record) => record.alive);
    const components: ComponentSnapshot[] = [];
    for (const stored of this.#components.values()) {
      for (const [entity, value] of stored.values) {
        components.push({
          entity,
          type: stored.schema.type,
          version: stored.schema.version,
          value: structuredClone(value),
        });
      }
    }
    components.sort((a, b) => a.entity - b.entity || a.type.localeCompare(b.type));
    return Object.freeze({ version: 1, entities, components });
  }

  public restore(snapshot: EcsSnapshot): void {
    if (snapshot.version !== 1) throw new Error('unsupported ECS snapshot version');
    for (let id = 1; id < this.#slots.length; id += 1) {
      const slot = this.#slots[id];
      if (slot) slot.alive = false;
    }
    this.#free.length = 0;
    for (const stored of this.#components.values()) stored.values.clear();
    this.#mutationLog = [];
    for (const entity of snapshot.entities) {
      if (!Number.isInteger(entity.id) || entity.id <= 0) throw new Error('invalid snapshot entity');
      const current = this.#slots[entity.id];
      if (current) {
        current.alive = true;
        current.generation = Math.max(entity.generation, 1);
      } else {
        this.#slots[entity.id] = { alive: true, generation: Math.max(entity.generation, 1) };
      }
      this.#nextEntityId = Math.max(this.#nextEntityId, entity.id + 1);
    }
    for (const component of snapshot.components) {
      const stored = this.#components.get(component.type);
      if (!stored) throw new Error(`snapshot references unregistered component ${component.type}`);
      if (stored.schema.version !== component.version) throw new Error(`snapshot version mismatch for ${component.type}`);
      const typed = component.value as object;
      if (!stored.schema.validate(typed)) throw new Error(`invalid snapshot value for ${component.type}`);
      stored.values.set(component.entity, stored.schema.clone(typed));
    }
    for (let id = 1; id < this.#nextEntityId; id += 1) {
      if (!this.#slots[id]?.alive) this.#free.push(id);
    }
  }

  public digest(): string {
    const payload = this.snapshot().components
      .map((component) => `${component.entity}:${component.type}:${component.version}:${stableJson(component.value)}`)
      .join('|');
    return hashText(payload);
  }

  #smallestSet(types: readonly ComponentType[]): Iterable<EntityId> {
    let smallest: Map<EntityId, unknown> | undefined;
    for (const type of types) {
      const values = this.#components.get(type)?.values;
      if (!values) return [];
      if (!smallest || values.size < smallest.size) smallest = values as Map<EntityId, unknown>;
    }
    return smallest?.keys() ?? [];
  }

  #slot(entity: EntityId): EntitySlot {
    if (!Number.isInteger(entity) || entity <= 0) throw new RangeError(`invalid entity ${entity}`);
    const slot = this.#slots[entity];
    if (!slot) throw new Error(`unknown entity ${entity}`);
    return slot;
  }

  #assertAlive(entity: EntityId): void {
    if (!this.isAlive(entity)) throw new Error(`entity ${entity} is not alive`);
  }
}

export interface ComponentSnapshot {
  readonly entity: EntityId;
  readonly type: ComponentType;
  readonly version: number;
  readonly value: object;
}

export interface EcsSnapshot {
  readonly version: 1;
  readonly entities: readonly EntityRecord[];
  readonly components: readonly ComponentSnapshot[];
}

export interface EcsSystem {
  readonly id: string;
  readonly phase: SystemPhase;
  readonly order: number;
  readonly query: QueryDescriptor;
  readonly update: (world: EcsWorld, entities: readonly EntityId[], deltaSeconds: number, tick: number) => void;
}

export class EcsScheduler {
  readonly #systems: EcsSystem[] = [];

  public add(system: EcsSystem): () => void {
    if (!system.id.trim()) throw new Error('system id must not be empty');
    if (this.#systems.some((candidate) => candidate.id === system.id)) throw new Error(`duplicate system ${system.id}`);
    this.#systems.push(system);
    this.#systems.sort((a, b) => phaseOrder(a.phase) - phaseOrder(b.phase) || a.order - b.order || a.id.localeCompare(b.id));
    return () => {
      const index = this.#systems.indexOf(system);
      if (index >= 0) this.#systems.splice(index, 1);
    };
  }

  public run(world: EcsWorld, deltaSeconds: number, tick: number, phase?: SystemPhase): void {
    for (const system of this.#systems) {
      if (phase && system.phase !== phase) continue;
      const entities = world.query(system.query);
      system.update(world, entities, deltaSeconds, tick);
    }
  }

  public list(): readonly string[] {
    return this.#systems.map((system) => system.id);
  }
}

function phaseOrder(phase: SystemPhase): number {
  switch (phase) {
    case 'pre': return 0;
    case 'simulate': return 1;
    case 'post': return 2;
    case 'render-sync': return 3;
  }
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
}

export function hashText(value: string): string {
  let h1 = 2166136261 >>> 0;
  let h2 = 2246822519 >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ (code + index), 2246822519) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

export interface TransformComponent {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface VelocityComponent {
  x: number;
  y: number;
  z: number;
}

export const TransformSchema: ComponentSchema<TransformComponent> = {
  type: 'core.transform' as ComponentType<TransformComponent>,
  version: 1,
  create: () => ({ x: 0, y: 0, z: 0, yaw: 0 }),
  clone: (value) => ({ ...value }),
  validate: (value) => [value.x, value.y, value.z, value.yaw].every(Number.isFinite),
};

export const VelocitySchema: ComponentSchema<VelocityComponent> = {
  type: 'core.velocity' as ComponentType<VelocityComponent>,
  version: 1,
  create: () => ({ x: 0, y: 0, z: 0 }),
  clone: (value) => ({ ...value }),
  validate: (value) => [value.x, value.y, value.z].every(Number.isFinite),
};

export function integrateTransforms(world: EcsWorld, entities: readonly EntityId[], deltaSeconds: number): void {
  if (deltaSeconds < 0 || !Number.isFinite(deltaSeconds)) throw new RangeError('deltaSeconds must be finite non-negative');
  for (const entity of entities) {
    const transform = world.require(entity, TransformSchema.type);
    const velocity = world.require(entity, VelocitySchema.type);
    transform.x += velocity.x * deltaSeconds;
    transform.y += velocity.y * deltaSeconds;
    transform.z += velocity.z * deltaSeconds;
  }
}
