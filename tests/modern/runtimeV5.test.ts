import { describe, expect, it } from 'vitest';
import { RuntimeKernelV5 } from '../../src/3d/modern/runtimeKernelV5';
import { EcsWorldV5 } from '../../src/3d/modern/ecsWorldV5';
import { StateStoreV5 } from '../../src/3d/modern/stateStoreV5';
import { NetcodeV5, createNetworkEntityV5 } from '../../src/3d/modern/netcodeV5';
import { AssetGraphV5 } from '../../src/3d/modern/assetGraphV5';
import { RenderGraphV5 } from '../../src/3d/modern/renderGraphV5';
import { ModernPlatformV5 } from '../../src/3d/modern/platformV5';
import { InputActionMapV5 } from '../../src/3d/modern/inputActionMapV5';
import { WorkerRuntimeV5 } from '../../src/3d/modern/workerRuntimeV5';
import { entityIdV4, tickId, traceId, vec3V4, transformV4, quaternionV4 } from '../../src/3d/modern/runtimeContractsV4';

describe('runtime kernel v5', () => {
  it('starts, advances fixed ticks and snapshots', async () => {
    let now = 0;
    const kernel = new RuntimeKernelV5({ id: 'kernel', now: () => now, fixedStepMs: 10 });
    let runs = 0;
    kernel.register({ name: 'simulation', subsystem: 'simulation', priority: 'critical', maxMs: 5, run: () => { runs += 1; } });
    expect(kernel.start().ok).toBe(true);
    now = 35;
    const report = await kernel.frame();
    expect(report.tick).toBe(3);
    expect(runs).toBe(3);
    const snapshot = kernel.snapshot();
    expect(kernel.restore(snapshot).ok).toBe(true);
  });

  it('bounds long frame deltas and records dropped time', async () => {
    let now = 0;
    const kernel = new RuntimeKernelV5({ now: () => now, fixedStepMs: 10, maxCatchUpSteps: 2, maxFrameDeltaMs: 100 });
    kernel.start();
    now = 1000;
    const report = await kernel.frame();
    expect(report.droppedDeltaMs).toBeGreaterThan(0);
  });

  it('executes higher priority subsystems first', async () => {
    const kernel = new RuntimeKernelV5({ now: () => 100, fixedStepMs: 1 });
    const order: string[] = [];
    kernel.register({ name: 'low', subsystem: 'telemetry', priority: 'low', maxMs: 5, run: () => { order.push('low'); } });
    kernel.register({ name: 'high', subsystem: 'input', priority: 'critical', maxMs: 5, run: () => { order.push('high'); } });
    kernel.start();
    await kernel.frame(1);
    expect(order[0]).toBe('high');
  });
});

describe('ecs world v5', () => {
  it('generates stable entity handles and rejects stale handles', () => {
    const world = new EcsWorldV5({ maxEntities: 10 });
    const spawned = world.spawn(vec3V4(1, 0, 2));
    expect(spawned.ok).toBe(true);
    const handle = spawned.value;
    expect(world.resolve(handle)).toBeTruthy();
    expect(world.destroy(handle)).toBe(true);
    expect(world.resolve(handle)).toBeUndefined();
  });

  it('moves and interpolates entities', () => {
    const world = new EcsWorldV5();
    const handle = world.spawn(vec3V4()).value;
    world.move(handle, { direction: vec3V4(1, 0, 0), sprint: false, jumpPressed: false, crouch: false }, 1 / 60, tickId(1));
    const transform = world.interpolate(handle, 0.5);
    expect(transform?.position.x).toBeGreaterThan(0);
  });

  it('manages stamina and damage', () => {
    const world = new EcsWorldV5();
    const handle = world.spawn().value;
    const entity = world.resolve(handle)!;
    const stamina = entity.stamina.current;
    world.tickStamina(handle, true, 0.5);
    expect(entity.stamina.current).toBeLessThan(stamina);
    expect(world.damage(handle, 25, tickId(2))).toBe(25);
    expect(entity.health.current).toBe(75);
  });

  it('bounds query results', () => {
    const world = new EcsWorldV5();
    for (let i = 0; i < 20; i += 1) world.spawn(vec3V4(i, 0, 0));
    expect(world.queryRadius(vec3V4(), 100, 5)).toHaveLength(5);
  });
});

