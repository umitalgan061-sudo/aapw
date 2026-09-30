import { describe, expect, it } from 'vitest';
import {
  EntityWorldV3,
  defineNumericComponent,
  defineStringComponent,
  defineVector3Component,
} from '../../src/3d/modern/entityComponentRuntimeV3.ts';
import { AssetGraphV3 } from '../../src/3d/modern/assetGraphV3.ts';
import {
  NetworkSessionV3,
  SnapshotBufferV3,
  InputJournalV3,
} from '../../src/3d/modern/networkSessionV3.ts';

describe('entityComponentRuntimeV3', () => {
  it('creates, queries, mutates and snapshots entities deterministically', () => {
    const world = new EntityWorldV3({ maxEntities: 32, maxEvents: 128 });
    world.defineComponent(defineNumericComponent('health'));
    world.defineComponent(defineStringComponent('name'));
    world.defineComponent(defineVector3Component('position'));

    const a = world.create({ health: 100, name: 'hero', position: { x: 1, y: 2, z: 3 } });
    const b = world.create({ health: 40, name: 'guard' });
    expect(world.aliveCount()).toBe(2);
    expect(world.query({ all: ['health', 'name'] }).count).toBe(2);
    expect(world.query({ all: ['position'] }).count).toBe(1);

    expect(world.getComponent<number>(a, 'health')).toBe(100);
    expect(world.addComponent(b, 'position', { x: 4, y: 5, z: 6 })).toBe(true);
    expect(world.removeComponent(a, 'name')).toBe(true);
    expect(world.query({ all: ['position'], none: ['name'] }).handles.map((handle) => handle.id)).toEqual([2]);

    const snapshot = world.snapshot();
    const digest = world.digest();
    expect(snapshot.digest).toBe(digest);

    const restored = new EntityWorldV3({ maxEntities: 32, maxEvents: 128 });
    restored.defineComponent(defineNumericComponent('health'));
    restored.defineComponent(defineStringComponent('name'));
    restored.defineComponent(defineVector3Component('position'));
    restored.restore(snapshot);

    expect(restored.digest()).toBe(digest);
    expect(restored.alive({ id: a.id, generation: a.generation })).toBe(true);
    expect(restored.getComponent<number>({ id: a.id, generation: a.generation }, 'health')).toBe(100);
  });

  it('runs systems in deterministic order and emits bounded events', () => {
    const world = new EntityWorldV3({ maxEntities: 8, maxEvents: 4 });
    world.defineComponent(defineNumericComponent('value'));
    const entity = world.create({ value: 1 });
    const trace: string[] = [];

    world.registerSystem('z-system', ({ tick, world: current }) => {
      trace.push(`z:${tick}`);
      const value = current.getComponent<number>(entity, 'value') ?? 0;
      current.addComponent(entity, 'value', value + 1);
    });
    world.registerSystem('a-system', ({ tick, emit }) => {
      trace.push(`a:${tick}`);
      emit({ type: 'system.tick', payload: { tick } });
    });

    world.step(1 / 60);
    expect(trace).toEqual(['a:1', 'z:1']);
    expect(world.getComponent<number>(entity, 'value')).toBe(2);
    expect(world.consumeEvents().some((event) => event.type === 'entity.created')).toBe(true);
  });
});

