import { EntityId, NetworkDelta, NetworkEntityState, NetworkSnapshot, Tick, asTick, clamp, hashString, lerp3, stableJson, Vec3, IDENTITY_QUAT } from './contracts.ts';

export interface PredictionCommand {
  readonly clientSequence: number;
  readonly tick: Tick;
  readonly move: Vec3;
  readonly yawDelta: number;
  readonly buttons: number;
}

export interface InterpolationSample {
  readonly tick: Tick;
  readonly serverTime: number;
  readonly state: NetworkEntityState;
}

export interface ReconciliationResult {
  readonly corrected: boolean;
  readonly correctionDistance: number;
  readonly replayedCommands: number;
  readonly authoritativeTick: Tick;
}

export interface NetworkMetrics {
  readonly sentBytes: number;
  readonly receivedBytes: number;
  readonly snapshots: number;
  readonly deltas: number;
  readonly corrections: number;
  readonly rejectedPackets: number;
  readonly rttMs: number;
  readonly jitterMs: number;
}

const entityKey = (entity: EntityId): number => Number(entity);

export const snapshotChecksum = (snapshot: Omit<NetworkSnapshot, 'checksum'>): string => hashString(stableJson({ tick: snapshot.tick, ack: snapshot.ack, serverTime: snapshot.serverTime, entities: [...snapshot.entities].sort((a, b) => entityKey(a.entity) - entityKey(b.entity)) }));

export const createSnapshot = (tick: Tick, ack: number, serverTime: number, entities: readonly NetworkEntityState[]): NetworkSnapshot => {
  const normalized = Object.freeze([...entities].sort((a, b) => entityKey(a.entity) - entityKey(b.entity)).map((entity) => Object.freeze({ ...entity, position: Object.freeze({ ...entity.position }), rotation: Object.freeze({ ...entity.rotation }), velocity: Object.freeze({ ...entity.velocity }) })));
  const partial = { tick, ack: Math.max(0, Math.floor(ack)), serverTime: Number.isFinite(serverTime) ? serverTime : 0, entities: normalized };
  return Object.freeze({ ...partial, checksum: snapshotChecksum(partial) });
};

export const createDelta = (base: NetworkSnapshot, target: NetworkSnapshot): NetworkDelta => {
  const previous = new Map(base.entities.map((entity) => [entityKey(entity.entity), entity]));
  const next = new Map(target.entities.map((entity) => [entityKey(entity.entity), entity]));
  const added: NetworkEntityState[] = [];
  const changed: NetworkEntityState[] = [];
  const removed: EntityId[] = [];
  for (const [id, entity] of next) {
    const before = previous.get(id);
    if (!before) added.push(entity);
    else if (entity.revision !== before.revision || entity.flags !== before.flags || JSON.stringify(entity.position) !== JSON.stringify(before.position) || JSON.stringify(entity.velocity) !== JSON.stringify(before.velocity) || JSON.stringify(entity.rotation) !== JSON.stringify(before.rotation)) changed.push(entity);
  }
  for (const [id, entity] of previous) if (!next.has(id)) removed.push(entity.entity);
  const payload = { baseTick: base.tick, targetTick: target.tick, added, removed: removed.sort((a, b) => Number(a) - Number(b)), changed, unchangedCount: Math.max(0, previous.size - changed.length - removed.length) };
  return Object.freeze({ ...payload, checksum: hashString(stableJson(payload)) });
};

export const applyDelta = (base: NetworkSnapshot, delta: NetworkDelta): NetworkSnapshot => {
  if (base.tick !== delta.baseTick) throw new Error(`delta base tick mismatch: expected ${base.tick}, got ${delta.baseTick}`);
  const entities = new Map(base.entities.map((entity) => [entityKey(entity.entity), entity]));
  for (const entity of delta.removed) entities.delete(entityKey(entity));
  for (const entity of delta.changed) entities.set(entityKey(entity.entity), entity);
  for (const entity of delta.added) entities.set(entityKey(entity.entity), entity);
  return createSnapshot(delta.targetTick, base.ack, base.serverTime, [...entities.values()]);
};