describe('transactional state store v5', () => {
  it('sets values and exposes versions', () => {
    const store = new StateStoreV5({ now: () => 10 });
    const result = store.set('player.health', 100, 'engine', tickId(1));
    expect(result.ok).toBe(true);
    expect(store.get('player.health')).toBe(100);
    expect(store.version('player.health')).toBe(1);
  });

  it('notifies subscribers without exposing mutable state', () => {
    const store = new StateStoreV5({ now: () => 10 });
    const seen: number[] = [];
    const unsubscribe = store.subscribe<number>('x', (entry) => { if (entry) seen.push(entry.value); });
    store.set('x', 1, 'engine', tickId(1));
    unsubscribe();
    store.set('x', 2, 'engine', tickId(2));
    expect(seen).toEqual([1]);
  });

  it('rejects stale patches', () => {
    const store = new StateStoreV5({ now: () => 10 });
    store.set('x', 1, 'engine', tickId(1));
    const patch = store.set('x', 2, 'engine', tickId(2)).value;
    const stale = { ...patch, baseVersion: 1, nextVersion: 2 };
    expect(store.apply(stale).ok).toBe(false);
  });

  it('commits multi-key transactions atomically', () => {
    const store = new StateStoreV5({ now: () => 10 });
    const tx = store.begin(tickId(1), 'engine', 'tx');
    tx.set('a', 1).set('b', 2);
    expect(tx.commit().ok).toBe(true);
    expect(store.snapshot()).toEqual({ a: 1, b: 2 });
  });
});

describe('asset graph v5', () => {
  it('builds dependency order', () => {
    const graph = new AssetGraphV5();
    graph.declare({ id: 'root' as never, url: '/root', kind: 'scene', bytes: 10, priority: 10, optional: false, digest: 'r' }, ['mesh' as never]);
    graph.declare({ id: 'mesh' as never, url: '/mesh', kind: 'model', bytes: 20, priority: 20, optional: false, digest: 'm' }, ['tex' as never]);
    graph.declare({ id: 'tex' as never, url: '/tex', kind: 'texture', bytes: 30, priority: 30, optional: false, digest: 't' });
    const plan = graph.plan(['root' as never]);
    expect(plan.order).toEqual(['tex', 'mesh', 'root']);
  });

  it('detects cycles', () => {
    const graph = new AssetGraphV5();
    graph.declare({ id: 'a' as never, url: '/a', kind: 'data', bytes: 1, priority: 1, optional: false, digest: 'a' }, ['b' as never]);
    graph.declare({ id: 'b' as never, url: '/b', kind: 'data', bytes: 1, priority: 1, optional: false, digest: 'b' }, ['a' as never]);
    expect(graph.plan(['a' as never]).cycles.length).toBeGreaterThan(0);
  });

  it('cascades invalidation to dependents', () => {
    const graph = new AssetGraphV5();
    graph.declare({ id: 'a' as never, url: '/a', kind: 'data', bytes: 1, priority: 1, optional: false, digest: 'a' });
    graph.declare({ id: 'b' as never, url: '/b', kind: 'data', bytes: 1, priority: 1, optional: false, digest: 'b' }, ['a' as never]);
    expect(graph.invalidate('a' as never)).toEqual(['a', 'b']);
  });
});

