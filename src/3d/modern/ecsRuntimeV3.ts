/**
 * AAPW v3 entity-component runtime.
 *
 * The runtime deliberately keeps component storage typed and data-oriented. Gameplay systems
 * depend on stable component contracts instead of renderer objects, DOM state, or mutable globals.
 * The implementation is deterministic-friendly: iteration order is explicit and entity ids are
 * monotonic within a world instance. No ambient clocks or random APIs are used here.
 */

export type EntityId = number & { readonly __brand: 'EntityId' };
export type ComponentType = string & { readonly __brand: 'ComponentType' };

export interface TransformComponent {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  scale: number;
}

export interface VelocityComponent {
  x: number;
  y: number;
  z: number;
  maxSpeed: number;
  acceleration: number;
  damping: number;
}

export interface HealthComponent {
  current: number;
  maximum: number;
  invulnerableUntilTick: number;
  dead: boolean;
}

export interface StaminaComponent {
  current: number;
  maximum: number;
  regenerationPerSecond: number;
  exhausted: boolean;
}

export interface IdentityComponent {
  archetype: string;
  displayName: string;
  tags: readonly string[];
}

export interface NetworkComponent {
  authority: 'local' | 'remote' | 'server';
  replicationPriority: number;
  lastAcknowledgedTick: number;
  dirtyMask: number;
}

export interface LifetimeComponent {
  spawnTick: number;
  despawnTick: number | null;
}

export interface EntitySnapshot {
  readonly id: EntityId;
  readonly componentTypes: readonly ComponentType[];
}

export interface ComponentSchema<T> {
  readonly type: ComponentType;
  readonly create: (initial?: Partial<T>) => T;
  readonly clone: (value: T) => T;
  readonly validate: (value: T) => boolean;
}

export interface QueryPlan {
  readonly required: readonly ComponentType[];
  readonly excluded: readonly ComponentType[];
  readonly order: 'id' | 'insertion';
}

export interface QueryResult {
  readonly entity: EntityId;
  readonly components: Readonly<Record<string, unknown>>;
}

export interface EcsMetrics {
  entities: number;
  liveComponents: number;
  archetypeBuckets: number;
  queryCacheHits: number;
  queryCacheMisses: number;
  mutations: number;
}

const componentType = (value: string): ComponentType => value as ComponentType;
const entityId = (value: number): EntityId => value as EntityId;

const finite = (value: number): boolean => Number.isFinite(value);
const nonNegative = (value: number): boolean => finite(value) && value >= 0;
const normalizeTags = (tags: readonly string[]): readonly string[] =>
  [...new Set(tags.filter((tag) => typeof tag === 'string' && tag.length > 0))].sort();

export const Transform = {
  type: componentType('transform'),
  create(initial: Partial<TransformComponent> = {}): TransformComponent {
    return {
      x: finite(initial.x ?? 0) ? initial.x ?? 0 : 0,
      y: finite(initial.y ?? 0) ? initial.y ?? 0 : 0,
      z: finite(initial.z ?? 0) ? initial.z ?? 0 : 0,
      yaw: finite(initial.yaw ?? 0) ? initial.yaw ?? 0 : 0,
      pitch: finite(initial.pitch ?? 0) ? initial.pitch ?? 0 : 0,
      scale: nonNegative(initial.scale ?? 1) && (initial.scale ?? 1) > 0 ? initial.scale ?? 1 : 1,
    };
  },
  clone(value: TransformComponent): TransformComponent {
    return { ...value };
  },
  validate(value: TransformComponent): boolean {
    return finite(value.x) && finite(value.y) && finite(value.z) &&
      finite(value.yaw) && finite(value.pitch) && finite(value.scale) && value.scale > 0;
  },
} satisfies ComponentSchema<TransformComponent>;

export const Velocity = {
  type: componentType('velocity'),
  create(initial: Partial<VelocityComponent> = {}): VelocityComponent {
    return {
      x: finite(initial.x ?? 0) ? initial.x ?? 0 : 0,
      y: finite(initial.y ?? 0) ? initial.y ?? 0 : 0,
      z: finite(initial.z ?? 0) ? initial.z ?? 0 : 0,
      maxSpeed: nonNegative(initial.maxSpeed ?? 8) ? initial.maxSpeed ?? 8 : 8,
      acceleration: nonNegative(initial.acceleration ?? 25) ? initial.acceleration ?? 25 : 25,
      damping: nonNegative(initial.damping ?? 10) ? initial.damping ?? 10 : 10,
    };
  },
  clone(value: VelocityComponent): VelocityComponent {
    return { ...value };
  },
  validate(value: VelocityComponent): boolean {
    return finite(value.x) && finite(value.y) && finite(value.z) &&
      nonNegative(value.maxSpeed) && nonNegative(value.acceleration) && nonNegative(value.damping);
  },
} satisfies ComponentSchema<VelocityComponent>;

