import {
  AiComponent,
  AnimationComponent,
  AudioComponent,
  CombatComponent,
  Component,
  ComponentByKind,
  ComponentKind,
  EntityId,
  EntityRecord,
  HealthComponent,
  InventoryComponent,
  MetadataComponent,
  NetworkComponent,
  QuestComponent,
  RenderComponent,
  StaminaComponent,
  Tick,
  TransformComponent,
  VelocityComponent,
  asEntityId,
  asTick,
  cloneComponent,
  cloneEntity,
  nextTick,
} from './domain.ts';

export type ComponentDefaults = Partial<Record<ComponentKind, Component>>;

export interface EntityQuery {
  readonly all?: readonly ComponentKind[];
  readonly any?: readonly ComponentKind[];
  readonly none?: readonly ComponentKind[];
  readonly activeOnly?: boolean;
}

export interface SpawnEntityOptions {
  readonly id?: EntityId;
  readonly components?: readonly Component[];
  readonly createdTick?: Tick;
  readonly active?: boolean;
}

export interface WorldStats {
  readonly entities: number;
  readonly activeEntities: number;
  readonly components: number;
  readonly archetypes: number;
  readonly nextEntityId: EntityId;
}

export type ComponentListener = (entity: EntityId, component: Component) => void;
export type EntityListener = (entity: EntityRecord) => void;

const DEFAULT_COMPONENTS: ComponentDefaults = {
  transform: { kind: 'transform', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } },
  velocity: { kind: 'velocity', linear: { x: 0, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 }, grounded: false },
  health: { kind: 'health', current: 100, maximum: 100, invulnerableUntil: asTick(0) },
  stamina: { kind: 'stamina', current: 100, maximum: 100, regenPerSecond: 15, lockedUntil: asTick(0) },
  animation: { kind: 'animation', locomotion: 'idle', upperBody: 'empty', additiveWeight: 0, playbackRate: 1, normalizedTime: 0 },
  combat: { kind: 'combat', stance: 'neutral', poise: 100, maximumPoise: 100, cooldownUntil: asTick(0) },
  ai: { kind: 'ai', archetype: 'neutral', target: null, alertness: 0, thinkDebt: 0 },
  inventory: { kind: 'inventory', capacity: 24, slots: [] },
  quest: { kind: 'quest', activeQuestIds: [], completedQuestIds: [] },
  network: { kind: 'network', authority: 'local', sequence: 0, lastAcknowledgedTick: asTick(0) },
  render: { kind: 'render', visible: true, lod: 0, layer: 0, assetId: null },
  audio: { kind: 'audio', emitterEnabled: false, volume: 1, maxDistance: 30 },
  metadata: { kind: 'metadata', tags: [], name: 'entity' },
};

const cloneDefault = (kind: ComponentKind): Component => {
  const component = DEFAULT_COMPONENTS[kind];
  if (!component) throw new Error(`Unknown component kind: ${kind}`);
  return cloneComponent(component);
};

const componentKinds = (entity: EntityRecord): ComponentKind[] => [...entity.components.keys()];

export class EcsWorldV5 {
  readonly #entities = new Map<EntityId, EntityRecord>();
  readonly #nextId: { value: number } = { value: 1 };
  readonly #byComponent = new Map<ComponentKind, Set<EntityId>>();
  readonly #listeners = new Map<ComponentKind, Set<ComponentListener>>();
  readonly #spawnListeners = new Set<EntityListener>();
  readonly #destroyListeners = new Set<(entity: EntityId) => void>();
  #currentTick: Tick = asTick(0);

  constructor(readonly maxEntities = 100_000) {
    if (!Number.isInteger(maxEntities) || maxEntities < 1) throw new RangeError('maxEntities must be a positive integer');
    for (const kind of Object.keys(DEFAULT_COMPONENTS) as ComponentKind[]) this.#byComponent.set(kind, new Set());
  }

  get tick(): Tick {
    return this.#currentTick;
  }

  advanceTick(): Tick {
    this.#currentTick = nextTick(this.#currentTick);
    return this.#currentTick;
  }

