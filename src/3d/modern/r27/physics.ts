import {
  type Aabb,
  type Capsule,
  type EntityId,
  type Ray,
  type Sphere,
  type Vec3,
  vec3,
} from './contracts.ts';

export interface BroadphaseEntry {
  readonly entity: EntityId;
  readonly bounds: Aabb;
  readonly layer: number;
  readonly enabled: boolean;
}

export interface CollisionHit {
  readonly entity: EntityId;
  readonly point: Vec3;
  readonly normal: Vec3;
  readonly penetration: number;
}

export interface SweepResult {
  readonly position: Vec3;
  readonly normal: Vec3;
  readonly hit: boolean;
  readonly entity?: EntityId;
  readonly fraction: number;
}

function min3(a: number, b: number, c: number): number {
  return Math.min(a, b, c);
}

function max3(a: number, b: number, c: number): number {
  return Math.max(a, b, c);
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return vec3(a.x + b.x, a.y + b.y, a.z + b.z);
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return vec3(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function scale(a: Vec3, factor: number): Vec3 {
  return vec3(a.x * factor, a.y * factor, a.z * factor);
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function length(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

export function normalize(a: Vec3, fallback = vec3(0, 1, 0)): Vec3 {
  const value = length(a);
  return value > 1e-9 ? scale(a, 1 / value) : fallback;
}

export function distanceSquared(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export function expandAabb(bounds: Aabb, amount: number): Aabb {
  const e = Math.max(0, amount);
  return {
    min: vec3(bounds.min.x - e, bounds.min.y - e, bounds.min.z - e),
    max: vec3(bounds.max.x + e, bounds.max.y + e, bounds.max.z + e),
  };
}

export function aabbIntersects(a: Aabb, b: Aabb): boolean {
  return (
    a.min.x <= b.max.x && a.max.x >= b.min.x &&
    a.min.y <= b.max.y && a.max.y >= b.min.y &&
    a.min.z <= b.max.z && a.max.z >= b.min.z
  );
}

export function pointInsideAabb(point: Vec3, bounds: Aabb): boolean {
  return (
    point.x >= bounds.min.x && point.x <= bounds.max.x &&
    point.y >= bounds.min.y && point.y <= bounds.max.y &&
    point.z >= bounds.min.z && point.z <= bounds.max.z
  );
}

export function sphereIntersectsAabb(sphere: Sphere, bounds: Aabb): boolean {
  const x = Math.max(bounds.min.x, Math.min(sphere.center.x, bounds.max.x));
  const y = Math.max(bounds.min.y, Math.min(sphere.center.y, bounds.max.y));
  const z = Math.max(bounds.min.z, Math.min(sphere.center.z, bounds.max.z));
  const dx = sphere.center.x - x;
  const dy = sphere.center.y - y;
  const dz = sphere.center.z - z;
  return dx * dx + dy * dy + dz * dz <= sphere.radius * sphere.radius;
}

export function capsuleToAabb(capsule: Capsule): Aabb {
  return {
    min: vec3(
      min3(capsule.a.x, capsule.b.x, capsule.a.x - capsule.radius),
      min3(capsule.a.y, capsule.b.y, capsule.a.y - capsule.radius),
      min3(capsule.a.z, capsule.b.z, capsule.a.z - capsule.radius),
    ),
    max: vec3(
      max3(capsule.a.x, capsule.b.x, capsule.a.x + capsule.radius),
      max3(capsule.a.y, capsule.b.y, capsule.a.y + capsule.radius),
      max3(capsule.a.z, capsule.b.z, capsule.a.z + capsule.radius),
    ),
  };
}

export function closestPointOnSegment(point: Vec3, a: Vec3, b: Vec3): Vec3 {
  const ab = sub(b, a);
  const ab2 = dot(ab, ab);
  if (ab2 <= 1e-12) return a;
  const t = Math.max(0, Math.min(1, dot(sub(point, a), ab) / ab2));
  return add(a, scale(ab, t));
}

export function raycastAabb(ray: Ray, bounds: Aabb): number | null {
  const axes: readonly (keyof Vec3)[] = ['x', 'y', 'z'];
  let tMin = 0;
  let tMax = ray.maxDistance;
  for (const axis of axes) {
    const origin = ray.origin[axis];
    const direction = ray.direction[axis];
    const minValue = bounds.min[axis];
    const maxValue = bounds.max[axis];

    if (Math.abs(direction) < 1e-9) {
      if (origin < minValue || origin > maxValue) return null;
      continue;
    }

    const inverse = 1 / direction;
    let t1 = (minValue - origin) * inverse;
    let t2 = (maxValue - origin) * inverse;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  return tMin <= ray.maxDistance ? tMin : null;
}

function cellKey(x: number, y: number, z: number): string {
  return `${x}:${y}:${z}`;
}

function floorCell(value: number, cellSize: number): number {
  return Math.floor(value / cellSize);
}

export class UniformGridBroadphase {
  readonly cellSize: number;

  #cells = new Map<string, Set<EntityId>>();
  #entries = new Map<EntityId, BroadphaseEntry>();

  constructor(cellSize = 8) {
    if (!(cellSize > 0 && Number.isFinite(cellSize))) throw new RangeError('cellSize must be positive');
    this.cellSize = cellSize;
  }

  upsert(entry: BroadphaseEntry): void {
    this.remove(entry.entity);
    this.#entries.set(entry.entity, entry);
    if (!entry.enabled) return;

    for (const key of this.#keysFor(entry.bounds)) {
      const bucket = this.#cells.get(key) ?? new Set<EntityId>();
      bucket.add(entry.entity);
      this.#cells.set(key, bucket);
    }
  }

  remove(entity: EntityId): boolean {
    const existing = this.#entries.get(entity);
    if (!existing) return false;
    for (const key of this.#keysFor(existing.bounds)) {
      const bucket = this.#cells.get(key);
      if (!bucket) continue;
      bucket.delete(entity);
      if (bucket.size === 0) this.#cells.delete(key);
    }
    this.#entries.delete(entity);
    return true;
  }

  queryAabb(bounds: Aabb, layerMask = 0xffff_ffff): readonly BroadphaseEntry[] {
    const candidates = new Set<EntityId>();
    for (const key of this.#keysFor(bounds)) {
      for (const entity of this.#cells.get(key) ?? []) candidates.add(entity);
    }

    return [...candidates]
      .sort((a, b) => Number(a) - Number(b))
      .map((entity) => this.#entries.get(entity))
      .filter((entry): entry is BroadphaseEntry =>
        Boolean(entry && entry.enabled && ((1 << entry.layer) & layerMask) !== 0 && aabbIntersects(entry.bounds, bounds)),
      );
  }

  querySphere(sphere: Sphere, layerMask = 0xffff_ffff): readonly BroadphaseEntry[] {
    return this.queryAabb(
      {
        min: vec3(sphere.center.x - sphere.radius, sphere.center.y - sphere.radius, sphere.center.z - sphere.radius),
        max: vec3(sphere.center.x + sphere.radius, sphere.center.y + sphere.radius, sphere.center.z + sphere.radius),
      },
      layerMask,
    ).filter((entry) => sphereIntersectsAabb(sphere, entry.bounds));
  }

  raycast(ray: Ray, layerMask = 0xffff_ffff): readonly (BroadphaseEntry & { readonly distance: number })[] {
    const probe: Aabb = {
      min: add(ray.origin, scale(normalize(ray.direction), -0.25)),
      max: add(
        add(ray.origin, scale(normalize(ray.direction), ray.maxDistance)),
        vec3(0.25, 0.25, 0.25),
      ),
    };

    return this.queryAabb(probe, layerMask)
      .map((entry) => {
        const distance = raycastAabb(ray, entry.bounds);
        return distance === null ? null : { ...entry, distance };
      })
      .filter((entry): entry is BroadphaseEntry & { readonly distance: number } => Boolean(entry))
      .sort((a, b) => a.distance - b.distance || Number(a.entity) - Number(b.entity));
  }

  snapshot(): readonly BroadphaseEntry[] {
    return [...this.#entries.values()].sort((a, b) => Number(a.entity) - Number(b.entity));
  }

  #keysFor(bounds: Aabb): readonly string[] {
    const minX = floorCell(bounds.min.x, this.cellSize);
    const minY = floorCell(bounds.min.y, this.cellSize);
    const minZ = floorCell(bounds.min.z, this.cellSize);
    const maxX = floorCell(bounds.max.x, this.cellSize);
    const maxY = floorCell(bounds.max.y, this.cellSize);
    const maxZ = floorCell(bounds.max.z, this.cellSize);
    const keys: string[] = [];
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) keys.push(cellKey(x, y, z));
      }
    }
    return keys;
  }
}

export function resolveAabbPenetration(position: Vec3, radius: number, bounds: Aabb): CollisionHit | null {
  const sphere: Sphere = { center: position, radius };
  if (!sphereIntersectsAabb(sphere, bounds)) return null;

  const distances = [
    { axis: 'x' as const, sign: position.x < (bounds.min.x + bounds.max.x) / 2 ? -1 : 1, amount: Math.min(Math.abs(position.x - bounds.min.x), Math.abs(bounds.max.x - position.x)) },
    { axis: 'y' as const, sign: position.y < (bounds.min.y + bounds.max.y) / 2 ? -1 : 1, amount: Math.min(Math.abs(position.y - bounds.min.y), Math.abs(bounds.max.y - position.y)) },
    { axis: 'z' as const, sign: position.z < (bounds.min.z + bounds.max.z) / 2 ? -1 : 1, amount: Math.min(Math.abs(position.z - bounds.min.z), Math.abs(bounds.max.z - position.z)) },
  ].sort((a, b) => a.amount - b.amount);

  const chosen = distances[0];
  if (!chosen) return null;
  const normal =
    chosen.axis === 'x' ? vec3(chosen.sign, 0, 0) :
    chosen.axis === 'y' ? vec3(0, chosen.sign, 0) :
    vec3(0, 0, chosen.sign);

  return {
    entity: entityId(1),
    point: position,
    normal,
    penetration: Math.max(0, radius + 0.01 - chosen.amount),
  };
}

export function sweepSphere(
  start: Vec3,
  end: Vec3,
  radius: number,
  obstacles: readonly BroadphaseEntry[],
): SweepResult {
  const direction = sub(end, start);
  const distance = length(direction);
  if (distance <= 1e-9) return { position: start, normal: vec3(0, 1, 0), hit: false, fraction: 1 };

  const ray = { origin: start, direction: normalize(direction), maxDistance: distance };
  let best: { readonly entry: BroadphaseEntry; readonly distance: number } | null = null;

  for (const entry of obstacles) {
    const expanded = expandAabb(entry.bounds, radius);
    const hitDistance = raycastAabb(ray, expanded);
    if (hitDistance === null) continue;
    if (!best || hitDistance < best.distance || (hitDistance === best.distance && Number(entry.entity) < Number(best.entry.entity))) {
      best = { entry, distance: hitDistance };
    }
  }

  if (!best) return { position: end, normal: vec3(0, 1, 0), hit: false, fraction: 1 };

  const fraction = Math.max(0, Math.min(1, best.distance / distance));
  const safeDistance = Math.max(0, best.distance - 0.02);
  const position = add(start, scale(normalize(direction), safeDistance));
  const center = best.entry.bounds;
  const midpoint = vec3(
    (center.min.x + center.max.x) / 2,
    (center.min.y + center.max.y) / 2,
    (center.min.z + center.max.z) / 2,
  );
  const normal = normalize(sub(position, midpoint));
  return {
    position,
    normal,
    hit: true,
    entity: best.entry.entity,
    fraction,
  };
}

export interface GroundingResult {
  readonly grounded: boolean;
  readonly height: number;
  readonly slopeDegrees: number;
}

export function computeGrounding(
  position: Vec3,
  sampleHeight: (x: number, z: number) => number,
  sampleStep = 0.5,
): GroundingResult {
  const current = sampleHeight(position.x, position.z);
  const left = sampleHeight(position.x - sampleStep, position.z);
  const right = sampleHeight(position.x + sampleStep, position.z);
  const forward = sampleHeight(position.x, position.z + sampleStep);
  const backward = sampleHeight(position.x, position.z - sampleStep);
  const dx = (right - left) / (2 * sampleStep);
  const dz = (forward - backward) / (2 * sampleStep);
  const slopeRadians = Math.atan(Math.hypot(dx, dz));
  return {
    grounded: position.y <= current + 0.12,
    height: current,
    slopeDegrees: slopeRadians * 180 / Math.PI,
  };
}
