import type { DeterministicSeed, RandomSnapshot, Vec2, Vec3, Quaternion } from './types.js';

const UINT32_MAX = 0xffffffff;
const TAU = Math.PI * 2;

export const clamp = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) return min;
  if (min > max) return clamp(value, max, min);
  return Math.min(max, Math.max(min, value));
};

export const clamp01 = (value: number): number => clamp(value, 0, 1);
export const finiteOr = (value: number, fallback: number): number => Number.isFinite(value) ? value : fallback;
export const positiveOr = (value: number, fallback: number, floor = 1e-6): number => {
  return Number.isFinite(value) && value > 0 ? value : Math.max(floor, fallback);
};

export const quantize = (value: number, step: number): number => {
  const safe = positiveOr(step, 1);
  return Math.round(finiteOr(value, 0) / safe) * safe;
};

export const quantizeInt = (value: number): number => Math.trunc(finiteOr(value, 0));

export const wrap = (value: number, min: number, max: number): number => {
  const width = max - min;
  if (!Number.isFinite(width) || width <= 0) return min;
  const normalized = (finiteOr(value, min) - min) % width;
  return min + (normalized < 0 ? normalized + width : normalized);
};

export const wrapAngle = (radians: number): number => wrap(radians, -Math.PI, Math.PI);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * clamp01(t);
export const inverseLerp = (a: number, b: number, value: number): number => {
  if (a === b) return 0;
  return clamp01((value - a) / (b - a));
};
export const remap = (value: number, inMin: number, inMax: number, outMin: number, outMax: number): number => {
  return lerp(outMin, outMax, inverseLerp(inMin, inMax, value));
};

export const smoothStep = (edge0: number, edge1: number, x: number): number => {
  const t = inverseLerp(edge0, edge1, x);
  return t * t * (3 - 2 * t);
};

