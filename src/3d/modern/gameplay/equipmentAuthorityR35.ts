/**
 * R35 equipment authority.
 *
 * Separating loadout ownership from bag ownership prevents inventory sorting,
 * loot operations and UI actions from mutating combat modifiers implicitly.
 */
import type { EntityId } from '../types.ts';

export type EquipmentSlotR35 =
  | 'head'
  | 'chest'
  | 'legs'
  | 'hands'
  | 'feet'
  | 'mainHand'
  | 'offHand'
  | 'neck'
  | 'ring1'
  | 'ring2'
  | 'back';

export type EquipmentStatR35 =
  | 'health'
  | 'stamina'
  | 'mana'
  | 'armor'
  | 'power'
  | 'speed'
  | 'crit'
  | 'poise'
  | 'luck'
  | 'carry'
  | 'fireResist'
  | 'iceResist'
  | 'waterResist'
  | 'natureResist';

export interface EquipmentDefinitionR35 {
  readonly id: string;
  readonly itemId: string;
  readonly slot: EquipmentSlotR35;
  readonly twoHanded?: boolean | undefined;
  readonly levelRequired?: number | undefined;
  readonly requiredTags?: readonly string[] | undefined;
  readonly modifiers: Readonly<Partial<Record<EquipmentStatR35, number>>>;
  readonly tags: readonly string[];
}

export interface EquippedEntryR35 {
  readonly definitionId: string;
  readonly itemId: string;
  readonly instanceId: string;
  readonly slot: EquipmentSlotR35;
  readonly durability: number;
}

export interface EquipmentBaseStatsR35 {
  readonly health: number;
  readonly stamina: number;
  readonly mana: number;
  readonly armor: number;
  readonly power: number;
  readonly speed: number;
  readonly crit: number;
  readonly poise: number;
  readonly luck: number;
  readonly carry: number;
  readonly fireResist: number;
  readonly iceResist: number;
  readonly waterResist: number;
  readonly natureResist: number;
}

export interface EquipmentDerivedStatsR35 extends EquipmentBaseStatsR35 {
  readonly rating: number;
  readonly loadFactor: number;
}

export interface EquipmentSnapshotR35 {
  readonly version: 1;
  readonly ownerId: EntityId;
  readonly level: number;
  readonly equipped: Readonly<Partial<Record<EquipmentSlotR35, EquippedEntryR35>>>;
}

export interface EquipmentResultR35 {
  readonly ok: boolean;
  readonly slot: EquipmentSlotR35;
  readonly definitionId?: string | undefined;
  readonly replaced?: EquippedEntryR35 | undefined;
  readonly clearedSlot?: EquipmentSlotR35 | undefined;
  readonly reason?: string | undefined;
}

const SLOTS: readonly EquipmentSlotR35[] = [
  'head',
  'chest',
  'legs',
  'hands',
  'feet',
  'mainHand',
  'offHand',
  'neck',
  'ring1',
  'ring2',
  'back',
];

const STATS: readonly EquipmentStatR35[] = [
  'health',
  'stamina',
  'mana',
  'armor',
  'power',
  'speed',
  'crit',
  'poise',
  'luck',
  'carry',
  'fireResist',
  'iceResist',
  'waterResist',
  'natureResist',
];

