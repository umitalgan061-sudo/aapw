import {
  StreamRegion,
  StreamTier,
  Vec3,
  clamp,
  stableHash,
} from './kernelTypes.ts';

export interface StreamPolicy {
  readonly cellSize: number;
  readonly criticalRadius: number;
  readonly nearRadius: number;
  readonly midRadius: number;
  readonly farRadius: number;
  readonly predictionSeconds: number;
  readonly maxDesiredRegions: number;
  readonly maxLoadsPerFrame: number;
  readonly maxUnloadsPerFrame: number;
  readonly maxResidentBytes: number;
  readonly hysteresisCells: number;
  readonly bytesPerTier: Readonly<Record<Exclude<StreamTier, 'dormant'>, number>>;
}

export const DEFAULT_STREAM_POLICY: StreamPolicy = Object.freeze({
  cellSize: 256,
  criticalRadius: 1.25,
  nearRadius: 2.5,
  midRadius: 4.5,
  farRadius: 7,
  predictionSeconds: 0.65,
  maxDesiredRegions: 160,
  maxLoadsPerFrame: 8,
  maxUnloadsPerFrame: 6,
  maxResidentBytes: 768 * 1024 * 1024,
  hysteresisCells: 0.75,
  bytesPerTier: Object.freeze({
    critical: 8 * 1024 * 1024,
    near: 5 * 1024 * 1024,
    mid: 3 * 1024 * 1024,
    far: 1 * 1024 * 1024,
  }),
});

export interface StreamPlan {
  readonly desired: readonly StreamRegion[];
  readonly loads: readonly StreamRegion[];
  readonly unloads: readonly string[];
  readonly predictedCenter: Vec3;
  readonly residentBytes: number;
  readonly digest: string;
}

interface RecordState {
  readonly region: StreamRegion;
  readonly state: 'resident' | 'loading' | 'failed';
  readonly residentBytes: number;
  readonly lastTouchedTick: number;
}

const tierForDistance = (distance: number, policy: StreamPolicy): StreamTier =>
  distance <= policy.criticalRadius ? 'critical'
    : distance <= policy.nearRadius ? 'near'
    : distance <= policy.midRadius ? 'mid'
    : distance <= policy.farRadius ? 'far'
    : 'dormant';

const priorityFor = (tier: Exclude<StreamTier, 'dormant'>, distance: number): number =>
  (tier === 'critical' ? 1000 : tier === 'near' ? 650 : tier === 'mid' ? 320 : 120) - distance * 10;

export const buildRegions = (
  center: Vec3,
  velocity: Vec3,
  policy: StreamPolicy = DEFAULT_STREAM_POLICY,
): readonly StreamRegion[] => {
  const predicted = {
    x: center.x + velocity.x * policy.predictionSeconds,
    y: center.y,
    z: center.z + velocity.z * policy.predictionSeconds,
  };
  const cx = Math.floor(predicted.x / policy.cellSize);
  const cz = Math.floor(predicted.z / policy.cellSize);
  const max = Math.ceil(policy.farRadius);
  const regions: StreamRegion[] = [];

  for (let x = cx - max; x <= cx + max; x += 1) {
    for (let z = cz - max; z <= cz + max; z += 1) {
      const dx = x - cx;
      const dz = z - cz;
      const distance = Math.hypot(dx, dz);
      const tier = tierForDistance(distance, policy);
      if (tier === 'dormant') continue;
      const estimatedBytes = policy.bytesPerTier[tier];
      regions.push(Object.freeze({
        key: x + ':' + z,
        x,
        z,
        distance,
        tier,
        priority: priorityFor(tier, distance),
        estimatedBytes,
      }));
    }
  }

  return Object.freeze(
    regions
      .sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key))
      .slice(0, policy.maxDesiredRegions),
  );
};

export class WorldStreamDirector {
  readonly policy: StreamPolicy;
  #records = new Map<string, RecordState>();
  #residentBytes = 0;
  #inflight = 0;
  #disposed = false;

  constructor(policy: StreamPolicy = DEFAULT_STREAM_POLICY) {
    this.policy = Object.freeze({ ...policy, bytesPerTier: Object.freeze({ ...policy.bytesPerTier }) });
  }

