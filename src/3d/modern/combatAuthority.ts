export type AttackPhase = 'startup' | 'active' | 'recovery' | 'finished';
export type CombatState = 'idle' | 'startup' | 'active' | 'recovery' | 'stunned' | 'dead';

export interface AttackDefinition {
  readonly id: string;
  readonly damage: number;
  readonly staminaCost: number;
  readonly startupMs: number;
  readonly activeMs: number;
  readonly recoveryMs: number;
  readonly reach: number;
  readonly arcDegrees: number;
  readonly poiseDamage: number;
  readonly knockback: number;
  readonly invulnerableMs?: number;
}

export interface CombatTarget {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly health: number;
  readonly maxHealth: number;
  readonly poise: number;
  readonly maxPoise: number;
  readonly team: string;
  readonly invulnerableMs: number;
}

export interface CombatActor {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly team: string;
  readonly health: number;
  readonly maxHealth: number;
  readonly poise: number;
  readonly maxPoise: number;
  readonly stamina: number;
  readonly maxStamina: number;
  readonly state: CombatState;
  readonly phase: AttackPhase;
  readonly phaseRemainingMs: number;
  readonly cooldownMs: number;
  readonly comboIndex: number;
  readonly invulnerableMs: number;
  readonly currentAttackId?: string;
  readonly attackInstanceId?: number;
}

export interface HitEvent {
  readonly attackId: string;
  readonly attackInstanceId: number;
  readonly attackerId: string;
  readonly targetId: string;
  readonly damage: number;
  readonly poiseDamage: number;
  readonly knockback: number;
  readonly blocked: boolean;
  readonly critical: boolean;
}

export interface CombatEvent {
  readonly type: 'attackStarted' | 'attackActive' | 'attackFinished' | 'hit' | 'stagger' | 'death' | 'dodgeInvulnerable';
  readonly actorId: string;
  readonly attackId?: string;
  readonly attackInstanceId?: number;
  readonly hit?: HitEvent;
}

export interface CombatSystemOptions {
  readonly hitResolver?: (attacker: CombatActor, target: CombatTarget, attack: AttackDefinition) => { readonly blocked?: boolean; readonly critical?: boolean };
  /**
   * Retained for API compatibility. Gameplay decisions never depend on wall-clock time.
   */
  readonly now?: () => number;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
const angleDelta = (a: number, b: number): number => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const positive = (value: number): number => Math.max(0, Number.isFinite(value) ? value : 0);

export const DEFAULT_ATTACKS: Readonly<Record<string, AttackDefinition>> = Object.freeze({
  light: Object.freeze({ id: 'light', damage: 12, staminaCost: 12, startupMs: 180, activeMs: 120, recoveryMs: 320, reach: 2.3, arcDegrees: 95, poiseDamage: 10, knockback: 0.8, invulnerableMs: 0 }),
  heavy: Object.freeze({ id: 'heavy', damage: 28, staminaCost: 26, startupMs: 360, activeMs: 160, recoveryMs: 520, reach: 2.7, arcDegrees: 80, poiseDamage: 25, knockback: 1.7, invulnerableMs: 60 }),
});

export class CombatAuthority {
  readonly #attacks: Readonly<Record<string, AttackDefinition>>;
  readonly #resolver: NonNullable<CombatSystemOptions['hitResolver']>;
  #actors = new Map<string, CombatActor>();
  #targets = new Map<string, CombatTarget>();
  #hitLedger = new Set<string>();
  #attackSerial = 0;

  constructor(attacks: Readonly<Record<string, AttackDefinition>> = DEFAULT_ATTACKS, options: CombatSystemOptions = {}) {
    void options.now;
    this.#attacks = attacks;
    this.#resolver = options.hitResolver ?? (() => ({}));
  }

  registerActor(actor: CombatActor): void {
    const normalized: CombatActor = Object.freeze({
      ...actor,
      phaseRemainingMs: positive(actor.phaseRemainingMs),
      cooldownMs: positive(actor.cooldownMs),
      invulnerableMs: positive(actor.invulnerableMs),
      stamina: clamp(actor.stamina, 0, actor.maxStamina),
      health: clamp(actor.health, 0, actor.maxHealth),
      poise: clamp(actor.poise, 0, actor.maxPoise),
    });
    this.#actors.set(actor.id, normalized);
  }

