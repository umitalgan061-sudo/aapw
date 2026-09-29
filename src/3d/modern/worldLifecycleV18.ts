/**
 * AAPW World Lifecycle V18.
 *
 * Deterministic world-zone residency controller. It converts camera/player interest
 * into bounded load/keep/unload plans and protects critical zones from accidental eviction.
 */

export type WorldZoneKindV18 = 'terrain' | 'settlement' | 'quest' | 'wildlife' | 'water' | 'system';
export type WorldZoneStateV18 = 'absent' | 'planned' | 'loading' | 'ready' | 'degraded' | 'unloading';

export interface WorldZoneDescriptorV18 {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly radiusMeters: number;
  readonly kind: WorldZoneKindV18;
  readonly priority: number;
  readonly memoryBytes: number;
  readonly critical?: boolean;
  readonly dependencies?: readonly string[];
  readonly tags?: readonly string[];
}

export interface WorldInterestV18 {
  readonly x: number;
  readonly z: number;
  readonly velocityX?: number;
  readonly velocityZ?: number;
  readonly horizonSeconds?: number;
  readonly prefetchRadiusMeters?: number;
}

export interface WorldPlanV18 {
  readonly frame: number;
  readonly load: readonly string[];
  readonly keep: readonly string[];
  readonly unload: readonly string[];
  readonly blockedUnload: readonly string[];
  readonly predicted: readonly string[];
  readonly residentBytes: number;
  readonly pressure: number;
}

export interface WorldZoneSnapshotV18 extends WorldZoneDescriptorV18 {
  readonly state: WorldZoneStateV18;
  readonly lastTouchedFrame: number;
  readonly distanceMeters: number;
  readonly score: number;
  readonly failure: string | null;
}

export interface WorldLifecycleSnapshotV18 {
  readonly frame: number;
  readonly revision: number;
  readonly residentBytes: number;
  readonly maxResidentBytes: number;
  readonly pressure: number;
  readonly zones: readonly WorldZoneSnapshotV18[];
}

export interface WorldLifecycleOptionsV18 {
  readonly maxResidentBytes?: number;
  readonly unloadHysteresisMeters?: number;
  readonly loadConcurrency?: number;
  readonly clock?: () => number;
}

interface ZoneRecordV18 {
  descriptor: WorldZoneDescriptorV18;
  state: WorldZoneStateV18;
  lastTouchedFrame: number;
  distanceMeters: number;
  score: number;
  failure: string | null;
  revision: number;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function norm(value: string): string {
  return value.trim().toLowerCase().replace(/\\s+/g, '-');
}

function dist(x1: number, z1: number, x2: number, z2: number): number {
  return Math.hypot(x1 - x2, z1 - z2);
}

function freeze<T>(value: T): T {
  return Object.freeze(value);
}

const KIND_WEIGHT_V18: Readonly<Record<WorldZoneKindV18, number>> = {
  system: 100,
  settlement: 80,
  quest: 75,
  terrain: 60,
  wildlife: 40,
  water: 30,
};

export class WorldLifecycleV18 {
  readonly #zones = new Map<string, ZoneRecordV18>();
  readonly #clock: () => number;
  readonly #maxResidentBytes: number;
  readonly #unloadHysteresisMeters: number;
  readonly #loadConcurrency: number;

  #frame = 0;
  #revision = 0;
  #residentBytes = 0;
  #loading = new Set<string>();

  public constructor(options: WorldLifecycleOptionsV18 = {}) {
    this.#clock = options.clock ?? (() => performance.now());
    this.#maxResidentBytes = Math.max(
      16 * 1024 * 1024,
      Math.trunc(clamp(options.maxResidentBytes ?? 512 * 1024 * 1024, 1, 16 * 1024 ** 3)),
    );
    this.#unloadHysteresisMeters = Math.max(0, clamp(options.unloadHysteresisMeters ?? 250, 0, 10000));
    this.#loadConcurrency = Math.max(1, Math.min(16, Math.trunc(options.loadConcurrency ?? 4)));
  }

