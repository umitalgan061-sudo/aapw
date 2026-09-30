import { NetworkPacket, NetworkPeer, Tick, WorldSnapshot, hashString, stableStringify, tickValue } from './types.ts';

export interface SnapshotDelta {
  tick: Tick;
  baseTick: Tick;
  upserts: readonly { id: number; components: Record<string, unknown>; mask: number }[];
  removes: readonly number[];
  checksum: number;
}

export interface ReplicationPolicy {
  snapshotRate: number;
  interpolationDelayTicks: number;
  maxHistory: number;
  maxPacketBytes: number;
  maxPeers: number;
}

const DEFAULT_POLICY: ReplicationPolicy = {
  snapshotRate: 20,
  interpolationDelayTicks: 2,
  maxHistory: 120,
  maxPacketBytes: 64 * 1024,
  maxPeers: 64,
};

interface StoredSnapshot extends WorldSnapshot {
  receivedAtMs: number;
}

export class SnapshotHistory {
  readonly #capacity: number;
  readonly #snapshots = new Map<number, StoredSnapshot>();

  constructor(capacity = DEFAULT_POLICY.maxHistory) {
    this.#capacity = Math.max(2, Math.floor(capacity));
  }

  put(snapshot: WorldSnapshot, receivedAtMs = performance.now()): void {
    this.#snapshots.set(Number(snapshot.tick), { ...snapshot, receivedAtMs });
    while (this.#snapshots.size > this.#capacity) {
      const oldest = this.#snapshots.keys().next().value;
      if (oldest === undefined) break;
      this.#snapshots.delete(oldest);
    }
  }

  get(tick: Tick): StoredSnapshot | undefined {
    return this.#snapshots.get(Number(tick));
  }

  nearest(tick: Tick): StoredSnapshot | undefined {
    let closest: StoredSnapshot | undefined;
    for (const snapshot of this.#snapshots.values()) {
      if (!closest || Math.abs(Number(snapshot.tick) - Number(tick)) < Math.abs(Number(closest.tick) - Number(tick))) closest = snapshot;
    }
    return closest;
  }

