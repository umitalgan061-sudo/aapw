/**
 * R35 gameplay session composition root.
 *
 * Owns the player-facing gameplay state and presents one deterministic command
 * surface to the rest of the runtime. Rendering, networking and UI can consume
 * the snapshots without reaching into individual systems.
 */
import type { EntityId, Vec3 } from '../types.ts';
import {
  InventoryAuthorityR35,
  type InventoryItemDefinition,
  type InventorySnapshotR35,
} from './inventoryAuthorityR35.ts';
import {
  EquipmentAuthorityR35,
  type EquipmentDefinitionR35,
  type EquipmentSnapshotR35,
  type EquipmentBaseStatsR35,
} from './equipmentAuthorityR35.ts';
import {
  AbilityAuthorityR35,
  type AbilityDefinitionR35,
  type AbilitySnapshotR35,
  type AbilityContextR35,
  type MutableResourcesR35,
} from './abilityAuthorityR35.ts';
import {
  InteractionAuthorityR35,
  type InteractionDefinitionR35,
  type InteractionSnapshotR35,
  type InteractionTargetR35,
  type InteractionActorR35,
  type InteractionCandidateR35,
  type InteractionExecutionR35,
} from './interactionAuthorityR35.ts';
import {
  DialogueAuthorityR35,
  type DialogueGraphR35,
  type DialogueSnapshotR35,
  type DialogueContextR35,
  type DialogueAdvanceR35,
} from './dialogueAuthorityR35.ts';

export interface GameplayPlayerStateR35 {
  readonly entityId: EntityId;
  readonly level: number;
  readonly experience: number;
  readonly resources: Readonly<MutableResourcesR35>;
  readonly tags: readonly string[];
  readonly position: Vec3;
}

export interface GameplaySessionSnapshotR35 {
  readonly version: 1;
  readonly player: GameplayPlayerStateR35;
  readonly inventory: InventorySnapshotR35;
  readonly equipment: EquipmentSnapshotR35;
  readonly abilities: AbilitySnapshotR35;
  readonly interactions: InteractionSnapshotR35;
  readonly dialogue: DialogueSnapshotR35;
}

export interface GameplaySessionConfigR35 {
  readonly entityId: EntityId;
  readonly level?: number;
  readonly experience?: number;
  readonly position?: Vec3;
  readonly resources?: Partial<MutableResourcesR35>;
  readonly tags?: readonly string[];
  readonly baseStats?: Partial<EquipmentBaseStatsR35>;
  readonly inventoryCapacity?: number;
  readonly inventoryWeight?: number;
}

export type GameplayCommandR35 =
  | {
      readonly kind: 'addItem';
      readonly itemId: string;
      readonly quantity: number;
    }
  | {
      readonly kind: 'removeItem';
      readonly itemId: string;
      readonly quantity: number;
    }
  | {
      readonly kind: 'equip';
      readonly definitionId: string;
      readonly instanceId: string;
    }
  | {
      readonly kind: 'unequip';
      readonly slot: Parameters<EquipmentAuthorityR35['unequip']>[0];
    }
  | {
      readonly kind: 'castAbility';
      readonly abilityId: string;
    }
  | {
      readonly kind: 'interact';
      readonly targetId: string;
    }
  | {
      readonly kind: 'move';
      readonly position: Vec3;
    }
  | {
      readonly kind: 'gainExperience';
      readonly amount: number;
    };

export interface GameplayCommandResultR35 {
  readonly ok: boolean;
  readonly command: GameplayCommandR35['kind'];
  readonly message: string;
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clonePosition(position: Vec3): Vec3 {
  return {
    x: finite(position.x, 0),
    y: finite(position.y, 0),
    z: finite(position.z, 0),
  };
}

export class GameplaySessionAuthorityR35 {
  readonly entityId: EntityId;
  readonly inventory: InventoryAuthorityR35;
  readonly equipment: EquipmentAuthorityR35;
  readonly abilities: AbilityAuthorityR35;
  readonly interactions: InteractionAuthorityR35;
  readonly dialogue: DialogueAuthorityR35;

  #level: number;
  #experience: number;
  #resources: MutableResourcesR35;
  #tags = new Set<string>();
  #position: Vec3;

