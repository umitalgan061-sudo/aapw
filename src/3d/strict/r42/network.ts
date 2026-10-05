/**
 * Deterministic snapshot, delta, prediction and transport policy for R42.
 * Production TypeScript owner.
 */

import type { DeltaPacket, NetworkEntityState, SnapshotPacket, Transform, Velocity, CombatState } from './types.ts';
import { cloneCombat, cloneTransform, cloneVelocity, deepFreeze, hashValue, safeInteger, vec3, quat } from './types.ts';

export interface NetworkLimits {
  readonly maxSnapshots: number;
  readonly maxEntitiesPerSnapshot: number;
  readonly maxPacketBytes: number;
  readonly maxInputHistory: number;
  readonly maxRttMs: number;
}

export const DEFAULT_R42_NETWORK_LIMITS: NetworkLimits = Object.freeze({
  maxSnapshots: 64,
  maxEntitiesPerSnapshot: 8192,
  maxPacketBytes: 128 * 1024,
  maxInputHistory: 256,
  maxRttMs: 5000,
});

export interface PredictionFrame {
  readonly sequence: number;
  readonly tick: number;
  readonly inputChecksum: number;
}

export class NetworkAuthorityR42 {
  readonly limits: NetworkLimits;
  #snapshots: SnapshotPacket[] = [];
  #prediction: PredictionFrame[] = [];
  #lastSequence = -1;

  constructor(limits: Partial<NetworkLimits> = {}) {
    this.limits = Object.freeze({ ...DEFAULT_R42_NETWORK_LIMITS, ...limits });
  }

  buildSnapshot(
    tick: number,
    sequence: number,
    acknowledgedInput: number,
    entities: readonly NetworkEntityState[],
  ): SnapshotPacket {
    const normalized = entities
      .slice(0, this.limits.maxEntitiesPerSnapshot)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(normalizeNetworkEntity);
    const packet = deepFreeze({
      protocol: 42 as const,
      tick: safeInteger(tick),
      sequence: safeInteger(sequence),
      acknowledgedInput: safeInteger(acknowledgedInput, -1),
      entities: normalized,
      checksum: hashValue(normalized),
    });
    this.#snapshots.push(packet);
    if (this.#snapshots.length > this.limits.maxSnapshots) this.#snapshots.shift();
    this.#lastSequence = Math.max(this.#lastSequence, packet.sequence);
    return packet;
  }

  buildDelta(base: SnapshotPacket, target: SnapshotPacket): DeltaPacket {
    const baseMap = new Map(base.entities.map(entity => [entity.id, entity]));
    const targetMap = new Map(target.entities.map(entity => [entity.id, entity]));
    const added: NetworkEntityState[] = [];
    const changed: NetworkEntityState[] = [];
    const removed: string[] = [];

    for (const entity of target.entities) {
      const previous = baseMap.get(entity.id);
      if (!previous) added.push(entity);
      else if (hashValue(previous) !== hashValue(entity)) changed.push(entity);
    }
    for (const entity of base.entities) {
      if (!targetMap.has(entity.id)) removed.push(entity.id);
    }

    return deepFreeze({
      protocol: 42 as const,
      baseTick: base.tick,
      targetTick: target.tick,
      sequence: target.sequence,
      added: added.sort((a, b) => a.id.localeCompare(b.id)),
      changed: changed.sort((a, b) => a.id.localeCompare(b.id)),
      removed: removed.sort(),
      checksum: hashValue({ added, changed, removed }),
    });
  }

  applyDelta(base: SnapshotPacket, delta: DeltaPacket): SnapshotPacket {
    if (base.tick !== delta.baseTick) throw new Error('R42 delta base tick mismatch.');
    const map = new Map(base.entities.map(entity => [entity.id, entity]));
    for (const id of delta.removed) map.delete(id);
    for (const entity of delta.added) map.set(entity.id, normalizeNetworkEntity(entity));
    for (const entity of delta.changed) map.set(entity.id, normalizeNetworkEntity(entity));

    return deepFreeze({
      protocol: 42,
      tick: delta.targetTick,
      sequence: delta.sequence,
      acknowledgedInput: base.acknowledgedInput,
      entities: [...map.values()].sort((a, b) => a.id.localeCompare(b.id)),
      checksum: hashValue([...map.values()]),
    });
  }

  recordPrediction(sequence: number, tick: number, input: unknown): void {
    this.#prediction.push({
      sequence: safeInteger(sequence),
      tick: safeInteger(tick),
      inputChecksum: hashValue(input),
    });
    if (this.#prediction.length > this.limits.maxInputHistory) this.#prediction.shift();
  }

  reconcile(authoritative: SnapshotPacket): readonly PredictionFrame[] {
    const acknowledged = authoritative.acknowledgedInput;
    const replay = this.#prediction.filter(frame => frame.sequence > acknowledged);
    this.#prediction = replay.slice();
    return Object.freeze([...replay]);
  }

  snapshotHistory(): readonly SnapshotPacket[] {
    return Object.freeze([...this.#snapshots]);
  }

  latest(): SnapshotPacket | null {
    return this.#snapshots[this.#snapshots.length - 1] ?? null;
  }

  validatePacket(payload: unknown): payload is SnapshotPacket | DeltaPacket {
    if (!payload || typeof payload !== 'object') return false;
    const objectValue = payload as Record<string, unknown>;
    return objectValue.protocol === 42
      && typeof objectValue.tick === 'number'
      && Number.isSafeInteger(objectValue.tick)
      && Array.isArray(objectValue.entities ?? objectValue.added)
      && hashValue(payload) >= 0;
  }

  get lastSequence(): number {
    return this.#lastSequence;
  }
}

function normalizeNetworkEntity(entity: NetworkEntityState): NetworkEntityState {
  return deepFreeze({
    id: String(entity.id).slice(0, 128),
    revision: safeInteger(entity.revision),
    transform: cloneTransform(entity.transform),
    velocity: cloneVelocity(entity.velocity),
    combat: cloneCombat(entity.combat),
    flags: safeInteger(entity.flags),
  });
}
