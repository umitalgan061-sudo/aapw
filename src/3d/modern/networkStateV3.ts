/**
 * Deterministic replication state for AAPW v3.
 *
 * The replication layer does not transmit renderer state. It operates on compact, versioned values,
 * keeps sequence numbers monotonic, detects gaps, and produces a stable digest for desynchronisation
 * diagnostics. Reliable transport, unreliable transport, WebSocket or WebRTC can sit above it.
 */

export type ReplicatedEntityId = number & { readonly __brand: 'ReplicatedEntityId' };
export type ReplicatedField = 'position' | 'rotation' | 'velocity' | 'health' | 'stamina' | 'flags';

export interface NetworkTransformV3 { x: number; y: number; z: number; yaw: number; pitch: number; }
export interface ReplicatedEntityV3 {
  readonly id: ReplicatedEntityId;
  readonly revision: number;
  readonly fields: Readonly<Partial<Record<ReplicatedField, number | NetworkTransformV3>>>;
}
export interface StateFrameV3 {
  readonly protocol: 3;
  readonly tick: number;
  readonly sequence: number;
  readonly checksum: string;
  readonly entities: readonly ReplicatedEntityV3[];
}
export interface StateDeltaV3 {
  readonly protocol: 3;
  readonly baseSequence: number;
  readonly sequence: number;
  readonly tick: number;
  readonly upserts: readonly ReplicatedEntityV3[];
  readonly removals: readonly ReplicatedEntityId[];
}
export interface ApplyDeltaResultV3 { applied: boolean; reason: string; changedEntities: number; removedEntities: number; }
export interface ReplicationMetricsV3 {
  framesBuilt: number;
  deltasBuilt: number;
  deltasApplied: number;
  gapsDetected: number;
  rejectedFrames: number;
  rejectedDeltas: number;
  bytesEstimated: number;
}

const entityId = (value: number): ReplicatedEntityId => value as ReplicatedEntityId;
const finite = (value: number): boolean => Number.isFinite(value);

const stable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(object).sort().map((key) => [key, stable(object[key])]));
  }
  return value;
};

