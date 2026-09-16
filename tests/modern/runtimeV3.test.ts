import { describe, expect, it } from 'vitest';
import {
  DeterministicRng,
  FixedStepClock,
  InputRingBuffer,
  CheckpointRing,
  hashObject32,
  stableStringify,
} from '../../src/3d/modern/v3/deterministicKernel';
import {
  EntityRegistryV3,
  V3_HEALTH,
  V3_POSITION,
  V3_VELOCITY,
  defineComponent,
} from '../../src/3d/modern/v3/ecsV3';
import {
  integrateCharacterMotion,
  decodeInput,
  BUTTON_JUMP,
  createHealthSystem,
  SimulationPipeline,
} from '../../src/3d/modern/v3/simulationPipeline';
import {
  QUALITY_PROFILES,
  RenderPlannerV3,
  chooseAdaptiveQuality,
  enforceRenderBudget,
  chooseLod,
  isVisibleSphere,
} from '../../src/3d/modern/v3/renderPipelineV3';
import {
  SnapshotBuffer,
  createSnapshot,
  diffSnapshots,
  applySnapshotDelta,
  decideReconciliation,
  encodeInputFrame,
  decodeInputFrame,
} from '../../src/3d/modern/v3/netcodeV3';
import {
  MemorySaveAdapter,
  SaveManager,
  createJsonCodec,
  createSaveEnvelope,
  serializeSave,
  validateSerializedSave,
} from '../../src/3d/modern/v3/persistenceV3';
import {
  BudgetControllerV3,
  FrameProfilerV3,
  HealthEvaluatorV3,
  MetricRegistryV3,
  RollingHistogram,
  TraceRecorderV3,
} from '../../src/3d/modern/v3/observabilityV3';
import {
  createLoopbackPair,
  WorkerBridgeV3,
} from '../../src/3d/modern/v3/workerBridgeV3';
import {
  DEFAULT_SECURITY_LIMITS,
  SlidingWindowRateLimiter,
  deepSanitize,
  guardCommand,
  sanitizeId,
  sanitizeText,
  validateMonotonicTick,
  validatePayloadSize,
  validateSequence,
  validateUrl,
} from '../../src/3d/modern/v3/securityBoundaryV3';
import { RuntimeV3, createDefaultRuntimeConfig } from '../../src/3d/modern/v3/runtimeV3';
import { asEntityId, asSequence, asTick } from '../../src/3d/modern/v3/coreContracts';

