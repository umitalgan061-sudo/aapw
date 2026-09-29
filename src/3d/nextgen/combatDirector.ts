import type { EntityId, Vec3, RuntimeEvent } from './kernelTypes.ts';
import { asEntityId, clamp, fault, stableHash, vec3 } from './kernelTypes.ts';

export type CombatPhase = 'idle' | 'windup' | 'active' | 'recovery' | 'staggered' | 'dead';
export type AttackKind = 'light' | 'heavy' | 'parry' | 'dodge-counter';

export interface CombatPolicy {
  readonly lightDamage: number;
  readonly heavyDamage: number;
  readonly staminaLight: number;
  readonly staminaHeavy: number;
  readonly guardMultiplier: number;
  readonly parryWindowSeconds: number;
  readonly hitstopSeconds: number;
  readonly poisePerDamage: number;
  readonly staggerThreshold: number;
  readonly invulnerableAfterHitSeconds: number;
  readonly recoverySeconds: number;
}

export const DEFAULT_COMBAT_POLICY: CombatPolicy = Object.freeze({
  lightDamage: 18,
  heavyDamage: 34,
  staminaLight: 8,
  staminaHeavy: 20,
  guardMultiplier: 0.22,
  parryWindowSeconds: 0.18,
  hitstopSeconds: 0.055,
  poisePerDamage: 0.6,
  staggerThreshold: 100,
  invulnerableAfterHitSeconds: 0.08,
  recoverySeconds: 0.32,
});

export interface CombatantSpec {
  readonly id: string;
  readonly faction: string;
  readonly health?: number;
  readonly maxHealth?: number;
  readonly stamina?: number;
  readonly maxStamina?: number;
  readonly poise?: number;
  readonly maxPoise?: number;
  readonly position?: Vec3;
}

export interface CombatantState {
  readonly id: EntityId;
  readonly faction: string;
  readonly health: number;
  readonly maxHealth: number;
  readonly stamina: number;
  readonly maxStamina: number;
  readonly poise: number;
  readonly maxPoise: number;
  readonly phase: CombatPhase;
  readonly guarding: boolean;
  readonly parryRemaining: number;
  readonly invulnerableRemaining: number;
  readonly recoveryRemaining: number;
  readonly hitstopRemaining: number;
  readonly position: Vec3;
  readonly lastAttacker?: EntityId;
}

export interface AttackRequest {
  readonly attacker: EntityId | string;
  readonly target: EntityId | string;
  readonly kind: AttackKind;
  readonly tick: number;
  readonly direction?: Vec3;
}

export interface HitResolution {
  readonly accepted: boolean;
  readonly attacker: EntityId;
  readonly target: EntityId;
  readonly kind: AttackKind;
  readonly damage: number;
  readonly blocked: boolean;
  readonly parried: boolean;
  readonly staggered: boolean;
  readonly killed: boolean;
  readonly knockback: Vec3;
  readonly eventId: number;
}

const nowSafe = (value: number): number => Math.max(0, value);

export class CombatDirector {
  readonly policy: CombatPolicy;
  #combatants = new Map<EntityId, CombatantState>();
  #events: RuntimeEvent[] = [];
  #eventCounter = 0;
  #disposed = false;

  constructor(policy: CombatPolicy = DEFAULT_COMBAT_POLICY) {
    this.policy = Object.freeze({ ...policy });
  }

