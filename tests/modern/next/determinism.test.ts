import { describe, expect, it } from 'vitest';
import { DeterministicRandom, deterministicChecksum, deterministicId, hashInts, hashString, mix32, quantize, quantizeAngleRadians, seededRandom, sequence } from '../../../src/3d/modern/next/determinism.ts';

describe('next determinism', () => {
  it('produces repeatable random streams', () => {
    const a = seededRandom(1234, 8, 9);
    const b = seededRandom(1234, 8, 9);
    expect(Array.from({ length: 20 }, () => a.nextUint32())).toEqual(Array.from({ length: 20 }, () => b.nextUint32()));
  });

  it('forks without perturbing the parent stream', () => {
    const a = new DeterministicRandom(42);
    const parentFirst = a.nextUint32();
    const child = a.fork('combat');
    expect(child.nextUint32()).toBe(new DeterministicRandom(42).fork('combat').nextUint32());
    expect(a.nextUint32()).not.toBe(parentFirst);
  });

  it('clones exact state', () => {
    const original = new DeterministicRandom(7);
    original.nextUint32();
    const clone = original.clone();
    expect(Array.from({ length: 10 }, () => clone.nextUint32())).toEqual(Array.from({ length: 10 }, () => original.nextUint32()));
  });

  it('normalizes ranges and chances', () => {
    const rng = new DeterministicRandom(9);
    expect(rng.range(4, 4)).toBe(4);
    expect(rng.int(2, 2)).toBe(2);
    expect(rng.chance(0)).toBe(false);
    expect(rng.chance(1)).toBe(true);
    expect(() => rng.range(4, 3)).toThrow();
  });

  it('keeps hash functions stable', () => {
    expect(hashString('aapw')).toBe(hashString('aapw'));
    expect(hashInts([1, 2, 3])).toBe(hashInts([1, 2, 3]));
    expect(mix32(123)).toBe(mix32(123));
    expect(deterministicId(1, 'hero', 2)).toBe(deterministicId(1, 'hero', 2));
  });

  it('quantizes numbers and angles', () => {
    expect(quantize(1.2345, 0.01)).toBe(1.23);
    expect(quantize(Number.NaN, 0.01)).toBe(0);
    expect(quantizeAngleRadians(Math.PI * 4)).toBe(0);
    expect(quantizeAngleRadians(-Math.PI / 2)).toBe(3072);
  });

  it('creates deterministic sequences', () => {
    expect(sequence(55, 32, 4)).toEqual(sequence(55, 32, 4));
    expect(sequence(55, 0).values).toEqual([]);
  });

  it('checksums typed content', () => {
    expect(deterministicChecksum(['a', 1, true])).toBe(deterministicChecksum(['a', 1, true]));
    expect(deterministicChecksum(['a', 1])).not.toBe(deterministicChecksum(['a', 2]));
  });
});