describe('deterministic kernel', () => {
  it('produces stable seeded sequences', () => {
    const a = new DeterministicRng(42);
    const b = new DeterministicRng(42);
    expect(Array.from({ length: 32 }, () => a.nextU32())).toEqual(Array.from({ length: 32 }, () => b.nextU32()));
  });

  it('forks deterministic independent streams', () => {
    const a = new DeterministicRng(9).fork('ai');
    const b = new DeterministicRng(9).fork('ai');
    const c = new DeterministicRng(9).fork('render');
    expect(a.nextInt(0, 9999)).toBe(b.nextInt(0, 9999));
    expect(a.nextInt(0, 9999)).not.toBe(c.nextInt(0, 9999));
  });

  it('keeps JSON canonical order stable', () => {
    expect(stableStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(hashObject32({ a: 1, b: 2 })).toBe(hashObject32({ b: 2, a: 1 }));
  });

  it('runs fixed steps with an explicit catch-up cap', () => {
    const clock = new FixedStepClock({ fixedDeltaSeconds: 1 / 60, maxCatchUpSteps: 3, maxFrameDeltaSeconds: 0.2 });
    let steps = 0;
    const result = clock.advance(0.2, () => steps += 1);
    expect(steps).toBe(3);
    expect(result.steps).toBe(3);
    expect(result.droppedSeconds).toBeGreaterThan(0);
  });

  it('keeps input ring bounded and ordered', () => {
    const ring = new InputRingBuffer(3);
    for (let index = 1; index <= 10; index += 1) {
      ring.push({ sequence: asSequence(index), tick: asTick(index), moveX: index, moveZ: 0, lookX: 0, lookY: 0, buttons: 0, analog: {} });
    }
    expect(ring.size()).toBe(3);
    expect(ring.latest()?.sequence).toBe(asSequence(10));
  });

  it('tracks nearest deterministic checkpoints', () => {
    const ring = new CheckpointRing<{ value: number }>(4);
    ring.push({ tick: asTick(5), digest: 1, state: { value: 5 } });
    ring.push({ tick: asTick(10), digest: 2, state: { value: 10 } });
    expect(ring.nearestAtOrBefore(asTick(9))?.state.value).toBe(5);
    expect(ring.latest()?.state.value).toBe(10);
  });
});

describe('typed ECS', () => {
  it('creates, queries and snapshots entities deterministically', () => {
    const world = new EntityRegistryV3();
    world.register(V3_POSITION);
    world.register(V3_VELOCITY);
    world.register(V3_HEALTH);
    const second = world.create(asEntityId('e:2'));
    const first = world.create(asEntityId('e:1'));
    world.add(first, V3_POSITION.type, { x: 1, y: 2, z: 3 });
    world.add(first, V3_VELOCITY.type, { x: 0, y: 0, z: 0 });
    world.add(second, V3_POSITION.type, { x: 4, y: 5, z: 6 });
    expect(world.query({ all: [V3_POSITION.type] }).entities).toEqual([first, second]);
    expect(world.query({ all: [V3_POSITION.type, V3_VELOCITY.type] }).entities).toEqual([first]);
    expect(world.snapshot()[0]?.id).toBe(first);
  });

  it('supports custom typed components with validation', () => {
    const world = new EntityRegistryV3();
    const Score = defineComponent<number>({
      name: 'score',
      estimatedBytes: 8,
      validate: (value): value is number => typeof value === 'number' && Number.isFinite(value),
      defaultValue: () => 0,
    });
    world.register(Score);
    const entity = world.create();
    world.add(entity, Score.type, 100);
    expect(world.get<number>(entity, Score.type)).toBe(100);
    expect(world.archetypeKey(entity).components).toEqual([Score.type]);
  });

  it('defers mutation safely', () => {
    const world = new EntityRegistryV3();
    world.register(V3_POSITION);
    world.queueCreate(asEntityId('queued'));
    const created = world.flushDeferred();
    expect(created).toEqual([asEntityId('queued')]);
    expect(world.exists(asEntityId('queued'))).toBe(true);
    world.queueDestroy(asEntityId('queued'));
    world.flushDeferred();
    expect(world.exists(asEntityId('queued'))).toBe(false);
  });
});

describe('simulation', () => {
  it('decodes button state', () => {
    const decoded = decodeInput({ sequence: asSequence(1), tick: asTick(1), moveX: 0, moveZ: 0, lookX: 0, lookY: 0, buttons: BUTTON_JUMP, analog: {} });
    expect(decoded.jumpPressed).toBe(true);
  });

  it('integrates grounded jump and gravity', () => {
    const jumped = integrateCharacterMotion(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { frame: { sequence: asSequence(1), tick: asTick(1), moveX: 0, moveZ: 0, lookX: 0, lookY: 0, buttons: BUTTON_JUMP, analog: {} }, jumpPressed: true, sprintHeld: false, attackPressed: false, dodgePressed: false },
      1 / 60,
      true,
    );
    expect(jumped.jumped).toBe(true);
    expect(jumped.velocity.y).toBeGreaterThan(0);
    const falling = integrateCharacterMotion(jumped.position, jumped.velocity, { frame: jumped as any, jumpPressed: false, sprintHeld: false, attackPressed: false, dodgePressed: false }, 1 / 60, false);
    expect(falling.velocity.y).toBeLessThan(jumped.velocity.y);
  });

  it('runs a fixed-step pipeline and produces a digest', () => {
    const pipeline = new SimulationPipeline();
    const entity = pipeline.world.create(asEntityId('player'));
    pipeline.world.add(entity, V3_POSITION.type, { x: 0, y: 0, z: 0 });
    pipeline.world.add(entity, V3_VELOCITY.type, { x: 0, y: 0, z: 0 });
    pipeline.world.add(entity, V3_HEALTH.type, { current: 100, max: 100 });
    pipeline.addSystem(createHealthSystem());
    const result = pipeline.step(1 / 30);
    expect(result.steps).toBeGreaterThan(0);
    expect(result.digest).toBeTypeOf('number');
    expect(pipeline.world.isEnabled(entity)).toBe(true);
  });
});

describe('render planning', () => {
  const view = {
    id: 'main',
    position: { x: 0, y: 0, z: 0 },
    forward: { x: 0, y: 0, z: -1 },
    up: { x: 0, y: 1, z: 0 },
    fovRadians: Math.PI / 3,
    near: 0.1,
    far: 1000,
    viewportWidth: 1920,
    viewportHeight: 1080,
  };

  it('assigns deterministic LOD tiers', () => {
    expect(chooseLod(10, QUALITY_PROFILES.high)).toBe(0);
    expect(chooseLod(1000, QUALITY_PROFILES.high)).toBe(4);
  });

  it('plans visible renderables and culls far objects', () => {
    const planner = new RenderPlannerV3({ backend: 'webgl2', quality: 'high' });
    const plan = planner.plan({ view, renderables: [
      { entity: asEntityId('near'), bounds: { center: { x: 0, y: 0, z: -10 }, radius: 2 }, transform: { position: { x: 0, y: 0, z: -10 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } }, materialKey: 'm', meshKey: 'mesh', layer: 0, castShadow: true, receiveShadow: true },
      { entity: asEntityId('far'), bounds: { center: { x: 0, y: 0, z: 5000 }, radius: 2 }, transform: { position: { x: 0, y: 0, z: 5000 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } }, materialKey: 'm', meshKey: 'mesh', layer: 0, castShadow: false, receiveShadow: true },
    ], backend: 'webgl2', quality: 'high' });
    expect(plan.visibleCount).toBe(1);
    expect(plan.culledCount).toBe(1);
  });

  it('adapts quality only when sustained signals justify it', () => {
    expect(chooseAdaptiveQuality('high', { frameTimeP95Ms: 50, targetFrameMs: 16.67, gpuPressure: 0.95, memoryPressure: 0.95 }).tier).toBe('medium');
    expect(chooseAdaptiveQuality('high', { frameTimeP95Ms: 11, targetFrameMs: 16.67, gpuPressure: 0.2, memoryPressure: 0.2 }).tier).toBe('ultra');
    expect(chooseAdaptiveQuality('high', { frameTimeP95Ms: 18, targetFrameMs: 16.67, gpuPressure: 0.6, memoryPressure: 0.6 }).tier).toBe('high');
  });

  it('drops optional render work before core passes', () => {
    const planner = new RenderPlannerV3({ backend: 'webgpu', quality: 'ultra' });
    const plan = planner.plan({ view, renderables: [], backend: 'webgpu', quality: 'ultra' });
    const decision = enforceRenderBudget(plan, 3);
    expect(decision.droppedPasses.length).toBeGreaterThan(0);
    expect(decision.projectedMs).toBeLessThanOrEqual(3);
  });

  it('uses conservative sphere visibility', () => {
    expect(isVisibleSphere({ center: { x: 0, y: 0, z: -10 }, radius: 1 }, view)).toBe(true);
    expect(isVisibleSphere({ center: { x: 0, y: 0, z: 10 }, radius: 1 }, view)).toBe(false);
  });
});

describe('networking', () => {
  const entity = asEntityId('player');
  const a = createSnapshot(asSequence(1), asTick(1), 100, asSequence(1), [{ entity, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, flags: 1 }]);

  it('encodes and decodes input deterministically', () => {
    const input = { sequence: asSequence(8), tick: asTick(8), moveX: 0.5, moveZ: -0.5, lookX: 0.25, lookY: -0.25, buttons: 7, analog: { primary: 0.4 } };
    const decoded = decodeInputFrame(encodeInputFrame(input));
    expect(decoded.sequence).toBe(input.sequence);
    expect(decoded.buttons).toBe(input.buttons);
    expect(decoded.moveX).toBeCloseTo(input.moveX, 2);
  });

  it('produces and applies compact snapshot deltas', () => {
    const changed = createSnapshot(asSequence(2), asTick(2), 116, asSequence(2), [{ entity, position: { x: 1, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, flags: 1 }]);
    const delta = diffSnapshots(a, changed);
    const rebuilt = applySnapshotDelta(a, delta, 116);
    expect(rebuilt.checksum).toBe(changed.checksum);
  });

  it('interpolates snapshots and bounds buffer size', () => {
    const buffer = new SnapshotBuffer(3);
    for (let i = 1; i <= 5; i += 1) buffer.push(createSnapshot(asSequence(i), asTick(i), i * 16, asSequence(i), []));
    expect(buffer.size()).toBe(3);
    const interpolation = buffer.interpolation(4.5);
    expect(interpolation?.alpha).toBeGreaterThan(0);
  });

  it('requests rollback only for meaningful prediction drift', () => {
    const predicted = { entity, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, flags: 1 };
    const authoritative = { ...predicted, position: { x: 0.3, y: 0, z: 0 } };
    expect(decideReconciliation(predicted, authoritative).rollback).toBe(true);
    expect(decideReconciliation(predicted, predicted).rollback).toBe(false);
  });
});

describe('persistence', () => {
  const isSave = (value: unknown): value is { score: number } => typeof value === 'object' && value !== null && typeof (value as { score?: unknown }).score === 'number';

  it('round-trips a versioned save envelope', () => {
    const codec = createJsonCodec({ schema: 1, validate: isSave });
    const envelope = createSaveEnvelope({ payload: { score: 123 }, codec, revision: 4, playtimeMs: 55, nowMs: 1000 });
    const serialized = serializeSave(envelope, codec);
    expect(validateSerializedSave(serialized, codec).ok).toBe(true);
  });

  it('rejects corrupted save data', () => {
    const codec = createJsonCodec({ schema: 1, validate: isSave });
    const envelope = createSaveEnvelope({ payload: { score: 10 }, codec, revision: 1, playtimeMs: 0, nowMs: 1 });
    const corrupted = serializeSave(envelope, codec).replace('10', '11');
    expect(validateSerializedSave(corrupted, codec).ok).toBe(false);
  });

  it('increments revisions in a memory-backed manager', async () => {
    const codec = createJsonCodec({ schema: 1, validate: isSave });
    const manager = new SaveManager({ codec, adapter: new MemorySaveAdapter() });
    const first = await manager.save(0, { score: 1 }, 10, 100);
    const second = await manager.save(0, { score: 2 }, 20, 200);
    expect(first.revision).toBe(1);
    expect(second.revision).toBe(2);
    expect((await manager.load(0))?.payload.score).toBe(2);
  });
});

describe('observability', () => {
  it('computes percentile histograms from bounded samples', () => {
    const histogram = new RollingHistogram(32);
    for (let i = 1; i <= 32; i += 1) histogram.push(i);
    expect(histogram.snapshot().p95).toBeGreaterThanOrEqual(30);
  });

  it('tracks metrics and trace spans', () => {
    const metrics = new MetricRegistryV3(() => ({ tick: asTick(3), timestampMs: 100 }));
    metrics.observe('frame', 10, 'ms');
    metrics.observe('frame', 20, 'ms');
    expect(metrics.get('frame')?.value).toBe(15);
    const trace = new TraceRecorderV3();
    trace.scope('work', 'simulation', () => undefined);
    expect(trace.spans()).toHaveLength(1);
    expect(trace.spans()[0]?.endMs).toBeGreaterThanOrEqual(trace.spans()[0]?.startMs ?? 0);
  });

  it('registers budget misses and evaluates health', () => {
    const controller = new BudgetControllerV3({ targetFrameMs: 16.67, simulationBudgetMs: 6, renderBudgetMs: 8, streamingBudgetMs: 3, networkBudgetMs: 2, persistenceBudgetMs: 1 });
    controller.record({ tick: asTick(1), frameMs: 20, simulationMs: 7, renderMs: 9, streamingMs: 4, networkMs: 2, persistenceMs: 1 });
    controller.record({ tick: asTick(2), frameMs: 20, simulationMs: 7, renderMs: 9, streamingMs: 4, networkMs: 2, persistenceMs: 1 });
    const budget = controller.record({ tick: asTick(3), frameMs: 20, simulationMs: 7, renderMs: 9, streamingMs: 4, networkMs: 2, persistenceMs: 1 });
    expect(controller.shouldThrottle()).toBe(true);
    expect(budget.budgetMisses).toBe(3);
    const health = new HealthEvaluatorV3().evaluate({ frame: new RollingHistogram(16).snapshot(), memoryPressure: 0.5, networkLoss: 0.01, streamingPressure: 0.2 });
    expect(health.score).toBeGreaterThan(0);
  });
});

describe('worker bridge', () => {
  it('moves bounded protocol messages over a loopback endpoint', () => {
    const [client, worker] = createLoopbackPair();
    const received: string[] = [];
    const bridge = new WorkerBridgeV3({ lane: 'main', maxMessageBytes: 2048, protocolVersion: 1 });
    const target = new WorkerBridgeV3({ lane: 'worker', maxMessageBytes: 2048, protocolVersion: 1 });
    target.attach(worker, (message) => received.push(message.kind));
    bridge.attach(client, () => undefined);
    expect(bridge.tick(1, 1 / 60)).toBe(true);
    expect(bridge.input(2, { x: 1 })).toBe(true);
    expect(received).toEqual(['tick', 'input']);
  });

  it('rejects oversized payloads', () => {
    const [client] = createLoopbackPair();
    const bridge = new WorkerBridgeV3({ lane: 'main', maxMessageBytes: 256, protocolVersion: 1 });
    bridge.attach(client, () => undefined);
    expect(bridge.send({ kind: 'input', sequence: 1, payload: 'x'.repeat(2000) })).toBe(false);
    expect(bridge.metrics().rejected).toBe(1);
  });
});

describe('security boundaries', () => {
  it('sanitizes text and ids', () => {
    expect(sanitizeText('<script>ok</script>\u0000')).toBe('scriptok/script');
    expect(sanitizeId('actor:01')).toBe('actor:01');
  });

  it('bounds nested payloads and byte size', () => {
    expect(deepSanitize({ text: '<x>', values: [1, 2, Number.NaN] })).toEqual({ text: 'x', values: [1, 2, 0] });
    expect(() => validatePayloadSize('x'.repeat(DEFAULT_SECURITY_LIMITS.maxPayloadBytes + 10))).toThrow();
  });

  it('enforces a sliding command rate limit', () => {
    const limiter = new SlidingWindowRateLimiter(2, 1000);
    expect(limiter.allow('a', 0)).toBe(true);
    expect(limiter.allow('a', 100)).toBe(true);
    expect(limiter.allow('a', 200)).toBe(false);
    expect(limiter.allow('a', 1101)).toBe(true);
  });

  it('validates monotonic protocol counters and HTTPS URLs', () => {
    expect(validateMonotonicTick(5, 7)).toBe(true);
    expect(validateMonotonicTick(7, 5)).toBe(false);
    expect(validateSequence(5, 6)).toBe(true);
    expect(validateSequence(6, 5)).toBe(false);
    expect(validateUrl('https://example.com/a')).toBe(true);
    expect(validateUrl('javascript:alert(1)')).toBe(false);
  });

  it('guards command rate and payload shape together', () => {
    const limiter = new SlidingWindowRateLimiter(1, 1000);
    const first = guardCommand({ actorId: 'player', payload: { action: 'move' }, nowMs: 0, limiter });
    const second = guardCommand({ actorId: 'player', payload: { action: 'move' }, nowMs: 10, limiter });
    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(false);
  });
});

describe('runtime integration', () => {
  it('boots a complete local runtime with one player and diagnostic data', () => {
    const runtime = new RuntimeV3(createDefaultRuntimeConfig());
    const player = runtime.createPlayer();
    expect(player).toBe(asEntityId('player'));
    const report = runtime.frame(1 / 60, {
      id: 'main',
      position: { x: 0, y: 0, z: 0 },
      forward: { x: 0, y: 0, z: -1 },
      up: { x: 0, y: 1, z: 0 },
      fovRadians: Math.PI / 3,
      near: 0.1,
      far: 500,
      viewportWidth: 1280,
      viewportHeight: 720,
    }, []);
    expect(report.clock.tick).toBeGreaterThan(0);
    expect(report.health.grade).toMatch(/[A-E]/);
    runtime.shutdown();
  });

  it('persists game payloads through the integrated runtime', async () => {
    const runtime = new RuntimeV3(createDefaultRuntimeConfig());
    await runtime.save(1, { unlocked: true }, 100);
    expect((await runtime.load(1))?.payload.unlocked).toBe(true);
  });
});
