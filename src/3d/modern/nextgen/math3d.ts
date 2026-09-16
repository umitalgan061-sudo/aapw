import { Aabb, Quat, Vec3, addVec3, clamp, dotVec3, normalizeVec3, scaleVec3, subtractVec3, vec3 } from './types.ts';

export function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

export function reflect(direction: Vec3, normal: Vec3): Vec3 {
  const n = normalizeVec3(normal);
  return subtractVec3(direction, scaleVec3(n, 2 * dotVec3(direction, n)));
}

export function moveTowards(current: Vec3, target: Vec3, maxDistance: number): Vec3 {
  const delta = subtractVec3(target, current);
  const length = Math.hypot(delta.x, delta.y, delta.z);
  if (length <= maxDistance || length <= Number.EPSILON) return { ...target };
  return addVec3(current, scaleVec3(delta, maxDistance / length));
}

export function slerpQuat(a: Quat, b: Quat, t: number): Quat {
  let ax = a.x;
  let ay = a.y;
  let az = a.z;
  let aw = a.w;
  let bx = b.x;
  let by = b.y;
  let bz = b.z;
  let bw = b.w;
  let cosine = ax * bx + ay * by + az * bz + aw * bw;
  if (cosine < 0) {
    cosine = -cosine;
    bx = -bx; by = -by; bz = -bz; bw = -bw;
  }
  const s = clamp(t, 0, 1);
  if (cosine > 0.9995) {
    const x = ax + s * (bx - ax);
    const y = ay + s * (by - ay);
    const z = az + s * (bz - az);
    const w = aw + s * (bw - aw);
    const length = Math.hypot(x, y, z, w);
    return { x: x / length, y: y / length, z: z / length, w: w / length };
  }
  const theta = Math.acos(cosine);
  const sinTheta = Math.sin(theta);
  const wa = Math.sin((1 - s) * theta) / sinTheta;
  const wb = Math.sin(s * theta) / sinTheta;
  return { x: ax * wa + bx * wb, y: ay * wa + by * wb, z: az * wa + bz * wb, w: aw * wa + bw * wb };
}

export function transformPoint(point: Vec3, position: Vec3, rotation: Quat, scale: Vec3): Vec3 {
  const p = { x: point.x * scale.x, y: point.y * scale.y, z: point.z * scale.z };
  const qx = rotation.x;
  const qy = rotation.y;
  const qz = rotation.z;
  const qw = rotation.w;
  const ix = qw * p.x + qy * p.z - qz * p.y;
  const iy = qw * p.y + qz * p.x - qx * p.z;
  const iz = qw * p.z + qx * p.y - qy * p.x;
  const iw = -qx * p.x - qy * p.y - qz * p.z;
  return {
    x: ix * qw + iw * -qx + iy * -qz - iz * -qy + position.x,
    y: iy * qw + iw * -qy + iz * -qx - ix * -qz + position.y,
    z: iz * qw + iw * -qz + ix * -qy - iy * -qx + position.z,
  };
}

export function aabbCenter(bounds: Aabb): Vec3 {
  return vec3((bounds.min.x + bounds.max.x) / 2, (bounds.min.y + bounds.max.y) / 2, (bounds.min.z + bounds.max.z) / 2);
}

export function aabbExtent(bounds: Aabb): Vec3 {
  return vec3(Math.abs(bounds.max.x - bounds.min.x) / 2, Math.abs(bounds.max.y - bounds.min.y) / 2, Math.abs(bounds.max.z - bounds.min.z) / 2);
}

export function expandAabb(bounds: Aabb, amount: number): Aabb {
  return {
    min: vec3(bounds.min.x - amount, bounds.min.y - amount, bounds.min.z - amount),
    max: vec3(bounds.max.x + amount, bounds.max.y + amount, bounds.max.z + amount),
  };
}

export function mergeAabb(a: Aabb, b: Aabb): Aabb {
  return {
    min: vec3(Math.min(a.min.x, b.min.x), Math.min(a.min.y, b.min.y), Math.min(a.min.z, b.min.z)),
    max: vec3(Math.max(a.max.x, b.max.x), Math.max(a.max.y, b.max.y), Math.max(a.max.z, b.max.z)),
  };
}

export function pointInsideAabb(point: Vec3, bounds: Aabb): boolean {
  return point.x >= bounds.min.x && point.x <= bounds.max.x && point.y >= bounds.min.y && point.y <= bounds.max.y && point.z >= bounds.min.z && point.z <= bounds.max.z;
}

export function sphereIntersectsAabb(center: Vec3, radius: number, bounds: Aabb): boolean {
  const x = clamp(center.x, bounds.min.x, bounds.max.x);
  const y = clamp(center.y, bounds.min.y, bounds.max.y);
  const z = clamp(center.z, bounds.min.z, bounds.max.z);
  const dx = center.x - x;
  const dy = center.y - y;
  const dz = center.z - z;
  return dx * dx + dy * dy + dz * dz <= radius * radius;
}

export function yawQuaternion(yawRadians: number): Quat {
  const half = yawRadians * 0.5;
  return { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) };
}
