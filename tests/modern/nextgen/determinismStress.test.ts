import { describe, expect, it } from 'vitest';
import {
  EntityComponentWorld,
  TransformComponent,
  createTransformEntity,
  entityId,
  hashString,
  stableChecksum,
  stableStringify,
  vec3,
} from '../../../src/3d/modern/nextgen/index.ts';

describe('modern nextgen deterministic stress boundaries', () => {
  function buildPopulation(seed: number) {
    const world = new EntityComponentWorld();
    for (let index = 0; index < 512; index += 1) {
      const x = ((index * 17 + seed * 3) % 101) - 50;
      const y = ((index * 7 + seed) % 11) - 5;
      const z = ((index * 29 + seed * 5) % 97) - 48;
      createTransformEntity(world, `actor-${seed}-${index}`, { position: vec3(x, y, z) });
    }
    return world;
  }

  it('replays a large population to the same canonical checksum', () => {
    const checksum = (seed: number) => stableChecksum(buildPopulation(seed).snapshot());
    const first = checksum(42);
    const second = checksum(42);
    const third = checksum(43);
    expect(first).toBe(second);
    expect(first).not.toBe(third);
  });

  it('keeps snapshot entity ordering deterministic', () => {
    const world = buildPopulation(7);
    const snapshot = world.snapshot();
    const ids = snapshot.map(item => item.id as number);
    const sorted = [...ids].sort((a, b) => a - b);
    expect(ids).toEqual(sorted);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe(entityId(1));
  });

  it('keeps spatial queries bounded at population scale', () => {
    const world = buildPopulation(11);
    const result = world.query({
      required: [TransformComponent],
      excluded: [],
      shape: { center: vec3(), radius: 15 },
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThanOrEqual(512);
    expect(result.every(id => Number.isInteger(id))).toBe(true);
  });

  it('does not alias repeated transform updates', () => {
    const world = new EntityComponentWorld();
    const a = createTransformEntity(world, 'a');
    const b = createTransformEntity(world, 'b');
    world.upsertTransform(a, vec3(1, 2, 3));
    world.upsertTransform(b, vec3(4, 5, 6));
    const one = world.require(a, TransformComponent);
    const two = world.require(b, TransformComponent);
    one.position.x = 99;
    expect(two.position.x).toBe(4);
  });

  it('canonicalizes deeply nested records while preserving semantic arrays', () => {
    const left = {
      meta: { z: 1, a: 2 },
      actors: [
        { id: 2, stats: { stamina: 10, health: 20 } },
        { id: 1, stats: { health: 30, stamina: 40 } },
      ],
    };
    const right = {
      actors: [
        { stats: { stamina: 10, health: 20 }, id: 2 },
        { stats: { stamina: 40, health: 30 }, id: 1 },
      ],
      meta: { a: 2, z: 1 },
    };
    expect(stableStringify(left)).toBe(stableStringify(right));
    expect(stableChecksum(left)).toBe(stableChecksum(right));
  });

  it('changes checksums when a simulation-relevant scalar changes', () => {
    const before = { tick: 120, position: { x: 1, y: 2, z: 3 }, stamina: 0.75 };
    const after = { tick: 120, position: { x: 1, y: 2, z: 3 }, stamina: 0.74 };
    expect(stableChecksum(before)).not.toBe(stableChecksum(after));
  });

  it('keeps hash results stable for a mixed unicode corpus', () => {
    const corpus = ['alpha', 'Ötzi', 'Trabzon', '龙', '🜂', 'runtime.v2', 'entity:1024'];
    const expected = corpus.map(hashString);
    for (let pass = 0; pass < 32; pass += 1) expect(corpus.map(hashString)).toEqual(expected);
  });

  it('survives repeated world destruction and respawn cycles', () => {
    const world = new EntityComponentWorld();
    const ids: number[] = [];
    for (let cycle = 0; cycle < 100; cycle += 1) {
      const id = createTransformEntity(world, `cycle-${cycle}`);
      ids.push(id);
      expect(world.destroy(id)).toBe(true);
    }
    expect(world.entityCount).toBe(0);
    const replacement = world.spawn();
    expect(replacement).toBeGreaterThan(0);
    expect(world.snapshot()).toHaveLength(1);
    expect(ids.length).toBe(100);
  });

  it('rejects invalid geometry rather than producing non-finite results', () => {
    const world = new EntityComponentWorld();
    const entity = createTransformEntity(world, 'finite');
    world.upsertTransform(entity, vec3(Number.POSITIVE_INFINITY, 0, 0));
    const result = world.query({
      required: [TransformComponent],
      excluded: [],
      shape: { center: vec3(), radius: 10 },
    });
    expect(result).toEqual([]);
  });

  it('generates stable world checksums across independent instances', () => {
    const build = () => {
      const world = new EntityComponentWorld();
      for (let index = 0; index < 128; index += 1) {
        createTransformEntity(world, `actor-${index}`, {
          position: vec3(index * 0.25, (index % 9) * 0.5, index % 13),
        });
      }
      return stableChecksum(world.snapshot());
    };
    expect(build()).toBe(build());
    expect(build()).toBe(build());
  });

  it('keeps component revisions monotonic under stress', () => {
    const world = new EntityComponentWorld();
    let previous = world.revision;
    for (let index = 0; index < 200; index += 1) {
      const entity = world.spawn();
      expect(world.revision).toBeGreaterThan(previous);
      previous = world.revision;
      world.add(entity, TransformComponent, {
        position: vec3(index, 0, 0),
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
      });
      expect(world.revision).toBeGreaterThan(previous);
      previous = world.revision;
      world.destroy(entity);
      expect(world.revision).toBeGreaterThan(previous);
      previous = world.revision;
    }
  });
});
