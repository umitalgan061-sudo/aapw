import type { Aabb2, Vec2, Vec3 } from './types.ts';

export const EPSILON = 1e-8;

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));
export const saturate = (value: number): number => clamp(value, 0, 1);
export const normalizeInputAxis = (value: number): number => {
  const normalized = clamp(value, -1, 1);
  return Math.abs(normalized) < 0.05 ? 0 : normalized;
};
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * saturate(t);
export const invLerp = (a: number, b: number, value: number): number => Math.abs(b - a) < EPSILON ? 0 : (value - a) / (b - a);
export const remap = (value: number, inMin: number, inMax: number, outMin: number, outMax: number): number => lerp(outMin, outMax, invLerp(inMin, inMax, value));
export const damp = (current: number, target: number, lambda: number, dtSeconds: number): number => lerp(current, target, 1 - Math.exp(-Math.max(0, lambda) * Math.max(0, dtSeconds)));
export const moveTowards = (current: number, target: number, maxDelta: number): number => Math.abs(target - current) <= Math.max(0, maxDelta) ? target : current + Math.sign(target - current) * Math.max(0, maxDelta);

export function length2(x: number, y: number): number { return Math.hypot(x, y); }
export function length3(x: number, y: number, z: number): number { return Math.hypot(x, y, z); }
export function distance2(a: Vec2, b: Vec2): number { return Math.hypot(a.x - b.x, a.y - b.y); }
export function distance3(a: Vec3, b: Vec3): number { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
export function normalize2(value: Vec2): Vec2 { const l = length2(value.x, value.y); return l < EPSILON ? { x: 0, y: 0 } : { x: value.x / l, y: value.y / l }; }
export function normalize3(value: Vec3): Vec3 { const l = length3(value.x, value.y, value.z); return l < EPSILON ? { x: 0, y: 0, z: 0 } : { x: value.x / l, y: value.y / l, z: value.z / l }; }
export function dot2(a: Vec2, b: Vec2): number { return a.x * b.x + a.y * b.y; }
export function dot3(a: Vec3, b: Vec3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
export function cross2(a: Vec2, b: Vec2): number { return a.x * b.y - a.y * b.x; }
export function cross3(a: Vec3, b: Vec3): Vec3 { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }; }
export function add3(a: Vec3, b: Vec3): Vec3 { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
export function subtract3(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
export function scale3(a: Vec3, scalar: number): Vec3 { return { x: a.x * scalar, y: a.y * scalar, z: a.z * scalar }; }
export function lerp3(a: Vec3, b: Vec3, t: number): Vec3 { const f = saturate(t); return { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f), z: lerp(a.z, b.z, f) }; }
export function reflect3(vector: Vec3, normal: Vec3): Vec3 { const n = normalize3(normal); const twice = 2 * dot3(vector, n); return subtract3(vector, scale3(n, twice)); }
export function project3(vector: Vec3, onto: Vec3): Vec3 { const denominator = dot3(onto, onto); return denominator < EPSILON ? { x: 0, y: 0, z: 0 } : scale3(onto, dot3(vector, onto) / denominator); }

export const yawToDirection = (yawRadians: number): Vec3 => ({ x: Math.sin(yawRadians), y: 0, z: Math.cos(yawRadians) });
export const directionToYaw = (direction: Vec3): number => Math.atan2(direction.x, direction.z);
export const wrapAngle = (angleRadians: number): number => {
  let angle = angleRadians % (Math.PI * 2);
  if (angle > Math.PI) angle -= Math.PI * 2;
  if (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
};
export const angleDelta = (from: number, to: number): number => wrapAngle(to - from);
export const rotateYaw = (current: number, target: number, maxRadians: number): number => current + clamp(angleDelta(current, target), -Math.max(0, maxRadians), Math.max(0, maxRadians));

export function pointInAabb(point: Vec2, bounds: Aabb2): boolean { return point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minZ && point.y <= bounds.maxZ; }
export function circleIntersectsAabb(x: number, z: number, radius: number, bounds: Aabb2): boolean {
  const closestX = clamp(x, bounds.minX, bounds.maxX);
  const closestZ = clamp(z, bounds.minZ, bounds.maxZ);
  const dx = x - closestX;
  const dz = z - closestZ;
  return dx * dx + dz * dz <= Math.max(0, radius) ** 2;
}

export function smoothstep(edge0: number, edge1: number, x: number): number { const t = saturate(invLerp(edge0, edge1, x)); return t * t * (3 - 2 * t); }
export function smootherstep(edge0: number, edge1: number, x: number): number { const t = saturate(invLerp(edge0, edge1, x)); return t * t * t * (t * (t * 6 - 15) + 10); }
export function expDecay(value: number, decayPerSecond: number, dtSeconds: number): number { return value * Math.exp(-Math.max(0, decayPerSecond) * Math.max(0, dtSeconds)); }

export class Vec3Accumulator {
  x = 0; y = 0; z = 0;
  add(value: Vec3, weight = 1): this { this.x += value.x * weight; this.y += value.y * weight; this.z += value.z * weight; return this; }
  reset(): this { this.x = 0; this.y = 0; this.z = 0; return this; }
  length(): number { return Math.hypot(this.x, this.y, this.z); }
  normalize(): this { const l = this.length(); if (l > EPSILON) { this.x /= l; this.y /= l; this.z /= l; } return this; }
  value(): Vec3 { return { x: this.x, y: this.y, z: this.z }; }
}
