import type { Disposable, EntityId, SystemId, Vec3 } from './coreTypes.js';
import { COMPONENT_TYPE, ENTITY_ID, SYSTEM_ID, stableSort } from './coreTypes.js';

export interface TransformComponent { position: Vec3; yaw: number; pitch: number; scale: number; }
export interface VelocityComponent { value: Vec3; maxSpeed: number; acceleration: number; damping: number; }
export interface HealthComponent { current: number; maximum: number; dead: boolean; }
export interface IdentityComponent { archetype: string; tags: readonly string[]; }
export interface EcsEntity { readonly id: EntityId; readonly components: ReadonlySet<string>; }
export interface QuerySpec { readonly all?: readonly string[]; readonly any?: readonly string[]; readonly none?: readonly string[]; readonly stable?: boolean; }
export interface SystemDefinition { readonly id: SystemId; readonly priority: number; readonly update: (dt: number, world: EcsRuntime) => void; }
export interface EcsStats { readonly entities: number; readonly components: number; readonly systems: number; readonly queries: number; readonly queryHits: number; readonly mutations: number; }

function validName(name: string): boolean { return /^[a-zA-Z0-9:_-]{1,96}$/.test(name); }
function normalize(value: Vec3): Vec3 { const length = Math.hypot(value.x, value.y, value.z); if (!Number.isFinite(length) || length < Number.EPSILON) return Object.freeze({ x: 0, y: 0, z: 0 }); return Object.freeze({ x: value.x / length, y: value.y / length, z: value.z / length }); }

export class EcsRuntime implements Disposable {
  #entities = new Map<EntityId, Map<string, unknown>>();
  #systems = new Map<SystemId, SystemDefinition>();
  #queryCache = new Map<string, readonly EntityId[]>();
  #version = 0;
  #queries = 0;
  #queryHits = 0;
  #mutations = 0;
  #disposed = false;

  spawn(id?: EntityId): EntityId {
    const entity = id ?? ENTITY_ID(`e-${this.#entities.size + 1}`);
    if (this.#entities.has(entity)) throw new Error('ENTITY_EXISTS');
    this.#entities.set(entity, new Map()); this.#invalidate(); return entity;
  }
  destroy(id: EntityId): boolean { const removed = this.#entities.delete(id); if (removed) { this.#invalidate(); this.#mutations += 1; } return removed; }

  attach<T>(id: EntityId, type: string, value: T): boolean {
    if (!validName(type)) return false;
    const components = this.#entities.get(id); if (!components) return false;
    const normalizedType = String(COMPONENT_TYPE(type));
    components.set(normalizedType, value); this.#mutations += 1; this.#invalidate(); return true;
  }
  detach(id: EntityId, type: string): boolean { const components = this.#entities.get(id); if (!components || !components.has(type)) return false; components.delete(type); this.#mutations += 1; this.#invalidate(); return true; }
  has(id: EntityId, type: string): boolean { return this.#entities.get(id)?.has(type) ?? false; }
  get<T>(id: EntityId, type: string): T | undefined { return this.#entities.get(id)?.get(type) as T | undefined; }

  query(spec: QuerySpec): readonly EntityId[] {
    const all = [...(spec.all ?? [])].sort(); const any = [...(spec.any ?? [])].sort(); const none = [...(spec.none ?? [])].sort();
    const key = `${this.#version}|${spec.stable !== false ? 's' : 'i'}|a:${all.join(',')}|y:${any.join(',')}|n:${none.join(',')}`;
    const cached = this.#queryCache.get(key); this.#queries += 1; if (cached) { this.#queryHits += 1; return cached; }
    const result: EntityId[] = [];
    for (const [id, components] of this.#entities) {
      if (all.some(type => !components.has(type))) continue;
      if (any.length && !any.some(type => components.has(type))) continue;
      if (none.some(type => components.has(type))) continue;
      result.push(id);
    }
    if (spec.stable !== false) result.sort((a, b) => String(a).localeCompare(String(b)));
    const frozen = Object.freeze(result.slice()); this.#queryCache.set(key, frozen); return frozen;
  }

  registerSystem(system: SystemDefinition): boolean {
    if (this.#disposed || !system.id || this.#systems.has(system.id)) return false;
    this.#systems.set(system.id, Object.freeze({ ...system, id: SYSTEM_ID(String(system.id)) })); return true;
  }
  unregisterSystem(id: SystemId): boolean { return this.#systems.delete(id); }
  update(dt: number): void { if (this.#disposed) return; const delta = Math.max(0, Math.min(0.1, Number.isFinite(dt) ? dt : 0)); for (const system of stableSort([...this.#systems.values()], (a, b) => a.priority - b.priority || String(a.id).localeCompare(String(b.id)))) system.update(delta, this); }

  transform(id: EntityId): TransformComponent | undefined { return this.get<TransformComponent>(id, 'transform'); }
  velocity(id: EntityId): VelocityComponent | undefined { return this.get<VelocityComponent>(id, 'velocity'); }
  health(id: EntityId): HealthComponent | undefined { return this.get<HealthComponent>(id, 'health'); }

  integrate(dt: number): number {
    const delta = Math.max(0, Math.min(0.1, dt)); let changed = 0;
    for (const id of this.query({ all: ['transform', 'velocity'] })) {
      const transform = this.transform(id); const velocity = this.velocity(id); if (!transform || !velocity) continue;
      const speed = Math.hypot(velocity.value.x, velocity.value.y, velocity.value.z); const direction = speed > velocity.maxSpeed ? normalize(velocity.value) : velocity.value;
      const scale = speed > velocity.maxSpeed ? velocity.maxSpeed : 1;
      const next: TransformComponent = { ...transform, position: Object.freeze({ x: transform.position.x + direction.x * scale * delta, y: transform.position.y + direction.y * scale * delta, z: transform.position.z + direction.z * scale * delta }) };
      this.attach(id, 'transform', next); changed += 1;
    }
    return changed;
  }

  snapshot(): readonly EcsEntity[] { return Object.freeze(stableSort([...this.#entities.entries()].map(([id, components]) => Object.freeze({ id, components: Object.freeze(new Set(components.keys())) })), (a, b) => String(a.id).localeCompare(String(b.id)))); }
  stats(): EcsStats { let componentCount = 0; for (const components of this.#entities.values()) componentCount += components.size; return Object.freeze({ entities: this.#entities.size, components: componentCount, systems: this.#systems.size, queries: this.#queries, queryHits: this.#queryHits, mutations: this.#mutations }); }
  clear(): void { this.#entities.clear(); this.#queryCache.clear(); this.#invalidate(); }
  dispose(): void { this.#disposed = true; this.clear(); this.#systems.clear(); }
  #invalidate(): void { this.#version += 1; this.#queryCache.clear(); }
}
