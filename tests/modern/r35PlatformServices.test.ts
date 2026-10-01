import { describe, expect, it } from 'vitest';
import { R35RecoveryController, createRecoveryIncident } from '../../src/3d/nextgen/r35/runtimeRecovery';
import { R35CommandBus, createCommandContext } from '../../src/3d/nextgen/r35/commandBus';
import { R35SaveCodec, createSaveMigration } from '../../src/3d/nextgen/r35/saveCodec';
import { R35WorkerPool } from '../../src/3d/nextgen/r35/workerPool';

describe('R35 platform services', () => {
  it('recovers with bounded retries and later resets on success', () => {
    const recovery = new R35RecoveryController({ maxRetries: 2, retryBaseTicks: 3 });
    const first = recovery.decide(createRecoveryIncident('a', 10, 'running', 'network', 'timeout'));
    expect(first.action).toBe('retry');
    expect(first.delayTicks).toBe(3);
    const second = recovery.decide(createRecoveryIncident('a', 11, 'running', 'network', 'timeout'));
    expect(second.action).toBe('retry');
    recovery.markRecovered();
    expect(recovery.state().consecutiveFailures).toBe(0);
  });

  it('dispatches commands through middleware in priority order', async () => {
    const bus = new R35CommandBus();
    const log: string[] = [];
    bus.register({
      type: 'move',
      validate: (payload): payload is { distance: number } =>
        typeof payload === 'object' && payload !== null && 'distance' in payload,
      handle: async (command) => {
        log.push('handler-' + command.payload.distance);
      },
    });
    bus.use({
      id: 'trace',
      handle: async (command, _context, next) => {
        log.push('middleware-' + command.sequence);
        await next();
      },
    });
    bus.enqueue({ sequence: 1, tick: 2, entityId: 1, type: 'move', payload: { distance: 10 } }, 'normal');
    bus.enqueue({ sequence: 2, tick: 2, entityId: 1, type: 'move', payload: { distance: 20 } }, 'high');
    await bus.dispatchAvailable(createCommandContext(2));
    expect(log).toEqual(['middleware-2', 'handler-20', 'middleware-1', 'handler-10']);
    expect(bus.stats().processed).toBe(2);
  });

  it('encodes checksummed saves and migrates versioned payloads', () => {
    const codec = new R35SaveCodec([
      createSaveMigration(0, 1, (payload) => ({ ...(payload as { value: number }), migrated: true })),
    ]);
    const legacy = new R35SaveCodec();
    const legacyBytes = legacy.encode({ value: 7 }, 9);
    legacyBytes[8] = 0;
    const decoded = codec.decode<{ value: number; migrated: boolean }>(legacyBytes);
    expect(decoded.payload.migrated).toBe(true);
    expect(codec.validate(legacyBytes).valid).toBe(true);
    legacyBytes[19] ^= 0xff;
    expect(codec.validate(legacyBytes).valid).toBe(false);
  });

  it('enforces bounded concurrency and cancellation in the worker pool', async () => {
    const pool = new R35WorkerPool(2);
    const first = pool.submit({ id: 'first', priority: 'normal', payload: 1, execute: async (value) => value + 1 });
    const second = pool.submit({ id: 'second', priority: 'high', payload: 2, execute: async (value) => value + 2 });
    const third = pool.submit({ id: 'third', priority: 'low', payload: 3, execute: async (value) => value + 3 });
    const results = await Promise.all([first, second, third]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(pool.stats().completed).toBe(3);
  });
});