const digest = (value: unknown): string => {
  const text = JSON.stringify(stable(value));
  let h1 = 2166136261;
  let h2 = 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 ^= code;
    h1 = Math.imul(h1, 16777619);
    h2 ^= code + index;
    h2 = Math.imul(h2 ^ (h2 >>> 15), 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
};

const cloneEntity = (entity: ReplicatedEntityV3): ReplicatedEntityV3 => ({
  id: entity.id,
  revision: entity.revision,
  fields: stable(entity.fields) as ReplicatedEntityV3['fields'],
});

export class ReplicationStateV3 {
  #entities = new Map<ReplicatedEntityId, ReplicatedEntityV3>();
  #sequence = 0;
  #tick = 0;
  #history = new Map<number, StateFrameV3>();
  #maxHistory: number;
  #metrics: ReplicationMetricsV3 = {
    framesBuilt: 0,
    deltasBuilt: 0,
    deltasApplied: 0,
    gapsDetected: 0,
    rejectedFrames: 0,
    rejectedDeltas: 0,
    bytesEstimated: 0,
  };

  constructor(maxHistory = 32) { this.#maxHistory = Math.max(2, Math.floor(maxHistory)); }

  upsert(entity: ReplicatedEntityV3): void {
    this.#validateEntity(entity);
    const existing = this.#entities.get(entity.id);
    if (existing && entity.revision < existing.revision) return;
    this.#entities.set(entity.id, cloneEntity(entity));
  }

  remove(id: ReplicatedEntityId, revision = Number.MAX_SAFE_INTEGER): boolean {
    const existing = this.#entities.get(id);
    if (!existing || revision < existing.revision) return false;
    return this.#entities.delete(id);
  }

  buildFrame(tick: number): StateFrameV3 {
    if (!Number.isInteger(tick) || tick < 0) throw new RangeError('tick must be non-negative integer');
    this.#tick = tick;
    this.#sequence += 1;
    const entities = [...this.#entities.values()].sort((a, b) => a.id - b.id).map(cloneEntity);
    const frame: StateFrameV3 = Object.freeze({
      protocol: 3,
      tick,
      sequence: this.#sequence,
      checksum: digest(entities),
      entities: Object.freeze(entities),
    });
    this.#history.set(frame.sequence, frame);
    while (this.#history.size > this.#maxHistory) {
      const first = this.#history.keys().next().value;
      if (first !== undefined) this.#history.delete(first);
    }
    this.#metrics.framesBuilt += 1;
    this.#metrics.bytesEstimated += JSON.stringify(frame).length;
    return frame;
  }

  buildDelta(fromSequence: number, tick: number): StateDeltaV3 {
    const base = this.#history.get(fromSequence);
    if (!base) throw new Error(`Unknown replication base sequence: ${fromSequence}`);
    const latest = this.buildFrame(tick);
    const previous = new Map(base.entities.map((entity) => [entity.id, entity]));
    const upserts: ReplicatedEntityV3[] = [];
    for (const entity of latest.entities) {
      const before = previous.get(entity.id);
      if (!before || before.revision !== entity.revision || JSON.stringify(before.fields) !== JSON.stringify(entity.fields)) upserts.push(cloneEntity(entity));
      previous.delete(entity.id);
    }
    const removals = [...previous.keys()].sort((a, b) => a - b);
    const delta: StateDeltaV3 = Object.freeze({ protocol: 3, baseSequence: fromSequence, sequence: latest.sequence, tick, upserts: Object.freeze(upserts), removals: Object.freeze(removals) });
    this.#metrics.deltasBuilt += 1;
    this.#metrics.bytesEstimated += JSON.stringify(delta).length;
    return delta;
  }

  applyFrame(frame: StateFrameV3): boolean {
    if (!this.#validateFrame(frame)) { this.#metrics.rejectedFrames += 1; return false; }
    if (frame.sequence <= this.#sequence) return false;
    if (frame.sequence > this.#sequence + 1 && this.#sequence !== 0) this.#metrics.gapsDetected += 1;
    this.#entities.clear();
    for (const entity of frame.entities) this.#entities.set(entity.id, cloneEntity(entity));
    this.#sequence = frame.sequence;
    this.#tick = frame.tick;
    this.#history.set(frame.sequence, frame);
    this.#metrics.bytesEstimated += JSON.stringify(frame).length;
    return true;
  }

  applyDelta(delta: StateDeltaV3): ApplyDeltaResultV3 {
    if (!this.#validateDelta(delta)) {
      this.#metrics.rejectedDeltas += 1;
      return { applied: false, reason: 'invalid', changedEntities: 0, removedEntities: 0 };
    }
    if (delta.baseSequence !== this.#sequence) {
      this.#metrics.gapsDetected += delta.baseSequence > this.#sequence ? 1 : 0;
      return { applied: false, reason: delta.baseSequence > this.#sequence ? 'gap' : 'stale', changedEntities: 0, removedEntities: 0 };
    }
    let changed = 0;
    for (const entity of delta.upserts) {
      const before = this.#entities.get(entity.id);
      if (!before || entity.revision >= before.revision) {
        this.#entities.set(entity.id, cloneEntity(entity));
        changed += 1;
      }
    }
    let removed = 0;
    for (const id of delta.removals) if (this.#entities.delete(id)) removed += 1;
    this.#sequence = delta.sequence;
    this.#tick = delta.tick;
    this.#metrics.deltasApplied += 1;
    return { applied: true, reason: 'ok', changedEntities: changed, removedEntities: removed };
  }

  entities(): readonly ReplicatedEntityV3[] {
    return Object.freeze([...this.#entities.values()].sort((a, b) => a.id - b.id).map(cloneEntity));
  }

  get sequence(): number { return this.#sequence; }
  get tick(): number { return this.#tick; }
  checksum(): string { return digest(this.entities()); }
  metrics(): ReplicationMetricsV3 { return { ...this.#metrics }; }

  #validateEntity(entity: ReplicatedEntityV3): void {
    if (!Number.isInteger(entity.id) || entity.id < 0) throw new Error('Invalid replicated entity id');
    if (!Number.isInteger(entity.revision) || entity.revision < 0) throw new Error('Invalid entity revision');
    for (const [field, value] of Object.entries(entity.fields)) {
      if (!(field === 'position' || field === 'rotation' || field === 'velocity' || field === 'health' || field === 'stamina' || field === 'flags')) throw new Error(`Unknown replicated field: ${field}`);
      if (typeof value === 'number' && !finite(value)) throw new Error(`Invalid replicated number: ${field}`);
    }
  }

  #validateFrame(frame: StateFrameV3): boolean {
    if (frame.protocol !== 3 || !Number.isInteger(frame.tick) || frame.tick < 0 || !Number.isInteger(frame.sequence) || frame.sequence < 1) return false;
    if (!Array.isArray(frame.entities)) return false;
    if (frame.entities.length > 20000) return false;
    try {
      for (const entity of frame.entities) this.#validateEntity(entity);
    } catch { return false; }
    return digest(frame.entities) === frame.checksum;
  }

  #validateDelta(delta: StateDeltaV3): boolean {
    if (delta.protocol !== 3 || !Number.isInteger(delta.baseSequence) || delta.baseSequence < 0 || !Number.isInteger(delta.sequence) || delta.sequence <= delta.baseSequence) return false;
    if (!Array.isArray(delta.upserts) || !Array.isArray(delta.removals) || delta.upserts.length + delta.removals.length > 20000) return false;
    const ids = new Set<number>();
    try { for (const entity of delta.upserts) { this.#validateEntity(entity); ids.add(entity.id); } } catch { return false; }
    for (const id of delta.removals) if (!Number.isInteger(id) || id < 0 || ids.has(id)) return false;
    return true;
  }
}

export const createReplicationStateV3 = (): ReplicationStateV3 => new ReplicationStateV3();
