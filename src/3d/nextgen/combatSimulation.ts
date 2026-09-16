/** Data-driven combat simulation with stamina, poise, armor, hit windows and recovery. */

import { clamp, DeterministicRng, distanceSq3, normalize3, scale3, sub3, type Vec3 } from './deterministicMath';

export type CombatantId = number & { readonly __combatantId: unique symbol };
export type CombatPhase = 'idle' | 'startup' | 'active' | 'recovery' | 'stunned' | 'dead';
export type DamageType = 'slash' | 'pierce' | 'blunt' | 'fire' | 'frost' | 'arcane';

export interface CombatStats {
  maxHealth: number;
  maxStamina: number;
  staminaRegen: number;
  armor: Partial<Record<DamageType, number>>;
  poise: number;
  poiseRecovery: number;
  moveSpeedMultiplier: number;
}

export interface AttackDefinition {
  id: string;
  damage: number;
  damageType: DamageType;
  range: number;
  arcDegrees: number;
  startupTicks: number;
  activeTicks: number;
  recoveryTicks: number;
  staminaCost: number;
  poiseDamage: number;
  staggerTicks: number;
  knockback: number;
  criticalChance: number;
  criticalMultiplier: number;
}

export interface CombatantState {
  id: CombatantId;
  position: Vec3;
  forward: Vec3;
  health: number;
  stamina: number;
  poise: number;
  phase: CombatPhase;
  phaseTicksRemaining: number;
  currentAttack: string | null;
  comboStep: number;
  invulnerableTicks: number;
  hitstopTicks: number;
  stunTicks: number;
  lastHitBy: CombatantId | null;
}

export interface CombatEvent {
  tick: number;
  type: 'attack-start' | 'hit' | 'blocked' | 'critical' | 'stagger' | 'death' | 'dodge';
  sourceId: CombatantId;
  targetId?: CombatantId;
  attackId?: string;
  damage?: number;
  poiseDamage?: number;
}

export interface CombatConfig {
  fixedDeltaSeconds: number;
  blockDamageMultiplier: number;
  poiseFloor: number;
  friendlyFire: boolean;
  maxCombatants: number;
}

const DEFAULT_CONFIG: CombatConfig = {
  fixedDeltaSeconds: 1 / 60,
  blockDamageMultiplier: 0.2,
  poiseFloor: 0,
  friendlyFire: false,
  maxCombatants: 512,
};

const DEFAULT_ATTACKS: AttackDefinition[] = [
  { id: 'light-1', damage: 18, damageType: 'slash', range: 2.3, arcDegrees: 110, startupTicks: 6, activeTicks: 4, recoveryTicks: 13, staminaCost: 10, poiseDamage: 12, staggerTicks: 8, knockback: 1.4, criticalChance: 0.08, criticalMultiplier: 1.75 },
  { id: 'heavy-1', damage: 36, damageType: 'blunt', range: 2.6, arcDegrees: 85, startupTicks: 16, activeTicks: 5, recoveryTicks: 25, staminaCost: 26, poiseDamage: 34, staggerTicks: 16, knockback: 3.4, criticalChance: 0.15, criticalMultiplier: 2.1 },
  { id: 'frost-cut', damage: 14, damageType: 'frost', range: 2.4, arcDegrees: 100, startupTicks: 10, activeTicks: 6, recoveryTicks: 18, staminaCost: 18, poiseDamage: 9, staggerTicks: 12, knockback: 1.0, criticalChance: 0.12, criticalMultiplier: 2.0 },
];

function cloneState(state: CombatantState): CombatantState { return { ...state, position: { ...state.position }, forward: { ...state.forward } }; }
function angleBetween(a: Vec3, b: Vec3): number { const na = normalize3(a); const nb = normalize3(b); return Math.acos(clamp(na.x * nb.x + na.y * nb.y + na.z * nb.z, -1, 1)); }

export class CombatSimulation {
  readonly config: CombatConfig;
  readonly attacks = new Map<string, AttackDefinition>();
  #states = new Map<CombatantId, CombatantState>();
  #stats = new Map<CombatantId, CombatStats>();
  #blocked = new Set<CombatantId>();
  #events: CombatEvent[] = [];
  #rng: DeterministicRng;
  #tick = 0;

