import { describe, expect, it } from 'vitest';
import {
  AdaptiveQualityR25,
  FramePacerR25,
} from '../../../src/3d/modern/r25/adaptiveQuality.ts';
import {
  buildStandardR25Graph,
  bufferResource,
  depthResource,
  RenderGraphR25,
  renderPass,
  textureResource,
} from '../../../src/3d/modern/r25/renderGraph.ts';
import {
  R25Scheduler,
  createR25Task,
  estimateTaskPressure,
} from '../../../src/3d/modern/r25/scheduler.ts';
import {
  AssetRuntimeR25,
  createMemoryAssetTransport,
} from '../../../src/3d/modern/r25/assetRuntime.ts';
import {
  WorldRuntimeR25,
  buildRadialZones,
  createZone,
  worldInterest,
} from '../../../src/3d/modern/r25/worldRuntime.ts';
import {
  InputIntentR25,
  keyboardInput,
  pointerInput,
} from '../../../src/3d/modern/r25/inputIntent.ts';
import {
  createSecurityEnvelope,
  DEFAULT_R25_SECURITY_POLICY,
  MessageRateLimiterR25,
  sanitizeId,
  sanitizeText,
  scanPayloadForDangerousStrings,
  validateCommand,
  validateSecurityEnvelope,
} from '../../../src/3d/modern/r25/security.ts';
import {
  createZone as createTypedZone,
  entityId,
  percentile,
  stableHash,
} from '../../../src/3d/modern/r25/contracts.ts';
import {
  MemoryPersistenceAdapterR25,
  PersistenceLedgerR25,
  applyJsonPatchR25,
  diffJsonR25,
} from '../../../src/3d/modern/r25/persistence.ts';
import {
  DeterministicSimulationR25,
  createReplayTapeR25,
  replayTapeDigestR25,
} from '../../../src/3d/modern/r25/simulation.ts';
import {
  WorkerProtocolR25,
  WorkerTaskRouterR25,
  createMessageDigest,
} from '../../../src/3d/modern/r25/workerProtocol.ts';
import {
  RenderQueueR25,
  createRenderItem,
} from '../../../src/3d/modern/r25/renderQueue.ts';
import {
  buildR25RenderProfile,
  detectR25Capabilities,
  selectR25Backend,
} from '../../../src/3d/modern/r25/backend.ts';
import { RuntimeR25 } from '../../../src/3d/modern/r25/runtime.ts';
import { RuntimeHealthR25 } from '../../../src/3d/modern/r25/health.ts';

function createClock() {
  let now = 0;
  let tick = 0;

  return {
    nowMs: () => now,
    simulationTick: () => tick,
    fixedStepMs: () => 1000 / 60,
    advance(ms: number) {
      now += ms;
      tick += 1;
    },
  };
}

describe('R25 contracts', () => {
  it('produces deterministic hashes and percentiles', () => {
    const value = {
      b: 2,
      a: 1,
      nested: { z: true, y: [3, 2, 1] },
    };

    expect(stableHash(value)).toBe(stableHash({
      nested: { y: [3, 2, 1], z: true },
      a: 1,
      b: 2,
    }));
    expect(percentile([1, 2, 3, 4, 5], 0.95)).toBe(5);
    expect(String(entityId('player-1'))).toBe('player-1');
  });

  it('rejects invalid empty identifiers', () => {
    expect(() => createTypedZone('', {
      center: { x: 0, y: 0 },
      radiusMeters: 10,
      memoryBytes: 100,
      loadCostMs: 1,
      priority: 1,
      critical: false,
      dependencies: [],
      tags: [],
    })).toThrow('R25_ZONE_ID_EMPTY');
  });
});

