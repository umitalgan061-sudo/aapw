import type { ActorComponentSetV7, EntityIdV7, EntityRecordV7, InterestComponentV7, KinematicsComponentV7, NetworkComponentV7, TickV7, TransformComponentV7, VitalComponentV7 } from './types.ts';
import { clampV7, tickV7 } from './types.ts';

const cloneVec = (v: { x: number; y: number; z: number }) => Object.freeze({ x: v.x, y: v.y, z: v.z });

function cloneComponents(components: ActorComponentSetV7): ActorComponentSetV7 {
  return Object.freeze({
    transform: Object.freeze({
      position: cloneVec(components.transform.position),
      yaw: components.transform.yaw,
      pitch: components.transform.pitch,
      scale: cloneVec(components.transform.scale),
    }),
    kinematics: Object.freeze({
      velocity: cloneVec(components.kinematics.velocity),
      acceleration: cloneVec(components.kinematics.acceleration),
      grounded: components.kinematics.grounded,
      maxSpeed: components.kinematics.maxSpeed,
    }),
    vital: Object.freeze({
      health: components.vital.health,
      maxHealth: components.vital.maxHealth,
      stamina: components.vital.stamina,
      maxStamina: components.vital.maxStamina,
      poise: components.vital.poise,
      maxPoise: components.vital.maxPoise,
      invulnerableUntilTick: components.vital.invulnerableUntilTick,
    }),
    interest: Object.freeze({ ...components.interest }),
    network: Object.freeze({ ...components.network }),
    tags: Object.freeze([...components.tags]),
  });
}

const sanitizeVitals = (vital: VitalComponentV7): VitalComponentV7 => Object.freeze({
  health: clampV7(Number(vital.health), 0, Math.max(0, Number(vital.maxHealth))),
  maxHealth: Math.max(0, Number(vital.maxHealth)),
  stamina: clampV7(Number(vital.stamina), 0, Math.max(0, Number(vital.maxStamina))),
  maxStamina: Math.max(0, Number(vital.maxStamina)),
  poise: clampV7(Number(vital.poise), 0, Math.max(0, Number(vital.maxPoise))),
  maxPoise: Math.max(0, Number(vital.maxPoise)),
  invulnerableUntilTick: tickV7(Number(vital.invulnerableUntilTick)),
});

export interface EntityStoreStatsV7 {
  readonly count: number;
  readonly archetypes: number;
  readonly dirty: number;
  readonly alive: number;
}

export class EntityStoreV7 {
  readonly #entities = new Map<EntityIdV7, EntityRecordV7>();
  readonly #archetypeCounts = new Map<string, number>();
  #revision = 0;

