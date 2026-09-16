import { describe, expect, it } from 'vitest';
import { entityId, tickValue } from '../../src/3d/modern/nextgen/types.ts';
import { NetworkTransportV2 } from '../../src/3d/modern/nextgen/networkTransportV2.ts';
import { WorldStreamingOrchestratorV2 } from '../../src/3d/modern/nextgen/streamingOrchestratorV2.ts';
import { AdaptiveRenderPipelineV2 } from '../../src/3d/modern/nextgen/renderFramePipelineV2.ts';
import { AssetLifecycleManagerV2 } from '../../src/3d/modern/nextgen/assetLifecycleV2.ts';
import { WorkerSchedulerV2 } from '../../src/3d/modern/nextgen/workerSchedulerV2.ts';
import { MemorySaveStorage, SaveSlotManagerV2 } from '../../src/3d/modern/nextgen/saveSlotManagerV2.ts';
import { NextGenRuntimeFacadeV2 } from '../../src/3d/modern/nextgen/nextgenRuntimeFacadeV2.ts';
import { NextGenSimulationCoordinatorV2 } from '../../src/3d/modern/nextgen/simulationCoordinatorV2.ts';
import { createDefaultActor } from '../../src/3d/modern/nextgen/actorSimulationV2.ts';

const player = entityId(1);

describe('network transport v2', () => {
  it('registers defaults, connects and sends packets', () => {
    const transport = new NetworkTransportV2<{ value: number }>();
    transport.registerDefaults();
    transport.connect(tickValue(0));
    const packet = transport.send('commands', { value: 3 }, tickValue(1));
    expect(packet?.channel).toBe('commands');
    expect(transport.flushOutbound(tickValue(1))).toHaveLength(1);
    expect(transport.stats().sentPackets).toBe(1);
  });

  it('rejects invalid checksum packets', () => {
    const transport = new NetworkTransportV2<{ value: number }>();
    transport.registerDefaults();
    transport.connect(tickValue(0));
    const packet = transport.send('state', { value: 1 }, tickValue(1))!;
    expect(transport.injectIncoming({ ...packet, checksum: packet.checksum + 1 })).toBe(false);
  });

  it('tracks peers and reports timeout events', () => {
    const transport = new NetworkTransportV2();
    transport.registerDefaults();
    transport.connect(tickValue(0));
    transport.addPeer({ id: 'p1', ackTick: tickValue(0), lastReceiveTick: tickValue(0), inputLead: 2, rttMs: 40, packetLoss: 0.01 });
    transport.update(tickValue(200));
    expect(transport.events().some((event) => event.type === 'peer-timeout')).toBe(true);
  });
});

describe('streaming orchestrator v2', () => {
  it('prioritizes nearby interest cells', () => {
    const streaming = new WorldStreamingOrchestratorV2();
    streaming.define({ key: 'near', center: { x: 0, y: 0, z: 0 }, radius: 5, class: 'near', estimatedBytes: 100, generationCostMs: 1, dependencyKeys: [] });
    streaming.define({ key: 'far', center: { x: 1000, y: 0, z: 1000 }, radius: 5, class: 'far', estimatedBytes: 100, generationCostMs: 1, dependencyKeys: [] });
    streaming.setInterest({ owner: player, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, viewDistance: 50, priority: 100 });
    const decisions = streaming.plan(tickValue(1));
    expect(decisions[0]?.key).toBe('near');
  });

  it('resolves transitive dependencies', () => {
    const streaming = new WorldStreamingOrchestratorV2();
    streaming.define({ key: 'a', center: { x: 0, y: 0, z: 0 }, radius: 1, class: 'critical', estimatedBytes: 1, generationCostMs: 1, dependencyKeys: [] });
    streaming.define({ key: 'b', center: { x: 0, y: 0, z: 0 }, radius: 1, class: 'near', estimatedBytes: 1, generationCostMs: 1, dependencyKeys: ['a'] });
    streaming.define({ key: 'c', center: { x: 0, y: 0, z: 0 }, radius: 1, class: 'far', estimatedBytes: 1, generationCostMs: 1, dependencyKeys: ['b'] });
    expect(streaming.requiredDependencies('c')).toEqual(['a', 'b']);
  });

  it('accounts resident bytes', () => {
    const streaming = new WorldStreamingOrchestratorV2();
    streaming.define({ key: 'cell', center: { x: 0, y: 0, z: 0 }, radius: 1, class: 'near', estimatedBytes: 1024, generationCostMs: 1, dependencyKeys: [] });
    streaming.markLoading('cell', tickValue(1));
    streaming.markResident('cell', tickValue(2));
    expect(streaming.stats().bytesResident).toBe(1024);
  });
});

