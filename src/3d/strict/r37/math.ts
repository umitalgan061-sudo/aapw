import type { Vec2, Vec3 } from './types.ts';

export const R37_EPSILON = 1e-9;

export function finite(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  const alpha = clamp01(t);
  return a + (b - a) * alpha;
}

export function damp(current: number, target: number, smoothing: number, deltaSeconds: number): number {
  const alpha = 1 - Math.exp(-Math.max(0, smoothing) * Math.max(0, deltaSeconds));
  return lerp(current, target, alpha);
}

export function vec2(x = 0, y = 0): Vec2 {
  return Object.freeze({ x: finite(x), y: finite(y) });
}

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return Object.freeze({ x: finite(x), y: finite(y), z: finite(z) });
}

export function add2(a: Vec2, b: Vec2): Vec2 {
  return vec2(a.x + b.x, a.y + b.y);
}

export function sub2(a: Vec2, b: Vec2): Vec2 {
  return vec2(a.x - b.x, a.y - b.y);
}

export function scale2(value: Vec2, scalar: number): Vec2 {
  return vec2(value.x * scalar, value.y * scalar);
}

export function length2(value: Vec2): number {
  return Math.hypot(value.x, value.y);
}

export function normalize2(value: Vec2): Vec2 {
  const length = length2(value);
  return length <= R37_EPSILON ? vec2() : scale2(value, 1 / length);
}

export function add3(a: Vec3, b: Vec3): Vec3 {
  return vec3(a.x + b.x, a.y + b.y, a.z + b.z);
}

export function sub3(a: Vec3, b: Vec3): Vec3 {
  return vec3(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function scale3(value: Vec3, scalar: number): Vec3 {
  return vec3(value.x * scalar, value.y * scalar, value.z * scalar);
}

export function length3(value: Vec3): number {
  return Math.hypot(value.x, value.y, value.z);
}

export function lengthXZ(value: Vec3): number {
  return Math.hypot(value.x, value.z);
}

export function normalize3(value: Vec3): Vec3 {
  const length = length3(value);
  return length <= R37_EPSILON ? vec3() : scale3(value, 1 / length);
}

export function normalizeXZ(value: Vec3): Vec3 {
  const length = lengthXZ(value);
  return length <= R37_EPSILON ? vec3() : vec3(value.x / length, 0, value.z / length);
}

export function distance3(a: Vec3, b: Vec3): number {
  return length3(sub3(a, b));
}

export function distanceXZ(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function dot3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross3(a: Vec3, b: Vec3): Vec3 {
  return vec3(
    a.y * b.z - a.z * b.y,
    a.z * b.x - a.x * b.z,
    a.x * b.y - a.y * b.x,
  );
}

export function hash32(value: number): number {
  let x = value | 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

export function hashPair(a: number, b: number): number {
  return hash32(Math.imul(a | 0, 0x9e3779b1) ^ (b | 0));
}

export function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function seededUnit(seed: number, index: number): number {
  return (hashPair(seed | 0, index | 0) + 0.5) / 4294967296;
}

export function quantize(value: number, step = 0.001): number {
  if (!(step > 0)) return value;
  return Math.round(value / step) * step;
}

export function quantizeVec3(value: Vec3, step = 0.001): Vec3 {
  return vec3(quantize(value.x, step), quantize(value.y, step), quantize(value.z, step));
}

export function nearlyEqual(a: number, b: number, epsilon = 1e-6): boolean {
  return Math.abs(a - b) <= epsilon;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortObject(value));
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, sortObject(record[key])]));    
  }
  return value;
}
