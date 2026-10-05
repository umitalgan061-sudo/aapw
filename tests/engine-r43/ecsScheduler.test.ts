import { describe, expect, it } from 'vitest';
import { EcsWorld } from '../../src/engine-ts/r43/ecs.ts';
import { DeterministicScheduler } from '../../src/engine-ts/r43/scheduler.ts';

describe('r43 ECS', () => {
  it('creates, composes and destroys entities', () => {
    const world = new EcsWorld();
    const positions = world.defineComponent<{ x: number; y: number }>('position');
    const names = world.defineComponent<string>('name');
    const first = world.create();
    const second = world.create();
    positions.set(first, { x: 1, y: 2 });
    names.set(first, 'A');
    positions.set(second, { x: 3, y: 4 });

    expect(world.count()).toBe(2);
    expect(world.query('position', 'name').entities).toEqual([first]);
    expect(world.getComponent<string>(first, 'name')).toBe('A');
    expect(world.hasComponent(second, 'name')).toBe(false);

    expect(world.destroy(first)).toBe(true);
    expect(world.count()).toBe(1);
    expect(positions.has(first)).toBe(false);
    expect(world.destroy(first)).toBe(false);
  });

  it('recycles entity ids in deterministic order', () => {
    const world = new EcsWorld();
    const one = world.create();
    const two = world.create();
    const three = world.create();
    expect([one, two, three]).toEqual([1, 2, 3]);
    world.destroy(two);
    world.destroy(one);
    expect(world.create()).toBe(1);
    expect(world.create()).toBe(2);
  });

  it('restores component snapshots with stable ordering', () => {
    const world = new EcsWorld();
    const entity = world.create();
    world.addComponent(entity, 'hp', 100);
    world.addComponent(entity, 'position', { x: 4, z: 5 });
    const snapshot = world.snapshot();

    const restored = new EcsWorld();
    restored.restore({ entities: [entity], stores: snapshot });
    expect(restored.alive(entity)).toBe(true);
    expect(restored.getComponent<number>(entity, 'hp')).toBe(100);
    expect(restored.getComponent<{ x: number; z: number }>(entity, 'position')).toEqual({ x: 4, z: 5 });
  });

  it('returns empty results for incomplete queries', () => {
    const world = new EcsWorld();
    const entity = world.create();
    world.addComponent(entity, 'position', { x: 0, z: 0 });
    expect(world.query('position', 'missing').entities).toEqual([]);
  });

  it('keeps component stores sorted independently of insertion order', () => {
    const world = new EcsWorld();
    const a = world.create();
    const b = world.create();
    const store = world.defineComponent<number>('score');
    store.set(b, 20);
    store.set(a, 10);
    expect(store.entities()).toEqual([a, b]);
    expect(store.entries().map(([id]) => id)).toEqual([a, b]);
  });
});

describe('r43 scheduler', () => {
  it('sorts by phase, priority and id deterministically', () => {
    const scheduler = new DeterministicScheduler();
    scheduler.add({ id: 'zeta', phase: 'simulation', priority: 'normal', update: () => {} });
    scheduler.add({ id: 'alpha', phase: 'simulation', priority: 'normal', update: () => {} });
    scheduler.add({ id: 'input-critical', phase: 'input', priority: 'critical', update: () => {} });
    scheduler.add({ id: 'simulation-high', phase: 'simulation', priority: 'high', update: () => {} });

    expect(scheduler.order().map((item) => item.id)).toEqual([
      'input-critical',
      'simulation-high',
      'alpha',
      'zeta',
    ]);
  });

  it('honors dependency edges even when lexical order disagrees', () => {
    const scheduler = new DeterministicScheduler();
    const seen: string[] = [];
    scheduler.add({
      id: 'consumer',
      phase: 'simulation',
      priority: 'critical',
      dependencies: ['producer'],
      update: () => seen.push('consumer'),
    });
    scheduler.add({
      id: 'producer',
      phase: 'simulation',
      priority: 'low',
      update: () => seen.push('producer'),
    });
    scheduler.run(() => ({
      frame: {
        frame: 1,
        tick: 1,
        simTimeSeconds: 0.016,
        deltaSeconds: 0.016,
        interpolationAlpha: 0,
        droppedSteps: 0,
        cpuBudgetMs: 16.67,
      },
      budget: {
        targetFrameMs: 16.67,
        simulationMs: 4,
        renderMs: 8,
        streamingMs: 2,
        networkMs: 1,
        scriptingMs: 1.67,
      },
      phase: 'simulation',
      commands: [],
      emit: () => {},
    }));
    expect(seen).toEqual(['producer', 'consumer']);
  });

  it('rejects dependency cycles', () => {
    const scheduler = new DeterministicScheduler();
    scheduler.add({ id: 'a', phase: 'simulation', priority: 'normal', dependencies: ['b'], update: () => {} });
    scheduler.add({ id: 'b', phase: 'simulation', priority: 'normal', dependencies: ['a'], update: () => {} });
    expect(() => scheduler.order()).toThrow(/cycle/i);
  });

  it('reports disabled systems without executing them', () => {
    let executed = false;
    const scheduler = new DeterministicScheduler();
    scheduler.add({
      id: 'disabled',
      phase: 'gameplay',
      priority: 'normal',
      enabled: () => false,
      update: () => { executed = true; },
    });
    const reports = scheduler.run(() => ({
      frame: {
        frame: 1,
        tick: 1,
        simTimeSeconds: 0,
        deltaSeconds: 0.016,
        interpolationAlpha: 0,
        droppedSteps: 0,
        cpuBudgetMs: 16.67,
      },
      budget: {
        targetFrameMs: 16.67,
        simulationMs: 4,
        renderMs: 8,
        streamingMs: 2,
        networkMs: 1,
        scriptingMs: 1.67,
      },
      phase: 'gameplay',
      commands: [],
      emit: () => {},
    }));
    expect(executed).toBe(false);
    expect(reports[0]?.skipped).toBe(true);
    expect(reports[0]?.reason).toBe('disabled');
  });
});
