import type { EntityId, HealthState, Vec3 } from './contracts.ts';
import { asTick, clamp, distance3 } from './contracts.ts';
import type { EcsWorld, ComponentType } from './ecs.ts';

export interface ActorStats {
  readonly maxHealth: number;
  readonly health: number;
  readonly stamina: number;
  readonly maxStamina: number;
  readonly poise: number;
  readonly maxPoise: number;
  readonly moveSpeed: number;
  readonly attackSpeed: number;
  readonly damage: number;
}

export interface ActorState {
  readonly entity: EntityId;
  readonly faction: string;
  readonly stats: ActorStats;
  readonly grounded: boolean;
  readonly stunnedUntil: number;
  readonly invulnerableUntil: number;
  readonly dead: boolean;
  readonly comboStep: number;
  readonly revision: number;
}

export interface DamageEvent {
  readonly source: EntityId;
  readonly target: EntityId;
  readonly amount: number;
  readonly poiseDamage: number;
  readonly tick: number;
  readonly critical: boolean;
}

export interface AttackDefinition {
  readonly id: string;
  readonly windupMs: number;
  readonly activeMs: number;
  readonly recoveryMs: number;
  readonly range: number;
  readonly arcDegrees: number;
  readonly staminaCost: number;
  readonly damageMultiplier: number;
  readonly poiseMultiplier: number;
  readonly comboWindowMs: number;
}

export const LIGHT_ATTACK: AttackDefinition = Object.freeze({ id: 'light', windupMs: 120, activeMs: 90, recoveryMs: 260, range: 2.1, arcDegrees: 105, staminaCost: 12, damageMultiplier: 1, poiseMultiplier: 0.8, comboWindowMs: 220 });
export const HEAVY_ATTACK: AttackDefinition = Object.freeze({ id: 'heavy', windupMs: 320, activeMs: 140, recoveryMs: 460, range: 2.5, arcDegrees: 85, staminaCost: 28, damageMultiplier: 2.2, poiseMultiplier: 2, comboWindowMs: 320 });

interface ActiveAttack { readonly actor: EntityId; readonly definition: AttackDefinition; elapsedMs: number; hitTargets: Set<EntityId>; }

export class CombatSystem {
  readonly #actors = new Map<EntityId, ActorState>();
  readonly #attacks: ActiveAttack[] = [];
  readonly #damageEvents: DamageEvent[] = [];
  #tick = 0;

  register(entity: EntityId, faction: string, stats: Partial<ActorStats> = {}): ActorState {
    const maxHealth = Math.max(1, stats.maxHealth ?? 100);
    const maxStamina = Math.max(1, stats.maxStamina ?? 100);
    const maxPoise = Math.max(1, stats.maxPoise ?? 100);
    const base: ActorStats = Object.freeze({
      maxHealth,
      health: clamp(stats.health ?? maxHealth, 0, maxHealth),
      stamina: clamp(stats.stamina ?? maxStamina, 0, maxStamina),
      maxStamina,
      poise: clamp(stats.poise ?? maxPoise, 0, maxPoise),
      maxPoise,
      moveSpeed: Math.max(0, stats.moveSpeed ?? 4),
      attackSpeed: Math.max(0.1, stats.attackSpeed ?? 1),
      damage: Math.max(0, stats.damage ?? 15),
    });
    const state: ActorState = Object.freeze({ entity, faction, stats: base, grounded: true, stunnedUntil: 0, invulnerableUntil: 0, dead: base.health <= 0, comboStep: 0, revision: 0 });
    this.#actors.set(entity, state);
    return state;
  }

