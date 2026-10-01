import { describe, expect, it } from 'vitest';
import type { EntityId } from '../../src/3d/modern/types.ts';
import {
  InventoryAuthorityR35,
  type InventoryItemDefinition,
} from '../../src/3d/modern/gameplay/inventoryAuthorityR35.ts';
import {
  EquipmentAuthorityR35,
  type EquipmentDefinitionR35,
} from '../../src/3d/modern/gameplay/equipmentAuthorityR35.ts';
import {
  AbilityAuthorityR35,
  type AbilityDefinitionR35,
} from '../../src/3d/modern/gameplay/abilityAuthorityR35.ts';
import {
  InteractionAuthorityR35,
  type InteractionActorR35,
  type InteractionDefinitionR35,
  type InteractionTargetR35,
} from '../../src/3d/modern/gameplay/interactionAuthorityR35.ts';
import {
  DialogueAuthorityR35,
  type DialogueGraphR35,
} from '../../src/3d/modern/gameplay/dialogueAuthorityR35.ts';
import { GameplaySessionAuthorityR35 } from '../../src/3d/modern/gameplay/gameplaySessionAuthorityR35.ts';
import {
  GameplayPersistenceR35,
  MemorySaveStorageR35,
} from '../../src/3d/modern/gameplay/gameplayPersistenceR35.ts';

const player = 'player-r35' as EntityId;
const npc = 'npc-r35' as EntityId;

const sword: InventoryItemDefinition = {
  id: 'iron-sword',
  name: 'Iron Sword',
  kind: 'weapon',
  maxStack: 1,
  weight: 8,
  value: 40,
  tags: ['metal', 'weapon'],
  unique: true,
  usable: false,
};

const potion: InventoryItemDefinition = {
  id: 'healing-potion',
  name: 'Healing Potion',
  kind: 'consumable',
  maxStack: 10,
  weight: 0.5,
  value: 12,
  tags: ['healing'],
  unique: false,
  usable: true,
};

const shield: InventoryItemDefinition = {
  id: 'wood-shield',
  name: 'Wood Shield',
  kind: 'armor',
  maxStack: 1,
  weight: 6,
  value: 35,
  tags: ['shield'],
  unique: false,
  usable: false,
};

const swordEquip: EquipmentDefinitionR35 = {
  id: 'iron-sword-equip',
  itemId: 'iron-sword',
  slot: 'mainHand',
  modifiers: {
    power: 12,
    crit: 0.03,
    poise: 2,
  },
  tags: ['metal'],
};

const shieldEquip: EquipmentDefinitionR35 = {
  id: 'wood-shield-equip',
  itemId: 'wood-shield',
  slot: 'offHand',
  modifiers: {
    armor: 10,
    poise: 4,
    iceResist: 0.05,
  },
  tags: ['shield'],
};

const greatSwordEquip: EquipmentDefinitionR35 = {
  id: 'great-sword-equip',
  itemId: 'great-sword',
  slot: 'mainHand',
  twoHanded: true,
  modifiers: {
    power: 25,
    poise: 5,
  },
  tags: ['greatsword'],
};

