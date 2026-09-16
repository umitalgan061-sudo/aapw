/**
 * V6 data-oriented world state.
 * Provides generation-safe entities, typed component storage, deterministic
 * queries and deferred mutations suitable for worker or main-thread use.
 */

export type EntityId = number & { readonly __brand: 'EntityId' };
export type ComponentName = 'transform' | 'velocity' | 'health' | 'team' | 'tags' | 'lifecycle' | 'interest';

export interface TransformComponent { x: number; y: number; z: number; yaw: number; pitch: number; }
export interface VelocityComponent { x: number; y: number; z: number; grounded: boolean; }
export interface HealthComponent { current: number; maximum: number; dead: boolean; }
export interface TeamComponent { id: string; relationMask: number; }
export interface TagsComponent { values: readonly string[]; }
export interface LifecycleComponent { state: 'active' | 'sleeping' | 'despawned'; generation: number; }
export interface InterestComponent { priority: number; radius: number; visible: boolean; }

export interface ComponentMap {
  transform: TransformComponent;
  velocity: VelocityComponent;
  health: HealthComponent;
  team: TeamComponent;
  tags: TagsComponent;
  lifecycle: LifecycleComponent;
  interest: InterestComponent;
}

export interface EntityRecord {
  readonly id: EntityId;
  readonly generation: number;
  readonly createdTick: number;
}

export type EntityRef = `${number}:${number}`;

export interface WorldMutation {
  readonly type: 'spawn' | 'despawn' | 'set' | 'remove';
  readonly entity: EntityRef;
  readonly component?: ComponentName;
  readonly value?: unknown;
}

export interface WorldQuery {
  readonly components: readonly ComponentName[];
  readonly tags?: readonly string[];
  readonly team?: string;
  readonly maxDistance?: number;
  readonly center?: { readonly x: number; readonly y: number; readonly z: number };
}

export interface WorldSnapshot {
  readonly tick: number;
  readonly nextId: number;
  readonly entities: readonly EntityRecord[];
  readonly components: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

function finite(value: number): number { return Number.isFinite(value) ? value : 0; }
function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }
function validEntityId(id: number): id is EntityId { return Number.isSafeInteger(id) && id > 0; }
function ref(id: EntityId, generation: number): EntityRef { return `${id}:${generation}`; }
function parseRef(value: EntityRef): { id: EntityId; generation: number } {
  const [idRaw, generationRaw] = value.split(':');
  const id = Number(idRaw); const generation = Number(generationRaw);
  if (!validEntityId(id) || !Number.isSafeInteger(generation) || generation < 1) throw new TypeError('invalid entity ref');
  return { id, generation };
}

function cloneComponent<T>(value: T): T { return structuredClone(value); }

export class WorldState {
  #nextId = 1;
  #tick = 0;
  readonly #generation = new Map<number, number>();
  readonly #entities = new Map<EntityId, EntityRecord>();
  readonly #components = new Map<ComponentName, Map<EntityId, unknown>>();
  readonly #mutations: WorldMutation[] = [];

  constructor() {
    for (const name of ['transform', 'velocity', 'health', 'team', 'tags', 'lifecycle', 'interest'] as const) this.#components.set(name, new Map());
  }