export const Health = {
  type: componentType('health'),
  create(initial: Partial<HealthComponent> = {}): HealthComponent {
    const maximum = nonNegative(initial.maximum ?? 100) ? initial.maximum ?? 100 : 100;
    const current = finite(initial.current ?? maximum)
      ? Math.min(maximum, Math.max(0, initial.current ?? maximum))
      : maximum;
    return {
      current,
      maximum,
      invulnerableUntilTick: Number.isInteger(initial.invulnerableUntilTick ?? 0)
        ? initial.invulnerableUntilTick ?? 0
        : 0,
      dead: current <= 0,
    };
  },
  clone(value: HealthComponent): HealthComponent {
    return { ...value };
  },
  validate(value: HealthComponent): boolean {
    return nonNegative(value.current) && nonNegative(value.maximum) &&
      value.current <= value.maximum && Number.isInteger(value.invulnerableUntilTick) &&
      typeof value.dead === 'boolean';
  },
} satisfies ComponentSchema<HealthComponent>;

export const Stamina = {
  type: componentType('stamina'),
  create(initial: Partial<StaminaComponent> = {}): StaminaComponent {
    const maximum = nonNegative(initial.maximum ?? 100) ? initial.maximum ?? 100 : 100;
    const current = finite(initial.current ?? maximum)
      ? Math.min(maximum, Math.max(0, initial.current ?? maximum))
      : maximum;
    return {
      current,
      maximum,
      regenerationPerSecond: nonNegative(initial.regenerationPerSecond ?? 18)
        ? initial.regenerationPerSecond ?? 18
        : 18,
      exhausted: current <= 0,
    };
  },
  clone(value: StaminaComponent): StaminaComponent {
    return { ...value };
  },
  validate(value: StaminaComponent): boolean {
    return nonNegative(value.current) && nonNegative(value.maximum) &&
      value.current <= value.maximum && nonNegative(value.regenerationPerSecond) &&
      typeof value.exhausted === 'boolean';
  },
} satisfies ComponentSchema<StaminaComponent>;

export const Identity = {
  type: componentType('identity'),
  create(initial: Partial<IdentityComponent> = {}): IdentityComponent {
    return {
      archetype: initial.archetype?.trim() || 'generic',
      displayName: initial.displayName?.trim() || 'Entity',
      tags: normalizeTags(initial.tags ?? []),
    };
  },
  clone(value: IdentityComponent): IdentityComponent {
    return { ...value, tags: [...value.tags] };
  },
  validate(value: IdentityComponent): boolean {
    return value.archetype.length > 0 && value.displayName.length > 0 &&
      value.tags.every((tag) => typeof tag === 'string');
  },
} satisfies ComponentSchema<IdentityComponent>;

export const Network = {
  type: componentType('network'),
  create(initial: Partial<NetworkComponent> = {}): NetworkComponent {
    return {
      authority: initial.authority ?? 'local',
      replicationPriority: nonNegative(initial.replicationPriority ?? 1)
        ? initial.replicationPriority ?? 1
        : 1,
      lastAcknowledgedTick: Number.isInteger(initial.lastAcknowledgedTick ?? -1)
        ? initial.lastAcknowledgedTick ?? -1
        : -1,
      dirtyMask: Number.isInteger(initial.dirtyMask ?? 0) ? initial.dirtyMask ?? 0 : 0,
    };
  },
  clone(value: NetworkComponent): NetworkComponent {
    return { ...value };
  },
  validate(value: NetworkComponent): boolean {
    return (value.authority === 'local' || value.authority === 'remote' || value.authority === 'server') &&
      nonNegative(value.replicationPriority) && Number.isInteger(value.lastAcknowledgedTick) &&
      Number.isInteger(value.dirtyMask);
  },
} satisfies ComponentSchema<NetworkComponent>;

export const Lifetime = {
  type: componentType('lifetime'),
  create(initial: Partial<LifetimeComponent> = {}): LifetimeComponent {
    return {
      spawnTick: Number.isInteger(initial.spawnTick ?? 0) ? initial.spawnTick ?? 0 : 0,
      despawnTick: initial.despawnTick === undefined || initial.despawnTick === null
        ? null
        : Number.isInteger(initial.despawnTick) ? initial.despawnTick : null,
    };
  },
  clone(value: LifetimeComponent): LifetimeComponent {
    return { ...value };
  },
  validate(value: LifetimeComponent): boolean {
    return Number.isInteger(value.spawnTick) &&
      (value.despawnTick === null || Number.isInteger(value.despawnTick));
  },
} satisfies ComponentSchema<LifetimeComponent>;

type AnyComponent = object;
type ComponentStore = Map<EntityId, AnyComponent>;

