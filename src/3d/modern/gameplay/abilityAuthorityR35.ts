/**
 * R35 ability book and status-effect runtime.
 * All timers are simulation-time only. No Date.now(), performance.now() or random
 * values enter gameplay decisions, keeping replay and save-state behaviour stable.
 */
import type { EntityId } from '../types.ts';

export type AbilityResourceR35 = 'health' | 'stamina' | 'mana';

export type StatusKindR35 =
  | 'buff'
  | 'debuff'
  | 'damageOverTime'
  | 'healOverTime'
  | 'shield'
  | 'haste'
  | 'slow'
  | 'stun'
  | 'silence';

export interface AbilityCostR35 {
  readonly resource: AbilityResourceR35;
  readonly amount: number;
}

export interface AbilityEffectR35 {
  readonly id: string;
  readonly kind: StatusKindR35;
  readonly duration: number;
  readonly magnitude: number;
  readonly maxStacks?: number | undefined;
  readonly refreshDuration?: boolean | undefined;
  readonly tags?: readonly string[] | undefined;
}

export interface AbilityPrerequisiteR35 {
  readonly kind: 'level' | 'ability' | 'tag' | 'resource' | 'effect';
  readonly value: string | number;
}

export interface AbilityDefinitionR35 {
  readonly id: string;
  readonly name: string;
  readonly cooldown: number;
  readonly globalCooldown?: number | undefined;
  readonly castTime?: number | undefined;
  readonly charges?: number | undefined;
  readonly recharge?: number | undefined;
  readonly costs?: readonly AbilityCostR35[] | undefined;
  readonly effects?: readonly AbilityEffectR35[] | undefined;
  readonly prerequisites?: readonly AbilityPrerequisiteR35[] | undefined;
  readonly tags: readonly string[];
  readonly priority?: number | undefined;
}

export interface AbilityStateR35 {
  readonly abilityId: string;
  readonly charges: number;
  readonly cooldownRemaining: number;
  readonly rechargeRemaining: number;
}

export interface ActiveEffectR35 {
  readonly instanceId: string;
  readonly effectId: string;
  readonly kind: StatusKindR35;
  readonly sourceId: EntityId;
  readonly remaining: number;
  readonly magnitude: number;
  readonly stacks: number;
  readonly tags: readonly string[];
}

export interface AbilityContextR35 {
  readonly level: number;
  readonly resources: MutableResourcesR35;
  readonly unlockedAbilities: ReadonlySet<string>;
  readonly tags: ReadonlySet<string>;
}

export interface MutableResourcesR35 {
  health: number;
  stamina: number;
  mana: number;
}

export interface AbilityCastResultR35 {
  readonly ok: boolean;
  readonly abilityId: string;
  readonly reason?: string | undefined;
  readonly spent: Readonly<Partial<Record<AbilityResourceR35, number>>>;
  readonly effectInstances: readonly string[];
}

export interface AbilitySnapshotR35 {
  readonly version: 1;
  readonly ownerId: EntityId;
  readonly globalCooldownRemaining: number;
  readonly sequence: number;
  readonly abilities: readonly AbilityStateR35[];
  readonly effects: readonly ActiveEffectR35[];
}

