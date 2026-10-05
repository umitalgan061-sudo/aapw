import { describe, expect, it } from 'vitest';
import { SaveSystemR42, MemorySaveStoreR42 } from '../../../src/3d/strict/r42/persistence.ts';
import { RuntimeSecurityR42 } from '../../../src/3d/strict/r42/security.ts';
import { EntityWorldR42 } from '../../../src/3d/strict/r42/world.ts';

describe('R42 persistence and security', () => {
  it('round-trips a typed save envelope', async () => {
    const world = new EntityWorldR42();
    world.spawn({ id: 'player', kind: 'player' });
    const saves = new SaveSystemR42(new MemorySaveStoreR42());
    const envelope = saves.encode('slot-1', 10, 2, world.values(), { profile: 'demo' });
    const parsed = saves.parse(saves.serialize(envelope));
    expect(parsed.slot).toBe('slot-1');
    expect(parsed.world[0]?.id).toBe('player');
    expect(parsed.checksum).toBe(envelope.checksum);
  });

  it('rejects tampered save checksums', () => {
    const saves = new SaveSystemR42();
    const world = new EntityWorldR42();
    world.spawn({ id: 'player', kind: 'player' });
    const envelope = saves.encode('slot', 1, 1, world.values());
    const tampered = JSON.stringify({ ...envelope, revision: 999 });
    expect(() => saves.parse(tampered)).toThrow(/checksum/);
  });

  it('blocks hostile payload shapes and enforces rate limits', () => {
    const security = new RuntimeSecurityR42({ maxPacketBytes: 128 });
    expect(security.validatePayload({ data: '<script>' }).ok).toBe(true);
    expect(security.sanitizeString('<abc>')).toBe('abc');
    for (let index = 0; index < 8; index += 1) security.rateLimiter.allow('player', 1);
    expect(security.rateLimiter.allow('player', 1)).toBe(false);
  });
});
