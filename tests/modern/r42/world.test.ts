import { describe, expect, it } from 'vitest';
import { EntityWorldR42 } from '../../../src/3d/strict/r42/world.ts';

describe('R42 world', () => {
  it('spawns, indexes and patches entities deterministically', () => {
    const world = new EntityWorldR42(8, 10);
    const player = world.spawn({ id: 'player', kind: 'player', position: { x: 1, y: 2, z: 3 } });
    expect(player.id).toBe('player');
    expect(world.queryRadius({ x: 0, y: 0, z: 0 }, 20).map(entity => entity.id)).toEqual(['player']);
    const patched = world.patch({
      entityId: 'player',
      revision: player.revision,
      changes: { position: { x: 9, y: 2, z: 3 }, health: 80 },
    });
    expect(patched?.transform.position.x).toBe(9);
    expect(patched?.combat.health).toBe(80);
  });

  it('rejects duplicate entities and capacity overflow', () => {
    const world = new EntityWorldR42(1);
    world.spawn({ id: 'a', kind: 'prop' });
    expect(() => world.spawn({ id: 'a', kind: 'prop' })).toThrow();
    expect(() => world.spawn({ id: 'b', kind: 'prop' })).toThrow();
  });

  it('keeps digest stable for equivalent insertion order', () => {
    const a = new EntityWorldR42(8);
    const b = new EntityWorldR42(8);
    a.spawn({ id: 'b', kind: 'prop', position: { x: 4, y: 0, z: 0 } });
    a.spawn({ id: 'a', kind: 'prop', position: { x: 1, y: 0, z: 0 } });
    b.spawn({ id: 'a', kind: 'prop', position: { x: 1, y: 0, z: 0 } });
    b.spawn({ id: 'b', kind: 'prop', position: { x: 4, y: 0, z: 0 } });
    expect(a.digest()).toBe(b.digest());
  });
});
