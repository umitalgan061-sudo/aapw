import {
  type NetworkDeltaV4,
  type NetworkEnvelopeV4,
  type NetworkPeerV4,
  type RuntimeErrorV4,
  type TickId,
  type OutcomeV4,
  okV4,
  failV4,
  createRuntimeErrorV4,
  type EntityIdV4,
  type TransformV4,
  vec3V4,
  quaternionV4,
  transformV4,
  clampV4,
} from './runtimeContractsV4';

export interface QuantizedTransformV4 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly roll: number;
  readonly scale: number;
}

export interface ReplicatedEntityV4 {
  readonly entity: EntityIdV4;
  readonly revision: number;
  readonly transform: QuantizedTransformV4;
  readonly flags: number;
}

export interface ReplicationFrameV4 {
  readonly tick: TickId;
  readonly revision: number;
  readonly entities: readonly ReplicatedEntityV4[];
  readonly checksum: string;
}

export interface PeerStateV4 extends NetworkPeerV4 {
  readonly nextSequence: number;
  readonly lastReceivedSequence: number;
  readonly sent: number;
  readonly received: number;
  readonly dropped: number;
  readonly pending: number;
}

export interface ReplicationMetricsV4 {
  readonly framesBuilt: number;
  readonly deltasBuilt: number;
  readonly deltasApplied: number;
  readonly staleRejected: number;
  readonly checksumRejected: number;
  readonly bytesEstimated: number;
  readonly peers: number;
}

export interface ReplicationConfigV4 {
  readonly maxEntitiesPerFrame?: number;
  readonly maxPendingPerPeer?: number;
  readonly positionScale?: number;
  readonly angleScale?: number;
  readonly maxPeerCount?: number;
}

