import { describe, expect, it } from 'vitest';
import { ResourceCache } from '../../../src/3d/modern/next/resourceCache.ts';
import { buildSnapshotDelta, applySnapshotDelta, NetworkProtocolV2 } from '../../../src/3d/modern/next/network.ts';
import { SaveCodec, SaveSlotStore, canonicalize } from '../../../src/3d/modern/next/save.ts';
import { createDefaultWorkerPool, LocalWorkerPool } from '../../../src/3d/modern/next/worker.ts';
import { entityId, tick } from '../../../src/3d/modern/next/types.ts';

describe('next platform', () => {
  it('keeps resource cache inside byte and entry budgets', async () => {
    const cache = new ResourceCache<number>({ maxBytes: 10, maxEntries: 2, maxConcurrentLoads: 2 });
    const load = (value: number) => async () => ({ value, bytes: 6 });
    await cache.acquire('a', tick(1), load(1));
    await cache.acquire('b', tick(2), load(2));
    await cache.acquire('c', tick(3), load(3));
    expect(cache.stats().entries).toBeLessThanOrEqual(2);
    expect(cache.stats().bytes).toBeLessThanOrEqual(10);
  });

  it('pins a resource against eviction', async () => {
    const cache = new ResourceCache<number>({ maxBytes: 8, maxEntries: 2, maxConcurrentLoads: 2 });
    const a = await cache.acquire('a', tick(1), async () => ({ value: 1, bytes: 8 }));
    expect(cache.pin(a)).toBe(true);
    await cache.acquire('b', tick(2), async () => ({ value: 2, bytes: 8 }));
    expect(cache.get(a, tick(3))).toBe(1);
  });

  it('computes and applies snapshot deltas', () => {
    const base = { tick: tick(1), entities: [{ id: entityId(1), x: 0, y: 0, z: 0, yaw: 0, flags: 0 }, { id: entityId(2), x: 2, y: 0, z: 0, yaw: 0, flags: 0 }] };
    const next = { tick: tick(2), entities: [{ id: entityId(1), x: 1, y: 0, z: 0, yaw: 0.2, flags: 1 }, { id: entityId(3), x: 3, y: 0, z: 0, yaw: 0, flags: 0 }] };
    const delta = buildSnapshotDelta(base, next);
    expect(delta.upserts.map((item) => item.id)).toEqual([entityId(1), entityId(3)]);
    expect(delta.removals).toEqual([entityId(2)]);
    expect(applySnapshotDelta(base, delta)).toEqual(next);
  });

  it('rejects snapshot base mismatch', () => {
    const delta = buildSnapshotDelta(undefined, { tick: tick(2), entities: [] });
    expect(() => applySnapshotDelta({ tick: tick(1), entities: [] }, delta)).toThrow();
  });

  it('protects network sessions and sequence ordering', () => {
    const protocol = new NetworkProtocolV2('session');
    const envelope = protocol.encode('state', { ok: true }, tick(1), 100);
    expect(protocol.accept(envelope)).toBe(true);
    expect(protocol.accept(envelope)).toBe(false);
    const wrong = { ...envelope, session: 'other', sequence: 2 };
    expect(protocol.accept(wrong)).toBe(false);
  });

  it('round-trips current save versions', () => {
    const codec = new SaveCodec<{ score: number }>(2);
    codec.registerMigration<{ score: number }, { score: number }>( { from: 1, to: 2, migrate: (value) => ({ score: value.score + 1 }) } );
    const current = codec.encode({ score: 9 }, tick(5));
    expect(codec.decode(current).state).toEqual({ score: 9 });
    expect(canonicalize({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  it('migrates older saves', () => {
    const codec = new SaveCodec<{ score: number }>(2);
    codec.registerMigration<{ score: number }, { score: number }>({ from: 1, to: 2, migrate: (value) => ({ score: value.score + 10 }) });
    const body = JSON.stringify({ header: { format: 'aapw-next-save', version: 1, createdAtTick: 1, checksum: '' }, state: { score: 2 } });
    const expectedChecksum = codec.encode({ score: 12 }, tick(1));
    expect(expectedChecksum).toContain('aapw-next-save');
    expect(() => codec.decode(body)).toThrow('save checksum mismatch');
  });

  it('stores a bounded set of save slots', () => {
    const store = new SaveSlotStore<{ value: number }>(2);
    store.put('a', { updatedAtTick: tick(1), data: 'a', state: { value: 1 } });
    store.put('b', { updatedAtTick: tick(2), data: 'b', state: { value: 2 } });
    store.put('c', { updatedAtTick: tick(3), data: 'c', state: { value: 3 } });
    expect(store.list().map((slot) => slot.name)).toEqual(['c', 'b']);
  });

  it('executes default worker tasks', async () => {
    const pool = createDefaultWorkerPool(2);
    const result = await pool.enqueue('visibility', { values: [true, false, true] });
    expect(result.ok).toBe(true);
    expect(result.result).toBe(2);
  });

  it('orders custom worker tasks by priority', async () => {
    const pool = new LocalWorkerPool({ concurrency: 1, maxQueue: 4 });
    const seen: number[] = [];
    pool.register({ kind: 'compression', execute: (payload: number) => { seen.push(payload); return payload; } });
    const first = pool.enqueue('compression', 1, { priority: 2 });
    const second = pool.enqueue('compression', 2, { priority: 0 });
    const third = pool.enqueue('compression', 3, { priority: 1 });
    await Promise.all([first, second, third]);
    expect(seen[0]).toBe(1);
    expect(seen).toContain(2);
  });
});
