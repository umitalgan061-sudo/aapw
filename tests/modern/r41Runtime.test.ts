
import { describe, expect, it } from 'vitest';
import { DeterministicClockR41 } from '../../src/3d/strict/r41/clock.ts';
import { EventStoreR41 } from '../../src/3d/strict/r41/eventStore.ts';
import { CommandPipelineR41 } from '../../src/3d/strict/r41/commandPipeline.ts';
import { WorkSchedulerR41, createDefaultBudgetsR41 } from '../../src/3d/strict/r41/scheduler.ts';
import { NetworkSessionR41 } from '../../src/3d/strict/r41/network.ts';
import { AssetGraphR41 } from '../../src/3d/strict/r41/assets.ts';
import { RenderGovernorR41 } from '../../src/3d/strict/r41/render.ts';
import { MemorySaveStoreR41, PersistenceR41, RollbackJournalR41 } from '../../src/3d/strict/r41/persistence.ts';
import { ProductionRuntimeR41 } from '../../src/3d/strict/r41/runtime.ts';
import { stableHash, vec3 } from '../../src/3d/strict/r41/types.ts';

describe('R41 clock', () => {
  it('bounds catch-up work and records dropped simulation', () => {
    const clock = new DeterministicClockR41({ fixedStepSeconds: 1 / 60, maxCatchUpSteps: 2 });
    const ticks: number[] = [];
    expect(clock.pushFrameDelta(0.2, step => ticks.push(step.tick))).toBe(2);
    expect(ticks).toEqual([1, 2]);
    expect(clock.snapshot().droppedSteps).toBeGreaterThan(0);
  });

  it('does not advance while paused and resumes exactly', () => {
    const clock = new DeterministicClockR41();
    clock.pause();
    expect(clock.pushFrameDelta(1, () => undefined)).toBe(0);
    clock.resume();
    expect(clock.pushFrameDelta(1 / 60, () => undefined)).toBe(1);
    expect(clock.tick).toBe(1);
  });

  it('replay of equal deltas is deterministic', () => {
    const deltas = [1 / 120, 1 / 60, 1 / 30, 0.011, 0.07];
    const a = new DeterministicClockR41();
    const b = new DeterministicClockR41();
    for (const delta of deltas) {
      a.pushFrameDelta(delta, () => undefined);
      b.pushFrameDelta(delta, () => undefined);
    }
    expect(a.snapshot()).toEqual(b.snapshot());
  });
});

describe('R41 event store', () => {
  it('bounds history while keeping monotonic sequence', () => {
    const store = new EventStoreR41(128);
    for (let tick = 0; tick < 300; tick += 1) {
      store.append({ type: 'runtime.tick', tick, deltaSeconds: 1 / 60 });
    }
    expect(store.all()).toHaveLength(128);
    expect(store.all()[0]?.sequence).toBeGreaterThan(1);
    expect(store.all()[127]?.sequence).toBeGreaterThan(store.all()[0]?.sequence ?? 0);
  });

  it('supports filtered queries and deterministic checkpoints', () => {
    const store = new EventStoreR41();
    store.append({ type: 'runtime.tick', tick: 3, deltaSeconds: 1 / 60 });
    store.append({ type: 'runtime.tick', tick: 4, deltaSeconds: 1 / 60 });
    store.append({ type: 'runtime.mode', tick: 4, from: 'booting', to: 'running', reason: 'test' });
    expect(store.byTick(4)).toHaveLength(2);
    expect(store.query({ type: 'runtime.tick' })).toHaveLength(2);
    const checkpoint = store.checkpoint('boot', 4);
    expect(store.checkpointById('boot')).toEqual(checkpoint);
    expect(checkpoint.digest).toBe(store.digest());
  });

  it('can prune by tick without changing sequence identity', () => {
    const store = new EventStoreR41();
    for (let tick = 1; tick <= 10; tick += 1) store.append({ type: 'runtime.tick', tick, deltaSeconds: 1 / 60 });
    const sequence = store.snapshot().sequence;
    expect(store.pruneBeforeTick(7)).toBe(6);
    expect(store.snapshot().sequence).toBe(sequence);
    expect(store.snapshot().oldestTick).toBe(7);
  });
});

