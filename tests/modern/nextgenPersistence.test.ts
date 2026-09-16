import { describe, expect, it } from 'vitest';
import { decodeSave, encodeSave, emptyWorldSnapshot, saveDigest } from '../../src/3d/modern/nextgen/saveCodec.ts';
import { stableChecksum, tickValue, revisionValue } from '../../src/3d/modern/nextgen/types.ts';

describe('nextgen persistence', () => {
  it('round-trips a save with a deterministic checksum', () => {
    const world = { ...emptyWorldSnapshot(), tick: tickValue(20), revision: revisionValue(4), entities: [] };
    const encoded = encodeSave(world, { profile: 'default', platform: 'web', build: 'test' });
    const decoded = decodeSave(encoded.text);
    expect(decoded.world.tick).toBe(20);
    expect(decoded.header.checksum).toBe(stableChecksum(decoded.world));
    expect(saveDigest(decoded)).toBeTypeOf('number');
  });

  it('rejects tampered saves', () => {
    const world = emptyWorldSnapshot();
    const encoded = encodeSave(world, { profile: 'default', platform: 'web', build: 'test' });
    const tampered = encoded.text.replace('default', 'hacked');
    expect(() => decodeSave(tampered)).toThrow(/checksum|JSON/);
  });

  it('rejects unsupported formats', () => {
    const text = JSON.stringify({ header: { magic: 'bad', version: 99 }, world: { entities: [] } });
    expect(() => decodeSave(text)).toThrow(/Unsupported save format|Save header/);
  });
});
