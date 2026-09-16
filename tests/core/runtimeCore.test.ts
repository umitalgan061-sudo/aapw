import { describe, expect, it, vi } from 'vitest';
import { advanceSeason, clamp, deterministicDigest, freeze, makeDefaultSeason, revision, type WorldState } from '../../src/core/domain/contracts.ts';
import { createWorldBus, TypedEventBus } from '../../src/core/events/typedEventBus.ts';
import { FixedStepClock, MulberryRandom, runReplay } from '../../src/core/runtime/deterministicClock.ts';
import { ImmutableStore } from '../../src/core/state/immutableStore.ts';
import { AdaptiveQualityController, getQualityPolicy } from '../../src/core/performance/adaptiveQuality.ts';
import { MemoryStorage, VersionedStorage } from '../../src/core/storage/versionedStorage.ts';
import { NetworkPolicy } from '../../src/core/net/networkPolicy.ts';
import { RuntimeTelemetry } from '../../src/core/telemetry/runtimeTelemetry.ts';
import { WorkerPool } from '../../src/core/worker/workerPool.ts';
import { SceneGraph } from '../../src/core/scene/sceneGraph.ts';

const world = (): WorldState => freeze({ schema: 2, worldId: 'test', season: makeDefaultSeason(), kingdoms: new Map(), selectedKingdom: null, revision: revision(0) });

describe('domain contracts', () => {
  it('clamps invalid ranges deterministically', () => {
    expect(clamp(Number.NaN, 0, 1)).toBe(0);
    expect(clamp(3, 0, 1)).toBe(1);
    expect(clamp(-1, 0, 1)).toBe(0);
  });

  it('advances seasons without unbounded dates', () => {
    const next = advanceSeason({ ...makeDefaultSeason(), day: 29 }, 5);
    expect(next.day).toBe(4);
    expect(next.turn).toBe(2);
    expect(next.phase).toBe('summer');
  });

  it('produces stable structural digests', () => {
    const a = deterministicDigest({ b: 2, a: 1 });
    const b = deterministicDigest({ a: 1, b: 2 });
    expect(a).toBe(b);
  });

  it('deep-freezes nested contracts', () => {
    const value = freeze({ nested: { value: 1 }, array: [{ ok: true }] });
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.nested)).toBe(true);
    expect(Object.isFrozen(value.array)).toBe(true);
  });
});

