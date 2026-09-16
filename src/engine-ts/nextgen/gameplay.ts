import { EcsWorld, ComponentType, TransformComponent, VelocityComponent, HealthState, EntityId, asTick, clamp, Vec3, distance3 } from './contracts.ts' as unknown as {
  EcsWorld: typeof import('./ecs.ts').EcsWorld;
  ComponentType: typeof import('./ecs.ts').ComponentType;
  TransformComponent: unknown;
  VelocityComponent: unknown;
  HealthState: unknown;
  EntityId: unknown;
  asTick: (n: number) => number;
  clamp: (n: number, min: number, max: number) => number;
  Vec3: unknown;
  distance3: (a: any, b: any) => number;
};

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
  readonly entity: number;
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
  readonly source: number;
  readonly target: number;
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

interface ActiveAttack { readonly actor: number; readonly definition: AttackDefinition; elapsedMs: number; hitTargets: Set<number>; }

export class CombatSystem {
  readonly #actors = new Map<number, ActorState>();
  readonly #attacks: ActiveAttack[] = [];
  readonly #damageEvents: DamageEvent[] = [];
  #tick = 0;

  register(entity: number, faction: string, stats: Partial<ActorStats> = {}): ActorState {
    const base: ActorStats = Object.freeze({ maxHealth: Math.max(1, stats.maxHealth ?? 100), health: clamp(stats.health ?? stats.maxHealth ?? 100, 0, Math.max(1, stats.maxHealth ?? 100)), stamina: clamp(stats.stamina ?? stats.maxStamina ?? 100, 0, Math.max(1, stats.maxStamina ?? 100)), maxStamina: Math.max(1, stats.maxStamina ?? 100), poise: clamp(stats.poise ?? stats.maxPoise ?? 100, 0, Math.max(1, stats.maxPoise ?? 100)), maxPoise: Math.max(1, stats.maxPoise ?? 100), moveSpeed: Math.max(0, stats.moveSpeed ?? 4), attackSpeed: Math.max(0.1, stats.attackSpeed ?? 1), damage: Math.max(0, stats.damage ?? 15) });
    const state = Object.freeze({ entity, faction, stats: base, grounded: true, stunnedUntil: 0, invulnerableUntil: 0, dead: false, comboStep: 0, revision: 0 });
    this.#actors.set(entity, state);
    return state;
  }

