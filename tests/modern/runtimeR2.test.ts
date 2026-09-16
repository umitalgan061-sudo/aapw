import { describe, expect, it } from 'vitest';
import {
  DeterministicRng,
  DeterministicTimeline,
  ReplayRecorder,
  SimulationKernel,
  calculateAccumulator,
  createSimulationKernel,
  digestString,
  smoothApproach,
} from '../../src/3d/modern/r2/simulationKernel.ts';
import {
  EcsScheduler,
  EcsWorld,
  TransformSchema,
  VelocitySchema,
} from '../../src/3d/modern/r2/ecsRuntime.ts';
import {
  AssetCache,
  ChunkStreamingPlanner,
  StreamingOrchestrator,
} from '../../src/3d/modern/r2/streamingOrchestrator.ts';
import {
  NetworkJitterBuffer,
  ReplicationHistory,
  SnapshotBuilder,
  applySnapshotDelta,
  diffSnapshots,
  type ReplicatedEntity,
} from '../../src/3d/modern/r2/networkReplicationV3.ts';
import {
  MemorySaveStore,
  SaveMigrationGraph,
  decodeSave,
  encodeSave,
  validateSaveEnvelope,
} from '../../src/3d/modern/r2/saveMigrationEngine.ts';
import {
  BudgetMonitor,
  ObservabilityHub,
  TraceRecorder,
} from '../../src/3d/modern/r2/observabilityHub.ts';
import { PredictionController, createSimpleKinematicIntegrator } from '../../src/3d/modern/r2/predictionReconciliation.ts';
import { WorldQueryRuntime, projectToGround } from '../../src/3d/modern/r2/worldQueryRuntime.ts';
import {
  ActorStateSchema,
  GameplayBridge,
  GameplayTagSchema,
  HealthSchema,
  TeamSchema,
  type GameplayActorDefinition,
} from '../../src/3d/modern/r2/gameplayBridge.ts';
import { RuntimeApplication } from '../../src/3d/modern/r2/runtimeApplication.ts';

describe('simulationKernel', () => {
  it('produces stable RNG sequences for the same seed', () => {
    const left = new DeterministicRng(12345);
    const right = new DeterministicRng(12345);
    const a = Array.from({ length: 16 }, () => left.nextUint());
    const b = Array.from({ length: 16 }, () => right.nextUint());
    expect(a).toEqual(b);
    expect(left.state).toEqual(right.state);
  });

  it('supports exact RNG snapshot restoration', () => {
    const rng = new DeterministicRng(77);
    rng.nextUint();
    const state = rng.state;
    const expected = [rng.nextUint(), rng.nextUint(), rng.nextUint()];
    rng.restore(state);
    expect([rng.nextUint(), rng.nextUint(), rng.nextUint()]).toEqual(expected);
  });

  it('rejects invalid RNG state', () => {
    const rng = new DeterministicRng(1);
    expect(() => rng.restore({ state: -1 })).toThrow();
    expect(() => rng.restore({ state: 4_294_967_296 })).toThrow();
  });

  it('orders systems deterministically', () => {
    const kernel = createSimulationKernel(5);
    const observed: string[] = [];
    kernel.addSystem({ id: 'z', order: 20, fixedUpdate: () => observed.push('z') });
    kernel.addSystem({ id: 'a', order: 10, fixedUpdate: () => observed.push('a') });
    kernel.start();
    kernel.step();
    expect(observed).toEqual(['a', 'z']);
  });

  it('limits catch-up work during a stalled frame', () => {
    const kernel = new SimulationKernel(9, { tickRateHz: 60, maxFrameDeltaSeconds: 0.25, maxCatchUpTicks: 4, maxTicksPerFrame: 4 });
    let ticks = 0;
    kernel.addSystem({ id: 'counter', order: 0, fixedUpdate: () => { ticks += 1; } });
    kernel.start();
    const frame = kernel.advance(10);
    expect(frame.simulatedTicks).toBe(4);
    expect(ticks).toBe(4);
    expect(frame.droppedSeconds).toBeGreaterThan(0);
  });

  it('creates a deterministic replay digest', () => {
    const replay = new ReplayRecorder(8);
    replay.record({ tick: 1, inputDigest: 'a', stateDigest: 'b' });
    replay.record({ tick: 2, inputDigest: 'c', stateDigest: 'd' });
    expect(replay.find(2)?.stateDigest).toBe('d');
    expect(replay.digest()).toBe(digestString(replay.records().map((x) => `${x.tick}:${x.inputDigest}:${x.stateDigest}`).join('|')));
  });

  it('schedules and drains timeline events in tick order', () => {
    const timeline = new DeterministicTimeline<number>();
    timeline.schedule(4, 'late', 4);
    timeline.schedule(2, 'early', 2);
    timeline.schedule(4, 'late-second', 5);
    expect(timeline.drainThrough(3).map((event) => event.payload)).toEqual([2]);
    expect(timeline.drainThrough(4).map((event) => event.payload)).toEqual([4, 5]);
  });

  it('calculates interpolation accumulator deterministically', () => {
    const result = calculateAccumulator(0, 1 / 120, 60);
    expect(result.accumulatorSeconds).toBeCloseTo(1 / 120);
    expect(result.interpolationAlpha).toBeCloseTo(0.5);
  });

  it('smoothly approaches a target', () => {
    const value = smoothApproach(0, 10, 10, 0.1);
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(10);
  });
});

