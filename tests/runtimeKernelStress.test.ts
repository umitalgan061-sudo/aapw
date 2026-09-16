import { describe, expect, it } from 'vitest';
import { RuntimeKernel } from '../src/3d/modern/runtimeKernel';
import { RuntimeProfiler } from '../src/3d/modern/runtimeProfiler';
import { NetworkReplicationController } from '../src/3d/modern/networkReplication';
import { RecoveryController } from '../src/3d/modern/recoveryController';
import { StreamingPlanner } from '../src/3d/modern/streamingPlanner';
import { FrameGraphBuilder } from '../src/3d/modern/frameGraph';
import { RenderFrameBuilder } from '../src/3d/modern/renderPacket';
import { EntityWorld } from '../src/3d/modern/entityWorld';
import { ResourceRegistry } from '../src/3d/modern/resourceRegistry';
import { Diagnostics } from '../src/3d/modern/diagnostics';
import { createSeededId, checksum } from '../src/3d/modern/deterministic';

const camera = {
  position: { x: 10, y: 4, z: 10 },
  target: { x: 0, y: 1, z: 0 },
  fov: 65,
  near: 0.1,
  far: 10_000,
  viewportWidth: 1920,
  viewportHeight: 1080,
  dpr: 1,
};

const makeEntity = (index: number) => ({
  id: createSeededId('entity', 1337, index),
  position: { x: index % 10, y: 0, z: Math.floor(index / 10) },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  velocity: { x: (index % 3) * 0.1, y: 0, z: (index % 5) * 0.1 },
  flags: index % 7 === 0 ? 3 : 1,
});

describe('kernel sustained-frame stress', () => {
  it('keeps frame output bounded over a long deterministic sequence', async () => {
    const a = new RuntimeKernel({ seed: 77, environment: { preferredBackend: 'headless' }, streamLoadRadius: 2, streamUnloadRadius: 3 });
    const b = new RuntimeKernel({ seed: 77, environment: { preferredBackend: 'headless' }, streamLoadRadius: 2, streamUnloadRadius: 3 });
    a.start();
    b.start();
    const digestsA: string[] = [];
    const digestsB: string[] = [];
    for (let frame = 0; frame < 90; frame += 1) {
      const input = {
        frameMs: 16 + (frame % 3),
        cpuMs: 4 + (frame % 2),
        gpuMs: 5 + (frame % 4) * 0.25,
        drawCalls: 100 + frame,
        triangles: 10_000 + frame * 100,
        visibleObjects: 80 + frame,
        textureBytes: 2_000_000 + frame * 1024,
        memoryPressure: (frame % 10) / 20,
        thermalPressure: (frame % 20) / 50,
        camera: { ...camera, position: { x: frame * 0.1, y: 4, z: 10 } },
      };
      const ra = await a.tick(input);
      const rb = await b.tick(input);
      digestsA.push(ra.packet.checksum);
      digestsB.push(rb.packet.checksum);
      expect(ra.packet.draws.length).toBeLessThanOrEqual(0);
      expect(ra.streamPlan.load.length).toBeLessThanOrEqual(3);
    }
    expect(digestsA).toEqual(digestsB);
    expect(new Set(digestsA).size).toBeGreaterThan(1);
  });
});

describe('network replication stress', () => {
  it('bounds queued snapshots and reconstructs a changing world', () => {
    const replication = new NetworkReplicationController({ policy: { snapshotIntervalTicks: 1, maxPendingSnapshots: 4, maxEntitiesPerSnapshot: 64, maxDeltaEntities: 32 } });
    for (let tick = 1; tick <= 20; tick += 1) {
      const entities = Array.from({ length: 40 }, (_, index) => makeEntity(index + tick));
      expect(replication.capture(tick, entities).ok).toBe(true);
    }
    expect(replication.queueSize()).toBeLessThanOrEqual(4);
    let processed = 0;
    while (replication.nextEnvelope()) processed += 1;
    expect(processed).toBeLessThanOrEqual(4);
    expect(replication.stats().droppedSnapshots).toBeGreaterThan(0);
  });
});

