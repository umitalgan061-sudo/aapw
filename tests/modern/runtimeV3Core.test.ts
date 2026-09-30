import { describe, expect, it } from 'vitest';
import { createDefaultEcsWorldV3, Identity, Transform, Velocity, Health, Stamina, Network, Lifetime } from '../../src/3d/modern/ecsRuntimeV3.ts';
import { EngineKernelV3, installCoreGameplaySystemsV3 } from '../../src/3d/modern/engineKernelV3.ts';
import { PerformanceGovernorV3, FrameBudgetPlannerV3 } from '../../src/3d/modern/performanceRuntimeV3.ts';
import { WorldQueryV3 } from '../../src/3d/modern/worldQueryV3.ts';
import { createRuntimeObservabilityV3 } from '../../src/3d/modern/observabilityV3.ts';

function createKernel() {
  const world = createDefaultEcsWorldV3();
  const kernel = new EngineKernelV3({ world });
  installCoreGameplaySystemsV3(kernel);
  return { world, kernel };
}

describe('ECS v3', () => {
  it('creates deterministic, ordered entity ids', () => {
    const world = createDefaultEcsWorldV3();
    const a = world.spawn();
    const b = world.spawn();
    const c = world.spawn();
    expect(world.entities()).toEqual([a, b, c]);
    expect(world.snapshot().map((entry) => entry.id)).toEqual([a, b, c]);
  });

  it('registers and validates component schemas', () => {
    const world = createDefaultEcsWorldV3();
    const entity = world.spawn();
    expect(world.createAndAttach(entity, Transform, { x: 10, y: 2, z: -4 }).x).toBe(10);
    expect(world.createAndAttach(entity, Health, { maximum: 80, current: 40 }).current).toBe(40);
    expect(world.has(entity, Transform.type)).toBe(true);
    expect(world.require(entity, Health).maximum).toBe(80);
  });

  it('queries by required and excluded components', () => {
    const world = createDefaultEcsWorldV3();
    const player = world.spawn();
    world.createAndAttach(player, Identity, { archetype: 'player' });
    world.createAndAttach(player, Transform, {});
    const prop = world.spawn();
    world.createAndAttach(prop, Identity, { archetype: 'prop' });
    world.createAndAttach(prop, Transform, {});
    world.createAndAttach(prop, Network, { authority: 'remote' });
    const result = world.queryEntities({ required: [Transform.type, Identity.type], excluded: [Network.type], order: 'id' });
    expect(result).toEqual([player]);
  });

  it('keeps query order deterministic regardless of insertion order', () => {
    const world = createDefaultEcsWorldV3();
    const ids = [world.spawn(), world.spawn(), world.spawn(), world.spawn()];
    for (const id of [...ids].reverse()) world.createAndAttach(id, Transform, {});
    expect(world.queryEntities({ required: [Transform.type], excluded: [], order: 'id' })).toEqual(ids);
  });

  it('clones an entity without sharing mutable component references', () => {
    const world = createDefaultEcsWorldV3();
    const original = world.spawn();
    world.createAndAttach(original, Identity, { archetype: 'npc', tags: ['guard'] });
    world.createAndAttach(original, Transform, { x: 5 });
    const clone = world.cloneEntity(original);
    expect(clone).not.toBe(original);
    expect(world.require(clone, Identity).tags).toEqual(['guard']);
    world.mutate(clone, Transform, (value) => { value.x = 99; });
    expect(world.require(original, Transform).x).toBe(5);
  });

  it('supports component mutation with validation', () => {
    const world = createDefaultEcsWorldV3();
    const id = world.spawn();
    world.createAndAttach(id, Stamina, { maximum: 100, current: 20 });
    world.mutate(id, Stamina, (stamina) => { stamina.current += 30; });
    expect(world.require(id, Stamina).current).toBe(50);
    expect(() => world.mutate(id, Stamina, (stamina) => { stamina.maximum = -1; })).toThrow();
  });

  it('destroys entities and detaches their components', () => {
    const world = createDefaultEcsWorldV3();
    const id = world.spawn();
    world.createAndAttach(id, Transform, {});
    expect(world.destroy(id)).toBe(true);
    expect(world.has(id, Transform.type)).toBe(false);
    expect(world.destroy(id)).toBe(false);
  });
});