describe('render pipeline v2', () => {
  it('builds a dependency-safe standard pipeline', () => {
    const pipeline = new AdaptiveRenderPipelineV2();
    pipeline.registerStandardPasses();
    const result = pipeline.decide({ frame: 1, deltaSeconds: 1 / 60, gpuTimeMs: 4, cpuTimeMs: 5, memoryMB: 400, drawCalls: 500, triangles: 500000, visibleObjects: 100, devicePixelRatio: 1, isMobile: false });
    expect(result.enabledPasses).toContain('opaque');
    expect(() => pipeline.execute({ frame: 1, deltaSeconds: 1 / 60, quality: result.quality, resolutionScale: result.resolutionScale, frameBudgetMs: 16.6 })).not.toThrow();
  });

  it('downshifts under sustained pressure', () => {
    const pipeline = new AdaptiveRenderPipelineV2();
    pipeline.registerStandardPasses();
    const first = pipeline.decide({ frame: 1, deltaSeconds: 1 / 60, gpuTimeMs: 30, cpuTimeMs: 30, memoryMB: 2000, drawCalls: 5000, triangles: 5000000, visibleObjects: 1000, devicePixelRatio: 2, isMobile: false });
    expect(['emergency', 'low', 'medium']).toContain(first.quality);
  });

  it('upshifts after headroom is maintained', () => {
    const pipeline = new AdaptiveRenderPipelineV2();
    pipeline.registerStandardPasses();
    pipeline.setQuality('low');
    for (let frame = 0; frame < 50; frame += 1) pipeline.decide({ frame, deltaSeconds: 1 / 60, gpuTimeMs: 2, cpuTimeMs: 2, memoryMB: 100, drawCalls: 100, triangles: 100000, visibleObjects: 20, devicePixelRatio: 1, isMobile: false });
    expect(['medium', 'high', 'cinematic']).toContain(pipeline.quality);
  });
});

describe('asset lifecycle v2', () => {
  it('queues, starts and completes loads', () => {
    const assets = new AssetLifecycleManagerV2({ maxConcurrentLoads: 2 });
    assets.declare('terrain', '/assets/terrain.glb', 'high');
    assets.request('terrain');
    expect(assets.startNext(1)?.key).toBe('terrain');
    expect(assets.ready('terrain', 4096, 2)?.state).toBe('ready');
    expect(assets.stats().bytes).toBe(4096);
  });

  it('retries failed assets up to configured limit', () => {
    const assets = new AssetLifecycleManagerV2({ maxRetries: 2 });
    assets.declare('x', '/x.glb');
    assets.request('x');
    assets.startNext(1);
    assets.fail('x', 'network', 2);
    expect(assets.get('x')?.state).toBe('queued');
    assets.startNext(3);
    assets.fail('x', 'network', 4);
    expect(assets.get('x')?.state).toBe('queued');
    assets.startNext(5);
    assets.fail('x', 'network', 6);
    expect(assets.get('x')?.state).toBe('failed');
  });

  it('protects referenced assets from eviction', () => {
    const assets = new AssetLifecycleManagerV2({ maxBytes: 100 });
    assets.declare('a', '/a', 'low');
    assets.declare('b', '/b', 'low');
    assets.ready('a', 80, 1);
    assets.ready('b', 80, 2);
    assets.retain('b', 2);
    assets.evict(100, 3);
    expect(assets.get('b')).toBeDefined();
  });
});

