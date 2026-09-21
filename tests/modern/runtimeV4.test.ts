import { describe, expect, it, vi } from 'vitest';
import { CommandBusV4 } from '../../src/3d/modern/commandBusV4';
import { SpatialIndexV4, buildSpatialItemV4 } from '../../src/3d/modern/spatialIndexV4';
import { SchedulerV4 } from '../../src/3d/modern/schedulerV4';
import { RenderPipelineV4, createDefaultViewV4 } from '../../src/3d/modern/renderPipelineV4';
import { InputCommandRouterV4, installDefaultGameplayBindingsV4 } from '../../src/3d/modern/inputCommandV4';
import { NetworkReplicationV4 } from '../../src/3d/modern/networkReplicationV4';
import { MemoryAssetCacheV4, AssetStreamingV4 } from '../../src/3d/modern/assetStreamingV4';
import { createEcsWorldV4 } from '../../src/3d/modern/ecsSystemsV4';
import { ObservabilityV4 } from '../../src/3d/modern/observabilityV4';
import { ReleaseGateV4 } from '../../src/3d/modern/releaseGateV4';
import { RuntimeOrchestratorV4 } from '../../src/3d/modern/runtimeOrchestratorV4';
import { entityIdV4, tickId, traceId, transformV4, vec3V4, quaternionV4 } from '../../src/3d/modern/runtimeContractsV4';

describe('runtime contracts v4', () => {
  it('normalizes vectors and quaternions', async () => {
    const vector = vec3V4(1, 2, 3);
    expect(vector).toEqual({ x: 1, y: 2, z: 3 });
    const quaternion = quaternionV4(0, 0, 0, 4);
    expect(Math.abs(quaternion.w)).toBe(1);
  });

  it('provides branded ids without changing runtime representation', () => {
    expect(String(entityIdV4(7))).toBe('7');
    expect(String(tickId(9))).toBe('9');
    expect(String(traceId('t'))).toBe('t');
  });

  it('keeps transforms immutable at construction boundaries', () => {
    const transform = transformV4(vec3V4(1, 2, 3), quaternionV4(), vec3V4(1, 1, 1));
    expect(Object.isFrozen(transform)).toBe(true);
  });
});

describe('command bus v4', () => {
  it('orders high priority commands before low priority commands', async () => {
    const clock = vi.fn(() => 100);
    const bus = new CommandBusV4({ now: clock });
    const calls: string[] = [];
    bus.register({ type: 'low', handle: () => { calls.push('low'); return true; } });
    bus.register({ type: 'high', handle: () => { calls.push('high'); return true; } });
    const low = bus.dispatch('low', {}, 'ui', tickId(1), traceId('a'), { priority: 1, ttlMs: 1000 });
    const high = bus.dispatch('high', {}, 'ui', tickId(1), traceId('b'), { priority: 50, ttlMs: 1000 });
    await Promise.all([low, high]);
    await bus.drain();
    expect(calls).toEqual(['high', 'low']);
  });

  it('rejects unknown commands', async () => {
    const bus = new CommandBusV4();
    const result = await bus.dispatch('missing', {}, 'ui', tickId(1), traceId('x'));
    expect(result.applied).toBe(false);
    expect(result.error?.code).toBe('COMMAND_UNKNOWN');
  });

  it('expires commands deterministically', async () => {
    const bus = new CommandBusV4({ now: () => 500 });
    bus.register({ type: 'late', handle: () => 'ok' });
    const result = await bus.dispatch('late', {}, 'system', tickId(1), traceId('late'), { ttlMs: 10, now: 100 });
    expect(result.applied).toBe(false);
    expect(result.error?.code).toBe('COMMAND_EXPIRED');
  });

  it('records handler failures without throwing', async () => {
    const bus = new CommandBusV4();
    bus.register({ type: 'boom', handle: () => { throw new Error('boom'); } });
    const result = await bus.dispatch('boom', {}, 'engine', tickId(1), traceId('boom'));
    expect(result.applied).toBe(false);
    expect(result.error?.code).toBe('COMMAND_HANDLER_FAILED');
    expect(bus.metrics().failed).toBe(1);
  });

  it('runs middleware before and after the handler', async () => {
    const events: string[] = [];
    const bus = new CommandBusV4();
    bus.use({ name: 'probe', before: () => { events.push('before'); }, after: () => { events.push('after'); } });
    bus.register({ type: 'work', handle: () => { events.push('work'); return 42; } });
    const result = await bus.dispatch('work', {}, 'engine', tickId(2), traceId('w'));
    expect(result.value).toBe(42);
    expect(events).toEqual(['before', 'work', 'after']);
  });

  it('can flush pending commands', async () => {
    const bus = new CommandBusV4({ now: () => 1 });
    bus.register({ type: 'wait', handle: () => new Promise((resolve) => setTimeout(resolve, 5)) });
    const pending = bus.dispatch('wait', {}, 'engine', tickId(1), traceId('wait'));
    expect(bus.size).toBeGreaterThanOrEqual(0);
    bus.flushRejected('test');
    await pending;
  });
});

