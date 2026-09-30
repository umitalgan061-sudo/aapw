import { describe, expect, it } from 'vitest';
import { SnapshotBuffer, encodeSnapshot, defaultPlayerState } from '../../src/3d/modern/networkRuntimeV2.ts';
import { RuntimePersistenceV2 } from '../../src/3d/modern/runtimePersistenceV2.ts';

describe('runtime persistence and network edge v2', () => {
  it('keeps snapshot capacity bounded and ignores duplicate old ticks', () => {
    const player = defaultPlayerState('p');
    const buffer = new SnapshotBuffer({ capacity: 2 });
    buffer.push(encodeSnapshot({ protocol: 2, sessionId: 's', tick: 1, ack: 0, createdAt: 1, entities: [], player }));
    buffer.push(encodeSnapshot({ protocol: 2, sessionId: 's', tick: 2, ack: 1, createdAt: 2, entities: [], player }));
    buffer.push(encodeSnapshot({ protocol: 2, sessionId: 's', tick: 1, ack: 1, createdAt: 3, entities: [], player }));
    expect(buffer.metrics().snapshots).toBe(2);
    expect(buffer.latest()?.tick).toBe(1);
  });

  it('creates a bounded persistence envelope for runtime state', () => {
    const persistence = new RuntimePersistenceV2({ capacity: 4 });
    const saved = persistence.save({ tick: 1, player: { id: 'p', health: 100 } });
    expect(saved.ok).toBe(true);
    expect(persistence.latest()?.tick).toBe(1);
    expect(persistence.metrics().entries).toBe(1);
  });
});
