import { clamp, normalize3, scale3, subtract3, type Vec3 } from './math.ts';

export type CombatPhase = 'idle' | 'windup' | 'active' | 'recovery' | 'stunned' | 'dead';

export interface AttackDefinition {
  readonly id: string;
  readonly windupTicks: number;
  readonly activeTicks: number;
  readonly recoveryTicks: number;
  readonly damage: number;
  readonly staminaCost: number;
  readonly poiseDamage: number;
  readonly range: number;
  readonly coneDegrees: number;
  readonly knockback: number;
}

export interface CombatantState {
  phase: CombatPhase;
  phaseTick: number;
  health: number;
  maxHealth: number;
  stamina: number;
  maxStamina: number;
  poise: number;
  maxPoise: number;
  attackId?: string;
  invulnerableUntilTick: number;
  comboIndex: number;
  lastHitTick: number;
}

export interface HitCandidate { readonly id: number; readonly position: Vec3; readonly radius: number; readonly facing?: Vec3; }
export interface HitResult { readonly targetId: number; readonly damage: number; readonly poiseDamage: number; readonly knockback: Vec3; readonly critical: boolean; }

export class CombatController {
  readonly attacks = new Map<string, AttackDefinition>();
  readonly state: CombatantState;
  #comboResetTicks: number;

  constructor(options: { maxHealth?: number; maxStamina?: number; maxPoise?: number; comboResetTicks?: number } = {}) {
    const maxHealth = Math.max(1, options.maxHealth ?? 100);
    const maxStamina = Math.max(1, options.maxStamina ?? 100);
    const maxPoise = Math.max(1, options.maxPoise ?? 100);
    this.state = { phase: 'idle', phaseTick: 0, health: maxHealth, maxHealth, stamina: maxStamina, maxStamina, poise: maxPoise, maxPoise, invulnerableUntilTick: -1, comboIndex: 0, lastHitTick: -1 };
    this.#comboResetTicks = Math.max(1, Math.floor(options.comboResetTicks ?? 45));
  }

  registerAttack(definition: AttackDefinition): void {
    if (!definition.id.trim()) throw new TypeError('attack id required');
    if (this.attacks.has(definition.id)) throw new Error(`duplicate attack: ${definition.id}`);
    if (definition.windupTicks < 0 || definition.activeTicks < 1 || definition.recoveryTicks < 0 || definition.damage < 0 || definition.staminaCost < 0) throw new RangeError('invalid attack timings or costs');
    this.attacks.set(definition.id, { ...definition, range: Math.max(0, definition.range), coneDegrees: clamp(definition.coneDegrees, 0, 360), knockback: Math.max(0, definition.knockback) });
  }

  canStartAttack(id: string): boolean {
    const attack = this.attacks.get(id);
    return !!attack && this.state.phase === 'idle' && this.state.health > 0 && this.state.stamina >= attack.staminaCost;
  }

