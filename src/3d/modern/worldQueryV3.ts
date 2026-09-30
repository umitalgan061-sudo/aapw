/**
 * High-level world query service for AAPW v3.
 *
 * This layer provides deterministic spatial queries over plain numeric data. It is intentionally
 * renderer-agnostic: Three.js objects stay at the presentation edge while gameplay asks the world
 * for height, occupancy, distance, line-of-sight and neighborhood information through typed queries.
 */

export interface Vec3V3 { x: number; y: number; z: number; }
export interface CircleQueryV3 { center: Vec3V3; radius: number; }
export interface AabbV3 { min: Vec3V3; max: Vec3V3; }
export interface HeightSampleV3 { position: Vec3V3; groundY: number; waterDepth: number; underwater: boolean; }
export interface WorldEntityV3 { id: number; position: Vec3V3; radius: number; tags: readonly string[]; active?: boolean; }
export interface ObstacleV3 { id: string; bounds: AabbV3; blocksSight: boolean; blocksMovement: boolean; }
export interface RayHitV3 { hit: boolean; distance: number; obstacleId: string | null; point: Vec3V3 | null; }
export interface LineOfSightOptionsV3 { maxDistance?: number; ignoreObstacleIds?: readonly string[]; }
export interface WorldQueryMetricsV3 { heightQueries: number; entityQueries: number; rayQueries: number; cachedHeightQueries: number; }

const finite = (value: number): boolean => Number.isFinite(value);
const nonNegative = (value: number): boolean => finite(value) && value >= 0;
const distanceSquared = (a: Vec3V3, b: Vec3V3): number => {
  const x = a.x - b.x;
  const y = a.y - b.y;
  const z = a.z - b.z;
  return x * x + y * y + z * z;
};

const contains = (bounds: AabbV3, point: Vec3V3): boolean =>
  point.x >= bounds.min.x && point.x <= bounds.max.x &&
  point.y >= bounds.min.y && point.y <= bounds.max.y &&
  point.z >= bounds.min.z && point.z <= bounds.max.z;

const intersectsCircle = (bounds: AabbV3, query: CircleQueryV3): boolean => {
  const x = Math.max(bounds.min.x, Math.min(query.center.x, bounds.max.x));
  const y = Math.max(bounds.min.y, Math.min(query.center.y, bounds.max.y));
  const z = Math.max(bounds.min.z, Math.min(query.center.z, bounds.max.z));
  return distanceSquared({ x, y, z }, query.center) <= query.radius * query.radius;
};

const rayAabb = (origin: Vec3V3, direction: Vec3V3, bounds: AabbV3, maxDistance: number): number | null => {
  let tMin = 0;
  let tMax = maxDistance;
  for (const axis of ['x', 'y', 'z'] as const) {
    const o = origin[axis];
    const d = direction[axis];
    const min = bounds.min[axis];
    const max = bounds.max[axis];
    if (Math.abs(d) < 1e-9) {
      if (o < min || o > max) return null;
      continue;
    }
    const inv = 1 / d;
    let near = (min - o) * inv;
    let far = (max - o) * inv;
    if (near > far) [near, far] = [far, near];
    tMin = Math.max(tMin, near);
    tMax = Math.min(tMax, far);
    if (tMin > tMax) return null;
  }
  return tMin <= maxDistance ? tMin : null;
};

export class WorldQueryV3 {
  #heightSampler: (x: number, z: number) => number;
  #waterSampler: ((x: number, z: number) => number) | null;
  #entities = new Map<number, WorldEntityV3>();
  #obstacles = new Map<string, ObstacleV3>();
  #heightCache = new Map<string, HeightSampleV3>();
  #metrics: WorldQueryMetricsV3 = { heightQueries: 0, entityQueries: 0, rayQueries: 0, cachedHeightQueries: 0 };

  constructor(options: {
    heightSampler: (x: number, z: number) => number;
    waterDepthSampler?: (x: number, z: number) => number;
  }) {
    this.#heightSampler = options.heightSampler;
    this.#waterSampler = options.waterDepthSampler ?? null;
  }

  registerEntity(entity: WorldEntityV3): void {
    if (!Number.isInteger(entity.id) || entity.id < 0) throw new RangeError('Entity id must be a non-negative integer');
    if (!nonNegative(entity.radius)) throw new RangeError('Entity radius must be non-negative');
    this.#entities.set(entity.id, { ...entity, tags: Object.freeze([...new Set(entity.tags)].sort()) });
  }

