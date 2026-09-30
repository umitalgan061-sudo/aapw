import { describe, expect, it } from 'vitest';
import { entityId, revisionValue, stableChecksum, tickValue } from '../../src/3d/modern/nextgen/types.ts';
import { DeterministicRandomStream, RandomRegistry, seededNoise2D } from '../../src/3d/modern/nextgen/deterministicRngV2.ts';
import { ActorSimulationV2, createDefaultActor } from '../../src/3d/modern/nextgen/actorSimulationV2.ts';
import { DialogueGraphV2, DialogueRuntimeV2, createDialogueNode } from '../../src/3d/modern/nextgen/dialogueRuntimeV2.ts';
import { InteractionRuntimeV2, createInteraction } from '../../src/3d/modern/nextgen/interactionRuntimeV2.ts';
import { InventoryRuntimeV2, ItemRegistryV2, defineEquipment } from '../../src/3d/modern/nextgen/inventoryRuntimeV2.ts';
import { RuntimePolicyV2 } from '../../src/3d/modern/nextgen/runtimePolicyV2.ts';
import { WorldEventJournalV2 } from '../../src/3d/modern/nextgen/worldEventJournalV2.ts';

const player = entityId(1);
const npc = entityId(2);
const pos = (x: number, y = 0, z = 0) => ({ x, y, z });

describe('deterministic random stream', () => {
  it('is reproducible from identical seeds', () => {
    const left = new DeterministicRandomStream(1234);
    const right = new DeterministicRandomStream(1234);
    expect(Array.from({ length: 64 }, () => left.nextUint())).toEqual(Array.from({ length: 64 }, () => right.nextUint()));
  });
  it('restores exact state', () => {
    const stream = new DeterministicRandomStream(55);
    stream.nextUint();
    const snapshot = stream.snapshot();
    const first = stream.nextUint();
    const second = stream.nextUint();
    stream.restore(snapshot);
    expect(stream.nextUint()).toBe(first);
    expect(stream.nextUint()).toBe(second);
  });
  it('creates stable forks and noise', () => {
    const a = new DeterministicRandomStream(99).fork('world');
    const b = new DeterministicRandomStream(99).fork('world');
    expect(a.nextFloat()).toBe(b.nextFloat());
    expect(seededNoise2D(99, 3.25, 8.5)).toBe(seededNoise2D(99, 3.25, 8.5));
  });
  it('keeps registry streams isolated', () => {
    const registry = new RandomRegistry(7);
    expect(registry.stream('combat')).toBe(registry.stream('combat'));
    expect(registry.stream('combat')).not.toBe(registry.stream('world'));
    expect(registry.names()).toEqual(['combat', 'world']);
  });
});

describe('actor simulation', () => {
  it('moves and targets deterministically', () => {
    const create = () => {
      const runtime = new ActorSimulationV2(101);
      runtime.spawn(createDefaultActor(player, 'npc', pos(0), { acceleration: 30 }));
      runtime.spawn(createDefaultActor(npc, 'creature', pos(5)));
      runtime.setIntent(player, { desiredVelocity: pos(2, 0, 0) });
      return runtime;
    };
    const a = create();
    const b = create();
    for (let index = 0; index < 120; index += 1) { a.step(); b.step(); }
    expect(a.snapshot()).toEqual(b.snapshot());
    expect(a.digest()).toBe(b.digest());
  });
  it('handles damage, alerting and death', () => {
    const runtime = new ActorSimulationV2(1);
    runtime.spawn(createDefaultActor(player, 'npc', pos(0), { maxHealth: 40, health: 40 }));
    expect(runtime.applyDamage(player, 10, npc)).toBe(10);
    expect(runtime.get(player)?.mode).toBe('alert');
    runtime.applyDamage(player, 100, npc);
    expect(runtime.get(player)?.mode).toBe('dead');
    expect(runtime.applyDamage(player, 1, npc)).toBe(0);
  });
  it('prefers the highest-priority visible hostile', () => {
    const runtime = new ActorSimulationV2(2);
    runtime.spawn(createDefaultActor(player, 'npc', pos(0)));
    runtime.spawn(createDefaultActor(npc, 'creature', pos(2)));
    runtime.step([
      { id: npc, position: pos(2), hostile: true, visible: true, priority: 10 },
      { id: entityId(3), position: pos(3), hostile: true, visible: true, priority: 50 },
    ]);
    expect(runtime.get(player)?.intent.target).toBe(entityId(3));
  });
});