describe('Engine kernel v3', () => {
  it('advances simulation in fixed increments', () => {
    const { world, kernel } = createKernel();
    const id = world.spawn();
    world.createAndAttach(id, Transform, {});
    world.createAndAttach(id, Velocity, { x: 6 });
    kernel.start();
    const first = kernel.frame({ realDeltaSeconds: 1 / 120, present: false });
    expect(first.ticksAdvanced).toBe(0);
    const second = kernel.frame({ realDeltaSeconds: 1 / 120, present: false });
    expect(second.ticksAdvanced).toBe(1);
    expect(world.require(id, Transform).x).toBeCloseTo(0.1, 4);
  });

  it('caps catch-up work and records skipped time', () => {
    const { kernel } = createKernel();
    kernel.start();
    const result = kernel.frame({ realDeltaSeconds: 10, present: false });
    expect(result.ticksAdvanced).toBeLessThanOrEqual(8);
    expect(kernel.stats.skippedTicks).toBeGreaterThan(0);
    expect(kernel.stats.droppedSeconds).toBeGreaterThanOrEqual(0);
  });

  it('pauses and resumes without advancing simulation', () => {
    const { kernel } = createKernel();
    kernel.start();
    kernel.pause();
    const paused = kernel.frame({ realDeltaSeconds: 1, present: false });
    expect(paused.ticksAdvanced).toBe(0);
    kernel.resume();
    const resumed = kernel.frame({ realDeltaSeconds: 1 / 60, present: false });
    expect(resumed.ticksAdvanced).toBeGreaterThan(0);
  });

  it('detects tick re-entry', () => {
    const { kernel } = createKernel();
    let nested: unknown = null;
    kernel.registerSystem({ name: 'test.reentry', priority: 1, update() { try { kernel.frame({ realDeltaSeconds: 0, present: false }); } catch (error) { nested = error; } } });
    kernel.start();
    kernel.step(1);
    expect(nested).toBeNull();
  });

  it('produces a stable checksum for the same world state', () => {
    const { world, kernel } = createKernel();
    const id = world.spawn();
    world.createAndAttach(id, Transform, { x: 1, y: 2, z: 3 });
    const first = kernel.checksum();
    const second = kernel.checksum();
    expect(first).toBe(second);
  });
});

describe('Performance governance v3', () => {
  it('downgrades after sustained budget violations', () => {
    const governor = new PerformanceGovernorV3('balanced');
    let decision = governor.sample({ frameMs: 40, simulationMs: 20, renderMs: 20, streamingMs: 8, memoryMb: 1200, gpuPressure: 1, visibleEntities: 2000, loadedChunks: 100 });
    decision = governor.sample({ frameMs: 40, simulationMs: 20, renderMs: 20, streamingMs: 8, memoryMb: 1200, gpuPressure: 1, visibleEntities: 2000, loadedChunks: 100 });
    decision = governor.sample({ frameMs: 40, simulationMs: 20, renderMs: 20, streamingMs: 8, memoryMb: 1200, gpuPressure: 1, visibleEntities: 2000, loadedChunks: 100 });
    expect(decision.direction).toBe('down');
    expect(governor.tier).toBe('performance');
  });

  it('requires hysteresis before upgrading', () => {
    const governor = new PerformanceGovernorV3('performance');
    for (let index = 0; index < 11; index += 1) governor.sample({ frameMs: 5, simulationMs: 1, renderMs: 2, streamingMs: 0.5, memoryMb: 100, gpuPressure: 0.2, visibleEntities: 10, loadedChunks: 1 });
    expect(governor.tier).toBe('performance');
    governor.sample({ frameMs: 5, simulationMs: 1, renderMs: 2, streamingMs: 0.5, memoryMb: 100, gpuPressure: 0.2, visibleEntities: 10, loadedChunks: 1 });
    expect(governor.tier).toBe('balanced');
  });

  it('plans mandatory and optional tasks deterministically', () => {
    const planner = new FrameBudgetPlannerV3();
    const plan = planner.plan([
      { name: 'fx', costMs: 8, priority: 1 },
      { name: 'player', costMs: 3, priority: 5, mandatory: true },
      { name: 'ai', costMs: 4, priority: 4 },
    ], 10);
    expect(plan.admitted).toContain('player');
    expect(plan.deferred).toContain('fx');
  });
});

