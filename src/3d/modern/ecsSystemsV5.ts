import { type EntityIdV5, type EntityStateV5, type TickV5, type Vec3V5, addV5, clampV5, magnitudeV5, vec3V5 } from './runtimeContractV5';

export interface EcsWorldV5 { get(id: EntityIdV5): EntityStateV5 | null; upsert(entity: EntityStateV5): void; remove(id: EntityIdV5): boolean; values(): readonly EntityStateV5[]; }
export interface MovementIntentV5 { readonly entity: EntityIdV5; readonly direction: Vec3V5; readonly sprint: boolean; readonly jump: boolean; }
export interface CombatIntentV5 { readonly entity: EntityIdV5; readonly attack: boolean; readonly block: boolean; readonly target: EntityIdV5 | null; }
export interface SystemContextV5 { readonly tick: TickV5; readonly deltaSeconds: number; readonly world: EcsWorldV5; }
export interface SystemStatsV5 { readonly name: string; readonly processed: number; readonly mutations: number; readonly rejected: number; }
export interface SystemV5 { readonly name: string; readonly order: number; readonly update: (context: SystemContextV5) => SystemStatsV5; }

const normalize = (direction: Vec3V5): Vec3V5 => { const length = magnitudeV5(direction); return length > 1 ? vec3V5(direction.x / length, direction.y / length, direction.z / length) : direction; };

export class MovementSystemV5 implements SystemV5 {
  readonly name = 'movement'; readonly order = 20;
  readonly intents = new Map<EntityIdV5, MovementIntentV5>();
  update(context: SystemContextV5): SystemStatsV5 {
    let processed = 0; let mutations = 0; let rejected = 0;
    for (const entity of context.world.values()) {
      const intent = this.intents.get(entity.id); if (!intent || !entity.active) continue; processed += 1;
      const speed = intent.sprint ? 1.35 : 1; const direction = normalize(intent.direction); const velocity = vec3V5(direction.x * speed * 8, entity.velocity.y, direction.z * speed * 8); const displacement = { x: velocity.x * context.deltaSeconds, y: velocity.y * context.deltaSeconds, z: velocity.z * context.deltaSeconds };
      const position = addV5(entity.transform.position, displacement);
      if (![position.x, position.y, position.z].every(Number.isFinite)) { rejected += 1; continue; }
      context.world.upsert(Object.freeze({ ...entity, transform: Object.freeze({ ...entity.transform, position }), velocity, revision: entity.revision + 1 })); mutations += 1;
    }
    return Object.freeze({ name: this.name, processed, mutations, rejected });
  }
}

export class HealthSystemV5 implements SystemV5 {
  readonly name = 'health'; readonly order = 30;
  #damage = new Map<EntityIdV5, number>(); #heals = new Map<EntityIdV5, number>();
  damage(id: EntityIdV5, amount: number): void { this.#damage.set(id, (this.#damage.get(id) ?? 0) + Math.max(0, amount)); }
  heal(id: EntityIdV5, amount: number): void { this.#heals.set(id, (this.#heals.get(id) ?? 0) + Math.max(0, amount)); }
  update(context: SystemContextV5): SystemStatsV5 { let processed = 0; let mutations = 0; let rejected = 0; for (const entity of context.world.values()) { const damage = this.#damage.get(entity.id) ?? 0; const heal = this.#heals.get(entity.id) ?? 0; if (!damage && !heal) continue; processed += 1; const current = (entity as EntityStateV5 & { health?: number }).health ?? 100; const next = clampV5(current - damage + heal, 0, 100); if (!Number.isFinite(next)) { rejected += 1; continue; } context.world.upsert(Object.freeze({ ...entity, tags: next <= 0 ? Object.freeze([...entity.tags, 'dead']) : entity.tags, revision: entity.revision + 1 })); mutations += 1; } this.#damage.clear(); this.#heals.clear(); return Object.freeze({ name: this.name, processed, mutations, rejected }); }
}

export class LifetimeSystemV5 implements SystemV5 {
  readonly name = 'lifetime'; readonly order = 40;
  #despawn = new Map<EntityIdV5, number>();
  schedule(id: EntityIdV5, tick: number): void { this.#despawn.set(id, Math.max(0, Math.floor(tick))); }
  update(context: SystemContextV5): SystemStatsV5 { let processed = 0; let mutations = 0; let rejected = 0; for (const [id, despawnTick] of this.#despawn) { if (context.tick < despawnTick) continue; processed += 1; if (!context.world.remove(id)) rejected += 1; else mutations += 1; this.#despawn.delete(id); } return Object.freeze({ name: this.name, processed, mutations, rejected }); }
}

export class TagSystemV5 implements SystemV5 {
  readonly name = 'tag'; readonly order = 50;
  #add = new Map<EntityIdV5, Set<string>>(); #remove = new Map<EntityIdV5, Set<string>>();
  add(id: EntityIdV5, tag: string): void { if (!tag.trim()) return; const set = this.#add.get(id) ?? new Set<string>(); set.add(tag.trim().slice(0, 48)); this.#add.set(id, set); }
  remove(id: EntityIdV5, tag: string): void { const set = this.#remove.get(id) ?? new Set<string>(); set.add(tag.trim().slice(0, 48)); this.#remove.set(id, set); }
  update(context: SystemContextV5): SystemStatsV5 { let processed = 0; let mutations = 0; let rejected = 0; const ids = new Set([...this.#add.keys(), ...this.#remove.keys()]); for (const id of ids) { const entity = context.world.get(id); if (!entity) { rejected += 1; continue; } processed += 1; const tags = new Set(entity.tags); for (const tag of this.#add.get(id) ?? []) tags.add(tag); for (const tag of this.#remove.get(id) ?? []) tags.delete(tag); context.world.upsert(Object.freeze({ ...entity, tags: Object.freeze([...tags].sort()), revision: entity.revision + 1 })); mutations += 1; } this.#add.clear(); this.#remove.clear(); return Object.freeze({ name: this.name, processed, mutations, rejected }); }
}

export class EcsPipelineV5 {
  #systems: SystemV5[] = [];
  register(system: SystemV5): void { if (this.#systems.some((candidate) => candidate.name === system.name)) throw new Error(`System exists: ${system.name}`); this.#systems.push(system); this.#systems.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)); }
  unregister(name: string): boolean { const size = this.#systems.length; this.#systems = this.#systems.filter((system) => system.name !== name); return size !== this.#systems.length; }
  update(context: SystemContextV5): readonly SystemStatsV5[] { return Object.freeze(this.#systems.map((system) => { try { return system.update(context); } catch { return Object.freeze({ name: system.name, processed: 0, mutations: 0, rejected: 1 }); } })); }
  systems(): readonly string[] { return Object.freeze(this.#systems.map((system) => system.name)); }
  clear(): void { this.#systems.length = 0; }
}

export function createDefaultEcsPipelineV5(): { readonly pipeline: EcsPipelineV5; readonly movement: MovementSystemV5; readonly health: HealthSystemV5; readonly lifetime: LifetimeSystemV5; readonly tags: TagSystemV5 } { const pipeline = new EcsPipelineV5(); const movement = new MovementSystemV5(); const health = new HealthSystemV5(); const lifetime = new LifetimeSystemV5(); const tags = new TagSystemV5(); pipeline.register(movement); pipeline.register(health); pipeline.register(lifetime); pipeline.register(tags); return Object.freeze({ pipeline, movement, health, lifetime, tags }); }
