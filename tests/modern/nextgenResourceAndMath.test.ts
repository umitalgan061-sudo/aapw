import { describe, expect, it } from 'vitest';
import { BudgetedResourceCache } from '../../src/3d/modern/nextgen/resourceCache.ts';
import { atomic, RuntimeTransaction, withRollback } from '../../src/3d/modern/nextgen/transaction.ts';
import { moveTowards, reflect, slerpQuat, sphereIntersectsAabb } from '../../src/3d/modern/nextgen/math3d.ts';
import { DeterministicGridPathfinder } from '../../src/3d/modern/nextgen/pathfinding.ts';
import { vec3 } from '../../src/3d/modern/nextgen/types.ts';

describe('nextgen resources, math and pathfinding', () => {
  it('caches ready resources and respects byte budgets', async () => {
    let loads = 0;
    const cache = new BudgetedResourceCache<string>({ load: async (descriptor) => { loads += 1; return descriptor.key; } }, { maxBytes: 20, maxEntries: 3 });
    const value = await cache.acquire({ key: 'a', bytes: 8, cost: 1, tags: [], priority: 5, evictable: true });
    expect(value).toBe('a');
    expect(await cache.acquire({ key: 'a', bytes: 8, cost: 1, tags: [], priority: 5, evictable: true })).toBe('a');
    expect(loads).toBe(1);
    expect(cache.has('a')).toBe(true);
    expect(cache.metrics().bytes).toBe(8);
  });

  it('rolls back an atomic transaction after failure', () => {
    const target = atomic(10);
    const tx = new RuntimeTransaction<number>();
    tx.add(withRollback(target, 20, 'set twenty'));
    tx.add({ label: 'fail', apply: () => { target.set(30); throw new Error('boom'); }, rollback: () => target.set(10) });
    const result = tx.run();
    expect(result.committed).toBe(false);
    expect(target.get()).toBe(10);
    expect(result.failedAt).toBe('fail');
  });

  it('keeps math operations finite and bounded', () => {
    expect(moveTowards(vec3(0, 0, 0), vec3(10, 0, 0), 2)).toEqual(vec3(2, 0, 0));
    expect(reflect(vec3(1, -1, 0), vec3(0, 1, 0))).toEqual(vec3(1, 1, 0));
    const q = slerpQuat({ x: 0, y: 0, z: 0, w: 1 }, { x: 0, y: 1, z: 0, w: 0 }, 0.5);
    expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 5);
    expect(sphereIntersectsAabb(vec3(0, 0, 0), 1, { min: vec3(-0.5, -0.5, -0.5), max: vec3(0.5, 0.5, 0.5) })).toBe(true);
  });

  it('finds a deterministic path and nearest walkable cell', () => {
    const pathfinder = new DeterministicGridPathfinder({ width: 16, height: 16, cellSize: 2, maxNodes: 2000 }, (x, z) => !(Math.abs(x) < 1 && Math.abs(z) < 3));
    const path = pathfinder.findPath(vec3(-10, 0, -10), vec3(10, 0, 10));
    expect(path.length).toBeGreaterThan(0);
    expect(path[0].x).toBeCloseTo(-9);
    expect(path.at(-1)?.x).toBeCloseTo(9);
    expect(pathfinder.nearestWalkable(vec3(0, 0, 0))).not.toBeNull();
  });
});
