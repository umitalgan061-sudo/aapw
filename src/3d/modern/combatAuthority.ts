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
}

export interface HitEvent {
  readonly attackId: string;
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
  readonly hit?: HitEvent;
}

export interface CombatSystemOptions {
  readonly hitResolver?: (attacker: CombatActor, target: CombatTarget, attack: AttackDefinition) => { readonly blocked?: boolean; readonly critical?: boolean };
  readonly now?: () => number;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
const angleDelta = (a: number, b: number): number => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

export const DEFAULT_ATTACKS: Readonly<Record<string, AttackDefinition>> = Object.freeze({
  light: Object.freeze({ id: 'light', damage: 12, staminaCost: 12, startupMs: 180, activeMs: 120, recoveryMs: 320, reach: 2.3, arcDegrees: 95, poiseDamage: 10, knockback: 0.8, invulnerableMs: 0 }),
  heavy: Object.freeze({ id: 'heavy', damage: 28, staminaCost: 26, startupMs: 360, activeMs: 160, recoveryMs: 520, reach: 2.7, arcDegrees: 80, poiseDamage: 25, knockback: 1.7, invulnerableMs: 60 }),
});

export class CombatAuthority {
  readonly #now: () => number;
  readonly #attacks: Readonly<Record<string, AttackDefinition>>;
  readonly #resolver: NonNullable<CombatSystemOptions['hitResolver']>;
  #actors = new Map<string, CombatActor>();
  #targets = new Map<string, CombatTarget>();
  #hitLedger = new Set<string>();

  constructor(attacks: Readonly<Record<string, AttackDefinition>> = DEFAULT_ATTACKS, options: CombatSystemOptions = {}) {
    this.#attacks = attacks;
    this.#now = options.now ?? (() => performance.now());
    this.#resolver = options.hitResolver ?? (() => ({}));
  }

