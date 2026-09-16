import { describe, expect, it } from 'vitest';
import { entityId, tickValue, stableChecksum } from '../../src/3d/modern/nextgen/types.ts';
import { DeterministicRandomStream, RandomRegistry, seededNoise2D } from '../../src/3d/modern/nextgen/deterministicRngV2.ts';
import { ActorSimulationV2, createDefaultActor } from '../../src/3d/modern/nextgen/actorSimulationV2.ts';
import { DialogueGraphV2, DialogueRuntimeV2, createDialogueNode } from '../../src/3d/modern/nextgen/dialogueRuntimeV2.ts';
import { InteractionRuntimeV2, createInteraction } from '../../src/3d/modern/nextgen/interactionRuntimeV2.ts';
import { InventoryRuntimeV2, ItemRegistryV2, defineEquipment } from '../../src/3d/modern/nextgen/inventoryRuntimeV2.ts';
import { RuntimePolicyV2 } from '../../src/3d/modern/nextgen/runtimePolicyV2.ts';
import { WorldEventJournalV2 } from '../../src/3d/modern/nextgen/worldEventJournalV2.ts';

const player = entityId(1);
const npc = entityId(2);

function position(x: number, y = 0, z = 0) { return { x, y, z }; }

describe('deterministic random stream', () => {
  it('produces identical sequences from identical seeds', () => {
    const a = new DeterministicRandomStream(1234);
    const b = new DeterministicRandomStream(1234);
    const sequenceA = Array.from({ length: 32 }, () => a.nextUint());
    const sequenceB = Array.from({ length: 32 }, () => b.nextUint());
    expect(sequenceA).toEqual(sequenceB);
    expect(a.digest()).toBe(b.digest());
  });

  it('supports snapshot and restore without advancing ambient state', () => {
    const stream = new DeterministicRandomStream(55);
    stream.nextUint();
    const snapshot = stream.snapshot();
    const first = stream.nextUint();
    const second = stream.nextUint();
    stream.restore(snapshot);
    expect(stream.nextUint()).toBe(first);
    expect(stream.nextUint()).toBe(second);
  });

  it('forks stable child streams by label', () => {
    const rootA = new DeterministicRandomStream(99);
    const rootB = new DeterministicRandomStream(99);
    const childA = rootA.fork('vegetation');
    const childB = rootB.fork('vegetation');
    expect(Array.from({ length: 20 }, () => childA.nextFloat())).toEqual(Array.from({ length: 20 }, () => childB.nextFloat()));
  });

  it('shuffles without mutating source input', () => {
    const source = [1, 2, 3, 4, 5];
    const stream = new DeterministicRandomStream(42);
    const result = stream.shuffle(source);
    expect(source).toEqual([1, 2, 3, 4, 5]);
    expect([...result].sort((a, b) => a - b)).toEqual(source);
  });

  it('registry maintains independent named streams', () => {
    const registry = new RandomRegistry(77);
    const gameplay = registry.stream('gameplay');
    const world = registry.stream('world');
    expect(gameplay).not.toBe(world);
    expect(registry.names()).toEqual(['gameplay', 'world']);
    expect(registry.stream('gameplay')).toBe(gameplay);
  });

  it('2d seeded noise is stable', () => {
    expect(seededNoise2D(12, 1.25, 4.5)).toBe(seededNoise2D(12, 1.25, 4.5));
    expect(seededNoise2D(12, 1.25, 4.5)).not.toBe(seededNoise2D(13, 1.25, 4.5));
  });
});

