import { describe, expect, it } from 'vitest';

import {
  ApplicationKernelV3,
  createFixedStepClock,
  orderKernelPhases,
} from '../../src/3d/modern/applicationKernelV3';
import {
  AssetOrchestratorV3,
  assetPriorityScore,
} from '../../src/3d/modern/assetOrchestratorV3';
import {
  InputPipelineV3,
  createDefaultGameplayBindings,
  sampleMovementAxes,
} from '../../src/3d/modern/inputPipelineV3';
import {
  MigrationManagerV3,
  createDefaultMigrationManifest,
} from '../../src/3d/modern/migrationManagerV3';
import {
  RenderBudgetControllerV3,
  allRenderFeatures,
  allRenderTiers,
} from '../../src/3d/modern/renderBudgetV3';
import {
  SessionStateV3,
  createJsonSessionCodec,
} from '../../src/3d/modern/sessionStateV3';
import {
  TelemetryV3,
} from '../../src/3d/modern/telemetryV3';
import {
  WorldStreamingV3,
  createRadialStreamBudget,
  distanceBetweenChunks,
} from '../../src/3d/modern/worldStreamingV3';

describe('ApplicationKernelV3', () => {
  it('orders tasks by phase and priority', async () => {
    const order: string[] = [];
    const kernel = new ApplicationKernelV3({
      clock: () => 100,
      fixedStepMs: 10,
    });

    kernel.registerTask({
      id: 'render-low',
      phase: 'render',
      priority: 1,
      budgetMs: 2,
      run: () => order.push('render-low'),
    });

    kernel.registerTask({
      id: 'render-high',
      phase: 'render',
      priority: 10,
      budgetMs: 2,
      run: () => order.push('render-high'),
    });

    kernel.registerTask({
      id: 'boot',
      phase: 'boot',
      priority: 0,
      budgetMs: 2,
      run: () => order.push('boot'),
    });

    await kernel.start();
    expect(order).toEqual(['boot']);

    await kernel.tick(110);
    expect(order).toEqual(['boot', 'render-high', 'render-low']);
    expect(kernel.frame).toBe(1);
    expect(kernel.simulationTick).toBe(1);
  });

  it('guards a stalled frame from unlimited simulation catch-up', async () => {
    let simulationRuns = 0;
    const kernel = new ApplicationKernelV3({
      clock: () => 0,
      fixedStepMs: 10,
      maxCatchUpSteps: 3,
    });

    kernel.registerTask({
      id: 'sim',
      phase: 'simulation',
      priority: 0,
      budgetMs: 1,
      run: () => {
        simulationRuns += 1;
      },
    });

    await kernel.start();
    const report = await kernel.tick(1000);

    expect(simulationRuns).toBe(3);
    expect(report?.simulationTick).toBe(3);
  });

  it('can resolve services and report health', async () => {
    const kernel = new ApplicationKernelV3({ clock: () => 50 });
    kernel.registerService({
      id: 'answer',
      value: 42,
    });

    expect(kernel.resolveService<number>('answer')).toBe(42);
    expect(kernel.hasService('answer')).toBe(true);
    await kernel.start();
    expect(kernel.snapshot().serviceCount).toBe(1);
    expect(kernel.health).toBe('healthy');
  });

  it('emits task failures for non-critical mode without silently losing the report', async () => {
    const failures: string[] = [];
    const kernel = new ApplicationKernelV3({
      clock: () => 10,
      strictTaskFailures: false,
    });

    kernel.on('error', (error, task) => {
      failures.push(\`\${task?.id ?? 'kernel'}:\${error.message}\`);
    });

    kernel.registerTask({
      id: 'fragile',
      phase: 'render',
      priority: 0,
      budgetMs: 1,
      critical: false,
      run: () => {
        throw new Error('expected failure');
      },
    });

    await kernel.start();
    const report = await kernel.tick(11);
    expect(report?.failedTaskIds).toContain('fragile');
    expect(failures).toEqual(['fragile:expected failure']);
  });

  it('deduplicates and orders phase lists', () => {
    expect(orderKernelPhases(['render', 'simulation', 'render', 'boot'])).toEqual([
      'boot',
      'simulation',
      'render',
    ]);
  });

  it('keeps a fixed-step accumulator bounded', () => {
    const clock = createFixedStepClock(10);
    expect(clock.tick(5)).toBe(0);
    expect(clock.tick(6)).toBe(1);
    expect(clock.tick(35)).toBe(3);
    clock.reset();
    expect(clock.tick(5)).toBe(0);
  });
});

describe('InputPipelineV3', () => {
  it('binds default gameplay controls and normalizes button transitions', () => {
    const input = new InputPipelineV3();
    const disposers = createDefaultGameplayBindings().map((binding) => input.bind(binding));

    input.emitButton('keyboard', 'key:w', 'pressed', 10);
    input.emitButton('keyboard', 'key:shift', 'pressed', 10);
    const frame = input.step(10);

    expect(frame.pressed).toContain('move:forward');
    expect(frame.actions['move:forward']).toBe(1);
    expect(frame.actions.sprint).toBeUndefined();
    expect(frame.actions['sprint']).toBe(1);

    input.emitButton('keyboard', 'key:w', 'released', 20);
    const release = input.step(20);
    expect(release.released).toContain('move:forward');
    expect(input.isDown('move:forward')).toBe(false);

    disposers.forEach((dispose) => dispose());
    expect(input.inspectBindings()).toHaveLength(0);
  });

  it('normalizes movement vectors', () => {
    const input = new InputPipelineV3();
    for (const binding of createDefaultGameplayBindings().slice(0, 4)) {
      input.bind(binding);
    }

    input.emitButton('keyboard', 'key:w', 'pressed', 1);
    input.emitButton('keyboard', 'key:d', 'pressed', 1);
    const snapshot = input.step(1);
    const movement = sampleMovementAxes(snapshot);

    expect(movement.x).toBeGreaterThan(0);
    expect(movement.y).toBeGreaterThan(0);
    expect(movement.magnitude).toBe(1);
  });

  it('handles pointer deltas without leaking invalid coordinates', () => {
    const input = new InputPipelineV3();
    input.bind({ action: 'look', sources: ['mouse:move'] });

    input.emitPointer('mouse', 'mouse:move', 100, 80, 5);
    const first = input.step(5);
    expect(first.pointer.x).toBe(100);
    expect(first.pointer.y).toBe(80);

    input.emitPointer('mouse', 'mouse:move', 120, 95, 10);
    const second = input.step(10);
    expect(second.pointer.dx).toBe(20);
    expect(second.pointer.dy).toBe(15);
  });

  it('applies axis dead-zones and inversion', () => {
    const input = new InputPipelineV3({ deadZone: 0.2 });
    input.bind({
      action: 'camera:x',
      sources: ['gamepad:axis:x'],
      invert: true,
    });

    input.emitAxis('gamepad', 'gamepad:axis:x', 0.1, 1);
    expect(input.step(1).actions['camera:x']).toBe(0);

    input.emitAxis('gamepad', 'gamepad:axis:x', 0.8, 2);
    expect(input.step(2).actions['camera:x']).toBeLessThan(0);
  });

  it('supports deterministic repeat scheduling', () => {
    const input = new InputPipelineV3({
      repeatDelayMs: 100,
      repeatIntervalMs: 50,
    });
    input.bind({
      action: 'menu:next',
      sources: ['key:arrowright'],
      repeatable: true,
    });

    input.emitButton('keyboard', 'key:arrowright', 'pressed', 0);
    expect(input.step(0).pressed).toContain('menu:next');
    expect(input.step(90).pressed).not.toContain('menu:next');
    expect(input.step(100).pressed).toContain('menu:next');
    expect(input.step(150).pressed).toContain('menu:next');
  });
});

describe('AssetOrchestratorV3', () => {
  it('declares and loads an asset once, then serves it from cache', async () => {
    let calls = 0;
    let now = 0;
    const assets = new AssetOrchestratorV3({
      clock: () => now,
      maxResidentBytes: 1024 * 1024,
    });

    assets.declare({
      id: 'hero-model',
      url: 'https://example.test/hero.glb',
      kind: 'model',
      priority: 'critical',
      expectedBytes: 100,
    });

    const fetcher = async () => {
      calls += 1;
      now += 5;
      return { value: { id: 'hero' }, bytes: 90 };
    };

    const first = await assets.load('hero-model', fetcher);
    const second = await assets.load('hero-model', fetcher);

    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);
    expect(calls).toBe(1);
    expect(assets.stats().residentBytes).toBe(90);
  });

  it('rejects payloads larger than the declared safety envelope', async () => {
    const assets = new AssetOrchestratorV3();
    assets.declare({
      id: 'tiny',
      url: 'https://example.test/tiny.bin',
      kind: 'binary',
      priority: 'normal',
      expectedBytes: 10,
      maxBytes: 20,
    });

    await expect(
      assets.load('tiny', async () => ({
        value: new Uint8Array(80),
        bytes: 80,
      })),
    ).rejects.toThrow(/maxBytes/);

    expect(assets.record('tiny')?.state).toBe('failed');
  });

  it('evicts low-value cached assets under memory pressure', async () => {
    let now = 0;
    const assets = new AssetOrchestratorV3({
      maxResidentBytes: 1024 * 1024,
      clock: () => now,
    });

    for (const [id, priority] of [
      ['low-a', 'low'],
      ['low-b', 'background'],
    ] as const) {
      assets.declare({
        id,
        url: \`https://example.test/\${id}.bin\`,
        kind: 'binary',
        priority,
        maxBytes: 700_000,
      });
      await assets.load(id, async () => {
        now += 1;
        return { value: id, bytes: 500_000 };
      });
    }

    expect(assets.stats().residentBytes).toBeLessThanOrEqual(1024 * 1024);
    expect(assets.inspect().filter((entry) => entry.state === 'evicted').length).toBeGreaterThan(0);
  });

  it('gives critical assets stronger priority scores', () => {
    const critical = assetPriorityScore({
      id: 'a',
      url: 'https://example.test/a',
      kind: 'model',
      priority: 'critical',
    }, 0);
    const background = assetPriorityScore({
      id: 'b',
      url: 'https://example.test/b',
      kind: 'model',
      priority: 'background',
    }, 0);
    expect(critical).toBeGreaterThan(background);
  });
});

describe('WorldStreamingV3', () => {
  it('plans, requests and completes chunks around an interest source', () => {
    const streaming = new WorldStreamingV3(
      100,
      createRadialStreamBudget(2, 64),
    );

    streaming.setSource({
      id: 'player',
      x: 0,
      z: 0,
      radiusMeters: 210,
      weight: 5,
      categories: ['terrain', 'navigation', 'npc'],
      pinRadiusMeters: 60,
    });

    const plan = streaming.plan(0, 0, 2);
    expect(plan.requested.length).toBeGreaterThan(0);
    expect(plan.load.length).toBeGreaterThan(0);

    const requested = streaming.reconcile(plan);
    for (const id of requested.loadRequested) {
      expect(streaming.completeLoad(id)).toBe(true);
    }

    expect(streaming.stats().residentCount).toBeGreaterThan(0);
  });

  it('keeps pinned chunks from being unloaded', () => {
    const streaming = new WorldStreamingV3(
      100,
      createRadialStreamBudget(1, 8),
    );

    streaming.forceResident({
      id: '0:0',
      x: 0,
      z: 0,
      distanceMeters: 0,
      priority: 'critical',
      categories: ['terrain'],
      desired: true,
      pinned: true,
      score: 1000,
    });

    expect(streaming.requestUnload('0:0')).toBe(false);
  });

  it('calculates chunk distances in world units', () => {
    expect(distanceBetweenChunks('0:0', '3:4', 50)).toBe(250);
  });

  it('serializes sources and residency in stable order', () => {
    const streaming = new WorldStreamingV3(
      64,
      createRadialStreamBudget(1, 16),
    );

    streaming.setSource({
      id: 'z',
      x: 0,
      z: 0,
      radiusMeters: 100,
      weight: 1,
    });
    streaming.setSource({
      id: 'a',
      x: 20,
      z: 20,
      radiusMeters: 100,
      weight: 2,
    });

    const serialized = streaming.serialize();
    expect(serialized.sources.map((source) => source.id)).toEqual(['a', 'z']);
  });
});

describe('RenderBudgetControllerV3', () => {
  it('downshifts after sustained pressure', () => {
    const controller = new RenderBudgetControllerV3({
      initialTier: 'balanced',
      downshiftDelaySamples: 2,
      upshiftDelaySamples: 50,
    });

    controller.update({ cpuMs: 20, gpuMs: 25, frameMs: 40 });
    const decision = controller.update({ cpuMs: 20, gpuMs: 25, frameMs: 40 });

    expect(decision.changed).toBe(true);
    expect(['performance', 'safe']).toContain(decision.tier);
    expect(controller.featureEnabled('volumetrics')).toBe(false);
  });

  it('recovers only after sustained good samples', () => {
    const controller = new RenderBudgetControllerV3({
      initialTier: 'performance',
      downshiftDelaySamples: 2,
      upshiftDelaySamples: 3,
    });

    controller.update({ cpuMs: 5, gpuMs: 6, frameMs: 10 });
    controller.update({ cpuMs: 5, gpuMs: 6, frameMs: 10 });
    controller.update({ cpuMs: 5, gpuMs: 6, frameMs: 10 });
    const decision = controller.update({ cpuMs: 5, gpuMs: 6, frameMs: 10 });

    expect(decision.tier).toBe('balanced');
  });

  it('exposes stable tier and feature catalogs', () => {
    expect(allRenderTiers()).toEqual([
      'ultra',
      'high',
      'balanced',
      'performance',
      'safe',
    ]);
    expect(allRenderFeatures().length).toBeGreaterThan(5);
  });
});

describe('SessionStateV3', () => {
  it('enforces lifecycle transitions', () => {
    const session = new SessionStateV3({
      sessionId: 'test',
      seed: 77,
      clock: (() => {
        let value = 0;
        return () => (value += 10);
      })(),
    });

    expect(session.phase).toBe('boot');
    session.transition('active');
    session.transition('paused');
    session.transition('active');
    expect(session.phase).toBe('active');
    expect(() => session.transition('ended')).toThrow(/Invalid session transition/);
  });

  it('updates player and world state transactionally', () => {
    const session = new SessionStateV3({
      sessionId: 'world',
      seed: 10,
      clock: () => 1,
    });

    session.transition('active');
    session.setPlayerPosition(12, 3, -8);
    session.setPlayerVitals(91, 77);
    session.addInventoryItem('iron-sword');
    session.discover('winterfell');
    session.setWeather('snow');
    session.setDayTime(25.5);
    session.setFlag('tutorial.complete', true);

    const snapshot = session.snapshot;
    expect(snapshot.player.x).toBe(12);
    expect(snapshot.player.health).toBe(91);
    expect(snapshot.player.inventory).toEqual(['iron-sword']);
    expect(snapshot.world.discovered).toContain('winterfell');
    expect(snapshot.world.dayTime).toBe(1.5);
    expect(session.hasFlag('tutorial.complete')).toBe(true);
  });

  it('rolls back through bounded checkpoints', () => {
    const session = new SessionStateV3({
      sessionId: 'rollback',
      seed: 2,
      clock: () => 50,
    });

    session.transition('active');
    session.setPlayerPosition(1, 2, 3);
    const checkpoint = session.checkpoint('safe');
    session.setPlayerPosition(100, 200, 300);

    expect(session.snapshot.player.x).toBe(100);
    session.restoreCheckpoint(checkpoint.id);
    expect(session.snapshot.player.x).toBe(1);
    expect(session.events().some((event) => event.kind === 'state.restore')).toBe(true);
  });

  it('round-trips through JSON codec', () => {
    const session = new SessionStateV3({
      sessionId: 'save',
      seed: 9,
      clock: () => 1,
    });
    session.transition('active');
    session.setPlayerPosition(4, 5, 6);
    const codec = createJsonSessionCodec();
    const encoded = session.save(codec);

    const loaded = new SessionStateV3({
      sessionId: 'other',
      seed: 0,
      clock: () => 2,
    });
    loaded.load(encoded, codec);

    expect(loaded.snapshot.sessionId).toBe('save');
    expect(loaded.snapshot.player.z).toBe(6);
  });
});

describe('TelemetryV3', () => {
  it('records counters, gauges and histogram observations', () => {
    let now = 0;
    const telemetry = new TelemetryV3({
      clock: () => (now += 5),
    });

    telemetry.counter('frame.count', 2, { mode: 'test' });
    telemetry.gauge('runtime.memory', 512);
    telemetry.observe('frame.time', 12);
    telemetry.observe('frame.time', 24);

    const snapshot = telemetry.snapshot();
    expect(snapshot.counters['frame.count']).toBe(2);
    expect(snapshot.gauges['runtime.memory']).toBe(512);
    expect(snapshot.histograms['frame.time']?.count).toBe(2);
    expect(snapshot.histograms['frame.time']?.p95).toBeGreaterThanOrEqual(24);
  });

  it('uses the injected clock for span duration and redacts secrets', () => {
    let now = 100;
    const telemetry = new TelemetryV3({
      clock: () => now,
    });

    const span = telemetry.startSpan('network.request', {
      authorization: 'Bearer abc',
      route: '/snapshot',
    });
    now = 140;
    const finished = span.end('ok');

    expect(finished.durationMs).toBe(40);
    expect(finished.attributes.authorization).toBe('[REDACTED]');
    expect(finished.attributes.route).toBe('/snapshot');
  });

  it('bounds history and flushes atomically', () => {
    const telemetry = new TelemetryV3({ maxMetrics: 64, maxSpans: 64, clock: () => 1 });
    for (let index = 0; index < 100; index += 1) {
      telemetry.counter('events', 1);
    }
    expect(telemetry.metricHistory().length).toBeLessThanOrEqual(64);
    const payload = telemetry.flush();
    expect(payload.metrics.length).toBeGreaterThan(0);
    expect(telemetry.metricHistory()).toHaveLength(0);
  });
});

describe('MigrationManagerV3', () => {
  it('defines the default migration manifest and reports coverage', () => {
    const manager = new MigrationManagerV3();
    const disposers = createDefaultMigrationManifest().map((surface) => manager.define(surface));

    expect(manager.surfaces()).toHaveLength(5);
    expect(manager.coverage().total).toBe(5);
    expect(manager.blockingSurfaces().length).toBeGreaterThan(0);
    expect(manager.verifyNoDuplicateAuthority().length).toBeGreaterThan(0);

    disposers.forEach((dispose) => dispose());
    expect(manager.surfaces()).toHaveLength(0);
  });

  it('blocks advancement until all quality gates are proven', () => {
    const manager = new MigrationManagerV3();
    manager.define({
      id: 'render',
      kind: 'render',
      owner: 'hybrid',
      state: 'canary',
      modernPath: 'renderBudgetV3.ts',
      contractIds: ['render-budget', 'single-authority-render'],
      risk: 'high',
      blocking: true,
    });

    const blocked = manager.setSignal({
      surfaceId: 'render',
      deterministic: true,
      errorRate: 0.02,
      p95FrameMs: 20,
      memoryDeltaMb: 2,
      featureParity: 1,
    });
    expect(blocked.canAdvance).toBe(false);

    const ready = manager.setSignal({
      surfaceId: 'render',
      deterministic: true,
      errorRate: 0,
      p95FrameMs: 18,
      memoryDeltaMb: 1,
      featureParity: 1,
    });
    expect(ready.canAdvance).toBe(true);
    expect(manager.advance('render').state).toBe('cutover');
  });

  it('can roll a canary back safely', () => {
    const manager = new MigrationManagerV3();
    manager.define({
      id: 'input',
      kind: 'input',
      owner: 'hybrid',
      state: 'canary',
      contractIds: ['input'],
      risk: 'medium',
      blocking: false,
    });
    expect(manager.rollback('input').state).toBe('shadow');
    expect(manager.surface('input')?.owner).toBe('hybrid');
  });
});
