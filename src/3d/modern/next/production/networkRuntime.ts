import { buildSnapshotDelta, applySnapshotDelta, PacketWindow, type SnapshotDelta } from '../network.ts';
import { deterministicChecksum } from '../determinism.ts';
import { validatePayload, validateSnapshotBounds, RateLimiter, DEFAULT_SECURITY_LIMITS } from '../security.ts';
import { tick, type Tick, type WorldSnapshot, type SnapshotEntity } from '../types.ts';
import type {
  NetworkPeerState,
  ReplicationEnvelope,
  RuntimeFault,
  ProductionSnapshot,
} from './contracts.ts';

export interface NetworkRuntimeConfig {
  readonly session: string;
  readonly protocol: number;
  readonly maxPayloadBytes: number;
  readonly maxPendingPackets: number;
  readonly snapshotRateHz: number;
  readonly interpolationDelayTicks: number;
  readonly maxSnapshotAgeTicks: number;
  readonly maxFutureTicks: number;
  readonly maxEntities: number;
  readonly commandRatePerSecond: number;
}

const DEFAULT_NETWORK_CONFIG: NetworkRuntimeConfig = {
  session: 'local',
  protocol: 3,
  maxPayloadBytes: 256 * 1024,
  maxPendingPackets: 256,
  snapshotRateHz: 20,
  interpolationDelayTicks: 2,
  maxSnapshotAgeTicks: 120,
  maxFutureTicks: 8,
  maxEntities: 4096,
  commandRatePerSecond: 120,
};

interface PeerInternal extends NetworkPeerState {
  pending: PacketWindow<string>;
  snapshots: Array<WorldSnapshot>;
  lastSnapshot?: WorldSnapshot;
  lastSentTick: Tick;
  lastAckedSequence: number;
  receivedAtMs: number;
}

export interface NetworkPacket {
  readonly peerId: string;
  readonly sequence: number;
  readonly payload: ReplicationEnvelope;
  readonly bytes: number;
}

export interface NetworkRuntimeStats {
  readonly peers: number;
  readonly connectedPeers: number;
  readonly pendingPackets: number;
  readonly generatedSnapshots: number;
  readonly appliedDeltas: number;
  readonly rejectedPackets: number;
  readonly invalidPayloads: number;
  readonly rateLimitedCommands: number;
  readonly averageRttMs: number;
  readonly checksumFailures: number;
}

export class ProductionNetworkRuntime {
  readonly config: NetworkRuntimeConfig;
  #peers = new Map<string, PeerInternal>();
  #rateLimiter: RateLimiter;
  #nextSequence = 1;
  #generatedSnapshots = 0;
  #appliedDeltas = 0;
  #rejectedPackets = 0;
  #invalidPayloads = 0;
  #rateLimitedCommands = 0;
  #checksumFailures = 0;

  constructor(config: Partial<NetworkRuntimeConfig> = {}) {
    this.config = {
      ...DEFAULT_NETWORK_CONFIG,
      ...config,
      session: normalizeId(config.session ?? DEFAULT_NETWORK_CONFIG.session),
      maxPayloadBytes: clampInt(config.maxPayloadBytes, 16 * 1024, 1024 * 1024, DEFAULT_NETWORK_CONFIG.maxPayloadBytes),
      maxPendingPackets: clampInt(config.maxPendingPackets, 8, 4096, DEFAULT_NETWORK_CONFIG.maxPendingPackets),
      snapshotRateHz: clampInt(config.snapshotRateHz, 5, 120, DEFAULT_NETWORK_CONFIG.snapshotRateHz),
      interpolationDelayTicks: clampInt(config.interpolationDelayTicks, 0, 30, DEFAULT_NETWORK_CONFIG.interpolationDelayTicks),
      maxSnapshotAgeTicks: clampInt(config.maxSnapshotAgeTicks, 1, 10000, DEFAULT_NETWORK_CONFIG.maxSnapshotAgeTicks),
      maxFutureTicks: clampInt(config.maxFutureTicks, 0, 120, DEFAULT_NETWORK_CONFIG.maxFutureTicks),
      maxEntities: clampInt(config.maxEntities, 1, 100000, DEFAULT_NETWORK_CONFIG.maxEntities),
      commandRatePerSecond: clampInt(config.commandRatePerSecond, 1, 10000, DEFAULT_NETWORK_CONFIG.commandRatePerSecond),
      protocol: Math.max(1, Math.floor(config.protocol ?? DEFAULT_NETWORK_CONFIG.protocol)),
    };
    this.#rateLimiter = new RateLimiter(this.config.commandRatePerSecond);
  }