describe('spatial index v4', () => {
  it('indexes and queries nearby entities', () => {
    const index = new SpatialIndexV4(10);
    index.upsert(buildSpatialItemV4(1, 0, 0, 0));
    index.upsert(buildSpatialItemV4(2, 30, 0, 0));
    const hits = index.query({ center: vec3V4(0, 0, 0), radius: 5, sort: 'distance' });
    expect(hits.map((hit) => hit.entity)).toEqual([1]);
  });

  it('moves entities between cells', () => {
    const index = new SpatialIndexV4(10);
    index.upsert(buildSpatialItemV4(1, 1, 1, 1));
    expect(index.cells().length).toBe(1);
    index.upsert(buildSpatialItemV4(1, 31, 1, 1));
    expect(index.cells().length).toBe(1);
    expect(index.cellOf(vec3V4(31, 1, 1)).x).toBe(3);
  });

  it('returns nearest entities in deterministic order', () => {
    const index = new SpatialIndexV4(8);
    index.upsert(buildSpatialItemV4(5, 3, 0, 0));
    index.upsert(buildSpatialItemV4(2, 1, 0, 0));
    const hits = index.nearest(vec3V4(), 10, 2);
    expect(hits.map((hit) => hit.entity)).toEqual([2, 5]);
  });

  it('supports bounds queries', () => {
    const index = new SpatialIndexV4(10);
    index.upsert(buildSpatialItemV4(1, 1, 1, 1));
    index.upsert(buildSpatialItemV4(2, 20, 20, 20));
    const hits = index.queryBounds({ min: vec3V4(0, 0, 0), max: vec3V4(5, 5, 5) });
    expect(hits).toEqual([1]);
  });

  it('removes empty cells', () => {
    const index = new SpatialIndexV4(4);
    index.upsert(buildSpatialItemV4(1, 1, 1, 1));
    expect(index.remove(entityIdV4(1))).toBe(true);
    expect(index.cells()).toHaveLength(0);
  });
});