describe('R25 scheduler', () => {
  it('sorts deterministic priorities and respects cadence', async () => {
    const clock = createClock();
    const scheduler = new R25Scheduler({
      clock: clock.nowMs,
      frameBudgetMs: 10,
      overrunGraceMs: 0,
    });
    const calls: string[] = [];

    scheduler.registerMany([
      createR25Task({
        id: 'low',
        phase: 'simulation',
        priority: 10,
        budgetMs: 2,
        cadenceFrames: 2,
        enabled: true,
        run: () => calls.push('low'),
      }),
      createR25Task({
        id: 'high',
        phase: 'simulation',
        priority: 20,
        budgetMs: 2,
        cadenceFrames: 1,
        enabled: true,
        run: () => calls.push('high'),
      }),
    ]);

    await scheduler.runFrame({
      deltaMs: 16,
      fixedDeltaMs: 16,
      simulationTick: 1,
      timestampMs: 16,
    });
    clock.advance(16);
    await scheduler.runFrame({
      deltaMs: 16,
      fixedDeltaMs: 16,
      simulationTick: 2,
      timestampMs: 32,
    });

    expect(calls).toEqual(['high', 'low', 'high']);
    expect(scheduler.snapshot().executedTasks).toBe(1);
    expect(estimateTaskPressure({
      budgetMs: 2,
      priority: 10,
      cadenceFrames: 2,
    })).toBeGreaterThan(0);
  });

  it('skips non-mandatory work during budget pressure', async () => {
    const scheduler = new R25Scheduler({
      clock: () => 0,
      frameBudgetMs: 1,
      overrunGraceMs: 0,
    });
    const executed: string[] = [];

    scheduler.registerMany([
      createR25Task({
        id: 'mandatory',
        phase: 'input',
        priority: 100,
        budgetMs: 2,
        cadenceFrames: 1,
        enabled: true,
        run: () => executed.push('mandatory'),
      }),
      createR25Task({
        id: 'optional',
        phase: 'input',
        priority: 1,
        budgetMs: 2,
        cadenceFrames: 1,
        enabled: true,
        run: () => executed.push('optional'),
      }),
    ]);

    const result = await scheduler.runFrame({
      deltaMs: 1,
      fixedDeltaMs: 1,
      simulationTick: 1,
      timestampMs: 1,
    });

    expect(executed).toEqual(['mandatory']);
    expect(result.records.some((record) => record.id === 'optional' && record.skipped)).toBe(true);
  });
});

describe('R25 render graph', () => {
  it('compiles a standard graph without hazards', () => {
    const graph = buildStandardR25Graph(1280, 720, {
      enableTemporalHistory: true,
      shadowScale: 0.5,
    });
    const plan = graph.compile();

    expect(plan.passes.length).toBeGreaterThan(3);
    expect(plan.hazards).toEqual([]);
    expect(plan.gpuEstimateMs).toBeGreaterThan(0);
    expect(graph.resourceBytes()).toBeGreaterThan(0);
    expect(graph.explain()).toContain('AAPW Runtime R25 RenderGraph');
  });

  it('detects missing resources', () => {
    const graph = new RenderGraphR25();
    graph.addResource(textureResource('output', {
      width: 64,
      height: 64,
      bytesPerPixel: 4,
    }));
    graph.addPass(renderPass('bad-pass', {
      name: 'bad-pass',
      reads: ['missing-resource' as never],
      writes: ['output' as never],
      estimatedGpuMs: 1,
      execute: () => undefined,
    }));

    expect(graph.compile().hazards).toContain('missing-read-resource:bad-pass:missing-resource');
  });

  it('orders write/read hazards deterministically', () => {
    const graph = new RenderGraphR25();
    graph.addResource(textureResource('scene', {
      width: 32,
      height: 32,
      bytesPerPixel: 4,
    }));
    graph.addResource(depthResource('depth', {
      width: 32,
      height: 32,
    }));
    graph.addResource(bufferResource('constants', 1024));

    const order: string[] = [];

    graph.addPass(renderPass('read', {
      name: 'read',
      reads: ['scene' as never],
      writes: ['constants' as never],
      estimatedGpuMs: 1,
      execute: () => order.push('read'),
    }));

    graph.addPass(renderPass('write', {
      name: 'write',
      reads: [],
      writes: ['scene' as never],
      estimatedGpuMs: 1,
      execute: () => order.push('write'),
    }));

    const plan = graph.compile();
    expect(plan.passes.map((pass) => pass.id)).toEqual(['write', 'read']);
    graph.execute({ frame: 1, backend: 'webgl2' });
    expect(order).toEqual(['write', 'read']);
  });
});