describe('R35 inventory authority', () => {
  function createInventory(): InventoryAuthorityR35 {
    const inventory = new InventoryAuthorityR35({
      ownerId: player,
      capacity: 4,
      maxWeight: 20,
      quickSlotCount: 2,
    });
    inventory.registerMany([sword, potion, shield]);
    return inventory;
  }

  it('adds and merges stackable items deterministically', () => {
    const inventory = createInventory();

    expect(inventory.add('healing-potion', 7).ok).toBe(true);
    expect(inventory.add('healing-potion', 3).ok).toBe(true);
    expect(inventory.count('healing-potion')).toBe(10);
    expect(inventory.usedSlotCount).toBe(1);
    expect(inventory.totalWeight).toBe(5);

    const slot = inventory.slots[0];
    expect(slot?.item?.quantity).toBe(10);
  });

  it('rejects unique duplicates and preserves state', () => {
    const inventory = createInventory();

    const first = inventory.add('iron-sword', 1);
    const second = inventory.add('iron-sword', 1);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(inventory.count('iron-sword')).toBe(1);
    expect(inventory.usedSlotCount).toBe(1);
  });

  it('rejects additions that exceed weight', () => {
    const inventory = createInventory();
    expect(inventory.add('healing-potion', 10).ok).toBe(true);
    expect(inventory.add('wood-shield', 1).ok).toBe(true);
    expect(inventory.add('iron-sword', 1).ok).toBe(false);
    expect(inventory.totalWeight).toBe(11);
  });

  it('moves and merges slots', () => {
    const inventory = createInventory();
    inventory.add('healing-potion', 4);
    inventory.add('healing-potion', 3);

    const result = inventory.move(0, 1);
    expect(result.ok).toBe(true);
    expect(inventory.count('healing-potion')).toBe(7);
    expect(inventory.slots[0]?.item).toBeNull();
    expect(inventory.slots[1]?.item?.quantity).toBe(7);
  });

  it('splits stackable items to an empty slot', () => {
    const inventory = createInventory();
    inventory.add('healing-potion', 8);

    const result = inventory.split(0, 3);
    expect(result.ok).toBe(true);
    expect(inventory.count('healing-potion')).toBe(8);
    expect(inventory.slots[0]?.item?.quantity).toBe(5);
    expect(inventory.slots[1]?.item?.quantity).toBe(3);
  });

  it('tracks quick slots and invalidates them after clear', () => {
    const inventory = createInventory();
    inventory.add('healing-potion', 2);
    expect(inventory.setQuickSlot(0, 0)).toBe(true);
    expect(inventory.resolveQuickSlot(0)?.item?.itemId).toBe('healing-potion');

    inventory.clear();
    expect(inventory.resolveQuickSlot(0)).toBeNull();
    expect(inventory.quickSlots).toEqual([-1, -1]);
  });

  it('restores a valid snapshot exactly', () => {
    const inventory = createInventory();
    inventory.add('healing-potion', 6);
    inventory.setQuickSlot(0, 0);
    const snapshot = inventory.snapshot();

    inventory.clear();
    expect(inventory.count('healing-potion')).toBe(0);

    inventory.restore(snapshot);
    expect(inventory.count('healing-potion')).toBe(6);
    expect(inventory.resolveQuickSlot(0)?.item?.quantity).toBe(6);
  });

  it('compacts occupied slots without changing total quantity', () => {
    const inventory = createInventory();
    inventory.add('healing-potion', 2);
    inventory.add('wood-shield', 1);
    inventory.move(1, 3);
    const before = inventory.count('healing-potion') + inventory.count('wood-shield');

    inventory.compact();

    const after = inventory.count('healing-potion') + inventory.count('wood-shield');
    expect(after).toBe(before);
    expect(inventory.slots[0]?.item?.itemId).toBe('healing-potion');
    expect(inventory.slots[1]?.item?.itemId).toBe('wood-shield');
  });
});

describe('R35 equipment authority', () => {
  function createEquipment(): EquipmentAuthorityR35 {
    const equipment = new EquipmentAuthorityR35(player, {
      level: 10,
      baseStats: {
        health: 120,
        armor: 5,
        power: 14,
        carry: 120,
      },
    });
    equipment.registerMany([swordEquip, shieldEquip, greatSwordEquip]);
    return equipment;
  }

  it('equips items and derives deterministic stats', () => {
    const equipment = createEquipment();
    const result = equipment.equip('iron-sword-equip', 'sword-instance');

    expect(result.ok).toBe(true);
    expect(equipment.isEquipped('iron-sword-equip')).toBe(true);
    expect(equipment.derivedStats.power).toBeGreaterThan(14);
    expect(equipment.derivedStats.rating).toBeGreaterThan(0);
  });

  it('prevents off-hand use with an active two-handed weapon', () => {
    const equipment = createEquipment();
    equipment.equip('great-sword-equip', 'great-instance');

    const result = equipment.equip('wood-shield-equip', 'shield-instance');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('two-handed');
  });

  it('clears an off-hand item when equipping a two-handed main hand', () => {
    const equipment = createEquipment();
    equipment.equip('wood-shield-equip', 'shield-instance');

    const result = equipment.equip('great-sword-equip', 'great-instance');
    expect(result.ok).toBe(true);
    expect(result.clearedSlot).toBe('offHand');
    expect(equipment.equipped.offHand).toBeUndefined();
  });

  it('scales modifiers with durability', () => {
    const equipment = createEquipment();
    equipment.equip('iron-sword-equip', 'sword-instance', 1);
    const healthyPower = equipment.derivedStats.power;

    equipment.damage('sword-instance', 0.5);
    const damagedPower = equipment.derivedStats.power;

    expect(damagedPower).toBeLessThan(healthyPower);
    expect(damagedPower).toBeGreaterThan(14);
  });

  it('breaks equipment at zero durability', () => {
    const equipment = createEquipment();
    equipment.equip('iron-sword-equip', 'sword-instance', 0.2);

    const broken = equipment.damage('sword-instance', 0.4);
    expect(broken.ok).toBe(true);
    expect(broken.reason).toBe('equipment broke');
    expect(equipment.isEquipped('iron-sword-equip')).toBe(false);
  });

  it('persists and compares loadouts', () => {
    const equipment = createEquipment();
    equipment.equip('iron-sword-equip', 'sword-instance');
    const snapshot = equipment.snapshot();

    equipment.unequip('mainHand');
    expect(equipment.compare(snapshot)).toContain('mainHand:iron-sword-equip->empty');

    equipment.restore(snapshot);
    expect(equipment.isEquipped('iron-sword-equip')).toBe(true);
    expect(equipment.compare(snapshot)).toEqual([]);
  });
});