  registerActor(actor: CombatActor): void { this.#actors.set(actor.id, Object.freeze({ ...actor })); }
  registerTarget(target: CombatTarget): void { this.#targets.set(target.id, Object.freeze({ ...target })); }
  updateTarget(target: CombatTarget): void { this.#targets.set(target.id, Object.freeze({ ...target })); }
  removeActor(id: string): void { this.#actors.delete(id); }
  removeTarget(id: string): void { this.#targets.delete(id); }

  actor(id: string): CombatActor | undefined { return this.#actors.get(id); }
  target(id: string): CombatTarget | undefined { return this.#targets.get(id); }

  startAttack(actorId: string, heavy = false): readonly CombatEvent[] {
    const actor = this.#actors.get(actorId);
    if (!actor || actor.state === 'dead' || actor.state === 'stunned' || actor.cooldownMs > 0) return [];
    const attack = this.#attacks[heavy ? 'heavy' : 'light'];
    if (!attack || actor.stamina < attack.staminaCost) return [];
    const next = Object.freeze({
      ...actor,
      state: 'startup' as const,
      phase: 'startup' as const,
      phaseRemainingMs: attack.startupMs,
      cooldownMs: attack.startupMs + attack.activeMs + attack.recoveryMs,
      stamina: Math.max(0, actor.stamina - attack.staminaCost),
      invulnerableMs: Math.max(actor.invulnerableMs, attack.invulnerableMs ?? 0),
    });
    this.#actors.set(actorId, next);
    return [{ type: 'attackStarted', actorId, attackId: attack.id }];
  }

  step(deltaMs: number): readonly CombatEvent[] {
    const dt = clamp(deltaMs, 0, 100);
    const events: CombatEvent[] = [];
    this.#hitLedger.clear();
    for (const actor of [...this.#actors.values()]) {
      const next = this.#advanceActor(actor, dt, events);
      this.#actors.set(actor.id, next);
    }
    return Object.freeze(events);
  }

  applyDamage(targetId: string, damage: number, poiseDamage = 0, sourceId = 'environment'): readonly CombatEvent[] {
    const target = this.#targets.get(targetId);
    if (!target || target.invulnerableMs > 0) return [];
    const actualDamage = Math.max(0, Number.isFinite(damage) ? damage : 0);
    const health = Math.max(0, target.health - actualDamage);
    const poise = Math.max(0, target.poise - Math.max(0, poiseDamage));
    this.#targets.set(targetId, Object.freeze({ ...target, health, poise, invulnerableMs: Math.max(0, target.invulnerableMs) }));
    if (health <= 0) return [{ type: 'death', actorId: targetId, attackId: sourceId }];
    if (poise <= 0) {
      this.#targets.set(targetId, Object.freeze({ ...target, health, poise: target.maxPoise }));
      return [{ type: 'stagger', actorId: targetId, attackId: sourceId }];
    }
    return [];
  }

  recover(deltaMs: number): void {
    const dt = clamp(deltaMs, 0, 100);
    for (const target of this.#targets.values()) {
      const invulnerableMs = Math.max(0, target.invulnerableMs - dt);
      this.#targets.set(target.id, Object.freeze({ ...target, invulnerableMs }));
    }
  }

  #advanceActor(actor: CombatActor, deltaMs: number, events: CombatEvent[]): CombatActor {
    let phaseRemaining = Math.max(0, actor.phaseRemainingMs - deltaMs);
    let state = actor.state;
    let phase = actor.phase;
    let cooldown = Math.max(0, actor.cooldownMs - deltaMs);
    let invulnerable = Math.max(0, actor.invulnerableMs - deltaMs);
    if (state === 'startup' || state === 'active' || state === 'recovery') {
      const attack = this.#attacks[actor.phase === 'recovery' ? (actor.comboIndex > 0 ? 'heavy' : 'light') : 'light'];
      if (!attack) return Object.freeze({ ...actor, state: 'idle', phase: 'finished', phaseRemainingMs: 0, cooldownMs: 0, invulnerableMs: invulnerable });
      if (phaseRemaining > 0) return Object.freeze({ ...actor, phaseRemainingMs: phaseRemaining, cooldownMs: cooldown, invulnerableMs: invulnerable });
      if (phase === 'startup') {
        phase = 'active';
        phaseRemaining = attack.activeMs;
        events.push({ type: 'attackActive', actorId: actor.id, attackId: attack.id });
        events.push(...this.#resolveHits(Object.freeze({ ...actor, phase, state: 'active' }), attack));
      } else if (phase === 'active') {
        phase = 'recovery';
        phaseRemaining = attack.recoveryMs;
      } else {
        phase = 'finished';
        state = 'idle';
        phaseRemaining = 0;
        cooldown = 0;
        events.push({ type: 'attackFinished', actorId: actor.id, attackId: attack.id });
      }
    }
    if (state === 'idle' && cooldown <= 0) phase = 'finished';
    return Object.freeze({ ...actor, state, phase, phaseRemainingMs: phaseRemaining, cooldownMs: cooldown, invulnerableMs: invulnerable });
  }

  #resolveHits(attacker: CombatActor, attack: AttackDefinition): CombatEvent[] {
    const events: CombatEvent[] = [];
    const halfArc = attack.arcDegrees * Math.PI / 360;
    for (const target of this.#targets.values()) {
      if (target.team === attacker.team || target.health <= 0 || target.invulnerableMs > 0) continue;
      const dx = target.x - attacker.x;
      const dz = target.z - attacker.z;
      const distance = Math.hypot(dx, dz);
      if (distance > attack.reach + target.radius) continue;
      const targetAngle = Math.atan2(dx, dz);
      if (angleDelta(attacker.yaw, targetAngle) > halfArc) continue;
      const key = `${attacker.id}:${attack.id}:${target.id}:${this.#now()}`;
      if (this.#hitLedger.has(key)) continue;
      this.#hitLedger.add(key);
      const result = this.#resolver(attacker, target, attack);
      const blocked = result.blocked === true;
      const critical = result.critical === true;
      const damage = blocked ? attack.damage * 0.2 : (critical ? attack.damage * 1.5 : attack.damage);
      const poiseDamage = blocked ? attack.poiseDamage * 0.5 : attack.poiseDamage;
      const hit: HitEvent = Object.freeze({ attackId: attack.id, attackerId: attacker.id, targetId: target.id, damage: Number(damage.toFixed(3)), poiseDamage: Number(poiseDamage.toFixed(3)), knockback: attack.knockback, blocked, critical });
      const targetEvents = this.applyDamage(target.id, damage, poiseDamage, attack.id);
      events.push({ type: 'hit', actorId: attacker.id, attackId: attack.id, hit }, ...targetEvents);
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