describe('ecsRuntime', () => {
  function worldWithCore() {
    const world = new EcsWorld();
    world.registerComponent(TransformSchema);
    world.registerComponent(VelocitySchema);
    world.registerComponent(HealthSchema);
    return world;
  }

  it('creates, queries, mutates and destroys entities', () => {
    const world = worldWithCore();
    const first = world.createEntity();
    const second = world.createEntity();
    world.add(first, TransformSchema, { x: 1, y: 2, z: 3, yaw: 0 });
    world.add(first, VelocitySchema);
    world.add(second, TransformSchema);
    expect(world.query({ all: [TransformSchema.type, VelocitySchema.type] })).toEqual([first]);
    expect(world.count()).toBe(2);
    world.destroyEntity(first);
    expect(world.isAlive(first)).toBe(false);
    expect(world.count()).toBe(1);
  });

  it('reuses destroyed entity slots with a generation increment', () => {
    const world = worldWithCore();
    const entity = world.createEntity();
    const before = world.generation(entity);
    world.destroyEntity(entity);
    const reused = world.createEntity();
    expect(reused).toBe(entity);
    expect(world.generation(reused)).toBe(before + 1);
  });

  it('round-trips ECS snapshots', () => {
    const source = worldWithCore();
    const entity = source.createEntity();
    source.add(entity, TransformSchema, { x: 4, y: 5, z: 6, yaw: 0.25 });
    source.add(entity, VelocitySchema, { x: 1, y: 0, z: 2 });
    source.add(entity, HealthSchema, { current: 80, maximum: 100 });
    const snapshot = source.snapshot();
    const target = worldWithCore();
    target.restore(snapshot);
    expect(target.digest()).toBe(source.digest());
  });

  it('produces deterministic query order regardless of creation order', () => {
    const world = worldWithCore();
    const entities = [world.createEntity(), world.createEntity(), world.createEntity()];
    for (const entity of entities) {
      world.add(entity, TransformSchema);
      world.add(entity, VelocitySchema);
    }
    expect(world.query({ all: [VelocitySchema.type, TransformSchema.type] })).toEqual([1, 2, 3]);
  });

  it('runs scheduler systems by phase and order', () => {
    const world = worldWithCore();
    const scheduler = new EcsScheduler();
    const observed: string[] = [];
    scheduler.add({ id: 'post', phase: 'post', order: 0, query: { all: [TransformSchema.type] }, update: () => observed.push('post') });
    scheduler.add({ id: 'pre', phase: 'pre', order: 0, query: { all: [TransformSchema.type] }, update: () => observed.push('pre') });
    scheduler.add({ id: 'simulate', phase: 'simulate', order: 0, query: { all: [TransformSchema.type] }, update: () => observed.push('simulate') });
    const entity = world.createEntity();
    world.add(entity, TransformSchema);
    scheduler.run(world, 1 / 60, 1);
    expect(observed).toEqual(['pre', 'simulate', 'post']);
  });

  it('flushes a stable mutation batch', () => {
    const world = worldWithCore();
    const entity = world.createEntity();
    world.add(entity, TransformSchema);
    world.set(entity, TransformSchema, { x: 1, y: 0, z: 0, yaw: 0 });
    const batch = world.flushMutationBatch(7);
    expect(batch.committedAtTick).toBe(7);
    expect(batch.changes.map((change) => change.kind)).toEqual(['add', 'set']);
  });
});

