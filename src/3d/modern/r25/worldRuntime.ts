import type {
  Vec2,
  WorldInterest,
  WorldPlan,
  WorldRuntimeSnapshot,
  WorldZoneDescriptor,
  WorldZoneRecord,
  ZoneId,
  ZoneState,
} from './contracts.ts';
import { distance2D, predictPosition } from './contracts.ts';

interface MutableZoneRecord extends WorldZoneRecord {
  state: ZoneState;
  distanceMeters: number;
  score: number;
  lastTouchedFrame: number;
  failure: string | null;
}

export interface WorldRuntimeOptions {
  readonly maxResidentBytes: number;
  readonly unloadHysteresisMeters?: number;
  readonly predictionWeight?: number;
  readonly distanceWeight?: number;
  readonly priorityWeight?: number;
  readonly pressureWeight?: number;
}

function freeze<T>(value: T): T {
  return Object.freeze(value);
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeZone(id: string): ZoneId {
  const value = id.trim();
  if (!value) throw new Error('R25_ZONE_ID_EMPTY');
  return value as ZoneId;
}

export class WorldRuntimeR25 {
  readonly #zones = new Map<ZoneId, MutableZoneRecord>();
  readonly #maxResidentBytes: number;
  readonly #hysteresis: number;
  readonly #predictionWeight: number;
  readonly #distanceWeight: number;
  readonly #priorityWeight: number;
  readonly #pressureWeight: number;
  #frame = 0;
  #residentBytes = 0;
  #revision = 0;
  #disposed = false;

  public constructor(options: WorldRuntimeOptions) {
    this.#maxResidentBytes = Math.max(1024, Math.trunc(options.maxResidentBytes));
    this.#hysteresis = Math.max(0, finite(options.unloadHysteresisMeters, 120));
    this.#predictionWeight = Math.max(0, finite(options.predictionWeight, 1.25));
    this.#distanceWeight = Math.max(0, finite(options.distanceWeight, 0.01));
    this.#priorityWeight = Math.max(0, finite(options.priorityWeight, 1));
    this.#pressureWeight = Math.max(0, finite(options.pressureWeight, 2));
  }

  public get frame(): number {
    return this.#frame;
  }

  public get residentBytes(): number {
    return this.#residentBytes;
  }

  public register(zone: WorldZoneDescriptor): void {
    this.#assertLive();
    const id = normalizeZone(String(zone.id));
    if (this.#zones.has(id)) throw new Error(`R25_DUPLICATE_ZONE:${id}`);
    if (zone.radiusMeters <= 0) throw new Error(`R25_ZONE_RADIUS:${id}`);
    if (zone.memoryBytes < 0) throw new Error(`R25_ZONE_MEMORY:${id}`);
    this.#zones.set(id, {
      ...freeze(zone),
      id,
      state: 'absent',
      distanceMeters: Number.POSITIVE_INFINITY,
      score: 0,
      lastTouchedFrame: 0,
      failure: null,
    });
    this.#revision += 1;
  }

  public registerMany(zones: readonly WorldZoneDescriptor[]): void {
    for (const zone of zones) this.register(zone);
  }

  public remove(id: ZoneId): boolean {
    const key = normalizeZone(String(id));
    const record = this.#zones.get(key);
    if (!record || record.critical || record.state === 'loading') return false;

    this.#residentBytes = record.state === 'ready'
      ? Math.max(0, this.#residentBytes - record.memoryBytes)
      : this.#residentBytes;

    const removed = this.#zones.delete(key);
    if (removed) this.#revision += 1;
    return removed;
  }

  public touch(id: ZoneId, frame = this.#frame): boolean {
    const record = this.#zones.get(normalizeZone(String(id)));
    if (!record) return false;
    record.lastTouchedFrame = Math.max(0, Math.trunc(frame));
    return true;
  }

  public plan(interest: WorldInterest, frame = this.#frame + 1): WorldPlan {
    this.#assertLive();
    this.#frame = Math.max(this.#frame, Math.trunc(frame));
    const safeInterest = this.#normalizeInterest(interest);
    const prediction = predictPosition(
      safeInterest.position,
      safeInterest.velocity,
      safeInterest.horizonSeconds,
    );

    const predicted: ZoneId[] = [];
    const candidates: Array<{ record: MutableZoneRecord; distance: number; score: number }> = [];

    for (const record of this.#zones.values()) {
      const distance = distance2D(record.center, safeInterest.position);
      const predictedDistance = distance2D(record.center, prediction);
      const influenceDistance = Math.min(distance, predictedDistance);
      const inCurrentRadius = distance <= record.radiusMeters + safeInterest.prefetchRadiusMeters;
      const inPredictedRadius = predictedDistance <= record.radiusMeters + safeInterest.prefetchRadiusMeters;

      if (inPredictedRadius) predicted.push(record.id);

      const priority = Math.max(0, record.priority);
      const distanceScore = 1 / (1 + influenceDistance * this.#distanceWeight);
      const predictionScore = inPredictedRadius ? this.#predictionWeight : 0;
      const priorityScore = Math.min(10, priority) * this.#priorityWeight;
      const pressurePenalty = this.#pressure() * this.#pressureWeight;

      const score = safeInterest.importance * 2 +
        priorityScore +
        predictionScore +
        distanceScore -
        pressurePenalty;

      record.distanceMeters = Number(influenceDistance.toFixed(3));
      record.score = Number(score.toFixed(5));
      candidates.push({ record, distance: influenceDistance, score });

      if (inCurrentRadius || inPredictedRadius) {
        if (record.state === 'absent' || record.state === 'degraded') {
          record.lastTouchedFrame = this.#frame;
        }
      }
    }

    candidates.sort((a, b) => {
      if (a.record.critical !== b.record.critical) return a.record.critical ? -1 : 1;
      if (a.score !== b.score) return b.score - a.score;
      if (a.distance !== b.distance) return a.distance - b.distance;
      return a.record.id.localeCompare(b.record.id);
    });

    const keep = new Set<ZoneId>();
    const load: ZoneId[] = [];
    const unload: ZoneId[] = [];
    const blockedUnload: ZoneId[] = [];

    let projectedBytes = this.#residentBytes;

    for (const candidate of candidates) {
      const { record, distance } = candidate;
      const needed =
        distance <= record.radiusMeters + safeInterest.prefetchRadiusMeters ||
        predicted.includes(record.id);

      if (needed) {
        keep.add(record.id);
        if ((record.state === 'absent' || record.state === 'degraded') &&
            projectedBytes + record.memoryBytes <= this.#maxResidentBytes) {
          load.push(record.id);
          projectedBytes += record.memoryBytes;
        }
        continue;
      }

      if (record.critical) {
        blockedUnload.push(record.id);
        keep.add(record.id);
        continue;
      }

      const threshold = record.radiusMeters + this.#hysteresis;
      if (distance <= threshold) {
        keep.add(record.id);
      } else if (record.state === 'ready') {
        unload.push(record.id);
        projectedBytes = Math.max(0, projectedBytes - record.memoryBytes);
      }
    }

    return freeze({
      frame: this.#frame,
      load: freeze([...new Set(load)].sort()),
      keep: freeze([...new Set(keep)].sort()),
      unload: freeze([...new Set(unload)].sort()),
      predicted: freeze([...new Set(predicted)].sort()),
      blockedUnload: freeze([...new Set(blockedUnload)].sort()),
      residentBytes: this.#residentBytes,
      pressure: this.#pressure(),
    });
  }

  public beginLoad(id: ZoneId): boolean {
    const record = this.#zones.get(normalizeZone(String(id)));
    if (!record) return false;
    if (record.state === 'ready' || record.state === 'loading') return true;
    record.state = 'loading';
    record.failure = null;
    this.#revision += 1;
    return true;
  }

  public completeLoad(id: ZoneId): boolean {
    const record = this.#zones.get(normalizeZone(String(id)));
    if (!record) return false;

    if (record.state !== 'ready') {
      if (this.#residentBytes + record.memoryBytes > this.#maxResidentBytes) {
        record.state = 'degraded';
        record.failure = 'R25_WORLD_MEMORY_BUDGET';
        return false;
      }
      this.#residentBytes += record.memoryBytes;
    }

    record.state = 'ready';
    record.failure = null;
    record.lastTouchedFrame = this.#frame;
    this.#revision += 1;
    return true;
  }

  public failLoad(id: ZoneId, reason: string): boolean {
    const record = this.#zones.get(normalizeZone(String(id)));
    if (!record) return false;
    if (record.state === 'ready') {
      this.#residentBytes = Math.max(0, this.#residentBytes - record.memoryBytes);
    }
    record.state = 'degraded';
    record.failure = reason.trim().slice(0, 256) || 'unknown';
    this.#revision += 1;
    return true;
  }

  public unload(id: ZoneId): boolean {
    const record = this.#zones.get(normalizeZone(String(id)));
    if (!record || record.critical) return false;

    if (record.state === 'ready') {
      this.#residentBytes = Math.max(0, this.#residentBytes - record.memoryBytes);
    }

    record.state = 'unloading';
    record.failure = null;
    record.state = 'absent';
    record.lastTouchedFrame = this.#frame;
    this.#revision += 1;
    return true;
  }

  public unloadMany(ids: readonly ZoneId[]): readonly ZoneId[] {
    const removed: ZoneId[] = [];
    for (const id of ids) {
      if (this.unload(id)) removed.push(id);
    }
    return freeze(removed);
  }

  public snapshot(): WorldRuntimeSnapshot {
    const zones = [...this.#zones.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((record) => freeze({
        ...record,
        dependencies: freeze([...record.dependencies]),
        tags: freeze([...record.tags]),
      }));

    return freeze({
      frame: this.#frame,
      residentBytes: this.#residentBytes,
      maxResidentBytes: this.#maxResidentBytes,
      pressure: this.#pressure(),
      zones: freeze(zones),
    });
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#zones.clear();
    this.#residentBytes = 0;
  }

  #normalizeInterest(interest: WorldInterest): WorldInterest {
    return freeze({
      position: {
        x: finite(interest.position.x, 0),
        y: finite(interest.position.y, 0),
      },
      velocity: {
        x: finite(interest.velocity.x, 0),
        y: finite(interest.velocity.y, 0),
      },
      horizonSeconds: clamp(finite(interest.horizonSeconds, 2), 0, 30),
      prefetchRadiusMeters: clamp(finite(interest.prefetchRadiusMeters, 100), 0, 5000),
      importance: clamp(finite(interest.importance, 1), 0, 10),
    });
  }

  #pressure(): number {
    return clamp(this.#residentBytes / Math.max(1, this.#maxResidentBytes), 0, 2);
  }

  #assertLive(): void {
    if (this.#disposed) throw new Error('R25_WORLD_RUNTIME_DISPOSED');
  }
}