describe('R35 ability authority', () => {
  function createAbilities(): AbilityAuthorityR35 {
    const abilities = new AbilityAuthorityR35(player);
    const sprint: AbilityDefinitionR35 = {
      id: 'combat-sprint',
      name: 'Combat Sprint',
      cooldown: 4,
      globalCooldown: 0.25,
      costs: [{ resource: 'stamina', amount: 20 }],
      effects: [
        {
          id: 'haste',
          kind: 'haste',
          duration: 3,
          magnitude: 0.2,
          maxStacks: 2,
        },
      ],
      tags: ['movement', 'combat'],
    };
    const fireball: AbilityDefinitionR35 = {
      id: 'fireball',
      name: 'Fireball',
      cooldown: 5,
      charges: 2,
      recharge: 2,
      costs: [{ resource: 'mana', amount: 10 }],
      prerequisites: [{ kind: 'level', value: 3 }],
      effects: [
        {
          id: 'burn',
          kind: 'damageOverTime',
          duration: 4,
          magnitude: 5,
        },
      ],
      tags: ['magic', 'fire'],
    };
    abilities.registerMany([sprint, fireball]);
    return abilities;
  }

  it('spends resources and applies effects', () => {
    const abilities = createAbilities();
    const resources = { health: 100, stamina: 60, mana: 30 };

    const result = abilities.cast('combat-sprint', {
      level: 5,
      resources,
      unlockedAbilities: new Set(),
      tags: new Set(['movement', 'combat']),
    });

    expect(result.ok).toBe(true);
    expect(resources.stamina).toBe(40);
    expect(abilities.hasEffect('haste')).toBe(true);
  });

  it('enforces cooldown and global cooldown', () => {
    const abilities = createAbilities();
    const resources = { health: 100, stamina: 100, mana: 30 };
    const context = {
      level: 5,
      resources,
      unlockedAbilities: new Set<string>(),
      tags: new Set(['movement', 'combat']),
    };

    expect(abilities.cast('combat-sprint', context).ok).toBe(true);
    expect(abilities.cast('combat-sprint', context).ok).toBe(false);

    abilities.tick(0.25);
    expect(abilities.cast('combat-sprint', context).ok).toBe(false);
    abilities.tick(3.75);
    expect(abilities.cast('combat-sprint', context).ok).toBe(true);
  });

  it('handles charges and recharge independently from cooldown', () => {
    const abilities = createAbilities();
    const resources = { health: 100, stamina: 100, mana: 40 };
    const context = {
      level: 5,
      resources,
      unlockedAbilities: new Set<string>(),
      tags: new Set(['magic']),
    };

    expect(abilities.cast('fireball', context).ok).toBe(true);
    expect(abilities.cast('fireball', context).ok).toBe(false);

    abilities.tick(5);
    const state = abilities.getState('fireball');
    expect(state?.charges).toBeGreaterThanOrEqual(1);

    abilities.tick(2);
    expect(abilities.getState('fireball')?.charges).toBe(2);
  });

  it('rejects insufficient resources without consuming anything', () => {
    const abilities = createAbilities();
    const resources = { health: 100, stamina: 5, mana: 30 };
    const result = abilities.cast('combat-sprint', {
      level: 5,
      resources,
      unlockedAbilities: new Set(),
      tags: new Set(['movement', 'combat']),
    });

    expect(result.ok).toBe(false);
    expect(resources.stamina).toBe(5);
  });

  it('restores snapshots and clears cooldown state deterministically', () => {
    const abilities = createAbilities();
    const resources = { health: 100, stamina: 100, mana: 30 };
    const context = {
      level: 5,
      resources,
      unlockedAbilities: new Set<string>(),
      tags: new Set(['magic']),
    };

    abilities.cast('fireball', context);
    const snapshot = abilities.snapshot();
    abilities.restore(snapshot);

    expect(abilities.snapshot()).toEqual(snapshot);
  });

  it('expires status effects on simulation time', () => {
    const abilities = createAbilities();
    const resources = { health: 100, stamina: 60, mana: 30 };

    abilities.cast('combat-sprint', {
      level: 5,
      resources,
      unlockedAbilities: new Set(),
      tags: new Set(['movement', 'combat']),
    });

    expect(abilities.hasEffect('haste')).toBe(true);
    abilities.tick(3);
    expect(abilities.hasEffect('haste')).toBe(false);
  });
});

