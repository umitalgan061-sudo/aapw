import { describe, expect, it } from 'vitest';
import { SnapshotHistory, applyDelta, diffSnapshots, validatePacket } from '../../src/3d/modern/nextgen/network.ts';
import { tickValue } from '../../src/3d/modern/nextgen/types.ts';

function snapshot(tick: number, value: number) {
  return {
    tick: tickValue(tick),
    revision: tickValue(tick),
    entities: [{ id: tick as never, mask: 1, components: { value } }],
    checksum: value,
  };
}

describe('nextgen network', () => {
  it('creates a stable delta between snapshots', () => {
    const first = snapshot(1, 10);
    const second = snapshot(2, 20);
    const delta = diffSnapshots(first, second);
    expect(delta.baseTick).toBe(first.tick);
    expect(delta.tick).toBe(second.tick);
    expect(delta.upserts).toHaveLength(1);
    expect(delta.removes).toHaveLength(0);
    expect(delta.checksum).toBeTypeOf('number');
  });

  it('applies delta only against the correct baseline', () => {
    const first = snapshot(1, 10);
    const second = snapshot(2, 20);
    const delta = diffSnapshots(first, second);
    expect(applyDelta(first, delta).entities[0].components.value).toBe(20);
    expect(() => applyDelta(snapshot(3, 30), delta)).toThrow(/base mismatch/);
  });

  it('keeps bounded snapshot history', () => {
    const history = new SnapshotHistory(3);
    history.put(snapshot(1, 1));
    history.put(snapshot(2, 2));
    history.put(snapshot(3, 3));
    history.put(snapshot(4, 4));
    expect(history.size).toBe(3);
    expect(history.get(tickValue(1))).toBeUndefined();
    expect(history.nearest(tickValue(3))?.entities[0].components.value).toBe(3);
  });

  it('rejects malformed packet versions and accepts valid packets', () => {
    const packet = {
      protocol: 2,
      kind: 'snapshot.delta',
      sequence: 1,
      tick: tickValue(4),
      ack: 3,
      payload: { ok: true },
      checksum: 0,
    };
    const cryptoPacket = { ...packet, checksum: 0 };
    expect(validatePacket(cryptoPacket)).toBe(false);
    expect(validatePacket({ ...packet, protocol: 99 })).toBe(false);
  });
});