export class SnapshotHistory {
  readonly #capacity: number;
  readonly #snapshots: NetworkSnapshot[] = [];

  constructor(capacity = 64) { this.#capacity = Math.max(2, Math.floor(capacity)); }
  push(snapshot: NetworkSnapshot): void { this.#snapshots.push(snapshot); if (this.#snapshots.length > this.#capacity) this.#snapshots.splice(0, this.#snapshots.length - this.#capacity); }
  get(tick: Tick): NetworkSnapshot | undefined { return this.#snapshots.find((snapshot) => snapshot.tick === tick); }
  latest(): NetworkSnapshot | undefined { return this.#snapshots.at(-1); }
  oldest(): NetworkSnapshot | undefined { return this.#snapshots[0]; }
  values(): readonly NetworkSnapshot[] { return Object.freeze([...this.#snapshots]); }
  clear(): void { this.#snapshots.length = 0; }
}

export class PredictionBuffer {
  readonly #capacity: number;
  readonly #commands: PredictionCommand[] = [];
  constructor(capacity = 256) { this.#capacity = Math.max(8, Math.floor(capacity)); }
  push(command: PredictionCommand): void { this.#commands.push(Object.freeze({ ...command })); if (this.#commands.length > this.#capacity) this.#commands.splice(0, this.#commands.length - this.#capacity); }
  since(tick: Tick): readonly PredictionCommand[] { return Object.freeze(this.#commands.filter((command) => command.tick >= tick)); }
  removeThrough(tick: Tick): void { let index = 0; while (index < this.#commands.length && this.#commands[index]!.tick <= tick) index += 1; if (index > 0) this.#commands.splice(0, index); }
  values(): readonly PredictionCommand[] { return Object.freeze([...this.#commands]); }
}

export class RemoteInterpolationBuffer {
  readonly #capacity: number;
  readonly #samples: InterpolationSample[] = [];
  #delayMs: number;

  constructor(capacity = 32, interpolationDelayMs = 100) { this.#capacity = Math.max(4, Math.floor(capacity)); this.#delayMs = clamp(interpolationDelayMs, 0, 500); }
  add(sample: InterpolationSample): void { this.#samples.push(Object.freeze({ ...sample })); this.#samples.sort((a, b) => a.serverTime - b.serverTime || a.tick - b.tick); while (this.#samples.length > this.#capacity) this.#samples.shift(); }
  setDelay(ms: number): void { this.#delayMs = clamp(ms, 0, 500); }

  sample(renderServerTime: number): NetworkEntityState | undefined {
    if (this.#samples.length === 0) return undefined;
    const target = renderServerTime - this.#delayMs;
    let before: InterpolationSample | undefined;
    let after: InterpolationSample | undefined;
    for (const sample of this.#samples) {
      if (sample.serverTime <= target) before = sample;
      if (sample.serverTime >= target) { after = sample; break; }
    }
    if (!before) return this.#samples[0]!.state;
    if (!after || after === before) return before.state;
    const span = Math.max(0.001, after.serverTime - before.serverTime);
    const t = clamp((target - before.serverTime) / span, 0, 1);
    return Object.freeze({ ...after.state, position: lerp3(before.state.position, after.state.position, t), velocity: lerp3(before.state.velocity, after.state.velocity, t) });
  }

  clear(): void { this.#samples.length = 0; }
  get size(): number { return this.#samples.length; }
}

export interface ReconcilerOptions {
  readonly positionTolerance?: number;
  readonly maxReplayCommands?: number;
}

export class ClientReconciler {
  readonly #tolerance: number;
  readonly #maxReplay: number;
  #corrections = 0;

  constructor(options: ReconcilerOptions = {}) { this.#tolerance = Math.max(0, options.positionTolerance ?? 0.15); this.#maxReplay = Math.max(0, Math.floor(options.maxReplayCommands ?? 128)); }

  reconcile(predicted: NetworkEntityState, authoritative: NetworkEntityState, commands: readonly PredictionCommand[], apply: (state: NetworkEntityState, command: PredictionCommand) => NetworkEntityState): ReconciliationResult {
    const dx = predicted.position.x - authoritative.position.x;
    const dy = predicted.position.y - authoritative.position.y;
    const dz = predicted.position.z - authoritative.position.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance <= this.#tolerance) return Object.freeze({ corrected: false, correctionDistance: distance, replayedCommands: 0, authoritativeTick: asTick(0) });
    let state = authoritative;
    const replay = commands.slice(0, this.#maxReplay);
    for (const command of replay) state = apply(state, command);
    this.#corrections += 1;
    return Object.freeze({ corrected: true, correctionDistance: distance, replayedCommands: replay.length, authoritativeTick: asTick(replay.at(-1)?.tick ?? 0) });
  }

  corrections(): number { return this.#corrections; }
}

export class NetworkSession {
  readonly #history: SnapshotHistory;
  readonly #prediction: PredictionBuffer;
  readonly #interpolation: RemoteInterpolationBuffer;
  readonly #mode: 'client' | 'host' | 'server';
  #metrics: NetworkMetrics = Object.freeze({ sentBytes: 0, receivedBytes: 0, snapshots: 0, deltas: 0, corrections: 0, rejectedPackets: 0, rttMs: 0, jitterMs: 0 });
  #lastRtt = 0;

  constructor(mode: 'client' | 'host' | 'server', capacity = 64) { this.#mode = mode; this.#history = new SnapshotHistory(capacity); this.#prediction = new PredictionBuffer(); this.#interpolation = new RemoteInterpolationBuffer(); }

  recordOutgoing(snapshot: NetworkSnapshot, bytes = 0): void { this.#history.push(snapshot); this.#metrics = Object.freeze({ ...this.#metrics, sentBytes: this.#metrics.sentBytes + Math.max(0, bytes), snapshots: this.#metrics.snapshots + 1 }); }
  receive(snapshot: NetworkSnapshot, bytes = 0): boolean { if (snapshot.checksum !== snapshotChecksum(snapshot)) { this.#metrics = Object.freeze({ ...this.#metrics, rejectedPackets: this.#metrics.rejectedPackets + 1 }); return false; } this.#history.push(snapshot); this.#metrics = Object.freeze({ ...this.#metrics, receivedBytes: this.#metrics.receivedBytes + Math.max(0, bytes), snapshots: this.#metrics.snapshots + 1 }); return true; }
  recordDelta(delta: NetworkDelta, bytes = 0): void { void delta; this.#metrics = Object.freeze({ ...this.#metrics, receivedBytes: this.#metrics.receivedBytes + Math.max(0, bytes), deltas: this.#metrics.deltas + 1 }); }
  addRemoteSample(sample: InterpolationSample): void { this.#interpolation.add(sample); }
  predict(command: PredictionCommand): void { this.#prediction.push(command); }
  sampleRemote(serverTime: number): NetworkEntityState | undefined { return this.#interpolation.sample(serverTime); }
  acknowledge(tick: Tick): void { this.#prediction.removeThrough(tick); }
  recordRtt(rttMs: number): void { const rtt = Math.max(0, rttMs); const jitter = Math.abs(rtt - this.#lastRtt); this.#metrics = Object.freeze({ ...this.#metrics, rttMs: this.#metrics.rttMs * 0.8 + rtt * 0.2, jitterMs: this.#metrics.jitterMs * 0.8 + jitter * 0.2 }); this.#lastRtt = rtt; }
  latest(): NetworkSnapshot | undefined { return this.#history.latest(); }
  metrics(): NetworkMetrics { return this.#metrics; }
  mode(): typeof this.#mode { return this.#mode; }
  clear(): void { this.#history.clear(); this.#prediction.removeThrough(Number.MAX_SAFE_INTEGER as Tick); this.#interpolation.clear(); }
}

export const makeEmptyNetworkEntity = (entity: EntityId): NetworkEntityState => Object.freeze({ entity, revision: 0, position: { x: 0, y: 0, z: 0 }, rotation: IDENTITY_QUAT, velocity: { x: 0, y: 0, z: 0 }, flags: 0 });
