import { describe, expect, it } from 'vitest';
import { AssetPipelineR26, createNoopAssetLoaderR26 } from '../../../src/3d/modern/r26/assetPipeline.ts';
import { InputRuntimeR26 } from '../../../src/3d/modern/r26/inputRuntime.ts';
import { NetworkSessionR26 } from '../../../src/3d/modern/r26/networkTransport.ts';
import { ObservabilityR26 } from '../../../src/3d/modern/r26/observability.ts';
import { RenderPipelineR26, createStandardR26RenderPipeline } from '../../../src/3d/modern/r26/renderPipeline.ts';
import { SimulationKernelR26, createSimulationTaskR26 } from '../../../src/3d/modern/r26/simulationKernel.ts';
import { WorldSpatialRuntimeR26 } from '../../../src/3d/modern/r26/worldSpatialRuntime.ts';

describe('R26 runtime foundation', () => {
  it('executes simulation tasks under deterministic phase order', async () => {
    const kernel = new SimulationKernelR26({ maxFrameMs: 50, maxTasksPerTick: 16 });
    const trace: string[] = [];
    kernel.register(createSimulationTaskR26('z', ({ phase }) => trace.push(phase), {
      phase: 'simulation',
      priority: 1,
    }));
    kernel.register(createSimulationTaskR26('a', ({ phase }) => trace.push(phase), {
      phase: 'input',
      priority: 2,
    }));
    const frame = await kernel.step(1 / 60);
    expect(trace).toEqual(['input', 'simulation']);
    expect(frame.tick).toBe(1);
    expect(frame.digest).toMatch(/^[0-9a-f]{8}$/);
  });

  it('detects render hazards and produces a standard pass plan', () => {
    const pipeline = createStandardR26RenderPipeline();
    const plan = pipeline.compile(1);
    expect(plan.passes.length).toBeGreaterThan(3);
    expect(plan.hazards).toEqual([]);
    expect(plan.gpuEstimateMs).toBeLessThan(16.67);
  });

  it('enforces dependency-aware asset loading', async () => {
    const pipeline = new AssetPipelineR26(createNoopAssetLoaderR26(), {
      maxResidentBytes: 10_000,
      maxInFlightBytes: 10_000,
      maxConcurrent: 2,
    });
    pipeline.declare({
      id: 'material',
      url: 'https://cdn.example.test/material',
      kind: 'binary',
      dependencies: [],
      priority: 'high',
      estimatedBytes: 1000,
      optional: false,
      tags: ['material'],
    });
    pipeline.declare({
      id: 'hero',
      url: 'https://cdn.example.test/hero',
      kind: 'model',
      dependencies: ['material'],
      priority: 'critical',
      estimatedBytes: 2000,
      optional: false,
      tags: ['hero'],
    });
    expect((await pipeline.load('hero'))).toBeNull();
    expect((await pipeline.load('material'))?.state).toBe('ready');
    expect((await pipeline.load('hero'))?.state).toBe('ready');
    expect(pipeline.snapshot().residentBytes).toBe(3000);
  });

  it('reconciles network state and retains post-authoritative input', () => {
    const session = new NetworkSessionR26<{ x: number }>();
    session.setPredictedState({ x: 8 }, 8);
    session.submitInput(7, { delta: 1 }, 112);
    session.submitInput(8, { delta: 2 }, 128);
    session.submitInput(9, { delta: 3 }, 144);
    const result = session.reconcile(
      { x: 5 },
      6,
      (state, frame) => ({ x: state.x + Number((frame.payload as { delta: number }).delta) }),
      (a, b) => Math.abs(a.x - b.x),
    );
    expect(result.corrected).toBe(true);
    expect(result.state.x).toBe(11);
    expect(result.replayed.map((item) => item.tick)).toEqual([7, 8, 9]);
  });

  it('queries spatial cells deterministically', () => {
    const spatial = new WorldSpatialRuntimeR26(10);
    spatial.insert({ id: 'a', x: 2, y: 0, z: 2, radius: 1, layer: 'npc', priority: 5, tags: ['enemy'] });
    spatial.insert({ id: 'b', x: 24, y: 0, z: 0, radius: 1, layer: 'npc', priority: 1, tags: ['friendly'] });
    expect(spatial.query({
      center: { x: 0, y: 0, z: 0 },
      radius: 5,
      layer: 'npc',
      tags: ['enemy'],
    }).map((item) => item.id)).toEqual(['a']);
    expect(spatial.nearest({ x: 1, y: 0, z: 1 })?.id).toBe('a');
    expect(spatial.digest()).toMatch(/^[0-9a-f]{8}$/);
  });

  it('normalizes input and supports replay encoding', () => {
    const input = new InputRuntimeR26(64);
    input.registerBinding({
      action: 'jump',
      context: 'gameplay',
      device: 'keyboard',
      code: 'Space',
      consume: true,
    });
    const actions = input.handle({
      device: 'keyboard',
      code: 'Space',
      phase: 'pressed',
      timestampMs: 16,
    });
    expect(actions[0]?.id).toBe('jump');
    input.setAxis('moveX', 0.75);
    expect(input.axis('moveX')).toBeGreaterThan(0);
    const encoded = input.serializeActions(actions);
    expect(input.replay(encoded)[0]?.id).toBe('jump');
  });

  it('collects bounded telemetry primitives', () => {
    const telemetry = new ObservabilityR26({ maxMetrics: 128, maxSpans: 32, maxIncidents: 8 });
    telemetry.gauge('frame.ms', 12.5, 100);
    telemetry.observe('frame.ms', 12.5);
    telemetry.observe('frame.ms', 14);
    const span = telemetry.beginSpan('tick', 100);
    span.end('info', { frame: 1 }, 104);
    telemetry.incident('warn', 'budget pressure', 1, { pressure: 0.9 }, 104);
    const snapshot = telemetry.snapshot();
    expect(snapshot.metrics.length).toBe(1);
    expect(snapshot.histograms['frame.ms']?.p95).toBeGreaterThanOrEqual(12.5);
    expect(snapshot.spans[0]?.durationMs).toBe(4);
    expect(snapshot.incidents[0]?.severity).toBe('warn');
  });
});