describe('R35 interaction authority', () => {
  const actor: InteractionActorR35 = {
    entityId: player,
    position: { x: 0, y: 0, z: 0 },
    tags: new Set(['player']),
  };

  function createInteractions(): {
    authority: InteractionAuthorityR35;
    targets: InteractionTargetR35[];
  } {
    const authority = new InteractionAuthorityR35();

    const pickup: InteractionDefinitionR35 = {
      id: 'pickup',
      kind: 'pickup',
      label: 'Pick up',
      range: 3,
      priority: 2,
      cooldown: 1,
      requiredTags: ['player'],
    };

    const talk: InteractionDefinitionR35 = {
      id: 'talk',
      kind: 'talk',
      label: 'Talk',
      range: 5,
      priority: 3,
      cooldown: 0.5,
      requiredTags: ['player'],
    };

    const targets: InteractionTargetR35[] = [
      {
        id: 'item-a',
        entityId: npc,
        position: { x: 2, y: 0, z: 0 },
        definitionId: pickup.id,
        state: { itemId: 'healing-potion' },
      },
      {
        id: 'npc-a',
        entityId: npc,
        position: { x: 4, y: 0, z: 0 },
        definitionId: talk.id,
        state: { name: 'merchant' },
      },
    ];

    authority.registerDefinition(pickup);
    authority.registerDefinition(talk);
    targets.forEach((target) => authority.registerTarget(target));
    return { authority, targets };
  }

  it('orders candidates by priority, distance and id', () => {
    const { authority } = createInteractions();
    const candidates = authority.query(actor, 8);

    expect(candidates).toHaveLength(2);
    expect(candidates[0]?.targetId).toBe('npc-a');
    expect(candidates[1]?.targetId).toBe('item-a');
  });

  it('rejects targets outside interaction range', () => {
    const { authority, targets } = createInteractions();
    authority.updateTarget(targets[0].id, {
      position: { x: 20, y: 0, z: 0 },
    });

    expect(authority.nearest(actor)?.targetId).toBe('npc-a');
  });

  it('applies repeatable target cooldown', () => {
    const { authority } = createInteractions();

    expect(authority.execute(actor, 'npc-a').ok).toBe(true);
    expect(authority.execute(actor, 'npc-a').ok).toBe(false);

    authority.tick(0.5);
    expect(authority.execute(actor, 'npc-a').ok).toBe(true);
  });

  it('supports one-shot targets', () => {
    const authority = new InteractionAuthorityR35();
    authority.registerDefinition({
      id: 'open-once',
      kind: 'open',
      label: 'Open',
      range: 2,
      repeatable: false,
    });
    authority.registerTarget({
      id: 'chest',
      entityId: npc,
      position: { x: 1, y: 0, z: 0 },
      definitionId: 'open-once',
      state: {},
    });

    expect(authority.execute(actor, 'chest').ok).toBe(true);
    expect(authority.execute(actor, 'chest').ok).toBe(false);
  });

  it('restores cooldown state from a snapshot', () => {
    const { authority } = createInteractions();
    authority.execute(actor, 'npc-a');
    const snapshot = authority.snapshot();

    authority.tick(1);
    authority.restore(snapshot);

    expect(authority.cooldownFor('npc-a', 'talk')).toBeGreaterThan(0);
  });
});

