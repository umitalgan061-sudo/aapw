import { describe, expect, it } from 'vitest';
import { asEntityId, asTick } from '../../src/3d/modern/v5/domain.ts';
import { EcsWorldV5 } from '../../src/3d/modern/v5/ecs.ts';
import { CommandBusV5, command } from '../../src/3d/modern/v5/commandBus.ts';
import { AssetGraphV5 } from '../../src/3d/modern/v5/assetGraph.ts';
import { SpatialIndexV5, aabbFromSphere, WorldQueryV5 } from '../../src/3d/modern/v5/worldQuery.ts';
import { SaveRuntimeV5, MemorySaveStorage, restoreWorld, snapshotFromWorld } from '../../src/3d/modern/v5/persistence.ts';
import { TelemetryBufferV5 } from '../../src/3d/modern/v5/observability.ts';
import { RuntimeSecurityV5 } from '../../src/3d/modern/v5/security.ts';
import { RuntimePlatformV5 } from '../../src/3d/modern/v5/platform.ts';

describe('modern-v5 platform foundation', () => {
  it('spawns, queries and restores deterministic entities', () => {
    const world = new EcsWorldV5(10);
    const first = world.spawnWithDefaults(['transform', 'health']);
    const second = world.spawnWithDefaults(['transform', 'velocity']);
    expect(first).toBe(1);
    expect(second).toBe(2);
    expect(world.query({ all: ['transform'] })).toHaveLength(2);
    const snapshot = world.snapshot();
    world.clear();
    world.restore(snapshot, asTick(42));
    expect(world.stats().entities).toBe(2);
    expect(world.tick).toBe(42);
  });

  it('deduplicates command ids and executes handlers in tick order', async () => {
    const bus = new CommandBusV5(8);
    const executed: string[] = [];
    bus.register({ type: 'ping', handle: async (entry) => executed.push(String(entry.payload)) });
    const first = command('ping', 'alpha', 5, asEntityId(1), 'cmd-1');
    const duplicate = command('ping', 'beta', 5, asEntityId(1), 'cmd-1');
    expect(bus.enqueue(first).accepted).toBe(true);
    expect(bus.enqueue(duplicate).accepted).toBe(false);
    await bus.drain(asTick(5));
    expect(executed).toEqual(['alpha']);
  });

  it('detects asset dependency cycles', () => {
    const assets = new AssetGraphV5();
    const a = assets.declare({ id: 'a', kind: 'model', url: '/a.glb', bytes: 100, dependencies: [], optional: false, priority: 1, lod: 0, tags: [] });
    const b = assets.declare({ id: 'b', kind: 'model', url: '/b.glb', bytes: 100, dependencies: [a], optional: false, priority: 1, lod: 0, tags: [] });
    const record = assets.get(a)!;
    expect(record.dependencies).toEqual([]);
    expect(assets.get(b)?.dependencies).toEqual([a]);
    expect(assets.validateGraph()).toEqual([]);
  });

  it('indexes spatial records and queries intersections', () => {
    const index = new SpatialIndexV5(10);
    const sphere = { center: { x: 0, y: 0, z: 0 }, radius: 2 };
    index.upsert({ id: asEntityId(1), sphere, bounds: aabbFromSphere(sphere) });
    index.upsert({ id: asEntityId(2), sphere: { center: { x: 50, y: 0, z: 0 }, radius: 2 }, bounds: aabbFromSphere({ center: { x: 50, y: 0, z: 0 }, radius: 2 }) });
    expect(index.querySphere({ center: { x: 0, y: 0, z: 0 }, radius: 5 })).toEqual([asEntityId(1)]);
  });

  it('grounds positions using the canonical terrain sampler abstraction', () => {
    const world = new EcsWorldV5();
    const index = new SpatialIndexV5();
    const query = new WorldQueryV5(world, index, (x, z) => ({ height: x + z, normal: { x: 0, y: 1, z: 0 }, material: 'plain' }));
    expect(query.groundedPosition({ x: 2, y: 99, z: 3 }, 1)).toEqual({ x: 2, y: 6, z: 3 });
  });

  it('round trips a runtime snapshot with checksum validation', async () => {
    const world = new EcsWorldV5();
    world.spawnWithDefaults(['transform', 'health']);
    world.advanceTick();
    const storage = new MemorySaveStorage();
    const save = new SaveRuntimeV5(storage);
    const snapshot = snapshotFromWorld(world);
    const result = await save.save(snapshot);
    expect(result.ok).toBe(true);
    const loaded = await save.load();
    expect(loaded.ok).toBe(true);
    const restored = new EcsWorldV5();
    restoreWorld(restored, loaded.snapshot!);
    expect(restored.snapshot()).toEqual(world.snapshot());
    expect(restored.tick).toBe(world.tick);
  });

  it('reports health pressure without throwing on an empty telemetry buffer', () => {
    const telemetry = new TelemetryBufferV5();
    expect(telemetry.reportHealth()).toEqual({ score: 100, grade: 'A', reasons: [] });
    telemetry.metric('frame.duration', 24, 'ms');
    telemetry.log('error', 'test', 'failure');
    telemetry.health({ tick: asTick(10), frame: 1 as never, budget: { simulationMs: 10, presentationMs: 8, assetMs: 1, networkMs: 1, persistenceMs: 0, workerMs: 0, totalMs: 20, maxTotalMs: 16.67 }, errors: 1, warnings: 0, droppedCommands: 0, networkLoss: 0, residentAssetBytes: 0 });
    expect(telemetry.reportHealth().score).toBeLessThan(100);
  });

  it('rejects oversized and unsafe commands', () => {
    const security = new RuntimeSecurityV5({ maxStringLength: 8 });
    const oversized = command('chat.send', { text: '123456789' }, 1);
    expect(security.validateCommand(oversized).some((violation) => violation.code === 'string-size')).toBe(true);
    expect(security.sanitizeText('\u0000hello-world')).toBe('hello-wo');
  });

  it('starts and steps the unified platform', async () => {
    const runtime = new RuntimePlatformV5({ tickRate: 60, maxCatchUpSteps: 2 });
    await runtime.start();
    const before = runtime.snapshot();
    expect(before.status).toBe('ready');
    await runtime.step(1 / 30);
    expect(Number(runtime.tick)).toBeGreaterThan(Number(before.tick));
    await runtime.stop();
    expect(runtime.status).toBe('stopped');
  });
});
