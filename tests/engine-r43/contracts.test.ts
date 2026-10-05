import { describe, expect, it } from 'vitest';
import {
  clamp,
  clamp01,
  failure,
  finiteOr,
  normalizeVec2,
  normalizeVec3,
  stableDigest,
  stableStringify,
  success,
} from '../../src/engine-ts/r43/contracts.ts';

describe('r43 contracts', () => {
  it('clamps invalid and out-of-range values deterministically', () => {
    expect(clamp(Number.NaN, 1, 2)).toBe(1);
    expect(clamp(-4, 1, 2)).toBe(1);
    expect(clamp(9, 1, 2)).toBe(2);
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(finiteOr(Number.NaN, 7)).toBe(7);
    expect(finiteOr(3, 7)).toBe(3);
  });

  it('normalizes vector magnitude without introducing NaN', () => {
    expect(normalizeVec2(0, 0)).toEqual({ x: 0, y: 0 });
    const diagonal = normalizeVec2(3, 4);
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(1, 8);
    const long = normalizeVec2(300, 400);
    expect(long.x).toBeCloseTo(0.6, 8);
    expect(normalizeVec3(0, 0, 0)).toEqual({ x: 0, y: 0, z: 0 });
    const vector3 = normalizeVec3(2, 3, 6);
    expect(Math.hypot(vector3.x, vector3.y, vector3.z)).toBeCloseTo(1, 8);
  });

  it('stable stringification is insensitive to object insertion order', () => {
    const a = { z: 1, a: { c: 3, b: 2 } };
    const b = { a: { b: 2, c: 3 }, z: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
    expect(stableDigest(a)).toBe(stableDigest(b));
    expect(stableDigest({ a: 1 })).not.toBe(stableDigest({ a: 2 }));
  });

  it('creates explicit success and failure result envelopes', () => {
    expect(success(5)).toEqual({ ok: true, value: 5 });
    expect(failure({ code: 'TEST', message: 'bad', retryable: false }))
      .toEqual({ ok: false, error: { code: 'TEST', message: 'bad', retryable: false } });
  });

  it('freezes returned immutable contracts', () => {
    const result = normalizeVec2(1, 0);
    expect(Object.isFrozen(result)).toBe(false);
    const ok = success({ answer: 42 });
    expect(Object.isFrozen(ok)).toBe(true);
  });
});
