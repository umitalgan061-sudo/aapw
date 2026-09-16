import { deterministicChecksum, quantize, type NetworkEnvelope, type SnapshotEntity, type Tick, type WorldSnapshot } from './determinism.ts';

export interface SnapshotDelta {
  readonly tick: Tick;
  readonly baseTick: Tick;
  readonly upserts: readonly SnapshotEntity[];
  readonly removals: readonly number[];
  readonly checksum: string;
}

export interface AckState {
  highestReceived: number;
  highestProcessed: number;
}

export interface PendingPacket<T> {
  readonly sequence: number;
  readonly sentAtMs: number;
  readonly payload: T;
}

export function normalizeEntity(entity: SnapshotEntity): SnapshotEntity {
  return {
    id: entity.id,
    x: quantize(entity.x, 1e-4),
    y: quantize(entity.y, 1e-4),
    z: quantize(entity.z, 1e-4),
    yaw: quantize(entity.yaw, 1e-5),
    flags: entity.flags >>> 0,
  };
}

export function buildSnapshotDelta(previous: WorldSnapshot | undefined, current: WorldSnapshot): SnapshotDelta {
  const previousMap = new Map(previous?.entities.map((entity) => [entity.id, normalizeEntity(entity)]) ?? []);
  const currentEntities = current.entities.map(normalizeEntity).sort((a, b) => a.id - b.id);
  const upserts: SnapshotEntity[] = [];
  const removals: number[] = [];
  for (const entity of currentEntities) {
    const old = previousMap.get(entity.id);
    if (!old || !sameEntity(old, entity)) upserts.push(entity);
    previousMap.delete(entity.id);
  }
  for (const id of previousMap.keys()) removals.push(id);
  removals.sort((a, b) => a - b);
  return {
    tick: current.tick,
    baseTick: previous?.tick ?? current.tick,
    upserts,
    removals,
    checksum: deterministicChecksum([
      current.tick,
      previous?.tick ?? -1,
      ...upserts.flatMap((entity) => [entity.id, entity.x, entity.y, entity.z, entity.yaw, entity.flags]),
      ...removals,
    ]),
  };
}

export function applySnapshotDelta(base: WorldSnapshot, delta: SnapshotDelta): WorldSnapshot {
  if (base.tick !== delta.baseTick) throw new Error(`snapshot base mismatch: expected ${delta.baseTick}, got ${base.tick}`);
  const removed = new Set(delta.removals);
  const map = new Map(base.entities.filter((entity) => !removed.has(entity.id)).map((entity) => [entity.id, normalizeEntity(entity)]));
  for (const entity of delta.upserts) map.set(entity.id, normalizeEntity(entity));
  const entities = [...map.values()].sort((a, b) => a.id - b.id);
  return { tick: delta.tick, entities };
}

function sameEntity(a: SnapshotEntity, b: SnapshotEntity): boolean {
  return a.id === b.id && a.x === b.x && a.y === b.y && a.z === b.z && a.yaw === b.yaw && a.flags === b.flags;
}

export class PacketWindow<TPayload> {
  readonly maxPending: number;
  #nextSequence = 1;
  #pending = new Map<number, PendingPacket<TPayload>>();
  #lastAck = 0;

  constructor(maxPending = 256) {
    if (!Number.isInteger(maxPending) || maxPending < 1) throw new RangeError('maxPending must be >= 1');
    this.maxPending = maxPending;
  }

  create(payload: TPayload, nowMs: number): PendingPacket<TPayload> {
    while (this.#pending.size >= this.maxPending) {
      const oldest = this.#pending.keys().next().value;
      if (oldest === undefined) break;
      this.#pending.delete(oldest);
    }
    const packet = { sequence: this.#nextSequence++, sentAtMs: Math.max(0, nowMs), payload };
    this.#pending.set(packet.sequence, packet);
    return packet;
  }

  acknowledge(sequence: number): { acked: number[]; rttSamplesMs: number[] } {
    const target = Math.max(0, Math.floor(sequence));
    if (target <= this.#lastAck) return { acked: [], rttSamplesMs: [] };
    const acked: number[] = [];
    const rttSamplesMs: number[] = [];
    for (const [seq, packet] of this.#pending) {
      if (seq > target) break;
      this.#pending.delete(seq);
      acked.push(seq);
    }
    this.#lastAck = target;
    return { acked, rttSamplesMs };
  }

  acknowledgeAt(sequence: number, nowMs: number): { acked: number[]; rttSamplesMs: number[] } {
    const target = Math.max(0, Math.floor(sequence));
    if (target <= this.#lastAck) return { acked: [], rttSamplesMs: [] };
    const acked: number[] = [];
    const rttSamplesMs: number[] = [];
    for (const [seq, packet] of this.#pending) {
      if (seq > target) break;
      this.#pending.delete(seq);
      acked.push(seq);
      rttSamplesMs.push(Math.max(0, nowMs - packet.sentAtMs));
    }
    this.#lastAck = target;
    return { acked, rttSamplesMs };
  }

  pending(): readonly PendingPacket<TPayload>[] { return [...this.#pending.values()]; }
  lastAck(): number { return this.#lastAck; }
  nextSequence(): number { return this.#nextSequence; }
}

export class NetworkProtocolV2<TPayload = unknown> {
  readonly session: string;
  readonly maxPayloadBytes: number;
  readonly packets = new PacketWindow<TPayload>();
  #received = 0;

  constructor(session: string, maxPayloadBytes = 128 * 1024) {
    const normalized = session.trim();
    if (!normalized) throw new TypeError('session is required');
    this.session = normalized;
    this.maxPayloadBytes = maxPayloadBytes;
  }

  encode(type: string, payload: TPayload, tick: Tick, nowMs: number): NetworkEnvelope<TPayload> {
    const packet = this.packets.create(payload, nowMs);
    const envelope: NetworkEnvelope<TPayload> = {
      protocol: 2,
      session: this.session,
      sequence: packet.sequence,
      ack: this.#received,
      sentTick: tick,
      type: type.trim(),
      payload,
    };
    if (roughBytes(envelope) > this.maxPayloadBytes) throw new Error('network payload exceeds configured budget');
    return envelope;
  }

  accept(envelope: NetworkEnvelope<TPayload>): boolean {
    if (envelope.protocol !== 2 || envelope.session !== this.session) return false;
    if (envelope.sequence <= 0 || envelope.sequence <= this.#received) return false;
    if (roughBytes(envelope) > this.maxPayloadBytes) return false;
    this.#received = envelope.sequence;
    this.packets.acknowledge(envelope.ack);
    return true;
  }

  receivedSequence(): number { return this.#received; }
}

function roughBytes(value: unknown): number {
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; } catch { return Number.MAX_SAFE_INTEGER; }
}