  connect(peerId: string, transport: NetworkPeerState['transport'], nowMs: number): NetworkPeerState {
    const id = normalizeId(peerId);
    if (!id) throw new TypeError('peerId is required');
    const existing = this.#peers.get(id);
    const peer: PeerInternal = existing ?? {
      peerId: id,
      transport,
      connected: true,
      lastReceivedTick: tick(0),
      lastAck: 0,
      rttMs: 0,
      jitterMs: 0,
      packetLossRatio: 0,
      bandwidthBytesPerSecond: 0,
      pending: new PacketWindow(this.config.maxPendingPackets),
      snapshots: [],
      lastSentTick: tick(0),
      lastAckedSequence: 0,
      receivedAtMs: Math.max(0, nowMs),
    };
    peer.connected = true;
    peer.receivedAtMs = Math.max(0, nowMs);
    peer.transport = transport;
    this.#peers.set(id, peer);
    return this.#publicPeer(peer);
  }

  disconnect(peerId: string): boolean {
    const peer = this.#peers.get(normalizeId(peerId));
    if (!peer) return false;
    peer.connected = false;
    return true;
  }

  receive(peerId: string, envelope: ReplicationEnvelope, currentTick: Tick, nowMs: number): boolean {
    const peer = this.#peers.get(normalizeId(peerId));
    if (!peer?.connected) return false;
    if (envelope.protocol !== this.config.protocol) {
      this.#rejectedPackets += 1;
      return false;
    }
    if (envelope.session !== this.config.session) {
      this.#rejectedPackets += 1;
      return false;
    }
    const payloadValidation = validatePayload(envelope.payload, {
      ...DEFAULT_SECURITY_LIMITS,
      maxPayloadBytes: this.config.maxPayloadBytes,
      maxArrayLength: this.config.maxEntities,
    });
    if (!payloadValidation.ok) {
      this.#invalidPayloads += 1;
      return false;
    }
    const bounds = validateSnapshotBounds(
      isSnapshotPayload(envelope.payload) ? envelope.payload : { tick: currentTick, entities: [] },
      currentTick,
      { maxAgeTicks: this.config.maxSnapshotAgeTicks, maxFutureTicks: this.config.maxFutureTicks, maxEntities: this.config.maxEntities },
    );
    if (!bounds.ok) {
      this.#rejectedPackets += 1;
      return false;
    }
    peer.lastReceivedTick = tick(Math.max(peer.lastReceivedTick, envelope.sentTick));
    peer.lastAck = Math.max(peer.lastAck, envelope.ack);
    const rtt = Math.max(0, nowMs - peer.receivedAtMs);
    if (peer.rttMs === 0) peer.rttMs = rtt;
    else {
      const delta = Math.abs(rtt - peer.rttMs);
      peer.jitterMs = peer.jitterMs * 0.75 + delta * 0.25;
      peer.rttMs = peer.rttMs * 0.875 + rtt * 0.125;
    }
    peer.receivedAtMs = Math.max(0, nowMs);
    return true;
  }

  canSendCommand(peerId: string, nowMs: number): boolean {
    const allowed = this.#rateLimiter.allow(normalizeId(peerId), nowMs);
    if (!allowed) this.#rateLimitedCommands += 1;
    return allowed;
  }

