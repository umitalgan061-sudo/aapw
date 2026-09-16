import { describe, expect, it } from 'vitest';
import { entityId, stableChecksum, tickValue } from '../../src/3d/modern/nextgen/types.ts';
import { NetworkTransportV2 } from '../../src/3d/modern/nextgen/networkTransportV2.ts';
import { WorldStreamingOrchestratorV2 } from '../../src/3d/modern/nextgen/streamingOrchestratorV2.ts';
import { AdaptiveRenderPipelineV2 } from '../../src/3d/modern/nextgen/renderFramePipelineV2.ts';
import { AssetLifecycleManagerV2 } from '../../src/3d/modern/nextgen/assetLifecycleV2.ts';
import { WorkerSchedulerV2 } from '../../src/3d/modern/nextgen/workerSchedulerV2.ts';
import { MemorySaveStorage, SaveSlotManagerV2, createSaveEnvelope } from '../../src/3d/modern/nextgen/saveSlotManagerV2.ts';
import { NextGenRuntimeFacadeV2 } from '../../src/3d/modern/nextgen/nextgenRuntimeFacadeV2.ts';
import { createDefaultActor } from '../../src/3d/modern/nextgen/actorSimulationV2.ts';

const player = entityId(1);
const point = (x: number, y = 0, z = 0) => ({ x, y, z });

describe('network transport', () => {
  it('connects and flushes packets by channel priority', () => {
    const transport = new NetworkTransportV2<unknown>();
    transport.registerDefaults();
    transport.connect(tickValue(0));
    transport.send('events', { id: 1 }, tickValue(1));
    transport.send('commands', { id: 2 }, tickValue(1));
    const flushed = transport.flushOutbound(tickValue(1));
    expect(flushed).toHaveLength(2);
    expect(flushed[0]?.channel).toBe('commands');
  });
  it('rejects changed-payload checksum', () => {
    const transport = new NetworkTransportV2<{ value: number }>();
    transport.registerDefaults();
    transport.connect(tickValue(0));
    const packet = transport.send('state', { value: 1 }, tickValue(1))!;
    expect(transport.injectIncoming({ ...packet, payload: { value: 2 } })).toBe(false);
  });
  it('enforces packet byte limits', () => {
    const transport = new NetworkTransportV2<string>({ maxPacketBytes: 200 });
    transport.registerDefaults();
    transport.connect(tickValue(0));
    expect(transport.send('commands', 'x'.repeat(500), tickValue(1))).toBeUndefined();
    expect(transport.stats().droppedPackets).toBeGreaterThan(0);
  });
});

describe('streaming orchestrator', () => {
  it('predicts forward motion', () => {
    const streaming = new WorldStreamingOrchestratorV2();
    streaming.define({ key: 'front', center: point(20), radius: 5, class: 'near', estimatedBytes: 100, generationCostMs: 1, dependencyKeys: [] });
    streaming.define({ key: 'back', center: point(-20), radius: 5, class: 'near', estimatedBytes: 100, generationCostMs: 1, dependencyKeys: [] });
    streaming.setInterest({ owner: player, position: point(0), velocity: point(10), viewDistance: 30, priority: 100 });
    expect(streaming.plan(tickValue(1))[0]?.key).toBe('front');
  });
  it('returns deterministic transitive dependencies', () => {
    const streaming = new WorldStreamingOrchestratorV2();
    streaming.define({ key: 'root', center: point(0), radius: 1, class: 'critical', estimatedBytes: 1, generationCostMs: 1, dependencyKeys: [] });
    streaming.define({ key: 'mid', center: point(0), radius: 1, class: 'near', estimatedBytes: 1, generationCostMs: 1, dependencyKeys: ['root'] });
    streaming.define({ key: 'leaf', center: point(0), radius: 1, class: 'far', estimatedBytes: 1, generationCostMs: 1, dependencyKeys: ['mid'] });
    expect(streaming.requiredDependencies('leaf')).toEqual(['mid', 'root']);
  });
  it('accounts resident bytes', () => {
    const streaming = new WorldStreamingOrchestratorV2();
    streaming.define({ key: 'a', center: point(0), radius: 1, class: 'near', estimatedBytes: 4096, generationCostMs: 1, dependencyKeys: [] });
    streaming.markLoading('a', tickValue(1));
    streaming.markResident('a', tickValue(2));
    expect(streaming.stats().bytesResident).toBe(4096);
  });
});

