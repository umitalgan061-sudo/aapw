
import { clamp, fail, ok, stableHash, type R35Id, type R35Result } from './contracts';

export type CombatDamageType =
  | 'slash'
  | 'pierce'
  | 'blunt'
  | 'fire'
  | 'frost'
  | 'shock'
  | 'poison'
  | 'arcane';

export interface CombatStats {
  readonly maxHealth: number;
  readonly health: number;
  readonly stamina: number;
  readonly defense: number;
  readonly resistances: Readonly<Record<CombatDamageType, number>>;
}

export interface AbilityDefinition {
  readonly id: R35Id;
  readonly staminaCost: number;
  readonly cooldown: number;
  readonly range: number;
  readonly damage: number;
  readonly damageType: CombatDamageType;
  readonly recovery: number;
  readonly tags: readonly string[];
}

export interface Combatant {
  readonly id: R35Id;
  readonly team: R35Id;
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly stats: CombatStats;
  readonly cooldowns: Readonly<Record<R35Id, number>>;
  readonly statuses: readonly CombatStatus[];
  readonly alive: boolean;
  readonly revision: number;
}

export interface CombatStatus {
  readonly id: R35Id;
  readonly type: 'bleed' | 'burn' | 'freeze' | 'shock' | 'poison' | 'guard';
  readonly duration: number;
  readonly intensity: number;
  readonly source: R35Id;
}

export interface CombatEvent {
  readonly id: R35Id;
  readonly tick: number;
  readonly source: R35Id;
  readonly target: R35Id;
  readonly kind: 'hit' | 'miss' | 'status' | 'death' | 'recover';
  readonly amount: number;
  readonly damageType?: CombatDamageType;
}

interface MutableCombatant {
  id: R35Id;
  team: R35Id;
  position: { x: number; y: number; z: number };
  health: number;
  stamina: number;
  maxHealth: number;
  defense: number;
  resistances: Record<CombatDamageType, number>;
  cooldowns: Map<R35Id, number>;
  statuses: Map<R35Id, CombatStatus>;
  revision: number;
}

const DAMAGE_TYPES: readonly CombatDamageType[] = [
  'slash',
  'pierce',
  'blunt',
  'fire',
  'frost',
  'shock',
  'poison',
  'arcane',
];

function emptyResistances(): Record<CombatDamageType, number> {
  return {
    slash: 0,
    pierce: 0,
    blunt: 0,
    fire: 0,
    frost: 0,
    shock: 0,
    poison: 0,
    arcane: 0,
  };
}

function rangeBetween(
  a: MutableCombatant,
  b: MutableCombatant,
): number {
  const x = a.position.x - b.position.x;
  const y = a.position.y - b.position.y;
  const z = a.position.z - b.position.z;
  return Math.hypot(x, y, z);
}

export class CombatRuntimeR35 {
  #combatants = new Map<R35Id, MutableCombatant>();
  #abilities = new Map<R35Id, AbilityDefinition>();
  #events: CombatEvent[] = [];
  #tick = 0;
  #maxEvents = 4096;