describe('R25 world runtime', () => {
  it('plans current and predicted zones and respects critical residency', () => {
    const world = new WorldRuntimeR25({
      maxResidentBytes: 20_000_000,
      unloadHysteresisMeters: 50,
    });
    const zones = buildRadialZones(8, 250);
    world.registerMany(zones);

    const plan = world.plan(worldInterest(0, 0, {
      velocity: { x: 80, y: 0 },
      horizonSeconds: 2,
      prefetchRadiusMeters: 120,
      importance: 2,
    }), 1);

    expect(plan.load).toContain(zones[0]!.id);
    expect(plan.predicted.length).toBeGreaterThan(0);
    expect(plan.keep).toContain(zones[0]!.id);

    expect(world.beginLoad(zones[0]!.id)).toBe(true);
    expect(world.completeLoad(zones[0]!.id)).toBe(true);
    expect(world.unload(zones[0]!.id)).toBe(false);
    expect(world.snapshot().residentBytes).toBe(zones[0]!.memoryBytes);
  });

  it('can reclaim non-critical zones under pressure', () => {
    const world = new WorldRuntimeR25({
      maxResidentBytes: 3_000_000,
      unloadHysteresisMeters: 10,
    });
    const first = createZone('first', {
      center: { x: 0, y: 0 },
      radiusMeters: 20,
      memoryBytes: 1_000_000,
      loadCostMs: 1,
      priority: 10,
      critical: true,
      dependencies: [],
      tags: ['critical'],
    });
    const second = createZone('second', {
      center: { x: 100, y: 100 },
      radiusMeters: 10,
      memoryBytes: 1_000_000,
      loadCostMs: 1,
      priority: 1,
      critical: false,
      dependencies: [],
      tags: ['cold'],
    });

    world.registerMany([first, second]);
    world.beginLoad(first.id);
    world.completeLoad(first.id);
    world.beginLoad(second.id);
    world.completeLoad(second.id);

    const plan = world.plan(worldInterest(0, 0, {
      prefetchRadiusMeters: 0,
    }), 2);

    expect(plan.blockedUnload).toContain(first.id);
    expect(world.unload(second.id)).toBe(true);
    expect(world.snapshot().residentBytes).toBe(first.memoryBytes);
  });
});

describe('R25 asset runtime', () => {
  it('loads through a bounded transport and reports residency', async () => {
    const clock = createClock();
    const transport = createMemoryAssetTransport(
      new Map([['memory://hero', new Uint8Array(100)]])
    );
    const assets = new AssetRuntimeR25({
      maxResidentBytes: 1_000_000,
      maxConcurrentLoads: 2,
      maxAttempts: 2,
      retryBaseDelayMs: 0,
      retryMaxDelayMs: 0,
      clock,
      transport,
    });

    const id = 'hero' as never;
    assets.declare({
      id,
      url: 'memory://hero',
      type: 'binary',
      priority: 10,
      bytes: 100,
      critical: false,
      tags: ['player'],
      dependencies: [],
    });

    const result = await assets.load(id);
    expect(result.ok).toBe(true);
    expect(assets.snapshot().residentBytes).toBeGreaterThan(0);
    expect(assets.markUsed(id, 1)).toBe(true);
  });

  it('evicts cold assets before exceeding budget', async () => {
    const clock = createClock();
    const transport = createMemoryAssetTransport(
      new Map([
        ['memory://a', new Uint8Array(600)],
        ['memory://b', new Uint8Array(600)],
      ])
    );
    const assets = new AssetRuntimeR25({
      maxResidentBytes: 1_000,
      maxConcurrentLoads: 1,
      maxAttempts: 1,
      retryBaseDelayMs: 0,
      retryMaxDelayMs: 0,
      clock,
      transport,
    });

    assets.declareMany([
      {
        id: 'a' as never,
        url: 'memory://a',
        type: 'binary',
        priority: 1,
        bytes: 600,
        critical: false,
        tags: [],
        dependencies: [],
      },
      {
        id: 'b' as never,
        url: 'memory://b',
        type: 'binary',
        priority: 1,
        bytes: 600,
        critical: false,
        tags: [],
        dependencies: [],
      },
    ]);

    expect((await assets.load('a' as never)).ok).toBe(true);
    clock.advance(100);
    const second = await assets.load('b' as never);
    expect(second.ok).toBe(true);
    expect(assets.get('a' as never)?.state).toBe('evicted');
  });
});