describe('interaction runtime', () => {
  it('orders available interactions by priority', () => {
    const runtime = new InteractionRuntimeV2();
    const inspect = createInteraction('inspect', 'inspect', 5, { priority: 10 });
    const talk = createInteraction('talk', 'talk', 5, { priority: 5 });
    runtime.register(inspect);
    runtime.register(talk);
    const target = { entity: npc, position: pos(1), tags: ['npc'], definitions: [talk, inspect] };
    expect(runtime.available(target, { actor: player, tick: 1, flags: {}, values: pos(0) }).map((entry) => entry.id)).toEqual(['inspect', 'talk']);
  });
  it('enforces one-shot execution and produces a checksum', () => {
    const runtime = new InteractionRuntimeV2();
    const action = createInteraction('lever', 'use', 4, { oneShot: true });
    runtime.register(action);
    const target = { entity: npc, position: pos(1), tags: [], definitions: [action] };
    expect(runtime.execute(action, { actor: player, tick: 5, flags: {}, values: pos(0) }, target).ok).toBe(true);
    expect(runtime.execute(action, { actor: player, tick: 6, flags: {}, values: pos(0) }, target).reason).toBe('already_completed');
    const event = runtime.events()[0]!;
    expect(event.checksum).toBe(stableChecksum({ id: event.id, actor: event.actor, target: event.target, tick: event.tick, sequence: event.sequence }));
  });
});

describe('inventory runtime', () => {
  it('stacks and equips typed items', () => {
    const items = new ItemRegistryV2();
    items.register({ id: 'herb', kind: 'material', stackLimit: 10, weight: 0.2, value: 2, tags: ['alchemy'] });
    items.register(defineEquipment('sword', 'weapon', 'weapon', { power: 15, weight: 3 }));
    const inventory = new InventoryRuntimeV2(items);
    inventory.add(player, 'herb', 7);
    inventory.add(player, 'herb', 5);
    expect(inventory.stacks(player).filter((stack) => stack.itemId === 'herb').map((stack) => stack.quantity)).toEqual([10, 2]);
    inventory.add(player, 'sword', 1);
    const uid = inventory.stacks(player).find((stack) => stack.itemId === 'sword')!.uid;
    expect(inventory.equip(player, uid).ok).toBe(true);
    expect(inventory.equipment(player).slots.weapon?.itemId).toBe('sword');
  });
  it('rejects tampered snapshots', () => {
    const items = new ItemRegistryV2();
    items.register({ id: 'stone', kind: 'material', stackLimit: 5, weight: 1, value: 1, tags: [] });
    const inventory = new InventoryRuntimeV2(items);
    inventory.add(player, 'stone', 2);
    const snapshot = inventory.snapshot(player);
    expect(() => inventory.restore({ ...snapshot, checksum: snapshot.checksum + 1 })).toThrow();
  });
});

describe('dialogue runtime', () => {
  it('follows conditional choices and applies effects', () => {
    const graph = new DialogueGraphV2();
    graph.registerNode(createDialogueNode('start', npc, 'Welcome', {
      choices: [{ id: 'open', text: 'Open', priority: 2, requires: { kind: 'flag', key: 'ready', equals: true }, next: 'end', effects: [{ kind: 'value', key: 'favor', value: 10, operation: 'add' }] }],
    }));
    graph.registerNode(createDialogueNode('end', npc, 'Done'));
    graph.setStart('intro', 'start');
    const runtime = new DialogueRuntimeV2(graph);
    runtime.setFlag('ready', false);
    const session = runtime.start('intro', player, 1);
    expect(runtime.choices(session.id)).toHaveLength(0);
    runtime.setFlag('ready', true);
    expect(runtime.choices(session.id)).toHaveLength(1);
    expect(runtime.choose(session.id, 'open', 2)?.nodeId).toBe('end');
    expect(runtime.context(player, npc).values.favor).toBe(10);
  });
});

describe('runtime policy and journal', () => {
  it('enforces production safety limits', () => {
    const policy = new RuntimePolicyV2();
    expect(policy.evaluate({ entities: 10, commands: 1, events: 1, networkBytesPerSecond: 1, largestAssetBytes: 1, workerRequests: 1 }).accepted).toBe(true);
    const denied = policy.evaluate({ entities: 10, commands: 1, events: 1, networkBytesPerSecond: 1, largestAssetBytes: 1, workerRequests: 1, dynamicCodeRequested: true });
    expect(denied.accepted).toBe(false);
  });
  it('journals and replays checksummed events', () => {
    const journal = new WorldEventJournalV2();
    journal.append({ tick: tickValue(1), kind: 'spawn', source: 'test', entity: 1, payload: { kind: 'npc' } });
    journal.append({ tick: tickValue(2), kind: 'damage', source: 'test', entity: 1, payload: { amount: 4 } });
    const seen: string[] = [];
    expect(journal.replay(tickValue(1), tickValue(2), (event) => seen.push(event.kind))).toBe(2);
    expect(seen).toEqual(['spawn', 'damage']);
    const snapshot = journal.snapshot();
    const restored = new WorldEventJournalV2();
    restored.restore(snapshot);
    expect(restored.hash()).toBe(journal.hash());
  });
  it('keeps strong-value tick and revision constructors', () => {
    expect(tickValue(12)).toBe(12);
    expect(revisionValue(4)).toBe(4);
  });
});
