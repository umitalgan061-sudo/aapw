import { EntityId, EntityRecord, NetworkDelta, NetworkSnapshot, Tick, checksumObject, asTick, cloneEntity } from './domain.ts';

export interface NetworkLimits {
  readonly maxEntities: number;
  readonly maxBytesPerTick: number;
  readonly maxHistory: number;
  readonly maxDeltaEntities: number;
}

export const DEFAULT_NETWORK_LIMITS: NetworkLimits = Object.freeze({
  maxEntities: 20_000,
  maxBytesPerTick: 256 * 1024,
  maxHistory: 120,
  maxDeltaEntities: 2_048,
});

export interface PacketHeader {
  readonly protocol: 5;
  readonly sequence: number;
  readonly tick: Tick;
  readonly payloadBytes: number;
  readonly checksum: string;
}

export interface NetworkPacket<TPayload> {
  readonly header: PacketHeader;
  readonly payload: TPayload;
}

export interface PredictionFrame {
  readonly tick: Tick;
  readonly input: Readonly<Record<string, number | boolean>>;
  readonly checksum: string;
}

export interface ReconciliationResult {
  readonly fromTick: Tick;
  readonly toTick: Tick;
  readonly correctedEntities: number;
  readonly replayedInputs: number;
  readonly accepted: boolean;
}

export class SnapshotHistoryV5 {
  readonly #snapshots: NetworkSnapshot[] = [];
  readonly maxHistory: number;

  constructor(maxHistory = DEFAULT_NETWORK_LIMITS.maxHistory) {
    this.maxHistory = Math.max(1, Math.trunc(maxHistory));
  }