describe('R35 dialogue authority', () => {
  const graph: DialogueGraphR35 = {
    id: 'merchant-greeting',
    start: 'start',
    nodes: [
      {
        id: 'start',
        speaker: npc,
        text: 'Welcome.',
        choices: [
          {
            id: 'friendly',
            text: 'Hello.',
            next: 'friendly',
            priority: 2,
            effects: [
              { kind: 'set', key: 'mood', value: 'friendly' },
              { kind: 'increment', key: 'greetings', amount: 1 },
            ],
          },
          {
            id: 'leave',
            text: 'Leave.',
            next: null,
            priority: 1,
          },
        ],
      },
      {
        id: 'friendly',
        speaker: npc,
        text: 'A pleasure to meet you.',
        next: 'trade',
        conditions: [
          { kind: 'variable', key: 'mood', operator: 'eq', value: 'friendly' },
        ],
        enterEffects: [
          { kind: 'tag', tag: 'met-merchant', enabled: true },
        ],
      },
      {
        id: 'trade',
        speaker: npc,
        text: 'Take a look at my wares.',
        choices: [
          {
            id: 'buy',
            text: 'Show me the potion.',
            next: null,
            once: true,
            conditions: [
              { kind: 'item', itemId: 'gold', minimum: 10 },
            ],
            effects: [
              { kind: 'event', event: 'dialogue:merchant:buy-intent' },
            ],
          },
        ],
      },
    ],
  };

  it('starts on the configured node and exposes choices', () => {
    const dialogue = new DialogueAuthorityR35();
    dialogue.register(graph);

    const context = {
      items: new Map([['gold', 20]]),
      quests: new Map(),
      tags: new Set<string>(),
    };

    const start = dialogue.start('merchant-greeting', context);
    expect(start.ok).toBe(true);
    expect(start.node?.id).toBe('start');
    expect(dialogue.availableChoices(context).map((choice) => choice.id)).toEqual([
      'friendly',
      'leave',
    ]);
  });

  it('applies choice effects and follows the graph', () => {
    const dialogue = new DialogueAuthorityR35();
    dialogue.register(graph);

    const context = {
      items: new Map([['gold', 20]]),
      quests: new Map(),
      tags: new Set<string>(),
    };

    dialogue.start('merchant-greeting', context);
    const next = dialogue.select('friendly', context);

    expect(next.ok).toBe(true);
    expect(next.node?.id).toBe('friendly');
    expect(dialogue.variables.mood).toBe('friendly');
    expect(dialogue.variables.greetings).toBe(1);
    expect(dialogue.variables['tag.met-merchant']).toBe(true);
  });

  it('requires a choice on branching nodes', () => {
    const dialogue = new DialogueAuthorityR35();
    dialogue.register(graph);

    const context = {
      items: new Map([['gold', 20]]),
      quests: new Map(),
      tags: new Set<string>(),
    };

    dialogue.start('merchant-greeting', context);
    const result = dialogue.advance(context);

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('choice');
  });

  it('enforces item conditions on choices', () => {
    const dialogue = new DialogueAuthorityR35();
    dialogue.register(graph);

    const context = {
      items: new Map([['gold', 5]]),
      quests: new Map(),
      tags: new Set<string>(),
    };

    dialogue.start('merchant-greeting', context);
    dialogue.select('friendly', context);
    dialogue.advance(context);

    expect(dialogue.availableChoices(context)).toHaveLength(0);
  });

  it('persists and restores a dialogue state', () => {
    const dialogue = new DialogueAuthorityR35();
    dialogue.register(graph);

    const context = {
      items: new Map([['gold', 20]]),
      quests: new Map(),
      tags: new Set<string>(),
    };

    dialogue.start('merchant-greeting', context);
    dialogue.select('friendly', context);
    const snapshot = dialogue.snapshot();

    dialogue.stop();
    dialogue.restore(snapshot);

    expect(dialogue.currentNode?.id).toBe('friendly');
    expect(dialogue.variables).toEqual(snapshot.variables);
    expect(dialogue.visitedNodes).toContain('friendly');
  });
});