describe('R26 integration boundaries', () => {
  it('keeps standard render resources within the declared memory budget', () => {
    const pipeline = createStandardR26RenderPipeline();
    const plan = pipeline.compile(10);
    const resourceBytes = plan.resources.reduce((sum, resource) => sum + resource.bytes, 0);
    expect(resourceBytes).toBeLessThanOrEqual(768 * 1024 * 1024);
  });

  it('composes network, assets and simulation in one control loop', async () => {
    const simulation = new SimulationKernelR26({ maxFrameMs: 50 });
    const assets = new AssetPipelineR26(createNoopAssetLoaderR26());
    assets.declare({
      id: 'world',
      url: 'https://cdn.example.test/world',
      kind: 'world',
      dependencies: [],
      priority: 'critical',
      estimatedBytes: 128,
      optional: false,
      tags: ['world'],
    });
    await assets.load('world');

    const network = new NetworkSessionR26<{ x: number }>();
    network.setPredictedState({ x: 0 }, 0);
    network.submitInput(1, { delta: 1 }, 16);

    const renderer = new RenderPipelineR26();
    renderer.defineResource({
      id: 'target',
      kind: 'target',
      width: 320,
      height: 180,
      bytes: 320 * 180 * 4,
      transient: false,
    });
    renderer.definePass({
      id: 'present',
      kind: 'ui',
      priority: 1,
      reads: [],
      writes: ['target'],
      dependsOn: [],
      estimatedGpuMs: 0.5,
      estimatedCpuMs: 0.2,
      state: 'ready',
      execute: () => undefined,
    });

    const trace: string[] = [];
    simulation.register(createSimulationTaskR26('control', () => {
      trace.push(
        String(assets.get('world')?.state) +
        ':' +
        String(network.stats(100).inputHistory) +
        ':' +
        String(renderer.compile(1).passes.length),
      );
    }, { phase: 'simulation' }));

    await simulation.step(1 / 60);
    expect(trace).toEqual(['ready:1:1']);
  });
});
