/** Deterministic math primitives shared by simulation, navigation and netcode. */

export interface Vec2 { x: number; y: number }
export interface Vec3 { x: number; y: number; z: number }
export interface Quat { x: number; y: number; z: number; w: number }
export interface Aabb { min: Vec3; max: Vec3 }
export interface Sphere { center: Vec3; radius: number }
export interface Plane { normal: Vec3; distance: number }

export const ZERO2: Readonly<Vec2> = Object.freeze({ x: 0, y: 0 });
export const ZERO3: Readonly<Vec3> = Object.freeze({ x: 0, y: 0, z: 0 });
export const IDENTITY_QUAT: Readonly<Quat> = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });
export const EPSILON = 1e-8;

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) throw new RangeError('value must be finite');
  if (min > max) throw new RangeError('min must be <= max');
  return Math.min(max, Math.max(min, value));
}

export function saturate(value: number): number { return clamp(value, 0, 1); }
export function lerp(a: number, b: number, t: number): number { return a + (b - a) * saturate(t); }
export function smoothStep(edge0: number, edge1: number, value: number): number {
  const t = saturate((value - edge0) / Math.max(EPSILON, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function vec2(x = 0, y = 0): Vec2 { return { x, y }; }
export function vec3(x = 0, y = 0, z = 0): Vec3 { return { x, y, z }; }
export function quat(x = 0, y = 0, z = 0, w = 1): Quat { return { x, y, z, w }; }

export function add2(a: Vec2, b: Vec2): Vec2 { return { x: a.x + b.x, y: a.y + b.y }; }
export function sub2(a: Vec2, b: Vec2): Vec2 { return { x: a.x - b.x, y: a.y - b.y }; }
export function scale2(value: Vec2, scalar: number): Vec2 { return { x: value.x * scalar, y: value.y * scalar }; }
export function dot2(a: Vec2, b: Vec2): number { return a.x * b.x + a.y * b.y; }
export function lengthSq2(value: Vec2): number { return dot2(value, value); }
export function length2(value: Vec2): number { return Math.sqrt(lengthSq2(value)); }
export function normalize2(value: Vec2): Vec2 {
  const length = length2(value);
  return length <= EPSILON ? { x: 0, y: 0 } : scale2(value, 1 / length);
}

export function add3(a: Vec3, b: Vec3): Vec3 { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
export function sub3(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
export function scale3(value: Vec3, scalar: number): Vec3 { return { x: value.x * scalar, y: value.y * scalar, z: value.z * scalar }; }
export function multiply3(a: Vec3, b: Vec3): Vec3 { return { x: a.x * b.x, y: a.y * b.y, z: a.z * b.z }; }
export function dot3(a: Vec3, b: Vec3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
export function cross3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
export function lengthSq3(value: Vec3): number { return dot3(value, value); }
export function length3(value: Vec3): number { return Math.sqrt(lengthSq3(value)); }
export function distanceSq3(a: Vec3, b: Vec3): number { return lengthSq3(sub3(a, b)); }
export function distance3(a: Vec3, b: Vec3): number { return Math.sqrt(distanceSq3(a, b)); }
export function normalize3(value: Vec3): Vec3 {
  const length = length3(value);
  return length <= EPSILON ? { x: 0, y: 0, z: 0 } : scale3(value, 1 / length);
}
export function project3(value: Vec3, normal: Vec3): Vec3 {
  const n = normalize3(normal);
  return scale3(n, dot3(value, n));
}
export function reject3(value: Vec3, normal: Vec3): Vec3 { return sub3(value, project3(value, normal)); }
export function reflect3(value: Vec3, normal: Vec3): Vec3 {
  const n = normalize3(normal);
  return sub3(value, scale3(n, 2 * dot3(value, n)));
}

export function rotateY(value: Vec3, radians: number): Vec3 {
  const c = Math.cos(radians); const s = Math.sin(radians);
  return { x: value.x * c - value.z * s, y: value.y, z: value.x * s + value.z * c };
}
export function yawFromDirection(value: Vec3): number { return Math.atan2(value.x, value.z); }
export function directionFromYaw(yaw: number): Vec3 { return { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) }; }

export function quaternionNormalize(value: Quat): Quat {
  const length = Math.hypot(value.x, value.y, value.z, value.w);
  return length <= EPSILON ? { ...IDENTITY_QUAT } : { x: value.x / length, y: value.y / length, z: value.z / length, w: value.w / length };
}
export function quaternionMultiply(a: Quat, b: Quat): Quat {
  return quaternionNormalize({
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  });
}
export function quaternionFromAxisAngle(axis: Vec3, radians: number): Quat {
  const n = normalize3(axis); const half = radians * 0.5; const s = Math.sin(half);
  return quaternionNormalize({ x: n.x * s, y: n.y * s, z: n.z * s, w: Math.cos(half) });
}

export function roundDeterministic(value: number, decimals = 6): number {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}
export function stableVec3(value: Vec3, decimals = 6): Vec3 {
  return { x: roundDeterministic(value.x, decimals), y: roundDeterministic(value.y, decimals), z: roundDeterministic(value.z, decimals) };
}
export function quantize(value: number, step: number): number {
  if (step <= 0 || !Number.isFinite(step)) throw new RangeError('step must be > 0');
  return Math.round(value / step) * step;
}
export function quantizeVec3(value: Vec3, step: number): Vec3 {
  return { x: quantize(value.x, step), y: quantize(value.y, step), z: quantize(value.z, step) };
}

export function makeAabb(center: Vec3, halfExtents: Vec3): Aabb {
  return { min: sub3(center, halfExtents), max: add3(center, halfExtents) };
}
export function containsPoint(aabb: Aabb, point: Vec3): boolean {
  return point.x >= aabb.min.x && point.x <= aabb.max.x && point.y >= aabb.min.y && point.y <= aabb.max.y && point.z >= aabb.min.z && point.z <= aabb.max.z;
}
export function intersectsAabb(a: Aabb, b: Aabb): boolean {
  return a.min.x <= b.max.x && a.max.x >= b.min.x && a.min.y <= b.max.y && a.max.y >= b.min.y && a.min.z <= b.max.z && a.max.z >= b.min.z;
}
export function expandAabb(aabb: Aabb, amount: number): Aabb {
  const delta = { x: amount, y: amount, z: amount };
  return { min: sub3(aabb.min, delta), max: add3(aabb.max, delta) };
}

export function sphereIntersectsAabb(sphere: Sphere, aabb: Aabb): boolean {
  const x = clamp(sphere.center.x, aabb.min.x, aabb.max.x);
  const y = clamp(sphere.center.y, aabb.min.y, aabb.max.y);
  const z = clamp(sphere.center.z, aabb.min.z, aabb.max.z);
  return distanceSq3(sphere.center, { x, y, z }) <= sphere.radius * sphere.radius;
}

export function rayPlane(origin: Vec3, direction: Vec3, plane: Plane): number | null {
  const denom = dot3(plane.normal, direction);
  if (Math.abs(denom) <= EPSILON) return null;
  const t = -(dot3(plane.normal, origin) + plane.distance) / denom;
  return t >= 0 ? t : null;
}

export function criticallyDamped(current: number, target: number, velocity: number, smoothTime: number, deltaSeconds: number): { value: number; velocity: number } {
  const safeTime = Math.max(1e-4, smoothTime);
  const omega = 2 / safeTime;
  const x = omega * deltaSeconds;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - target;
  const temp = (velocity + omega * change) * deltaSeconds;
  const nextVelocity = (velocity - omega * temp) * exp;
  const nextValue = target + (change + temp) * exp;
  return { value: nextValue, velocity: nextVelocity };
}

export function deterministicHash(values: readonly number[]): number {
  let hash = 2166136261 >>> 0;
  for (const value of values) {
    const scaled = Math.round(value * 1000) | 0;
    hash ^= scaled >>> 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

export class DeterministicRng {
  #state: number;
  constructor(seed: number) { this.#state = seed >>> 0 || 0x9e3779b9; }
  nextUint(): number {
    let state = this.#state;
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    this.#state = state >>> 0;
    return this.#state;
  }
  nextFloat(): number { return this.nextUint() / 0x1_0000_0000; }
  range(min: number, max: number): number { return min + (max - min) * this.nextFloat(); }
  int(min: number, maxInclusive: number): number {
    if (maxInclusive < min) throw new RangeError('maxInclusive must be >= min');
    return Math.floor(this.range(min, maxInclusive + 1));
  }
  fork(salt: number): DeterministicRng { return new DeterministicRng((this.nextUint() ^ (salt >>> 0)) >>> 0); }
}