  startAttack(id: string, currentTick: number): boolean {
    if (!this.canStartAttack(id)) return false;
    const attack = this.attacks.get(id)!;
    this.state.phase = attack.windupTicks > 0 ? 'windup' : 'active';
    this.state.phaseTick = 0;
    this.state.attackId = id;
    this.state.stamina -= attack.staminaCost;
    if (currentTick - this.state.lastHitTick > this.#comboResetTicks) this.state.comboIndex = 0;
    return true;
  }

  advance(currentTick: number): void {
    if (this.state.phase === 'dead') return;
    this.state.phaseTick += 1;
    if (this.state.phase === 'windup') {
      const attack = this.attacks.get(this.state.attackId!);
      if (!attack || this.state.phaseTick >= attack.windupTicks) { this.state.phase = 'active'; this.state.phaseTick = 0; }
    } else if (this.state.phase === 'active') {
      const attack = this.attacks.get(this.state.attackId!);
      if (!attack || this.state.phaseTick >= attack.activeTicks) { this.state.phase = attack?.recoveryTicks ? 'recovery' : 'idle'; this.state.phaseTick = 0; }
    } else if (this.state.phase === 'recovery') {
      const attack = this.attacks.get(this.state.attackId!);
      if (!attack || this.state.phaseTick >= attack.recoveryTicks) { this.state.phase = 'idle'; this.state.phaseTick = 0; this.state.attackId = undefined; }
    } else if (this.state.phase === 'stunned') {
      if (this.state.phaseTick >= 15) { this.state.phase = 'idle'; this.state.phaseTick = 0; }
    }
    this.state.stamina = clamp(this.state.stamina + 0.35, 0, this.state.maxStamina);
    this.state.poise = clamp(this.state.poise + 0.8, 0, this.state.maxPoise);
    if (this.state.lastHitTick >= 0 && currentTick - this.state.lastHitTick > this.#comboResetTicks) this.state.comboIndex = 0;
  }

  applyHit(amount: number, poiseDamage: number, currentTick: number, options: { invulnerableTicks?: number; sourcePosition?: Vec3; selfPosition?: Vec3 } = {}): boolean {
    if (currentTick <= this.state.invulnerableUntilTick || this.state.phase === 'dead') return false;
    const healthDamage = Math.max(0, amount);
    this.state.health = clamp(this.state.health - healthDamage, 0, this.state.maxHealth);
    this.state.poise = clamp(this.state.poise - Math.max(0, poiseDamage), 0, this.state.maxPoise);
    this.state.lastHitTick = currentTick;
    this.state.invulnerableUntilTick = currentTick + Math.max(0, Math.floor(options.invulnerableTicks ?? 0));
    if (this.state.health <= 0) { this.state.phase = 'dead'; this.state.phaseTick = 0; this.state.attackId = undefined; return true; }
    if (this.state.poise <= 0) { this.state.phase = 'stunned'; this.state.phaseTick = 0; }
    return true;
  }

  activeAttack(): AttackDefinition | undefined { return this.state.phase === 'active' && this.state.attackId ? this.attacks.get(this.state.attackId) : undefined; }

  resolveHits(selfPosition: Vec3, forward: Vec3, candidates: readonly HitCandidate[], currentTick: number, criticalRoll = 0.1): HitResult[] {
    const attack = this.activeAttack();
    if (!attack) return [];
    const direction = normalize3(forward);
    const halfAngleRadians = (attack.coneDegrees * Math.PI) / 360;
    const cosThreshold = Math.cos(halfAngleRadians);
    const hits: HitResult[] = [];
    const comboMultiplier = 1 + Math.min(4, this.state.comboIndex) * 0.08;
    for (const candidate of candidates) {
      if (candidate.id < 0) continue;
      const delta = subtract3(candidate.position, selfPosition);
      const distance = Math.hypot(delta.x, delta.y, delta.z);
      if (distance > attack.range + Math.max(0, candidate.radius) || distance < 1e-5) continue;
      const toTarget = normalize3(delta);
      if (direction.x * toTarget.x + direction.y * toTarget.y + direction.z * toTarget.z < cosThreshold) continue;
      const roll = Math.abs(Math.sin((currentTick + candidate.id * 17 + this.state.comboIndex * 31) * 12.9898));
      const critical = roll < criticalRoll;
      const damage = attack.damage * comboMultiplier * (critical ? 1.5 : 1);
      hits.push({ targetId: candidate.id, damage, poiseDamage: attack.poiseDamage * (critical ? 1.2 : 1), knockback: scale3(toTarget, attack.knockback * (critical ? 1.15 : 1)), critical });
    }
    this.state.comboIndex = Math.min(5, this.state.comboIndex + (hits.length ? 1 : 0));
    this.state.lastHitTick = currentTick;
    return hits.sort((a, b) => a.targetId - b.targetId);
  }
}

export const LIGHT_ATTACK: AttackDefinition = { id: 'light', windupTicks: 5, activeTicks: 3, recoveryTicks: 10, damage: 14, staminaCost: 8, poiseDamage: 12, range: 2.5, coneDegrees: 95, knockback: 2.2 };
export const HEAVY_ATTACK: AttackDefinition = { id: 'heavy', windupTicks: 14, activeTicks: 4, recoveryTicks: 18, damage: 30, staminaCost: 22, poiseDamage: 28, range: 3, coneDegrees: 110, knockback: 4.5 };