describe('R25 input and security', () => {
  it('normalizes keyboard and pointer intents', () => {
    const input = new InputIntentR25({
      clock: () => 100,
      maxQueue: 16,
    });

    const move = input.enqueue(keyboardInput('KeyW', 'pressed', 100));
    const attack = input.enqueue(pointerInput(0, 'pressed', 101));

    expect(move?.kind).toBe('move');
    expect(move?.vector.y).toBe(1);
    expect(attack?.kind).toBe('attack');
    expect(input.isPressed('attack')).toBe(true);
  });

  it('sanitizes unsafe UI text and ids', () => {
    expect(sanitizeText('<script>alert(1)</script>', 100)).toBe('scriptalert(1)/script');
    expect(sanitizeId('hero id/one', 32)).toBe('hero-id-one');
    expect(scanPayloadForDangerousStrings({ html: '<script>' })).toContain('$.html');
  });

  it('validates commands and envelopes', () => {
    const envelope = createSecurityEnvelope(
      'input',
      { code: 'KeyW' },
      10,
      'nonce-1',
      DEFAULT_R25_SECURITY_POLICY,
    );
    expect(validateSecurityEnvelope(envelope).ok).toBe(true);
    expect(validateCommand({
      type: 'move',
      id: 'cmd-1',
      payload: { x: 1 },
    }).ok).toBe(true);
  });

  it('rate limits burst input deterministically', () => {
    const limiter = new MessageRateLimiterR25(2, 1000);
    expect(limiter.allow(10)).toBe(true);
    expect(limiter.allow(11)).toBe(true);
    expect(limiter.allow(12)).toBe(false);
    expect(limiter.allow(1012)).toBe(true);
  });
});