  get(entity: number): ActorState | undefined { return this.#actors.get(entity); }
  values(): readonly ActorState[] { return Object.freeze([...this.#actors.values()].sort((a, b) => a.entity - b.entity)); }

  attack(entity: number, definition: AttackDefinition = LIGHT_ATTACK): boolean {
    const actor = this.#actors.get(entity);
    if (!actor || actor.dead || actor.stunnedUntil > this.#tick || actor.stats.stamina < definition.staminaCost || this.#attacks.some((attack) => attack.actor === entity)) return false;
    actor.stats = Object.freeze({ ...actor.stats, stamina: actor.stats.stamina - definition.staminaCost });
    this.#attacks.push({ actor: entity, definition, elapsedMs: 0, hitTargets: new Set() });
    return true;
  }

  tick(deltaMs: number, positions: ReadonlyMap<number, Vec3>, forwards: ReadonlyMap<number, Vec3>): readonly DamageEvent[] {
    this.#tick += 1;
    for (const actor of this.#actors.values()) {
      if (actor.dead) continue;
      const staminaRegen = actor.stunnedUntil > this.#tick ? 0.05 : 0.18;
      actor.stats = Object.freeze({ ...actor.stats, stamina: clamp(actor.stats.stamina + staminaRegen * deltaMs, 0, actor.stats.maxStamina), poise: clamp(actor.stats.poise + deltaMs * 0.08, 0, actor.stats.maxPoise) });
    }
    for (let index = this.#attacks.length - 1; index >= 0; index -= 1) {
      const attack = this.#attacks[index]!;
      const scaledDelta = deltaMs * (this.#actors.get(attack.actor)?.stats.attackSpeed ?? 1);
      attack.elapsedMs += scaledDelta;
      const activeStart = attack.definition.windupMs;
      const activeEnd = activeStart + attack.definition.activeMs;
      if (attack.elapsedMs >= activeStart && attack.elapsedMs <= activeEnd) this.#resolveHits(attack, positions, forwards);
      if (attack.elapsedMs > activeEnd + attack.definition.recoveryMs) this.#attacks.splice(index, 1);
    }
    const result = Object.freeze([...this.#damageEvents]);
    this.#damageEvents.length = 0;
    return result;
  }

  private #resolveHits(attack: ActiveAttack, positions: ReadonlyMap<number, Vec3>, forwards: ReadonlyMap<number, Vec3>): void {
    const source = this.#actors.get(attack.actor);
    const sourcePosition = positions.get(attack.actor);
    if (!source || !sourcePosition) return;
    const sourceForward = forwards.get(attack.actor) ?? { x: 0, y: 0, z: 1 };
    for (const [targetId, target] of this.#actors) {
      if (targetId === attack.actor || target.dead || target.faction === source.faction || attack.hitTargets.has(targetId)) continue;
      if (target.invulnerableUntil > this.#tick) continue;
      const targetPosition = positions.get(targetId);
      if (!targetPosition) continue;
      const distance = distance3(sourcePosition, targetPosition);
      if (distance > attack.definition.range) continue;
      const direction = { x: targetPosition.x - sourcePosition.x, y: 0, z: targetPosition.z - sourcePosition.z };
      const length = Math.hypot(direction.x, direction.z) || 1;
      const facing = (direction.x * sourceForward.x + direction.z * sourceForward.z) / length;
      const threshold = Math.cos((attack.definition.arcDegrees * Math.PI) / 360);
      if (facing < threshold) continue;
      const critical = facing > 0.92 && distance < attack.definition.range * 0.75;
      const rawDamage = source.stats.damage * attack.definition.damageMultiplier * (critical ? 1.5 : 1);
      const targetAfterPoise = target.stats.poise - source.stats.damage * attack.definition.poiseMultiplier;
      const stunned = targetAfterPoise <= 0;
      const nextHealth = Math.max(0, target.stats.health - rawDamage);
      const next: ActorState = Object.freeze({ ...target, stats: Object.freeze({ ...target.stats, health: nextHealth, poise: Math.max(0, targetAfterPoise) }), stunnedUntil: stunned ? this.#tick + 20 : target.stunnedUntil, dead: nextHealth <= 0, revision: target.revision + 1 });
      this.#actors.set(targetId, next);
      attack.hitTargets.add(targetId);
      this.#damageEvents.push(Object.freeze({ source: attack.actor, target: targetId, amount: rawDamage, poiseDamage: source.stats.damage * attack.definition.poiseMultiplier, tick: this.#tick, critical }));
    }
  }
}

export interface AbilityDefinition { readonly id: string; readonly cooldownMs: number; readonly cost: number; readonly durationMs: number; readonly apply: (actor: ActorState) => ActorState; }

export class AbilityBook {
  readonly #definitions = new Map<string, AbilityDefinition>();
  readonly #cooldowns = new Map<string, number>();
  register(definition: AbilityDefinition): void { if (this.#definitions.has(definition.id)) throw new Error(`ability exists: ${definition.id}`); this.#definitions.set(definition.id, Object.freeze(definition)); }
  canUse(actor: ActorState, id: string, nowMs: number): boolean { const ability = this.#definitions.get(id); if (!ability || actor.dead || actor.stunnedUntil > nowMs) return false; return (this.#cooldowns.get(`${actor.entity}:${id}`) ?? 0) <= nowMs && actor.stats.stamina >= ability.cost; }
  use(actor: ActorState, id: string, nowMs: number): ActorState | null { const ability = this.#definitions.get(id); if (!ability || !this.canUse(actor, id, nowMs)) return null; this.#cooldowns.set(`${actor.entity}:${id}`, nowMs + ability.cooldownMs); const modified = ability.apply(actor); return Object.freeze({ ...modified, stats: Object.freeze({ ...modified.stats, stamina: Math.max(0, modified.stats.stamina - ability.cost) }) }); }
  clear(): void { this.#cooldowns.clear(); }
}

export const bindCombatToEcs = (world: any, transform: any, velocity: any, health: any, combat: CombatSystem, tick: number): readonly DamageEvent[] => {
  const positions = new Map<number, any>();
  const forwards = new Map<number, any>();
  for (const row of world.query({ all: ['transform'] })) {
    const value = row.components.transform as any;
    positions.set(row.entity, value.position);
    forwards.set(row.entity, { x: Math.sin(value.yaw), y: 0, z: Math.cos(value.yaw) });
  }
  void velocity; void health;
  return combat.tick(Math.max(1, tick), positions, forwards);
};

export const finiteActorHealth = (state: ActorState): HealthState => Object.freeze({ current: state.stats.health, maximum: state.stats.maxHealth, regenerationPerSecond: 0, invulnerableUntilTick: asTick(state.invulnerableUntil) as any });
