export interface Vec3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface SphereQuery {
  readonly center: Vec3Like;
  readonly radius: number;
}

export interface BoxQuery {
  readonly min: Vec3Like;
  readonly max: Vec3Like;
}

export interface RayQuery {
  readonly origin: Vec3Like;
  readonly direction: Vec3Like;
  readonly maxDistance: number;
}

export interface WorldBounds {
  readonly min: Vec3Like;
  readonly max: Vec3Like;
}

export interface SpatialRecord<T> {
  readonly id: number;
  readonly position: Vec3Like;
  readonly value: T;
  readonly layer: string;
  readonly radius: number;
}

export interface QueryHit<T> {
  readonly id: number;
  readonly value: T;
  readonly distance: number;
  readonly point: Vec3Like;
}

export interface QueryOptions {
  readonly layers?: readonly string[];
  readonly maxResults?: number;
  readonly includeBoundary?: boolean;
}

function finiteVector(value: Vec3Like): void {
  if (![value.x, value.y, value.z].every(Number.isFinite)) throw new RangeError('vector must be finite');
}

function distanceSquared(a: Vec3Like, b: Vec3Like): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

function normalize(direction: Vec3Like): Vec3Like {
  finiteVector(direction);
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (length <= Number.EPSILON) throw new RangeError('direction must be non-zero');
  return { x: direction.x / length, y: direction.y / length, z: direction.z / length };
}

export class WorldQueryRuntime<T> {
  readonly #cellSize: number;
  readonly #cells = new Map<string, Set<number>>();
  readonly #records = new Map<number, SpatialRecord<T>>();
  #nextId = 1;