  get tick(): number { return this.#tick; }
  get entityCount(): number { return this.#entities.size; }

  spawn(tick = this.#tick): EntityRef {
    const id = this.#nextId++ as EntityId;
    const generation = (this.#generation.get(id) ?? 0) + 1;
    this.#generation.set(id, generation);
    this.#entities.set(id, { id, generation, createdTick: Math.max(0, Math.floor(tick)) });
    return ref(id, generation);
  }

  isAlive(entity: EntityRef): boolean {
    const parsed = parseRef(entity);
    const record = this.#entities.get(parsed.id);
    return record?.generation === parsed.generation;
  }

  despawn(entity: EntityRef): boolean {
    if (!this.isAlive(entity)) return false;
    const { id } = parseRef(entity);
    this.#entities.delete(id);
    for (const storage of this.#components.values()) storage.delete(id);
    return true;
  }

  set<K extends ComponentName>(entity: EntityRef, component: K, value: ComponentMap[K]): boolean {
    if (!this.isAlive(entity)) return false;
    const { id } = parseRef(entity);
    this.#components.get(component)!.set(id, this.#normalizeComponent(component, value));
    return true;
  }

  get<K extends ComponentName>(entity: EntityRef, component: K): ComponentMap[K] | undefined {
    if (!this.isAlive(entity)) return undefined;
    const { id } = parseRef(entity);
    const value = this.#components.get(component)!.get(id) as ComponentMap[K] | undefined;
    return value === undefined ? undefined : cloneComponent(value);
  }

  remove(entity: EntityRef, component: ComponentName): boolean {
    if (!this.isAlive(entity)) return false;
    const { id } = parseRef(entity);
    return this.#components.get(component)!.delete(id);
  }

  queue(mutation: WorldMutation): void { this.#mutations.push({ ...mutation }); }

  applyQueued(): number {
    const pending = this.#mutations.splice(0);
    let applied = 0;
    for (const mutation of pending) {
      try {
        if (mutation.type === 'despawn') { if (this.despawn(mutation.entity)) applied += 1; continue; }
        if (mutation.type === 'remove' && mutation.component) { if (this.remove(mutation.entity, mutation.component)) applied += 1; continue; }
        if (mutation.type === 'set' && mutation.component) {
          if (this.set(mutation.entity, mutation.component, mutation.value as never)) applied += 1;
          continue;
        }
      } catch { /* invalid deferred mutations fail closed */ }
    }
    return applied;
  }

  query(query: WorldQuery): readonly EntityRef[] {
    const required = [...new Set(query.components)];
    const tagSet = new Set(query.tags ?? []);
    const results: { ref: EntityRef; score: number }[] = [];
    for (const record of this.#entities.values()) {
      const hasAll = required.every((component) => this.#components.get(component)!.has(record.id));
      if (!hasAll) continue;
      if (tagSet.size > 0) {
        const tags = this.#components.get('tags')!.get(record.id) as TagsComponent | undefined;
        if (!tags || ![...tagSet].every((tag) => tags.values.includes(tag))) continue;
      }
      if (query.team) {
        const team = this.#components.get('team')!.get(record.id) as TeamComponent | undefined;
        if (team?.id !== query.team) continue;
      }
      let distance = 0;
      if (query.center) {
        const transform = this.#components.get('transform')!.get(record.id) as TransformComponent | undefined;
        if (!transform) continue;
        distance = Math.hypot(transform.x - query.center.x, transform.y - query.center.y, transform.z - query.center.z);
        if (query.maxDistance !== undefined && distance > query.maxDistance) continue;
      }
      const interest = this.#components.get('interest')!.get(record.id) as InterestComponent | undefined;
      results.push({ ref: ref(record.id, record.generation), score: (interest?.priority ?? 0) * 1000 - distance });
    }
    results.sort((a, b) => b.score - a.score || a.ref.localeCompare(b.ref));
    return results.map((entry) => entry.ref);
  }

  step(tick: number): void {
    this.#tick = Math.max(this.#tick, Math.floor(tick));
    this.applyQueued();
  }

  snapshot(): WorldSnapshot {
    const components: Record<string, Record<string, unknown>> = {};
    for (const [name, storage] of this.#components) {
      const values: Record<string, unknown> = {};
      for (const [id, value] of storage) {
        const generation = this.#entities.get(id)?.generation;
        if (generation !== undefined) values[ref(id, generation)] = cloneComponent(value);
      }
      components[name] = values;
    }
    return {
      tick: this.#tick,
      nextId: this.#nextId,
      entities: [...this.#entities.values()].sort((a, b) => a.id - b.id).map((record) => ({ ...record })),
      components,
    };
  }

  restore(snapshot: WorldSnapshot): void {
    this.#tick = Math.max(0, Math.floor(snapshot.tick));
    this.#nextId = Math.max(1, Math.floor(snapshot.nextId));
    this.#entities.clear();
    this.#generation.clear();
    for (const storage of this.#components.values()) storage.clear();
    for (const record of snapshot.entities) {
      this.#entities.set(record.id, { ...record });
      this.#generation.set(record.id, record.generation);
    }
    for (const component of Object.keys(snapshot.components) as ComponentName[]) {
      const storage = this.#components.get(component);
      if (!storage) continue;
      for (const [entityRef, value] of Object.entries(snapshot.components[component]!)) {
        const parsed = parseRef(entityRef as EntityRef);
        if (this.isAlive(entityRef as EntityRef)) storage.set(parsed.id, this.#normalizeComponent(component, cloneComponent(value) as never));
      }
    }
    this.#mutations.length = 0;
  }

  checksum(): number {
    const serialized = JSON.stringify(this.snapshot());
    let hash = 0x811c9dc5;
    for (let index = 0; index < serialized.length; index += 1) { hash ^= serialized.charCodeAt(index); hash = Math.imul(hash, 16777619); }
    return hash >>> 0;
  }

  entities(): readonly EntityRef[] { return [...this.#entities.values()].sort((a, b) => a.id - b.id).map((record) => ref(record.id, record.generation)); }

  #normalizeComponent<K extends ComponentName>(component: K, value: ComponentMap[K]): ComponentMap[K] {
    if (component === 'transform') {
      const item = value as TransformComponent;
      return { x: finite(item.x), y: finite(item.y), z: finite(item.z), yaw: finite(item.yaw), pitch: clamp(finite(item.pitch), -Math.PI / 2, Math.PI / 2) } as ComponentMap[K];
    }
    if (component === 'velocity') {
      const item = value as VelocityComponent;
      return { x: finite(item.x), y: finite(item.y), z: finite(item.z), grounded: Boolean(item.grounded) } as ComponentMap[K];
    }
    if (component === 'health') {
      const item = value as HealthComponent;
      const maximum = Math.max(1, finite(item.maximum));
      const current = clamp(finite(item.current), 0, maximum);
      return { current, maximum, dead: current <= 0 || Boolean(item.dead) } as ComponentMap[K];
    }
    if (component === 'team') {
      const item = value as TeamComponent;
      return { id: String(item.id).slice(0, 64), relationMask: (item.relationMask >>> 0) } as ComponentMap[K];
    }
    if (component === 'tags') {
      const item = value as TagsComponent;
      return { values: [...new Set(item.values.map((tag) => String(tag).slice(0, 64)).filter(Boolean))].slice(0, 64) } as ComponentMap[K];
    }
    if (component === 'lifecycle') {
      const item = value as LifecycleComponent;
      return { state: item.state, generation: Math.max(1, Math.floor(item.generation)) } as ComponentMap[K];
    }
    const item = value as InterestComponent;
    return { priority: clamp(finite(item.priority), -100, 100), radius: Math.max(0, finite(item.radius)), visible: Boolean(item.visible) } as ComponentMap[K];
  }
}

export function makeEntityRef(id: number, generation: number): EntityRef {
  if (!validEntityId(id) || !Number.isSafeInteger(generation) || generation < 1) throw new TypeError('invalid entity identity');
  return ref(id, generation);
}

export function entityRefParts(entity: EntityRef): readonly [number, number] {
  const parsed = parseRef(entity);
  return [parsed.id, parsed.generation];
}

export function distanceSquared(a: TransformComponent, b: TransformComponent): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
}

export function areHostile(a: TeamComponent, b: TeamComponent): boolean {
  if (a.id === b.id) return false;
  const bit = Math.abs(a.id.length + b.id.length) % 30;
  return ((a.relationMask >>> bit) & 1) === 1;
}
