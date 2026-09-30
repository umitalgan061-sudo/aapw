import { describe, expect, it, vi } from 'vitest';
import {
  DeterministicAiDirector,
  createFleeAction,
  createWanderAction,
  DialogueRuntime,
  InventoryRuntime,
  createDialogueGraph,
  emptyInventory,
  itemId,
  entityId,
} from '../../../src/3d/modern/r27/index.ts';

describe('R27 gameplay systems', () => {
  it('chooses the highest utility action deterministically', () => {
    const ai = new DeterministicAiDirector({ maxDecisions: 4 });
    const calls: string[] = [];
    const entity = entityId(1);
    const target = entityId(2);
    ai.registerAgent(entity, { x: 0, y: 0, z: 0 }, [
      {
        id: 'idle',
        utility: 0.1,
        cooldownTicks: 2,
        cost: 0.1,
        execute: () => calls.push('idle'),
      },
      {
        id: 'attack',
        utility: 0.8,
        cooldownTicks: 1,
        cost: 0.9,
        execute: (_entity, _tick, seen) => calls.push(`attack:${String(seen)}`),
      },
    ]);
    ai.perceive(entity, { index: 1, dtSeconds: 1 / 60, simulationTimeSeconds: 0 }, [{
      entity: target,
      position: { x: 1, y: 0, z: 0 },
      kind: 'player',
      threat: 1,
      visibility: 1,
      lastSeenTick: 1,
    }]);
    const decisions = ai.decide({ index: 1, dtSeconds: 1 / 60, simulationTimeSeconds: 0 });
    expect(decisions[0]?.action).toBe('attack');
    expect(calls[0]).toBe('attack:2');
  });

  it('provides deterministic helper actions', () => {
    const directions: number[] = [];
    const wander = createWanderAction('wander', 10, (_entity, direction) => directions.push(direction.x + direction.z));
    wander.execute(entityId(3), { index: 1, dtSeconds: 1 / 60, simulationTimeSeconds: 0 });
    wander.execute(entityId(3), { index: 2, dtSeconds: 1 / 60, simulationTimeSeconds: 0 });
    expect(directions[0]).toBe(directions[1]);

    const flee = createFleeAction('flee', (_entity, direction) => directions.push(direction.x));
    flee.execute(entityId(3), { index: 1, dtSeconds: 1 / 60, simulationTimeSeconds: 0 }, entityId(2));
    expect(Number.isFinite(directions.at(-1))).toBe(true);
  });

  it('keeps inventory stacking and equipment deterministic', () => {
    const runtime = new InventoryRuntime();
    const potion = itemId('potion');
    const sword = itemId('sword');
    runtime.defineMany([
      { id: potion, stackLimit: 10, weight: 0.5, tags: ['consumable'] },
      { id: sword, stackLimit: 1, weight: 4, tags: ['weapon'], equipSlot: 'mainhand', modifiers: { attack: 8 } },
    ]);

    let inventory = emptyInventory(8);
    inventory = runtime.add(inventory, potion, 16).after;
    expect(inventory.stacks).toEqual([{ item: potion, quantity: 10 }, { item: potion, quantity: 6 }]);

    inventory = runtime.equip(
      runtime.add(inventory, sword, 1).after,
      sword,
    ).after;
    expect(inventory.equipment.slots.mainhand?.item).toBe(sword);
    expect(runtime.hasTag(inventory, 'consumable')).toBe(true);
    expect(runtime.weight(inventory)).toBeCloseTo(12);
    expect(runtime.remove(inventory, potion, 6).after.stacks).toEqual([{ item: potion, quantity: 10 }]);
  });

  it('evaluates dialogue conditions and maintains a stable transcript', () => {
    const nodeA = {
      id: 'start',
      speaker: 'guard',
      text: 'Halt.',
      choices: [
        {
          id: 'enter',
          text: 'Enter',
          next: 'end',
          conditions: [{ kind: 'tag', tag: 'permit', present: true }],
          setVariables: { entered: true },
          addTags: ['inside'],
        },
      ],
    } as const;
    const nodeB = {
      id: 'end',
      speaker: 'guard',
      text: 'Proceed.',
      choices: [],
      terminal: true,
    } as const;

    const graph = createDialogueGraph('gate', 'start', [nodeA, nodeB]);
    const runtime = new DialogueRuntime(graph);
    const state = runtime.start(entityId(4), { reputation: 2 }, ['permit']);
    expect(runtime.availableChoices(state).map((choice) => choice.id)).toEqual(['enter']);

    const transition = runtime.choose(entityId(4), state, 'enter');
    expect(transition.state.current).toBe('end');
    expect(transition.state.variables.entered).toBe(true);
    expect(runtime.isTerminal(transition.state)).toBe(true);
    expect(runtime.fingerprint(transition.state)).toBe(runtime.fingerprint(transition.state));
  });

  it('reports rejected inventory operations without mutating state', () => {
    const runtime = new InventoryRuntime();
    const missing = itemId('missing');
    const state = emptyInventory();
    const result = runtime.add(state, missing, 1);
    expect(result.events[0]?.type).toBe('rejected');
    expect(result.after).toEqual(state);
  });
});