const DEFAULT_STATS: EquipmentBaseStatsR35 = {
  health: 100,
  stamina: 100,
  mana: 50,
  armor: 0,
  power: 10,
  speed: 5,
  crit: 0.05,
  poise: 0,
  luck: 0,
  carry: 100,
  fireResist: 0,
  iceResist: 0,
  waterResist: 0,
  natureResist: 0,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function safeNumber(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? value! : fallback;
}

function cloneEntry(entry: EquippedEntryR35 | undefined): EquippedEntryR35 | undefined {
  return entry ? { ...entry } : undefined;
}

export class EquipmentAuthorityR35 {
  readonly ownerId: EntityId;

  #level: number;
  #baseStats: EquipmentBaseStatsR35 = { ...DEFAULT_STATS };
  #definitions = new Map<string, EquipmentDefinitionR35>();
  #equipped = new Map<EquipmentSlotR35, EquippedEntryR35>();

  constructor(
    ownerId: EntityId,
    options: {
      readonly level?: number;
      readonly baseStats?: Partial<EquipmentBaseStatsR35>;
    } = {},
  ) {
    this.ownerId = ownerId;
    this.#level = Math.max(1, Math.floor(options.level ?? 1));
    this.#baseStats = {
      ...DEFAULT_STATS,
      ...options.baseStats,
    };
  }

  get level(): number {
    return this.#level;
  }

  get definitions(): readonly EquipmentDefinitionR35[] {
    return [...this.#definitions.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  get equipped(): Readonly<Partial<Record<EquipmentSlotR35, EquippedEntryR35>>> {
    const result: Partial<Record<EquipmentSlotR35, EquippedEntryR35>> = {};
    for (const slot of SLOTS) {
      const entry = this.#equipped.get(slot);
      if (entry) result[slot] = { ...entry };
    }
    return result;
  }

  setLevel(level: number): void {
    this.#level = Math.max(1, Math.floor(level));
  }

  setBaseStats(stats: Partial<EquipmentBaseStatsR35>): void {
    this.#baseStats = {
      ...this.#baseStats,
      ...stats,
    };
  }

  register(definition: EquipmentDefinitionR35): void {
    if (!definition.id.trim()) throw new Error('equipment id required');
    if (!definition.itemId.trim()) throw new Error('equipment item id required');
    if (!Array.isArray(definition.tags)) throw new Error('equipment tags required');

    const normalized: EquipmentDefinitionR35 = {
      ...definition,
      levelRequired:
        definition.levelRequired === undefined
          ? undefined
          : Math.max(1, Math.floor(definition.levelRequired)),
      requiredTags: definition.requiredTags
        ? [...new Set(definition.requiredTags.map((tag) => tag.trim()).filter(Boolean))].sort()
        : undefined,
      tags: [...new Set(definition.tags.map((tag) => tag.trim()).filter(Boolean))].sort(),
      modifiers: { ...definition.modifiers },
    };

    this.#definitions.set(normalized.id, normalized);
  }

  registerMany(definitions: readonly EquipmentDefinitionR35[]): void {
    for (const definition of definitions) this.register(definition);
  }

  getDefinition(definitionId: string): EquipmentDefinitionR35 | undefined {
    return this.#definitions.get(definitionId);
  }

  private slotFor(definitionId: string): EquipmentSlotR35 | null {
    return this.#definitions.get(definitionId)?.slot ?? null;
  }

  private requiredTagsMet(
    definition: EquipmentDefinitionR35,
    availableTags: ReadonlySet<string>,
  ): boolean {
    return (definition.requiredTags ?? []).every((tag) => availableTags.has(tag));
  }

  canEquip(
    definitionId: string,
    options: {
      readonly availableTags?: ReadonlySet<string>;
      readonly level?: number;
    } = {},
  ): EquipmentResultR35 {
    const definition = this.#definitions.get(definitionId);
    if (!definition) {
      return {
        ok: false,
        slot: 'mainHand',
        reason: 'unknown equipment definition',
      };
    }

    const level = options.level ?? this.#level;
    if (definition.levelRequired !== undefined && level < definition.levelRequired) {
      return {
        ok: false,
        slot: definition.slot,
        definitionId,
        reason: 'required level is not met',
      };
    }

    const tags = options.availableTags ?? new Set<string>();
    if (!this.requiredTagsMet(definition, tags)) {
      return {
        ok: false,
        slot: definition.slot,
        definitionId,
        reason: 'required equipment tags are missing',
      };
    }

    if (definition.slot === 'offHand') {
      const main = this.#equipped.get('mainHand');
      const mainDefinition = main
        ? this.#definitions.get(main.definitionId)
        : undefined;
      if (mainDefinition?.twoHanded) {
        return {
          ok: false,
          slot: definition.slot,
          definitionId,
          reason: 'two-handed main hand blocks off-hand',
        };
      }
    }

    return {
      ok: true,
      slot: definition.slot,
      definitionId,
      replaced: cloneEntry(this.#equipped.get(definition.slot)),
      clearedSlot:
        definition.slot === 'mainHand' && definition.twoHanded
          ? 'offHand'
          : undefined,
    };
  }

  equip(
    definitionId: string,
    instanceId: string,
    durability = 1,
    options: {
      readonly availableTags?: ReadonlySet<string>;
      readonly level?: number;
    } = {},
  ): EquipmentResultR35 {
    const definition = this.#definitions.get(definitionId);
    if (!definition) {
      return {
        ok: false,
        slot: 'mainHand',
        reason: 'unknown equipment definition',
      };
    }

    const check = this.canEquip(definitionId, options);
    if (!check.ok) return check;

    const replaced = this.#equipped.get(definition.slot);
    const entry: EquippedEntryR35 = {
      definitionId,
      itemId: definition.itemId,
      instanceId,
      slot: definition.slot,
      durability: clamp(durability, 0, 1),
    };

    this.#equipped.set(definition.slot, entry);

    let clearedSlot: EquipmentSlotR35 | undefined;
    if (definition.twoHanded && definition.slot === 'mainHand') {
      if (this.#equipped.delete('offHand')) clearedSlot = 'offHand';
    }

    return {
      ok: true,
      slot: definition.slot,
      definitionId,
      replaced: cloneEntry(replaced),
      clearedSlot,
    };
  }

  unequip(slot: EquipmentSlotR35): EquipmentResultR35 {
    const current = this.#equipped.get(slot);
    if (!current) {
      return {
        ok: false,
        slot,
        reason: 'slot is already empty',
      };
    }
    this.#equipped.delete(slot);
    return {
      ok: true,
      slot,
      definitionId: current.definitionId,
      replaced: { ...current },
    };
  }

  isEquipped(definitionId: string): boolean {
    return [...this.#equipped.values()].some(
      (entry) => entry.definitionId === definitionId,
    );
  }

  findByItem(itemId: string): readonly EquippedEntryR35[] {
    return [...this.#equipped.values()]
      .filter((entry) => entry.itemId === itemId)
      .map((entry) => ({ ...entry }));
  }

  repair(instanceId: string, amount: number): boolean {
    if (!Number.isFinite(amount) || amount <= 0) return false;
    for (const slot of SLOTS) {
      const current = this.#equipped.get(slot);
      if (!current || current.instanceId !== instanceId) continue;
      this.#equipped.set(slot, {
        ...current,
        durability: clamp(current.durability + amount, 0, 1),
      });
      return true;
    }
    return false;
  }

  damage(instanceId: string, amount: number): EquipmentResultR35 {
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, slot: 'mainHand', reason: 'invalid damage' };
    }

    for (const slot of SLOTS) {
      const current = this.#equipped.get(slot);
      if (!current || current.instanceId !== instanceId) continue;
      const durability = clamp(current.durability - amount, 0, 1);
      if (durability <= 0) {
        this.#equipped.delete(slot);
        return {
          ok: true,
          slot,
          definitionId: current.definitionId,
          reason: 'equipment broke',
        };
      }
      this.#equipped.set(slot, { ...current, durability });
      return {
        ok: true,
        slot,
        definitionId: current.definitionId,
      };
    }

    return {
      ok: false,
      slot: 'mainHand',
      reason: 'equipment instance not found',
    };
  }

  modifier(stat: EquipmentStatR35): number {
    let value = 0;
    for (const entry of this.#equipped.values()) {
      const definition = this.#definitions.get(entry.definitionId);
      if (!definition) continue;
      const durabilityScale = 0.4 + entry.durability * 0.6;
      value += safeNumber(definition.modifiers[stat], 0) * durabilityScale;
    }
    return Number(value.toFixed(6));
  }

  get derivedStats(): EquipmentDerivedStatsR35 {
    const result = {} as EquipmentBaseStatsR35;
    for (const stat of STATS) {
      const base = safeNumber(this.#baseStats[stat], 0);
      const modifier = this.modifier(stat);
      if (stat === 'crit') {
        result[stat] = clamp(base + modifier, 0, 1);
      } else {
        result[stat] = Math.max(0, base + modifier);
      }
    }

    const rating =
      result.health * 0.18 +
      result.stamina * 0.08 +
      result.mana * 0.08 +
      result.armor * 1.2 +
      result.power * 1.5 +
      result.speed * 2 +
      result.crit * 100 +
      result.poise * 0.7 +
      result.luck +
      result.carry * 0.12 +
      (result.fireResist + result.iceResist + result.waterResist + result.natureResist) * 0.5;

    return {
      ...result,
      rating: Number(rating.toFixed(3)),
      loadFactor: 0,
    };
  }

  loadFactor(currentWeight: number): number {
    const carry = Math.max(1, this.derivedStats.carry);
    return clamp(currentWeight / carry, 0, 1);
  }

  getEffectiveStats(currentWeight = 0): EquipmentDerivedStatsR35 {
    const stats = this.derivedStats;
    return {
      ...stats,
      loadFactor: Number(this.loadFactor(currentWeight).toFixed(6)),
      speed: Number(
        (stats.speed * (1 - Math.max(0, this.loadFactor(currentWeight) - 0.75))).toFixed(6),
      ),
    };
  }

  snapshot(): EquipmentSnapshotR35 {
    return {
      version: 1,
      ownerId: this.ownerId,
      level: this.#level,
      equipped: this.equipped,
    };
  }

  restore(snapshot: EquipmentSnapshotR35): void {
    if (snapshot.version !== 1) throw new Error('unsupported equipment snapshot');
    if (snapshot.ownerId !== this.ownerId) throw new Error('equipment owner mismatch');
    this.#level = Math.max(1, Math.floor(snapshot.level));
    this.#equipped.clear();

    for (const slot of SLOTS) {
      const entry = snapshot.equipped[slot];
      if (!entry) continue;
      const definition = this.#definitions.get(entry.definitionId);
      if (!definition || definition.slot !== slot) {
        throw new Error('invalid equipment snapshot entry');
      }
      if (entry.itemId !== definition.itemId) {
        throw new Error('equipment item id mismatch');
      }
      if (!entry.instanceId.trim()) throw new Error('equipment instance id missing');
      if (entry.durability <= 0) continue;
      this.#equipped.set(slot, {
        ...entry,
        durability: clamp(entry.durability, 0, 1),
      });
    }

    const main = this.#equipped.get('mainHand');
    if (main && this.#definitions.get(main.definitionId)?.twoHanded) {
      this.#equipped.delete('offHand');
    }
  }

  compare(snapshot: EquipmentSnapshotR35): readonly string[] {
    const changes: string[] = [];
    for (const slot of SLOTS) {
      const before = snapshot.equipped[slot];
      const after = this.#equipped.get(slot);
      const beforeId = before?.definitionId ?? 'empty';
      const afterId = after?.definitionId ?? 'empty';
      if (beforeId !== afterId) {
        changes.push(slot + ':' + beforeId + '->' + afterId);
      }
      if (
        before &&
        after &&
        Math.abs(before.durability - after.durability) > 0.001
      ) {
        changes.push(slot + ':durability');
      }
    }
    return changes;
  }
}