interface InternalEntity {
  readonly id: EntityId;
  readonly components: Map<ComponentType, AnyComponent>;
  readonly insertionOrder: number;
}

const planKey = (plan: QueryPlan): string =>
  `${plan.order}|+${[...plan.required].map(String).sort().join(',')}|-${[...plan.excluded].map(String).sort().join(',')}`;

export class EcsWorldV3 {
  #nextEntity = 1;
  #insertionCounter = 0;
  #entities = new Map<EntityId, InternalEntity>();
  #stores = new Map<ComponentType, ComponentStore>();
  #schemas = new Map<ComponentType, ComponentSchema<AnyComponent>>();
  #queryCache = new Map<string, readonly EntityId[]>();
  #cacheVersion = 0;
  #metrics: EcsMetrics = {
    entities: 0,
    liveComponents: 0,
    archetypeBuckets: 0,
    queryCacheHits: 0,
    queryCacheMisses: 0,
    mutations: 0,
  };

  register<T extends AnyComponent>(schema: ComponentSchema<T>): void {
    if (this.#schemas.has(schema.type)) {
      const existing = this.#schemas.get(schema.type);
      if (existing !== schema) throw new Error(`Component already registered: ${String(schema.type)}`);
      return;
    }
    this.#schemas.set(schema.type, schema as ComponentSchema<AnyComponent>);
    this.#stores.set(schema.type, new Map());
    this.#metrics.archetypeBuckets = this.#stores.size;
  }

  registerDefaults(): void {
    this.register(Transform);
    this.register(Velocity);
    this.register(Health);
    this.register(Stamina);
    this.register(Identity);
    this.register(Network);
    this.register(Lifetime);
  }

  spawn(initial: ReadonlyMap<ComponentType, unknown> = new Map()): EntityId {
    const id = entityId(this.#nextEntity++);
    const entity: InternalEntity = { id, components: new Map(), insertionOrder: this.#insertionCounter++ };
    this.#entities.set(id, entity);
    for (const [type, value] of initial) this.attach(id, type, value);
    this.#metrics.entities = this.#entities.size;
    this.#invalidateQueries();
    return id;
  }

  destroy(id: EntityId): boolean {
    const entity = this.#entities.get(id);
    if (!entity) return false;
    for (const [type] of entity.components) this.#stores.get(type)?.delete(id);
    this.#entities.delete(id);
    this.#metrics.entities = this.#entities.size;
    this.#invalidateQueries();
    return true;
  }

  has(id: EntityId, type: ComponentType): boolean {
    return this.#entities.get(id)?.components.has(type) ?? false;
  }

  get<T>(id: EntityId, schema: ComponentSchema<T>): T | undefined {
    const value = this.#entities.get(id)?.components.get(schema.type);
    return value as T | undefined;
  }

  require<T>(id: EntityId, schema: ComponentSchema<T>): T {
    const value = this.get(id, schema);
    if (!value) throw new Error(`Missing component ${String(schema.type)} on entity ${id}`);
    return value;
  }

  attach<T>(id: EntityId, type: ComponentType, value: T): boolean {
    const entity = this.#entities.get(id);
    const schema = this.#schemas.get(type);
    if (!entity || !schema) return false;
    if (!schema.validate(value as AnyComponent)) return false;
    entity.components.set(type, value as AnyComponent);
    this.#stores.get(type)?.set(id, value as AnyComponent);
    this.#metrics.liveComponents += entity.components.has(type) ? 0 : 1;
    this.#metrics.mutations += 1;
    this.#invalidateQueries();
    return true;
  }

  createAndAttach<T>(id: EntityId, schema: ComponentSchema<T>, initial?: Partial<T>): T {
    const value = schema.create(initial);
    if (!this.attach(id, schema.type, value)) throw new Error(`Unable to attach ${String(schema.type)}`);
    return value;
  }

  detach(id: EntityId, type: ComponentType): boolean {
    const entity = this.#entities.get(id);
    if (!entity?.components.has(type)) return false;
    entity.components.delete(type);
    this.#stores.get(type)?.delete(id);
    this.#metrics.liveComponents = Math.max(0, this.#metrics.liveComponents - 1);
    this.#metrics.mutations += 1;
    this.#invalidateQueries();
    return true;
  }

  mutate<T>(id: EntityId, schema: ComponentSchema<T>, updater: (value: T) => void): T {
    const value = this.require(id, schema);
    updater(value);
    if (!schema.validate(value)) throw new Error(`Invalid ${String(schema.type)} after mutation`);
    this.#metrics.mutations += 1;
    return value;
  }

  query(plan: QueryPlan): readonly QueryResult[] {
    const ids = this.queryEntities(plan);
    return ids.map((entity) => {
      const components: Record<string, unknown> = {};
      const internal = this.#entities.get(entity);
      if (!internal) return { entity, components };
      for (const type of plan.required) components[String(type)] = internal.components.get(type);
      return { entity, components };
    });
  }

  queryEntities(plan: QueryPlan): readonly EntityId[] {
    const normalized: QueryPlan = {
      required: [...plan.required],
      excluded: [...plan.excluded],
      order: plan.order,
    };
    const key = `${this.#cacheVersion}:${planKey(normalized)}`;
    const cached = this.#queryCache.get(key);
    if (cached) {
      this.#metrics.queryCacheHits += 1;
      return cached;
    }
    this.#metrics.queryCacheMisses += 1;
    const result: EntityId[] = [];
    for (const entity of this.#entities.values()) {
      if (normalized.required.some((type) => !entity.components.has(type))) continue;
      if (normalized.excluded.some((type) => entity.components.has(type))) continue;
      result.push(entity.id);
    }
    if (normalized.order === 'id') result.sort((a, b) => a - b);
    else result.sort((a, b) => (this.#entities.get(a)?.insertionOrder ?? 0) - (this.#entities.get(b)?.insertionOrder ?? 0));
    const frozen = Object.freeze(result.slice()) as readonly EntityId[];
    this.#queryCache.set(key, frozen);
    return frozen;
  }

  forEach<T1>(schema1: ComponentSchema<T1>, visitor: (entity: EntityId, c1: T1) => void): void {
    const type = schema1.type;
    const store = this.#stores.get(type);
    if (!store) return;
    const ids = [...store.keys()].sort((a, b) => a - b);
    for (const id of ids) {
      const value = store.get(id);
      if (value) visitor(id, value as T1);
    }
  }

  forEach2<T1, T2>(s1: ComponentSchema<T1>, s2: ComponentSchema<T2>, visitor: (entity: EntityId, c1: T1, c2: T2) => void): void {
    const first = this.#stores.get(s1.type);
    const second = this.#stores.get(s2.type);
    if (!first || !second) return;
    const source = first.size <= second.size ? first : second;
    const ids = [...source.keys()].sort((a, b) => a - b);
    for (const id of ids) {
      const c1 = this.get(id, s1);
      const c2 = this.get(id, s2);
      if (c1 && c2) visitor(id, c1, c2);
    }
  }

  snapshot(): readonly EntitySnapshot[] {
    return [...this.#entities.values()]
      .sort((a, b) => a.id - b.id)
      .map((entity) => ({
        id: entity.id,
        componentTypes: [...entity.components.keys()].sort((a, b) => String(a).localeCompare(String(b))),
      }));
  }

  cloneEntity(id: EntityId): EntityId {
    const source = this.#entities.get(id);
    if (!source) throw new Error(`Unknown entity ${id}`);
    const copy = this.spawn();
    for (const [type, value] of source.components) {
      const schema = this.#schemas.get(type);
      if (!schema) continue;
      this.attach(copy, type, schema.clone(value));
    }
    return copy;
  }

  clear(): void {
    this.#entities.clear();
    for (const store of this.#stores.values()) store.clear();
    this.#metrics.entities = 0;
    this.#metrics.liveComponents = 0;
    this.#metrics.mutations = 0;
    this.#invalidateQueries();
  }

  metrics(): EcsMetrics {
    return { ...this.#metrics };
  }

  size(): number {
    return this.#entities.size;
  }

  entities(): readonly EntityId[] {
    return Object.freeze([...this.#entities.keys()].sort((a, b) => a - b));
  }

  #invalidateQueries(): void {
    this.#cacheVersion += 1;
    this.#queryCache.clear();
  }
}

export interface SystemContext {
  readonly tick: number;
  readonly dt: number;
  readonly world: EcsWorldV3;
}

export interface EcsSystem {
  readonly name: string;
  readonly priority: number;
  readonly enabled?: boolean;
  update(context: SystemContext): void;
}

export class SystemPipelineV3 {
  #systems: EcsSystem[] = [];

  add(system: EcsSystem): void {
    if (this.#systems.some((entry) => entry.name === system.name)) {
      throw new Error(`Duplicate system name: ${system.name}`);
    }
    this.#systems.push(system);
    this.#systems.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  }

  remove(name: string): boolean {
    const index = this.#systems.findIndex((system) => system.name === name);
    if (index < 0) return false;
    this.#systems.splice(index, 1);
    return true;
  }

  update(context: SystemContext): void {
    for (const system of this.#systems) {
      if (system.enabled === false) continue;
      system.update(context);
    }
  }

  describe(): readonly { name: string; priority: number; enabled: boolean }[] {
    return this.#systems.map((system) => ({
      name: system.name,
      priority: system.priority,
      enabled: system.enabled !== false,
    }));
  }
}

export const createDefaultEcsWorldV3 = (): EcsWorldV3 => {
  const world = new EcsWorldV3();
  world.registerDefaults();
  return world;
};