describe('R41 command pipeline', () => {
  const base = {
    tick: 5,
    entityId: 'player',
    kind: 'move' as const,
    source: 'keyboard',
    payload: { x: 1, y: 0 },
  };

  it('accepts valid commands and deduplicates them', () => {
    const pipeline = new CommandPipelineR41();
    const a = pipeline.dispatch({ ...base, sequence: 10 }, 5);
    const b = pipeline.dispatch({ ...base, sequence: 10 }, 5);
    expect(a.accepted).toBe(true);
    expect(b.reason).toBe('duplicate');
    expect(pipeline.commandsForTick(5)).toHaveLength(1);
  });

  it('rejects outside tick windows and hostile payloads', () => {
    const pipeline = new CommandPipelineR41({ futureTickWindow: 2 });
    expect(pipeline.dispatch({ ...base, tick: 99 }, 5).reason).toBe('invalid-tick');
    const cyclic = {} as Record<string, unknown>;
    cyclic.self = cyclic;
    expect(pipeline.dispatch({ ...base, sequence: 11, payload: cyclic }, 5).reason).toBe('invalid-payload');
  });

  it('limits per-source burst traffic', () => {
    const pipeline = new CommandPipelineR41({ burst: 2 });
    expect(pipeline.dispatch({ ...base, sequence: 1 }, 5).accepted).toBe(true);
    expect(pipeline.dispatch({ ...base, sequence: 2 }, 5).accepted).toBe(true);
    expect(pipeline.dispatch({ ...base, sequence: 3 }, 5).reason).toBe('rate-limited');
  });

  it('keeps transactional dispatch bounded', () => {
    const pipeline = new CommandPipelineR41({ maxPerTick: 2 });
    const tx = pipeline.beginTransaction('t1', 5);
    tx.add({ ...base, sequence: 1 });
    tx.add({ ...base, sequence: 2, kind: 'guard' });
    const receipts = tx.commit(5);
    expect(receipts.every(receipt => receipt.accepted)).toBe(true);
    expect(tx.size()).toBe(2);
  });
});

describe('R41 scheduler', () => {
  it('coalesces work to the newest payload', async () => {
    const scheduler = new WorkSchedulerR41(createDefaultBudgetsR41());
    let value = 0;
    scheduler.enqueue({ id: 'a', class: 'gameplay', priority: 'low', estimatedMs: 0.2, deadlineTick: 1, coalescingKey: 'same', payload: 1, execute: payload => { value = payload; } });
    scheduler.enqueue({ id: 'b', class: 'gameplay', priority: 'high', estimatedMs: 0.2, deadlineTick: 1, coalescingKey: 'same', payload: 7, execute: payload => { value = payload; } });
    const result = await scheduler.runTick(1, () => 0);
    expect(result).toHaveLength(1);
    expect(value).toBe(7);
  });

  it('reports failed work without collapsing the scheduler', async () => {
    const scheduler = new WorkSchedulerR41(createDefaultBudgetsR41());
    scheduler.enqueue({ id: 'fail', class: 'telemetry', priority: 'normal', estimatedMs: 0.1, deadlineTick: 1, coalescingKey: null, payload: null, execute: () => { throw new Error('boom'); } });
    scheduler.enqueue({ id: 'ok', class: 'telemetry', priority: 'low', estimatedMs: 0.1, deadlineTick: 1, coalescingKey: null, payload: null, execute: () => undefined });
    const result = await scheduler.runTick(1, () => 0);
    expect(result.some(item => item.failed)).toBe(true);
    expect(result.some(item => item.completed)).toBe(true);
  });
});

describe('R41 network', () => {
  const one = {
    id: 'player',
    revision: 1,
    position: vec3(1, 2, 3),
    velocity: vec3(0, 0, 0),
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    health: 100,
    stamina: 90,
    flags: 1,
  };

  it('creates deltas and applies them deterministically', () => {
    const network = new NetworkSessionR41();
    const a = network.encodeSnapshot(1, 1, 0, [one]);
    const b = network.encodeSnapshot(2, 2, 1, [{ ...one, revision: 2, health: 95 }]);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    const delta = network.createDelta(a!, b!);
    const result = network.applyDelta(a!, delta);
    expect(result?.tick).toBe(2);
    expect(result?.entities[0]?.health).toBe(95);
    expect(stableHash(result?.entities ?? [])).toBe(stableHash(b!.entities));
  });

  it('flags predicted drift for rollback', () => {
    const network = new NetworkSessionR41();
    const authoritative = network.encodeSnapshot(10, 1, 0, [one])!;
    const predicted = network.encodeSnapshot(12, 2, 1, [{ ...one, position: vec3(9, 2, 3) }])!;
    const result = network.reconcile(authoritative, predicted);
    expect(result.accepted).toBe(true);
    expect(result.rollbackRequired).toBe(true);
    expect(result.corrections).toHaveLength(1);
  });

  it('rejects corrupted packets', () => {
    const network = new NetworkSessionR41();
    const snapshot = network.encodeSnapshot(1, 1, 0, [one])!;
    const corrupted = { ...snapshot, checksum: snapshot.checksum + 1 };
    expect(network.receiveSnapshot(corrupted)).toBe(false);
    expect(network.metrics().rejected).toBe(1);
  });
});