  get(entity: EntityId): ActorState | undefined { return this.#actors.get(entity); }
  values(): readonly ActorState[] { return Object.freeze([...this.#actors.values()].sort((a, b) => Number(a.entity) - Number(b.entity))); }

  attack(entity: EntityId, definition: AttackDefinition = LIGHT_ATTACK): boolean {
    const actor = this.#actors.get(entity);
    if (!actor || actor.dead || actor.stunnedUntil > this.#tick || actor.stats.stamina < definition.staminaCost || this.#attacks.some((attack) => attack.actor === entity)) return false;
    const stats = Object.freeze({ ...actor.stats, stamina: actor.stats.stamina - definition.staminaCost });
    this.#actors.set(entity, Object.freeze({ ...actor, stats, comboStep: (actor.comboStep + 1) % 3, revision: actor.revision + 1 }));
    this.#attacks.push({ actor: entity, definition, elapsedMs: 0, hitTargets: new Set() });
    return true;
  }

  tick(deltaMs: number, positions: ReadonlyMap<EntityId, Vec3>, forwards: ReadonlyMap<EntityId, Vec3>): readonly DamageEvent[] {
    this.#tick += 1;
    const dt = Math.max(1, deltaMs);
    for (const [entity, actor] of this.#actors) {
      if (actor.dead) continue;
      const regenFactor = actor.stunnedUntil > this.#tick ? 0.03 : 0.18;
      const stats = Object.freeze({ ...actor.stats, stamina: clamp(actor.stats.stamina + regenFactor * dt, 0, actor.stats.maxStamina), poise: clamp(actor.stats.poise + dt * 0.08, 0, actor.stats.maxPoise) });
      this.#actors.set(entity, Object.freeze({ ...actor, stats }));
    }
    for (let index = this.#attacks.length - 1; index >= 0; index -= 1) {
      const attack = this.#attacks[index]!;
      const actor = this.#actors.get(attack.actor);
      attack.elapsedMs += dt * (actor?.stats.attackSpeed ?? 1);
      const activeStart = attack.definition.windupMs;
      const activeEnd = activeStart + attack.definition.activeMs;
      if (attack.elapsedMs >= activeStart && attack.elapsedMs <= activeEnd) this.#resolveHits(attack, positions, forwards);
      if (attack.elapsedMs > activeEnd + attack.definition.recoveryMs) this.#attacks.splice(index, 1);
    }
    const result = Object.freeze([...this.#damageEvents]);
    this.#damageEvents.length = 0;
    return result;
  }

  #resolveHits(attack: ActiveAttack, positions: ReadonlyMap<EntityId, Vec3>, forwards: ReadonlyMap<EntityId, Vec3>): void {
    const source = this.#actors.get(attack.actor);
    const sourcePosition = positions.get(attack.actor);
    if (!source || !sourcePosition) return;
    const sourceForward = forwards.get(attack.actor) ?? { x: 0, y: 0, z: 1 };
    for (const [targetId, target] of this.#actors) {
      if (targetId === attack.actor || target.dead || target.faction === source.faction || attack.hitTargets.has(targetId) || target.invulnerableUntil > this.#tick) continue;
      const targetPosition = positions.get(targetId);
      if (!targetPosition) continue;
      const distance = distance3(sourcePosition, targetPosition);
      if (distance > attack.definition.range) continue;
      const dx = targetPosition.x - sourcePosition.x;
      const dz = targetPosition.z - sourcePosition.z;
      const length = Math.hypot(dx, dz) || 1;
      const facing = (dx * sourceForward.x + dz * sourceForward.z) / length;
      const arcThreshold = Math.cos((attack.definition.arcDegrees * Math.PI) / 360);
      if (facing < arcThreshold) continue;
      const critical = facing > 0.92 && distance < attack.definition.range * 0.75;
      const amount = source.stats.damage * attack.definition.damageMultiplier * (critical ? 1.5 : 1);
      const poise = source.stats.damage * attack.definition.poiseMultiplier;
      const remainingHealth = Math.max(0, target.stats.health - amount);
      const remainingPoise = Math.max(0, target.stats.poise - poise);
      const next: ActorState = Object.freeze({ ...target, stats: Object.freeze({ ...target.stats, health: remainingHealth, poise: remainingPoise }), stunnedUntil: remainingPoise <= 0 ? this.#tick + 20 : target.stunnedUntil, dead: remainingHealth <= 0, revision: target.revision + 1 });
      this.#actors.set(targetId, next);
      attack.hitTargets.add(targetId);
      this.#damageEvents.push(Object.freeze({ source: attack.actor, target: targetId, amount, poiseDamage: poise, tick: this.#tick, critical }));
    }
  }
}

export interface AbilityDefinition {
  readonly id: string;
  readonly cooldownMs: number;
  readonly cost: number;
  readonly durationMs: number;
  readonly apply: (actor: ActorState) => ActorState;
}

export class AbilityBook {
  readonly #definitions = new Map<string, AbilityDefinition>();
  readonly #cooldowns = new Map<string, number>();
  register(definition: AbilityDefinition): void { if (this.#definitions.has(definition.id)) throw new Error(`ability exists: ${definition.id}`); this.#definitions.set(definition.id, Object.freeze(definition)); }
  canUse(actor: ActorState, id: string, nowMs: number): boolean { const ability = this.#definitions.get(id); return Boolean(ability && !actor.dead && actor.stunnedUntil <= nowMs && (this.#cooldowns.get(`${actor.entity}:${id}`) ?? 0) <= nowMs && actor.stats.stamina >= ability.cost); }
  use(actor: ActorState, id: string, nowMs: number): ActorState | null { const ability = this.#definitions.get(id); if (!ability || !this.canUse(actor, id, nowMs)) return null; this.#cooldowns.set(`${actor.entity}:${id}`, nowMs + ability.cooldownMs); const modified = ability.apply(actor); return Object.freeze({ ...modified, stats: Object.freeze({ ...modified.stats, stamina: Math.max(0, modified.stats.stamina - ability.cost) }) }); }
  clear(): void { this.#cooldowns.clear(); }
}

export const bindCombatToEcs = (world: EcsWorld, transform: ComponentType<{ readonly position: Vec3; readonly yaw: number }>, combat: CombatSystem, deltaMs: number): readonly DamageEvent[] => {
  const positions = new Map<EntityId, Vec3>();
  const forwards = new Map<EntityId, Vec3>();
  for (const row of world.query({ all: [transform.id] })) {
    const value = row.components[transform.id] as { readonly position: Vec3; readonly yaw: number };
    positions.set(row.entity, value.position);
    forwards.set(row.entity, { x: Math.sin(value.yaw), y: 0, z: Math.cos(value.yaw) });
  }
  return combat.tick(deltaMs, positions, forwards);
};

export const finiteActorHealth = (state: ActorState): HealthState => Object.freeze({ current: state.stats.health, maximum: state.stats.maxHealth, regenerationPerSecond: 0, invulnerableUntilTick: asTick(state.invulnerableUntil) });