  removeEntity(id: number): boolean { return this.#entities.delete(id); }

  registerObstacle(obstacle: ObstacleV3): void {
    if (!obstacle.id.trim()) throw new Error('Obstacle id is required');
    this.#obstacles.set(obstacle.id, obstacle);
  }

  removeObstacle(id: string): boolean { return this.#obstacles.delete(id); }

  sampleHeight(position: Pick<Vec3V3, 'x' | 'z'>): HeightSampleV3 {
    this.#metrics.heightQueries += 1;
    const key = `${position.x.toFixed(3)}:${position.z.toFixed(3)}`;
    const cached = this.#heightCache.get(key);
    if (cached) {
      this.#metrics.cachedHeightQueries += 1;
      return cached;
    }
    const groundY = this.#heightSampler(position.x, position.z);
    if (!finite(groundY)) throw new Error(`Height sampler returned invalid value at ${key}`);
    const waterDepth = Math.max(0, this.#waterSampler?.(position.x, position.z) ?? 0);
    const sample = Object.freeze({
      position: { x: position.x, y: groundY, z: position.z },
      groundY,
      waterDepth,
      underwater: waterDepth > 0,
    });
    this.#heightCache.set(key, sample);
    if (this.#heightCache.size > 8192) {
      const first = this.#heightCache.keys().next().value;
      if (first !== undefined) this.#heightCache.delete(first);
    }
    return sample;
  }

  queryRadius(query: CircleQueryV3, tags: readonly string[] = []): readonly WorldEntityV3[] {
    if (!nonNegative(query.radius)) throw new RangeError('Query radius must be non-negative');
    this.#metrics.entityQueries += 1;
    const required = new Set(tags);
    const result = [...this.#entities.values()].filter((entity) => {
      if (entity.active === false) return false;
      if (required.size > 0 && [...required].some((tag) => !entity.tags.includes(tag))) return false;
      const combined = query.radius + entity.radius;
      return distanceSquared(entity.position, query.center) <= combined * combined;
    });
    result.sort((a, b) => distanceSquared(a.position, query.center) - distanceSquared(b.position, query.center) || a.id - b.id);
    return Object.freeze(result.map((entity) => ({ ...entity, tags: [...entity.tags] })));
  }

  queryAabb(bounds: AabbV3, tags: readonly string[] = []): readonly WorldEntityV3[] {
    this.#metrics.entityQueries += 1;
    const required = new Set(tags);
    const result = [...this.#entities.values()].filter((entity) => {
      if (entity.active === false) return false;
      if (required.size > 0 && [...required].some((tag) => !entity.tags.includes(tag))) return false;
      return contains(bounds, entity.position);
    });
    result.sort((a, b) => a.id - b.id);
    return Object.freeze(result.map((entity) => ({ ...entity, tags: [...entity.tags] })));
  }

  nearest(position: Vec3V3, maxDistance: number, tags: readonly string[] = []): WorldEntityV3 | null {
    const candidates = this.queryRadius({ center: position, radius: maxDistance }, tags);
    return candidates[0] ?? null;
  }

  lineOfSight(from: Vec3V3, to: Vec3V3, options: LineOfSightOptionsV3 = {}): RayHitV3 {
    this.#metrics.rayQueries += 1;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const rawDistance = Math.hypot(dx, dy, dz);
    const maxDistance = Math.min(options.maxDistance ?? rawDistance, rawDistance);
    if (rawDistance <= 1e-9) return { hit: false, distance: 0, obstacleId: null, point: null };
    const scale = 1 / rawDistance;
    const direction = { x: dx * scale, y: dy * scale, z: dz * scale };
    const ignored = new Set(options.ignoreObstacleIds ?? []);
    let closest: { obstacleId: string; distance: number } | null = null;
    for (const obstacle of this.#obstacles.values()) {
      if (!obstacle.blocksSight || ignored.has(obstacle.id)) continue;
      const distance = rayAabb(from, direction, obstacle.bounds, maxDistance);
      if (distance !== null && (!closest || distance < closest.distance)) closest = { obstacleId: obstacle.id, distance };
    }
    if (!closest) return { hit: false, distance: maxDistance, obstacleId: null, point: null };
    return {
      hit: true,
      distance: closest.distance,
      obstacleId: closest.obstacleId,
      point: {
        x: from.x + direction.x * closest.distance,
        y: from.y + direction.y * closest.distance,
        z: from.z + direction.z * closest.distance,
      },
    };
  }

  isMovementBlocked(position: Vec3V3, radius: number): boolean {
    const query = { center: position, radius };
    for (const obstacle of this.#obstacles.values()) {
      if (obstacle.blocksMovement && intersectsCircle(obstacle.bounds, query)) return true;
    }
    return false;
  }

  invalidateHeightCache(): void { this.#heightCache.clear(); }

  metrics(): WorldQueryMetricsV3 { return { ...this.#metrics }; }

  clear(): void {
    this.#entities.clear();
    this.#obstacles.clear();
    this.#heightCache.clear();
  }
}