const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;
const checksumV4 = (value: unknown): string => {
  const text = JSON.stringify(value, (_key, current) => typeof current === 'number' && Object.is(current, -0) ? 0 : current);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export function quantizeTransformV4(transform: TransformV4, positionScale = 100, angleScale = 10000): QuantizedTransformV4 {
  return Object.freeze({
    x: Math.round(finite(transform.position.x) * positionScale),
    y: Math.round(finite(transform.position.y) * positionScale),
    z: Math.round(finite(transform.position.z) * positionScale),
    yaw: Math.round(finite(transform.rotation.y) * angleScale),
    pitch: Math.round(finite(transform.rotation.x) * angleScale),
    roll: Math.round(finite(transform.rotation.z) * angleScale),
    scale: Math.round(Math.max(0.001, finite(transform.scale.x, 1)) * positionScale),
  });
}

export function dequantizeTransformV4(value: QuantizedTransformV4, positionScale = 100, angleScale = 10000): TransformV4 {
  return transformV4(
    vec3V4(value.x / positionScale, value.y / positionScale, value.z / positionScale),
    quaternionV4(value.pitch / angleScale, value.yaw / angleScale, value.roll / angleScale, 1),
    vec3V4(value.scale / positionScale, value.scale / positionScale, value.scale / positionScale),
  );
}

export function estimateEntityBytesV4(entity: ReplicatedEntityV4): number {
  return 4 + 4 + 7 * 4 + 4;
}

export class NetworkReplicationV4 {
  readonly maxEntitiesPerFrame: number;
  readonly maxPendingPerPeer: number;
  readonly positionScale: number;
  readonly angleScale: number;
  readonly maxPeerCount: number;
  #revision = new Map<EntityIdV4, number>();
  #entities = new Map<EntityIdV4, ReplicatedEntityV4>();
  #peers = new Map<string, PeerStateV4>();
  #pending = new Map<string, NetworkEnvelopeV4[]>();
  #sequence = 0;
  #metrics = { framesBuilt: 0, deltasBuilt: 0, deltasApplied: 0, staleRejected: 0, checksumRejected: 0, bytesEstimated: 0 };

  constructor(config: ReplicationConfigV4 = {}) {
    this.maxEntitiesPerFrame = Math.max(1, Math.trunc(config.maxEntitiesPerFrame ?? 1024));
    this.maxPendingPerPeer = Math.max(8, Math.trunc(config.maxPendingPerPeer ?? 256));
    this.positionScale = Math.max(1, Math.trunc(config.positionScale ?? 100));
    this.angleScale = Math.max(10, Math.trunc(config.angleScale ?? 10000));
    this.maxPeerCount = Math.max(1, Math.trunc(config.maxPeerCount ?? 64));
  }

  registerPeer(peer: NetworkPeerV4): OutcomeV4<PeerStateV4> {
    if (this.#peers.has(peer.id)) return okV4(this.#peers.get(peer.id)!);
    if (this.#peers.size >= this.maxPeerCount) return failV4(createRuntimeErrorV4('NETWORK_PEER_CAP', 'Peer limit reached', true));
    const state: PeerStateV4 = Object.freeze({ ...peer, nextSequence: 1, lastReceivedSequence: 0, sent: 0, received: 0, dropped: 0, pending: 0 });
    this.#peers.set(peer.id, state);
    this.#pending.set(peer.id, []);
    return okV4(state);
  }

  removePeer(peerId: string): boolean {
    this.#pending.delete(peerId);
    return this.#peers.delete(peerId);
  }

  peer(peerId: string): PeerStateV4 | undefined {
    return this.#peers.get(peerId);
  }

  peers(): readonly PeerStateV4[] {
    return Object.freeze([...this.#peers.values()].sort((a, b) => a.id.localeCompare(b.id)));
  }

  upsert(entity: EntityIdV4, transform: TransformV4, flags = 0): ReplicatedEntityV4 {
    const revision = (this.#revision.get(entity) ?? 0) + 1;
    this.#revision.set(entity, revision);
    const record: ReplicatedEntityV4 = Object.freeze({ entity, revision, transform: quantizeTransformV4(transform, this.positionScale, this.angleScale), flags: Math.trunc(flags) });
    this.#entities.set(entity, record);
    return record;
  }

  remove(entity: EntityIdV4): boolean {
    this.#revision.delete(entity);
    return this.#entities.delete(entity);
  }

  entity(entity: EntityIdV4): ReplicatedEntityV4 | undefined {
    return this.#entities.get(entity);
  }

  buildFrame(tick: TickId, maxEntities = this.maxEntitiesPerFrame): ReplicationFrameV4 {
    const limit = Math.max(1, Math.min(this.maxEntitiesPerFrame, Math.trunc(maxEntities)));
    const entities = [...this.#entities.values()]
      .sort((a, b) => a.entity - b.entity)
      .slice(0, limit);
    const revision = entities.reduce((max, entity) => Math.max(max, entity.revision), 0);
    const checksum = checksumV4({ tick, revision, entities });
    this.#metrics.framesBuilt += 1;
    this.#metrics.bytesEstimated += entities.reduce((total, entity) => total + estimateEntityBytesV4(entity), 0);
    return Object.freeze({ tick, revision, entities: Object.freeze(entities), checksum });
  }

  createDelta<T>(tick: TickId, source: string, payload: T): NetworkDeltaV4<T> {
    this.#metrics.deltasBuilt += 1;
    return Object.freeze({ version: ++this.#sequence, tick, source, payload, checksum: checksumV4({ tick, source, payload, version: this.#sequence }) });
  }

  applyFrame(frame: ReplicationFrameV4): OutcomeV4<number> {
    const expected = checksumV4({ tick: frame.tick, revision: frame.revision, entities: frame.entities });
    if (expected !== frame.checksum) {
      this.#metrics.checksumRejected += 1;
      return failV4(createRuntimeErrorV4('NETWORK_FRAME_CHECKSUM', 'Frame checksum rejected', false));
    }
    let applied = 0;
    for (const record of frame.entities) {
      const current = this.#entities.get(record.entity);
      if (current && current.revision >= record.revision) {
        this.#metrics.staleRejected += 1;
        continue;
      }
      this.#entities.set(record.entity, Object.freeze({ ...record }));
      this.#revision.set(record.entity, record.revision);
      applied += 1;
    }
    this.#metrics.deltasApplied += applied;
    return okV4(applied);
  }

  queue<T>(peerId: string, envelope: NetworkEnvelopeV4<T>): OutcomeV4<number> {
    const peer = this.#peers.get(peerId);
    const pending = this.#pending.get(peerId);
    if (!peer || !pending) return failV4(createRuntimeErrorV4('NETWORK_PEER_MISSING', 'Peer is not registered', true));
    if (pending.length >= this.maxPendingPerPeer) {
      const dropIndex = envelope.reliable ? pending.findIndex((entry) => !entry.reliable) : 0;
      if (dropIndex < 0) return failV4(createRuntimeErrorV4('NETWORK_BACKPRESSURE', 'Reliable queue is full', true));
      pending.splice(dropIndex, 1);
      this.#setPeer(peerId, { dropped: peer.dropped + 1 });
    }
    pending.push(Object.freeze({ ...envelope }));
    this.#setPeer(peerId, { pending: pending.length });
    return okV4(pending.length);
  }

  drain(peerId: string, max = 32): readonly NetworkEnvelopeV4[] {
    const pending = this.#pending.get(peerId);
    const peer = this.#peers.get(peerId);
    if (!pending || !peer) return Object.freeze([]);
    const items = pending.splice(0, Math.max(0, Math.trunc(max)));
    this.#setPeer(peerId, { pending: pending.length, sent: peer.sent + items.length, nextSequence: peer.nextSequence + items.length });
    return Object.freeze(items);
  }

  acknowledge(peerId: string, sequence: number, now = performance.now()): OutcomeV4<PeerStateV4> {
    const peer = this.#peers.get(peerId);
    if (!peer) return failV4(createRuntimeErrorV4('NETWORK_PEER_MISSING', 'Peer is not registered', true));
    const rtt = clampV4(now - peer.lastSeenAt, 0, 60_000);
    const latencyMs = peer.latencyMs <= 0 ? rtt : peer.latencyMs * 0.8 + rtt * 0.2;
    const next = this.#setPeer(peerId, { lastReceivedSequence: Math.max(peer.lastReceivedSequence, Math.trunc(sequence)), latencyMs, lastSeenAt: now });
    return okV4(next);
  }

  metrics(): ReplicationMetricsV4 {
    return Object.freeze({ ...this.#metrics, peers: this.#peers.size });
  }

  clearEntities(): void {
    this.#entities.clear();
    this.#revision.clear();
  }

  reset(): void {
    this.clearEntities();
    this.#peers.clear();
    this.#pending.clear();
    this.#sequence = 0;
    this.#metrics = { framesBuilt: 0, deltasBuilt: 0, deltasApplied: 0, staleRejected: 0, checksumRejected: 0, bytesEstimated: 0 };
  }

  #setPeer(peerId: string, patch: Partial<PeerStateV4>): PeerStateV4 {
    const current = this.#peers.get(peerId)!;
    const next = Object.freeze({ ...current, ...patch });
    this.#peers.set(peerId, next);
    return next;
  }
}

export function networkErrorV4(error: unknown): RuntimeErrorV4 {
  return createRuntimeErrorV4('NETWORK_RUNTIME', error instanceof Error ? error.message : 'Network runtime error', true);
}