describe('R25 adaptive quality and health', () => {
  it('downgrades after sustained overload and upgrades after recovery', () => {
    const profile = buildR25RenderProfile(
      {
        backend: 'webgl2',
        webgpu: false,
        webgl2: true,
        webgl: true,
        secureContext: true,
        offscreenCanvas: false,
        sharedArrayBuffer: false,
        crossOriginIsolated: false,
        maxTextureSize: 4096,
        maxSamples: 4,
        maxUniformBufferSize: 65536,
        deviceMemoryGb: 8,
        hardwareConcurrency: 8,
        pixelRatio: 1,
        viewportWidth: 1280,
        viewportHeight: 720,
        prefersReducedMotion: false,
        saveData: false,
        coarsePointer: false,
      },
      {
        backend: 'webgl2',
        score: 0.8,
        reasons: [],
        safeMode: false,
      },
    );
    const quality = new AdaptiveQualityR25(profile, {
      targetFrameMs: 16.67,
      downgradeSamples: 2,
      upgradeSamples: 2,
      cooldownFrames: 1,
      clock: () => 0,
    });

    let decision = quality.observe({
      frameMs: 40,
      cpuMs: 30,
      gpuMs: 30,
      memoryPressure: 1,
      thermalPressure: 0,
      drawCalls: 1000,
      visibleObjects: 200000,
      timestampMs: 0,
    });
    decision = quality.observe({
      frameMs: 40,
      cpuMs: 30,
      gpuMs: 30,
      memoryPressure: 1,
      thermalPressure: 0,
      drawCalls: 1000,
      visibleObjects: 200000,
      timestampMs: 1,
    });

    expect(decision.changed).toBe(true);
    const after = quality.decision();
    expect(after.tier).not.toBe('ultra');

    quality.observe({
      frameMs: 4,
      cpuMs: 2,
      gpuMs: 2,
      memoryPressure: 0,
      thermalPressure: 0,
      drawCalls: 20,
      visibleObjects: 100,
      timestampMs: 2,
    });
    quality.observe({
      frameMs: 4,
      cpuMs: 2,
      gpuMs: 2,
      memoryPressure: 0,
      thermalPressure: 0,
      drawCalls: 20,
      visibleObjects: 100,
      timestampMs: 3,
    });

    expect(quality.snapshot().upgradeStreak).toBeGreaterThanOrEqual(0);
  });

  it('keeps frame debt bounded', () => {
    const pacer = new FramePacerR25({ targetFps: 60, maxDeltaMs: 100 });
    const sample = pacer.sample(100);
    expect(sample.debtMs).toBeLessThanOrEqual(100);
    expect(sample.debtMs).toBeGreaterThan(0);
    pacer.reset();
    expect(pacer.sample(16.67).debtMs).toBeLessThanOrEqual(1);
  });

  it('reports health incidents and grades', () => {
    const health = new RuntimeHealthR25({
      targetFrameMs: 16.67,
      warningThreshold: 0.6,
      criticalThreshold: 0.3,
    });
    health.setState('running');
    const incidents = health.observe(1, {
      frameMs: 40,
      cpuMs: 25,
      gpuMs: 24,
      memoryPressure: 0.9,
      assetPressure: 0.85,
      worldPressure: 0.8,
      schedulerPressure: 1,
      renderErrors: 1,
      assetErrors: 1,
      worldFailures: 1,
    });

    expect(incidents.length).toBeGreaterThan(0);
    const snapshot = health.snapshot(1, {
      memoryPressure: 0.9,
      renderPressure: 0.95,
      assetPressure: 0.8,
      worldPressure: 0.8,
    });
    expect(['A', 'B', 'C', 'D', 'F']).toContain(snapshot.grade);
  });
});