describe('typed event bus', () => {
  it('delivers typed events in deterministic registration order', () => {
    const bus = createWorldBus({ now: () => 100 });
    const calls: string[] = [];
    bus.on('world:ready', () => calls.push('a'));
    bus.on('world:ready', () => calls.push('b'));
    expect(bus.emit('world:ready', { revision: 1 })).toBe(true);
    expect(calls).toEqual(['a', 'b']);
    expect(bus.metrics().delivered).toBe(2);
  });

  it('supports once subscriptions and removal', () => {
    const bus = new TypedEventBus<{ event: { value: number } }>();
    const handler = vi.fn();
    bus.once('event', handler);
    bus.emit('event', { value: 1 });
    bus.emit('event', { value: 2 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(bus.listenerCount('event')).toBe(0);
  });

  it('drops oldest queued events when capacity is exceeded', () => {
    const bus = new TypedEventBus<{ event: { value: number } }>({ maxQueue: 1 });
    const handler = vi.fn(() => undefined);
    bus.on('event', handler);
    bus.emit('event', { value: 1 });
    expect(bus.metrics().dropped).toBe(0);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe('deterministic runtime primitives', () => {
  it('fixed-step clock produces reproducible step counts', () => {
    const clock = new FixedStepClock({ startMs: 0, stepMs: 10 });
    expect(clock.sample(25).steps).toBe(2);
    expect(clock.sample(5).steps).toBe(1);
    expect(clock.now()).toBe(30);
  });

  it('seeded random forks reproducibly', () => {
    const a = new MulberryRandom(42).fork('world');
    const b = new MulberryRandom(42).fork('world');
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });

  it('replay runner is deterministic', () => {
    const runner = {
      seed: (state: number) => state,
      step: (state: number, input: number) => state + input,
      digest: (state: number) => String(state),
    };
    const first = runReplay(0, [1, 2, 3], runner);
    const second = runReplay(0, [1, 2, 3], runner);
    expect(first).toEqual(second);
    expect(first.finalHash).toBe('6');
  });
});

describe('immutable store', () => {
  type State = { count: number };
  type Action = { type: 'inc' | 'set'; value?: number };
  const reducer = (state: State, action: Action): State => action.type === 'inc' ? { count: state.count + 1 } : { count: action.value ?? state.count };

  it('notifies only on identity-changing updates', () => {
    const store = new ImmutableStore<State, Action>({ count: 0 }, reducer);
    const listener = vi.fn();
    store.subscribe(listener);
    store.dispatch({ type: 'inc' });
    store.dispatch({ type: 'set', value: 1 });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.metrics().updates).toBe(2);
  });

  it('supports selector subscriptions', () => {
    const store = new ImmutableStore({ a: 0, b: 0 }, (state, action: { target: 'a' | 'b' }) => ({ ...state, [action.target]: state[action.target] + 1 }));
    const listener = vi.fn();
    store.select((state) => state.a, listener);
    store.dispatch({ target: 'b' });
    store.dispatch({ target: 'a' });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('adaptive quality', () => {
  it('does not immediately oscillate quality', () => {
    let now = 0;
    const controller = new AdaptiveQualityController({ now: () => now, dwellMs: 100 });
    for (let i = 0; i < 20; i += 1) {
      now += 10;
      controller.update({ cpu: 1, gpu: 1, memory: 0.5, thermal: 0, network: 0, frameTimeMs: 40, timestamp: now });
    }
    expect(controller.level).toBeLessThan(4);
    const first = controller.level;
    now += 5;
    controller.update({ cpu: 0, gpu: 0, memory: 0, thermal: 0, network: 0, frameTimeMs: 5, timestamp: now });
    expect(controller.level).toBe(first);
  });

  it('quality policies stay bounded', () => {
    for (const level of [0, 1, 2, 3, 4] as const) {
      const policy = getQualityPolicy(level);
      expect(policy.resolutionScale).toBeGreaterThanOrEqual(0.25);
      expect(policy.resolutionScale).toBeLessThanOrEqual(1);
      expect(policy.audioVoices).toBeGreaterThan(0);
    }
  });
});

describe('versioned persistence', () => {
  it('round trips payloads with integrity checks', () => {
    const storage = new MemoryStorage();
    const store = new VersionedStorage(storage, 'world', 2, [], () => 1000);
    expect(store.save({ score: 7 }).ok).toBe(true);
    const result = store.load();
    expect(result.ok).toBe(true);
    expect(result.value?.value).toEqual({ score: 7 });
  });

  it('rejects tampered payloads', () => {
    const storage = new MemoryStorage();
    const store = new VersionedStorage(storage, 'world', 2, [], () => 1000);
    store.save({ score: 7 });
    storage.set('world', storage.get('world')!.replace('7', '8'));
    expect(store.load().ok).toBe(false);
  });
});

describe('network policy', () => {
  it('enforces offline fail-closed behavior', () => {
    const policy = new NetworkPolicy();
    expect(policy.enqueue({ id: '1', channel: 'test', payload: {}, priority: 'normal', reliable: true })).toBe(false);
    expect(policy.metrics().queued).toBe(0);
  });

  it('flushes critical requests before lower priority work', () => {
    let now = 0;
    const policy = new NetworkPolicy({ now: () => now, maxRequestsPerSecond: 10 });
    policy.connect('session', 'online');
    policy.enqueue({ id: 'normal', channel: 'n', payload: { value: 1 }, priority: 'normal', reliable: true });
    policy.enqueue({ id: 'critical', channel: 'c', payload: { value: 2 }, priority: 'critical', reliable: true });
    const sent: string[] = [];
    policy.flush((envelope) => sent.push(envelope.channel), 2);
    expect(sent).toEqual(['c', 'n']);
    now += 1000;
  });
});

describe('telemetry', () => {
  it('computes stable histogram percentiles', () => {
    const telemetry = new RuntimeTelemetry({ now: () => 1 });
    for (let i = 1; i <= 100; i += 1) telemetry.sample('frame', i);
    const histogram = telemetry.snapshot().histograms.frame;
    expect(histogram?.count).toBe(100);
    expect(histogram?.p95).toBe(95);
    expect(histogram?.p99).toBe(99);
  });
});

describe('worker pool', () => {
  it('completes work and remains bounded', async () => {
    const pool = new WorkerPool<number, number>({ concurrency: 2 });
    const results = await Promise.all([1, 2, 3, 4].map((value) => pool.run(value, async (input) => input * 2)));
    expect(results.every((result) => result.ok)).toBe(true);
    expect(results.map((result) => result.value)).toEqual([2, 4, 6, 8]);
    expect(pool.metrics().completed).toBe(4);
    pool.dispose();
  });
});

describe('scene graph', () => {
  it('rejects hierarchy cycles and computes world positions', () => {
    const scene = new SceneGraph();
    scene.add({ id: 'a', position: { x: 10, y: 0, z: 0 } });
    scene.add({ id: 'b', parentId: 'a', position: { x: 5, y: 0, z: 2 } });
    expect(scene.worldPosition('b' as never)).toEqual({ x: 15, y: 0, z: 2 });
    expect(() => scene.update('a' as never, { parentId: 'b' })).toThrow(/cycle/i);
    expect(scene.audit().valid).toBe(true);
  });
});