  public register(zone: WorldZoneDescriptorV18): WorldZoneSnapshotV18 {
    const id = norm(zone.id);
    if (!id) throw new TypeError('World zone id is required.');
    if (!Number.isFinite(zone.x) || !Number.isFinite(zone.z)) {
      throw new TypeError(`World zone coordinates must be finite: ${id}`);
    }
    if (zone.radiusMeters <= 0 || !Number.isFinite(zone.radiusMeters)) {
      throw new RangeError(`World zone radius must be positive: ${id}`);
    }
    if (zone.memoryBytes < 0 || !Number.isFinite(zone.memoryBytes)) {
      throw new RangeError(`World zone memory must be non-negative: ${id}`);
    }

    const descriptor = freeze({
      ...zone,
      id,
      radiusMeters: Math.max(1, zone.radiusMeters),
      priority: clamp(zone.priority, -1000, 1000),
      memoryBytes: Math.max(0, Math.trunc(zone.memoryBytes)),
      critical: zone.critical ?? false,
      dependencies: freeze([...(zone.dependencies ?? [])].map(norm).filter(Boolean)),
      tags: freeze([...(zone.tags ?? [])].map((tag) => tag.trim()).filter(Boolean).slice(0, 12)),
    });

    const existing = this.#zones.get(id);
    const record: ZoneRecordV18 = {
      descriptor,
      state: existing?.state ?? 'absent',
      lastTouchedFrame: existing?.lastTouchedFrame ?? this.#frame,
      distanceMeters: existing?.distanceMeters ?? Number.POSITIVE_INFINITY,
      score: existing?.score ?? 0,
      failure: existing?.failure ?? null,
      revision: ++this.#revision,
    };

    this.#zones.set(id, record);
    return this.#snapshotZone(record);
  }

  public registerGrid(
    prefix: string,
    columns: number,
    rows: number,
    sizeMeters: number,
    kind: WorldZoneKindV18 = 'terrain',
    memoryBytes = 2 * 1024 * 1024,
  ): readonly WorldZoneSnapshotV18[] {
    const result: WorldZoneSnapshotV18[] = [];
    for (let z = 0; z < rows; z += 1) {
      for (let x = 0; x < columns; x += 1) {
        result.push(
          this.register({
            id: `${prefix}-${x}-${z}`,
            x: x * sizeMeters,
            z: z * sizeMeters,
            radiusMeters: sizeMeters * 0.75,
            kind,
            priority: 0,
            memoryBytes,
          }),
        );
      }
    }
    return freeze(result);
  }

  public setState(id: string, state: WorldZoneStateV18, failure: string | null = null): boolean {
    const record = this.#zones.get(norm(id));
    if (!record) return false;

    if (record.state === state && record.failure === failure) return true;

    const beforeResident = record.state === 'ready';
    const afterResident = state === 'ready';

    if (beforeResident && !afterResident) {
      this.#residentBytes = Math.max(0, this.#residentBytes - record.descriptor.memoryBytes);
    }
    if (!beforeResident && afterResident) {
      this.#residentBytes += record.descriptor.memoryBytes;
    }

    record.state = state;
    record.failure = failure;
    record.revision = ++this.#revision;

    if (state === 'loading') this.#loading.add(record.descriptor.id);
    else this.#loading.delete(record.descriptor.id);

    return true;
  }

  public touch(id: string, interest: WorldInterestV18): boolean {
    const record = this.#zones.get(norm(id));
    if (!record) return false;

    record.distanceMeters = dist(
      record.descriptor.x,
      record.descriptor.z,
      interest.x,
      interest.z,
    );

    const velocity =
      Math.hypot(interest.velocityX ?? 0, interest.velocityZ ?? 0) *
      Math.max(0, interest.horizonSeconds ?? 0);

    const radius = record.descriptor.radiusMeters +
      Math.max(0, interest.prefetchRadiusMeters ?? 0) +
      velocity;

    const proximity = clamp(1 - record.distanceMeters / Math.max(1, radius), 0, 1);
    const kind = KIND_WEIGHT_V18[record.descriptor.kind];
    const priority = clamp((record.descriptor.priority + 1000) / 2000, 0, 1);
    record.score = proximity * 700 + kind + priority * 100 + (record.descriptor.critical ? 10000 : 0);
    record.lastTouchedFrame = this.#frame;
    record.revision = ++this.#revision;
    return true;
  }