  constructor(seed = 0xC0FFEE, config?: Partial<CombatConfig>, attacks = DEFAULT_ATTACKS) { this.config = { ...DEFAULT_CONFIG, ...config }; this.#rng = new DeterministicRng(seed); for (const attack of attacks) this.registerAttack(attack); }
  registerAttack(definition: AttackDefinition): void { if (!definition.id.trim()) throw new Error('attack id must not be empty'); if (this.attacks.has(definition.id)) throw new Error(`duplicate attack ${definition.id}`); this.attacks.set(definition.id, { ...definition }); }

  spawn(id: CombatantId, position: Vec3, stats: CombatStats): void {
    if (this.#states.size >= this.config.maxCombatants) throw new Error('combatant capacity reached');
    if (this.#states.has(id)) throw new Error(`combatant ${id} already exists`);
    const normalized: CombatStats = { maxHealth: stats.maxHealth, maxStamina: stats.maxStamina, staminaRegen: stats.staminaRegen, armor: { ...stats.armor }, poise: stats.poise, poiseRecovery: stats.poiseRecovery, moveSpeedMultiplier: stats.moveSpeedMultiplier > 0 ? stats.moveSpeedMultiplier : 1 };
    this.#stats.set(id, normalized);
    this.#states.set(id, { id, position: { ...position }, forward: { x: 0, y: 0, z: 1 }, health: normalized.maxHealth, stamina: normalized.maxStamina, poise: normalized.poise, phase: 'idle', phaseTicksRemaining: 0, currentAttack: null, comboStep: 0, invulnerableTicks: 0, hitstopTicks: 0, stunTicks: 0, lastHitBy: null });
  }

  remove(id: CombatantId): boolean { const removedState = this.#states.delete(id); const removedStats = this.#stats.delete(id); this.#blocked.delete(id); return removedState || removedStats; }
  getState(id: CombatantId): CombatantState | undefined { const state = this.#states.get(id); return state ? cloneState(state) : undefined; }
  setPose(id: CombatantId, position: Vec3, forward: Vec3): void { const state = this.require(id); state.position = { ...position }; const direction = normalize3(forward); state.forward = direction.x === 0 && direction.y === 0 && direction.z === 0 ? { x: 0, y: 0, z: 1 } : direction; }
  setBlocking(id: CombatantId, blocking: boolean): void { this.require(id); if (blocking) this.#blocked.add(id); else this.#blocked.delete(id); }

  startAttack(id: CombatantId, attackId: string): boolean {
    const state = this.require(id); const definition = this.attacks.get(attackId);
    if (!definition || state.phase === 'dead' || state.phase === 'stunned') return false;
    if (state.stamina < definition.staminaCost || state.hitstopTicks > 0) return false;
    state.stamina -= definition.staminaCost; state.phase = 'startup'; state.phaseTicksRemaining = definition.startupTicks; state.currentAttack = attackId;
    this.#events.push({ tick: this.#tick, type: 'attack-start', sourceId: id, attackId }); return true;
  }

  dodge(id: CombatantId, direction: Vec3, ticks = 10): boolean {
    const state = this.require(id); if (state.phase === 'dead' || state.stamina < 16) return false;
    state.stamina -= 16; state.invulnerableTicks = Math.max(state.invulnerableTicks, ticks); const impulse = scale3(normalize3(direction), 4.5);
    state.position.x += impulse.x; state.position.y += impulse.y; state.position.z += impulse.z;
    this.#events.push({ tick: this.#tick, type: 'dodge', sourceId: id }); return true;
  }

  step(): readonly CombatEvent[] {
    this.#events = []; this.#tick += 1; const states = [...this.#states.values()].sort((a, b) => a.id - b.id);
    for (const state of states) this.updateTimers(state); for (const attacker of states) if (attacker.phase === 'active' && attacker.currentAttack) this.resolveAttack(attacker); for (const state of states) this.regenerate(state);
    return this.events;
  }
  get events(): readonly CombatEvent[] { return this.#events.map((event) => ({ ...event })); }
  get tick(): number { return this.#tick; }
  snapshot(): CombatantState[] { return [...this.#states.values()].sort((a, b) => a.id - b.id).map(cloneState); }

  private updateTimers(state: CombatantState): void {
    if (state.invulnerableTicks > 0) state.invulnerableTicks -= 1; if (state.hitstopTicks > 0) state.hitstopTicks -= 1;
    if (state.stunTicks > 0) { state.stunTicks -= 1; if (state.stunTicks === 0 && state.phase === 'stunned') state.phase = 'idle'; return; }
    if (state.phaseTicksRemaining > 0) state.phaseTicksRemaining -= 1; if (state.phaseTicksRemaining > 0 || !state.currentAttack) return;
    const attack = this.attacks.get(state.currentAttack); if (!attack) { state.currentAttack = null; state.phase = 'idle'; return; }
    if (state.phase === 'startup') { state.phase = 'active'; state.phaseTicksRemaining = attack.activeTicks; } else if (state.phase === 'active') { state.phase = 'recovery'; state.phaseTicksRemaining = attack.recoveryTicks; } else if (state.phase === 'recovery') { state.phase = 'idle'; state.currentAttack = null; }
  }

  private resolveAttack(attacker: CombatantState): void {
    const attack = this.attacks.get(attacker.currentAttack ?? ''); if (!attack) return; const maxAngle = attack.arcDegrees * Math.PI / 360;
    for (const target of [...this.#states.values()].sort((a, b) => a.id - b.id)) {
      if (target.id === attacker.id || target.phase === 'dead' || target.invulnerableTicks > 0) continue;
      if (!this.config.friendlyFire && target.id === attacker.id) continue;
      if (distanceSq3(attacker.position, target.position) > attack.range * attack.range) continue;
      if (angleBetween(attacker.forward, sub3(target.position, attacker.position)) > maxAngle) continue;
      this.applyHit(attacker, target, attack);
    }
  }

  private applyHit(attacker: CombatantState, target: CombatantState, attack: AttackDefinition): void {
    const stats = this.#stats.get(target.id); if (!stats) return; const blocked = this.#blocked.has(target.id); const armor = Math.max(0, stats.armor[attack.damageType] ?? 0);
    const mitigation = clamp(armor / (armor + 100), 0, 0.85); const critical = this.#rng.nextFloat() < attack.criticalChance;
    let damage = attack.damage * (critical ? attack.criticalMultiplier : 1) * (1 - mitigation); if (blocked) damage *= this.config.blockDamageMultiplier; damage = Math.max(1, damage);
    target.health = Math.max(0, target.health - damage); target.lastHitBy = attacker.id; const poiseDamage = attack.poiseDamage * (blocked ? 0.35 : 1); target.poise = Math.max(this.config.poiseFloor, target.poise - poiseDamage);
    attacker.hitstopTicks = Math.max(attacker.hitstopTicks, critical ? 3 : 2); target.hitstopTicks = Math.max(target.hitstopTicks, 2);
    this.#events.push({ tick: this.#tick, type: blocked ? 'blocked' : 'hit', sourceId: attacker.id, targetId: target.id, attackId: attack.id, damage, poiseDamage });
    if (critical) this.#events.push({ tick: this.#tick, type: 'critical', sourceId: attacker.id, targetId: target.id, attackId: attack.id, damage });
    if (target.poise <= this.config.poiseFloor && target.health > 0 && !blocked) this.applyStagger(target, attack.staggerTicks);
    if (target.health <= 0) { target.phase = 'dead'; target.currentAttack = null; this.#events.push({ tick: this.#tick, type: 'death', sourceId: attacker.id, targetId: target.id, attackId: attack.id, damage }); }
  }

  private applyStagger(target: CombatantState, ticks: number): void { target.phase = 'stunned'; target.stunTicks = Math.max(1, ticks); target.currentAttack = null; target.phaseTicksRemaining = 0; this.#events.push({ tick: this.#tick, type: 'stagger', sourceId: target.lastHitBy ?? target.id, targetId: target.id }); }
  private regenerate(state: CombatantState): void { const stats = this.#stats.get(state.id); if (!stats || state.phase === 'dead') return; const multiplier = state.phase === 'idle' ? 1 : 0.35; state.stamina = Math.min(stats.maxStamina, state.stamina + stats.staminaRegen * this.config.fixedDeltaSeconds * multiplier); if (state.poise < stats.poise && state.phase === 'idle') state.poise = Math.min(stats.poise, state.poise + stats.poiseRecovery * this.config.fixedDeltaSeconds); }
  private require(id: CombatantId): CombatantState { const state = this.#states.get(id); if (!state) throw new Error(`unknown combatant ${id}`); return state; }
}

export function createCombatStats(overrides?: Partial<CombatStats>): CombatStats {
  return { maxHealth: 100, maxStamina: 100, staminaRegen: 14, armor: { ...(overrides?.armor ?? {}) }, poise: 50, poiseRecovery: 18, moveSpeedMultiplier: 1, ...(overrides ? { ...overrides, armor: { ...(overrides.armor ?? {}) } } : {}) };
}