  plan(center: Vec3, velocity: Vec3, tick: number): StreamPlan {
    if (this.#disposed) {
      return Object.freeze({
        desired: [],
        loads: [],
        unloads: [],
        predictedCenter: center,
        residentBytes: 0,
        digest: stableHash({ disposed: true }),
      });
    }

    const predictedCenter = Object.freeze({
      x: center.x + velocity.x * this.policy.predictionSeconds,
      y: center.y,
      z: center.z + velocity.z * this.policy.predictionSeconds,
    });
    const desired = buildRegions(center, velocity, this.policy);
    const desiredKeys = new Set(desired.map((region) => region.key));
    const resident = [...this.#records.values()].filter((record) => record.state === 'resident');
    const loading = [...this.#records.values()].filter((record) => record.state === 'loading');

    const loads = desired
      .filter((region) => {
        const current = this.#records.get(region.key);
        return !current || current.state === 'failed';
      })
      .slice(0, Math.max(0, this.policy.maxLoadsPerFrame - this.#inflight));

    const unloadCandidates = resident
      .filter((record) => !desiredKeys.has(record.region.key))
      .filter((record) => tick - record.lastTouchedTick >= 30)
      .sort((a, b) => a.region.priority - b.region.priority || a.region.key.localeCompare(b.region.key))
      .slice(0, this.policy.maxUnloadsPerFrame)
      .map((record) => record.region.key);

    void loading;

    return Object.freeze({
      desired,
      loads: Object.freeze(loads),
      unloads: Object.freeze(unloadCandidates),
      predictedCenter,
      residentBytes: this.#residentBytes,
      digest: stableHash({
        desired: desired.map((r) => r.key),
        loads: loads.map((r) => r.key),
        unloads: unloadCandidates,
        residentBytes: this.#residentBytes,
      }),
    });
  }

  begin(region: StreamRegion, tick: number): boolean {
    if (this.#disposed) return false;
    const existing = this.#records.get(region.key);
    if (existing && (existing.state === 'resident' || existing.state === 'loading')) return false;
    if (this.#inflight >= this.policy.maxLoadsPerFrame) return false;
    this.#inflight += 1;
    this.#records.set(region.key, Object.freeze({
      region,
      state: 'loading',
      residentBytes: 0,
      lastTouchedTick: tick,
    }));
    return true;
  }

  complete(key: string, residentBytes: number, tick: number): boolean {
    const record = this.#records.get(key);
    if (!record || record.state !== 'loading') return false;
    this.#inflight = Math.max(0, this.#inflight - 1);
    const bytes = Math.max(0, Math.floor(residentBytes));
    while (this.#residentBytes + bytes > this.policy.maxResidentBytes) {
      const victim = [...this.#records.values()]
        .filter((candidate) => candidate.state === 'resident' && candidate.region.key !== key)
        .sort((a, b) => a.region.priority - b.region.priority || a.region.key.localeCompare(b.region.key))[0];
      if (!victim) break;
      this.unload(victim.region.key);
    }
    if (this.#residentBytes + bytes > this.policy.maxResidentBytes) {
      this.#records.set(key, Object.freeze({ ...record, state: 'failed', lastTouchedTick: tick }));
      return false;
    }
    this.#residentBytes += bytes;
    this.#records.set(key, Object.freeze({
      ...record,
      state: 'resident',
      residentBytes: bytes,
      lastTouchedTick: tick,
    }));
    return true;
  }

  touch(key: string, tick: number): boolean {
    const record = this.#records.get(key);
    if (!record) return false;
    this.#records.set(key, Object.freeze({ ...record, lastTouchedTick: tick }));
    return true;
  }

  unload(key: string): boolean {
    const record = this.#records.get(key);
    if (!record) return false;
    this.#residentBytes = Math.max(0, this.#residentBytes - record.residentBytes);
    this.#records.delete(key);
    return true;
  }

  record(key: string): RecordState | null { return this.#records.get(key) ?? null; }
  records(): readonly RecordState[] { return Object.freeze([...this.#records.values()].sort((a, b) => a.region.key.localeCompare(b.region.key))); }

  diagnostics() {
    return Object.freeze({
      residentBytes: this.#residentBytes,
      inflight: this.#inflight,
      residentRegions: this.records().filter((record) => record.state === 'resident').length,
      loadingRegions: this.records().filter((record) => record.state === 'loading').length,
      failedRegions: this.records().filter((record) => record.state === 'failed').length,
      digest: stableHash(this.records().map((record) => ({
        key: record.region.key,
        state: record.state,
        bytes: record.residentBytes,
      }))),
    });
  }

  dispose(): void {
    this.#disposed = true;
    this.#records.clear();
    this.#residentBytes = 0;
    this.#inflight = 0;
  }
}

export const streamTierWeight = (tier: StreamTier): number =>
  tier === 'critical' ? 4 : tier === 'near' ? 3 : tier === 'mid' ? 2 : tier === 'far' ? 1 : 0;
