import { describe, expect, it } from 'vitest';
import { DeterministicRng, FixedClock, criticallyDamped, decay, hashJson, quantize, stableSerialize, stableSort, vec3Add, vec3Distance, vec3Normalize, vec3Scale } from '../../../src/3d/modern/r40';

describe('R40 deterministic primitives', () => {
  it('hashes equal objects identically', () => {
    expect(hashJson({ b: 2, a: 1 })).toBe(hashJson({ a: 1, b: 2 }));
  });
  it('hashes array ordering distinctly', () => {
    expect(hashJson([1, 2, 3])).not.toBe(hashJson([3, 2, 1]));
  });
  it('serializes object keys in sorted order', () => {
    expect(stableSerialize({ z: 1, a: 2 })).toBe('{"a":2,"z":1}');
  });
  it('quantizes values deterministically', () => {
    expect(quantize(0.12345, 0.01)).toBe(0.12);
    expect(quantize(-0.12345, 0.01)).toBe(-0.12);
    expect(quantize(Number.NaN, 0.01)).toBe(0);
  });
  it('normalizes vectors', () => {
    const value = vec3Normalize({ x: 3, y: 0, z: 4 });
    expect(value.x).toBeCloseTo(0.6);
    expect(value.z).toBeCloseTo(0.8);
  });
  it('handles zero vector normalization', () => {
    expect(vec3Normalize({ x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: 0, z: 0 });
  });
  it('adds vectors without mutation', () => {
    const a = { x: 1, y: 2, z: 3 };
    expect(vec3Add(a, { x: 4, y: 5, z: 6 })).toEqual({ x: 5, y: 7, z: 9 });
    expect(a).toEqual({ x: 1, y: 2, z: 3 });
  });
  it('scales vectors', () => {
    expect(vec3Scale({ x: 2, y: -2, z: 4 }, 0.5)).toEqual({ x: 1, y: -1, z: 2 });
  });
  it('measures vector distance', () => {
    expect(vec3Distance({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 })).toBe(5);
  });
  it('keeps stable sort stable on equal keys', () => {
    const values = stableSort([{ id: 'a', n: 1 }, { id: 'b', n: 1 }, { id: 'c', n: 1 }], (a, b) => a.n - b.n);
    expect(values.map((value) => value.id)).toEqual(['a', 'b', 'c']);
  });
  it('produces repeatable RNG streams', () => {
    const a = new DeterministicRng('seed');
    const b = new DeterministicRng('seed');
    const left = Array.from({ length: 50 }, () => a.nextUint32());
    const right = Array.from({ length: 50 }, () => b.nextUint32());
    expect(left).toEqual(right);
  });
  it('forks streams independently by label', () => {
    const root = new DeterministicRng('seed');
    expect(root.fork('a').nextUint32()).toBe(root.fork('a').nextUint32());
    expect(root.fork('a').nextUint32()).not.toBe(root.fork('b').nextUint32());
  });
  it('restores rng state exactly', () => {
    const rng = new DeterministicRng('seed');
    rng.nextUint32();
    const state = rng.snapshot();
    const expected = [rng.nextUint32(), rng.nextUint32(), rng.nextUint32()];
    rng.restore(state);
    expect([rng.nextUint32(), rng.nextUint32(), rng.nextUint32()]).toEqual(expected);
  });
  it('keeps fixed clock bounded during a frame spike', () => {
    const clock = new FixedClock(60);
    const result = clock.push(1000, 4);
    expect(result.ticks).toHaveLength(4);
    expect(Number(clock.tick)).toBe(4);
    expect(result.alpha).toBeGreaterThanOrEqual(0);
    expect(result.alpha).toBeLessThan(1);
  });
  it('does not move clock backwards on reset', () => {
    const clock = new FixedClock(60);
    clock.push(100, 10);
    clock.reset(2 as never);
    expect(Number(clock.tick)).toBe(2);
  });
  it('decays memory toward zero', () => {
    expect(decay(1, 10, 10)).toBeCloseTo(0.5);
    expect(decay(0.5, 10, 20)).toBeCloseTo(0.125);
  });
  it('returns zero decay for non-positive half life', () => {
    expect(decay(1, 0, 1)).toBe(0);
  });
  it('moves critically damped values toward target', () => {
    const result = criticallyDamped(0, 1, 0, 1 / 60, 4);
    expect(result.value).toBeGreaterThan(0);
    expect(result.value).toBeLessThan(1);
  });
  it('is deterministic across repeated damping calls', () => {
    const left = criticallyDamped(0.2, 0.8, -0.3, 0.016, 7);
    const right = criticallyDamped(0.2, 0.8, -0.3, 0.016, 7);
    expect(left).toEqual(right);
  });
  it('serializes bigint values deterministically', () => {
    expect(stableSerialize(42n)).toBe('42n');
  });
  it('does not emit negative zero', () => {
    expect(stableSerialize(-0)).toBe('0');
  });
  it('keeps hash length fixed', () => {
    expect(hashJson({ long: 'value' })).toHaveLength(16);
  });
});