  registerAbility(
    ability: AbilityDefinition,
  ): R35Result<AbilityDefinition> {
    if (this.#abilities.has(ability.id)) {
      return fail('ABILITY_DUPLICATE', 'Ability id already exists');
    }
    if (
      !ability.id
      || ability.staminaCost < 0
      || ability.cooldown < 0
      || ability.range <= 0
      || ability.damage < 0
    ) {
      return fail('ABILITY_INVALID', 'Ability values are invalid');
    }
    this.#abilities.set(
      ability.id,
      Object.freeze({
        ...ability,
        tags: Object.freeze([...ability.tags]),
      }),
    );
    return ok(ability);
  }

  addCombatant(input: {
    id: R35Id;
    team: R35Id;
    position: { x: number; y: number; z: number };
    maxHealth: number;
    defense?: number;
    stamina?: number;
    resistances?: Partial<Record<CombatDamageType, number>>;
  }): R35Result<Combatant> {
    if (this.#combatants.has(input.id)) {
      return fail('COMBATANT_DUPLICATE', 'Combatant already exists');
    }
    if (input.maxHealth <= 0) {
      return fail('COMBATANT_HEALTH', 'Max health must be positive');
    }
    const resistances = emptyResistances();
    for (const type of DAMAGE_TYPES) {
      resistances[type] = clamp(input.resistances?.[type] ?? 0, 0, 0.95);
    }
    const mutable: MutableCombatant = {
      id: input.id,
      team: input.team,
      position: { ...input.position },
      health: input.maxHealth,
      maxHealth: input.maxHealth,
      stamina: clamp(input.stamina ?? 100, 0, 100),
      defense: Math.max(0, input.defense ?? 0),
      resistances,
      cooldowns: new Map(),
      statuses: new Map(),
      revision: 0,
    };
    this.#combatants.set(input.id, mutable);
    return ok(this.#snapshot(mutable));
  }

  move(
    id: R35Id,
    position: { x: number; y: number; z: number },
  ): R35Result<void> {
    const combatant = this.#combatants.get(id);
    if (!combatant) return fail('COMBATANT_MISSING', 'Combatant not found');
    if (!combatant.health || combatant.health <= 0) {
      return fail('COMBATANT_DEAD', 'Dead combatant cannot move');
    }
    combatant.position = {
      x: Number.isFinite(position.x) ? position.x : combatant.position.x,
      y: Number.isFinite(position.y) ? position.y : combatant.position.y,
      z: Number.isFinite(position.z) ? position.z : combatant.position.z,
    };
    combatant.revision += 1;
    return ok(undefined);
  }

  cast(
    sourceId: R35Id,
    targetId: R35Id,
    abilityId: R35Id,
  ): R35Result<CombatEvent> {
    const source = this.#combatants.get(sourceId);
    const target = this.#combatants.get(targetId);
    const ability = this.#abilities.get(abilityId);
    if (!source || !target || !ability) {
      return fail('CAST_INVALID', 'Cast references unknown state');
    }
    if (source.team === target.team) {
      return fail('CAST_FRIENDLY', 'Friendly target blocked');
    }
    if (source.health <= 0 || target.health <= 0) {
      return fail('CAST_DEAD', 'Dead combatants cannot cast');
    }
    const remaining = source.cooldowns.get(abilityId) ?? 0;
    if (remaining > 0) {
      return fail('CAST_COOLDOWN', 'Ability is on cooldown');
    }
    if (source.stamina < ability.staminaCost) {
      return fail('CAST_STAMINA', 'Insufficient stamina');
    }
    if (rangeBetween(source, target) > ability.range) {
      return fail('CAST_RANGE', 'Target is out of range');
    }

    source.stamina -= ability.staminaCost;
    source.cooldowns.set(abilityId, ability.cooldown);
    const resistance = target.resistances[ability.damageType];
    const guard = this.#guardMultiplier(target);
    const defenseMultiplier = 100 / (100 + target.defense);
    const amount = clamp(
      ability.damage
        * (1 - resistance)
        * guard
        * defenseMultiplier,
      0,
      ability.damage,
    );
    target.health = clamp(target.health - amount, 0, target.maxHealth);
    target.revision += 1;

    const event: CombatEvent = Object.freeze({
      id: stableHash({
        tick: this.#tick,
        sourceId,
        targetId,
        abilityId,
      }),
      tick: this.#tick,
      source: sourceId,
      target: targetId,
      kind: 'hit',
      amount,
      damageType: ability.damageType,
    });
    this.#events.push(event);
    this.#trimEvents();

    if (target.health <= 0) {
      this.#events.push(
        Object.freeze({
          id: stableHash({
            event: 'death',
            tick: this.#tick,
            targetId,
          }),
          tick: this.#tick,
          source: sourceId,
          target: targetId,
          kind: 'death',
          amount: 0,
        }),
      );
      this.#trimEvents();
    }

    return ok(event);
  }

  applyStatus(
    sourceId: R35Id,
    targetId: R35Id,
    status: CombatStatus,
  ): R35Result<void> {
    const target = this.#combatants.get(targetId);
    if (!target) return fail('STATUS_TARGET', 'Status target not found');
    if (target.health <= 0) return fail('STATUS_DEAD', 'Dead target cannot receive status');
    const normalized = Object.freeze({
      ...status,
      duration: clamp(Math.trunc(status.duration), 1, 3600),
      intensity: clamp(status.intensity, 0, 1),
      source: sourceId,
    });
    target.statuses.set(status.id, normalized);
    target.revision += 1;
    this.#events.push(
      Object.freeze({
        id: stableHash({
          tick: this.#tick,
          sourceId,
          targetId,
          status,
        }),
        tick: this.#tick,
        source: sourceId,
        target: targetId,
        kind: 'status',
        amount: normalized.intensity,
      }),
    );
    this.#trimEvents();
    return ok(undefined);
  }

  step(ticks = 1): readonly CombatEvent[] {
    const count = clamp(Math.trunc(ticks), 1, 120);
    for (let step = 0; step < count; step += 1) {
      this.#tick += 1;
      for (const combatant of this.#combatants.values()) {
        for (const [abilityId, remaining] of combatant.cooldowns) {
          const next = remaining - 1;
          if (next <= 0) combatant.cooldowns.delete(abilityId);
          else combatant.cooldowns.set(abilityId, next);
        }
        const staminaRecovery = 0.5;
        combatant.stamina = clamp(
          combatant.stamina + staminaRecovery,
          0,
          100,
        );
        for (const [statusId, status] of combatant.statuses) {
          const nextDuration = status.duration - 1;
          if (status.type === 'burn') {
            combatant.health = clamp(
              combatant.health - status.intensity * 0.8,
              0,
              combatant.maxHealth,
            );
          }
          if (nextDuration <= 0) combatant.statuses.delete(statusId);
          else {
            combatant.statuses.set(
              statusId,
              Object.freeze({
                ...status,
                duration: nextDuration,
              }),
            );
          }
        }
        combatant.revision += 1;
      }
    }
    const events = [...this.#events];
    this.#events = [];
    return Object.freeze(events);
  }

  combatant(id: R35Id): Combatant | null {
    const value = this.#combatants.get(id);
    return value ? this.#snapshot(value) : null;
  }

  all(): readonly Combatant[] {
    return Object.freeze(
      [...this.#combatants.values()]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((combatant) => this.#snapshot(combatant)),
    );
  }

  digest(): string {
    return stableHash({
      tick: this.#tick,
      combatants: this.all(),
      abilities: [...this.#abilities.values()].sort((a, b) => a.id.localeCompare(b.id)),
    });
  }

  reset(): void {
    this.#combatants.clear();
    this.#events = [];
    this.#tick = 0;
  }

  #guardMultiplier(target: MutableCombatant): number {
    const guard = [...target.statuses.values()]
      .filter((status) => status.type === 'guard')
      .reduce((max, status) => Math.max(max, status.intensity), 0);
    return clamp(1 - guard * 0.7, 0.25, 1);
  }

  #snapshot(combatant: MutableCombatant): Combatant {
    const stats: CombatStats = Object.freeze({
      maxHealth: combatant.maxHealth,
      health: combatant.health,
      stamina: combatant.stamina,
      defense: combatant.defense,
      resistances: Object.freeze({
        ...combatant.resistances,
      }),
    });
    const cooldowns = Object.freeze(
      Object.fromEntries(
        [...combatant.cooldowns.entries()].sort(([a], [b]) => a.localeCompare(b)),
      ),
    );
    return Object.freeze({
      id: combatant.id,
      team: combatant.team,
      position: Object.freeze({ ...combatant.position }),
      stats,
      cooldowns,
      statuses: Object.freeze(
        [...combatant.statuses.values()].sort((a, b) => a.id.localeCompare(b.id)),
      ),
      alive: combatant.health > 0,
      revision: combatant.revision,
    });
  }

  #trimEvents(): void {
    if (this.#events.length > this.#maxEvents) {
      this.#events.splice(
        0,
        this.#events.length - this.#maxEvents,
      );
    }
  }
}