describe('streamingOrchestrator', () => {
  it('evicts lower priority entries to remain under a byte budget', () => {
    const cache = new AssetCache<string>(100);
    cache.set('far', 'far', 70, 'far', 1);
    cache.set('critical', 'critical', 70, 'critical', 2);
    expect(cache.has('critical')).toBe(true);
    expect(cache.usedBytes).toBeLessThanOrEqual(100);
  });

  it('loads queued assets and caches them', async () => {
    const loaded: string[] = [];
    const loader = { load: async (request: { key: string }, _signal: AbortSignal) => { loaded.push(request.key); return `loaded:${request.key}`; } };
    const orchestrator = new StreamingOrchestrator(loader, 1024, { maxConcurrent: 2 });
    orchestrator.enqueue({ key: 'a', url: '/a.glb', priority: 'visible', byteEstimate: 100, distanceMeters: 3 });
    orchestrator.enqueue({ key: 'b', url: '/b.glb', priority: 'near', byteEstimate: 100, distanceMeters: 4 });
    await orchestrator.pump(5);
    expect(loaded).toEqual(['a', 'b']);
    expect(orchestrator.cache.get('a', 6)).toBe('loaded:a');
    expect(orchestrator.stats().states.ready).toBe(2);
  });

  it('retries failed loads with bounded attempts', async () => {
    let attempts = 0;
    const loader = { load: async () => { attempts += 1; throw new Error('boom'); } };
    const orchestrator = new StreamingOrchestrator(loader, 1024, { maxConcurrent: 1, retryBackoffMs: 0 });
    orchestrator.enqueue({ key: 'bad', url: '/bad', priority: 'critical', byteEstimate: 10, distanceMeters: 1, retryLimit: 2 });
    await orchestrator.pump(1);
    expect(attempts).toBe(3);
    expect(orchestrator.consumeCompleted()[0]?.state).toBe('failed');
  });

  it('plans chunk loads by camera distance', () => {
    const planner = new ChunkStreamingPlanner();
    const result = planner.plan([
      { chunkId: 'near', centerX: 0, centerZ: 0, radiusMeters: 32, assetKeys: ['a'], priority: 'visible' },
      { chunkId: 'far', centerX: 320, centerZ: 0, radiusMeters: 32, assetKeys: ['b'], priority: 'visible' },
    ], 0, 0, 1);
    expect(result.loads[0]?.key).toBe('a');
    expect(result.loads[1]?.priority).toBe('near');
  });
});

describe('networkReplicationV3', () => {
  const entity = (x: number): ReplicatedEntity => ({ id: 1, generation: 1, transform: { x, y: 0, z: 0, yaw: 0 }, components: [] });

  it('creates deterministic snapshot digests', () => {
    const builder = new SnapshotBuilder();
    const first = builder.build(1, 1, [entity(0)]);
    const second = builder.build(1, 1, [entity(0)]);
    expect(first.digest).toBe(second.digest);
  });

  it('diffs and reconstructs state', () => {
    const builder = new SnapshotBuilder();
    const before = builder.build(1, 1, [entity(0)]);
    const after = builder.build(2, 2, [entity(5)]);
    const delta = diffSnapshots(before, after);
    const reconstructed = applySnapshotDelta(before, delta);
    expect(reconstructed.entities[0]?.transform?.x).toBe(5);
    expect(reconstructed.digest).toBe(after.digest);
  });

  it('tracks bounded replication history', () => {
    const history = new ReplicationHistory(2);
    const builder = new SnapshotBuilder();
    history.push(builder.build(1, 1, []));
    history.push(builder.build(2, 2, []));
    history.push(builder.build(3, 3, []));
    expect(history.size()).toBe(2);
    expect(history.find(1)).toBeUndefined();
    expect(history.latest()?.tick).toBe(3);
  });

  it('interpolates delayed network samples', () => {
    const buffer = new NetworkJitterBuffer({ interpolationDelayTicks: 0, maxSamples: 8 });
    buffer.push(1, { tick: 10, transform: { x: 0, y: 0, z: 0, yaw: 0 } });
    buffer.push(1, { tick: 11, transform: { x: 10, y: 0, z: 0, yaw: 0 } });
    expect(buffer.sample(1, 10.5)?.x).toBeCloseTo(5);
  });
});