export function createZone(
  id: string,
  options: Omit<WorldZoneDescriptor, 'id'>,
): WorldZoneDescriptor {
  return freeze({
    ...options,
    id: normalizeZone(id),
    center: freeze({
      x: finite(options.center.x, 0),
      y: finite(options.center.y, 0),
    }),
    radiusMeters: Math.max(1, finite(options.radiusMeters, 100)),
    memoryBytes: Math.max(0, Math.trunc(finite(options.memoryBytes, 0))),
    loadCostMs: Math.max(0, finite(options.loadCostMs, 0)),
    priority: finite(options.priority, 0),
    critical: options.critical === true,
    dependencies: freeze([...new Set(options.dependencies)]),
    tags: freeze([...new Set(options.tags)]),
  });
}

export function buildRadialZones(
  count: number,
  spacingMeters: number,
  prefix = 'zone',
): readonly WorldZoneDescriptor[] {
  const result: WorldZoneDescriptor[] = [];
  const total = Math.max(0, Math.trunc(count));
  for (let index = 0; index < total; index += 1) {
    const angle = index * Math.PI * (3 - Math.sqrt(5));
    const radius = Math.sqrt(index + 1) * spacingMeters;
    result.push(createZone(`${prefix}-${index.toString().padStart(4, '0')}`, {
      center: freeze({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      }),
      radiusMeters: spacingMeters * 0.85,
      memoryBytes: 1_000_000 + (index % 7) * 125_000,
      loadCostMs: 0.5 + (index % 5) * 0.25,
      priority: index === 0 ? 10 : 5 - (index % 5),
      critical: index === 0,
      dependencies: index > 0 ? [`${prefix}-0000` as ZoneId] : [],
      tags: index % 2 === 0 ? ['landscape', 'terrain'] : ['settlement', 'props'],
    }));
  }
  return freeze(result);
}

export function worldInterest(
  x: number,
  z: number,
  options: Partial<Omit<WorldInterest, 'position'>> = {},
): WorldInterest {
  return freeze({
    position: freeze({ x: finite(x, 0), y: finite(z, 0) }),
    velocity: freeze({
      x: finite(options.velocity?.x, 0),
      y: finite(options.velocity?.y, 0),
    }),
    horizonSeconds: clamp(finite(options.horizonSeconds, 2), 0, 30),
    prefetchRadiusMeters: clamp(finite(options.prefetchRadiusMeters, 100), 0, 5000),
    importance: clamp(finite(options.importance, 1), 0, 10),
  });
}
