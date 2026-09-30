import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SIMULATION_CONFIG,
  addVec3,
  clamp,
  distance,
  distanceSquared,
  isFiniteVec3,
  isValidSimulationConfig,
  lerp,
  lerpVec3,
  mixHash,
  normalizeVec2,
  normalizeVec3,
  saturate,
  scaleVec3,
  subtractVec3,
  stableChecksum,
  stableStringify,
  vec3,
} from '../../../src/3d/modern/nextgen/index.ts';

describe('modern nextgen runtime contract matrix', () => {
  const scalarCases = [
    [-10, 0, 1],
    [-1, 0, 1],
    [0, 0, 1],
    [0.25, 0, 1],
    [0.5, 0, 1],
    [0.999, 0, 1],
    [1, 0, 1],
    [2, 0, 1],
    [Number.MAX_SAFE_INTEGER, 0, 1],
  ] as const;

  it.each(scalarCases)('clamp is total and bounded for value=%s', (value, min, max) => {
    const result = clamp(value, min, max);
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBeGreaterThanOrEqual(min);
    expect(result).toBeLessThanOrEqual(max);
  });

  it.each([-100, -1, 0, 0.1, 0.5, 0.9, 1, 2, 100])('saturate never escapes [0,1] for value=%s', value => {
    const result = saturate(value);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });

  it.each([0, 0.1, 0.25, 0.5, 0.75, 0.9, 1])('lerp respects endpoints and interpolation order for t=%s', t => {
    expect(lerp(-5, 15, t)).toBeCloseTo(-5 + 20 * t);
    expect(lerp(100, -100, t)).toBeCloseTo(100 - 200 * t);
  });

  it('lerpVec3 preserves endpoint identity by value', () => {
    const first = vec3(1, 2, 3);
    const second = vec3(9, 8, 7);
    expect(lerpVec3(first, second, 0)).toEqual(first);
    expect(lerpVec3(first, second, 1)).toEqual(second);
    expect(lerpVec3(first, second, 0.5)).toEqual({ x: 5, y: 5, z: 5 });
  });

  it('vector arithmetic follows component-wise algebra', () => {
    const a = vec3(2, -3, 5);
    const b = vec3(-4, 7, 1);
    expect(addVec3(a, b)).toEqual({ x: -2, y: 4, z: 6 });
    expect(subtractVec3(a, b)).toEqual({ x: 6, y: -10, z: 4 });
    expect(scaleVec3(a, 2)).toEqual({ x: 4, y: -6, z: 10 });
    expect(scaleVec3(a, 0)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('distance obeys symmetry and squared-distance relationship', () => {
    const a = vec3(1, 2, 3);
    const b = vec3(4, 6, 3);
    expect(distance(a, b)).toBeCloseTo(5);
    expect(distanceSquared(a, b)).toBeCloseTo(25);
    expect(distance(a, b)).toBeCloseTo(distance(b, a));
    expect(distanceSquared(a, a)).toBe(0);
  });

  it.each([
    [{ x: 3, y: 4 }, { x: 0.6, y: 0.8 }],
    [{ x: -3, y: 4 }, { x: -0.6, y: 0.8 }],
    [{ x: 0, y: -5 }, { x: 0, y: -1 }],
    [{ x: 0, y: 0 }, { x: 0, y: 0 }],
  ] as const)('normalizeVec2 remains finite for %j', (input, expected) => {
    expect(normalizeVec2(input)).toEqual(expected);
  });

  it.each([
    [vec3(3, 4, 0), vec3(0.6, 0.8, 0)],
    [vec3(-3, 4, 0), vec3(-0.6, 0.8, 0)],
    [vec3(0, -5, 12), vec3(0, -5 / 13, 12 / 13)],
    [vec3(0, 0, 0), vec3(0, 0, 0)],
  ] as const)('normalizeVec3 respects magnitude for %j', (input, expected) => {
    const actual = normalizeVec3(input);
    expect(actual.x).toBeCloseTo(expected.x);
    expect(actual.y).toBeCloseTo(expected.y);
    expect(actual.z).toBeCloseTo(expected.z);
  });

  it('validates finite vectors and rejects NaN or Infinity', () => {
    expect(isFiniteVec3(vec3())).toBe(true);
    expect(isFiniteVec3(vec3(1, -2, Number.MAX_VALUE))).toBe(true);
    expect(isFiniteVec3({ x: Number.NaN, y: 0, z: 0 })).toBe(false);
    expect(isFiniteVec3({ x: 0, y: Number.POSITIVE_INFINITY, z: 0 })).toBe(false);
    expect(isFiniteVec3({ x: 0, y: 0, z: Number.NEGATIVE_INFINITY })).toBe(false);
  });

  it('accepts the production default simulation configuration', () => {
    expect(isValidSimulationConfig(DEFAULT_SIMULATION_CONFIG)).toBe(true);
    expect(DEFAULT_SIMULATION_CONFIG.tickRate).toBeGreaterThan(0);
    expect(DEFAULT_SIMULATION_CONFIG.maxCatchUpTicks).toBeGreaterThan(0);
    expect(DEFAULT_SIMULATION_CONFIG.maxFrameDeltaSeconds).toBeGreaterThan(0);
    expect(Number.isInteger(DEFAULT_SIMULATION_CONFIG.deterministicSeed)).toBe(true);
  });

  it.each([
    { ...DEFAULT_SIMULATION_CONFIG, tickRate: 0 },
    { ...DEFAULT_SIMULATION_CONFIG, tickRate: -1 },
    { ...DEFAULT_SIMULATION_CONFIG, maxCatchUpTicks: 0 },
    { ...DEFAULT_SIMULATION_CONFIG, maxCatchUpTicks: 1.5 },
    { ...DEFAULT_SIMULATION_CONFIG, maxFrameDeltaSeconds: 0 },
    { ...DEFAULT_SIMULATION_CONFIG, maxFrameDeltaSeconds: Number.NaN },
    { ...DEFAULT_SIMULATION_CONFIG, deterministicSeed: 1.5 },
  ])('rejects malformed simulation configuration %j', config => {
    expect(isValidSimulationConfig(config)).toBe(false);
  });

  it('mixHash has deterministic avalanche behavior for nearby inputs', () => {
    const baseline = mixHash(0x12345678, 0x90abcdef);
    const repeated = mixHash(0x12345678, 0x90abcdef);
    const changed = mixHash(0x12345678, 0x90abcdee);
    expect(baseline).toBe(repeated);
    expect(changed).not.toBe(baseline);
    expect(baseline).toBeGreaterThanOrEqual(0);
    expect(changed).toBeGreaterThanOrEqual(0);
    expect(baseline).toBeLessThanOrEqual(0xffffffff);
    expect(changed).toBeLessThanOrEqual(0xffffffff);
  });

  it('canonical JSON remains stable across object insertion order', () => {
    const a = { c: 3, a: 1, b: { y: 8, x: 7 } };
    const b = { b: { x: 7, y: 8 }, a: 1, c: 3 };
    expect(stableStringify(a)).toBe(stableStringify(b));
    expect(stableChecksum(a)).toBe(stableChecksum(b));
  });

  it('canonical JSON distinguishes arrays because order is simulation-relevant', () => {
    const a = { actors: [1, 2, 3] };
    const b = { actors: [3, 2, 1] };
    expect(stableStringify(a)).not.toBe(stableStringify(b));
    expect(stableChecksum(a)).not.toBe(stableChecksum(b));
  });

  it('supports deterministic payload hashing for runtime manifests', () => {
    const manifest = {
      revision: 7,
      build: 'nextgen-r2',
      features: ['ecs', 'scheduler', 'streaming', 'network'],
      budgets: { entities: 4096, resources: 512, workers: 8 },
    };
    const hashes = Array.from({ length: 64 }, () => stableChecksum(manifest));
    expect(new Set(hashes).size).toBe(1);
  });

  it('keeps arithmetic associative where floating point permits exact integers', () => {
    const a = vec3(1, 2, 3);
    const b = vec3(4, 5, 6);
    const c = vec3(7, 8, 9);
    expect(addVec3(addVec3(a, b), c)).toEqual(addVec3(a, addVec3(b, c)));
    expect(subtractVec3(addVec3(a, b), b)).toEqual(a);
  });

  it('preserves unit-length normalization within floating-point tolerance', () => {
    const vectors = [
      vec3(1, 2, 3),
      vec3(-4, 7, 2),
      vec3(9, -3, 1),
      vec3(0.01, 0.02, 0.03),
      vec3(1000, 2000, -3000),
    ];
    for (const value of vectors) {
      const normalized = normalizeVec3(value);
      const length = Math.hypot(normalized.x, normalized.y, normalized.z);
      expect(length).toBeCloseTo(1, 10);
    }
  });
});