  range(fromTick: Tick, toTick: Tick): StoredSnapshot[] {
    return [...this.#snapshots.values()]
      .filter((snapshot) => snapshot.tick >= fromTick && snapshot.tick <= toTick)
      .sort((a, b) => Number(a.tick) - Number(b.tick));
  }

  clearThrough(tick: Tick): number {
    let removed = 0;
    for (const key of this.#snapshots.keys()) {
      if (key <= Number(tick)) {
        this.#snapshots.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  get size(): number { return this.#snapshots.size; }
}

export function diffSnapshots(previous: WorldSnapshot | undefined, current: WorldSnapshot): SnapshotDelta {
  const oldEntities = new Map((previous?.entities ?? []).map((entity) => [Number(entity.id), entity]));
  const newEntities = new Map(current.entities.map((entity) => [Number(entity.id), entity]));
  const upserts: { id: number; components: Record<string, unknown>; mask: number }[] = [];
  const removes: number[] = [];
  for (const [id, entity] of newEntities) {
    const old = oldEntities.get(id);
    if (!old || old.mask !== entity.mask || stableStringify(old.components) !== stableStringify(entity.components)) {
      upserts.push({ id, mask: entity.mask, components: structuredClone(entity.components) });
    }
  }
  for (const id of oldEntities.keys()) if (!newEntities.has(id)) removes.push(id);
  return {
    tick: current.tick,
    baseTick: previous?.tick ?? tickValue(0),
    upserts,
    removes,
    checksum: hashString(stableStringify({ tick: current.tick, baseTick: previous?.tick ?? 0, upserts, removes })),
  };
}

export function applyDelta(previous: WorldSnapshot, delta: SnapshotDelta): WorldSnapshot {
  if (delta.baseTick !== previous.tick) throw new Error(`Delta base mismatch: expected ${previous.tick}, got ${delta.baseTick}`);
  const entities = new Map(previous.entities.map((entity) => [Number(entity.id), structuredClone(entity)]));
  for (const id of delta.removes) entities.delete(id);
  for (const upsert of delta.upserts) {
    entities.set(upsert.id, {
      id: upsert.id as WorldSnapshot['entities'][number]['id'],
      mask: upsert.mask,
      components: structuredClone(upsert.components),
    });
  }
  const checksum = hashString(stableStringify([...entities.values()].sort((a, b) => Number(a.id) - Number(b.id))));
  return {
    tick: delta.tick,
    revision: previous.revision,
    entities: [...entities.values()].sort((a, b) => Number(a.id) - Number(b.id)),
    checksum,
  };
}

export class ReplicationServer {
  readonly #policy: ReplicationPolicy;
  readonly #peers = new Map<string, NetworkPeer>();
  readonly #history: StoredSnapshot[] = [];
  #sequence = 0;

  constructor(policy: Partial<ReplicationPolicy> = {}) {
    this.#policy = { ...DEFAULT_POLICY, ...policy };
  }

  addPeer(peer: NetworkPeer): boolean {
    if (this.#peers.size >= this.#policy.maxPeers && !this.#peers.has(peer.id)) return false;
    this.#peers.set(peer.id, { ...peer });
    return true;
  }

  removePeer(id: string): boolean { return this.#peers.delete(id); }

  publish(snapshot: WorldSnapshot): void {
    this.#history.push({ ...snapshot, receivedAtMs: performance.now() });
    while (this.#history.length > this.#policy.maxHistory) this.#history.shift();
  }

  createPacket(peerId: string, snapshot: WorldSnapshot): NetworkPacket<SnapshotDelta> | null {
    const peer = this.#peers.get(peerId);
    if (!peer) return null;
    const base = this.#history.findLast((candidate) => candidate.tick === peer.ackTick);
    const delta = diffSnapshots(base, snapshot);
    const packet: NetworkPacket<SnapshotDelta> = {
      protocol: 2,
      kind: 'snapshot.delta',
      sequence: ++this.#sequence,
      tick: snapshot.tick,
      ack: Number(peer.ackTick),
      payload: delta,
      checksum: hashString(stableStringify(delta)),
    };
    if (encodedByteLength(packet) > this.#policy.maxPacketBytes) return null;
    return packet;
  }

  acknowledge(peerId: string, tick: Tick, rttMs: number): void {
    const peer = this.#peers.get(peerId);
    if (!peer) return;
    peer.ackTick = tick;
    peer.lastReceiveTick = tick;
    peer.rttMs = Math.max(0, rttMs);
  }

  peerSnapshot(): NetworkPeer[] {
    return [...this.#peers.values()].sort((a, b) => a.id.localeCompare(b.id)).map((peer) => ({ ...peer }));
  }

  metrics(): { peers: number; snapshots: number; sequence: number; oldestTick: Tick } {
    return {
      peers: this.#peers.size,
      snapshots: this.#history.length,
      sequence: this.#sequence,
      oldestTick: this.#history.length ? this.#history[0].tick : tickValue(0),
    };
  }
}

export interface InterpolationResult {
  from: WorldSnapshot;
  to: WorldSnapshot;
  alpha: number;
}

export function selectInterpolationPair(history: SnapshotHistory, renderTick: Tick): InterpolationResult | null {
  const before = history.range(tickValue(Math.max(0, Number(renderTick) - 1)), renderTick)[0];
  const after = history.get(renderTick);
  if (before && after && before.tick !== after.tick) return { from: before, to: after, alpha: 0.5 };
  const nearest = history.nearest(renderTick);
  return nearest ? { from: nearest, to: nearest, alpha: 0 } : null;
}

export function validatePacket<T>(packet: NetworkPacket<T>, maxBytes = DEFAULT_POLICY.maxPacketBytes): boolean {
  if (packet.protocol < 1 || packet.protocol > 2) return false;
  if (!Number.isInteger(packet.sequence) || packet.sequence <= 0) return false;
  if (!Number.isInteger(packet.tick) || packet.tick < 0) return false;
  if (encodedByteLength(packet) > maxBytes) return false;
  return packet.checksum === hashString(stableStringify(packet.payload));
}

function encodedByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