export const smootherStep = (edge0: number, edge1: number, x: number): number => {
  const t = inverseLerp(edge0, edge1, x);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

export const expSmoothingAlpha = (sharpness: number, deltaSeconds: number): number => {
  const s = Math.max(0, finiteOr(sharpness, 0));
  const dt = Math.max(0, finiteOr(deltaSeconds, 0));
  return 1 - Math.exp(-s * dt);
};

export const expDecay = (value: number, halfLifeSeconds: number, deltaSeconds: number): number => {
  if (halfLifeSeconds <= 0) return 0;
  const dt = Math.max(0, finiteOr(deltaSeconds, 0));
  return value * Math.pow(0.5, dt / halfLifeSeconds);
};

export const hashString = (input: string): number => {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

export const hashNumbers = (values: readonly number[]): number => {
  let hash = 2166136261 >>> 0;
  for (const value of values) {
    const n = Math.trunc(finiteOr(value, 0) * 1000003) >>> 0;
    hash ^= n;
    hash = Math.imul(hash, 16777619);
    hash ^= n >>> 16;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

export const hashTuple = (...values: readonly unknown[]): number => {
  let hash = 2166136261 >>> 0;
  for (const value of values) {
    const text = typeof value === 'string' ? value : String(value);
    hash ^= hashString(text);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

export const toHex32 = (value: number): string => (value >>> 0).toString(16).padStart(8, '0');
export const deterministicId = (namespace: string, seed: number, index: number): string => {
  return `${namespace}:${toHex32(hashTuple(namespace, seed, index))}`;
};

export const makeSeed = (namespace: string, value: number | string): DeterministicSeed => ({
  namespace,
  value: typeof value === 'number' ? value >>> 0 : hashString(value),
});

export class SeededRandom {
  private state0: number;
  private state1: number;
  private _calls = 0;

  public constructor(seed: DeterministicSeed | number | string = 0) {
    const raw = typeof seed === 'object' ? seed.value : typeof seed === 'string' ? hashString(seed) : seed;
    const base = raw >>> 0;
    this.state0 = (base ^ 0x9e3779b9) >>> 0;
    this.state1 = (base ^ 0x243f6a88) >>> 0;
    if (this.state0 === 0 && this.state1 === 0) this.state1 = 1;
  }

  public nextUint32(): number {
    let x = this.state0 >>> 0;
    const y = this.state1 >>> 0;
    this.state0 = y;
    x ^= (x << 13) >>> 0;
    x ^= x >>> 17;
    x ^= y;
    x ^= y >>> 5;
    this.state1 = x >>> 0;
    this._calls += 1;
    return this.state1;
  }

  public next(): number {
    return this.nextUint32() / (UINT32_MAX + 1);
  }

  public range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  public int(min: number, maxInclusive: number): number {
    const lo = Math.ceil(min);
    const hi = Math.floor(maxInclusive);
    if (hi <= lo) return lo;
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  public bool(probability = 0.5): boolean {
    return this.next() < clamp01(probability);
  }

  public sign(): -1 | 1 {
    return this.next() < 0.5 ? -1 : 1;
  }

  public pick<T>(items: readonly T[]): T | undefined {
    if (items.length === 0) return undefined;
    return items[this.int(0, items.length - 1)];
  }

  public shuffle<T>(items: readonly T[]): T[] {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = this.int(0, i);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  public fork(label: string): SeededRandom {
    const mixed = hashTuple(this.nextUint32(), label, this._calls);
    return new SeededRandom(mixed);
  }

  public snapshot(): RandomSnapshot {
    return { state0: this.state0 >>> 0, state1: this.state1 >>> 0, calls: this._calls };
  }

  public restore(snapshot: RandomSnapshot): void {
    this.state0 = snapshot.state0 >>> 0;
    this.state1 = snapshot.state1 >>> 0;
    this._calls = Math.max(0, Math.trunc(snapshot.calls));
  }

  public get calls(): number { return this._calls; }
}

export const stableSort = <T>(items: readonly T[], compare: (a: T, b: T) => number): T[] => {
  return items.map((value, index) => ({ value, index })).sort((a, b) => {
    const diff = compare(a.value, b.value);
    return diff !== 0 ? diff : a.index - b.index;
  }).map(({ value }) => value);
};

export const compareString = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
export const compareNumber = (a: number, b: number): number => a - b;
export const compareNumberDesc = (a: number, b: number): number => b - a;

export const vec2 = (x = 0, y = 0): Vec2 => Object.freeze({ x, y });
export const vec3 = (x = 0, y = 0, z = 0): Vec3 => Object.freeze({ x, y, z });
export const quat = (x = 0, y = 0, z = 0, w = 1): Quaternion => Object.freeze({ x, y, z, w });
export const addVec3 = (a: Vec3, b: Vec3): Vec3 => vec3(a.x + b.x, a.y + b.y, a.z + b.z);
export const subVec3 = (a: Vec3, b: Vec3): Vec3 => vec3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scaleVec3 = (a: Vec3, scalar: number): Vec3 => vec3(a.x * scalar, a.y * scalar, a.z * scalar);
export const dotVec3 = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const lengthSqVec3 = (a: Vec3): number => dotVec3(a, a);
export const lengthVec3 = (a: Vec3): number => Math.sqrt(lengthSqVec3(a));
export const normalizeVec3 = (a: Vec3): Vec3 => {
  const length = lengthVec3(a);
  return length > 1e-8 ? scaleVec3(a, 1 / length) : vec3();
};
export const distanceSqVec3 = (a: Vec3, b: Vec3): number => lengthSqVec3(subVec3(a, b));
export const distanceVec3 = (a: Vec3, b: Vec3): number => Math.sqrt(distanceSqVec3(a, b));
export const angleBetweenVec3 = (a: Vec3, b: Vec3): number => {
  const la = lengthVec3(a);
  const lb = lengthVec3(b);
  if (la <= 1e-8 || lb <= 1e-8) return 0;
  return Math.acos(clamp(dotVec3(a, b) / (la * lb), -1, 1));
};
export const rotateY = (v: Vec3, radians: number): Vec3 => {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return vec3(v.x * c - v.z * s, v.y, v.x * s + v.z * c);
};
export const yawFromDirection = (v: Vec3): number => Math.atan2(v.x, v.z);
export const directionFromYaw = (yaw: number): Vec3 => vec3(Math.sin(yaw), 0, Math.cos(yaw));
export const TAU_RADIANS = TAU;
