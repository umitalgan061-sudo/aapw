import type { EntityId, Vec3 } from './types.ts';

export type ActorKind = 'player' | 'npc' | 'wildlife' | 'vehicle' | 'prop';
export type Allegiance = 'neutral' | 'friendly' | 'hostile' | 'unknown';
export type Lifecycle = 'spawned' | 'active' | 'stunned' | 'dead' | 'despawned';

export interface ActorStatsR3 {
  readonly health: number;
  readonly maxHealth: number;
  readonly stamina: number;
  readonly maxStamina: number;
  readonly poise: number;
  readonly maxPoise: number;
  readonly armor: number;
  readonly moveSpeed: number;
  readonly attackPower: number;
  readonly perception: number;
}

export interface ActorStateR3 {
  readonly id: EntityId;
  readonly kind: ActorKind;
  readonly faction: string;
  readonly allegiance: Allegiance;
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly facingRadians: number;
  readonly stats: ActorStatsR3;
  readonly lifecycle: Lifecycle;
  readonly tags: readonly string[];
  readonly statusEffects: readonly StatusEffectR3[];
  readonly targetId: EntityId | null;
  readonly createdTick: number;
  readonly updatedTick: number;
}

export interface StatusEffectR3 {
  readonly id: string;
  readonly stacks: number;
  readonly remainingMs: number;
  readonly potency: number;
}

export interface DamageEventR3 {
  readonly sourceId: EntityId;
  readonly targetId: EntityId;
  readonly amount: number;
  readonly poiseDamage: number;
  readonly knockback: Vec3;
  readonly critical: boolean;
  readonly tick: number;
}

export interface GameplayCommandR3 {
  readonly actorId: EntityId;
  readonly kind: 'move' | 'attack' | 'dodge' | 'block' | 'interact' | 'use';
  readonly direction?: Vec3;
  readonly targetId?: EntityId;
  readonly staminaCost?: number;
  readonly tick: number;
}

export interface GameplayFrameResultR3 {
  readonly tick: number;
  readonly actorsUpdated: number;
  readonly damageEvents: readonly DamageEventR3[];
  readonly despawned: readonly EntityId[];
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const vLength = (value: Vec3): number => Math.hypot(value.x, value.y, value.z);
const vScale = (value: Vec3, scale: number): Vec3 => ({ x: value.x * scale, y: value.y * scale, z: value.z * scale });
const vAdd = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });

function normalize(value: Vec3): Vec3 {
  const length = vLength(value);
  return length <= 1e-6 ? { x: 0, y: 0, z: 0 } : vScale(value, 1 / length);
}

export class GameplayRuntimeR3 {
  readonly #actors = new Map<EntityId, ActorStateR3>();
  readonly #commands: GameplayCommandR3[] = [];
  readonly #damageEvents: DamageEventR3[] = [];
  #tick = 0;

