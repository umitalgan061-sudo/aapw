
import type { NetworkDelta, NetworkEntity, NetworkMetrics, NetworkSnapshot } from './types.ts';
import { cloneNetworkEntity, finite, stableHash, vec3, quat } from './types.ts';

export interface NetworkOptions {
  readonly maxSnapshots?: number;
  readonly maxPending?: number;
  readonly maxPacketBytes?: number;
  readonly interpolationDelayTicks?: number;
  readonly maxEntityCountPerPacket?: number;
}

export interface PendingInput {
  readonly sequence: number;
  readonly tick: number;
  readonly commandId: string;
}

export interface ReconciliationResult {
  readonly accepted: boolean;
  readonly rollbackRequired: boolean;
  readonly commonTick: number;
  readonly corrections: readonly NetworkEntity[];
  readonly rejectedReason: string | null;
}

export class NetworkSessionR41 {
  readonly maxSnapshots: number;
  readonly maxPending: number;
  readonly maxPacketBytes: number;
  readonly interpolationDelayTicks: number;
  readonly maxEntityCountPerPacket: number;

  #connected = false;
  #history: NetworkSnapshot[] = [];
  #pending: PendingInput[] = [];
  #sent = 0;
  #received = 0;
  #dropped = 0;
  #rejected = 0;
  #lastAck = 0;
  #rttMs = 0;

  constructor(options: NetworkOptions = {}) {
    this.maxSnapshots = Math.max(4, Math.trunc(options.maxSnapshots ?? 64));
    this.maxPending = Math.max(8, Math.trunc(options.maxPending ?? 256));
    this.maxPacketBytes = Math.max(1024, Math.trunc(options.maxPacketBytes ?? 256 * 1024));
    this.interpolationDelayTicks = Math.max(0, Math.trunc(options.interpolationDelayTicks ?? 2));
    this.maxEntityCountPerPacket = Math.max(1, Math.trunc(options.maxEntityCountPerPacket ?? 4096));
  }