  registerTarget(target: CombatTarget): void { this.#targets.set(target.id, Object.freeze({ ...target })); }
  updateTarget(target: CombatTarget): void { this.#targets.set(target.id, Object.freeze({ ...target })); }
  removeActor(id: string): void { this.#actors.delete(id); }
  removeTarget(id: string): void { this.#targets.delete(id); }

  actor(id: string): CombatActor | undefined { return this.#actors.get(id); }
  target(id: string): CombatTarget | undefined { return this.#targets.get(id); }
  actors(): readonly CombatActor[] { return Object.freeze([...this.#actors.values()].sort((a, b) => a.id.localeCompare(b.id))); }
  targets(): readonly CombatTarget[] { return Object.freeze([...this.#targets.values()].sort((a, b) => a.id.localeCompare(b.id))); }

  startAttack(actorId: string, heavy = false): readonly CombatEvent[] {
    const actor = this.#actors.get(actorId);
    if (!actor || actor.state === 'dead' || actor.state === 'stunned' || actor.cooldownMs > 0 || actor.phase !== 'finished') return [];
    const attack = this.#attacks[heavy ? 'heavy' : 'light'];
    if (!attack || actor.stamina < attack.staminaCost) return [];
    const attackInstanceId = ++this.#attackSerial;
    const next = Object.freeze({
      ...actor,
      state: 'startup' as const,
      phase: 'startup' as const,
      phaseRemainingMs: attack.startupMs,
      cooldownMs: attack.startupMs + attack.activeMs + attack.recoveryMs,
      stamina: Math.max(0, actor.stamina - attack.staminaCost),
      invulnerableMs: Math.max(actor.invulnerableMs, attack.invulnerableMs ?? 0),
      currentAttackId: attack.id,
      attackInstanceId,
    });
    this.#actors.set(actorId, next);
    return Object.freeze([{ type: 'attackStarted', actorId, attackId: attack.id, attackInstanceId }]);
  }

  step(deltaMs: number): readonly CombatEvent[] {
    const dt = clamp(deltaMs, 0, 100);
    const events: CombatEvent[] = [];
    for (const actor of [...this.#actors.values()]) {
      this.#actors.set(actor.id, this.#advanceActor(actor, dt, events));
    }
    this.#hitLedger.clear();
    return Object.freeze(events);
  }

  applyDamage(targetId: string, damage: number, poiseDamage = 0, sourceId = 'environment'): readonly CombatEvent[] {
    const target = this.#targets.get(targetId);
    if (!target || target.invulnerableMs > 0) return [];
    const actualDamage = positive(damage);
    const actualPoiseDamage = positive(poiseDamage);
    const health = Math.max(0, target.health - actualDamage);
    const poise = Math.max(0, target.poise - actualPoiseDamage);
    this.#targets.set(targetId, Object.freeze({ ...target, health, poise }));
    if (health <= 0) return Object.freeze([{ type: 'death', actorId: targetId, attackId: sourceId }]);
    if (poise <= 0) {
      this.#targets.set(targetId, Object.freeze({ ...target, health, poise: target.maxPoise }));
      return Object.freeze([{ type: 'stagger', actorId: targetId, attackId: sourceId }]);
    }
    return Object.freeze([]);
  }

  recover(deltaMs: number): void {
    const dt = clamp(deltaMs, 0, 100);
    for (const target of this.#targets.values()) {
      const invulnerableMs = Math.max(0, target.invulnerableMs - dt);
      this.#targets.set(target.id, Object.freeze({ ...target, invulnerableMs }));
    }
  }

  snapshot(): Readonly<{ actors: readonly CombatActor[]; targets: readonly CombatTarget[]; attackSerial: number }> {
    return Object.freeze({ actors: this.actors(), targets: this.targets(), attackSerial: this.#attackSerial });
  }

  #advanceActor(actor: CombatActor, deltaMs: number, events: CombatEvent[]): CombatActor {
    let remainingDelta = deltaMs;
    let phaseRemaining = Math.max(0, actor.phaseRemainingMs);
    let state = actor.state;
    let phase = actor.phase;
    let cooldown = Math.max(0, actor.cooldownMs);
    let invulnerable = Math.max(0, actor.invulnerableMs);
    const attackId = actor.currentAttackId;
    const attack = attackId ? this.#attacks[attackId] : undefined;
    let attackInstanceId = actor.attackInstanceId ?? 0;

    while (remainingDelta > 0 && (state === 'startup' || state === 'active' || state === 'recovery')) {
      if (!attack) {
        state = 'idle';
        phase = 'finished';
        phaseRemaining = 0;
        cooldown = 0;
        break;
      }
      const consumed = phaseRemaining > 0 ? Math.min(remainingDelta, phaseRemaining) : 0;
      phaseRemaining -= consumed;
      cooldown = Math.max(0, cooldown - consumed);
      invulnerable = Math.max(0, invulnerable - consumed);
      remainingDelta -= consumed;
      if (phaseRemaining > 0) break;

      if (phase === 'startup') {
        phase = 'active';
        state = 'active';
        phaseRemaining = attack.activeMs;
        events.push({ type: 'attackActive', actorId: actor.id, attackId: attack.id, attackInstanceId });
        events.push(...this.#resolveHits(Object.freeze({ ...actor, state, phase, currentAttackId: attack.id, attackInstanceId }), attack, attackInstanceId));
      } else if (phase === 'active') {
        phase = 'recovery';
        state = 'recovery';
        phaseRemaining = attack.recoveryMs;
      } else {
        phase = 'finished';
        state = 'idle';
        phaseRemaining = 0;
        cooldown = 0;
        events.push({ type: 'attackFinished', actorId: actor.id, attackId: attack.id, attackInstanceId });
      }
    }

    return Object.freeze({
      ...actor,
      state,
      phase,
      phaseRemainingMs: phaseRemaining,
      cooldownMs: cooldown,
      invulnerableMs: invulnerable,
      currentAttackId: state === 'idle' ? undefined : attackId,
      attackInstanceId: state === 'idle' ? undefined : attackInstanceId,
    });
  }

  #resolveHits(attacker: CombatActor, attack: AttackDefinition, attackInstanceId: number): CombatEvent[] {
    const events: CombatEvent[] = [];
    const halfArc = Math.max(0, attack.arcDegrees) * Math.PI / 360;
    for (const target of this.targets()) {
      if (target.team === attacker.team || target.health <= 0 || target.invulnerableMs > 0) continue;
      const dx = target.x - attacker.x;
      const dz = target.z - attacker.z;
      const distance = Math.hypot(dx, dz);
      if (distance > attack.reach + target.radius) continue;
      const targetAngle = Math.atan2(dx, dz);
      if (angleDelta(attacker.yaw, targetAngle) > halfArc) continue;
      const key = `${attackInstanceId}:${target.id}`;
      if (this.#hitLedger.has(key)) continue;
      this.#hitLedger.add(key);
      const result = this.#resolver(attacker, target, attack);
      const blocked = result.blocked === true;
      const critical = result.critical === true;
      const damage = blocked ? attack.damage * 0.2 : (critical ? attack.damage * 1.5 : attack.damage);
      const poiseDamage = blocked ? attack.poiseDamage * 0.5 : attack.poiseDamage;
      const hit: HitEvent = Object.freeze({
        attackId: attack.id,
        attackInstanceId,
        attackerId: attacker.id,
        targetId: target.id,
        damage: Number(positive(damage).toFixed(3)),
        poiseDamage: Number(positive(poiseDamage).toFixed(3)),
        knockback: positive(attack.knockback),
        blocked,
        critical,
      });
      const targetEvents = this.applyDamage(target.id, hit.damage, hit.poiseDamage, attack.id);
      events.push(Object.freeze({ type: 'hit', actorId: attacker.id, attackId: attack.id, attackInstanceId, hit }), ...targetEvents);
    }
    return events;
  }
}

export const makeCombatActor = (id: string, team = 'neutral'): CombatActor => Object.freeze({
  id, x: 0, z: 0, yaw: 0, team, health: 100, maxHealth: 100, poise: 50, maxPoise: 50, stamina: 100, maxStamina: 100,
  state: 'idle', phase: 'finished', phaseRemainingMs: 0, cooldownMs: 0, comboIndex: 0, invulnerableMs: 0,
});

export const makeCombatTarget = (id: string, team = 'neutral'): CombatTarget => Object.freeze({
  id, x: 0, z: 0, radius: 0.5, health: 100, maxHealth: 100, poise: 50, maxPoise: 50, team, invulnerableMs: 0,
});
