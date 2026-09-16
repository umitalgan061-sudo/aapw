import { describe, expect, it } from 'vitest';
import { AudioRouter, ambientGain } from '../../../src/3d/modern/next/audio.ts';
import { buildSnapshotDelta, applySnapshotDelta } from '../../../src/3d/modern/next/network.ts';
import { estimatePackedBytes, interpolateSnapshots, packSnapshot, unpackSnapshot } from '../../../src/3d/modern/next/snapshot.ts';
import { entityId, tick } from '../../../src/3d/modern/next/types.ts';

describe('next audio and snapshot systems', () => {
  it('mixes and virtualizes audio emitters', () => {
    const audio = new AudioRouter(1);
    audio.addEmitter({ id: 1, position: { x: 0, y: 0, z: 2 }, bus: 'sfx', radius: 10, gain: 1, loop: false, priority: 1 });
    audio.addEmitter({ id: 2, position: { x: 0, y: 0, z: 3 }, bus: 'sfx', radius: 10, gain: 1, loop: false, priority: 0 });
    const voices = audio.updateListener({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    expect(voices.find((voice) => voice.emitterId === 1)?.virtualized).toBe(false);
    expect(voices.find((voice) => voice.emitterId === 2)?.virtualized).toBe(true);
    expect(ambientGain(0, 10)).toBe(1);
  });

  it('packs and unpacks checksummed snapshots', () => {
    const snapshot = { tick: tick(4), entities: [{ id: entityId(1), x: 1.23456, y: 2, z: 3, yaw: 0.12345, flags: 5 }] };
    const packed = packSnapshot(snapshot);
    expect(packed.entities[0]?.x).toBe(1.235);
    expect(unpackSnapshot(packed)).toEqual({ tick: tick(4), entities: [{ id: entityId(1), x: 1.235, y: 2, z: 3, yaw: 0.1235, flags: 5 }] });
    expect(estimatePackedBytes(packed)).toBeGreaterThan(0);
  });

  it('rejects corrupted packed snapshots', () => {
    const packed = packSnapshot({ tick: tick(1), entities: [] });
    expect(() => unpackSnapshot({ ...packed, checksum: '00000000' })).toThrow();
  });

  it('interpolates compatible snapshots', () => {
    const a = { tick: tick(1), entities: [{ id: entityId(1), x: 0, y: 0, z: 0, yaw: 0, flags: 0 }] };
    const b = { tick: tick(2), entities: [{ id: entityId(1), x: 10, y: 0, z: 4, yaw: 1, flags: 2 }] };
    const result = interpolateSnapshots(a, b, 0.5);
    expect(result.entities[0]).toEqual({ id: entityId(1), x: 5, y: 0, z: 2, yaw: 0.5, flags: 2 });
  });

  it('keeps delta application equivalent to full state', () => {
    const base = { tick: tick(1), entities: [{ id: entityId(1), x: 0, y: 0, z: 0, yaw: 0, flags: 0 }] };
    const next = { tick: tick(2), entities: [{ id: entityId(1), x: 1, y: 0, z: 1, yaw: 0.1, flags: 1 }] };
    const delta = buildSnapshotDelta(base, next);
    expect(applySnapshotDelta(base, delta)).toEqual(next);
  });
});
