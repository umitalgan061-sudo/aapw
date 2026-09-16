import { describe, expect, it } from 'vitest';
import { InputCommandBuffer } from '../../../src/3d/modern/next/input.ts';
import { ReplayRecorder, verifyReplay } from '../../../src/3d/modern/next/replay.ts';
import { LifecycleGuard, StateMachine } from '../../../src/3d/modern/next/stateMachine.ts';
import { WorldStateStore, applyWorldPatch } from '../../../src/3d/modern/next/worldState.ts';
import { resolveNextConfig, validateNextConfig } from '../../../src/3d/modern/next/config.ts';
import { entityId, tick } from '../../../src/3d/modern/next/types.ts';

describe('next deep invariants', () => {
  it('records and verifies replay frames', () => {
    const input = new InputCommandBuffer();
    const recorder = new ReplayRecorder(99);
    const command = input.push({ tick: tick(1), moveX: 1, moveZ: 0, lookX: 0, lookY: 0, buttons: 1 });
    expect(recorder.append(command, 'ok')).toBe(true);
    const log = recorder.build();
    expect(verifyReplay(log, 99, () => 'ok').ok).toBe(true);
    expect(verifyReplay(log, 98, () => 'ok').ok).toBe(false);
  });

  it('detects replay frame checksum drift', () => {
    const input = new InputCommandBuffer();
    const recorder = new ReplayRecorder(7);
    const command = input.push({ tick: tick(1), moveX: 0, moveZ: 1, lookX: 0, lookY: 0, buttons: 0 });
    recorder.append(command, 'expected');
    expect(verifyReplay(recorder.build(), 7, () => 'actual')).toMatchObject({ ok: false, firstMismatchTick: 1 });
  });

  it('enforces declared state transitions', () => {
    const machine = new StateMachine<{ count: number }>();
    machine.register({ id: 'idle', transitions: ['run'], update: ({ data }) => data.count > 0 ? 'run' : undefined });
    machine.register({ id: 'run', transitions: ['idle'] });
    machine.start('idle', { count: 0 }, 0);
    expect(machine.transition('run', { count: 0 }, 1)).toBe(true);
    expect(machine.transition('missing', { count: 0 }, 2)).toBe(false);
    expect(machine.history().length).toBe(1);
  });

  it('guards lifecycle transitions', () => {
    const guard = new LifecycleGuard();
    expect(guard.canUpdate()).toBe(false);
    expect(guard.start()).toBe(true);
    expect(guard.canUpdate()).toBe(true);
    expect(guard.start()).toBe(false);
    expect(guard.stop()).toBe(true);
    expect(guard.phase).toBe('stopped');
  });

  it('creates checksummed world snapshots', () => {
    const store = new WorldStateStore();
    store.setTick(tick(12));
    store.upsert({ id: entityId(2), position: { x: 1, y: 2, z: 3 }, rotationY: 0.5, velocity: { x: 1, y: 0, z: 0 }, health: 100, stamina: 50, flags: 1 });
    const snapshot = store.snapshot();
    const restored = new WorldStateStore();
    restored.restore(snapshot);
    expect(restored.snapshot().checksum).toBe(snapshot.checksum);
  });

  it('applies bounded world patches', () => {
    const store = new WorldStateStore();
    store.upsert({ id: entityId(1), position: { x: 0, y: 0, z: 0 }, rotationY: 0, velocity: { x: 0, y: 0, z: 0 }, health: 100, stamina: 100, flags: 0 });
    expect(applyWorldPatch(store, { id: entityId(1), changes: { health: -10, position: { x: 5, y: 0, z: 2 } } })).toBe(true);
    expect(store.get(entityId(1))?.health).toBe(0);
    expect(store.get(entityId(1))?.position.x).toBe(5);
  });

  it('validates the default runtime config', () => {
    const config = resolveNextConfig();
    expect(config.version).toBe(1);
    expect(() => validateNextConfig(config)).not.toThrow();
    expect(() => validateNextConfig({ ...config, simulation: { ...config.simulation, hz: 999 } })).toThrow();
  });
});