  register(spec: CombatantSpec): EntityId {
    const id = asEntityId(spec.id);
    const maxHealth = Math.max(1, spec.maxHealth ?? 100);
    const maxStamina = Math.max(1, spec.maxStamina ?? 100);
    const maxPoise = Math.max(1, spec.maxPoise ?? 100);
    const current = this.#combatants.get(id);
    this.#combatants.set(id, Object.freeze({
      id,
      faction: spec.faction,
      health: clamp(spec.health ?? current?.health ?? maxHealth, 0, maxHealth),
      maxHealth,
      stamina: clamp(spec.stamina ?? current?.stamina ?? maxStamina, 0, maxStamina),
      maxStamina,
      poise: clamp(spec.poise ?? current?.poise ?? maxPoise, 0, maxPoise),
      maxPoise,
      phase: current?.phase ?? 'idle',
      guarding: current?.guarding ?? false,
      parryRemaining: current?.parryRemaining ?? 0,
      invulnerableRemaining: current?.invulnerableRemaining ?? 0,
      recoveryRemaining: current?.recoveryRemaining ?? 0,
      hitstopRemaining: current?.hitstopRemaining ?? 0,
      position: spec.position ?? current?.position ?? vec3(),
      ...(current?.lastAttacker ? { lastAttacker: current.lastAttacker } : {}),
    }));
    return id;
  }

  state(id: EntityId | string): CombatantState | null {
    return this.#combatants.get(asEntityId(String(id))) ?? null;
  }

  all(): readonly CombatantState[] {
    return Object.freeze([...this.#combatants.values()].sort((a, b) => a.id.localeCompare(b.id)));
  }

  setGuarding(id: EntityId | string, guarding: boolean): boolean {
    const key = asEntityId(String(id));
    const current = this.#combatants.get(key);
    if (!current || current.phase === 'dead') return false;
    this.#combatants.set(key, Object.freeze({
      ...current,
      guarding: Boolean(guarding),
      parryRemaining: guarding ? this.policy.parryWindowSeconds : 0,
    }));
    return true;
  }

  setPosition(id: EntityId | string, position: Vec3): boolean {
    const key = asEntityId(String(id));
    const current = this.#combatants.get(key);
    if (!current) return false;
    this.#combatants.set(key, Object.freeze({ ...current, position }));
    return true;
  }

  tick(dt: number): void {
    if (this.#disposed) return;
    const delta = clamp(dt, 0, 0.1);
    for (const [id, state] of this.#combatants) {
      const nextParry = Math.max(0, state.parryRemaining - delta);
      const nextInvuln = Math.max(0, state.invulnerableRemaining - delta);
      const nextRecovery = Math.max(0, state.recoveryRemaining - delta);
      const nextHitstop = Math.max(0, state.hitstopRemaining - delta);
      const phase = state.health <= 0 ? 'dead'
        : state.phase === 'staggered' && nextRecovery > 0 ? 'staggered'
        : state.phase === 'staggered' ? 'idle'
        : state.phase;
      const poise = phase === 'idle' ? Math.min(state.maxPoise, state.poise + delta * 12) : state.poise;
      const stamina = state.guarding ? state.stamina : Math.min(state.maxStamina, state.stamina + delta * 18);
      this.#combatants.set(id, Object.freeze({
        ...state,
        parryRemaining: nextParry,
        invulnerableRemaining: nextInvuln,
        recoveryRemaining: nextRecovery,
        hitstopRemaining: nextHitstop,
        phase,
        poise,
        stamina,
      }));
    }
  }

  attack(request: AttackRequest): { ok: true; value: HitResolution } | { ok: false; error: ReturnType<typeof fault> } {
    if (this.#disposed) return { ok: false, error: fault('disposed', 'Combat director is disposed.', false) };
    const attacker = this.#combatants.get(asEntityId(String(request.attacker)));
    const target = this.#combatants.get(asEntityId(String(request.target)));
    if (!attacker || !target) return { ok: false, error: fault('invalid', 'Combatant is not registered.', true) };
    if (attacker.phase === 'dead' || target.phase === 'dead') return { ok: false, error: fault('invalid', 'Dead combatants cannot attack.', true) };

    const heavy = request.kind === 'heavy';
    const staminaCost = heavy ? this.policy.staminaHeavy : this.policy.staminaLight;
    if (attacker.stamina < staminaCost) return { ok: false, error: fault('budget', 'Not enough combat stamina.', true, { attacker: String(attacker.id) }) };

    const sameFaction = attacker.faction === target.faction;
    if (sameFaction) return { ok: false, error: fault('invalid', 'Friendly-fire attack rejected by faction rule.', true) };

    const parried = target.parryRemaining > 0;
    const blocked = !parried && target.guarding;
    let damage = heavy ? this.policy.heavyDamage : this.policy.lightDamage;
    if (blocked) damage *= this.policy.guardMultiplier;
    if (parried) damage = 0;

    const poiseDamage = damage * this.policy.poisePerDamage;
    const nextPoise = Math.max(0, target.poise - poiseDamage);
    const staggered = !parried && nextPoise <= 0;
    const nextHealth = Math.max(0, target.health - damage);
    const killed = nextHealth <= 0;

    const attackDirection = request.direction ? vec3(request.direction.x, 0, request.direction.z) : vec3(0, 0, 1);
    const knockback = parried
      ? vec3(attackDirection.x * -1.5, 0.2, attackDirection.z * -1.5)
      : vec3(attackDirection.x * (blocked ? 1.5 : 3.5), 0, attackDirection.z * (blocked ? 1.5 : 3.5));

    this.#combatants.set(attacker.id, Object.freeze({
      ...attacker,
      stamina: Math.max(0, attacker.stamina - staminaCost),
      phase: heavy ? 'recovery' : attacker.phase,
      recoveryRemaining: heavy ? this.policy.recoverySeconds : attacker.recoveryRemaining,
      hitstopRemaining: this.policy.hitstopSeconds,
    }));
    this.#combatants.set(target.id, Object.freeze({
      ...target,
      health: nextHealth,
      poise: staggered ? target.maxPoise : nextPoise,
      phase: killed ? 'dead' : staggered ? 'staggered' : target.phase,
      recoveryRemaining: staggered ? this.policy.recoverySeconds : target.recoveryRemaining,
      invulnerableRemaining: this.policy.invulnerableAfterHitSeconds,
      hitstopRemaining: this.policy.hitstopSeconds,
      lastAttacker: attacker.id,
    }));

    const eventId = ++this.#eventCounter;
    const event: RuntimeEvent<HitResolution> = Object.freeze({
      id: eventId as RuntimeEvent<HitResolution>['id'],
      tick: request.tick,
      type: parried ? 'combat.parry' : killed ? 'combat.kill' : staggered ? 'combat.stagger' : 'combat.hit',
      payload: Object.freeze({
        accepted: true,
        attacker: attacker.id,
        target: target.id,
        kind: request.kind,
        damage,
        blocked,
        parried,
        staggered,
        killed,
        knockback,
        eventId,
      }),
    });
    this.#events.push(event);
    if (this.#events.length > 2048) this.#events.splice(0, this.#events.length - 2048);

    return { ok: true, value: event.payload };
  }

  drainEvents(): readonly RuntimeEvent[] {
    const events = this.#events.splice(0);
    return Object.freeze(events);
  }

  events(): readonly RuntimeEvent[] {
    return Object.freeze([...this.#events]);
  }

  heal(id: EntityId | string, amount: number): boolean {
    const key = asEntityId(String(id));
    const current = this.#combatants.get(key);
    if (!current || current.phase === 'dead') return false;
    this.#combatants.set(key, Object.freeze({ ...current, health: Math.min(current.maxHealth, current.health + nowSafe(amount)) }));
    return true;
  }

  revive(id: EntityId | string, health = 30): boolean {
    const key = asEntityId(String(id));
    const current = this.#combatants.get(key);
    if (!current) return false;
    this.#combatants.set(key, Object.freeze({
      ...current,
      health: clamp(health, 1, current.maxHealth),
      stamina: current.maxStamina,
      poise: current.maxPoise,
      phase: 'idle',
      guarding: false,
      parryRemaining: 0,
      invulnerableRemaining: 0,
      recoveryRemaining: 0,
    }));
    return true;
  }

  diagnostics() {
    const all = this.all();
    return Object.freeze({
      count: all.length,
      living: all.filter((item) => item.phase !== 'dead').length,
      dead: all.filter((item) => item.phase === 'dead').length,
      guarding: all.filter((item) => item.guarding).length,
      bufferedEvents: this.#events.length,
      health: all.reduce((sum, item) => sum + item.health, 0),
      digest: stableHash(all.map((item) => ({
        id: item.id, h: item.health, s: item.stamina, p: item.poise, phase: item.phase,
      }))),
    });
  }

  dispose(): void {
    this.#disposed = true;
    this.#combatants.clear();
    this.#events = [];
  }
}
