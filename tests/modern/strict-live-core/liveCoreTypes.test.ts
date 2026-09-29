import { describe, expect, it } from 'vitest';
import {
  add3, clamp, deadzone, deepFreeze, entityId, finite, length3, lengthXZ,
  lerp3, normalize3, radialDeadzone, stableHash, stableSerialize, vec3,
} from '../../../src/3d/strict/liveCoreTypes.ts';

describe('liveCoreTypes', () => {
  it('brands identifiers without changing runtime values', () => {
    expect(entityId('player')).toBe('player');
    expect(entityId(' player ')).toBe('player');
  });
  it('normalizes non-finite values deterministically', () => {
    expect(finite(Number.NaN, 7)).toBe(7);
    expect(finite(Number.POSITIVE_INFINITY, 9)).toBe(9);
    expect(finite(4, 9)).toBe(4);
  });
  it('clamps values to requested bounds', () => {
    expect(clamp(-2, 0, 1)).toBe(0);
    expect(clamp(2, 0, 1)).toBe(1);
    expect(clamp(.5, 0, 1)).toBe(.5);
  });
  it('maps scalar deadzones continuously', () => {
    expect(deadzone(.1, .2)).toBe(0);
    expect(deadzone(-.2, .2)).toBe(0);
    expect(deadzone(1, .2)).toBeCloseTo(1);
    expect(deadzone(-1, .2)).toBeCloseTo(-1);
  });
  it('maps radial deadzones without exceeding unit length', () => {
    expect(radialDeadzone(.05, 0, .2).magnitude).toBe(0);
    const mapped = radialDeadzone(1, 1, .2);
    expect(mapped.magnitude).toBe(1);
    expect(Math.hypot(mapped.x, mapped.y)).toBeCloseTo(1);
  });
  it('keeps vector operations immutable', () => {
    const a = vec3(1, 2, 3);
    const b = vec3(4, 5, 6);
    expect(add3(a, b)).toEqual({ x: 5, y: 7, z: 9 });
    expect(length3(a)).toBeCloseTo(Math.sqrt(14));
    expect(lengthXZ(a)).toBeCloseTo(Math.sqrt(10));
    const normalized = normalize3(a);
    expect(length3(normalized)).toBeCloseTo(1);
  });
  it('interpolates vectors with bounded alpha', () => {
    const a = vec3(0, 0, 0);
    const b = vec3(10, 20, 30);
    expect(lerp3(a, b, -1)).toEqual(a);
    expect(lerp3(a, b, .5)).toEqual({ x: 5, y: 10, z: 15 });
    expect(lerp3(a, b, 2)).toEqual(b);
  });
  it('serializes objects in stable order', () => {
    expect(stableSerialize({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(stableSerialize(undefined)).toBe('undefined');
    expect(stableSerialize([2, 1])).toBe('[2,1]');
  });
  it('hashes object insertion orders identically', () => {
    expect(stableHash({ b: 2, a: 1 })).toBe(stableHash({ a: 1, b: 2 }));
    expect(stableHash({ a: 1 })).not.toBe(stableHash({ a: 2 }));
  });
  it('freezes nested runtime state', () => {
    const value = deepFreeze({ one: { two: 2 }, list: [{ three: 3 }] });
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.one)).toBe(true);
    expect(Object.isFrozen(value.list[0])).toBe(true);
  });
  it('remains deterministic across repeated hashing', () => {
    const input = { x: vec3(1, 2, 3), actions: ['jump', 'light'] };
    const hashes = Array.from({ length: 32 }, () => stableHash(input));
    expect(new Set(hashes).size).toBe(1);
  });
});