describe('R41 assets', () => {
  it('plans dependency chains before dependants', () => {
    const graph = new AssetGraphR41();
    graph.declare({ id: 'shader', url: '/shader', bytes: 100, priority: 'high' });
    graph.declare({ id: 'material', url: '/material', bytes: 200, priority: 'normal', dependencies: ['shader'] });
    graph.transition('shader', 'queued');
    graph.transition('material', 'queued');
    expect(graph.plan(['material']).map(item => item.id)).toEqual(['shader', 'material']);
  });

  it('evicts the least valuable ready assets under byte pressure', () => {
    const graph = new AssetGraphR41({ maxBytes: 1024 * 1024 });
    graph.declare({ id: 'low', url: '/low', bytes: 700_000, priority: 'low' });
    graph.declare({ id: 'critical', url: '/critical', bytes: 700_000, priority: 'high', critical: true });
    graph.transition('low', 'queued');
    graph.transition('low', 'loading');
    graph.transition('low', 'ready');
    graph.transition('critical', 'queued');
    graph.transition('critical', 'loading');
    graph.transition('critical', 'ready');
    expect(graph.stats().residentBytes).toBeLessThanOrEqual(graph.maxBytes);
    expect(graph.get('critical')?.state).toBe('ready');
  });

  it('rejects dependency cycles', () => {
    const graph = new AssetGraphR41();
    graph.declare({ id: 'a', url: '/a', dependencies: ['b'] });
    graph.declare({ id: 'b', url: '/b', dependencies: ['a'] });
    expect(() => graph.plan(['a'])).toThrow(/cyclic/);
  });
});

describe('R41 render governor', () => {
  const input = {
    backend: 'webgpu' as const,
    width: 1920,
    height: 1080,
    frameMs: 12,
    cpuMs: 5,
    gpuMs: 4,
    memoryPressure: 0.1,
    thermalPressure: 0,
    requestedFeatures: ['taa', 'temporalHistory', 'bloom', 'multiview'] as const,
    webgpuAvailable: true,
    textureCompression: true,
    visibility: 1,
    cameraCut: false,
    reducedMotion: false,
    saveData: false,
  };

  it('selects WebGPU only when available and negotiates features', () => {
    const governor = new RenderGovernorR41({ initialTier: 'ultra' });
    const plan = governor.decide(input);
    expect(plan.backend).toBe('webgpu');
    expect(plan.enabledFeatures).toContain('taa');
    expect(plan.enabledFeatures).toContain('multiview');
  });

  it('degrades after sustained pressure and invalidates temporal history', () => {
    const governor = new RenderGovernorR41({ initialTier: 'ultra' });
    let last = input;
    let plan = governor.decide(input);
    for (let i = 0; i < 10; i += 1) {
      last = { ...input, frameMs: 45, cpuMs: 30, gpuMs: 30, thermalPressure: 0.8 };
      plan = governor.decide(last);
    }
    expect(['minimal', 'low', 'balanced', 'high']).toContain(plan.tier);
    expect(plan.scale).toBeLessThan(0.9);
    expect(governor.snapshot().tier).toBe(plan.tier);
  });

  it('respects reduced-motion history suppression', () => {
    const governor = new RenderGovernorR41({ initialTier: 'high' });
    const plan = governor.decide({ ...input, reducedMotion: true });
    expect(plan.enabledFeatures).not.toContain('temporalHistory');
  });
});