describe('adaptive rendering', () => {
  it('executes dependencies before dependents', () => {
    const pipeline = new AdaptiveRenderPipelineV2();
    pipeline.registerStandardPasses();
    const order: string[] = [];
    pipeline.pass('depth')!.execute = () => order.push('depth');
    pipeline.pass('opaque')!.execute = () => order.push('opaque');
    const decision = pipeline.decide({ frame: 1, deltaSeconds: 1 / 60, gpuTimeMs: 5, cpuTimeMs: 5, memoryMB: 300, drawCalls: 300, triangles: 300000, visibleObjects: 50, devicePixelRatio: 1, isMobile: false });
    pipeline.execute({ frame: 1, deltaSeconds: 1 / 60, quality: decision.quality, resolutionScale: decision.resolutionScale, frameBudgetMs: 16.6 });
    expect(order.indexOf('depth')).toBeLessThan(order.indexOf('opaque'));
  });
  it('downshifts under pressure', () => {
    const pipeline = new AdaptiveRenderPipelineV2();
    pipeline.registerStandardPasses();
    const decision = pipeline.decide({ frame: 1, deltaSeconds: 1 / 60, gpuTimeMs: 40, cpuTimeMs: 40, memoryMB: 5000, drawCalls: 12000, triangles: 12000000, visibleObjects: 10000, devicePixelRatio: 2, isMobile: true });
    expect(['emergency', 'low', 'medium']).toContain(decision.quality);
  });
  it('upshifts after sustained headroom', () => {
    const pipeline = new AdaptiveRenderPipelineV2();
    pipeline.registerStandardPasses();
    pipeline.setQuality('low');
    for (let frame = 0; frame < 60; frame += 1) pipeline.decide({ frame, deltaSeconds: 1 / 60, gpuTimeMs: 1, cpuTimeMs: 1, memoryMB: 100, drawCalls: 100, triangles: 10000, visibleObjects: 10, devicePixelRatio: 1, isMobile: false });
    expect(pipeline.quality).not.toBe('low');
  });
});

describe('asset lifecycle', () => {
  it('completes a load lifecycle', () => {
    const assets = new AssetLifecycleManagerV2();
    expect(assets.declare('map', '/map.glb', 'high').state).toBe('unknown');
    assets.request('map');
    expect(assets.startNext(1)?.state).toBe('loading');
    expect(assets.ready('map', 8192, 2)?.state).toBe('ready');
  });
  it('protects retained assets from eviction', () => {
    const assets = new AssetLifecycleManagerV2({ maxBytes: 100 });
    assets.declare('a', '/a');
    assets.declare('b', '/b');
    assets.ready('a', 80, 1);
    assets.ready('b', 80, 2);
    assets.retain('b', 2);
    assets.evict(100, 3);
    expect(assets.get('b')).toBeDefined();
  });
  it('retries and then permanently fails assets', () => {
    const assets = new AssetLifecycleManagerV2({ maxRetries: 1 });
    assets.declare('x', '/x');
    assets.request('x');
    assets.startNext(1);
    assets.fail('x', 'offline', 2);
    expect(assets.get('x')?.state).toBe('queued');
    assets.startNext(3);
    assets.fail('x', 'offline', 4);
    expect(assets.get('x')?.state).toBe('failed');
  });
});

describe('worker scheduler', () => {
  it('runs tasks by priority', async () => {
    const scheduler = new WorkerSchedulerV2({ maxConcurrent: 2, budgetMsPerTick: 2 });
    const order: string[] = [];
    scheduler.enqueue({ id: 'low', channel: 'background', priority: 'low', cost: 1, async run() { order.push('low'); return 1; } });
    scheduler.enqueue({ id: 'high', channel: 'simulation', priority: 'high', cost: 1, async run() { order.push('high'); return 2; } });
    const results = await scheduler.pump();
    expect(results.every((result) => result.state === 'completed')).toBe(true);
    expect(order[0]).toBe('high');
  });
  it('cancels queued work', () => {
    const scheduler = new WorkerSchedulerV2();
    scheduler.enqueue({ id: 'cancel-me', channel: 'asset', priority: 'normal', cost: 1, async run() { return 1; } });
    expect(scheduler.cancel('cancel-me')).toBe(true);
    expect(scheduler.result('cancel-me')?.state).toBe('cancelled');
  });
});

describe('save slots', () => {
  it('round-trips a versioned save', () => {
    const storage = new MemorySaveStorage();
    const manager = new SaveSlotManagerV2(storage);
    const world = { tick: tickValue(4), revision: 1, entities: [], checksum: stableChecksum([]) } as const;
    const save = createSaveEnvelope(world, tickValue(4), 1, { mode: 'test' });
    manager.save('slot1', save, { title: 'Test', playtimeSeconds: 4, updatedTick: tickValue(4) });
    expect(manager.load('slot1')?.envelope.header.magic).toBe('AAPW-SAVE');
  });
  it('rejects path traversal slot names', () => {
    const manager = new SaveSlotManagerV2(new MemorySaveStorage());
    expect(() => manager.has('../bad')).toThrow();
  });
});

describe('facade', () => {
  it('boots and advances the unified runtime', () => {
    const runtime = new NextGenRuntimeFacadeV2({ seed: 123 });
    runtime.boot();
    runtime.spawnActor(createDefaultActor(player, 'player', point(0)));
    const before = runtime.summary();
    runtime.step(1 / 60);
    expect(runtime.tick).toBe(tickValue(1));
    expect(runtime.network.state).toBe('online');
    expect(runtime.summary().digest).not.toBe(before.digest);
  });
  it('creates checksum-protected world snapshots', () => {
    const runtime = new NextGenRuntimeFacadeV2({ seed: 7 });
    runtime.spawnActor(createDefaultActor(player, 'player', point(5)));
    const snapshot = runtime.snapshot();
    expect(snapshot.checksum).toBe(stableChecksum(snapshot.entities));
    expect(() => runtime.restore({ ...snapshot, checksum: snapshot.checksum + 1 })).toThrow();
  });
});