describe('actor simulation', () => {
  it('moves a default actor toward an explicit velocity', () => {
    const runtime = new ActorSimulationV2(42);
    const actor = createDefaultActor(player, 'player', position(0, 0, 0), { moveSpeed: 10, acceleration: 100 });
    runtime.spawn(actor);
    runtime.setIntent(player, { desiredVelocity: position(5, 0, 0) });
    runtime.step();
    const after = runtime.get(player)!;
    expect(after.position.x).toBeGreaterThan(0);
    expect(after.position.z).toBe(0);
  });

  it('selects the highest priority visible hostile target', () => {
    const runtime = new ActorSimulationV2(1);
    runtime.spawn(createDefaultActor(player, 'npc', position(0, 0, 0)));
    runtime.spawn(createDefaultActor(npc, 'creature', position(2, 0, 0)));
    runtime.setIntent(player, { mode: 'alert' });
    runtime.step([
      { id: npc, position: position(2), hostile: true, visible: true, priority: 10 },
      { id: entityId(3), position: position(3), hostile: true, visible: true, priority: 20 },
    ]);
    expect(runtime.get(player)?.intent.target).toBe(entityId(3));
  });

  it('prevents damage to dead actors and enters alert on nonlethal damage', () => {
    const runtime = new ActorSimulationV2(1);
    runtime.spawn(createDefaultActor(player, 'npc', position(0), { maxHealth: 40, health: 40 }));
    runtime.applyDamage(player, 10, npc);
    expect(runtime.get(player)?.stats.health).toBe(30);
    expect(runtime.get(player)?.mode).toBe('alert');
    runtime.applyDamage(player, 100, npc);
    expect(runtime.get(player)?.mode).toBe('dead');
    expect(runtime.applyDamage(player, 100, npc)).toBe(0);
  });

  it('is deterministic over repeated runs', () => {
    const makeRuntime = () => {
      const runtime = new ActorSimulationV2(999);
      runtime.spawn(createDefaultActor(player, 'player', position(0), { acceleration: 18 }));
      runtime.spawn(createDefaultActor(npc, 'creature', position(5), { acceleration: 13 }));
      runtime.setIntent(player, { desiredVelocity: position(3, 0, 1), sprint: true });
      return runtime;
    };
    const a = makeRuntime();
    const b = makeRuntime();
    for (let i = 0; i < 120; i += 1) { a.step(); b.step(); }
    expect(a.digest()).toBe(b.digest());
    expect(a.snapshot()).toEqual(b.snapshot());
  });
});

describe('dialogue runtime', () => {
  it('validates links and starts sessions', () => {
    const graph = new DialogueGraphV2();
    graph.registerNode(createDialogueNode('start', npc, 'Hello', { choices: [{ id: 'accept', text: 'Accept', priority: 1, next: 'end' }] }));
    graph.registerNode(createDialogueNode('end', npc, 'Goodbye'));
    graph.setStart('intro', 'start');
    const runtime = new DialogueRuntimeV2(graph);
    const session = runtime.start('intro', player, 1);
    expect(session.nodeId).toBe('start');
    expect(runtime.choices(session.id)[0]?.id).toBe('accept');
  });

  it('evaluates flags, values and inventory conditions', () => {
    const graph = new DialogueGraphV2();
    graph.registerNode(createDialogueNode('start', npc, 'Locked', {
      choices: [{ id: 'unlock', text: 'Open', priority: 1, requires: { kind: 'flag', key: 'open', equals: true }, next: 'end' }],
    }));
    graph.registerNode(createDialogueNode('end', npc, 'Open'));
    graph.setStart('quest', 'start');
    const runtime = new DialogueRuntimeV2(graph);
    runtime.setFlag('open', false);
    const session = runtime.start('quest', player, 3);
    expect(runtime.choices(session.id)).toHaveLength(0);
    runtime.setFlag('open', true);
    expect(runtime.choices(session.id)).toHaveLength(1);
  });

  it('applies effects when a choice is selected', () => {
    const graph = new DialogueGraphV2();
    graph.registerNode(createDialogueNode('start', npc, 'Trade', {
      choices: [{ id: 'yes', text: 'Yes', priority: 1, next: 'end', effects: [{ kind: 'value', key: 'favor', value: 10, operation: 'add' }, { kind: 'flag', key: 'questComplete', value: true }] }],
    }));
    graph.registerNode(createDialogueNode('end', npc, 'Done'));
    graph.setStart('trade', 'start');
    const runtime = new DialogueRuntimeV2(graph);
    const session = runtime.start('trade', player, 1);
    const result = runtime.choose(session.id, 'yes', 2)!;
    expect(result.nodeId).toBe('end');
    expect(runtime.context(player, npc).values.favor).toBe(10);
    expect(runtime.context(player, npc).flags.questComplete).toBe(true);
  });

  it('round-trips session snapshots with checksum integrity', () => {
    const graph = new DialogueGraphV2();
    graph.registerNode(createDialogueNode('a', npc, 'A', { autoNext: 'b' }));
    graph.registerNode(createDialogueNode('b', npc, 'B'));
    graph.setStart('g', 'a');
    const runtime = new DialogueRuntimeV2(graph);
    const session = runtime.start('g', player, 1);
    runtime.advance(session.id, 2);
    const snapshot = runtime.snapshot(session.id)!;
    const second = new DialogueRuntimeV2(graph);
    second.restore(snapshot);
    expect(second.snapshot(session.id)).toEqual(snapshot);
  });
});