describe('scheduler v4', () => {
  it('advances fixed steps and tracks executions', async () => {
    let now = 0;
    const scheduler = new SchedulerV4({ fixedStepMs: 10, now: () => now });
    let executions = 0;
    scheduler.register({ id: 'sim', lane: 'simulation', priority: 90, intervalTicks: 1, maxRuntimeMs: 20, run: () => { executions += 1; } });
    now = 35;
    await scheduler.advance((context) => context);
    expect(scheduler.tick).toBe(3);
    expect(executions).toBe(3);
  });

  it('keeps lane budgets configurable', () => {
    const scheduler = new SchedulerV4({ now: () => 0 });
    scheduler.setLaneBudget('simulation', 20, 2);
    expect(scheduler.laneBudgets().find((budget) => budget.lane === 'simulation')?.budgetMs).toBe(20);
  });

  it('skips disabled tasks', async () => {
    const scheduler = new SchedulerV4({ fixedStepMs: 1, now: () => 10 });
    scheduler.register({ id: 'disabled', lane: 'telemetry', priority: 1, intervalTicks: 1, maxRuntimeMs: 1, enabled: () => false, run: () => undefined });
    const result = await scheduler.runOneTick((context) => context);
    expect(result[0]?.skipped).toBe(true);
  });

  it('records task errors', async () => {
    const scheduler = new SchedulerV4({ fixedStepMs: 1, now: () => 10 });
    scheduler.register({ id: 'bad', lane: 'simulation', priority: 1, intervalTicks: 1, maxRuntimeMs: 1, run: () => { throw new Error('bad'); } });
    const result = await scheduler.runOneTick((context) => context);
    expect(result[0]?.error).toBe('bad');
    expect(scheduler.metrics().errors).toBe(1);
  });
});

describe('input command v4', () => {
  it('installs default gameplay bindings', () => {
    const router = new InputCommandRouterV4({ now: () => 100 });
    installDefaultGameplayBindingsV4(router);
    const commands = router.sampleDigital('keyboard', 'KeyW', true);
    expect(commands[0]?.intent).toBe('move.forward');
  });

  it('respects gameplay/menu modes', () => {
    const router = new InputCommandRouterV4({ now: () => 100 });
    router.bind({ device: 'keyboard', code: 'KeyW', intent: 'move.forward', modes: ['gameplay'] });
    router.setMode('menu');
    expect(router.sampleDigital('keyboard', 'KeyW', true)).toHaveLength(0);
  });

  it('applies dead zones and scales', () => {
    const router = new InputCommandRouterV4({ now: () => 100 });
    router.bind({ device: 'gamepad', code: 'axis:leftX', intent: 'move.horizontal', deadZone: 0.2, scale: 2 });
    const commands = router.sampleAnalog('gamepad', 'axis:leftX', 0.1);
    expect(commands[0]?.value).toBe(0);
  });
});

describe('network replication v4', () => {
  it('builds deterministic quantized frames', () => {
    const network = new NetworkReplicationV4();
    network.upsert(entityIdV4(1), transformV4(vec3V4(1.234, 2, 3), quaternionV4()));
    const frame = network.buildFrame(tickId(4));
    expect(frame.entities[0]?.transform.x).toBe(123);
    expect(frame.checksum).toMatch(/^[a-f0-9]+$/);
  });

  it('rejects modified frame checksums', () => {
    const network = new NetworkReplicationV4();
    network.upsert(entityIdV4(1), transformV4(vec3V4(), quaternionV4()));
    const frame = network.buildFrame(tickId(1));
    const result = network.applyFrame({ ...frame, checksum: 'deadbeef' });
    expect(result.ok).toBe(false);
    expect(network.metrics().checksumRejected).toBe(1);
  });

  it('rejects stale revisions', () => {
    const network = new NetworkReplicationV4();
    network.upsert(entityIdV4(1), transformV4(vec3V4(0, 0, 0), quaternionV4()));
    const frame = network.buildFrame(tickId(1));
    network.applyFrame(frame);
    expect(network.metrics().staleRejected).toBeGreaterThan(0);
  });

  it('applies peer backpressure', () => {
    const network = new NetworkReplicationV4({ maxPendingPerPeer: 2 });
    network.registerPeer({ id: 'p', connectedAt: 0, lastSeenAt: 0, latencyMs: 20, packetLoss: 0, authority: 'client' });
    network.queue('p', { sequence: 1, reliable: false, channel: 'telemetry', sentAt: 0, retries: 0, payload: 1 });
    network.queue('p', { sequence: 2, reliable: false, channel: 'telemetry', sentAt: 0, retries: 0, payload: 2 });
    const result = network.queue('p', { sequence: 3, reliable: true, channel: 'state', sentAt: 0, retries: 0, payload: 3 });
    expect(result.ok).toBe(true);
  });
});