  spawn(actor: ActorStateR3): boolean {
    if (this.#actors.has(actor.id) || actor.lifecycle === 'despawned') return false;
    this.#actors.set(actor.id, this.#normalizeActor(actor));
    return true;
  }

  remove(id: EntityId): boolean {
    return this.#actors.delete(id);
  }

  get(id: EntityId): ActorStateR3 | null {
    return this.#actors.get(id) ?? null;
  }

  list(): readonly ActorStateR3[] {
    return [...this.#actors.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  queue(command: GameplayCommandR3): boolean {
    const actor = this.#actors.get(command.actorId);
    if (!actor || actor.lifecycle === 'dead' || actor.lifecycle === 'despawned') return false;
    this.#commands.push({ ...command });
    return true;
  }

  step(tick: number, deltaMs: number): GameplayFrameResultR3 {
    this.#tick = Math.max(this.#tick, Math.floor(tick));
    this.#damageEvents.length = 0;
    const safeDelta = clamp(Number.isFinite(deltaMs) ? deltaMs : 0, 0, 100);
    let updated = 0;
    const despawned: EntityId[] = [];
    const commands = this.#commands.splice(0);
    for (const command of commands) {
      if (command.tick > this.#tick) {
        this.#commands.push(command);
        continue;
      }
      if (this.#applyCommand(command, safeDelta)) updated += 1;
    }
    for (const [id, actor] of this.#actors) {
      if (actor.lifecycle === 'despawned') {
        despawned.push(id);
        this.#actors.delete(id);
        continue;
      }
      this.#tickActor(id, actor, safeDelta);
    }
    return { tick: this.#tick, actorsUpdated: updated, damageEvents: [...this.#damageEvents], despawned };
  }

  applyDamage(event: DamageEventR3): boolean {
    const target = this.#actors.get(event.targetId);
    if (!target || target.lifecycle === 'dead' || target.lifecycle === 'despawned') return false;
    const mitigation = clamp(target.stats.armor / 100, 0, 0.85);
    const criticalMultiplier = event.critical ? 1.5 : 1;
    const finalDamage = Math.max(0.1, event.amount * criticalMultiplier * (1 - mitigation));
    const nextHealth = clamp(target.stats.health - finalDamage, 0, target.stats.maxHealth);
    const nextPoise = clamp(target.stats.poise - Math.max(0, event.poiseDamage), 0, target.stats.maxPoise);
    const lifecycle: Lifecycle = nextHealth <= 0 ? 'dead' : nextPoise <= 0 ? 'stunned' : target.lifecycle === 'stunned' ? 'active' : target.lifecycle;
    const next: ActorStateR3 = {
      ...target,
      position: vAdd(target.position, event.knockback),
      stats: { ...target.stats, health: nextHealth, poise: nextPoise },
      lifecycle,
      updatedTick: this.#tick,
    };
    this.#actors.set(target.id, next);
    this.#damageEvents.push({ ...event, amount: finalDamage });
    return true;
  }

  heal(id: EntityId, amount: number): boolean {
    const actor = this.#actors.get(id);
    if (!actor || actor.lifecycle === 'dead' || actor.lifecycle === 'despawned') return false;
    const safe = Math.max(0, Number.isFinite(amount) ? amount : 0);
    this.#actors.set(id, {
      ...actor,
      stats: { ...actor.stats, health: clamp(actor.stats.health + safe, 0, actor.stats.maxHealth) },
      lifecycle: actor.lifecycle === 'stunned' ? 'active' : actor.lifecycle,
      updatedTick: this.#tick,
    });
    return true;
  }

  addStatusEffect(id: EntityId, effect: StatusEffectR3): boolean {
    const actor = this.#actors.get(id);
    if (!actor || actor.lifecycle === 'dead' || actor.lifecycle === 'despawned') return false;
    const normalized = { ...effect, id: effect.id.trim(), stacks: Math.max(1, Math.floor(effect.stacks)), remainingMs: Math.max(0, effect.remainingMs), potency: Math.max(0, effect.potency) };
    const existing = actor.statusEffects.find((item) => item.id === normalized.id);
    const effects = existing
      ? actor.statusEffects.map((item) => item.id === normalized.id ? { ...item, stacks: clamp(item.stacks + normalized.stacks, 1, 16), remainingMs: Math.max(item.remainingMs, normalized.remainingMs), potency: Math.max(item.potency, normalized.potency) } : item)
      : [...actor.statusEffects, normalized];
    this.#actors.set(id, { ...actor, statusEffects: effects, updatedTick: this.#tick });
    return true;
  }

  nearby(position: Vec3, radius: number, kind?: ActorKind): readonly ActorStateR3[] {
    const limit = Math.max(0, radius);
    const limitSq = limit * limit;
    return this.list().filter((actor) => {
      if (kind && actor.kind !== kind) return false;
      const dx = actor.position.x - position.x;
      const dy = actor.position.y - position.y;
      const dz = actor.position.z - position.z;
      return dx * dx + dy * dy + dz * dz <= limitSq;
    });
  }

  #applyCommand(command: GameplayCommandR3, deltaMs: number): boolean {
    const actor = this.#actors.get(command.actorId);
    if (!actor) return false;
    const cost = Math.max(0, command.staminaCost ?? 0);
    if (cost > actor.stats.stamina + 1e-6) return false;
    if (command.kind === 'move') {
      const direction = normalize(command.direction ?? { x: 0, y: 0, z: 0 });
      const speed = actor.stats.moveSpeed;
      const dt = deltaMs / 1000;
      const velocity = vScale(direction, speed);
      this.#actors.set(actor.id, { ...actor, position: vAdd(actor.position, vScale(velocity, dt)), velocity, facingRadians: Math.atan2(direction.x, direction.z) || actor.facingRadians, stats: { ...actor.stats, stamina: clamp(actor.stats.stamina - cost, 0, actor.stats.maxStamina) }, updatedTick: this.#tick });
      return true;
    }
    if (command.kind === 'attack' && command.targetId) {
      const target = this.#actors.get(command.targetId);
      if (!target) return false;
      const dx = target.position.x - actor.position.x;
      const dz = target.position.z - actor.position.z;
      if (Math.hypot(dx, dz) > 4.5) return false;
      const direction = normalize({ x: dx, y: 0, z: dz });
      const critical = ((this.#tick + actor.id.length + target.id.length) % 11) === 0;
      this.applyDamage({ sourceId: actor.id, targetId: target.id, amount: actor.stats.attackPower, poiseDamage: actor.stats.attackPower * 0.35, knockback: vScale(direction, 0.18), critical, tick: this.#tick });
      this.#actors.set(actor.id, { ...actor, stats: { ...actor.stats, stamina: clamp(actor.stats.stamina - Math.max(4, cost), 0, actor.stats.maxStamina) }, updatedTick: this.#tick });
      return true;
    }
    if (command.kind === 'dodge') {
      const direction = normalize(command.direction ?? { x: 0, y: 0, z: 1 });
      this.#actors.set(actor.id, { ...actor, position: vAdd(actor.position, vScale(direction, 1.8)), stats: { ...actor.stats, stamina: clamp(actor.stats.stamina - Math.max(8, cost), 0, actor.stats.maxStamina) }, updatedTick: this.#tick });
      return true;
    }
    if (command.kind === 'block') {
      this.#actors.set(actor.id, { ...actor, stats: { ...actor.stats, stamina: clamp(actor.stats.stamina - cost, 0, actor.stats.maxStamina) }, tags: [...new Set([...actor.tags, 'blocking'])], updatedTick: this.#tick });
      return true;
    }
    return command.kind === 'interact' || command.kind === 'use';
  }

  #tickActor(id: EntityId, actor: ActorStateR3, deltaMs: number): void {
    const dt = deltaMs / 1000;
    const staminaRecovery = actor.tags.includes('blocking') ? 0.5 : 6;
    const tags = actor.tags.filter((tag) => tag !== 'blocking');
    let lifecycle = actor.lifecycle;
    if (lifecycle === 'stunned') lifecycle = actor.stats.poise > actor.stats.maxPoise * 0.25 ? 'active' : 'stunned';
    const effects = actor.statusEffects
      .map((effect) => ({ ...effect, remainingMs: Math.max(0, effect.remainingMs - deltaMs) }))
      .filter((effect) => effect.remainingMs > 0);
    this.#actors.set(id, {
      ...actor,
      velocity: vScale(actor.velocity, Math.max(0, 1 - dt * 6)),
      stats: { ...actor.stats, stamina: clamp(actor.stats.stamina + staminaRecovery * dt, 0, actor.stats.maxStamina), poise: clamp(actor.stats.poise + actor.stats.maxPoise * 0.08 * dt, 0, actor.stats.maxPoise) },
      lifecycle: actor.stats.health <= 0 ? 'dead' : lifecycle,
      statusEffects: effects,
      tags,
      updatedTick: this.#tick,
    });
  }

  #normalizeActor(actor: ActorStateR3): ActorStateR3 {
    const stats = actor.stats;
    return {
      ...actor,
      tags: [...new Set(actor.tags)],
      statusEffects: [...actor.statusEffects],
      stats: {
        ...stats,
        health: clamp(stats.health, 0, Math.max(1, stats.maxHealth)),
        maxHealth: Math.max(1, stats.maxHealth),
        stamina: clamp(stats.stamina, 0, Math.max(1, stats.maxStamina)),
        maxStamina: Math.max(1, stats.maxStamina),
        poise: clamp(stats.poise, 0, Math.max(1, stats.maxPoise)),
        maxPoise: Math.max(1, stats.maxPoise),
        armor: Math.max(0, stats.armor),
        moveSpeed: Math.max(0, stats.moveSpeed),
        attackPower: Math.max(0, stats.attackPower),
        perception: Math.max(0, stats.perception),
      },
    };
  }
}
