import type { EntityId, PlatformError, Result } from './types';
import { checksum, quantize } from './deterministic';
import { Diagnostics } from './diagnostics';
import { SnapshotCodec, type NetworkEntityState, type SnapshotDelta, type WorldSnapshot } from './networkSnapshot';

export interface ReplicationPolicy {
  readonly snapshotIntervalTicks: number;
  readonly maxEntitiesPerSnapshot: number;
  readonly positionPrecision: number;
  readonly velocityPrecision: number;
  readonly maxPendingSnapshots: number;
  readonly maxDeltaEntities: number;
}

export interface ReplicationEnvelope {
  readonly protocol: 'aapw-replication';
  readonly version: 1;
  readonly tick: number;
  readonly baseTick: number | null;
  readonly snapshot: WorldSnapshot | null;
  readonly delta: SnapshotDelta | null;
  readonly digest: string;
}

export interface ReplicationStats {
  readonly snapshotsSent: number;
  readonly deltasSent: number;
  readonly entitiesReplicated: number;
  readonly droppedSnapshots: number;
  readonly pending: number;
  readonly digest: string;
}

const DEFAULT_POLICY: ReplicationPolicy = {
  snapshotIntervalTicks: 30,
  maxEntitiesPerSnapshot: 2_048,
  positionPrecision: 1_000,
  velocityPrecision: 1_000,
  maxPendingSnapshots: 16,
  maxDeltaEntities: 512,
};

function normalizeEntity(entity: NetworkEntityState, policy: ReplicationPolicy): NetworkEntityState {
  return {
    id: entity.id,
    position: {
      x: quantize(entity.position.x, 1 / policy.positionPrecision),
      y: quantize(entity.position.y, 1 / policy.positionPrecision),
      z: quantize(entity.position.z, 1 / policy.positionPrecision),
    },
    rotation: {
      x: quantize(entity.rotation.x, 1 / policy.positionPrecision),
      y: quantize(entity.rotation.y, 1 / policy.positionPrecision),
      z: quantize(entity.rotation.z, 1 / policy.positionPrecision),
      w: quantize(entity.rotation.w, 1 / policy.positionPrecision),
    },
    velocity: {
      x: quantize(entity.velocity.x, 1 / policy.velocityPrecision),
      y: quantize(entity.velocity.y, 1 / policy.velocityPrecision),
      z: quantize(entity.velocity.z, 1 / policy.velocityPrecision),
    },
    flags: entity.flags >>> 0,
  };
}

/**
 * Transport-neutral replication coordinator. It bounds entity counts and message pressure and
 * produces deterministic envelopes suitable for future WebSocket/WebTransport adapters.
 */
export class NetworkReplicationController {
  readonly policy: ReplicationPolicy;
  readonly codec: SnapshotCodec;
  readonly diagnostics: Diagnostics;
  #pending: WorldSnapshot[] = [];
  #snapshotsSent = 0;
  #deltasSent = 0;
  #entitiesReplicated = 0;
  #droppedSnapshots = 0;
  #lastSnapshotTick: number | null = null;

  constructor(options: { readonly policy?: Partial<ReplicationPolicy>; readonly codec?: SnapshotCodec; readonly diagnostics?: Diagnostics } = {}) {
    this.policy = Object.freeze({ ...DEFAULT_POLICY, ...options.policy });
    this.codec = options.codec ?? new SnapshotCodec(64);
    this.diagnostics = options.diagnostics ?? new Diagnostics();
    this.#validatePolicy();
  }

  capture(tick: number, entities: readonly NetworkEntityState[]): Result<WorldSnapshot> {
    if (!Number.isSafeInteger(tick) || tick < 0) return this.fail('REPLICATION_TICK_INVALID', 'Replication tick is invalid');
    const normalized = [...entities]
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, this.policy.maxEntitiesPerSnapshot)
      .map((entity) => normalizeEntity(entity, this.policy));
    if (entities.length > normalized.length) this.#droppedSnapshots += 1;
    const snapshot = this.codec.encode(tick, normalized, this.#lastSnapshotTick);
    this.#lastSnapshotTick = tick;
    this.#pending.push(snapshot);
    this.#entitiesReplicated += normalized.length;
    this.#trimPending();
    return { ok: true, value: snapshot };
  }

  shouldCapture(tick: number): boolean {
    if (!Number.isSafeInteger(tick) || tick < 0) return false;
    return this.#lastSnapshotTick === null || tick - this.#lastSnapshotTick >= this.policy.snapshotIntervalTicks;
  }