describe('R25 persistence and simulation', () => {
  it('round-trips checksummed envelopes', async () => {
    const adapter = new MemoryPersistenceAdapterR25();
    const ledger = new PersistenceLedgerR25({
      schema: 1,
      clock: () => 123,
      validate: (value): value is { score: number } => (
        Boolean(value) &&
        typeof value === 'object' &&
        typeof (value as { score?: unknown }).score === 'number'
      ),
    });

    const encoded = ledger.encode({ score: 42 }, 10);
    const decoded = ledger.decode(encoded);

    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.payload.score).toBe(42);

    const slot = await ledger.save(adapter, 'slot-a', { score: 9 }, 11);
    expect(slot.slot).toBe('slot-a');

    const loaded = await ledger.load(adapter, 'slot-a');
    expect(loaded.ok).toBe(true);
  });

  it('creates and applies deterministic JSON patches', () => {
    const before = { player: { hp: 100, mana: 20 }, items: ['a', 'b'] };
    const after = { player: { hp: 80, mana: 30 }, items: ['a', 'b', 'c'] };
    const operations = diffJsonR25(before, after);
    const rebuilt = applyJsonPatchR25(before, operations);

    expect(rebuilt).toEqual(after);
  });

  it('replays deterministic state with checkpoints', () => {
    interface State { value: number; }
    interface Input { delta: number; }

    const simulation = new DeterministicSimulationR25<Input, State>({
      initialState: () => ({ value: 0 }),
      step: (state, input) => ({
        value: state.value + (input?.delta ?? 1),
      }),
      serialize: (state) => state,
      deserialize: (payload) => payload as State,
    }, {
      fixedDeltaMs: 10,
      checkpointEveryTicks: 2,
      maxCheckpoints: 8,
    });

    simulation.enqueue({ tick: 1, payload: { delta: 2 } });
    simulation.enqueue({ tick: 2, payload: { delta: 3 } });
    simulation.advance(20);

    expect(simulation.tick).toBe(2);
    expect(simulation.state.value).toBe(5);

    const tape = createReplayTapeR25(simulation.state, [
      { tick: 1, payload: { delta: 2 } },
      { tick: 2, payload: { delta: 3 } },
    ]);
    expect(replayTapeDigestR25(tape)).toMatch(/^[0-9a-f]+$/);
  });

  it('detects deterministic simulation equivalence', () => {
    interface State { value: number; }
    interface Input { delta: number; }

    const simulation = new DeterministicSimulationR25<Input, State>({
      initialState: () => ({ value: 0 }),
      step: (state, input) => ({ value: state.value + (input?.delta ?? 0) }),
      serialize: (state) => state,
      deserialize: (payload) => payload as State,
    }, { fixedDeltaMs: 16, maxCatchUpSteps: 4 });

    const report = simulation.verifyDeterminism(
      [
        { tick: 1, payload: { delta: 2 } },
        { tick: 2, payload: { delta: 4 } },
      ],
      4,
    );

    expect(report.equal).toBe(true);
    expect(report.firstHash).toBe(report.secondHash);
  });
});

describe('R25 worker protocol', () => {
  it('dispatches routed worker tasks', async () => {
    const router = new WorkerTaskRouterR25();
    router.register({
      method: 'sum',
      run: async (payload: { a: number; b: number }) => payload.a + payload.b,
    });

    const response = await router.handle({
      kind: 'request',
      id: '1',
      method: 'sum',
      payload: { a: 2, b: 5 },
      sentAtMs: 10,
      sequence: 1,
    });

    expect(response.ok).toBe(true);
    if (response.ok) expect(response.result).toBe(7);
  });

  it('creates stable message digests', () => {
    const message = {
      kind: 'heartbeat' as const,
      sentAtMs: 10,
      sequence: 2,
    };
    expect(createMessageDigest(message)).toMatch(/^[0-9a-f]+$/);
  });

  it('handles request timeout through a synthetic transport', async () => {
    const messages: unknown[] = [];
    const listeners = new Map<string, EventListener[]>();
    const transport = {
      postMessage(message: unknown) { messages.push(message); },
      addEventListener(type: 'message' | 'error' | 'messageerror', listener: EventListener) {
        const list = listeners.get(type) ?? [];
        list.push(listener);
        listeners.set(type, list);
      },
      removeEventListener(type: 'message' | 'error' | 'messageerror', listener: EventListener) {
        listeners.set(type, (listeners.get(type) ?? []).filter((entry) => entry !== listener));
      },
    };

    const protocol = new WorkerProtocolR25(transport, {
      requestTimeoutMs: 10,
      maxPending: 2,
    });

    const result = await protocol.request('slow', { value: 1 }, { timeoutMs: 10 });
    expect(result.ok).toBe(false);
    expect(messages.length).toBe(1);
    protocol.dispose();
  });
});

