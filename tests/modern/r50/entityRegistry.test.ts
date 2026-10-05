import { describe, expect, it } from 'vitest';
import {
  EntityRegistry,
} from '../../../src/3d/modern/r50/entityRegistry.ts';

describe('R50 entity registry', () => {
  it('creates and queries entities by kind and tags', () => {
    const registry=new EntityRegistry({
      maxEntities:100,
      maxTagsPerEntity:4,
    });

    const player=registry.create(
      'player',
      {x:0,y:0,z:0},
      {health:100},
      ['hero','human'],
    );

    registry.create(
      'npc',
      {x:5,y:0,z:0},
      {health:50},
      ['merchant'],
    );

    expect(registry.get(player)?.kind).toBe('player');
    expect(registry.query({
      kind:'npc',
      tags:['merchant'],
    })).toHaveLength(1);
  });

  it('supports radius queries', () => {
    const registry=new EntityRegistry({
      maxEntities:100,
      maxTagsPerEntity:4,
    });

    registry.create(
      'creature',
      {x:2,y:0,z:1},
      {},
      [],
    );

    registry.create(
      'creature',
      {x:100,y:0,z:100},
      {},
      [],
    );

    const nearby=registry.query({
      within:{
        center:{x:0,y:0,z:0},
        radius:10,
      },
    });

    expect(nearby).toHaveLength(1);
  });

  it('keeps snapshot and restore deterministic', () => {
    const registry=new EntityRegistry({
      maxEntities:100,
      maxTagsPerEntity:4,
    });

    registry.create(
      'vehicle',
      {x:1,y:2,z:3},
      {speed:4},
      ['cart'],
    );

    const snapshot=registry.snapshot();
    const digest=registry.digest();

    registry.clear();
    expect(registry.stats().total).toBe(0);

    registry.restore(snapshot);

    expect(registry.digest()).toBe(digest);
  });
});
