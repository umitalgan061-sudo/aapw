import { describe, expect, it } from 'vitest';
import { RuntimeInvariantError, assertArrayCapacity, assertId, finite, finiteVector, invariant, monotonic, nonNegative, toFault } from '../../src/3d/modern/nextgen/assertions.ts';
import { tickValue, vec3 } from '../../src/3d/modern/nextgen/types.ts';

describe('nextgen runtime assertions', () => {
  const tick = tickValue(10);

  it('accepts valid scalar and vector values', () => {
    expect(finite(3.5, 'speed', tick)).toBe(3.5);
    expect(nonNegative(0, 'health', tick)).toBe(0);
    expect(finiteVector(vec3(1, 2, 3), 'position', tick)).toEqual(vec3(1, 2, 3));
  });

  it('throws typed invariant errors for invalid state', () => {
    expect(() => finite(Number.NaN, 'speed', tick)).toThrow(RuntimeInvariantError);
    expect(() => nonNegative(-1, 'health', tick)).toThrow(/non-negative/);
    expect(() => invariant(false, 'BROKEN', 'broken invariant', tick)).toThrow(/broken invariant/);
  });

  it('enforces monotonic ticks and bounded collections', () => {
    expect(monotonic(tickValue(4), tickValue(5), 'tick')).toBe(5);
    expect(() => monotonic(tickValue(5), tickValue(4), 'tick')).toThrow(/regressed/);
    expect(() => assertArrayCapacity([1, 2, 3], 2, 'commands', tick)).toThrow(/capacity/);
    expect(assertArrayCapacity([1], 2, 'commands', tick)).toBeUndefined();
  });

  it('sanitizes ids and converts failures to structured runtime faults', () => {
    expect(assertId('player:1', 'entity', tick)).toBe('player:1');
    expect(() => assertId('bad id', 'entity', tick)).toThrow(/unsupported/);
    const fault = toFault(new Error('oops'), tick, 'test');
    expect(fault).toMatchObject({ code: 'RUNTIME_ERROR', message: 'oops', tick, source: 'test' });
  });
});
