import { describe, expect, it } from 'vitest';
import { EntityWorld, MovementSystem, Transform, Velocity, defineComponent } from '../../../src/3d/modern/next/ecs.ts';
import { SpatialGrid, createSpatialItem } from '../../../src/3d/modern/next/spatial.ts';
import { AdaptiveRenderBudget, budgetForTier, resolveInitialTier } from '../../../src/3d/modern/next/render.ts';
import { RateLimiter, sanitizeText, validatePayload, validateSnapshotBounds } from '../../../src/3d/modern/next/security.ts';
import { clamp, damp, directionToYaw, normalize3, wrapAngle } from '../../../src/3d/modern/next/math.ts';

describe('next core systems', () => {
  it('creates and destroys ECS entities safely', () => {
    const world = new EntityWorld();
    const id = world.createEntity();
    expect(world.entities.isAlive(id)).toBe(true);
    expect(world.destroyEntity(id)).toBe(true);
    expect(world.entities.isAlive(id)).toBe(false);
    expect(world.destroyEntity(id)).toBe(false);
  });

  it('runs movement system against transform and velocity stores', () => {
    const world = new EntityWorld();
    world.registerComponent(Transform);
    world.registerComponent(Velocity);
    const id = world.createEntity();
    world.component<typeof Transform extends never ? never : any>(Transform.type).set(id, { position: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: 1 });
    world.component<any>(Velocity.type).set(id, { x: 3, y: 0, z: -2 });
    world.addSystem(new MovementSystem(world));
    world.update({ tick: 1 as never, dtSeconds: 0.5, simTime: 0.5 as never });
    expect(world.component<any>(Transform.type).get(id)?.position).toEqual({ x: 1.5, y: 0, z: -1 });
  });

  it('supports custom component schemas and queries', () => {
    const world = new EntityWorld();
    const Health = defineComponent('health-test', () => ({ value: 100 }));
    const Team = defineComponent('team-test', () => ({ id: 1 }));
    world.registerComponent(Health);
    world.registerComponent(Team);
    const alive = world.createEntity();
    const enemy = world.createEntity();
    world.component(Health.type).set(alive);
    world.component(Health.type).set(enemy);
    world.component(Team.type).set(alive, { id: 1 });
    world.component(Team.type).set(enemy, { id: 2 });
    expect(world.query({ all: [Health.type] })).toEqual([alive, enemy]);
    expect(world.query({ all: [Health.type], none: [Team.type] })).toEqual([]);
  });

  it('finds spatial neighbors deterministically', () => {
    const grid = new SpatialGrid(10);
    grid.insert(createSpatialItem(1, 0, 0, 1));
    grid.insert(createSpatialItem(2, 5, 0, 1));
    grid.insert(createSpatialItem(3, 50, 50, 1));
    expect(grid.queryCircle(0, 0, 8).map((item) => item.id)).toEqual([1, 2]);
    expect(grid.nearest(4, 0, 10, 1).map((item) => item.id)).toEqual([2]);
    expect(grid.remove(2 as never)).toBe(true);
    expect(grid.queryCircle(0, 0, 8).map((item) => item.id)).toEqual([1]);
  });

  it('returns raycast hits in front of the origin', () => {
    const grid = new SpatialGrid(4);
    grid.insert(createSpatialItem(1, 0, 4, 0.5));
    grid.insert(createSpatialItem(2, 0, -4, 0.5));
    const hit = grid.raycast2D(0, 0, 0, 1, 10, 0.2);
    expect(hit?.item.id).toBe(1);
  });

  it('adapts render quality downward after sustained pressure', () => {
    const budget = new AdaptiveRenderBudget('ultra');
    for (let i = 0; i < 2; i += 1) budget.observe({ simulationMs: 10, renderMs: 15, streamingMs: 4, networkMs: 2, totalMs: 31 });
    expect(['high', 'medium', 'low', 'safe']).toContain(budget.state.tier);
  });

  it('resolves device tier from capabilities', () => {
    expect(resolveInitialTier({ maxTextureSize: 16384, supportsInstancing: true, supportsWebGL2: true, deviceMemoryGb: 16, hardwareConcurrency: 12 })).toBe('ultra');
    expect(resolveInitialTier({ maxTextureSize: 1024, supportsInstancing: false, supportsWebGL2: false })).toBe('safe');
    expect(budgetForTier('safe').pixelRatio).toBe(1);
  });

  it('sanitizes text and rejects dangerous payload structures', () => {
    expect(sanitizeText(' hello\u0000 world ')).toBe('hello world');
    expect(validatePayload({ safe: [1, 2, 3] }).ok).toBe(true);
    const circular: any = {}; circular.self = circular;
    expect(validatePayload(circular).ok).toBe(false);
  });

  it('enforces per-actor rate limits', () => {
    const limiter = new RateLimiter(2, 1000);
    expect(limiter.allow('a', 0)).toBe(true);
    expect(limiter.allow('a', 1)).toBe(true);
    expect(limiter.allow('a', 2)).toBe(false);
    expect(limiter.allow('a', 1001)).toBe(true);
  });

  it('validates snapshot age and entity limits', () => {
    expect(validateSnapshotBounds({ tick: 98, entities: [] }, 100, { maxAgeTicks: 5, maxFutureTicks: 2, maxEntities: 10 }).ok).toBe(true);
    expect(validateSnapshotBounds({ tick: 90, entities: [] }, 100, { maxAgeTicks: 5, maxFutureTicks: 2, maxEntities: 10 }).ok).toBe(false);
    expect(validateSnapshotBounds({ tick: 103, entities: [] }, 100, { maxAgeTicks: 5, maxFutureTicks: 2, maxEntities: 10 }).ok).toBe(false);
  });

  it('keeps numeric helpers bounded and stable', () => {
    expect(clamp(4, 0, 1)).toBe(1);
    expect(damp(0, 1, 10, 0)).toBe(0);
    expect(normalize3({ x: 0, y: 0, z: 4 })).toEqual({ x: 0, y: 0, z: 1 });
    expect(directionToYaw({ x: 0, y: 0, z: 1 })).toBe(0);
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(Math.PI);
  });
});
