import { describe, expect, it } from 'vitest';
import { CommandRateLimiterV3, rejectDangerousKeys, sanitizePayload, validateRuntimeCommand } from '../../src/3d/nextgen/runtimeSecurityV3';

describe('runtime security', () => {
  it('enforces per-window command limits deterministically', () => {
    const limiter = new CommandRateLimiterV3({ maxCommandsPerWindow: 2, windowTicks: 10 });
    expect(limiter.consume(0)).toBe(true);
    expect(limiter.consume(1)).toBe(true);
    expect(limiter.consume(2)).toBe(false);
    expect(limiter.consume(10)).toBe(true);
    expect(limiter.state.rejected).toBe(1);
  });

  it('sanitizes strings and rejects oversized collections', () => {
    expect(sanitizePayload('\u0000hello\u0007')).toBe('hello');
    expect(() => sanitizePayload(Array.from({ length: 600 }, () => 1))).toThrow(/collection/);
  });

  it('removes prototype-pollution keys', () => {
    const clean = rejectDangerousKeys({ constructor: { polluted: true }, safe: { prototype: 1, ok: 2 } }) as Record<string, unknown>;
    expect(clean.constructor).toBeUndefined();
    expect((clean.safe as Record<string, unknown>).prototype).toBeUndefined();
    expect((clean.safe as Record<string, unknown>).ok).toBe(2);
  });

  it('validates a complete runtime command boundary', () => {
    const limiter = new CommandRateLimiterV3({ maxCommandsPerWindow: 4, windowTicks: 30 });
    expect(validateRuntimeCommand({ tick: 4, entityId: 9, type: 'interact', payload: { message: 'ok' } }, limiter).accepted).toBe(true);
    expect(validateRuntimeCommand({ tick: -1, entityId: 9, type: 'interact', payload: {} }, limiter).accepted).toBe(false);
    expect(validateRuntimeCommand({ tick: 5, entityId: 0, type: 'interact', payload: {} }, limiter).accepted).toBe(false);
  });
});