describe('R35 gameplay session and persistence', () => {
  function createSession(): GameplaySessionAuthorityR35 {
    const session = new GameplaySessionAuthorityR35({
      entityId: player,
      level: 4,
      resources: {
        health: 100,
        stamina: 80,
        mana: 25,
      },
      tags: ['player', 'fighter'],
      position: { x: 10, y: 3, z: -5 },
    });

    session.registerItems([sword, potion, shield]);
    session.registerEquipment([swordEquip, shieldEquip]);
    session.registerAbilities([
      {
        id: 'heal',
        name: 'Heal',
        cooldown: 2,
        costs: [{ resource: 'mana', amount: 5 }],
        effects: [
          {
            id: 'regen',
            kind: 'healOverTime',
            duration: 2,
            magnitude: 8,
          },
        ],
        tags: ['magic'],
      },
    ]);

    session.registerInteractions(
      [
        {
          id: 'rest',
          kind: 'rest',
          label: 'Rest',
          range: 3,
          priority: 5,
          requiredTags: ['player'],
        },
      ],
      [
        {
          id: 'campfire',
          entityId: npc,
          position: { x: 11, y: 3, z: -5 },
          definitionId: 'rest',
          state: {},
        },
      ],
    );

    return session;
  }

  it('executes gameplay commands through one surface', () => {
    const session = createSession();

    expect(session.execute({
      kind: 'addItem',
      itemId: 'healing-potion',
      quantity: 3,
    }).ok).toBe(true);

    expect(session.execute({
      kind: 'castAbility',
      abilityId: 'heal',
    }).ok).toBe(true);

    expect(session.resources.mana).toBe(20);

    expect(session.execute({
      kind: 'interact',
      targetId: 'campfire',
    }).ok).toBe(true);

    expect(session.execute({
      kind: 'move',
      position: { x: 0, y: 1, z: 2 },
    }).ok).toBe(true);

    expect(session.position).toEqual({ x: 0, y: 1, z: 2 });
  });

  it('levels up using deterministic experience thresholds', () => {
    const session = createSession();
    const required = session.experienceForNextLevel();

    session.execute({
      kind: 'gainExperience',
      amount: required,
    });

    expect(session.level).toBe(5);
  });

  it('produces stable digests for unchanged snapshots', () => {
    const session = createSession();
    const digestA = session.deterministicDigest();
    const digestB = session.deterministicDigest();

    expect(digestA).toBe(digestB);
  });

  it('round-trips a full gameplay session through memory persistence', () => {
    const session = createSession();
    session.addItem('healing-potion', 5);
    session.equip('iron-sword-equip', 'sword-instance');
    session.castAbility('heal');

    const storage = new MemorySaveStorageR35();
    const persistence = new GameplayPersistenceR35(storage);
    const saved = persistence.save(2, 120, session.snapshot());

    expect(persistence.verify(persistence.exportSlot(2)!)).toBe(true);
    expect(persistence.listSlots()).toEqual([2]);

    const loaded = persistence.load(2);
    expect(loaded).not.toBeNull();
    expect(persistence.summarize(saved).itemCount).toBe(5);
    expect(persistence.summarize(saved).equippedCount).toBe(1);
  });

  it('detects tampered payloads', () => {
    const session = createSession();
    const persistence = new GameplayPersistenceR35();
    const envelope = persistence.encode(1, 10, session.snapshot());
    const serialized = persistence.serialize(envelope);
    const tampered = serialized.replace('"experience":0', '"experience":999');

    expect(persistence.verify(tampered)).toBe(false);
  });

  it('duplicates saves to a different slot with identical gameplay payload', () => {
    const session = createSession();
    session.addItem('healing-potion', 2);

    const persistence = new GameplayPersistenceR35();
    persistence.save(1, 50, session.snapshot());

    const duplicate = persistence.duplicate(1, 3);
    expect(duplicate?.slot).toBe(3);
    expect(persistence.listSlots()).toEqual([1, 3]);
    expect(duplicate?.payload.player.position).toEqual(session.position);
  });
});