  nextEnvelope(): ReplicationEnvelope | null {
    const snapshot = this.#pending.shift();
    if (!snapshot) return null;
    const baseTick = snapshot.baseline === null ? null : Number(snapshot.baseline);
    let delta: SnapshotDelta | null = null;
    let fullSnapshot: WorldSnapshot | null = null;
    if (baseTick !== null) {
      const result = this.codec.delta(snapshot, baseTick);
      if (result.ok && result.value.changed.length <= this.policy.maxDeltaEntities) {
        delta = result.value;
        this.#deltasSent += 1;
      } else {
        fullSnapshot = snapshot;
        this.#snapshotsSent += 1;
      }
    } else {
      fullSnapshot = snapshot;
      this.#snapshotsSent += 1;
    }
    const digest = checksum({ tick: snapshot.tick, baseTick, snapshot: fullSnapshot, delta });
    return Object.freeze({ protocol: 'aapw-replication', version: 1, tick: snapshot.tick, baseTick, snapshot: fullSnapshot, delta, digest });
  }

  applyEnvelope(envelope: ReplicationEnvelope): Result<WorldSnapshot> {
    if (envelope.protocol !== 'aapw-replication' || envelope.version !== 1) return this.fail('REPLICATION_PROTOCOL_INVALID', 'Unsupported replication envelope');
    if (envelope.snapshot) {
      if (envelope.snapshot.digest !== checksum({ tick: envelope.snapshot.tick, entities: envelope.snapshot.entities })) return this.fail('REPLICATION_DIGEST_INVALID', 'Snapshot digest mismatch');
      this.codec.remember(envelope.snapshot);
      return { ok: true, value: envelope.snapshot };
    }
    if (!envelope.delta) return this.fail('REPLICATION_PAYLOAD_EMPTY', 'Replication envelope contains no snapshot or delta');
    const baseline = envelope.baseTick === null ? null : this.codec.get(envelope.baseTick);
    if (envelope.baseTick !== null && !baseline) return this.fail('REPLICATION_BASELINE_MISSING', `Missing replication baseline ${envelope.baseTick}`, true);
    if (!baseline) return this.fail('REPLICATION_BASELINE_REQUIRED', 'A delta requires a baseline', true);
    const byId = new Map(baseline.entities.map((entity) => [entity.id, entity]));
    for (const id of envelope.delta.removed) byId.delete(id);
    for (const entity of envelope.delta.changed) byId.set(entity.id, entity);
    const entities = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
    const snapshot = this.codec.encode(envelope.delta.tick, entities, envelope.baseTick);
    this.codec.remember(snapshot);
    return { ok: true, value: snapshot };
  }

  queueSize(): number { return this.#pending.length; }

  stats(): ReplicationStats {
    return Object.freeze({
      snapshotsSent: this.#snapshotsSent,
      deltasSent: this.#deltasSent,
      entitiesReplicated: this.#entitiesReplicated,
      droppedSnapshots: this.#droppedSnapshots,
      pending: this.#pending.length,
      digest: checksum({ snapshots: this.#snapshotsSent, deltas: this.#deltasSent, entities: this.#entitiesReplicated, dropped: this.#droppedSnapshots, pending: this.#pending.length }),
    });
  }

  clear(): void {
    this.#pending = [];
    this.#lastSnapshotTick = null;
    this.codec.clear();
  }

  #trimPending(): void {
    while (this.#pending.length > this.policy.maxPendingSnapshots) {
      this.#pending.shift();
      this.#droppedSnapshots += 1;
    }
  }

  fail(code: string, message: string, retryable = false): Result<never> {
    const error: PlatformError = { code, message, retryable };
    this.diagnostics.warning(code, message, 'replication');
    return { ok: false, error };
  }

  #validatePolicy(): void {
    if (this.policy.snapshotIntervalTicks < 1 || this.policy.maxEntitiesPerSnapshot < 1 || this.policy.maxPendingSnapshots < 1 || this.policy.maxDeltaEntities < 1) throw new RangeError('Invalid replication policy');
    if (this.policy.positionPrecision < 1 || this.policy.velocityPrecision < 1) throw new RangeError('Invalid replication precision');
  }
}

export function createNetworkReplicationController(diagnostics?: Diagnostics): NetworkReplicationController {
  return new NetworkReplicationController({ diagnostics });
}

export function entityReplicationPriority(entity: NetworkEntityState, origin: { x: number; y: number; z: number }): number {
  const dx = entity.position.x - origin.x;
  const dy = entity.position.y - origin.y;
  const dz = entity.position.z - origin.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return 1 / (1 + distance) + ((entity.flags & 1) !== 0 ? 0.2 : 0);
}