describe('netcode v5', () => {
  it('accepts ordered input frames', () => {
    const net = new NetcodeV5<{ move: number }, { tick: number }>();
    net.registerPeer({ id: 'p', connectedAt: 0, lastSeenAt: 0, latencyMs: 20, packetLoss: 0, authority: 'client' });
    const frame = net.receiveInput('p', { move: 1 }, tickId(2), 1);
    expect(frame.ok).toBe(true);
    expect(net.consumeInputs('p')).toHaveLength(1);
  });

  it('rejects stale input ticks', () => {
    const net = new NetcodeV5();
    net.registerPeer({ id: 'p', connectedAt: 0, lastSeenAt: 0, latencyMs: 20, packetLoss: 0, authority: 'client' });
    net.receiveInput('p', {}, tickId(5), 1);
    expect(net.receiveInput('p', {}, tickId(2), 2).ok).toBe(false);
  });

  it('builds and verifies authoritative frames', () => {
    const net = new NetcodeV5<unknown, { score: number }>();
    const frame = net.authoritativeFrame({ score: 10 }, tickId(3));
    expect(net.verifyAuthoritativeFrame(frame)).toBe(true);
  });

  it('corrects entities only within safe bounds', () => {
    const net = new NetcodeV5();
    net.upsertEntity(createNetworkEntityV5(1));
    const correction = net.correctEntity(entityIdV4(1), vec3V4(0.1, 0, 0));
    expect(correction?.accepted).toBe(true);
  });
});

describe('render graph v5', () => {
  it('creates deterministic default pass order', () => {
    const graph = new RenderGraphV5();
    expect(graph.plan().order.length).toBeGreaterThan(5);
    expect(graph.plan().passes[0]).toBe('depth');
  });

  it('rebuilds with custom node dependencies', () => {
    const graph = new RenderGraphV5();
    graph.register({ id: 'custom', pass: 'debug', priority: 1, reads: ['screen'], writes: ['debug'], maxItems: 10 });
    expect(graph.plan().order).toContain('custom');
  });
});

describe('input action map v5', () => {
  it('defines defaults and maps samples', () => {
    const map = new InputActionMapV5({ now: () => 100 });
    map.installGameplayDefaults();
    const events = map.feed({ device: 'keyboard', code: 'KeyW', value: 1, pressed: true, timestamp: 100, sequence: 1 });
    expect(events[0]?.action).toBe('move.forward');
  });

  it('applies analog dead zones', () => {
    const map = new InputActionMapV5({ now: () => 100 });
    map.define({ name: 'look', kind: 'analog', deadZone: 0.2, scale: 1, repeatDelayMs: 0, repeatIntervalMs: 100, modes: ['gameplay'] });
    map.bind({ device: 'gamepad', code: 'axis:x', action: 'look' });
    expect(map.feed({ device: 'gamepad', code: 'axis:x', value: 0.1, pressed: true, timestamp: 100, sequence: 1 })).toHaveLength(0);
  });
});

describe('worker runtime v5', () => {
  it('executes priority work with bounded slots', async () => {
    const workers = new WorkerRuntimeV5({ size: 2, now: () => 100 });
    workers.register('serialization', (payload) => JSON.stringify(payload));
    const result = await workers.dispatch('serialization', { value: 1 }, { priority: 10 });
    expect(result.ok).toBe(true);
    expect(result.value).toBe('{"value":1}');
    expect(workers.metrics().workers).toBe(2);
  });
});

describe('modern platform v5', () => {
  it('boots and exposes composed subsystem metrics', async () => {
    const platform = new ModernPlatformV5({ id: 'platform', now: () => 100, fixedStepMs: 10 });
    expect(platform.boot().ok).toBe(true);
    platform.spawnPlayer(1, 0, 2);
    platform.movePlayer(1, 0, 0, true);
    const frame = await platform.frame({ width: 1280, height: 720, pixelRatio: 1, near: 0.05, far: 1000, position: vec3V4(), forward: vec3V4(0, 0, -1) });
    expect(frame.ok).toBe(true);
    const metrics = platform.metrics();
    expect(metrics.ecs.live).toBe(1);
    expect(metrics.kernel.totalFrames).toBe(1);
  });

  it('round-trips platform snapshots', () => {
    const platform = new ModernPlatformV5({ id: 'snapshot', now: () => 100 });
    platform.boot();
    const snapshot = platform.snapshot();
    expect(platform.restore(snapshot).ok).toBe(true);
  });
});