const RESOURCES: readonly AbilityResourceR35[] = ['health', 'stamina', 'mana'];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeDuration(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function cloneResources(resources: MutableResourcesR35): MutableResourcesR35 {
  return {
    health: Math.max(0, resources.health),
    stamina: Math.max(0, resources.stamina),
    mana: Math.max(0, resources.mana),
  };
}

export class AbilityAuthorityR35 {
  readonly ownerId: EntityId;

  #definitions = new Map<string, AbilityDefinitionR35>();
  #states = new Map<string, AbilityStateR35>();
  #effects: ActiveEffectR35[] = [];
  #sequence = 0;
  #globalCooldownRemaining = 0;

  constructor(ownerId: EntityId) {
    this.ownerId = ownerId;
  }

  register(definition: AbilityDefinitionR35): void {
    if (!definition.id.trim()) throw new Error('ability id required');
    if (!definition.name.trim()) throw new Error('ability name required');
    if (!Number.isFinite(definition.cooldown) || definition.cooldown < 0) {
      throw new Error('invalid ability cooldown');
    }

    const normalized: AbilityDefinitionR35 = {
      ...definition,
      cooldown: Math.max(0, definition.cooldown),
      globalCooldown:
        definition.globalCooldown === undefined
          ? undefined
          : Math.max(0, definition.globalCooldown),
      castTime:
        definition.castTime === undefined
          ? undefined
          : Math.max(0, definition.castTime),
      charges:
        definition.charges === undefined
          ? undefined
          : Math.max(1, Math.floor(definition.charges)),
      recharge:
        definition.recharge === undefined
          ? undefined
          : Math.max(0, definition.recharge),
      costs: definition.costs
        ? definition.costs.map((cost) => ({
            ...cost,
            amount: Math.max(0, Number(cost.amount) || 0),
          }))
        : undefined,
      effects: definition.effects
        ? definition.effects.map((effect) => ({
            ...effect,
            duration: normalizeDuration(effect.duration),
            magnitude: Number.isFinite(effect.magnitude) ? effect.magnitude : 0,
            maxStacks:
              effect.maxStacks === undefined
                ? undefined
                : Math.max(1, Math.floor(effect.maxStacks)),
            tags: effect.tags
              ? [...new Set(effect.tags.map((tag) => tag.trim()).filter(Boolean))].sort()
              : undefined,
          }))
        : undefined,
      prerequisites: definition.prerequisites
        ? [...definition.prerequisites]
        : undefined,
      tags: [...new Set(definition.tags.map((tag) => tag.trim()).filter(Boolean))].sort(),
      priority:
        definition.priority === undefined
          ? undefined
          : Math.floor(definition.priority),
    };

    this.#definitions.set(normalized.id, normalized);
    this.#states.set(normalized.id, {
      abilityId: normalized.id,
      charges: normalized.charges ?? 1,
      cooldownRemaining: 0,
      rechargeRemaining: 0,
    });
  }

  registerMany(definitions: readonly AbilityDefinitionR35[]): void {
    for (const definition of definitions) this.register(definition);
  }

  get definitions(): readonly AbilityDefinitionR35[] {
    return [...this.#definitions.values()].sort(
      (a, b) =>
        (b.priority ?? 0) - (a.priority ?? 0) ||
        a.id.localeCompare(b.id),
    );
  }

  get states(): readonly AbilityStateR35[] {
    return [...this.#states.values()]
      .map((state) => ({ ...state }))
      .sort((a, b) => a.abilityId.localeCompare(b.abilityId));
  }

  get effects(): readonly ActiveEffectR35[] {
    return this.#effects.map((effect) => ({ ...effect }));
  }

  get globalCooldownRemaining(): number {
    return this.#globalCooldownRemaining;
  }

  getDefinition(abilityId: string): AbilityDefinitionR35 | undefined {
    return this.#definitions.get(abilityId);
  }

  getState(abilityId: string): AbilityStateR35 | undefined {
    const state = this.#states.get(abilityId);
    return state ? { ...state } : undefined;
  }

  hasEffect(effectId: string): boolean {
    return this.#effects.some(
      (effect) => effect.effectId === effectId && effect.remaining > 0,
    );
  }

  effectStacks(effectId: string): number {
    return this.#effects.reduce(
      (sum, effect) =>
        sum + (effect.effectId === effectId && effect.remaining > 0 ? effect.stacks : 0),
      0,
    );
  }

  private requirementFailure(
    definition: AbilityDefinitionR35,
    context: AbilityContextR35,
  ): string | undefined {
    for (const requirement of definition.prerequisites ?? []) {
      if (requirement.kind === 'level') {
        if (context.level < Number(requirement.value)) {
          return 'level requirement not met';
        }
      }
      if (requirement.kind === 'ability') {
        if (!context.unlockedAbilities.has(String(requirement.value))) {
          return 'ability prerequisite not met';
        }
      }
      if (requirement.kind === 'tag') {
        if (!context.tags.has(String(requirement.value))) {
          return 'tag prerequisite not met';
        }
      }
      if (requirement.kind === 'effect') {
        if (!this.hasEffect(String(requirement.value))) {
          return 'status prerequisite not met';
        }
      }
      if (requirement.kind === 'resource') {
        const parts = String(requirement.value).split(':');
        const resource = parts[0] as AbilityResourceR35;
        const amount = Number(parts[1]);
        if (!RESOURCES.includes(resource) || !Number.isFinite(amount)) {
          return 'invalid resource prerequisite';
        }
        if (context.resources[resource] < amount) {
          return 'resource prerequisite not met';
        }
      }
    }
    return undefined;
  }

  private costFailure(
    definition: AbilityDefinitionR35,
    resources: MutableResourcesR35,
  ): string | undefined {
    for (const cost of definition.costs ?? []) {
      if (!RESOURCES.includes(cost.resource)) return 'invalid ability resource';
      if (resources[cost.resource] < cost.amount) {
        return 'insufficient ' + cost.resource;
      }
    }
    return undefined;
  }

  private spend(
    definition: AbilityDefinitionR35,
    resources: MutableResourcesR35,
  ): Readonly<Partial<Record<AbilityResourceR35, number>>> {
    const spent: Partial<Record<AbilityResourceR35, number>> = {};
    for (const cost of definition.costs ?? []) {
      const amount = Math.max(0, cost.amount);
      if (amount === 0) continue;
      resources[cost.resource] = Math.max(
        0,
        resources[cost.resource] - amount,
      );
      spent[cost.resource] = (spent[cost.resource] ?? 0) + amount;
    }
    return spent;
  }

  private nextInstance(effectId: string): string {
    this.#sequence += 1;
    return this.ownerId + ':effect:' + effectId + ':' + this.#sequence.toString(36);
  }

  private apply(
    effect: AbilityEffectR35,
    sourceId: EntityId,
  ): string {
    const existing = this.#effects.find(
      (candidate) => candidate.effectId === effect.id,
    );

    if (existing) {
      const maxStacks = Math.max(1, effect.maxStacks ?? 1);
      existing.stacks = Math.min(maxStacks, existing.stacks + 1);
      if (effect.refreshDuration !== false) {
        existing.remaining = Math.max(
          existing.remaining,
          normalizeDuration(effect.duration),
        );
      }
      existing.tags = effect.tags ? [...effect.tags] : existing.tags;
      existing.magnitude = Number.isFinite(effect.magnitude)
        ? effect.magnitude
        : existing.magnitude;
      return existing.instanceId;
    }

    const instance: ActiveEffectR35 = {
      instanceId: this.nextInstance(effect.id),
      effectId: effect.id,
      kind: effect.kind,
      sourceId,
      remaining: normalizeDuration(effect.duration),
      magnitude: Number.isFinite(effect.magnitude) ? effect.magnitude : 0,
      stacks: 1,
      tags: effect.tags ? [...effect.tags] : [],
    };
    this.#effects.push(instance);
    return instance.instanceId;
  }

  cast(
    abilityId: string,
    context: AbilityContextR35,
    sourceId: EntityId = this.ownerId,
  ): AbilityCastResultR35 {
    const definition = this.#definitions.get(abilityId);
    const state = this.#states.get(abilityId);
    if (!definition || !state) {
      return {
        ok: false,
        abilityId,
        reason: 'unknown ability',
        spent: {},
        effectInstances: [],
      };
    }

    if (this.#globalCooldownRemaining > 0) {
      return {
        ok: false,
        abilityId,
        reason: 'global cooldown',
        spent: {},
        effectInstances: [],
      };
    }

    if (state.cooldownRemaining > 0) {
      return {
        ok: false,
        abilityId,
        reason: 'ability cooldown',
        spent: {},
        effectInstances: [],
      };
    }

    if (state.charges <= 0) {
      return {
        ok: false,
        abilityId,
        reason: 'no charges',
        spent: {},
        effectInstances: [],
      };
    }

    const requirementError = this.requirementFailure(definition, context);
    if (requirementError) {
      return {
        ok: false,
        abilityId,
        reason: requirementError,
        spent: {},
        effectInstances: [],
      };
    }

    const costError = this.costFailure(definition, context.resources);
    if (costError) {
      return {
        ok: false,
        abilityId,
        reason: costError,
        spent: {},
        effectInstances: [],
      };
    }

    const spent = this.spend(definition, context.resources);
    const maxCharges = definition.charges ?? 1;
    const nextCharges = Math.max(0, state.charges - 1);
    this.#states.set(abilityId, {
      abilityId,
      charges: nextCharges,
      cooldownRemaining: definition.cooldown,
      rechargeRemaining:
        nextCharges < maxCharges
          ? definition.recharge ?? definition.cooldown
          : 0,
    });
    this.#globalCooldownRemaining = definition.globalCooldown ?? 0;

    const effectInstances: string[] = [];
    for (const effect of definition.effects ?? []) {
      effectInstances.push(this.apply(effect, sourceId));
    }

    return {
      ok: true,
      abilityId,
      spent,
      effectInstances,
    };
  }

  tick(deltaSeconds: number): void {
    const delta = Math.max(
      0,
      Number.isFinite(deltaSeconds) ? deltaSeconds : 0,
    );

    this.#globalCooldownRemaining = Number(
      Math.max(0, this.#globalCooldownRemaining - delta).toFixed(6),
    );

    for (const definition of this.#definitions.values()) {
      const current = this.#states.get(definition.id);
      if (!current) continue;

      const maxCharges = definition.charges ?? 1;
      let charges = current.charges;
      let cooldown = Math.max(0, current.cooldownRemaining - delta);
      let recharge = Math.max(0, current.rechargeRemaining - delta);

      if (definition.charges && charges < maxCharges && recharge <= 0) {
        charges += 1;
        recharge =
          charges < maxCharges
            ? Math.max(0, definition.recharge ?? definition.cooldown)
            : 0;
      }

      if (cooldown === 0 && !definition.charges) charges = 1;

      this.#states.set(definition.id, {
        abilityId: definition.id,
        charges: Math.min(maxCharges, charges),
        cooldownRemaining: Number(cooldown.toFixed(6)),
        rechargeRemaining: Number(recharge.toFixed(6)),
      });
    }

    this.#effects = this.#effects
      .map((effect) => ({
        ...effect,
        remaining: Number(Math.max(0, effect.remaining - delta).toFixed(6)),
      }))
      .filter((effect) => effect.remaining > 0);
  }

  purgeEffect(effectId: string): number {
    const before = this.#effects.length;
    this.#effects = this.#effects.filter((effect) => effect.effectId !== effectId);
    return before - this.#effects.length;
  }

  purgeByKind(kind: StatusKindR35): number {
    const before = this.#effects.length;
    this.#effects = this.#effects.filter((effect) => effect.kind !== kind);
    return before - this.#effects.length;
  }

  restoreAllCharges(): void {
    for (const definition of this.#definitions.values()) {
      const maxCharges = definition.charges ?? 1;
      this.#states.set(definition.id, {
        abilityId: definition.id,
        charges: maxCharges,
        cooldownRemaining: 0,
        rechargeRemaining: 0,
      });
    }
    this.#globalCooldownRemaining = 0;
  }

  cloneResources(resources: MutableResourcesR35): MutableResourcesR35 {
    return cloneResources(resources);
  }

  snapshot(): AbilitySnapshotR35 {
    return {
      version: 1,
      ownerId: this.ownerId,
      globalCooldownRemaining: this.#globalCooldownRemaining,
      sequence: this.#sequence,
      abilities: this.states,
      effects: this.effects,
    };
  }

  restore(snapshot: AbilitySnapshotR35): void {
    if (snapshot.version !== 1) throw new Error('unsupported ability snapshot');
    if (snapshot.ownerId !== this.ownerId) throw new Error('ability owner mismatch');

    this.#globalCooldownRemaining = Math.max(
      0,
      Number(snapshot.globalCooldownRemaining) || 0,
    );
    this.#sequence = Math.max(0, Math.floor(snapshot.sequence));

    for (const definition of this.#definitions.values()) {
      const saved = snapshot.abilities.find(
        (state) => state.abilityId === definition.id,
      );
      if (!saved) continue;
      const maxCharges = definition.charges ?? 1;
      this.#states.set(definition.id, {
        abilityId: definition.id,
        charges: clamp(Math.floor(saved.charges), 0, maxCharges),
        cooldownRemaining: Math.max(0, saved.cooldownRemaining),
        rechargeRemaining: Math.max(0, saved.rechargeRemaining),
      });
    }

    this.#effects = snapshot.effects
      .filter((effect) => effect.remaining > 0 && effect.sourceId)
      .map((effect) => ({
        ...effect,
        remaining: Math.max(0, effect.remaining),
        stacks: Math.max(1, Math.floor(effect.stacks)),
        tags: [...effect.tags],
      }));
  }
}