  spawn(options: SpawnEntityOptions = {}): EntityId {
    if (this.#entities.size >= this.maxEntities) throw new Error('ECS entity budget exhausted');
    const id = options.id ?? asEntityId(this.#allocateId());
    if (this.#entities.has(id)) throw new Error(`Entity ${id} already exists`);
    const components = new Map<ComponentKind, Component>();
    for (const component of options.components ?? []) {
      if (components.has(component.kind)) throw new Error(`Duplicate component ${component.kind}`);
      components.set(component.kind, cloneComponent(component));
    }
    const entity: EntityRecord = {
      id,
      createdTick: options.createdTick ?? this.#currentTick,
      components,
      active: options.active ?? true,
    };
    this.#entities.set(id, entity);
    for (const kind of components.keys()) this.#byComponent.get(kind)?.add(id);
    for (const listener of this.#spawnListeners) listener(cloneEntity(entity));
    return id;
  }

  spawnWithDefaults(kinds: readonly ComponentKind[] = ['transform', 'velocity', 'health']): EntityId {
    const unique = [...new Set(kinds)];
    return this.spawn({ components: unique.map(cloneDefault) });
  }

  destroy(id: EntityId): boolean {
    const entity = this.#entities.get(id);
    if (!entity) return false;
    for (const kind of entity.components.keys()) this.#byComponent.get(kind)?.delete(id);
    this.#entities.delete(id);
    for (const listener of this.#destroyListeners) listener(id);
    return true;
  }

  has(id: EntityId): boolean {
    return this.#entities.has(id);
  }

  get(id: EntityId): EntityRecord | undefined {
    const entity = this.#entities.get(id);
    return entity ? cloneEntity(entity) : undefined;
  }

  getMutable(id: EntityId): EntityRecord {
    const entity = this.#entities.get(id);
    if (!entity) throw new Error(`Unknown entity ${id}`);
    return entity;
  }

  getComponent<K extends ComponentKind>(id: EntityId, kind: K): ComponentByKind<K> | undefined {
    return this.#entities.get(id)?.components.get(kind) as ComponentByKind<K> | undefined;
  }

  requireComponent<K extends ComponentKind>(id: EntityId, kind: K): ComponentByKind<K> {
    const component = this.getComponent(id, kind);
    if (!component) throw new Error(`Entity ${id} is missing component ${kind}`);
    return component;
  }

  setComponent(id: EntityId, component: Component): void {
    const entity = this.getMutable(id);
    const had = entity.components.has(component.kind);
    entity.components.set(component.kind, cloneComponent(component));
    if (!had) this.#byComponent.get(component.kind)?.add(id);
    this.#emitComponent(id, component);
  }

  removeComponent(id: EntityId, kind: ComponentKind): boolean {
    const entity = this.#entities.get(id);
    if (!entity || !entity.components.has(kind)) return false;
    entity.components.delete(kind);
    this.#byComponent.get(kind)?.delete(id);
    return true;
  }

  addComponentListener(kind: ComponentKind, listener: ComponentListener): () => void {
    const listeners = this.#listeners.get(kind) ?? new Set<ComponentListener>();
    listeners.add(listener);
    this.#listeners.set(kind, listeners);
    return () => listeners.delete(listener);
  }

  onSpawn(listener: EntityListener): () => void {
    this.#spawnListeners.add(listener);
    return () => this.#spawnListeners.delete(listener);
  }

  onDestroy(listener: (entity: EntityId) => void): () => void {
    this.#destroyListeners.add(listener);
    return () => this.#destroyListeners.delete(listener);
  }

  setActive(id: EntityId, active: boolean): void {
    this.getMutable(id).active = active;
  }

  query(query: EntityQuery = {}): readonly EntityRecord[] {
    const candidates = this.#selectCandidates(query);
    const result: EntityRecord[] = [];
    for (const id of candidates) {
      const entity = this.#entities.get(id);
      if (!entity) continue;
      if (query.activeOnly !== false && !entity.active) continue;
      if (query.all && !query.all.every((kind) => entity.components.has(kind))) continue;
      if (query.any && query.any.length > 0 && !query.any.some((kind) => entity.components.has(kind))) continue;
      if (query.none && query.none.some((kind) => entity.components.has(kind))) continue;
      result.push(cloneEntity(entity));
    }
    result.sort((a, b) => Number(a.id) - Number(b.id));
    return result;
  }

  forEach(query: EntityQuery, callback: (entity: EntityRecord) => void): void {
    for (const entity of this.query(query)) callback(entity);
  }

  snapshot(): readonly EntityRecord[] {
    return [...this.#entities.values()].sort((a, b) => Number(a.id) - Number(b.id)).map(cloneEntity);
  }

  restore(entities: readonly EntityRecord[], tick: Tick): void {
    this.#entities.clear();
    for (const set of this.#byComponent.values()) set.clear();
    let maxId = 0;
    for (const entity of entities) {
      if (this.#entities.has(entity.id)) throw new Error(`Duplicate snapshot entity ${entity.id}`);
      const restored = cloneEntity(entity);
      this.#entities.set(entity.id, restored);
      maxId = Math.max(maxId, Number(entity.id));
      for (const kind of restored.components.keys()) this.#byComponent.get(kind)?.add(entity.id);
    }
    this.#nextId.value = maxId + 1;
    this.#currentTick = tick;
  }

  stats(): WorldStats {
    let components = 0;
    for (const entity of this.#entities.values()) components += entity.components.size;
    const archetypes = new Set(this.snapshot().map((entity) => componentKinds(entity).sort().join('|'))).size;
    return { entities: this.#entities.size, activeEntities: this.query({ activeOnly: true }).length, components, archetypes, nextEntityId: asEntityId(this.#nextId.value) };
  }

  clear(): void {
    for (const id of [...this.#entities.keys()]) this.destroy(id);
    this.#currentTick = asTick(0);
  }

  private #allocateId(): number {
    while (this.#entities.has(asEntityId(this.#nextId.value))) this.#nextId.value += 1;
    const value = this.#nextId.value;
    this.#nextId.value += 1;
    return value;
  }

  private #selectCandidates(query: EntityQuery): readonly EntityId[] {
    const all = query.all ?? [];
    if (all.length > 0) {
      const sets = all.map((kind) => this.#byComponent.get(kind) ?? new Set<EntityId>());
      sets.sort((a, b) => a.size - b.size);
      return [...sets[0]!].filter((id) => sets.every((set) => set.has(id)));
    }
    if (query.any && query.any.length > 0) {
      const union = new Set<EntityId>();
      for (const kind of query.any) for (const id of this.#byComponent.get(kind) ?? []) union.add(id);
      return [...union];
    }
    return [...this.#entities.keys()];
  }

  private #emitComponent(id: EntityId, component: Component): void {
    for (const listener of this.#listeners.get(component.kind) ?? []) listener(id, cloneComponent(component));
  }
}

export class TransformStoreV5 {
  constructor(private readonly world: EcsWorldV5) {}

  get(id: EntityId): TransformComponent {
    return this.world.requireComponent(id, 'transform');
  }

  setPosition(id: EntityId, x: number, y: number, z: number): void {
    const current = this.get(id);
    this.world.setComponent(id, { ...current, position: { x, y, z } });
  }
}

export class HealthStoreV5 {
  constructor(private readonly world: EcsWorldV5) {}

  get(id: EntityId): HealthComponent {
    return this.world.requireComponent(id, 'health');
  }

  damage(id: EntityId, amount: number, tick = this.world.tick): number {
    const current = this.get(id);
    if (tick < current.invulnerableUntil || amount <= 0) return current.current;
    const value = Math.max(0, current.current - amount);
    this.world.setComponent(id, { ...current, current: value });
    return value;
  }

  heal(id: EntityId, amount: number): number {
    const current = this.get(id);
    const value = Math.min(current.maximum, current.current + Math.max(0, amount));
    this.world.setComponent(id, { ...current, current: value });
    return value;
  }
}

export class StaminaStoreV5 {
  constructor(private readonly world: EcsWorldV5) {}

  get(id: EntityId): StaminaComponent {
    return this.world.requireComponent(id, 'stamina');
  }

  spend(id: EntityId, amount: number): boolean {
    const current = this.get(id);
    if (amount <= 0 || current.current < amount) return false;
    this.world.setComponent(id, { ...current, current: current.current - amount });
    return true;
  }

  regenerate(id: EntityId, deltaSeconds: number): number {
    const current = this.get(id);
    const value = Math.min(current.maximum, current.current + Math.max(0, deltaSeconds) * current.regenPerSecond);
    this.world.setComponent(id, { ...current, current: value });
    return value;
  }
}

export const isTransform = (component: Component): component is TransformComponent => component.kind === 'transform';
export const isVelocity = (component: Component): component is VelocityComponent => component.kind === 'velocity';
export const isAnimation = (component: Component): component is AnimationComponent => component.kind === 'animation';
export const isCombat = (component: Component): component is CombatComponent => component.kind === 'combat';
export const isAi = (component: Component): component is AiComponent => component.kind === 'ai';
export const isInventory = (component: Component): component is InventoryComponent => component.kind === 'inventory';
export const isQuest = (component: Component): component is QuestComponent => component.kind === 'quest';
export const isNetwork = (component: Component): component is NetworkComponent => component.kind === 'network';
export const isRender = (component: Component): component is RenderComponent => component.kind === 'render';
export const isAudio = (component: Component): component is AudioComponent => component.kind === 'audio';
export const isMetadata = (component: Component): component is MetadataComponent => component.kind === 'metadata';