  public constructor(cellSize = 32) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) throw new RangeError('cellSize must be positive');
    this.#cellSize = cellSize;
  }

  public insert(value: T, position: Vec3Like, layer = 'default', radius = 0): number {
    finiteVector(position);
    if (!layer.trim()) throw new Error('layer must not be empty');
    if (!Number.isFinite(radius) || radius < 0) throw new RangeError('radius must be non-negative');
    const id = this.#nextId++;
    const record: SpatialRecord<T> = { id, value, position: { ...position }, layer, radius };
    this.#records.set(id, record);
    this.#cell(id, position).add(id);
    return id;
  }

  public update(id: number, position: Vec3Like, radius?: number, layer?: string): void {
    const record = this.#records.get(id);
    if (!record) throw new Error(`unknown spatial record ${id}`);
    finiteVector(position);
    const oldCell = this.#cellKey(record.position);
    const nextLayer = layer ?? record.layer;
    const nextRadius = radius ?? record.radius;
    if (!nextLayer.trim()) throw new Error('layer must not be empty');
    if (!Number.isFinite(nextRadius) || nextRadius < 0) throw new RangeError('radius must be non-negative');
    if (oldCell !== this.#cellKey(position)) this.#cells.get(oldCell)?.delete(id);
    const nextRecord = { ...record, position: { ...position }, layer: nextLayer, radius: nextRadius };
    this.#records.set(id, nextRecord);
    this.#cell(id, position).add(id);
  }

  public remove(id: number): boolean {
    const record = this.#records.get(id);
    if (!record) return false;
    this.#records.delete(id);
    this.#cells.get(this.#cellKey(record.position))?.delete(id);
    return true;
  }

  public get(id: number): SpatialRecord<T> | undefined {
    const record = this.#records.get(id);
    return record ? { ...record, position: { ...record.position } } : undefined;
  }

  public sphere(query: SphereQuery, options: QueryOptions = {}): readonly QueryHit<T>[] {
    finiteVector(query.center);
    if (!Number.isFinite(query.radius) || query.radius < 0) throw new RangeError('radius must be non-negative');
    const candidates = this.#candidatesForRadius(query.center, query.radius + this.#maxRecordRadius());
    const layerSet = options.layers ? new Set(options.layers) : undefined;
    const boundary = options.includeBoundary ?? true;
    const radiusSquared = query.radius * query.radius;
    return this.#sortAndLimit(candidates
      .filter((record) => !layerSet || layerSet.has(record.layer))
      .filter((record) => {
        const effectiveRadius = query.radius + record.radius;
        const d2 = distanceSquared(record.position, query.center);
        const limit = effectiveRadius * effectiveRadius;
        return boundary ? d2 <= limit : d2 < limit;
      })
      .map((record) => {
        const d2 = distanceSquared(record.position, query.center);
        return {
          id: record.id,
          value: record.value,
          distance: Math.max(0, Math.sqrt(d2) - record.radius),
          point: { ...record.position },
        };
      }), options.maxResults);
  }

  public box(query: BoxQuery, options: QueryOptions = {}): readonly QueryHit<T>[] {
    finiteVector(query.min);
    finiteVector(query.max);
    if (query.min.x > query.max.x || query.min.y > query.max.y || query.min.z > query.max.z) throw new RangeError('invalid box');
    const center = {
      x: (query.min.x + query.max.x) / 2,
      y: (query.min.y + query.max.y) / 2,
      z: (query.min.z + query.max.z) / 2,
    };
    const radius = Math.hypot(query.max.x - query.min.x, query.max.y - query.min.y, query.max.z - query.min.z) / 2;
    const layerSet = options.layers ? new Set(options.layers) : undefined;
    return this.#sortAndLimit([...this.#candidatesForRadius(center, radius + this.#maxRecordRadius())]
      .filter((record) => !layerSet || layerSet.has(record.layer))
      .filter((record) => intersectsBox(record.position, record.radius, query))
      .map((record) => ({
        id: record.id,
        value: record.value,
        distance: Math.sqrt(distanceSquared(record.position, center)),
        point: { ...record.position },
      })), options.maxResults);
  }

  public ray(query: RayQuery, options: QueryOptions = {}): readonly QueryHit<T>[] {
    finiteVector(query.origin);
    const direction = normalize(query.direction);
    if (!Number.isFinite(query.maxDistance) || query.maxDistance < 0) throw new RangeError('maxDistance must be non-negative');
    const end = {
      x: query.origin.x + direction.x * query.maxDistance,
      y: query.origin.y + direction.y * query.maxDistance,
      z: query.origin.z + direction.z * query.maxDistance,
    };
    const center = {
      x: (query.origin.x + end.x) / 2,
      y: (query.origin.y + end.y) / 2,
      z: (query.origin.z + end.z) / 2,
    };
    const broadRadius = query.maxDistance / 2 + this.#maxRecordRadius();
    const layerSet = options.layers ? new Set(options.layers) : undefined;
    return this.#sortAndLimit(this.#candidatesForRadius(center, broadRadius)
      .filter((record) => !layerSet || layerSet.has(record.layer))
      .map((record) => {
        const hit = raySphere(query.origin, direction, record.position, record.radius);
        if (!hit || hit > query.maxDistance) return undefined;
        return {
          id: record.id,
          value: record.value,
          distance: hit,
          point: {
            x: query.origin.x + direction.x * hit,
            y: query.origin.y + direction.y * hit,
            z: query.origin.z + direction.z * hit,
          },
        };
      }).filter((hit): hit is QueryHit<T> => hit !== undefined), options.maxResults);
  }

  public nearest(point: Vec3Like, maxDistance = Infinity, options: QueryOptions = {}): QueryHit<T> | undefined {
    const hits = this.sphere({ center: point, radius: maxDistance }, { ...options, maxResults: 1 });
    return hits[0];
  }

  public withinBounds(bounds: WorldBounds): readonly number[] {
    finiteVector(bounds.min);
    finiteVector(bounds.max);
    return [...this.#records.values()]
      .filter((record) => record.position.x >= bounds.min.x && record.position.x <= bounds.max.x &&
        record.position.y >= bounds.min.y && record.position.y <= bounds.max.y &&
        record.position.z >= bounds.min.z && record.position.z <= bounds.max.z)
      .map((record) => record.id)
      .sort((a, b) => a - b);
  }

  public clear(): void {
    this.#cells.clear();
    this.#records.clear();
  }

  public size(): number {
    return this.#records.size;
  }

  public cellSize(): number {
    return this.#cellSize;
  }

  public digest(): string {
    let hash = 2166136261 >>> 0;
    const records = [...this.#records.values()].sort((a, b) => a.id - b.id);
    for (const record of records) {
      const text = `${record.id}:${record.layer}:${record.position.x.toFixed(4)}:${record.position.y.toFixed(4)}:${record.position.z.toFixed(4)}:${record.radius.toFixed(4)}`;
      for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  }

  #cell(id: number, position: Vec3Like): Set<number> {
    const key = this.#cellKey(position);
    let set = this.#cells.get(key);
    if (!set) {
      set = new Set<number>();
      this.#cells.set(key, set);
    }
    set.add(id);
    return set;
  }

  #cellKey(position: Vec3Like): string {
    return `${Math.floor(position.x / this.#cellSize)}:${Math.floor(position.y / this.#cellSize)}:${Math.floor(position.z / this.#cellSize)}`;
  }

  #candidatesForRadius(center: Vec3Like, radius: number): SpatialRecord<T>[] {
    const minX = Math.floor((center.x - radius) / this.#cellSize);
    const maxX = Math.floor((center.x + radius) / this.#cellSize);
    const minY = Math.floor((center.y - radius) / this.#cellSize);
    const maxY = Math.floor((center.y + radius) / this.#cellSize);
    const minZ = Math.floor((center.z - radius) / this.#cellSize);
    const maxZ = Math.floor((center.z + radius) / this.#cellSize);
    const ids = new Set<number>();
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        for (let z = minZ; z <= maxZ; z += 1) {
          const set = this.#cells.get(`${x}:${y}:${z}`);
          if (set) for (const id of set) ids.add(id);
        }
      }
    }
    return [...ids].map((id) => this.#records.get(id)).filter((record): record is SpatialRecord<T> => record !== undefined);
  }

  #maxRecordRadius(): number {
    let maximum = 0;
    for (const record of this.#records.values()) maximum = Math.max(maximum, record.radius);
    return maximum;
  }

  #sortAndLimit(results: QueryHit<T>[], maxResults?: number): readonly QueryHit<T>[] {
    results.sort((a, b) => a.distance - b.distance || a.id - b.id);
    return results.slice(0, maxResults === undefined ? results.length : Math.max(0, maxResults));
  }
}

function intersectsBox(point: Vec3Like, radius: number, box: BoxQuery): boolean {
  const dx = Math.max(box.min.x - point.x, 0, point.x - box.max.x);
  const dy = Math.max(box.min.y - point.y, 0, point.y - box.max.y);
  const dz = Math.max(box.min.z - point.z, 0, point.z - box.max.z);
  return dx * dx + dy * dy + dz * dz <= radius * radius;
}

function raySphere(origin: Vec3Like, direction: Vec3Like, center: Vec3Like, radius: number): number | null {
  const ox = origin.x - center.x;
  const oy = origin.y - center.y;
  const oz = origin.z - center.z;
  const b = ox * direction.x + oy * direction.y + oz * direction.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const discriminant = b * b - c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const near = -b - root;
  const far = -b + root;
  if (near >= 0) return near;
  if (far >= 0) return far;
  return null;
}

export interface HeightSample {
  readonly height: number;
  readonly normal?: Vec3Like;
}

export type HeightSampler = (x: number, z: number) => HeightSample;

export interface GroundProjection {
  readonly input: Vec3Like;
  readonly output: Vec3Like;
  readonly verticalCorrection: number;
}

export function projectToGround(position: Vec3Like, sampler: HeightSampler, clearance = 0): GroundProjection {
  finiteVector(position);
  if (!Number.isFinite(clearance) || clearance < 0) throw new RangeError('clearance must be non-negative');
  const sample = sampler(position.x, position.z);
  if (!Number.isFinite(sample.height)) throw new Error('height sampler returned invalid height');
  const output = { x: position.x, y: sample.height + clearance, z: position.z };
  return { input: { ...position }, output, verticalCorrection: output.y - position.y };
}

export function withinWorldBounds(position: Vec3Like, bounds: WorldBounds, margin = 0): boolean {
  finiteVector(position);
  finiteVector(bounds.min);
  finiteVector(bounds.max);
  if (!Number.isFinite(margin) || margin < 0) throw new RangeError('margin must be non-negative');
  return position.x >= bounds.min.x - margin && position.x <= bounds.max.x + margin &&
    position.y >= bounds.min.y - margin && position.y <= bounds.max.y + margin &&
    position.z >= bounds.min.z - margin && position.z <= bounds.max.z + margin;
}
