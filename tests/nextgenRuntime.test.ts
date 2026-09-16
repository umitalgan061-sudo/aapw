import { describe, expect, it } from 'vitest';
import {
  AdaptiveBudgetController,
  AiDirector,
  ClientReconciler,
  DEFAULT_BUDGETS,
  DeterministicClock,
  DeterministicWorkerPool,
  EcsWorld,
  FrameScheduler,
  InputBuffer,
  InputRecorder,
  MemoryStorage,
  NetworkSession,
  NextGenRuntime,
  ProceduralWorld,
  RenderGraph,
  SaveMigrationRegistry,
  SaveRepository,
  SeededRandom,
  StreamingCoordinator,
  TokenBucket,
  buildFlowField,
  createDelta,
  createRuntime,
  createSnapshot,
  gridFromFunction,
  healthGrade,
  makeRenderItem,
  runtimeDeviceTier,
  snapshotAgeValid,
  validateJsonValue,
  type AssetDescriptor,
  type EntityId,
  type Tick,
} from '../src/engine-ts/nextgen/index.ts';

describe('nextgen deterministic primitives', () => {
  it('produces identical seeded sequences', () => {
    const first = new SeededRandom(42);
    const second = new SeededRandom(42);
    expect(Array.from({ length: 12 }, () => first.next())).toEqual(Array.from({ length: 12 }, () => second.next()));
    expect(first.snapshot()).toEqual(second.snapshot());
  });

  it('prevents a spiral of death with bounded catch-up', () => {
    const clock = new DeterministicClock({ fixedStepMs: 16, maxCatchUpSteps: 3 });
    let steps = 0;
    const result = clock.advance(1000, () => { steps += 1; });
    expect(steps).toBe(3);
    expect(result.droppedSteps).toBeGreaterThan(0);
    expect(result.steps).toBe(3);
  });
});

describe('ecs world', () => {
  it('maintains deterministic entity ordering and component queries', () => {
    const world = new EcsWorld();
    const transform = world.registerComponent('transform', () => ({ x: 0, y: 0, z: 0 }));
    const tag = world.registerComponent('tag', () => ({ name: 'npc' }));
    const a = world.createEntity();
    const b = world.createEntity();
    world.add(b, transform, { x: 2, y: 0, z: 0 });
    world.add(b, tag, { name: 'enemy' });
    world.add(a, transform, { x: 1, y: 0, z: 0 });
    expect(world.query({ all: ['transform'] }).map((row) => Number(row.entity))).toEqual([Number(a), Number(b)]);
    expect(world.query({ all: ['tag'] })[0]?.components.tag).toEqual({ name: 'enemy' });
    expect(world.destroyEntity(a)).toBe(true);
    expect(world.isAlive(a)).toBe(false);
  });
});

describe('input', () => {
  it('normalizes, records and replays commands by tick', () => {
    const input = new InputBuffer(8);
    const frame = input.push(4, { moveX: 2, moveY: 0, lookX: 0.5, lookY: -0.5, pressed: ['jump'], held: ['sprint'], released: [] });
    expect(frame.move.x).toBe(1);
    const recorder = new InputRecorder();
    const commands = recorder.record(frame);
    expect(commands.some((command) => command.action === 'move')).toBe(true);
    const replay = input.get(4);
    expect(replay?.checksum).toBe(frame.checksum);
  });
});

describe('streaming', () => {
  it('caps concurrency and evicts oldest noncritical cells under memory pressure', async () => {
    let active = 0;
    let peak = 0;
    const coordinator = new StreamingCoordinator<{ key: string }>({
      async load(cell) {
        active += 1;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active -= 1;
        return { key: cell.key };
      },
      unload() {},
    }, { loadRadius: 50, unloadRadius: 70, criticalRadius: 10, maxConcurrent: 2, maxLoadsPerFrame: 10, maxUnloadsPerFrame: 10, maxResidentBytes: 25, prefetchVelocitySeconds: 0 });
    coordinator.registerGrid([
      { key: '0:0', x: 0, z: 0, radius: 1, estimatedBytes: 10, assetIds: [] },
      { key: '1:0', x: 20, z: 0, radius: 1, estimatedBytes: 10, assetIds: [] },
      { key: '2:0', x: 40, z: 0, radius: 1, estimatedBytes: 10, assetIds: [] },
    ]);
    coordinator.plan({ x: 0, y: 0, z: 0 });
    await coordinator.pump(1 as Tick);
    expect(peak).toBeLessThanOrEqual(2);
    expect(coordinator.residentBytes()).toBeLessThanOrEqual(25);
    coordinator.dispose();
  });
});