describe('interaction runtime', () => {
  it('sorts available interactions by priority', () => {
    const runtime = new InteractionRuntimeV2();
    runtime.register(createInteraction('talk', 'talk', 4, { priority: 5 }));
    runtime.register(createInteraction('inspect', 'inspect', 4, { priority: 10 }));
    const available = runtime.available(
      { entity: npc, position: position(1), tags: ['npc'], definitions: [createInteraction('talk', 'talk', 4, { priority: 5 }), createInteraction('inspect', 'inspect', 4, { priority: 10 })] },
      { actor: player, tick: 1, tags: new Set(), flags: {}, values: { x: 0, y: 0, z: 0 } },
    );
    expect(available.map((item) => item.id)).toEqual(['inspect', 'talk']);
  });

  it('enforces one-shot and cooldown state', () => {
    const runtime = new InteractionRuntimeV2();
    const interaction = createInteraction('chest', 'use', 3, { oneShot: true, cooldownTicks: 5 });
    runtime.register(interaction);
    const target = { entity: npc, position: position(1), tags: [], definitions: [interaction] };
    expect(runtime.execute(interaction, { actor: player, tick: 1, flags: {}, values: {} }, target).ok).toBe(true);
    expect(runtime.execute(interaction, { actor: player, tick: 2, flags: {}, values: {} }, target).reason).toBe('already_completed');
  });

  it('emits checksummed events', () => {
    const runtime = new InteractionRuntimeV2();
    const interaction = createInteraction('lever', 'use', 3);
    runtime.register(interaction);
    const target = { entity: npc, position: position(1), tags: [], definitions: [interaction] };
    runtime.execute(interaction, { actor: player, tick: 4, flags: {}, values: {} }, target);
    const event = runtime.events()[0]!;
    expect(event.checksum).toBe(stableChecksum({ id: event.id, actor: event.actor, target: event.target, tick: event.tick, sequence: event.sequence }));
  });
});

describe('inventory runtime', () => {
  it('stacks identical items up to their stack limit', () => {
    const items = new ItemRegistryV2();
    items.register({ id: 'herb', kind: 'material', stackLimit: 10, weight: 0.2, value: 4, tags: ['alchemy'] });
    const inventory = new InventoryRuntimeV2(items);
    inventory.add(player, 'herb', 7);
    inventory.add(player, 'herb', 5);
    expect(inventory.stacks(player).map((stack) => stack.quantity)).toEqual([10, 2]);
  });

  it('equips and unequips items transactionally', () => {
    const items = new ItemRegistryV2();
    items.register(defineEquipment('sword', 'weapon', 'weapon', { power: 15, weight: 3 }));
    const inventory = new InventoryRuntimeV2(items);
    inventory.add(player, 'sword', 1);
    const uid = inventory.stacks(player)[0]!.uid;
    expect(inventory.equip(player, uid).ok).toBe(true);
    expect(inventory.equipment(player).slots.weapon?.itemId).toBe('sword');
    expect(inventory.unequip(player, 'weapon').ok).toBe(true);
    expect(inventory.stacks(player)[0]?.itemId).toBe('sword');
  });

  it('rejects transfers that exceed target capacity', () => {
    const items = new ItemRegistryV2();
    items.register({ id: 'ore', kind: 'material', stackLimit: 20, weight: 10, value: 1, tags: [] });
    const source = new InventoryRuntimeV2(items, { weightCapacity: 100 });
    const target = new InventoryRuntimeV2(items, { weightCapacity: 5 });
    source.add(player, 'ore', 1);
    const result = (() => { const removed = source.remove(player, 'ore', 1); if (!removed.ok) return removed; return target.add(npc, 'ore', 1); })();
    expect(result.ok).toBe(false);
  });

  it('restores valid snapshots and rejects tampering', () => {
    const items = new ItemRegistryV2();
    items.register({ id: 'stone', kind: 'material', stackLimit: 5, weight: 1, value: 1, tags: [] });
    const inventory = new InventoryRuntimeV2(items);
    inventory.add(player, 'stone', 2);
    const snapshot = inventory.snapshot(player);
    const restored = new InventoryRuntimeV2(items);
    restored.restore(snapshot);
    expect(restored.snapshot(player)).toEqual(snapshot);
    expect(() => restored.restore({ ...snapshot, checksum: snapshot.checksum + 1 })).toThrow();
  });
});

