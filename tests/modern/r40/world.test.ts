import { describe, expect, it } from 'vitest';
import { SpatialEntityWorld, WorldSimulationBudget, StimulusMemory, boundsAt, makeEntity, entityId, revision, tick } from '../../../src/3d/modern/r40';

const velocity = { linear: { x: 0, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } };
const entity = (id: string, x: number, z: number) => makeEntity(entityId(id), { x, y: 0, z }, velocity);

describe('R40 world and interest systems', () => {
  it('inserts and retrieves entities', () => {
    const world = new SpatialEntityWorld({ maxEntities: 4 });
    const player = entity('player', 0, 0);
    expect(world.upsert(player)).toBe(true);
    expect(world.get(entityId('player'))?.id).toBe(player.id);
  });
  it('rejects older revisions', () => {
    const world = new SpatialEntityWorld();
    const original = entity('e', 0, 0);
    expect(world.upsert({ ...original, revision: revision(2) })).toBe(true);
    expect(world.upsert({ ...original, revision: revision(1), transform: { ...original.transform, position: { x: 99, y: 0, z: 0 } } })).toBe(false);
    expect(world.get(entityId('e'))?.transform.position.x).toBe(0);
  });
  it('enforces entity capacity', () => {
    const world = new SpatialEntityWorld({ maxEntities: 2 });
    expect(world.upsert(entity('a', 0, 0))).toBe(true);
    expect(world.upsert(entity('b', 1, 0))).toBe(true);
    expect(world.upsert(entity('c', 2, 0))).toBe(false);
  });
  it('queries nearby cells without requiring global scan semantics', () => {
    const world = new SpatialEntityWorld({ cellSize: 10 });
    world.upsert(entity('near', 5, 5));
    world.upsert(entity('far', 100, 100));
    expect(world.queryRadius({ x: 0, y: 0, z: 0 }, 15).map((e) => String(e.id))).toEqual(['near']);
  });
  it('orders equal-distance results by stable entity id', () => {
    const world = new SpatialEntityWorld({ cellSize: 10 });
    world.upsert(entity('b', 5, 0));
    world.upsert(entity('a', -5, 0));
    expect(world.queryRadius({ x: 0, y: 0, z: 0 }, 6).map((e) => String(e.id))).toEqual(['a', 'b']);
  });
  it('changes lod based on interest radius', () => {
    const world = new SpatialEntityWorld();
    const item = entity('item', 250, 0);
    world.upsert(item);
    expect(world.updateInterest({ id: 'player', position: { x: 0, y: 0, z: 0 }, radius: 500, weight: 1 })).toBe(1);
    expect(world.get(entityId('item'))?.lod).toBe('far');
  });
  it('generates deltas only after a revision threshold', () => {
    const world = new SpatialEntityWorld();
    const item = entity('item', 1, 1);
    world.upsert({ ...item, revision: revision(3) });
    expect(world.deltaSince(revision(2), tick(4))).toHaveLength(1);
    expect(world.deltaSince(revision(3), tick(4))).toHaveLength(0);
  });
  it('snapshot digest is deterministic', () => {
    const left = new SpatialEntityWorld();
    const right = new SpatialEntityWorld();
    left.upsert(entity('a', 1, 2));
    right.upsert(entity('a', 1, 2));
    expect(left.snapshot(tick(10)).digest).toBe(right.snapshot(tick(10)).digest);
  });
  it('clears world state completely', () => {
    const world = new SpatialEntityWorld();
    world.upsert(entity('a', 1, 2));
    world.clear();
    expect(world.values()).toHaveLength(0);
    expect(world.activeCount()).toBe(0);
  });
  it('selects entities within lod simulation budgets', () => {
    const budget = new WorldSimulationBudget({ near: 1, mid: 1, far: 1, sleeping: 1 });
    const world = new SpatialEntityWorld();
    world.upsert(entity('a', 1, 0));
    world.upsert(entity('b', 2, 0));
    world.upsert(entity('c', 100, 0));
    const selected = budget.select(world.values(), { x: 0, y: 0, z: 0 });
    expect(selected.length).toBeLessThanOrEqual(3);
  });
  it('removes entities and updates active count', () => {
    const world = new SpatialEntityWorld();
    world.upsert(entity('a', 1, 0));
    expect(world.remove(entityId('a'))).toBe(true);
    expect(world.activeCount()).toBe(0);
  });
  it('removal of unknown entity is idempotently false', () => {
    const world = new SpatialEntityWorld();
    expect(world.remove(entityId('missing'))).toBe(false);
  });
  it('keeps bounds finite', () => {
    expect(boundsAt({ x: 10, y: 20, z: 30 }, 2)).toEqual({
      min: { x: 8, y: 18, z: 28 },
      max: { x: 12, y: 22, z: 32 },
      radius: 2,
    });
  });
  it('stores and queries stimulus memory', () => {
    const memory = new StimulusMemory(4, 100);
    memory.observe({ id: 's1', source: 'npc', type: 'visual', position: { x: 0, y: 0, z: 0 }, intensity: 1, confidence: 1, expiresAtTick: tick(100) }, tick(10));
    expect(memory.query('visual')).toHaveLength(1);
    expect(memory.confidence('s1')).toBeGreaterThan(0);
  });
  it('forgets stimuli explicitly', () => {
    const memory = new StimulusMemory();
    memory.observe({ id: 's1', source: 'npc', type: 'audio', position: { x: 0, y: 0, z: 0 }, intensity: 1, confidence: 1, expiresAtTick: tick(100) }, tick(1));
    memory.forget('s1');
    expect(memory.query()).toHaveLength(0);
  });
  it('caps memory entries', () => {
    const memory = new StimulusMemory(2);
    for (const id of ['a', 'b', 'c']) memory.observe({ id, source: id, type: 'visual', position: { x: 0, y: 0, z: 0 }, intensity: 1, confidence: 1, expiresAtTick: tick(10) }, tick(Number(id === 'a') + 1));
    expect(memory.query()).toHaveLength(2);
  });
});