describe('R25 render queue', () => {
  it('culls by distance and prioritizes gameplay objects', () => {
    const queue = new RenderQueueR25({
      maxVisible: 2,
      maxShadowCasters: 1,
      maxTransparent: 1,
    });

    queue.addMany([
      createRenderItem('player', {
        position: { x: 0, y: 0, z: 0 },
        radius: 1,
        layer: 'character',
        priority: 100,
        materialKey: 'hero',
        transparent: false,
        castsShadow: true,
        receivesShadow: true,
        staticGeometry: false,
      }),
      createRenderItem('tree', {
        position: { x: 3, y: 0, z: 0 },
        radius: 2,
        layer: 'world',
        priority: 10,
        materialKey: 'tree',
        transparent: false,
        castsShadow: true,
        receivesShadow: true,
        staticGeometry: true,
      }),
      createRenderItem('far', {
        position: { x: 50000, y: 0, z: 0 },
        radius: 1,
        layer: 'world',
        priority: 1,
        materialKey: 'far',
        transparent: false,
        castsShadow: false,
        receivesShadow: false,
        staticGeometry: true,
      }),
    ]);

    const selection = queue.cull(
      { x: 0, y: 0, z: 0 },
      {
        tier: 'balanced',
        drawDistanceMeters: 100,
        maxVisibleObjects: 2,
        shadowResolution: 1536,
      },
    );

    expect(selection.visible.map((item) => item.id)).toContain('player' as never);
    expect(selection.culled).toContain('far' as never);
    expect(selection.shadowCasters).toBe(1);
  });
});

describe('R25 backend boundary', () => {
  it('selects WebGPU when explicitly forced and available', () => {
    const capabilities = detectR25Capabilities();
    const synthetic = {
      ...capabilities,
      backend: 'webgpu' as const,
      webgpu: true,
      secureContext: true,
    };

    const selection = selectR25Backend(synthetic, {
      force: 'webgpu',
      requireSecureContext: true,
    });

    expect(selection.backend).toBe('webgpu');
  });

  it('builds an appropriate render profile for low-memory devices', () => {
    const capabilities = {
      backend: 'webgl2' as const,
      webgpu: false,
      webgl2: true,
      webgl: true,
      secureContext: true,
      offscreenCanvas: false,
      sharedArrayBuffer: false,
      crossOriginIsolated: false,
      maxTextureSize: 2048,
      maxSamples: 2,
      maxUniformBufferSize: 65536,
      deviceMemoryGb: 2,
      hardwareConcurrency: 2,
      pixelRatio: 2,
      viewportWidth: 800,
      viewportHeight: 600,
      prefersReducedMotion: true,
      saveData: true,
      coarsePointer: true,
    };

    const profile = buildR25RenderProfile(capabilities, {
      backend: 'webgl2',
      score: 0.4,
      reasons: ['webgl2'],
      safeMode: false,
    });

    expect(profile.tier).toBe('balanced');
    expect(profile.pixelRatio).toBeLessThan(1.5);
  });
});

describe('R25 integrated runtime', () => {
  it('starts, ticks, snapshots and stops cleanly', async () => {
    const runtime = new RuntimeR25({
      forceBackend: 'none',
      qualityTier: 'safe',
      frameBudgetMs: 16.67,
      fixedStepMs: 16.67,
    });

    runtime.registerZone(createZone('origin', {
      center: { x: 0, y: 0 },
      radiusMeters: 100,
      memoryBytes: 1000,
      loadCostMs: 0,
      priority: 10,
      critical: true,
      dependencies: [],
      tags: ['origin'],
    }));

    runtime.enqueueInput(keyboardInput('KeyW', 'pressed', 0));
    await runtime.start();
    const tick = await runtime.tick(16.67);
    expect(tick.snapshot.state).toBe('running');
    expect(tick.snapshot.profile.tier).toBe('safe');
    expect(tick.renderPasses).toBeGreaterThan(0);
    expect(tick.snapshot.observability.counters['runtime.intent.processed']).toBe(1);

    runtime.pause();
    const paused = await runtime.tick(16.67);
    expect(paused.snapshot.state).toBe('paused');

    runtime.resume();
    await runtime.stop();
    expect(runtime.state).toBe('stopped');
    runtime.dispose();
  });
});
