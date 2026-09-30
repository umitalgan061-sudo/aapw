import { describe, expect, it } from 'vitest';
import {
  ActiveComponent,
  EntityComponentWorld,
  NameComponent,
  TransformComponent,
  activeQuery,
  applyEntityCommands,
  createTransformEntity,
  entityId,
  vec3,
} from '../../../src/3d/modern/nextgen/index.ts';

describe('modern nextgen ECS', () => {
  it('spawns deterministic ids and tracks revisions', () => {
    const world = new EntityComponentWorld();
    expect(world.entityCount).toBe(0);
    const first = world.spawn();
    const second = world.spawn();
    expect(first).toBe(entityId(1));
    expect(second).toBe(entityId(2));
    expect(world.entityCount).toBe(2);
    expect(world.revision).toBeGreaterThanOrEqual(2);
  });

  it('creates a complete transform entity without mutable template reuse', () => {
    const world = new EntityComponentWorld();
    const player = createTransformEntity(world, 'player', { position: vec3(10, 2, -4) });
    const npc = createTransformEntity(world, 'npc', { position: vec3(-5, 0, 7) });
    expect(world.require(player, NameComponent)).toEqual({ value: 'player' });
    expect(world.require(npc, NameComponent)).toEqual({ value: 'npc' });
    expect(world.require(player, ActiveComponent)).toEqual({ value: true });
    expect(world.require(npc, ActiveComponent)).toEqual({ value: true });
    expect(world.require(player, TransformComponent).position).toEqual({ x: 10, y: 2, z: -4 });
    expect(world.require(npc, TransformComponent).position).toEqual({ x: -5, y: 0, z: 7 });
  });

  it('queries by component mask and preserves entity creation order', () => {
    const world = new EntityComponentWorld();
    const first = createTransformEntity(world, 'first');
    const second = createTransformEntity(world, 'second');
    const third = createTransformEntity(world, 'third');
    world.remove(second, ActiveComponent);
    expect(world.query(activeQuery())).toEqual([first, third]);
  });

  it('filters transforms by spatial radius and predicate', () => {
    const world = new EntityComponentWorld();
    const near = createTransformEntity(world, 'near', { position: vec3(1, 0, 0) });
    const far = createTransformEntity(world, 'far', { position: vec3(20, 0, 0) });
    const result = world.query({
      required: [TransformComponent],
      excluded: [],
      shape: { center: vec3(), radius: 5, predicate: id => id === near },
    });
    expect(result).toEqual([near]);
    expect(result).not.toContain(far);
  });

  it('updates transforms without replacing unrelated components', () => {
    const world = new EntityComponentWorld();
    const entity = createTransformEntity(world, 'hero');
    const before = world.require(entity, NameComponent);
    world.upsertTransform(entity, vec3(4, 5, 6));
    expect(world.require(entity, NameComponent)).toEqual(before);
    expect(world.require(entity, TransformComponent).position).toEqual({ x: 4, y: 5, z: 6 });
  });

  it('applies add, set and remove commands atomically in order', () => {
    const world = new EntityComponentWorld();
    const entity = world.spawn();
    const custom = Symbol.for('aapw.test.custom') as typeof ActiveComponent;
    world.add(entity, ActiveComponent, { value: true });
    const applied = applyEntityCommands(world, [
      { entity, component: ActiveComponent, operation: 'set', value: { value: false } },
      { entity, component: custom, operation: 'add', value: { value: true } },
      { entity, component: ActiveComponent, operation: 'remove' },
    ]);
    expect(applied).toBe(3);
    expect(world.has(entity, ActiveComponent)).toBe(false);
    expect(world.get(entity, custom)).toEqual({ value: true });
  });

  it('recycles destroyed entity ids while advancing generation', () => {
    const world = new EntityComponentWorld();
    const entity = world.spawn();
    expect(world.destroy(entity)).toBe(true);
    expect(world.destroy(entity)).toBe(false);
    const replacement = world.spawn();
    expect(replacement).toBe(entity);
    expect(world.entityCount).toBe(1);
    expect(world.snapshot()).toHaveLength(1);
  });

  it('snapshots are detached from component storage', () => {
    const world = new EntityComponentWorld();
    const entity = createTransformEntity(world, 'snapshot', { position: vec3(1, 2, 3) });
    const snapshot = world.snapshot();
    const transform = snapshot[0]?.components.Transform as { position: { x: number; y: number; z: number } };
    transform.position.x = 999;
    expect(world.require(entity, TransformComponent).position.x).toBe(1);
  });

  it('clear removes entities but leaves the world reusable', () => {
    const world = new EntityComponentWorld();
    createTransformEntity(world, 'a');
    createTransformEntity(world, 'b');
    world.clear();
    expect(world.entityCount).toBe(0);
    const next = createTransformEntity(world, 'reused');
    expect(next).toBe(entityId(1));
    expect(world.query(activeQuery())).toEqual([next]);
  });

  it('spatial queries remain finite for large deterministic populations', () => {
    const world = new EntityComponentWorld();
    for (let index = 0; index < 256; index += 1) {
      createTransformEntity(world, `actor-${index}`, { position: vec3(index % 16, 0, Math.floor(index / 16)) });
    }
    const result = world.query({ required: [TransformComponent], excluded: [], shape: { center: vec3(7, 0, 7), radius: 4 } });
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThan(256);
    expect(result.every(id => Number.isInteger(id) && id > 0)).toBe(true);
  });
});