describe('saveMigrationEngine', () => {
  it('encodes and validates checksummed saves', () => {
    const encoded = encodeSave({ version: 1, createdAtTick: 20, worldSeed: 12, profileId: 'player', payload: { gold: 30 } });
    const decoded = decodeSave(encoded) as { payload: { gold: number } };
    expect(decoded.payload.gold).toBe(30);
    expect(validateSaveEnvelope(JSON.parse(encoded)).valid).toBe(true);
  });

  it('detects checksum tampering', () => {
    const parsed = JSON.parse(encodeSave({ version: 1, createdAtTick: 1, worldSeed: 2, profileId: 'p', payload: { hp: 10 } }));
    parsed.payload.hp = 99;
    expect(validateSaveEnvelope(parsed).errors).toContain('checksum mismatch');
  });

  it('migrates through a version graph', () => {
    const graph = new SaveMigrationGraph();
    graph.register({ fromVersion: 1, toVersion: 2, id: 'one-two', migrate: (value: { score: number }) => ({ score: value.score, rank: 2 }) });
    graph.register({ fromVersion: 2, toVersion: 3, id: 'two-three', migrate: (value: { rank: number }) => ({ rank: value.rank, online: true }) });
    expect(graph.migrate({ score: 50 }, 1, 3)).toEqual({ rank: 2, online: true });
  });

  it('persists through the memory store', async () => {
    const store = new MemorySaveStore();
    await store.write('a', 'b');
    expect(await store.read('a')).toBe('b');
    await store.remove('a');
    expect(await store.read('a')).toBeNull();
  });
});

describe('observabilityHub', () => {
  it('collects counters, gauges and histogram summaries', () => {
    const hub = new ObservabilityHub();
    hub.setTick(4);
    hub.increment('entity.spawned', 2);
    hub.gauge('world.entities', 10);
    hub.observe('frame.runtime.ms', 10);
    hub.observe('frame.runtime.ms', 20);
    const snapshot = hub.snapshot();
    expect(snapshot.counters['entity.spawned|']).toBe(2);
    expect(snapshot.gauges['world.entities|']).toBe(10);
    expect(snapshot.histograms['frame.runtime.ms|']?.p50).toBe(10);
  });

  it('emits budget alerts above threshold', () => {
    const hub = new ObservabilityHub();
    const budgets = new BudgetMonitor(hub);
    budgets.register({ metric: 'frame.ms', warning: 16, error: 30, unit: 'ms' });
    expect(budgets.checkFrame(20).level).toBe('warning');
    expect(budgets.checkFrame(31).level).toBe('error');
    expect(hub.snapshot().alerts).toHaveLength(2);
  });

  it('records bounded traces', () => {
    const recorder = new TraceRecorder(3);
    recorder.record('a', 1, 1, 5);
    recorder.record('b', 2, 2, 20);
    recorder.record('c', 3, 3, 10);
    recorder.record('d', 4, 4, 1);
    expect(recorder.list()).toHaveLength(3);
    expect(recorder.longest()[0]?.name).toBe('b');
  });
});

describe('predictionReconciliation', () => {
  it('replays local inputs after authoritative correction', () => {
    const initial = { tick: 0, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, yaw: 0, health: 100 };
    const controller = new PredictionController(1, initial, createSimpleKinematicIntegrator(10));
    controller.predict({ tick: 1, sequence: 1, moveX: 1, moveZ: 0, yawDelta: 0, jump: false, sprint: false }, 0.1);
    controller.predict({ tick: 2, sequence: 2, moveX: 1, moveZ: 0, yawDelta: 0, jump: false, sprint: false }, 0.1);
    const result = controller.reconcile({ tick: 1, position: { x: 0.5, y: 0, z: 0 }, velocity: { x: 10, y: 0, z: 0 }, yaw: 0, health: 100 }, 0.1);
    expect(result.corrected).toBe(true);
    expect(result.replayedInputs).toBe(1);
    expect(result.newState.position.x).toBeGreaterThan(0.5);
  });

  it('stabilizes without correction when authority is within tolerance', () => {
    const initial = { tick: 0, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, yaw: 0, health: 100 };
    const controller = new PredictionController(1, initial, createSimpleKinematicIntegrator(1));
    controller.predict({ tick: 1, sequence: 1, moveX: 1, moveZ: 0, yawDelta: 0, jump: false, sprint: false }, 0.1);
    const result = controller.reconcile({ tick: 1, position: { x: 0.10001, y: 0, z: 0 }, velocity: { x: 1, y: 0, z: 0 }, yaw: 0, health: 100 }, 0.1);
    expect(result.corrected).toBe(false);
    expect(result.reason).toBe('within-tolerance');
  });
});