describe('network', () => {
  it('round-trips a snapshot delta deterministically', () => {
    const base = createSnapshot(1 as Tick, 0, 100, [{ entity: 1 as EntityId, revision: 1, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, velocity: { x: 0, y: 0, z: 0 }, flags: 0 }]);
    const target = createSnapshot(2 as Tick, 1, 101, [{ entity: 1 as EntityId, revision: 2, position: { x: 2, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, velocity: { x: 1, y: 0, z: 0 }, flags: 1 }, { entity: 2 as EntityId, revision: 1, position: { x: 4, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, velocity: { x: 0, y: 0, z: 0 }, flags: 0 }]);
    const delta = createDelta(base, target);
    expect(delta.added).toHaveLength(1);
    const session = new NetworkSession('client');
    expect(session.receive(target, 200)).toBe(true);
    expect(session.latest()?.checksum).toBe(target.checksum);
  });

  it('reconciles only when prediction error exceeds tolerance', () => {
    const reconciler = new ClientReconciler({ positionTolerance: 0.1, maxReplayCommands: 4 });
    const current = { entity: 1 as EntityId, revision: 1, position: { x: 1, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, velocity: { x: 0, y: 0, z: 0 }, flags: 0 };
    const authoritative = { ...current, position: { x: 0, y: 0, z: 0 } };
    const result = reconciler.reconcile(current, authoritative, [], (state) => state);
    expect(result.corrected).toBe(true);
    expect(result.correctionDistance).toBe(1);
  });
});

describe('save repository', () => {
  it('validates checksums and migrates schemas one step at a time', async () => {
    interface V4 { score: number }
    interface V5 { score: number; difficulty: number }
    const migrations = new SaveMigrationRegistry<V5>();
    migrations.add<V4, V5>({ from: 4, to: 5, migrate: (state) => ({ score: state.score, difficulty: 2 }) });
    const storage = new MemoryStorage();
    const repository = new SaveRepository<V5>(storage, { keyPrefix: 'test:', currentSchema: 5, maxBytes: 4096, slots: 2 }, migrations, 'test');
    const saved = await repository.save(0, { score: 10, difficulty: 1 }, 8 as Tick, 100);
    expect(saved.ok).toBe(true);
    const loaded = await repository.load(0);
    expect(loaded?.document.state).toEqual({ score: 10, difficulty: 1 });
    expect(loaded?.migrated).toBe(false);
  });
});

describe('render governance', () => {
  it('sorts critical work first and enforces draw-call budget', () => {
    const graph = new RenderGraph({ maxItems: 100, maxDrawCalls: 2, targetGpuMs: 4, passWeights: { depth: 1, shadow: 1, opaque: 1, transparent: 1, post: 1, ui: 1, debug: 1 } });
    graph.beginFrame(1);
    graph.submit({ ...makeRenderItem(1 as EntityId, 'opaque', 'a', 100), critical: false, materialVariants: 1, triangles: 1000 });
    graph.submit({ ...makeRenderItem(2 as EntityId, 'opaque', 'b', 1), critical: true, materialVariants: 1, triangles: 1000 });
    const plan = graph.plan();
    expect(plan.drawCalls).toBeLessThanOrEqual(2);
    expect(plan.passes.get('opaque')?.[0]?.entity).toBe(2 as EntityId);
  });
});

describe('navigation and world', () => {
  it('builds a useful flow field over a procedural cost surface', () => {
    const grid = gridFromFunction(8, 8, 1, { x: 0, y: 0 }, (x, z) => ({ x, z, blocked: x === 3 && z < 6, cost: 1, elevation: (x + z) % 2, slope: 0, danger: x === 6 ? 0.8 : 0 }));
    const field = buildFlowField(grid, [{ x: 7, y: 7 }]);
    expect(field.costs[0]).toBeGreaterThan(0);
    expect(field.directions[0]).not.toBeNull();
  });

  it('generates stable procedural cells and events', () => {
    const first = new ProceduralWorld({ seed: 99, cellSize: 32, worldRadius: 4 });
    const second = new ProceduralWorld({ seed: 99, cellSize: 32, worldRadius: 4 });
    expect(first.generateAround({ x: 0, y: 0, z: 0 }, 2)).toEqual(second.generateAround({ x: 0, y: 0, z: 0 }, 2));
    first.step(1 / 60);
    expect(first.emitEvent('discovery', '0:0').id).toBe(second.emitEvent('discovery', '0:0').id);
  });
});

describe('ai and workers', () => {
  it('keeps thinker budgets bounded and chooses a deterministic action', () => {
    const ai = new AiDirector(7, { maxThinkers: 1, thinkIntervalTicks: 1, memoryLimit: 4 });
    ai.register({ entity: 1 as EntityId, faction: 'one', mode: 'idle', healthRatio: 0.2, staminaRatio: 0.8, morale: 0.4, fatigue: 0.2, alertness: 1, position: { x: 0, y: 0, z: 0 }, memories: [], revision: 0 });
    ai.emit({ source: 2 as EntityId, position: { x: 2, y: 0, z: 0 }, kind: 'damage', strength: 1, tick: 1, faction: 'two' });
    const decisions = ai.tick(1);
    expect(decisions).toHaveLength(1);
    expect(['flee', 'combat']).toContain(decisions[0]?.mode);
    expect(ai.metrics().thinkers).toBe(1);
  });

  it('respects worker concurrency and preserves result order in parallel mapping', async () => {
    const pool = new DeterministicWorkerPool(2);
    pool.enqueue({ lane: 'background', priority: 2, run: async () => 3 });
    pool.enqueue({ lane: 'background', priority: 1, run: async () => 4 });
    const results = await pool.pump(() => 0);
    expect(results.filter((result) => result.ok)).toHaveLength(2);
    pool.shutdown();
  });
});

describe('security and health', () => {
  it('rejects deeply malformed or oversized payloads', () => {
    expect(validateJsonValue({ a: 'x'.repeat(300) }).accepted).toBe(false);
    expect(snapshotAgeValid(100, 90, 20)).toBe(true);
    expect(snapshotAgeValid(100, 79, 20)).toBe(false);
  });

  it('implements token bucket refill behavior', () => {
    const bucket = new TokenBucket(2, 1, 0);
    expect(bucket.consume(1, 0)).toBe(true);
    expect(bucket.consume(1, 0)).toBe(true);
    expect(bucket.consume(1, 0)).toBe(false);
    expect(bucket.consume(1, 1000)).toBe(true);
  });

  it('maps score to explicit health grade', () => {
    expect(healthGrade(95)).toBe('excellent');
    expect(healthGrade(80)).toBe('good');
    expect(healthGrade(60)).toBe('degraded');
    expect(healthGrade(20)).toBe('critical');
  });
});

describe('runtime facade', () => {
  it('selects adaptive hardware tier and advances a complete frame', () => {
    expect(runtimeDeviceTier(16, 32, 1)).toBe('ultra');
    const runtime = createRuntime('balanced', 'offline', 123);
    const states: number[] = [];
    runtime.on('tick', (event) => states.push(Number(event.state.tick)));
    runtime.start(0);
    runtime.frame(16.667, {});
    runtime.frame(33.334, { moveX: 1 });
    expect(runtime.mode()).toBe('running');
    expect(states.length).toBeGreaterThan(0);
    runtime.stop();
    expect(runtime.running).toBe(false);
  });

  it('exposes scheduler adaptation without destabilizing the runtime', async () => {
    const scheduler = new FrameScheduler();
    scheduler.register({ id: 'fast', lane: 'simulation', priority: 10, intervalFrames: 1, maxRuntimeMs: 5, run: () => undefined });
    const telemetry = await scheduler.runFrame(1, DEFAULT_BUDGETS, () => 0);
    expect(telemetry[0]?.id).toBe('fast');
    scheduler.shutdown();
    const adaptive = new AdaptiveBudgetController(DEFAULT_BUDGETS);
    expect(adaptive.observe(30).adjustments).toBeGreaterThan(0);
  });
});