describe('worker scheduler v2', () => {
  it('runs high priority jobs first and respects concurrency', async () => {
    const scheduler = new WorkerSchedulerV2({ maxConcurrent: 2 });
    const order: string[] = [];
    scheduler.enqueue({ id: 'low', channel: 'background', priority: 'low', cost: 1, async run() { order.push('low'); return 1; } });
    scheduler.enqueue({ id: 'critical', channel: 'simulation', priority: 'critical', cost: 1, async run() { order.push('critical'); return 2; } });
    await scheduler.pump();
    expect(order[0]).toBe('critical');
    expect(scheduler.stats().completed).toBe(2);
  });

  it('cancels queued work', () => {
    const scheduler = new WorkerSchedulerV2();
    scheduler.enqueue({ id: 'x', channel: 'asset', priority: 'normal', cost: 1, async run() { return 1; } });
    expect(scheduler.cancel('x')).toBe(true);
    expect(scheduler.result('x')?.state).toBe('cancelled');
  });
});

describe('save slot manager v2', () => {
  it('creates and lists save slots', () => {
    const storage = new MemorySaveStorage();
    const manager = new SaveSlotManagerV2(storage);
    const world = { tick: tickValue(5), revision: 1 as never, entities: [], checksum: stableChecksum([]) };
    const envelope = { header: { magic: 'AAPW-SAVE', version: 2, tick: tickValue(5), revision: 1 as never, checksum: stableChecksum({ magic: 'AAPW-SAVE', version: 2, tick: tickValue(5), revision: 1 }) }, world, metadata: {} };
    manager.save('slot1', envelope, { title: 'Test', playtimeSeconds: 12, updatedTick: tickValue(5) });
    expect(manager.list().map((slot) => slot.slot)).toEqual(['slot1']);
  });

  it('exports and imports saves', () => {
    const storage = new MemorySaveStorage();
    const manager = new SaveSlotManagerV2(storage);
    const world = { tick: tickValue(1), revision: 1 as never, entities: [], checksum: stableChecksum([]) };
    const envelope = { header: { magic: 'AAPW-SAVE', version: 2, tick: tickValue(1), revision: 1 as never, checksum: stableChecksum({ magic: 'AAPW-SAVE', version: 2, tick: tickValue(1), revision: 1 }) }, world, metadata: {} };
    manager.save('original', envelope, { title: 'Original', playtimeSeconds: 5, updatedTick: tickValue(1) });
    const encoded = manager.export('original');
    manager.import(encoded, 'copy');
    expect(manager.has('copy')).toBe(true);
  });
});

describe('coordinator and facade', () => {
  it('advances ticks while journal and streaming remain connected', () => {
    const coordinator = new NextGenSimulationCoordinatorV2({ seed: 7 });
    coordinator.actors.spawn(createDefaultActor(player, 'player', { x: 0, y: 0, z: 0 }));
    coordinator.streaming.define({ key: '0:0', center: { x: 0, y: 0, z: 0 }, radius: 10, class: 'critical', estimatedBytes: 100, generationCostMs: 1, dependencyKeys: [] });
    const report = coordinator.step({ deltaSeconds: 1 / 60, interests: [{ owner: player, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, viewDistance: 50, priority: 100 }], targets: [] });
    expect(report.tick).toBe(tickValue(1));
    expect(report.streamDecisions).toBeGreaterThan(0);
    expect(coordinator.journal.stats().eventCount).toBeGreaterThan(0);
  });

  it('facade exposes a single runtime entry point', () => {
    const runtime = new NextGenRuntimeFacadeV2({ seed: 123 });
    runtime.boot();
    runtime.spawnActor(createDefaultActor(player, 'player', { x: 0, y: 0, z: 0 }));
    const before = runtime.summary().digest;
    runtime.step(1 / 60);
    expect(runtime.tick).toBe(tickValue(1));
    expect(runtime.summary().digest).not.toBe(before);
  });
});