describe('worldQueryRuntime', () => {
  it('supports radius, box and ray queries', () => {
    const world = new WorldQueryRuntime<string>(10);
    world.insert('a', { x: 0, y: 0, z: 0 }, 'npc', 0.5);
    world.insert('b', { x: 20, y: 0, z: 0 }, 'prop', 1);
    expect(world.sphere({ center: { x: 0, y: 0, z: 0 }, radius: 2 })[0]?.value).toBe('a');
    expect(world.box({ min: { x: -2, y: -2, z: -2 }, max: { x: 2, y: 2, z: 2 } })[0]?.value).toBe('a');
    expect(world.ray({ origin: { x: -10, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 }, maxDistance: 15 })[0]?.value).toBe('a');
  });

  it('keeps query results distance ordered', () => {
    const world = new WorldQueryRuntime<string>(8);
    world.insert('far', { x: 7, y: 0, z: 0 });
    world.insert('near', { x: 2, y: 0, z: 0 });
    expect(world.sphere({ center: { x: 0, y: 0, z: 0 }, radius: 10 }).map((hit) => hit.value)).toEqual(['near', 'far']);
  });

  it('projects positions onto a supplied ground height', () => {
    const projection = projectToGround({ x: 3, y: 100, z: 4 }, (x, z) => ({ height: x + z }));
    expect(projection.output).toEqual({ x: 3, y: 7, z: 4 });
    expect(projection.verticalCorrection).toBe(-93);
  });
});

describe('gameplayBridge', () => {
  it('creates actors with typed gameplay components', () => {
    const world = new EcsWorld();
    world.registerComponent(TransformSchema);
    world.registerComponent(VelocitySchema);
    const hub = new ObservabilityHub();
    const bridge = new GameplayBridge(world, hub);
    const definition: GameplayActorDefinition = { team: 'north', tags: ['guard'], health: 50, position: { x: 1, y: 2, z: 3 } };
    const entity = bridge.createActor(definition);
    expect(world.get(entity, TeamSchema.type)?.team).toBe('north');
    expect(world.get(entity, GameplayTagSchema.type)?.tags).toEqual(['guard']);
    expect(world.get(entity, HealthSchema.type)?.current).toBe(50);
    expect(world.get(entity, ActorStateSchema.type)?.state).toBe('idle');
  });

  it('finds allies and enemies by team', () => {
    const world = new EcsWorld();
    world.registerComponent(TransformSchema);
    world.registerComponent(VelocitySchema);
    const bridge = new GameplayBridge(world, new ObservabilityHub());
    const a = bridge.createActor({ team: 'north', position: { x: 0, y: 0, z: 0 } });
    const b = bridge.createActor({ team: 'north', position: { x: 2, y: 0, z: 0 } });
    const c = bridge.createActor({ team: 'south', position: { x: 3, y: 0, z: 0 } });
    expect(bridge.allies(a, 5)).toEqual([b]);
    expect(bridge.enemies(a, 5)).toEqual([c]);
  });

  it('emits damage and death events', () => {
    const bridgeWorld = new EcsWorld();
    bridgeWorld.registerComponent(TransformSchema);
    bridgeWorld.registerComponent(VelocitySchema);
    const bridge = new GameplayBridge(bridgeWorld, new ObservabilityHub());
    const entity = bridge.createActor({ health: 10 });
    bridge.damage(entity, 15, 4);
    const report = bridge.update({ tick: 4, deltaSeconds: 1 / 60, frameDeltaSeconds: 1 / 60, deterministicSeed: 1, frameIndex: 1 });
    expect(report.deadActors).toBe(1);
    expect(report.events.map((event) => event.type)).toContain('damage');
    expect(bridgeWorld.get(entity, ActorStateSchema.type)?.state).toBe('dead');
  });
});

describe('runtimeApplication', () => {
  it('composes simulation, ECS, networking, saving and observability', async () => {
    const app = new RuntimeApplication({ worldSeed: 123, tickRateHz: 60, profileId: 'test' }, async (request) => ({ key: request.key }));
    app.spawnActor({ vx: 1, vz: 2 });
    app.start();
    const first = await app.frame(1 / 60);
    const second = await app.frame(1 / 60);
    expect(second.tick).toBeGreaterThan(first.tick);
    expect(app.world.count()).toBe(1);
    expect(app.diagnostics().metrics.tick).toBe(second.tick);
    await app.save({ schema: 'runtime-r2', digest: app.digest(), entityCount: app.world.count() });
    const loaded = await app.load();
    expect(loaded?.payload.entityCount).toBe(1);
    app.dispose();
  });

  it('streams assets through the composed runtime', async () => {
    const app = new RuntimeApplication({ worldSeed: 8 }, async (request) => `asset:${request.key}`);
    app.queueAsset({ key: 'tree', url: '/tree.glb', priority: 'visible', byteEstimate: 50, distanceMeters: 10 });
    await app.flushStreams();
    expect(app.streams.cache.has('tree')).toBe(true);
    app.dispose();
  });
});
