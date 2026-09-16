import { describe, expect, it } from 'vitest';
import { WorldAuthorityV3, createWorldViewer } from '../../src/3d/nextgen/worldAuthorityV3';

describe('world authority', () => {
  it('spawns within the configured per-tick budget', () => {
    const world = new WorldAuthorityV3(10, { maxSpawnsPerTick: 3 });
    for (let i = 0; i < 10; i += 1) world.queueSpawn({ kind: 'npc', position: { x: i, y: 0, z: 0 }, seedSalt: i });
    const first = world.step();
    const second = world.step();
    expect(first.spawned).toHaveLength(3);
    expect(second.spawned).toHaveLength(3);
    expect(world.size).toBe(6);
  });

  it('classifies entities by viewer distance', () => {
    const world = new WorldAuthorityV3();
    expect(world.queueSpawn({ kind: 'prop', position: { x: 10, y: 0, z: 0 }, seedSalt: 1 })).toBe(true);
    world.step([createWorldViewer(1, { x: 0, y: 0, z: 0 }, 'standard')]);
    const entity = world.entities()[0]!;
    expect(entity.lod).toBe(0);
  });

  it('keeps players active when active capacity is exceeded', () => {
    const world = new WorldAuthorityV3(2, { maxActiveEntities: 1, maxSpawnsPerTick: 10 });
    world.queueSpawn({ kind: 'player', position: { x: 0, y: 0, z: 0 }, seedSalt: 1 });
    world.queueSpawn({ kind: 'npc', position: { x: 5, y: 0, z: 0 }, seedSalt: 2 });
    world.step([createWorldViewer(1, { x: 0, y: 0, z: 0 })]);
    expect(world.entities().find((entity) => entity.kind === 'player')?.lifecycle).toBe('active');
  });

  it('despawns stale out-of-interest non-player entities', () => {
    const world = new WorldAuthorityV3(3, { maxSpawnsPerTick: 1, despawnGraceTicks: 2 });
    world.queueSpawn({ kind: 'npc', position: { x: 0, y: 0, z: 0 }, seedSalt: 1 });
    world.step([createWorldViewer(1, { x: 1000, y: 0, z: 1000 })]);
    world.step([createWorldViewer(1, { x: 1000, y: 0, z: 1000 })]);
    world.step([createWorldViewer(1, { x: 1000, y: 0, z: 1000 })]);
    expect(world.size).toBe(0);
  });
});
