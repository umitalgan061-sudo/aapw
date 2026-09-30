import { stableDigest } from './deterministic.ts';

export interface EntityHandle {
  readonly id: number;
  readonly generation: number;
}

export interface EntityRecord {
  readonly id: number;
  readonly generation: number;
  readonly alive: boolean;
  readonly createdTick: number;
  readonly changedTick: number;
}

export interface ComponentDefinition<T> {
  readonly key: string;
  readonly clone: (value: T) => T;
  readonly validate?: (value: T) => boolean;
}

export interface QuerySpec {
  readonly all?: readonly string[];
  readonly any?: readonly string[];
  readonly none?: readonly string[];
}

export interface EntitySnapshot {
  readonly entity: EntityRecord;
  readonly components: Readonly<Record<string, unknown>>;
}

export interface WorldSnapshotV3 {
  readonly version: 3;
  readonly tick: number;
  readonly entities: readonly EntitySnapshot[];
  readonly digest: string;
}

export interface WorldEventV3 {
  readonly tick: number;
  readonly type: string;
  readonly entityId?: number;
  readonly payload?: unknown;
}

const safeInt = (value: number, fallback = 0): number =>
  Number.isFinite(value) ? Math.trunc(value) : fallback;

const cloneValue = <T>(value: T): T => {
  if (value === null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
};

export class ComponentStoreV3<T> {
  readonly definition: ComponentDefinition<T>;
  readonly #values = new Map<number, T>();
  #version = 0;

  constructor(definition: ComponentDefinition<T>) {
    const key = definition.key.trim();
    if (!key) throw new Error('Component key cannot be empty.');
    this.definition = Object.freeze({
      ...definition,
      key,
      clone: definition.clone ?? cloneValue,
    });
  }

  set(entityId: number, value: T): void {
    if (this.definition.validate && !this.definition.validate(value)) {
      throw new Error(`Component ${this.definition.key} rejected value.`);
    }
    this.#values.set(entityId, this.definition.clone(value));
    this.#version += 1;
  }

  get(entityId: number): T | undefined {
    const value = this.#values.get(entityId);
    return value === undefined ? undefined : this.definition.clone(value);
  }

  peek(entityId: number): T | undefined {
    return this.#values.get(entityId);
  }

  has(entityId: number): boolean {
    return this.#values.has(entityId);
  }

  delete(entityId: number): boolean {
    const deleted = this.#values.delete(entityId);
    if (deleted) this.#version += 1;
    return deleted;
  }

  clear(): void {
    if (this.#values.size > 0) {
      this.#values.clear();
      this.#version += 1;
    }
  }

  entries(): readonly (readonly [number, T])[] {
    return [...this.#values.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([id, value]) => Object.freeze([id, this.definition.clone(value)] as const));
  }

  size(): number {
    return this.#values.size;
  }

  version(): number {
    return this.#version;
  }
}

export interface WorldQueryV3 {
  readonly handles: readonly EntityHandle[];
  readonly count: number;
}

export interface SystemContextV3 {
  readonly tick: number;
  readonly deltaSeconds: number;
  readonly world: EntityWorldV3;
  readonly emit: (event: Omit<WorldEventV3, 'tick'>) => void;
}

export type WorldSystemV3 = (context: SystemContextV3) => void;

export class EntityWorldV3 {
  readonly #entities = new Map<number, EntityRecord>();
  readonly #generations = new Map<number, number>();
  readonly #freeIds: number[] = [];
  readonly #stores = new Map<string, ComponentStoreV3<unknown>>();
  readonly #events: WorldEventV3[] = [];
  readonly #systems = new Map<string, WorldSystemV3>();
  readonly #systemOrder: string[] = [];
  #nextId = 1;
  #tick = 0;
  #version = 0;
  #maxEntities: number;
  #maxEvents: number;

  constructor(options: { maxEntities?: number; maxEvents?: number } = {}) {
    this.#maxEntities = Math.max(1, safeInt(options.maxEntities ?? 100_000));
    this.#maxEvents = Math.max(64, safeInt(options.maxEvents ?? 8_192));
  }

  get tick(): number {
    return this.#tick;
  }

  get version(): number {
    return this.#version;
  }

  defineComponent<T>(definition: ComponentDefinition<T>): ComponentStoreV3<T> {
    const existing = this.#stores.get(definition.key);
    if (existing) {
      if (existing.definition.key !== definition.key) throw new Error('Component identity collision.');
      return existing as ComponentStoreV3<T>;
    }
    const store = new ComponentStoreV3(definition);
    this.#stores.set(store.definition.key, store as ComponentStoreV3<unknown>);
    this.#version += 1;
    return store;
  }

  component<T>(key: string): ComponentStoreV3<T> | undefined {
    return this.#stores.get(key) as ComponentStoreV3<T> | undefined;
  }

  create(initial?: Readonly<Record<string, unknown>>): EntityHandle {
    if (this.aliveCount() >= this.#maxEntities) throw new Error('Entity capacity exceeded.');
    const id = this.#freeIds.shift() ?? this.#nextId++;
    const generation = (this.#generations.get(id) ?? 0) + 1;
    const record = Object.freeze({
      id,
      generation,
      alive: true,
      createdTick: this.#tick,
      changedTick: this.#tick,
    });
    this.#generations.set(id, generation);
    this.#entities.set(id, record);
    for (const [key, value] of Object.entries(initial ?? {})) {
      const store = this.#stores.get(key);
      if (!store) throw new Error(`Unknown component ${key}.`);
      store.set(id, value);
    }
    this.#version += 1;
    this.emit({ type: 'entity.created', entityId: id });
    return Object.freeze({ id, generation });
  }

  destroy(handle: EntityHandle | number): boolean {
    const id = typeof handle === 'number' ? handle : handle.id;
    const expectedGeneration = typeof handle === 'number' ? undefined : handle.generation;
    const record = this.#entities.get(id);
    if (!record || (expectedGeneration !== undefined && record.generation !== expectedGeneration)) return false;
    for (const store of this.#stores.values()) store.delete(id);
    this.#entities.delete(id);
    this.#freeIds.push(id);
    this.#freeIds.sort((a, b) => a - b);
    this.#version += 1;
    this.emit({ type: 'entity.destroyed', entityId: id });
    return true;
  }

  alive(handle: EntityHandle): boolean {
    return this.#entities.get(handle.id)?.generation === handle.generation;
  }

  record(id: number): EntityRecord | undefined {
    return this.#entities.get(id);
  }

  addComponent<T>(handle: EntityHandle, key: string, value: T): boolean {
    if (!this.alive(handle)) return false;
    const store = this.#stores.get(key);
    if (!store) throw new Error(`Unknown component ${key}.`);
    store.set(handle.id, value);
    this.#touch(handle.id);
    this.emit({ type: 'component.added', entityId: handle.id, payload: { key } });
    return true;
  }

  removeComponent(handle: EntityHandle, key: string): boolean {
    if (!this.alive(handle)) return false;
    const store = this.#stores.get(key);
    if (!store) return false;
    const deleted = store.delete(handle.id);
    if (deleted) {
      this.#touch(handle.id);
      this.emit({ type: 'component.removed', entityId: handle.id, payload: { key } });
    }
    return deleted;
  }

  hasComponent(handle: EntityHandle, key: string): boolean {
    return this.alive(handle) && (this.#stores.get(key)?.has(handle.id) ?? false);
  }

  getComponent<T>(handle: EntityHandle, key: string): T | undefined {
    if (!this.alive(handle)) return undefined;
    return this.#stores.get(key)?.get(handle.id) as T | undefined;
  }

  query(spec: QuerySpec): WorldQueryV3 {
    const all = [...new Set(spec.all ?? [])];
    const any = [...new Set(spec.any ?? [])];
    const none = [...new Set(spec.none ?? [])];
    const handles: EntityHandle[] = [];
    for (const record of [...this.#entities.values()].sort((a, b) => a.id - b.id)) {
      const satisfiesAll = all.every((key) => this.#stores.get(key)?.has(record.id) === true);
      const satisfiesAny = any.length === 0 || any.some((key) => this.#stores.get(key)?.has(record.id) === true);
      const satisfiesNone = none.every((key) => this.#stores.get(key)?.has(record.id) !== true);
      if (satisfiesAll && satisfiesAny && satisfiesNone) handles.push(Object.freeze({ id: record.id, generation: record.generation }));
    }
    return Object.freeze({ handles: Object.freeze(handles), count: handles.length });
  }

  registerSystem(id: string, system: WorldSystemV3): void {
    const clean = id.trim();
    if (!clean || this.#systems.has(clean)) throw new Error(`Duplicate system ${clean}.`);
    this.#systems.set(clean, system);
    this.#systemOrder.push(clean);
    this.#systemOrder.sort();
  }

  removeSystem(id: string): boolean {
    const removed = this.#systems.delete(id);
    const index = this.#systemOrder.indexOf(id);
    if (index >= 0) this.#systemOrder.splice(index, 1);
    return removed;
  }

  step(deltaSeconds: number, systems: readonly string[] = this.#systemOrder): void {
    const dt = Math.min(0.25, Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0));
    this.#tick += 1;
    for (const id of systems) {
      const system = this.#systems.get(id);
      if (!system) continue;
      system({
        tick: this.#tick,
        deltaSeconds: dt,
        world: this,
        emit: (event) => this.emit(event),
      });
    }
    this.#version += 1;
  }

  emit(event: Omit<WorldEventV3, 'tick'>): void {
    this.#events.push(Object.freeze({ ...event, tick: this.#tick }));
    if (this.#events.length > this.#maxEvents) this.#events.splice(0, this.#events.length - this.#maxEvents);
  }

  consumeEvents(): readonly WorldEventV3[] {
    const events = [...this.#events];
    this.#events.length = 0;
    return Object.freeze(events);
  }

  events(): readonly WorldEventV3[] {
    return Object.freeze([...this.#events]);
  }

  entities(): readonly EntityRecord[] {
    return Object.freeze([...this.#entities.values()].sort((a, b) => a.id - b.id));
  }

  aliveCount(): number {
    return this.#entities.size;
  }

  componentKeys(): readonly string[] {
    return Object.freeze([...this.#stores.keys()].sort());
  }

  snapshot(): WorldSnapshotV3 {
    const entities = this.entities().map((entity) => {
      const components: Record<string, unknown> = {};
      for (const [key, store] of [...this.#stores.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        if (store.has(entity.id)) components[key] = store.get(entity.id);
      }
      return Object.freeze({
        entity,
        components: Object.freeze(components),
      });
    });
    const payload = { version: 3, tick: this.#tick, entities };
    return Object.freeze({
      ...payload,
      digest: stableDigest(payload),
    });
  }

  restore(snapshot: WorldSnapshotV3): void {
    if (snapshot.version !== 3) throw new Error('Unsupported world snapshot version.');
    this.#entities.clear();
    this.#freeIds.length = 0;
    for (const store of this.#stores.values()) store.clear();
    let maxId = 0;
    for (const item of snapshot.entities.slice(0, this.#maxEntities)) {
      const entity = Object.freeze({ ...item.entity, alive: true });
      this.#entities.set(entity.id, entity);
      this.#generations.set(entity.id, entity.generation);
      maxId = Math.max(maxId, entity.id);
      for (const [key, value] of Object.entries(item.components)) {
        const store = this.#stores.get(key);
        if (store) store.set(entity.id, value);
      }
    }
    this.#nextId = maxId + 1;
    this.#tick = Math.max(0, safeInt(snapshot.tick));
    this.#version += 1;
    this.emit({ type: 'world.restored' });
  }

  digest(): string {
    const snapshot = this.snapshot();
    return snapshot.digest;
  }

  stats(): Readonly<{
    tick: number;
    version: number;
    entities: number;
    components: number;
    componentEntries: number;
    queuedEvents: number;
    registeredSystems: number;
  }> {
    let entries = 0;
    for (const store of this.#stores.values()) entries += store.size();
    return Object.freeze({
      tick: this.#tick,
      version: this.#version,
      entities: this.#entities.size,
      components: this.#stores.size,
      componentEntries: entries,
      queuedEvents: this.#events.length,
      registeredSystems: this.#systemOrder.length,
    });
  }

  #touch(id: number): void {
    const record = this.#entities.get(id);
    if (!record) return;
    this.#entities.set(id, Object.freeze({ ...record, changedTick: this.#tick }));
    this.#version += 1;
  }
}

export const defineNumericComponent = (key: string): ComponentDefinition<number> => Object.freeze({
  key,
  clone: (value) => Number(value),
  validate: (value) => Number.isFinite(value),
});

export const defineBooleanComponent = (key: string): ComponentDefinition<boolean> => Object.freeze({
  key,
  clone: (value) => Boolean(value),
});

export const defineStringComponent = (key: string, maxLength = 256): ComponentDefinition<string> => Object.freeze({
  key,
  clone: (value) => String(value).slice(0, Math.max(1, maxLength)),
  validate: (value) => typeof value === 'string',
});

export const defineVector3Component = (key: string): ComponentDefinition<{ x: number; y: number; z: number }> => Object.freeze({
  key,
  clone: (value) => ({
    x: Number.isFinite(value.x) ? value.x : 0,
    y: Number.isFinite(value.y) ? value.y : 0,
    z: Number.isFinite(value.z) ? value.z : 0,
  }),
  validate: (value) => Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z),
});

export const collectComponentDigest = (world: EntityWorldV3, key: string): string => {
  const store = world.component<unknown>(key);
  if (!store) return stableDigest({ key, missing: true });
  return stableDigest({ key, version: store.version(), entries: store.entries() });
};
