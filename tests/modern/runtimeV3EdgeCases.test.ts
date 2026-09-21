import { describe, expect, it } from 'vitest';
import { createDefaultEcsWorldV3, Transform } from '../../src/3d/modern/ecsRuntimeV3.ts';
import { EngineKernelV3 } from '../../src/3d/modern/engineKernelV3.ts';
import { WorldQueryV3 } from '../../src/3d/modern/worldQueryV3.ts';

describe('v3 edge contracts', () => {
  it('rejects invalid component mutations', () => {
    const world = createDefaultEcsWorldV3();
    const entity = world.spawn();
    world.createAndAttach(entity, Transform, {});
    expect(() => world.mutate(entity, Transform, (value) => { value.scale = 0; })).toThrow(/Invalid transform/);
  });

  it('does not advance when a kernel is paused', () => {
    const kernel = new EngineKernelV3();
    kernel.start();
    kernel.pause();
    expect(kernel.step(3).ticksAdvanced).toBe(0);
    expect(kernel.clock.tick).toBe(0);
  });

  it('clamps movement to a sphere around a finite query radius', () => {
    const query = new WorldQueryV3({ heightSampler: () => 0 });
    query.registerEntity({ id: 1, position: { x: 0, y: 0, z: 0 }, radius: 1, tags: ['a'] });
    expect(query.queryRadius({ center: { x: 0, y: 0, z: 0 }, radius: 0 }, ['a'])).toHaveLength(1);
    expect(query.queryRadius({ center: { x: 5, y: 0, z: 0 }, radius: 0 }, ['a'])).toHaveLength(0);
  });

  it('returns empty results after clearing world query state', () => {
    const query = new WorldQueryV3({ heightSampler: () => 0 });
    query.registerEntity({ id: 1, position: { x: 0, y: 0, z: 0 }, radius: 1, tags: [] });
    query.clear();
    expect(query.queryRadius({ center: { x: 0, y: 0, z: 0 }, radius: 10 })).toEqual([]);
  });
});