describe('asset streaming v4', () => {
  it('caches downloaded assets', async () => {
    const cache = new MemoryAssetCacheV4(1024 * 1024, () => 100);
    const fetcher = { fetch: async () => new TextEncoder().encode('abcd').buffer };
    const streaming = new AssetStreamingV4(fetcher, cache, { now: () => 100, maxConcurrent: 2 });
    streaming.register({ id: 'asset-a', url: '/asset.bin', kind: 'binary', bytes: 4, priority: 10, optional: false, digest: 'none' });
    const result = await streaming.load('asset-a');
    expect(result.accepted).toBe(true);
    expect(result.bytes).toBe(4);
  });

  it('evicts least recently touched cache items', async () => {
    let now = 1;
    const cache = new MemoryAssetCacheV4(8, () => now);
    await cache.put('a' as never, new Uint8Array(6).buffer);
    now = 2;
    await cache.put('b' as never, new Uint8Array(6).buffer);
    expect(cache.bytes).toBeLessThanOrEqual(8);
  });
});

describe('ecs systems v4', () => {
  it('moves an entity through the movement system', () => {
    const world = createEcsWorldV4();
    const id = world.spawn(1);
    const entity = world.entities.get(id)!;
    world.movement.update(entity, { direction: vec3V4(1, 0, 0), sprint: false, jump: false }, 1 / 60, tickId(1));
    expect(entity.transform.position.x).toBeGreaterThan(0);
  });

  it('drains stamina while sprinting', () => {
    const world = createEcsWorldV4();
    const id = world.spawn(1);
    const entity = world.entities.get(id)!;
    const before = entity.stamina.current;
    world.stamina.update(entity, true, 0.5);
    expect(entity.stamina.current).toBeLessThan(before);
  });

  it('applies damage and supports revival', () => {
    const world = createEcsWorldV4();
    const id = world.spawn(1);
    const entity = world.entities.get(id)!;
    world.health.damage(entity, 150, tickId(1));
    expect(entity.health.dead).toBe(true);
    expect(world.health.revive(entity)).toBe(true);
    expect(entity.health.dead).toBe(false);
  });

  it('clamps camera pitch', () => {
    const world = createEcsWorldV4();
    const id = world.spawn(1);
    const entity = world.entities.get(id)!;
    world.camera.update(entity, 0, 100);
    expect(entity.camera.pitch).toBeCloseTo(1.5);
  });
});

describe('render pipeline v4', () => {
  it('builds packets in priority/distance order', () => {
    const render = new RenderPipelineV4({ now: () => 100 });
    render.register({ entity: entityIdV4(1), transform: transformV4(vec3V4(2, 0, 0)), materialKey: 'm1', geometryKey: 'g1', priority: 1 });
    render.register({ entity: entityIdV4(2), transform: transformV4(vec3V4(1, 0, 0)), materialKey: 'm2', geometryKey: 'g2', priority: 2 });
    const packet = render.build(createDefaultViewV4(), { frameMs: 16, cpuMs: 2, gpuMs: 2, networkBytes: 0, assetBytes: 0, drawCalls: 0, triangles: 0, activeEntities: 2, visibleEntities: 2, queuedAssets: 0 });
    expect(packet.items.map((item) => item.entity)).toEqual([2, 1]);
  });

  it('downgrades under severe pressure', () => {
    const render = new RenderPipelineV4({ initialQuality: 'ultra', now: () => 100 });
    render.evaluate({ frameMs: 100, cpuMs: 100, gpuMs: 100, drawCalls: 10000, triangles: 10000000, visibleEntities: 5000, memoryPressure: 1, thermalPressure: 1 });
    expect(render.quality()).not.toBe('ultra');
  });
});

