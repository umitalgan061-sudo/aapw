import { describe, expect, it } from 'vitest';
import { CommandRateLimiter, sanitizeCommand, validatePayload, validateSnapshotAge } from '../../src/3d/modern/runtimeSecurityV2.ts';
import { RollbackController } from '../../src/3d/modern/rollbackControllerV2.ts';

describe('runtime security v2', () => {
  it('bounds command throughput per tick', () => {
    const limiter = new CommandRateLimiter({ maxCommandsPerTick: 2, maxPayloadBytes: 1024, maxStringLength: 32, maxCollectionLength: 10, maxSnapshotAgeTicks: 10 });
    expect(limiter.allow(1)).toBe(true);
    expect(limiter.allow(1)).toBe(true);
    expect(limiter.allow(1)).toBe(false);
    expect(limiter.allow(2)).toBe(true);
  });

  it('rejects oversized payloads and validates snapshot age', () => {
    expect(validatePayload('x'.repeat(100), { maxPayloadBytes: 4096, maxStringLength: 32, maxCollectionLength: 10, maxCommandsPerTick: 10, maxSnapshotAgeTicks: 10 }).accepted).toBe(false);
    expect(validateSnapshotAge(90, 100, 10)).toBe(true);
    expect(validateSnapshotAge(89, 100, 10)).toBe(false);
  });

  it('sanitizes command identifiers without changing payload ownership', () => {
    const command = sanitizeCommand({ id: 'a b', type: 'move/action', payload: { x: 1 }, tick: 4, checksum: 'abc' });
    expect(command.id).toBe('a_b');
    expect(command.type).toBe('move_action');
    expect(command.payload).toEqual({ x: 1 });
  });
});

describe('rollback controller v2', () => {
  it('restores a checkpoint and replays only available inputs', () => {
    const controller = new RollbackController<number, number>({ capacity: 8 });
    for (let tick = 0; tick <= 5; tick += 1) controller.record({ tick, state: tick, digest: String(tick) }, tick === 0 ? undefined : 1);
    let state = 0;
    const result = controller.rollback(2, 'desync', {
      restore: (value) => { state = value; },
      step: (value, input) => value + input,
      digest: (value) => String(value),
    });
    expect(result.ok).toBe(true);
    expect(result.finalTick).toBe(5);
    expect(result.replayed).toBe(3);
    expect(state).toBe(5);
  });

  it('does not plan outside retained history', () => {
    const controller = new RollbackController<number, number>({ capacity: 3 });
    controller.record({ tick: 10, state: 10, digest: '10' }, 1);
    controller.record({ tick: 11, state: 11, digest: '11' }, 1);
    controller.record({ tick: 12, state: 12, digest: '12' }, 1);
    expect(controller.plan(1, 'local-recovery')).toBeNull();
    expect(controller.plan(11, 'local-recovery')?.toTick).toBe(12);
  });
});