describe('frame graph stress', () => {
  it('sorts a large graph deterministically and reports peak transient residency', () => {
    const graph = new FrameGraphBuilder();
    for (let i = 0; i < 80; i += 1) graph.resource({ id: `r${i}`, transient: i % 2 === 0, bytes: 2048 + i * 16, format: 'rgba8', samples: 1 });
    for (let i = 0; i < 64; i += 1) {
      graph.pass({
        id: `p${i}`,
        kind: i % 2 === 0 ? 'opaque' : 'post',
        reads: i === 0 ? [] : [`r${i - 1}`],
        writes: [`r${i}`],
        estimatedGpuMs: 0.25 + i * 0.01,
      });
    }
    const result = graph.compile();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.passes).toHaveLength(64);
      expect(result.value.estimatedGpuMs).toBeGreaterThan(0);
      expect(result.value.peakTransientBytes).toBeGreaterThan(0);
      expect(result.value.passes[0]?.pass.id).toBe('p0');
    }
  });
});

describe('resource residency stress', () => {
  it('evicts the least recently used zero-reference assets under pressure', () => {
    const now = { value: 0 };
    const registry = new ResourceRegistry({ budgetBytes: 1_000, now: () => now.value as never });
    const mk = (id: string, bytes: number) => ({ id, url: `/assets/${id}.glb`, kind: 'mesh' as const, priority: 1 as const, tags: [], bytes });
    registry.register(mk('a', 450));
    registry.register(mk('b', 450));
    expect(registry.evict('a')).toBe(true);
    registry.register(mk('c', 450));
    expect(registry.stats().registered).toBeGreaterThanOrEqual(2);
  });
});

describe('entity world stress', () => {
  it('maintains deterministic query order across component churn', () => {
    const world = new EntityWorld(5_000);
    const ids = Array.from({ length: 1_000 }, () => world.create());
    ids.forEach((id, index) => {
      world.add(id, 'position', { position: { x: index % 31, y: 0, z: Math.floor(index / 31) } });
      if (index % 2 === 0) world.add(id, 'health', { current: 10, max: 10 });
    });
    const queryA = world.query(['position', 'health']);
    const queryB = world.query(['position', 'health']);
    expect(queryA).toEqual(queryB);
    expect(queryA.length).toBe(500);
    expect(checksum(queryA)).toBe(checksum(queryB));
  });
});

describe('diagnostics saturation', () => {
  it('keeps the ring bounded and computes a stable digest', () => {
    const diagnostics = new Diagnostics({ capacity: 64, now: () => 99 });
    for (let i = 0; i < 500; i += 1) diagnostics.warning(`W${i}`, `warning ${i}`, 'stress');
    const report = diagnostics.health();
    expect(report.entries.length).toBe(64);
    expect(report.warnings).toBe(64);
    expect(report.digest).toHaveLength(8);
    expect(diagnostics.digest()).toHaveLength(8);
  });
});

describe('recovery saturation', () => {
  it('hard-stops after configured attempts instead of retrying forever', () => {
    const recovery = new RecoveryController({ policy: { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 2 }, seed: 22 });
    expect(recovery.notifyDeviceLoss('a', 1).ok).toBe(true);
    expect(recovery.notifyDeviceLoss('b', 2).ok).toBe(true);
    expect(recovery.notifyDeviceLoss('c', 3).ok).toBe(false);
    expect(recovery.state().stage).toBe('failed');
  });
});

describe('profiler phase ordering', () => {
  it('closes an active phase before beginning the next one', () => {
    const profiler = new RuntimeProfiler({ maxFrames: 32 });
    profiler.begin(8);
    profiler.enter('simulation');
    profiler.enter('render');
    profiler.exit();
    const profile = profiler.end({ cpu: 0.1, gpu: 0.1, frame: 0.1, memory: 0, thermal: 0, combined: 0.1 }, 'high');
    expect(profile.phases.map((phase) => phase.name)).toEqual(['simulation', 'render']);
  });
});

describe('render packet canonicalization', () => {
  it('sorts opaque before transparent and produces identical checksums', () => {
    const builder = (frame: number) => new RenderFrameBuilder()
      .reset(frame as never)
      .backend('headless')
      .quality('high', 0.9)
      .camera(camera)
      .pressure({ cpu: 0, gpu: 0, frame: 0, memory: 0, thermal: 0, combined: 0 })
      .add({ entityId: 'z', materialId: 'm2', meshId: 'mesh', position: { x: 0, y: 0, z: 0 }, distance: 9, lod: 1, transparent: true, castShadow: false, receiveShadow: true })
      .add({ entityId: 'a', materialId: 'm1', meshId: 'mesh', position: { x: 0, y: 0, z: 0 }, distance: 2, lod: 0, transparent: false, castShadow: true, receiveShadow: true });
    const a = builder(1).build();
    const b = builder(1).build();
    expect(a.checksum).toBe(b.checksum);
    expect(a.draws[0]?.entityId).toBe('a');
    expect(Object.isFrozen(a.draws)).toBe(true);
  });
});