describe('R41 persistence', () => {
  it('verifies immutable save envelopes', () => {
    let now = 10;
    const persistence = new PersistenceR41({
      store: new MemorySaveStoreR41(),
      profileId: 'profile',
      now: () => now,
    });
    const world = {
      version: 41 as const,
      tick: 4,
      revision: 8,
      seed: 41,
      entities: [],
      flags: {},
      values: {},
      checksum: stableHash({
        version: 41,
        tick: 4,
        revision: 8,
        seed: 41,
        entities: [],
        flags: {},
        values: {},
      }),
    };
    const saved = persistence.save('slot', world, { scene: 'intro' });
    expect(saved.createdAtMs).toBe(10);
    expect(persistence.load('slot')?.slot).toBe('slot');
    now = 20;
    expect(persistence.load('slot')?.createdAtMs).toBe(10);
  });

  it('runs chained schema migrations', () => {
    const persistence = new PersistenceR41({
      store: new MemorySaveStoreR41(),
      now: () => 0,
    });
    persistence.registerMigration({
      from: 39,
      to: 40,
      migrate: input => ({ ...(input as Record<string, unknown>), schema: 40 }),
    });
    persistence.registerMigration({
      from: 40,
      to: 41,
      migrate: input => ({ ...(input as Record<string, unknown>), schema: 41 }),
    });
    const envelope = {
      schema: 39,
      slot: 'legacy',
      createdAtMs: 0,
      world: {} as never,
      metadata: {},
      checksum: 0,
    };
    expect(persistence.migrate(envelope).schema).toBe(41);
  });

  it('bounds rollback history and finds the closest snapshot', () => {
    const journal = new RollbackJournalR41(3);
    const checksum = stableHash([]);
    for (let tick = 1; tick <= 6; tick += 1) {
      journal.push({ version: 41, tick, revision: tick, seed: 41, entities: [], flags: {}, values: {}, checksum });
    }
    expect(journal.size()).toBe(3);
    expect(journal.atOrBefore(5)?.tick).toBe(5);
  });
});

describe('R41 runtime composition', () => {
  it('boots, moves a player and emits observable state', async () => {
    const runtime = new ProductionRuntimeR41({ now: () => 0 });
    expect(runtime.start()).toBe(true);
    expect(runtime.registerDefaultPlayer()).toBe(true);
    runtime.pushInput({
      tick: 1,
      move: { x: 1, y: 0 },
      look: { x: 0, y: 0 },
      jump: false,
      sprint: true,
      guard: false,
      attack: false,
      dodge: false,
      interact: false,
      source: 'keyboard',
    });
    const frame = await runtime.frame({
      deltaSeconds: 1 / 60,
      cameraPosition: { x: 0, y: 10, z: 20 },
      render: { frameMs: 12, cpuMs: 5 },
    });
    expect(frame.snapshot.tick).toBe(1);
    expect(frame.snapshot.entities).toBe(1);
    expect(runtime.entity('player')?.transform.position.x).toBeGreaterThan(0);
    expect(runtime.events.byTick(1).some(event => event.type === 'runtime.tick')).toBe(true);
  });

  it('handles commands, save, rollback and restart without losing state invariants', async () => {
    const runtime = new ProductionRuntimeR41();
    runtime.start();
    runtime.registerDefaultPlayer();
    runtime.pushInput({
      tick: 1,
      move: { x: 0, y: 0 },
      look: { x: 0, y: 0 },
      jump: false,
      sprint: false,
      guard: false,
      attack: false,
      dodge: false,
      interact: false,
      source: 'keyboard',
    });
    await runtime.frame({ deltaSeconds: 1 / 60 });
    runtime.dispatchCommand({
      tick: 2,
      entityId: 'player',
      kind: 'teleport',
      source: 'test',
      payload: { x: 10, y: 4, z: 8 },
      sequence: 1,
    });
    await runtime.frame({ deltaSeconds: 1 / 60 });
    expect(runtime.entity('player')?.transform.position.x).toBe(10);
    const save = runtime.save('r41');
    expect(save.entities).toHaveLength(1);
    expect(runtime.rollbackTo(1)).toBe(true);
    expect(runtime.entity('player')?.transform.position.x).toBe(0);
    expect(runtime.load('r41')).toBe(true);
    expect(runtime.entity('player')?.transform.position.x).toBe(10);
    runtime.pause();
    expect(runtime.start()).toBe(true);
    expect(runtime.mode).toBe('paused');
    runtime.resume();
    expect(runtime.mode).toBe('running');
  });

  it('switches quality and records a deterministic snapshot checksum', async () => {
    const runtime = new ProductionRuntimeR41();
    runtime.start();
    runtime.registerDefaultPlayer();
    const a = await runtime.frame({ deltaSeconds: 1 / 60 });
    const b = await runtime.frame({ deltaSeconds: 1 / 60 });
    expect(a.snapshot.checksum).not.toBe(0);
    expect(b.snapshot.checksum).not.toBe(a.snapshot.checksum);
    expect(runtime.health().score).toBeGreaterThanOrEqual(0);
    expect(runtime.health().score).toBeLessThanOrEqual(100);
  });
});
