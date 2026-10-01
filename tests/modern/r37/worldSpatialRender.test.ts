import { describe, expect, it } from 'vitest';
import { SpatialIndexR37 } from '../../../src/3d/strict/r37/spatialIndex.ts';
import { RenderFrameBuilderR37 } from '../../../src/3d/strict/r37/renderFrame.ts';
import { EntityRegistryR37 } from '../../../src/3d/strict/r37/entityRegistry.ts';

describe('R37 world/spatial/render surfaces', () => {
  it('returns deterministic nearest ids', () => {
    const registry = new EntityRegistryR37();
    registry.create({ id: 'z', kind: 'npc', position: { x: 20, y: 0, z: 0 } });
    registry.create({ id: 'a', kind: 'npc', position: { x: 5, y: 0, z: 0 } });
    const index = new SpatialIndexR37();
    for (const entity of registry.values()) index.upsert(entity.id, entity.transform.position);
    expect(index.nearest({ x: 0, y: 0, z: 0 }, 50, 2)).toEqual(['a', 'z']);
    const frame = new RenderFrameBuilderR37().build(registry.values(), {
      frameId: 1,
      tick: 2,
      alpha: 0.25,
      cameraPosition: { x: 0, y: 0, z: 0 },
      qualityScale: 1,
    });
    expect(frame.items.map((item) => item.entityId)).toEqual(['a', 'z']);
    expect(frame.items[0]?.lod).toBe(0);
  });
});