  createSnapshotPacket(peerId: string, current: WorldSnapshot, nowMs: number): NetworkPacket | undefined {
    const peer = this.#peers.get(normalizeId(peerId));
    if (!peer?.connected) return undefined;
    const intervalTicks = Math.max(1, Math.round(60 / this.config.snapshotRateHz));
    if (current.tick - peer.lastSentTick < intervalTicks) return undefined;
    const previous = peer.lastSnapshot;
    const delta = buildSnapshotDelta(previous, current);
    const envelope: ReplicationEnvelope = {
      protocol: 3,
      session: this.config.session,
      sequence: this.#nextSequence++,
      ack: peer.lastAck,
      sentTick: current.tick,
      kind: previous ? 'delta' : 'snapshot',
      payload: previous ? delta : current,
    };
    const textPayload = JSON.stringify(envelope);
    const bytes = new TextEncoder().encode(textPayload).byteLength;
    if (bytes > this.config.maxPayloadBytes) {
      this.#rejectedPackets += 1;
      return undefined;
    }
    peer.pending.create(textPayload, nowMs);
    peer.lastSnapshot = cloneSnapshot(current);
    peer.lastSentTick = current.tick;
    this.#generatedSnapshots += 1;
    return { peerId: peer.peerId, sequence: envelope.sequence, payload: envelope, bytes };
  }

  acknowledge(peerId: string, sequence: number, nowMs: number): void {
    const peer = this.#peers.get(normalizeId(peerId));
    if (!peer) return;
    const result = peer.pending.acknowledge(sequence);
    if (result.rttSamplesMs.length) {
      const average = result.rttSamplesMs.reduce((sum, value) => sum + value, 0) / result.rttSamplesMs.length;
      peer.rttMs = peer.rttMs === 0 ? average : peer.rttMs * 0.8 + average * 0.2;
    }
    peer.lastAckedSequence = Math.max(peer.lastAckedSequence, Math.floor(sequence));
    peer.receivedAtMs = Math.max(peer.receivedAtMs, nowMs);
  }

  applyDelta(peerId: string, base: WorldSnapshot, delta: SnapshotDelta, currentTick: Tick): WorldSnapshot | undefined {
    const peer = this.#peers.get(normalizeId(peerId));
    if (!peer?.connected) return undefined;
    if (delta.upserts.length > this.config.maxEntities || delta.removals.length > this.config.maxEntities) {
      this.#rejectedPackets += 1;
      return undefined;
    }
    try {
      const result = applySnapshotDelta(base, delta);
      const checksum = deterministicChecksum([
        result.tick,
        ...result.entities.flatMap((entity) => [entity.id, entity.x, entity.y, entity.z, entity.yaw, entity.flags]),
      ]);
      if (checksum === delta.checksum) {
        this.#appliedDeltas += 1;
      } else {
        this.#checksumFailures += 1;
        this.#rejectedPackets += 1;
        return undefined;
      }
      peer.snapshots.push(cloneSnapshot(result));
      while (peer.snapshots.length > 32) peer.snapshots.shift();
      return result;
    } catch {
      this.#rejectedPackets += 1;
      return undefined;
    }
  }

  interpolate(peerId: string, targetTick: Tick): WorldSnapshot | undefined {
    const peer = this.#peers.get(normalizeId(peerId));
    if (!peer?.snapshots.length) return undefined;
    const desired = Math.max(0, targetTick - this.config.interpolationDelayTicks);
    let best = peer.snapshots[0]!;
    for (const snapshot of peer.snapshots) {
      if (snapshot.tick <= desired && snapshot.tick >= best.tick) best = snapshot;
    }
    return cloneSnapshot(best);
  }

  peer(peerId: string): NetworkPeerState | undefined {
    const peer = this.#peers.get(normalizeId(peerId));
    return peer ? this.#publicPeer(peer) : undefined;
  }