describe('runtime policy', () => {
  it('accepts workloads under all configured limits', () => {
    const policy = new RuntimePolicyV2();
    const decision = policy.evaluate({ entities: 100, commands: 10, events: 20, networkBytesPerSecond: 1000, largestAssetBytes: 1000, workerRequests: 2 });
    expect(decision.accepted).toBe(true);
    expect(decision.violations).toHaveLength(0);
  });

  it('denies dynamic code in production', () => {
    const policy = new RuntimePolicyV2({ allowDynamicCode: false });
    const decision = policy.evaluate({ entities: 1, commands: 1, events: 1, networkBytesPerSecond: 0, largestAssetBytes: 0, workerRequests: 0, dynamicCodeRequested: true });
    expect(decision.accepted).toBe(false);
    expect(decision.actions).toContain('enter_safe_mode');
  });

  it('supports dependency-aware feature flags', () => {
    const policy = new RuntimePolicyV2();
    policy.registerFeature({ id: 'base', state: 'enabled', rollout: 1 });
    policy.registerFeature({ id: 'advanced', state: 'enabled', rollout: 1, requires: ['base'] });
    expect(policy.featureEnabled('advanced', 0.5)).toBe(true);
    policy.updateFeature('base', 'disabled');
    expect(policy.featureEnabled('advanced', 0.5)).toBe(false);
  });
});

describe('world journal', () => {
  it('appends, queries and replays events in sequence order', () => {
    const journal = new WorldEventJournalV2();
    journal.append({ tick: tickValue(1), kind: 'spawn', source: 'test', entity: 1, payload: { kind: 'npc' } });
    journal.append({ tick: tickValue(2), kind: 'damage', source: 'test', entity: 1, payload: { amount: 4 } });
    expect(journal.query(tickValue(1), tickValue(1))).toHaveLength(1);
    const seen: string[] = [];
    expect(journal.replay(tickValue(1), tickValue(2), (event) => seen.push(event.kind))).toBe(2);
    expect(seen).toEqual(['spawn', 'damage']);
  });

  it('creates checkpoints at configured intervals', () => {
    const journal = new WorldEventJournalV2({ checkpointInterval: 2 });
    journal.append({ tick: tickValue(1), kind: 'custom', source: 'test', payload: 1 });
    expect(journal.checkpoints()).toHaveLength(0);
    journal.append({ tick: tickValue(3), kind: 'custom', source: 'test', payload: 2 });
    expect(journal.checkpoints()).toHaveLength(1);
  });

  it('truncates future history and recomputes digest', () => {
    const journal = new WorldEventJournalV2();
    journal.append({ tick: tickValue(1), kind: 'custom', source: 'test', payload: 1 });
    journal.append({ tick: tickValue(2), kind: 'custom', source: 'test', payload: 2 });
    const before = journal.hash();
    expect(journal.truncateAfter(tickValue(1))).toBe(1);
    expect(journal.hash()).not.toBe(before);
    expect(journal.latest()?.tick).toBe(tickValue(1));
  });
});