  connect(): void { this.#connected = true; }
  disconnect(): void { this.#connected = false; this.#pending = []; }

  get connected(): boolean { return this.#connected; }

  queueInput(input: PendingInput): boolean {
    if (this.#pending.length >= this.maxPending) {
      this.#dropped += 1;
      return false;
    }
    if (!Number.isFinite(input.sequence) || !Number.isFinite(input.tick) || !input.commandId) {
      this.#rejected += 1;
      return false;
    }
    this.#pending.push(Object.freeze({ sequence: Math.trunc(input.sequence), tick: Math.trunc(input.tick), commandId: input.commandId.slice(0, 128) }));
    return true;
  }

  acknowledge(sequence: number, rttMs = this.#rttMs): void {
    this.#lastAck = Math.max(this.#lastAck, Math.trunc(finite(sequence)));
    this.#pending = this.#pending.filter(input => input.sequence > this.#lastAck);
    this.#rttMs = Math.max(0, finite(rttMs, this.#rttMs));
  }

  encodeSnapshot(tick: number, sequence: number, ack: number, entities: readonly NetworkEntity[]): NetworkSnapshot | null {
    if (entities.length > this.maxEntityCountPerPacket) {
      this.#dropped += 1;
      return null;
    }
    const sorted = entities.slice().sort((a, b) => a.id.localeCompare(b.id)).map(cloneNetworkEntity);
    const snapshot: NetworkSnapshot = Object.freeze({
      tick: Math.trunc(tick),
      sequence: Math.trunc(sequence),
      acknowledgedInputSequence: Math.trunc(ack),
      entities: Object.freeze(sorted),
      checksum: stableHash(sorted),
    });
    if (!withinBytes(snapshot, this.maxPacketBytes)) {
      this.#dropped += 1;
      return null;
    }
    this.#history.push(snapshot);
    this.trimHistory();
    this.#sent += 1;
    return snapshot;
  }

  receiveSnapshot(snapshot: NetworkSnapshot): boolean {
    if (snapshot.entities.length > this.maxEntityCountPerPacket) {
      this.#rejected += 1;
      return false;
    }
    if (!withinBytes(snapshot, this.maxPacketBytes)) {
      this.#rejected += 1;
      return false;
    }
    if (stableHash(snapshot.entities) !== snapshot.checksum) {
      this.#rejected += 1;
      return false;
    }
    const latest = this.latest();
    if (latest && snapshot.tick < latest.tick) {
      this.#rejected += 1;
      return false;
    }
    const normalized = Object.freeze({
      ...snapshot,
      tick: Math.trunc(snapshot.tick),
      sequence: Math.trunc(snapshot.sequence),
      acknowledgedInputSequence: Math.trunc(snapshot.acknowledgedInputSequence),
      entities: Object.freeze(snapshot.entities.slice().sort((a, b) => a.id.localeCompare(b.id)).map(cloneNetworkEntity)),
    });
    this.#history.push(normalized);
    this.trimHistory();
    this.#received += 1;
    this.acknowledge(normalized.acknowledgedInputSequence);
    return true;
  }

  latest(): NetworkSnapshot | null {
    return this.#history[this.#history.length - 1] ?? null;
  }

  atOrBefore(tick: number): NetworkSnapshot | null {
    const target = Math.trunc(tick);
    for (let index = this.#history.length - 1; index >= 0; index -= 1) {
      const snapshot = this.#history[index];
      if (snapshot && snapshot.tick <= target) return snapshot;
    }
    return null;
  }

  interpolationPair(tick: number): readonly [NetworkSnapshot | null, NetworkSnapshot | null] {
    const target = Math.trunc(tick);
    let older: NetworkSnapshot | null = null;
    let newer: NetworkSnapshot | null = null;
    for (const snapshot of this.#history) {
      if (snapshot.tick <= target) older = snapshot;
      else {
        newer = snapshot;
        break;
      }
    }
    return Object.freeze([older, newer]);
  }

  renderSnapshot(serverTick: number): NetworkSnapshot | null {
    return this.atOrBefore(Math.trunc(serverTick) - this.interpolationDelayTicks);
  }

  createDelta(base: NetworkSnapshot, target: NetworkSnapshot): NetworkDelta {
    const baseMap = new Map(base.entities.map(entity => [entity.id, entity]));
    const targetMap = new Map(target.entities.map(entity => [entity.id, entity]));
    const added: NetworkEntity[] = [];
    const changed: NetworkEntity[] = [];
    const removed: string[] = [];

    for (const entity of target.entities) {
      const previous = baseMap.get(entity.id);
      if (!previous) added.push(cloneNetworkEntity(entity));
      else if (stableHash(previous) !== stableHash(entity)) changed.push(cloneNetworkEntity(entity));
    }
    for (const entity of base.entities) {
      if (!targetMap.has(entity.id)) removed.push(entity.id);
    }

    const checksum = stableHash({ added, changed, removed: removed.slice().sort() });
    return Object.freeze({
      baseTick: base.tick,
      targetTick: target.tick,
      added: Object.freeze(added.sort((a, b) => a.id.localeCompare(b.id))),
      changed: Object.freeze(changed.sort((a, b) => a.id.localeCompare(b.id))),
      removed: Object.freeze(removed.sort()),
      checksum,
    });
  }

  applyDelta(base: NetworkSnapshot, delta: NetworkDelta): NetworkSnapshot | null {
    const expected = stableHash({ added: delta.added, changed: delta.changed, removed: delta.removed });
    if (delta.baseTick !== base.tick || expected !== delta.checksum) {
      this.#rejected += 1;
      return null;
    }
    const entities = new Map(base.entities.map(entity => [entity.id, cloneNetworkEntity(entity)]));
    for (const id of delta.removed) entities.delete(id);
    for (const entity of [...delta.added, ...delta.changed]) entities.set(entity.id, cloneNetworkEntity(entity));

    const sorted = [...entities.values()].sort((a, b) => a.id.localeCompare(b.id));
    const result: NetworkSnapshot = Object.freeze({
      tick: delta.targetTick,
      sequence: base.sequence + 1,
      acknowledgedInputSequence: this.#lastAck,
      entities: Object.freeze(sorted),
      checksum: stableHash(sorted),
    });
    return withinBytes(result, this.maxPacketBytes) ? result : this.rejectPacket();
  }

  reconcile(authoritative: NetworkSnapshot, predicted: NetworkSnapshot): ReconciliationResult {
    if (stableHash(authoritative.entities) !== authoritative.checksum || stableHash(predicted.entities) !== predicted.checksum) {
      return Object.freeze({
        accepted: false,
        rollbackRequired: false,
        commonTick: 0,
        corrections: Object.freeze([]),
        rejectedReason: 'checksum',
      });
    }
    if (authoritative.tick > predicted.tick) {
      return Object.freeze({
        accepted: false,
        rollbackRequired: true,
        commonTick: predicted.tick,
        corrections: Object.freeze([]),
        rejectedReason: 'authoritative-ahead',
      });
    }

    const local = new Map(predicted.entities.map(entity => [entity.id, entity]));
    const corrections: NetworkEntity[] = [];
    for (const entity of authoritative.entities) {
      const current = local.get(entity.id);
      if (!current || distanceSquared(current, entity) > 0.0001 || Math.abs(current.health - entity.health) > 0.01 || Math.abs(current.stamina - entity.stamina) > 0.01) {
        corrections.push(cloneNetworkEntity(entity));
      }
    }

    return Object.freeze({
      accepted: true,
      rollbackRequired: corrections.length > 0 || authoritative.tick < predicted.tick,
      commonTick: authoritative.tick,
      corrections: Object.freeze(corrections),
      rejectedReason: null,
    });
  }

  pendingInputs(): readonly PendingInput[] {
    return Object.freeze([...this.#pending]);
  }

  history(): readonly NetworkSnapshot[] {
    return Object.freeze([...this.#history]);
  }

  metrics(): NetworkMetrics {
    return Object.freeze({
      connected: this.#connected,
      sent: this.#sent,
      received: this.#received,
      dropped: this.#dropped,
      rejected: this.#rejected,
      pending: this.#pending.length,
      lastAck: this.#lastAck,
      rttMs: this.#rttMs,
    });
  }

  clearHistory(): void { this.#history = []; }

  private trimHistory(): void {
    if (this.#history.length > this.maxSnapshots) this.#history.splice(0, this.#history.length - this.maxSnapshots);
  }

  private rejectPacket(): null {
    this.#dropped += 1;
    return null;
  }
}

function distanceSquared(a: NetworkEntity, b: NetworkEntity): number {
  const x = a.position.x - b.position.x;
  const y = a.position.y - b.position.y;
  const z = a.position.z - b.position.z;
  return x * x + y * y + z * z;
}

function withinBytes(value: unknown, max: number): boolean {
  try {
    return JSON.stringify(value).length <= max;
  } catch {
    return false;
  }
}

export function lerpNetworkEntity(older: NetworkEntity, newer: NetworkEntity, alpha: number): NetworkEntity {
  const t = Math.min(1, Math.max(0, finite(alpha)));
  return Object.freeze({
    id: newer.id,
    revision: t < 1 ? older.revision : newer.revision,
    position: vec3(
      older.position.x + (newer.position.x - older.position.x) * t,
      older.position.y + (newer.position.y - older.position.y) * t,
      older.position.z + (newer.position.z - older.position.z) * t,
    ),
    velocity: vec3(
      older.velocity.x + (newer.velocity.x - older.velocity.x) * t,
      older.velocity.y + (newer.velocity.y - older.velocity.y) * t,
      older.velocity.z + (newer.velocity.z - older.velocity.z) * t,
    ),
    rotation: quat(
      older.rotation.x + (newer.rotation.x - older.rotation.x) * t,
      older.rotation.y + (newer.rotation.y - older.rotation.y) * t,
      older.rotation.z + (newer.rotation.z - older.rotation.z) * t,
      older.rotation.w + (newer.rotation.w - older.rotation.w) * t,
    ),
    health: older.health + (newer.health - older.health) * t,
    stamina: older.stamina + (newer.stamina - older.stamina) * t,
    flags: t < 1 ? older.flags : newer.flags,
  });
}