  peers(): NetworkPeerState[] {
    return [...this.#peers.values()].sort((a, b) => a.peerId.localeCompare(b.peerId)).map((peer) => this.#publicPeer(peer));
  }

  stats(): NetworkRuntimeStats {
    let pendingPackets = 0;
    let rttTotal = 0;
    let connectedPeers = 0;
    for (const peer of this.#peers.values()) {
      pendingPackets += peer.pending.pending();
      if (peer.connected) connectedPeers += 1;
      rttTotal += peer.rttMs;
    }
    return {
      peers: this.#peers.size,
      connectedPeers,
      pendingPackets,
      generatedSnapshots: this.#generatedSnapshots,
      appliedDeltas: this.#appliedDeltas,
      rejectedPackets: this.#rejectedPackets,
      invalidPayloads: this.#invalidPayloads,
      rateLimitedCommands: this.#rateLimitedCommands,
      averageRttMs: this.#peers.size ? rttTotal / this.#peers.size : 0,
      checksumFailures: this.#checksumFailures,
    };
  }

  faults(tickValue: Tick): RuntimeFault[] {
    const stats = this.stats();
    const faults: RuntimeFault[] = [];
    if (stats.checksumFailures > 0) faults.push({ subsystem: 'network', policy: 'degrade', message: 'network snapshot checksum failures detected', tick: tickValue, recoverable: true, details: { count: stats.checksumFailures } });
    if (stats.invalidPayloads > stats.rejectedPackets / 2 && stats.invalidPayloads > 4) faults.push({ subsystem: 'security', policy: 'degrade', message: 'network payload rejection pressure is elevated', tick: tickValue, recoverable: true, details: { invalidPayloads: stats.invalidPayloads, rejectedPackets: stats.rejectedPackets } });
    return faults;
  }

  reset(): void {
    this.#peers.clear();
    this.#nextSequence = 1;
    this.#generatedSnapshots = 0;
    this.#appliedDeltas = 0;
    this.#rejectedPackets = 0;
    this.#invalidPayloads = 0;
    this.#rateLimitedCommands = 0;
    this.#checksumFailures = 0;
    this.#rateLimiter.reset();
  }

  #publicPeer(peer: PeerInternal): NetworkPeerState {
    return {
      peerId: peer.peerId,
      transport: peer.transport,
      connected: peer.connected,
      lastReceivedTick: peer.lastReceivedTick,
      lastAck: peer.lastAck,
      rttMs: Math.max(0, peer.rttMs),
      jitterMs: Math.max(0, peer.jitterMs),
      packetLossRatio: Math.max(0, Math.min(1, peer.packetLossRatio)),
      bandwidthBytesPerSecond: Math.max(0, peer.bandwidthBytesPerSecond),
    };
  }
}

function normalizeId(value: string): string {
  return String(value).trim().slice(0, 128);
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  const numeric = Number.isFinite(value) ? Number(value) : fallback;
  return Math.min(max, Math.max(min, Math.floor(numeric)));
}

function cloneSnapshot(snapshot: WorldSnapshot): WorldSnapshot {
  return { tick: tick(snapshot.tick), entities: snapshot.entities.map((entity) => ({ ...entity })) };
}

function isSnapshotPayload(value: unknown): value is { tick: number; entities: readonly unknown[] } {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { tick?: unknown; entities?: unknown };
  return typeof candidate.tick === 'number' && Array.isArray(candidate.entities);
}

export function makeProductionEnvelope(
  session: string,
  sequence: number,
  sentTick: Tick,
  kind: ReplicationEnvelope['kind'],
  payload: unknown,
  ack = 0,
): ReplicationEnvelope {
  return {
    protocol: 3,
    session: normalizeId(session),
    sequence: Math.max(1, Math.floor(sequence)),
    ack: Math.max(0, Math.floor(ack)),
    sentTick,
    kind,
    payload,
  };
}