  public plan(
    interest: WorldInterestV18,
    frame = this.#frame + 1,
  ): WorldPlanV18 {
    this.#frame = Math.max(this.#frame, Math.trunc(frame));

    for (const id of this.#zones.keys()) {
      this.touch(id, interest);
    }

    const all = [...this.#zones.values()]
      .sort((a, b) => b.score - a.score || a.descriptor.id.localeCompare(b.descriptor.id));

    const resident = all.filter((record) => record.state === 'ready');
    const keep: string[] = [];
    const predicted: string[] = [];
    const load: string[] = [];
    const unload: string[] = [];
    const blockedUnload: string[] = [];

    const predictedDistance =
      Math.hypot(interest.velocityX ?? 0, interest.velocityZ ?? 0) *
      Math.max(0, interest.horizonSeconds ?? 0);

    for (const record of all) {
      const nearEnough =
        record.distanceMeters <=
        record.descriptor.radiusMeters +
        Math.max(0, interest.prefetchRadiusMeters ?? 0) +
        predictedDistance;

      if (nearEnough) predicted.push(record.descriptor.id);
    }

    const protectedIds = new Set(predicted);

    for (const record of all) {
      if (
        record.state === 'ready' &&
        protectedIds.has(record.descriptor.id)
      ) {
        keep.push(record.descriptor.id);
      }

      if (
        (record.state === 'absent' || record.state === 'degraded') &&
        protectedIds.has(record.descriptor.id) &&
        (this.#loading.size + load.length) < this.#loadConcurrency
      ) {
        if (this.#dependenciesReady(record)) {
          load.push(record.descriptor.id);
        }
      }
    }

    const projectedBytes = keep.reduce(
      (sum, id) => sum + (this.#zones.get(id)?.descriptor.memoryBytes ?? 0),
      0,
    );

    if (projectedBytes > this.#maxResidentBytes) {
      const overflow = [...this.#zones.values()]
        .filter((record) => record.state === 'ready' && !record.descriptor.critical)
        .sort((a, b) => a.score - b.score);

      let remaining = projectedBytes;
      for (const record of overflow) {
        if (remaining <= this.#maxResidentBytes) break;
        keep.splice(keep.indexOf(record.descriptor.id), 1);
        unload.push(record.descriptor.id);
        remaining -= record.descriptor.memoryBytes;
      }
    }

    for (const record of resident) {
      if (keep.includes(record.descriptor.id)) continue;
      if (record.descriptor.critical) {
        blockedUnload.push(record.descriptor.id);
        continue;
      }

      const threshold = record.descriptor.radiusMeters + this.#unloadHysteresisMeters;
      if (record.distanceMeters > threshold) {
        unload.push(record.descriptor.id);
      } else {
        keep.push(record.descriptor.id);
      }
    }

    const residentBytes = [...new Set([...keep, ...blockedUnload])]
      .reduce((sum, id) => sum + (this.#zones.get(id)?.descriptor.memoryBytes ?? 0), 0);

    const pressure = clamp(
      residentBytes / Math.max(1, this.#maxResidentBytes),
      0,
      2,
    );

    return freeze({
      frame: this.#frame,
      load: freeze([...new Set(load)].sort()),
      keep: freeze([...new Set(keep)].sort()),
      unload: freeze([...new Set(unload)].sort()),
      blockedUnload: freeze([...new Set(blockedUnload)].sort()),
      predicted: freeze([...new Set(predicted)].sort()),
      residentBytes,
      pressure,
    });
  }

  public completeLoad(id: string): boolean {
    const key = norm(id);
    const record = this.#zones.get(key);
    if (!record) return false;

    const wasReady = record.state === 'ready';
    if (!wasReady) {
      this.#residentBytes += record.descriptor.memoryBytes;
    }

    record.state = 'ready';
    record.failure = null;
    this.#loading.delete(key);
    record.lastTouchedFrame = this.#frame;
    record.revision = ++this.#revision;
    return true;
  }

  public failLoad(id: string, reason: string): boolean {
    const record = this.#zones.get(norm(id));
    if (!record) return false;

    if (record.state === 'ready') {
      this.#residentBytes = Math.max(
        0,
        this.#residentBytes - record.descriptor.memoryBytes,
      );
    }

    record.state = 'degraded';
    record.failure = reason.trim().slice(0, 256) || 'unknown';
    this.#loading.delete(record.descriptor.id);
    record.revision = ++this.#revision;
    return true;
  }

  public unload(id: string): boolean {
    const record = this.#zones.get(norm(id));
    if (!record || record.descriptor.critical) return false;

    if (record.state === 'ready') {
      this.#residentBytes = Math.max(
        0,
        this.#residentBytes - record.descriptor.memoryBytes,
      );
    }

    record.state = 'unloading';
    record.failure = null;
    record.revision = ++this.#revision;
    record.state = 'absent';
    record.revision = ++this.#revision;
    return true;
  }

  public snapshot(): WorldLifecycleSnapshotV18 {
    const zones = [...this.#zones.values()]
      .sort((a, b) => a.descriptor.id.localeCompare(b.descriptor.id))
      .map((record) => this.#snapshotZone(record));

    return freeze({
      frame: this.#frame,
      revision: this.#revision,
      residentBytes: this.#residentBytes,
      maxResidentBytes: this.#maxResidentBytes,
      pressure: clamp(this.#residentBytes / Math.max(1, this.#maxResidentBytes), 0, 2),
      zones: freeze(zones),
    });
  }

  #dependenciesReady(record: ZoneRecordV18): boolean {
    return (record.descriptor.dependencies ?? []).every(
      (dependency) => this.#zones.get(dependency)?.state === 'ready',
    );
  }

  #snapshotZone(record: ZoneRecordV18): WorldZoneSnapshotV18 {
    return freeze({
      ...record.descriptor,
      state: record.state,
      lastTouchedFrame: record.lastTouchedFrame,
      distanceMeters: record.distanceMeters,
      score: record.score,
      failure: record.failure,
    });
  }

  public get nowMs(): number {
    return this.#clock();
  }
}