describe('World queries v3', () => {
  const makeQuery = () => new WorldQueryV3({ heightSampler: (x, z) => x + z, waterDepthSampler: (x, z) => Math.max(0, 2 - x - z) });

  it('samples deterministic terrain and caches repeated probes', () => {
    const query = makeQuery();
    expect(query.sampleHeight({ x: 4, z: 1 })).toMatchObject({ groundY: 5, underwater: false });
    expect(query.sampleHeight({ x: 4, z: 1 })).toMatchObject({ groundY: 5 });
    expect(query.metrics().cachedHeightQueries).toBe(1);
  });

  it('returns nearest tagged entities', () => {
    const query = makeQuery();
    query.registerEntity({ id: 2, position: { x: 10, y: 0, z: 0 }, radius: 1, tags: ['enemy'] });
    query.registerEntity({ id: 1, position: { x: 3, y: 0, z: 0 }, radius: 1, tags: ['enemy', 'elite'] });
    expect(query.nearest({ x: 0, y: 0, z: 0 }, 20, ['enemy'])?.id).toBe(1);
    expect(query.nearest({ x: 0, y: 0, z: 0 }, 20, ['elite'])?.id).toBe(1);
  });

  it('detects line-of-sight blockers with a ray/AABB test', () => {
    const query = makeQuery();
    query.registerObstacle({ id: 'wall', bounds: { min: { x: 4, y: -2, z: -2 }, max: { x: 6, y: 2, z: 2 } }, blocksSight: true, blocksMovement: true });
    const hit = query.lineOfSight({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 });
    expect(hit.hit).toBe(true);
    expect(hit.obstacleId).toBe('wall');
    expect(query.lineOfSight({ x: 0, y: 0, z: 10 }, { x: 10, y: 0, z: 10 }).hit).toBe(false);
  });

  it('reports movement obstruction against indexed obstacles', () => {
    const query = makeQuery();
    query.registerObstacle({ id: 'rock', bounds: { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } }, blocksSight: false, blocksMovement: true });
    expect(query.isMovementBlocked({ x: 0, y: 0, z: 0 }, 0.25)).toBe(true);
    expect(query.isMovementBlocked({ x: 3, y: 0, z: 0 }, 0.25)).toBe(false);
  });
});

describe('Observability v3', () => {
  it('calculates rolling percentiles and health', () => {
    const metrics = createRuntimeObservabilityV3();
    for (let tick = 1; tick <= 20; tick += 1) metrics.recordFrame(tick, { frameMs: tick, simulationMs: tick / 2, memoryMb: 100 + tick, visibleEntities: 20, loadedChunks: 2 });
    expect(metrics.frameMs.p95()).toBeGreaterThan(18);
    expect(metrics.health().score).toBeGreaterThan(50);
  });

  it('tracks errors and dropped ticks', () => {
    const metrics = createRuntimeObservabilityV3();
    metrics.recordTick(1, true);
    metrics.recordTick(2, false);
    metrics.recordError();
    expect(metrics.metrics()).toMatchObject({ ticks: 2, droppedTicks: 1, errors: 1 });
  });

  it('keeps bounded span storage', () => {
    const metrics = createRuntimeObservabilityV3();
    for (let index = 0; index < 600; index += 1) metrics.addSpan({ name: `span-${index}`, startTick: index, durationMs: 1, category: 'test', metadata: { index } });
    expect(metrics.spans()).toHaveLength(512);
  });
});