  push(snapshot: NetworkSnapshot): void {
    const copy: NetworkSnapshot = { ...snapshot, entities: snapshot.entities.map(cloneEntity) };
    this.#snapshots.push(copy);
    if (this.#snapshots.length > this.maxHistory) this.#snapshots.splice(0, this.#snapshots.length - this.maxHistory);
  }

  latest(): NetworkSnapshot | undefined {
    const value = this.#snapshots.at(-1);
    return value ? { ...value, entities: value.entities.map(cloneEntity) } : undefined;
  }

  get(sequence: number): NetworkSnapshot | undefined {
    const value = this.#snapshots.find((snapshot) => snapshot.sequence === sequence);
    return value ? { ...value, entities: value.entities.map(cloneEntity) } : undefined;
  }

  between(fromTick: Tick, toTick: Tick): readonly NetworkSnapshot[] {
    return this.#snapshots.filter((snapshot) => Number(snapshot.tick) >= Number(fromTick) && Number(snapshot.tick) <= Number(toTick)).map((snapshot) => ({ ...snapshot, entities: snapshot.entities.map(cloneEntity) }));
  }

  clear(): void { this.#snapshots.length = 0; }
  size(): number { return this.#snapshots.length; }
}

export class DeltaCodecV5 {
  readonly #limits: NetworkLimits;

  constructor(limits: Partial<NetworkLimits> = {}) {
    this.#limits = { ...DEFAULT_NETWORK_LIMITS, ...limits };
  }

  encode(base: NetworkSnapshot | undefined, current: NetworkSnapshot): NetworkDelta {
    if (current.entities.length > this.#limits.maxEntities) throw new Error('network snapshot entity cap exceeded');
    const baseMap = new Map<EntityId, EntityRecord>((base?.entities ?? []).map((entity) => [entity.id, entity]));
    const currentMap = new Map<EntityId, EntityRecord>(current.entities.map((entity) => [entity.id, entity]));
    const upserts: EntityRecord[] = [];
    for (const entity of current.entities) {
      const previous = baseMap.get(entity.id);
      if (!previous || checksumObject(previous) !== checksumObject(entity)) upserts.push(cloneEntity(entity));
      if (upserts.length > this.#limits.maxDeltaEntities) throw new Error('network delta entity cap exceeded');
    }
    const removes = [...baseMap.keys()].filter((id) => !currentMap.has(id)).sort((a, b) => Number(a) - Number(b));
    return { baseSequence: base?.sequence ?? 0, sequence: current.sequence, tick: current.tick, upserts, removes };
  }

  apply(base: NetworkSnapshot, delta: NetworkDelta): NetworkSnapshot {
    if (delta.baseSequence !== base.sequence) throw new Error(`delta base mismatch: expected ${base.sequence}, received ${delta.baseSequence}`);
    const map = new Map<EntityId, EntityRecord>(base.entities.map((entity) => [entity.id, cloneEntity(entity)]));
    for (const id of delta.removes) map.delete(id);
    for (const entity of delta.upserts) map.set(entity.id, cloneEntity(entity));
    if (map.size > this.#limits.maxEntities) throw new Error('network snapshot entity cap exceeded after delta');
    return { sequence: delta.sequence, tick: delta.tick, authoritative: base.authoritative, entities: [...map.values()].sort((a, b) => Number(a.id) - Number(b.id)) };
  }

  estimateBytes(value: unknown): number {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  }

  validateBudget(value: unknown): boolean {
    return this.estimateBytes(value) <= this.#limits.maxBytesPerTick;
  }
}

export class PredictionBufferV5 {
  readonly #frames: PredictionFrame[] = [];
  constructor(readonly maxFrames = 240) {}

  push(tick: Tick | number, input: Readonly<Record<string, number | boolean>>): PredictionFrame {
    const frame: PredictionFrame = { tick: asTick(Number(tick)), input: { ...input }, checksum: checksumObject(input) };
    this.#frames.push(frame);
    if (this.#frames.length > this.maxFrames) this.#frames.splice(0, this.#frames.length - this.maxFrames);
    return frame;
  }

  after(tick: Tick): readonly PredictionFrame[] {
    return this.#frames.filter((frame) => Number(frame.tick) > Number(tick)).map((frame) => ({ ...frame, input: { ...frame.input } }));
  }

  beforeOrAt(tick: Tick): PredictionFrame | undefined {
    return [...this.#frames].reverse().find((frame) => Number(frame.tick) <= Number(tick));
  }

  removeThrough(tick: Tick): number {
    const before = this.#frames.length;
    while (this.#frames[0] && Number(this.#frames[0].tick) <= Number(tick)) this.#frames.shift();
    return before - this.#frames.length;
  }

  clear(): void { this.#frames.length = 0; }
  size(): number { return this.#frames.length; }
}

export class ReconcilerV5 {
  constructor(private readonly history: SnapshotHistoryV5, private readonly predictions: PredictionBufferV5) {}

  reconcile(server: NetworkSnapshot, local: NetworkSnapshot, apply: (snapshot: NetworkSnapshot) => void, replay: (frame: PredictionFrame) => void): ReconciliationResult {
    const historical = this.history.get(server.sequence);
    const fromTick = historical?.tick ?? local.tick;
    apply(server);
    const inputs = this.predictions.after(server.tick);
    for (const frame of inputs) replay(frame);
    return {
      fromTick,
      toTick: server.tick,
      correctedEntities: server.entities.length,
      replayedInputs: inputs.length,
      accepted: server.tick >= fromTick,
    };
  }
}

export class NetworkStateV5 {
  #sequence = 0;
  readonly history: SnapshotHistoryV5;
  readonly codec: DeltaCodecV5;
  readonly predictions: PredictionBufferV5;

  constructor(limits: Partial<NetworkLimits> = {}) {
    this.history = new SnapshotHistoryV5(limits.maxHistory);
    this.codec = new DeltaCodecV5(limits);
    this.predictions = new PredictionBufferV5();
  }

  nextSequence(): number { this.#sequence += 1; return this.#sequence; }

  snapshot(tick: Tick, entities: readonly EntityRecord[], authoritative = false): NetworkSnapshot {
    if (entities.length > DEFAULT_NETWORK_LIMITS.maxEntities) throw new Error('snapshot entity cap exceeded');
    const snapshot = { sequence: this.nextSequence(), tick, authoritative, entities: entities.map(cloneEntity) } satisfies NetworkSnapshot;
    this.history.push(snapshot);
    return snapshot;
  }

  delta(current: NetworkSnapshot): NetworkDelta {
    return this.codec.encode(this.history.get(current.sequence - 1), current);
  }

  packet<T>(sequence: number, tick: Tick, payload: T): NetworkPacket<T> {
    const payloadBytes = this.codec.estimateBytes(payload);
    const header: PacketHeader = { protocol: 5, sequence, tick, payloadBytes, checksum: checksumObject(payload) };
    if (payloadBytes > DEFAULT_NETWORK_LIMITS.maxBytesPerTick) throw new Error('packet exceeds byte budget');
    return { header, payload };
  }
}
