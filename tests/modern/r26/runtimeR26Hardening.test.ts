import { describe, expect, it, vi } from 'vitest';
import { AssetGraphV3 } from '../../../src/3d/modern/assetGraphV3.ts';
import { NetworkSessionR26, type NetworkSnapshotR26 } from '../../../src/3d/modern/r26/networkTransport.ts';
import { RuntimeControlPlaneR26 } from '../../../src/3d/modern/r26/runtimeControlPlane.ts';
import { RenderPipelineR26 } from '../../../src/3d/modern/r26/renderPipeline.ts';
import { SimulationKernelR26, createSimulationTaskR26 } from '../../../src/3d/modern/r26/simulationKernel.ts';
import { WorldSpatialRuntimeR26 } from '../../../src/3d/modern/r26/worldSpatialRuntime.ts';

const noOp = (): void => undefined;

describe('R26 hardening invariants', () => {
  it('orders same-phase systems by dependency before priority', async () => {
    const kernel = new SimulationKernelR26({ maxFrameMs: 100 });
    const trace: string[] = [];

    kernel.register(createSimulationTaskR26('consumer', () => {
      trace.push('consumer');
    }, {
      phase: 'simulation',
      priority: 100,
      dependencies: ['producer'],
    }));

    kernel.register(createSimulationTaskR26('producer', () => {
      trace.push('producer');
    }, {
      phase: 'simulation',
      priority: 1,
    }));

    await kernel.step(1 / 60);
    expect(trace).toEqual(['producer', 'consumer']);
  });

  it('rejects same-phase dependency cycles at execution time', async () => {
    const kernel = new SimulationKernelR26({ maxFrameMs: 100 });
    kernel.register(createSimulationTaskR26('a', noOp, {
      phase: 'simulation',
      dependencies: ['b'],
    }));
    kernel.register(createSimulationTaskR26('b', noOp, {
      phase: 'simulation',
      dependencies: ['a'],
    }));

    await expect(kernel.step(1 / 60)).rejects.toThrow('R26_TASK_CYCLE');
  });

  it('keeps large-radius spatial items discoverable across cells', () => {
    const spatial = new WorldSpatialRuntimeR26(10);
    spatial.insert({
      id: 'giant',
      x: 40,
      y: 0,
      z: 0,
      radius: 50,
      layer: 'prop',
      priority: 1,
      tags: ['large'],
    });

    const result = spatial.query({
      center: { x: 0, y: 0, z: 0 },
      radius: 1,
      tags: ['large'],
    });

    expect(result.map((item) => item.id)).toEqual(['giant']);
  });

  it('releases resident bytes during V3 asset invalidation', () => {
    const graph = new AssetGraphV3({ maxResidentBytes: 10_000 });
    graph.declare({
      id: 'shared',
      url: 'https://cdn.example.test/shared',
      kind: 'material',
      dependencies: [],
      priority: 'high',
      estimatedBytes: 2_000,
      optional: false,
    });
    graph.begin('shared');
    graph.complete('shared', 2_500);
    expect(graph.residentBytes()).toBe(2_500);

    graph.invalidate('shared');
    expect(graph.residentBytes()).toBe(0);
    expect(graph.state('shared')).toBe('queued');
  });

  it('detects render hazards for unapproved in-place aliases', () => {
    const pipeline = new RenderPipelineR26();
    pipeline.defineResource({
      id: 'color',
      kind: 'target',
      width: 320,
      height: 180,
      bytes: 320 * 180 * 4,
      transient: false,
    });
    pipeline.definePass({
      id: 'bad',
      kind: 'post',
      priority: 1,
      reads: ['color'],
      writes: ['color'],
      dependsOn: [],
      estimatedGpuMs: 0.1,
      estimatedCpuMs: 0.1,
      state: 'ready',
      execute: noOp,
    });

    expect(pipeline.compile().hazards).toContain('bad:read-write-alias:color');
  });

  it('accepts an explicitly declared in-place pass', () => {
    const pipeline = new RenderPipelineR26();
    pipeline.defineResource({
      id: 'color',
      kind: 'target',
      width: 320,
      height: 180,
      bytes: 320 * 180 * 4,
      transient: false,
    });
    pipeline.definePass({
      id: 'post',
      kind: 'post',
      priority: 1,
      reads: ['color'],
      writes: ['color'],
      dependsOn: [],
      estimatedGpuMs: 0.1,
      estimatedCpuMs: 0.1,
      state: 'ready',
      allowReadWriteAlias: true,
      execute: noOp,
    });

    expect(pipeline.compile().hazards).toEqual([]);
  });

  it('keeps network history bounded while accepting typed control-plane providers', () => {
    const session = new NetworkSessionR26<{ x: number }>({
      maxInputHistory: 16,
      maxSnapshotHistory: 4,
    });

    for (let tick = 1; tick <= 32; tick += 1) {
      session.submitInput(tick, { x: tick }, tick * 16);
      const snapshot: NetworkSnapshotR26<{ x: number }> = {
        tick,
        sequence: tick,
        serverTimeMs: tick * 16,
        state: { x: tick },
        digest: String(tick),
      };
      session.receiveSnapshot(snapshot, tick * 16, 128);
    }

    expect(session.inputsAfterTick(20).length).toBe(12);
    expect(session.latestSnapshot()?.tick).toBe(32);
    expect(session.stats(512).inputHistory).toBe(32 > 16 ? 16 : 32);
  });

  it('uses deterministic control decisions from subsystem observations', () => {
    const simulation = new SimulationKernelR26();
    const renderer = new RenderPipelineR26();
    const assets = {
      snapshot: vi.fn(() => ({ residentBytes: 1_000_000 })),
    } as never;
    const network = {
      stats: vi.fn(() => ({ bytesPerSecond: 10_000 })),
    } as never;

    const control = new RuntimeControlPlaneR26({
      simulation,
      renderer,
      assets,
      network,
    });

    control.start();
    const decision = control.observe({
      frameMs: 12,
      simulationMs: 2,
      gpuMs: 4,
      memoryBytes: 1_000_000,
      networkBytesPerSecond: 10_000,
      failedTasks: 0,
      renderHazards: 0,
    });

    expect(decision.mode).toBe('running');
    expect(decision.qualityScale).toBe(1);
    expect(decision.shouldEvictAssets).toBe(false);
  });

  it('returns a bounded, stable spatial snapshot digest', () => {
    const spatial = new WorldSpatialRuntimeR26(16);
    for (let index = 0; index < 100; index += 1) {
      spatial.insert({
        id: 'item-' + String(index).padStart(3, '0'),
        x: index,
        y: index % 5,
        z: index * 2,
        radius: index % 7,
        layer: index % 2 === 0 ? 'npc' : 'prop',
        priority: index % 11,
        tags: ['runtime', index % 2 === 0 ? 'even' : 'odd'],
      });
    }

    const first = spatial.digest();
    const second = spatial.snapshot().digest;
    expect(first).toBe(second);
    expect(spatial.stats().items).toBe(100);
    expect(spatial.stats().largestCell).toBeGreaterThan(0);
  });
});