  get revision(): number { return this.#revision; }
  get size(): number { return this.#entities.size; }

  upsert(record: EntityRecordV7): void {
    const existing = this.#entities.get(record.id);
    if (existing && existing.archetype !== record.archetype) this.#bumpArchetype(existing.archetype, -1);
    if (!existing) this.#bumpArchetype(record.archetype, 1);
    const components = cloneComponents(record.components);
    const normalized: EntityRecordV7 = Object.freeze({
      id: record.id,
      archetype: record.archetype.trim().slice(0, 64) || 'unknown',
      components: Object.freeze({
        ...components,
        vital: sanitizeVitals(components.vital),
      }),
      createdTick: tickV7(Number(record.createdTick)),
    });
    this.#entities.set(record.id, normalized);
    this.#revision += 1;
  }

  remove(id: EntityIdV7): boolean {
    const existing = this.#entities.get(id);
    if (!existing) return false;
    this.#entities.delete(id); this.#bumpArchetype(existing.archetype, -1); this.#revision += 1;
    return true;
  }

  get(id: EntityIdV7): EntityRecordV7 | undefined {
    const value = this.#entities.get(id);
    return value ? structuredClone(value) : undefined;
  }

  list(archetype?: string): readonly EntityRecordV7[] {
    const values = [...this.#entities.values()]
      .filter((entity) => !archetype || entity.archetype === archetype)
      .sort((a, b) => Number(a.id) - Number(b.id))
      .map((entity) => structuredClone(entity));
    return Object.freeze(values);
  }

  setTransform(id: EntityIdV7, transform: TransformComponentV7): boolean {
    const entity = this.#entities.get(id); if (!entity) return false;
    this.#replace(id, { ...entity.components, transform: Object.freeze({ ...transform, position: cloneVec(transform.position), scale: cloneVec(transform.scale) }) });
    return true;
  }

  setKinematics(id: EntityIdV7, kinematics: KinematicsComponentV7): boolean {
    const entity = this.#entities.get(id); if (!entity) return false;
    this.#replace(id, { ...entity.components, kinematics: Object.freeze({ ...kinematics, velocity: cloneVec(kinematics.velocity), acceleration: cloneVec(kinematics.acceleration) }) });
    return true;
  }

  setVital(id: EntityIdV7, vital: VitalComponentV7): boolean {
    const entity = this.#entities.get(id); if (!entity) return false;
    this.#replace(id, { ...entity.components, vital: sanitizeVitals(vital) });
    return true;
  }

  setInterest(id: EntityIdV7, interest: InterestComponentV7): boolean {
    const entity = this.#entities.get(id); if (!entity) return false;
    this.#replace(id, { ...entity.components, interest: Object.freeze({ ...interest, priority: clampV7(interest.priority, -1000, 1000) }) });
    return true;
  }

  setNetwork(id: EntityIdV7, network: NetworkComponentV7): boolean {
    const entity = this.#entities.get(id); if (!entity) return false;
    this.#replace(id, { ...entity.components, network: Object.freeze({ ...network }) });
    return true;
  }

  addTag(id: EntityIdV7, tag: string): boolean {
    const entity = this.#entities.get(id); if (!entity) return false;
    const normalized = tag.trim().slice(0, 48); if (!normalized) return false;
    if (entity.components.tags.includes(normalized)) return true;
    this.#replace(id, { ...entity.components, tags: Object.freeze([...entity.components.tags, normalized].sort()) });
    return true;
  }

  removeTag(id: EntityIdV7, tag: string): boolean {
    const entity = this.#entities.get(id); if (!entity) return false;
    const next = entity.components.tags.filter((value) => value !== tag);
    if (next.length === entity.components.tags.length) return false;
    this.#replace(id, { ...entity.components, tags: Object.freeze(next) });
    return true;
  }

  applyDamage(id: EntityIdV7, amount: number, currentTick: TickV7): number {
    const entity = this.#entities.get(id); if (!entity) return 0;
    if (Number(entity.components.vital.invulnerableUntilTick) > Number(currentTick)) return 0;
    const damage = clampV7(Number.isFinite(amount) ? amount : 0, 0, 1_000_000);
    const vital = entity.components.vital;
    if (damage <= 0) return 0;
    const health = Math.max(0, vital.health - damage);
    const next = { ...vital, health, invulnerableUntilTick: tickV7(Number(currentTick) + 5) };
    this.#replace(id, { ...entity.components, vital: sanitizeVitals(next) });
    return damage;
  }

  heal(id: EntityIdV7, amount: number): number {
    const entity = this.#entities.get(id); if (!entity) return 0;
    const heal = clampV7(Number.isFinite(amount) ? amount : 0, 0, 1_000_000);
    const vital = entity.components.vital;
    const applied = Math.min(heal, Math.max(0, vital.maxHealth - vital.health));
    if (applied > 0) this.#replace(id, { ...entity.components, vital: sanitizeVitals({ ...vital, health: vital.health + applied }) });
    return applied;
  }

  markDirty(id: EntityIdV7): boolean {
    const entity = this.#entities.get(id); if (!entity) return false;
    const nextNetwork: NetworkComponentV7 = { ...entity.components.network, dirtyRevision: entity.components.network.dirtyRevision + 1 as never };
    this.#replace(id, { ...entity.components, network: Object.freeze(nextNetwork) });
    return true;
  }

  queryTagged(tag: string): readonly EntityRecordV7[] {
    return Object.freeze(this.list().filter((entity) => entity.components.tags.includes(tag)));
  }

  stats(): EntityStoreStatsV7 {
    let dirty = 0; let alive = 0;
    for (const entity of this.#entities.values()) {
      if (Number(entity.components.network.dirtyRevision) > 0) dirty += 1;
      if (entity.components.vital.health > 0) alive += 1;
    }
    return Object.freeze({ count: this.#entities.size, archetypes: this.#archetypeCounts.size, dirty, alive });
  }

  snapshot(): readonly EntityRecordV7[] { return this.list(); }

  restore(snapshot: readonly EntityRecordV7[]): void {
    this.#entities.clear(); this.#archetypeCounts.clear(); this.#revision = 0;
    for (const entity of snapshot) this.upsert(entity);
  }

  digestInput(): readonly unknown[] {
    return this.list().map((entity) => ({
      id: Number(entity.id), archetype: entity.archetype, transform: entity.components.transform,
      kinematics: entity.components.kinematics, vital: entity.components.vital,
      interest: entity.components.interest, network: entity.components.network,
      tags: entity.components.tags,
    }));
  }

  #replace(id: EntityIdV7, components: ActorComponentSetV7): void {
    const entity = this.#entities.get(id); if (!entity) return;
    this.#entities.set(id, Object.freeze({ ...entity, components: cloneComponents(components) })); this.#revision += 1;
  }

  #bumpArchetype(archetype: string, delta: number): void {
    const next = (this.#archetypeCounts.get(archetype) ?? 0) + delta;
    if (next <= 0) this.#archetypeCounts.delete(archetype); else this.#archetypeCounts.set(archetype, next);
  }
}
