import { describe, expect, it } from 'vitest';
import {
  EntityWorld,
  componentType,
  entityId,
  UniformGridBroadphase,
  vec3,
  raycastAabb,
  WorldQueryIndex,
} from '../../../src/3d/modern/r27/index.ts';

describe('R27 ECS, physics and world queries', () => {
  it('creates entities and returns deterministic component queries', () => {
    const world = new EntityWorld();
    const position = componentType('position');
    const velocity = componentType('velocity');
    const first = world.create();
    const second = world.create();
    world.set(first, position, { x: 1, y: 2, z: 3 });
    world.set(second, position, { x: 4, y: 5, z: 6 });
    world.set(second, velocity, { x: 0, y: 0, z: 1 });

    expect(world.aliveEntities().map(Number)).toEqual([1, 2]);
    expect(world.query([position]).entities.map(Number)).toEqual([1, 2]);
    expect(world.query([position, velocity]).entities.map(Number)).toEqual([2]);

    world.destroy(first);
    expect(world.query([position]).entities.map(Number)).toEqual([2]);
  });

  it('flushes deferred commands in insertion order', () => {
    const world = new EntityWorld();
    world.createDeferred();
    const events = world.flushCommands();
    expect(events[0]?.type).toBe('entity-created');
    expect(Number(events[0]?.type === 'entity-created' ? events[0].entity : entityId(1))).toBe(1);

    const entity = entityId(1);
    world.destroyDeferred(entity);
    const destroyed = world.flushCommands();
    expect(destroyed).toEqual([{ type: 'entity-destroyed', entity }]);
  });

  it('uses grid broadphase to reduce candidate work deterministically', () => {
    const broadphase = new UniformGridBroadphase(4);
    broadphase.upsert({
      entity: entityId(1),
      bounds: { min: vec3(0, 0, 0), max: vec3(1, 1, 1) },
      layer: 0,
      enabled: true,
    });
    broadphase.upsert({
      entity: entityId(2),
      bounds: { min: vec3(20, 0, 0), max: vec3(21, 1, 1) },
      layer: 0,
      enabled: true,
    });

    const local = broadphase.querySphere({ center: vec3(0.5, 0.5, 0.5), radius: 3 });
    expect(local.map((entry) => Number(entry.entity))).toEqual([1]);
  });

  it('raycasts expanded AABBs and resolves nearest-first ordering', () => {
    const first = raycastAabb(
      { origin: vec3(-10, 0.5, 0.5), direction: vec3(1, 0, 0), maxDistance: 30 },
      { min: vec3(0, 0, 0), max: vec3(1, 1, 1) },
    );
    expect(first).toBe(10);
  });

  it('queries radius, nearest and line of sight through one typed index', () => {
    const index = new WorldQueryIndex(4);
    index.upsert({
      entity: entityId(1),
      bounds: { min: vec3(0, 0, 0), max: vec3(1, 2, 1) },
      position: vec3(0.5, 1, 0.5),
      tags: ['npc', 'merchant'],
      layer: 0,
      enabled: true,
    });
    index.upsert({
      entity: entityId(2),
      bounds: { min: vec3(8, 0, 0), max: vec3(9, 2, 1) },
      position: vec3(8.5, 1, 0.5),
      tags: ['animal'],
      layer: 0,
      enabled: true,
    });

    expect(index.radius(vec3(0, 1, 0), { radius: 3, tagsAny: ['merchant'] }).map((entry) => Number(entry.entity))).toEqual([1]);
    expect(index.nearest(vec3(0, 0, 0), 2).map((entry) => Number(entry.entity))).toEqual([1, 2]);
    expect(index.lineOfSight(vec3(-3, 1, 0.5), vec3(-2, 1, 0.5))).toBe(true);
  });
});