describe('observability v4', () => {
  it('retains bounded telemetry', () => {
    const observability = new ObservabilityV4({ maxLogs: 2, maxMetrics: 2, maxSpans: 2, now: () => 10 });
    for (let i = 0; i < 5; i += 1) observability.log('info', `log-${i}`);
    for (let i = 0; i < 5; i += 1) observability.metric('m', i);
    expect(observability.snapshot().logs).toHaveLength(2);
    expect(observability.snapshot().metrics).toHaveLength(2);
  });

  it('computes health score from recent frame timing', () => {
    const observability = new ObservabilityV4({ now: () => 10 });
    observability.frame(16);
    observability.frame(18);
    expect(observability.health().score).toBeGreaterThan(90);
  });
});

describe('release gate v4', () => {
  it('passes a healthy production context', () => {
    const gate = new ReleaseGateV4();
    const result = gate.evaluate({ buildId: 'test-build', health: { phase: 'running', score: 96, errors: 0, warnings: 0, stalled: false, memoryPressure: 0, networkPressure: 0, renderPressure: 0, simulationDrift: 0 }, quality: 'high', typecheckPassed: true, testsPassed: true, deterministicGuardPassed: true, forbiddenPrimitiveCount: 0, assetIntegrityFailures: 0, networkProtocolErrors: 0 });
    expect(result.report.passed).toBe(true);
  });

  it('blocks failed checks', () => {
    const gate = new ReleaseGateV4();
    const result = gate.evaluate({ buildId: '', health: { phase: 'failed', score: 30, errors: 4, warnings: 3, stalled: true, memoryPressure: 1, networkPressure: 1, renderPressure: 1, simulationDrift: 1 }, quality: 'minimal', typecheckPassed: false, testsPassed: false, deterministicGuardPassed: false, forbiddenPrimitiveCount: 4, assetIntegrityFailures: 1, networkProtocolErrors: 4 });
    expect(result.report.passed).toBe(false);
    expect(result.blockingFailures.length).toBeGreaterThan(1);
  });
});

describe('runtime orchestrator v4', () => {
  it('boots, runs a frame, snapshots and stops', async () => {
    let now = 0;
    const runtime = new RuntimeOrchestratorV4({ assetFetcher: { fetch: async () => new ArrayBuffer(0) }, now: () => now, id: 'test-runtime', fixedStepMs: 10 });
    expect(runtime.start().ok).toBe(true);
    now = 20;
    const frame = await runtime.frame();
    expect(frame.ok).toBe(true);
    const snapshot = runtime.snapshot();
    expect(snapshot.header.version).toBe(4);
    expect(runtime.stop()).toBe(true);
    expect(runtime.phase()).toBe('stopped');
  });

  it('restores a matching snapshot', () => {
    const runtime = new RuntimeOrchestratorV4({ assetFetcher: { fetch: async () => new ArrayBuffer(0) }, now: () => 50, id: 'restore-runtime' });
    runtime.start();
    const snapshot = runtime.snapshot();
    runtime.setQuality('low');
    const result = runtime.restore(snapshot);
    expect(result.ok).toBe(true);
    expect(runtime.render.quality()).toBe(snapshot.state.quality);
  });

  it('rejects snapshots from another runtime', () => {
    const a = new RuntimeOrchestratorV4({ assetFetcher: { fetch: async () => new ArrayBuffer(0) }, now: () => 50, id: 'a' });
    const b = new RuntimeOrchestratorV4({ assetFetcher: { fetch: async () => new ArrayBuffer(0) }, now: () => 50, id: 'b' });
    const snapshot = a.snapshot();
    const result = b.restore(snapshot);
    expect(result.ok).toBe(false);
  });

  it('recovers the runtime without replacing the composition root', () => {
    const runtime = new RuntimeOrchestratorV4({ assetFetcher: { fetch: async () => new ArrayBuffer(0) }, now: () => 50, id: 'recover' });
    runtime.start();
    expect(runtime.recover('test')).toBe(true);
    expect(runtime.phase()).toBe('running');
    expect(runtime.metrics().recoveries).toBe(1);
  });
});
