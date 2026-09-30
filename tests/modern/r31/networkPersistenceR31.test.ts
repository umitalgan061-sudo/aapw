import { describe, expect, it } from 'vitest';
import { createNetworkPairR31 } from '../../../src/3d/strict/r31/inMemoryNetworkR31.ts';
import { NetworkSessionR31 } from '../../../src/3d/strict/r31/networkSessionR31.ts';
import { InMemoryPersistencePortR31 } from '../../../src/3d/strict/r31/inMemoryPersistenceR31.ts';
import { PersistenceRuntimeR31 } from '../../../src/3d/strict/r31/persistenceR31.ts';
import { SnapshotCodecRuntimeR31 } from '../../../src/3d/strict/r31/snapshotR31.ts';

describe('R31 network and persistence', () => {
  it('connects a deterministic in-memory transport pair', () => {
    const [a, b] = createNetworkPairR31();
    expect(a.connected()).toBe(true);
    expect(b.connected()).toBe(true);
    a.send(new TextEncoder().encode('hello'));
    expect(b.drain()).toHaveLength(1);
  });

  it('validates outbound and inbound network packets', () => {
    const [a, b] = createNetworkPairR31();
    const left = new NetworkSessionR31({
      connected: () => a.connected(),
      send: (bytes) => a.send(bytes),
      receive: (bytes) => a.receive(bytes),
      close: () => a.close(),
    });
    const right = new NetworkSessionR31({
      connected: () => b.connected(),
      send: (bytes) => b.send(bytes),
      receive: (bytes) => b.receive(bytes),
      close: () => b.close(),
    });
    expect(left.send({ tick: 2, sentAtMs: 10, kind: 'event', payload: { value: 7 } }, 10)).toBe(true);
    const raw = b.drain()[0]!;
    expect(right.receive(raw)).toBe(true);
    expect(right.drain()[0]?.payload).toEqual({ value: 7 });
  });

  it('round-trips versioned state through persistence', async () => {
    const port = new InMemoryPersistencePortR31();
    const codec = new SnapshotCodecRuntimeR31<{ score: number }>({
      sanitize: (state) => ({ score: Math.max(0, Math.floor(state.score)) }),
      validate: (state): state is { score: number } =>
        Boolean(state && typeof state === 'object' && typeof (state as { score?: unknown }).score === 'number'),
    });
    const persistence = new PersistenceRuntimeR31(port, codec);
    await persistence.save('slot1', { score: 120.9 }, 9, 500);
    const loaded = await persistence.load('slot1');
    expect(loaded?.envelope.state).toEqual({ score: 120 });
    expect(persistence.listSlots()).toHaveLength(1);
    await persistence.remove('slot1');
    expect(persistence.listSlots()).toHaveLength(0);
  });
});