  constructor(config: GameplaySessionConfigR35) {
    this.entityId = config.entityId;
    this.#level = Math.max(1, Math.floor(config.level ?? 1));
    this.#experience = Math.max(0, finite(config.experience ?? 0, 0));
    this.#resources = {
      health: Math.max(0, finite(config.resources?.health ?? 100, 100)),
      stamina: Math.max(0, finite(config.resources?.stamina ?? 100, 100)),
      mana: Math.max(0, finite(config.resources?.mana ?? 50, 50)),
    };
    this.#tags = new Set(
      (config.tags ?? [])
        .map((tag) => tag.trim())
        .filter(Boolean),
    );
    this.#position = clonePosition(config.position ?? { x: 0, y: 0, z: 0 });

    this.inventory = new InventoryAuthorityR35({
      ownerId: this.entityId,
      capacity: config.inventoryCapacity ?? 36,
      maxWeight: config.inventoryWeight ?? 180,
    });
    this.equipment = new EquipmentAuthorityR35(this.entityId, {
      level: this.#level,
      baseStats: config.baseStats,
    });
    this.abilities = new AbilityAuthorityR35(this.entityId);
    this.interactions = new InteractionAuthorityR35();
    this.dialogue = new DialogueAuthorityR35();
  }

  get player(): GameplayPlayerStateR35 {
    return {
      entityId: this.entityId,
      level: this.#level,
      experience: this.#experience,
      resources: { ...this.#resources },
      tags: [...this.#tags].sort(),
      position: clonePosition(this.#position),
    };
  }

  get position(): Vec3 {
    return clonePosition(this.#position);
  }

  get level(): number {
    return this.#level;
  }

  get experience(): number {
    return this.#experience;
  }

  get resources(): Readonly<MutableResourcesR35> {
    return { ...this.#resources };
  }

  get tags(): readonly string[] {
    return [...this.#tags].sort();
  }

  registerItems(definitions: readonly InventoryItemDefinition[]): void {
    this.inventory.registerMany(definitions);
  }

  registerEquipment(definitions: readonly EquipmentDefinitionR35[]): void {
    this.equipment.registerMany(definitions);
  }

  registerAbilities(definitions: readonly AbilityDefinitionR35[]): void {
    this.abilities.registerMany(definitions);
  }

  registerInteractions(
    definitions: readonly InteractionDefinitionR35[],
    targets: readonly InteractionTargetR35[],
  ): void {
    for (const definition of definitions) {
      this.interactions.registerDefinition(definition);
    }
    for (const target of targets) {
      this.interactions.registerTarget(target);
    }
  }

  registerDialogues(graphs: readonly DialogueGraphR35[]): void {
    this.dialogue.registerMany(graphs);
  }

  setTag(tag: string, enabled: boolean): void {
    const normalized = tag.trim();
    if (!normalized) return;
    if (enabled) this.#tags.add(normalized);
    else this.#tags.delete(normalized);
  }

  moveTo(position: Vec3): void {
    this.#position = clonePosition(position);
  }

  gainExperience(amount: number): number {
    const gain = Math.max(0, finite(amount, 0));
    this.#experience += gain;

    while (this.#experience >= this.experienceForNextLevel()) {
      this.#experience -= this.experienceForNextLevel();
      this.#level += 1;
      this.equipment.setLevel(this.#level);
    }

    return this.#level;
  }

  experienceForNextLevel(): number {
    const level = Math.max(1, this.#level);
    return Math.floor(100 * Math.pow(level, 1.35));
  }

  actor(): InteractionActorR35 {
    return {
      entityId: this.entityId,
      position: this.position,
      tags: new Set(this.#tags),
    };
  }

  interactionCandidates(limit = 8): readonly InteractionCandidateR35[] {
    return this.interactions.query(this.actor(), limit);
  }

  interact(targetId: string): InteractionExecutionR35 {
    return this.interactions.execute(this.actor(), targetId);
  }

  startDialogue(
    graphId: string,
    context: DialogueContextR35,
  ): DialogueAdvanceR35 {
    return this.dialogue.start(graphId, context);
  }

  advanceDialogue(context: DialogueContextR35): DialogueAdvanceR35 {
    return this.dialogue.advance(context);
  }

  chooseDialogue(
    choiceId: string,
    context: DialogueContextR35,
  ): DialogueAdvanceR35 {
    return this.dialogue.select(choiceId, context);
  }

  private abilityContext(): AbilityContextR35 {
    return {
      level: this.#level,
      resources: this.#resources,
      unlockedAbilities: new Set(this.abilities.definitions.map((definition) => definition.id)),
      tags: new Set(this.#tags),
    };
  }

  castAbility(abilityId: string): GameplayCommandResultR35 {
    const result = this.abilities.cast(
      abilityId,
      this.abilityContext(),
      this.entityId,
    );
    return {
      ok: result.ok,
      command: 'castAbility',
      message: result.ok ? 'ability cast' : result.reason ?? 'ability rejected',
    };
  }

  addItem(itemId: string, quantity: number): GameplayCommandResultR35 {
    const result = this.inventory.add(itemId, quantity, 'gameplay');
    return {
      ok: result.ok,
      command: 'addItem',
      message: result.ok ? 'item added' : result.reason,
    };
  }

  removeItem(itemId: string, quantity: number): GameplayCommandResultR35 {
    const result = this.inventory.remove(itemId, quantity, 'gameplay');
    return {
      ok: result.ok,
      command: 'removeItem',
      message: result.ok ? 'item removed' : result.reason,
    };
  }

  equip(definitionId: string, instanceId: string): GameplayCommandResultR35 {
    const result = this.equipment.equip(
      definitionId,
      instanceId,
      1,
      {
        availableTags: new Set(this.#tags),
        level: this.#level,
      },
    );
    return {
      ok: result.ok,
      command: 'equip',
      message: result.ok ? 'equipment equipped' : result.reason ?? 'equip rejected',
    };
  }

  unequip(
    slot: Parameters<EquipmentAuthorityR35['unequip']>[0],
  ): GameplayCommandResultR35 {
    const result = this.equipment.unequip(slot);
    return {
      ok: result.ok,
      command: 'unequip',
      message: result.ok ? 'equipment unequipped' : result.reason ?? 'unequip rejected',
    };
  }

  tick(deltaSeconds: number): void {
    const delta = Math.max(
      0,
      Number.isFinite(deltaSeconds) ? deltaSeconds : 0,
    );
    this.abilities.tick(delta);
    this.interactions.tick(delta);
  }

  execute(command: GameplayCommandR35): GameplayCommandResultR35 {
    if (command.kind === 'addItem') {
      return this.addItem(command.itemId, command.quantity);
    }
    if (command.kind === 'removeItem') {
      return this.removeItem(command.itemId, command.quantity);
    }
    if (command.kind === 'equip') {
      return this.equip(command.definitionId, command.instanceId);
    }
    if (command.kind === 'unequip') {
      return this.unequip(command.slot);
    }
    if (command.kind === 'castAbility') {
      return this.castAbility(command.abilityId);
    }
    if (command.kind === 'interact') {
      const result = this.interact(command.targetId);
      return {
        ok: result.ok,
        command: 'interact',
        message: result.ok ? 'interaction executed' : result.reason ?? 'interaction rejected',
      };
    }
    if (command.kind === 'move') {
      this.moveTo(command.position);
      return { ok: true, command: 'move', message: 'position updated' };
    }
    const level = this.gainExperience(command.amount);
    return {
      ok: true,
      command: 'gainExperience',
      message: 'experience applied at level ' + level,
    };
  }

  snapshot(): GameplaySessionSnapshotR35 {
    return {
      version: 1,
      player: this.player,
      inventory: this.inventory.snapshot(),
      equipment: this.equipment.snapshot(),
      abilities: this.abilities.snapshot(),
      interactions: this.interactions.snapshot(),
      dialogue: this.dialogue.snapshot(),
    };
  }

  restore(snapshot: GameplaySessionSnapshotR35): void {
    if (snapshot.version !== 1) throw new Error('unsupported gameplay snapshot');
    if (snapshot.player.entityId !== this.entityId) throw new Error('player identity mismatch');

    this.#level = Math.max(1, Math.floor(snapshot.player.level));
    this.#experience = Math.max(0, snapshot.player.experience);
    this.#resources = {
      health: Math.max(0, snapshot.player.resources.health),
      stamina: Math.max(0, snapshot.player.resources.stamina),
      mana: Math.max(0, snapshot.player.resources.mana),
    };
    this.#tags = new Set(snapshot.player.tags);
    this.#position = clonePosition(snapshot.player.position);

    this.inventory.restore(snapshot.inventory);
    this.equipment.restore(snapshot.equipment);
    this.abilities.restore(snapshot.abilities);
    this.interactions.restore(snapshot.interactions);
    this.dialogue.restore(snapshot.dialogue);
  }

  deterministicDigest(): string {
    const payload = JSON.stringify({
      player: this.player,
      inventory: this.inventory.snapshot(),
      equipment: this.equipment.snapshot(),
      abilities: this.abilities.snapshot(),
      interactions: this.interactions.snapshot(),
      dialogue: this.dialogue.snapshot(),
    });

    let hash = 2166136261;
    for (let index = 0; index < payload.length; index += 1) {
      hash ^= payload.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }
}
