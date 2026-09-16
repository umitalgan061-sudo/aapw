import type { Aabb, Vec2, Vec3, Quat } from './contracts.ts';
import { ZERO_VEC3, IDENTITY_QUAT, clamp, normalize2, normalize3, stableNumber } from './contracts.ts';

export const dot2 = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross2 = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const dot3 = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const add2 = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub2 = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const add3v = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, value: number): Vec3 => ({ x: a.x * value, y: a.y * value, z: a.z * value });
export const projectOnPlane = (vector: Vec3, normal: Vec3): Vec3 => { const n = normalize3(normal); return sub3(vector, scale(n, dot3(vector, n))); };
export const reflect = (vector: Vec3, normal: Vec3): Vec3 => { const n = normalize3(normal); return sub3(vector, scale(n, 2 * dot3(vector, n))); };
export const angleBetween = (a: Vec3, b: Vec3): number => Math.acos(clamp(dot3(normalize3(a), normalize3(b)), -1, 1));
export const lerpQuat = (a: Quat, b: Quat, amount: number): Quat => {
  let bx = b.x; let by = b.y; let bz = b.z; let bw = b.w;
  const cosine = a.x * bx + a.y * by + a.z * bz + a.w * bw;
  if (cosine < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; }
  const t = clamp(amount, 0, 1);
  const x = a.x + (bx - a.x) * t;
  const y = a.y + (by - a.y) * t;
  const z = a.z + (bz - a.z) * t;
  const w = a.w + (bw - a.w) * t;
  const length = Math.hypot(x, y, z, w) || 1;
  return { x: x / length, y: y / length, z: z / length, w: w / length };
};

export const pointInAabb = (point: Vec3, aabb: Aabb): boolean => point.x >= aabb.min.x && point.x <= aabb.max.x && point.y >= aabb.min.y && point.y <= aabb.max.y && point.z >= aabb.min.z && point.z <= aabb.max.z;
export const intersectsAabb = (a: Aabb, b: Aabb): boolean => a.min.x <= b.max.x && a.max.x >= b.min.x && a.min.y <= b.max.y && a.max.y >= b.min.y && a.min.z <= b.max.z && a.max.z >= b.min.z;
export const expandAabb = (aabb: Aabb, amount: number): Aabb => { const v = Math.max(0, amount); return { min: { x: aabb.min.x - v, y: aabb.min.y - v, z: aabb.min.z - v }, max: { x: aabb.max.x + v, y: aabb.max.y + v, z: aabb.max.z + v } }; };
export const aabbCenter = (aabb: Aabb): Vec3 => ({ x: (aabb.min.x + aabb.max.x) / 2, y: (aabb.min.y + aabb.max.y) / 2, z: (aabb.min.z + aabb.max.z) / 2 });
export const aabbExtent = (aabb: Aabb): Vec3 => ({ x: Math.max(0, aabb.max.x - aabb.min.x), y: Math.max(0, aabb.max.y - aabb.min.y), z: Math.max(0, aabb.max.z - aabb.min.z) });
export const quantize3 = (value: Vec3, step = 0.01): Vec3 => { const size = Math.max(1e-6, step); return { x: stableNumber(Math.round(value.x / size) * size), y: stableNumber(Math.round(value.y / size) * size), z: stableNumber(Math.round(value.z / size) * size) }; };
export const hashVector3 = (value: Vec3, step = 0.01): string => { const q = quantize3(value, step); return `${q.x}|${q.y}|${q.z}`; };
export const moveToward3 = (current: Vec3, target: Vec3, maxDistanceDelta: number): Vec3 => { const delta = sub3(target, current); const distance = Math.hypot(delta.x, delta.y, delta.z); if (distance <= Math.max(0, maxDistanceDelta) || distance < 1e-8) return { ...target }; return add3v(current, scale(normalize3(delta), Math.max(0, maxDistanceDelta))); };
export const clampLength3 = (value: Vec3, maximum: number): Vec3 => { const length = Math.hypot(value.x, value.y, value.z); const limit = Math.max(0, maximum); return length <= limit || length < 1e-8 ? { ...value } : scale(value, limit / length); };
export const rotateYaw = (value: Vec3, radians: number): Vec3 => { const cosine = Math.cos(radians); const sine = Math.sin(radians); return { x: value.x * cosine - value.z * sine, y: value.y, z: value.x * sine + value.z * cosine }; };
export const forwardFromYaw = (yaw: number): Vec3 => ({ x: Math.sin(yaw), y: 0, z: Math.cos(yaw) });
export const yawFromDirection = (direction: Vec3): number => Math.atan2(direction.x, direction.z);
export const safeNormalize = (value: Vec3): Vec3 => Math.hypot(value.x, value.y, value.z) < 1e-8 ? ZERO_VEC3 : normalize3(value);
export const safeNormalize2 = (value: Vec2): Vec2 => Math.hypot(value.x, value.y) < 1e-8 ? { x: 0, y: 0 } : normalize2(value);
export const identityQuat = (): Quat => IDENTITY_QUAT;
