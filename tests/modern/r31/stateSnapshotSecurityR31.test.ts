import { describe, expect, it } from 'vitest';
import { StateStoreR31 } from '../../../src/3d/strict/r31/stateStoreR31.ts';
import { SnapshotCodecRuntimeR31, canonicalDigestR31 } from '../../../src/3d/strict/r31/snapshotR31.ts';
import { sanitizeR31, validatePayloadR31, RateLimiterR31 } from '../../../src/3d/strict/r31/securityR31.ts';
import { WorkerProtocolR31 } from '../../../src/3d/strict/r31/workerProtocolR31.ts';

describe('R31 state, snapshot and security', () => {
  interface State { hp: number; mode: string; }
  const codec = new SnapshotCodecRuntimeR31<State>({
    sanitize: (state) => ({ hp: Math.max(0, Math.floor(state.hp)), mode: state.mode.trim() }),
    validate: (state): state is State => Boolean(state && typeof state === 'object'
      && typeof (state as State).hp === 'number' && typeof (state as State).mode === 'string'),
  });

  it('tracks typed state transitions', () => {
    const store = new StateStoreR31<State>({ hp: 100, mode: 'idle' });
    const changes: number[] = [];
    store.on('hp', (change) => changes.push(change.next));
    expect(store.set('hp', 90)).toBe(true);
    expect(store.set('hp', 90)).toBe(false);
    expect(store.update({ mode: 'run' })).toBe(1);
    expect(changes).toEqual([90]);
    expect(store.snapshot()).toEqual({ hp: 90, mode: 'run' });
  });

  it('rejects tampered snapshots by digest', () => {
    const envelope = codec.encode({ hp: 77.7, mode: ' idle ' }, 10, 1000);
    expect(codec.decode(envelope).ok).toBe(true);
    const tampered = { ...envelope, state: { hp: 1, mode: 'idle' } };
    expect(codec.decode(tampered).ok).toBe(false);
    expect(canonicalDigestR31({ b: 1, a: 2 })).toBe(canonicalDigestR31({ a: 2, b: 1 }));
  });

  it('sanitizes hostile input without preserving functions or non-finite numbers', () => {
    const clean = sanitizeR31({ text: 'x'.repeat(900), value: Number.NaN, fn: () => 1 });
    expect(clean).toMatchObject({ value: null, fn: null });
    expect((clean as { text: string }).text.length).toBe(512);
    expect(validatePayloadR31(clean).allowed).toBe(true);
  });

  it('bounds rate and worker protocol traffic', () => {
    const limiter = new RateLimiterR31(2, 1000);
    expect(limiter.allow(0)).toBe(true);
    expect(limiter.allow(1)).toBe(true);
    expect(limiter.allow(2)).toBe(false);
    const protocol = new WorkerProtocolR31();
    const bytes = protocol.encodeRequest({ id: 'one', operation: 'work', payload: { n: 1 }, issuedAtTick: 4 });
    expect(bytes).not.toBeNull();
    expect(protocol.decode(bytes!)).not.toBeNull();
    expect(protocol.diagnostics().decoded).toBe(1);
  });
});
