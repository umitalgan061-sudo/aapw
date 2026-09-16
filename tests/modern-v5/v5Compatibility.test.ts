import { describe, expect, it } from 'vitest';
import { asEntityId } from '../../src/3d/modern/v5/domain.ts';
import { EcsWorldV5 } from '../../src/3d/modern/v5/ecs.ts';
import { LegacyWorldAdapterV5, exportLegacyEntity, importLegacyEntity, networkToRuntimeSnapshot } from '../../src/3d/modern/v5/compatibility.ts';

describe('modern-v5 compatibility boundary', () => {
  it('imports legacy entity data into typed components', () => {
    const result = importLegacyEntity({ id: 9, position: { x: 4, y: 2, z: -3 }, health: 25, maxHealth: 100, name: 'hero', visible: true });
    expect(result.entity?.id).toBe(9);
    expect(result.entity?.components.get('transform')).toMatchObject({ kind: 'transform', position: { x: 4, y: 2, z: -3 } });
    expect(result.entity?.components.get('health')).toMatchObject({ current: 25, maximum: 100 });
  });

  it('exports typed state into stable legacy shape', () => {
    const world = new EcsWorldV5();
    const id = world.spawnWithDefaults(['transform', 'health', 'metadata', 'render']);
    const entity = world.get(id)!;
    const legacy = exportLegacyEntity(entity);
    expect(legacy.id).toBe(Number(id));
    expect(legacy.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(legacy.visible).toBe(true);
  });

  it('protects entity id collisions during import', () => {
    const world = new EcsWorldV5();
    world.spawn({ id: asEntityId(2), components: [] });
    const adapter = new LegacyWorldAdapterV5(world);
    const result = adapter.import({ id: 2, name: 'collision' });
    expect(result.warnings.some((warning) => warning.code === 'collision')).toBe(true);
    expect(world.stats().entities).toBe(1);
  });

  it('converts authoritative network snapshots to runtime save shape', () => {
    const world = new EcsWorldV5();
    world.spawnWithDefaults(['transform']);
    const snapshot = { sequence: 2, tick: 7 as never, authoritative: true, entities: world.snapshot() };
    const runtime = networkToRuntimeSnapshot(snapshot);
    expect(runtime.version).toBe(5);
    expect(Number(runtime.tick)).toBe(7);
    expect(runtime.entities).toHaveLength(1);
  });
});