describe('assetGraphV3', () => {
  const baseNode = (id: string, dependencies: string[] = []) => ({
    id,
    url: `https://cdn.example.test/${id}.glb`,
    kind: 'model',
    dependencies,
    priority: 'normal' as const,
    estimatedBytes: 1000,
    optional: false,
  });

  it('respects dependency readiness and tracks residency', () => {
    const graph = new AssetGraphV3({
      maxConcurrent: 2,
      maxResidentBytes: 10_000,
      maxInFlightBytes: 5_000,
    });
    graph.declare(baseNode('material'));
    graph.declare({ ...baseNode('hero', ['material']), priority: 'critical' as const });

    expect(graph.plan(8).map((item) => item.id)).toEqual(['material']);
    const material = graph.begin('material');
    expect(material?.state).toBe('loading');
    expect(graph.begin('hero')).toBeNull();

    graph.complete('material', 1200);
    expect(graph.state('material')).toBe('ready');
    expect(graph.plan(8).map((item) => item.id)).toEqual(['hero']);

    graph.begin('hero');
    graph.complete('hero', 1600);
    expect(graph.residentBytes()).toBe(2800);
    expect(graph.stats().ready).toBe(2);
  });

  it('blocks dependents after permanent failure', () => {
    const graph = new AssetGraphV3({ maxRetries: 0 });
    graph.declare(baseNode('root'));
    graph.declare(baseNode('child', ['root']));
    graph.begin('root');
    graph.fail('root', new Error('network failure'));
    expect(graph.state('root')).toBe('failed');
    expect(graph.state('child')).toBe('blocked');
  });

  it('invalidates dependency subgraphs and preserves a stable digest', () => {
    const graph = new AssetGraphV3();
    graph.declare(baseNode('shared'));
    graph.declare(baseNode('a', ['shared']));
    graph.declare(baseNode('b', ['shared']));
    const first = graph.digest();
    graph.begin('shared');
    graph.complete('shared');
    const changed = graph.invalidate('shared');
    expect(changed.map((node) => node.id)).toEqual(['a', 'b', 'shared']);
    expect(graph.digest()).not.toBe(first);
  });
});

describe('networkSessionV3', () => {
  it('retains bounded input history and acknowledgements', () => {
    const journal = new InputJournalV3(16);
    for (let tick = 1; tick <= 24; tick += 1) journal.append(tick, { move: tick }, tick * 16);
    expect(journal.size()).toBe(16);
    expect(journal.latest()?.tick).toBe(24);
    journal.acknowledge(10);
    expect(journal.oldest()?.sequence).toBeGreaterThan(10);
    expect(journal.afterTick(20).map((frame) => frame.tick)).toEqual([21, 22, 23, 24]);
  });

  it('interpolates ordered snapshots without mutating source state', () => {
    const buffer = new SnapshotBufferV3<{ x: number }>(8);
    const first = {
      tick: 10,
      serverTimeMs: 100,
      sequence: 1,
      state: { x: 0 },
      digest: 'a',
    };
    const second = {
      tick: 20,
      serverTimeMs: 200,
      sequence: 2,
      state: { x: 10 },
      digest: 'b',
    };
    buffer.push(first);
    buffer.push(second);

    const sample = buffer.interpolate(150, (a, b, alpha) => ({
      x: a.x + (b.x - a.x) * alpha,
    }));
    expect(sample?.alpha).toBe(0.5);
    expect(sample?.snapshot.state.x).toBe(5);

    second.state.x = 10;
    expect(buffer.latest()?.state.x).toBe(10);
  });

  it('reconciles predicted state by replaying only post-authoritative inputs', () => {
    const session = new NetworkSessionV3<{ value: number }>({
      reconciliationTolerance: 0.01,
      interpolationDelayMs: 50,
    });
    session.setPredictedState({ value: 12 }, 12);
    session.submitInput(11, { delta: 1 }, 176);
    session.submitInput(12, { delta: 2 }, 192);
    session.submitInput(13, { delta: 3 }, 208);

    const result = session.reconcile(
      { value: 10 },
      10,
      (state, frame) => ({
        value: state.value + Number((frame.payload as { delta: number }).delta),
      }),
      (a, b) => Math.abs(a.value - b.value),
    );

    expect(result.corrected).toBe(true);
    expect(result.replayedInputs.map((frame) => frame.tick)).toEqual([11, 12, 13]);
    expect(result.state.value).toBe(16);
    expect(session.stats().corrections).toBe(1);
  });
});
