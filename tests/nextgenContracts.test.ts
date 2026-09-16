import { describe, expect, it } from 'vitest';
import { AiDirector } from '../src/engine-ts/nextgen/ai.ts';
import { AnimationGraph, LayeredAnimationController } from '../src/engine-ts/nextgen/animation.ts';
import { CommandBus, EventBus } from '../src/engine-ts/nextgen/events.ts';
import { createSession, tierSummary } from '../src/engine-ts/nextgen/session.ts';
import { QuestJournal } from '../src/engine-ts/nextgen/quests.ts';
import { EcsWorld } from '../src/engine-ts/nextgen/ecs.ts';
import { asEntityId, asTick } from '../src/engine-ts/nextgen/contracts.ts';

describe('nextgen event and command infrastructure', () => {
  it('delivers typed events and supports once subscriptions', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.on('spawn', (event) => seen.push(String(event.payload)));
    bus.once('spawn', () => seen.push('once'));
    bus.emit('spawn', 'alpha', asTick(1), 'gameplay');
    bus.emit('spawn', 'beta', asTick(2), 'gameplay');
    expect(seen).toEqual(['alpha', 'once', 'beta']);
    expect(bus.collect('spawn')).toHaveLength(2);
    expect(bus.digest()).toBe(bus.digest());
  });

  it('orders commands by tick and rejects duplicate handlers', () => {
    const bus = new CommandBus();
    const values: number[] = [];
    bus.register('add', (command) => values.push(Number(command.payload)));
    expect(() => bus.register('add', () => undefined)).toThrow();
    bus.enqueue('add', asTick(2), 2);
    bus.enqueue('add', asTick(1), 1);
    expect(bus.pending()).toBe(2);
    expect(bus.dispatch(asTick(1))).toBe(1);
    expect(bus.dispatch(asTick(2))).toBe(1);
    expect(values).toEqual([1, 2]);
  });
});

describe('nextgen animation', () => {
  it('resolves locomotion states and advances normalized clip time', () => {
    const graph = new AnimationGraph();
    for (const id of ['idle', 'walk', 'run', 'sprint', 'jump', 'fall', 'attack', 'block', 'dodge', 'stunned', 'dead']) graph.registerClip({ id, durationMs: 500, loop: id !== 'dead', speed: 1, rootMotion: false, tags: [] });
    const controller = new LayeredAnimationController(graph);
    const entity = asEntityId(1);
    const state = controller.update(entity, { speed: 3, grounded: true, verticalVelocity: 0, attacking: false, blocking: false, dodging: false, stunned: false, dead: false, sprinting: false }, 100);
    expect(state.layers.get('base')?.locomotion).toBe('run');
    expect(state.layers.get('base')?.normalizedTime).toBeGreaterThan(0);
    const attack = controller.update(entity, { speed: 1, grounded: true, verticalVelocity: 0, attacking: true, blocking: false, dodging: false, stunned: false, dead: false, sprinting: false }, 100);
    expect(attack.layers.has('upperBody')).toBe(true);
  });
});

describe('nextgen quests', () => {
  it('does not progress unknown objectives and completes all visible objectives', () => {
    const journal = new QuestJournal();
    journal.define({ id: 'q1', title: 'Start', description: 'Test', prerequisites: [], objectives: [{ id: 'kill', type: 'kill', required: 2, description: 'two enemies' }], rewardXp: 10, rewardGold: 5, repeatable: false });
    journal.refreshAvailability(new Set());
    expect(journal.start('q1')).toBe(true);
    expect(journal.progress('q1', 'unknown', 1)).toBeNull();
    journal.setTick(asTick(2));
    journal.progress('q1', 'kill', 1);
    expect(journal.state('q1')?.status).toBe('active');
    journal.progress('q1', 'kill', 1);
    expect(journal.state('q1')?.status).toBe('completed');
  });
});

describe('nextgen session composition', () => {
  it('builds a deterministic composition root and snapshot digest', () => {
    const first = createSession({ seed: 55, tier: 'high', build: 'test' });
    const second = createSession({ seed: 55, tier: 'high', build: 'test' });
    first.start(0);
    second.start(0);
    first.frame(16.667);
    second.frame(16.667);
    expect(first.snapshot().checksum).toBe(second.snapshot().checksum);
    expect(tierSummary('high').configDigest).toBe(tierSummary('high').configDigest);
    first.stop();
    second.stop();
  });
});

describe('nextgen ecs lifecycle', () => {
  it('supports patch/remove/destroy while retaining deterministic snapshots', () => {
    const world = new EcsWorld();
    const position = world.registerComponent('position', () => ({ x: 0, y: 0, z: 0 }));
    const entity = world.createEntity();
    world.add(entity, position, { x: 1, y: 2, z: 3 });
    world.patch(entity, position, { y: 5 });
    expect(world.get(entity, position)?.y).toBe(5);
    expect(world.remove(entity, position)).toBe(true);
    expect(world.destroyEntity(entity)).toBe(true);
    expect(world.snapshot()).toContain('"alive":false');
  });
});

describe('nextgen ai', () => {
  it('uses bounded thinking and deterministic ordering', () => {
    const make = () => {
      const ai = new AiDirector(123, { maxThinkers: 2, thinkIntervalTicks: 1, memoryLimit: 8 });
      ai.register({ entity: asEntityId(1), faction: 'a', mode: 'idle', healthRatio: 1, staminaRatio: 1, morale: 1, fatigue: 0, alertness: 1, position: { x: 0, y: 0, z: 0 }, memories: [], revision: 0 });
      ai.register({ entity: asEntityId(2), faction: 'a', mode: 'idle', healthRatio: 0.2, staminaRatio: 1, morale: 0.4, fatigue: 0.2, alertness: 1, position: { x: 1, y: 0, z: 0 }, memories: [], revision: 0 });
      ai.emit({ source: asEntityId(9), position: { x: 1, y: 0, z: 0 }, kind: 'damage', strength: 1, tick: 1, faction: 'b' });
      return ai.tick(1);
    };
    expect(make()).toEqual(make());
  });
});
