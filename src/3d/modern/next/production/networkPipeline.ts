import { checksumP, integerP, nonNegativeP, type EventSinkP, type NetworkEnvelopeP, type SnapshotActorP, type SnapshotDeltaP, type SnapshotEntityP, type TransportState, type WorldSnapshotP } from './contracts.ts';

export interface NetworkPipelineConfigP {
  readonly sessionId: string;
  readonly maxQueue: number;
  readonly maxHistory: number;
  readonly maxPayloadBytes: number;
  readonly maxFutureTicks: number;
  readonly maxSnapshotAgeTicks: number;
}

export interface NetworkPipelineStatsP {
  readonly state: TransportState;
  readonly queued: number;
  readonly inFlight: number;
  readonly acked: number;
  readonly dropped: number;
  readonly duplicatePackets: number;
  readonly snapshots: number;
  readonly bytesQueued: number;
  readonly checksum: number;
}

export interface PendingPacketP {
  readonly envelope: NetworkEnvelopeP;
  readonly createdTick: number;
  readonly bytes: number;
}

const DEFAULTS: NetworkPipelineConfigP = Object.freeze({ sessionId: 'aapw-local', maxQueue: 512, maxHistory: 128, maxPayloadBytes: 128 * 1024, maxFutureTicks: 8, maxSnapshotAgeTicks: 120 });

export class ProductionNetworkPipeline {
  readonly config: NetworkPipelineConfigP;
  readonly #events?: EventSinkP;
  readonly #reliable: PendingPacketP[] = [];
  readonly #history: WorldSnapshotP[] = [];
  readonly #seenSequences = new Set<number>();
  #state: TransportState = 'offline';
  #nextSequence = 1;
  #highestReceived = 0;
  #acked = 0;
  #dropped = 0;
  #duplicates = 0;
  #snapshotCount = 0;

  constructor(config: Partial<NetworkPipelineConfigP> = {}, events?: EventSinkP) {
    this.config = Object.freeze({ sessionId: (config.sessionId ?? DEFAULTS.sessionId).slice(0, 80), maxQueue: Math.max(16, integerP(config.maxQueue ?? DEFAULTS.maxQueue)), maxHistory: Math.max(8, integerP(config.maxHistory ?? DEFAULTS.maxHistory)), maxPayloadBytes: Math.max(1024, integerP(config.maxPayloadBytes ?? DEFAULTS.maxPayloadBytes)), maxFutureTicks: Math.max(0, integerP(config.maxFutureTicks ?? DEFAULTS.maxFutureTicks)), maxSnapshotAgeTicks: Math.max(1, integerP(config.maxSnapshotAgeTicks ?? DEFAULTS.maxSnapshotAgeTicks)) });
    this.#events = events;
  }

  connect(tick = 0): void { if (this.#state === 'connected') return; this.#state = 'connecting'; this.#state = 'connected'; this.queue('connection:ready', { tick: Math.max(0, integerP(tick)) }, tick, true); }
  disconnect(): void { this.#state = 'closing'; this.#state = 'offline'; this.#reliable.length = 0; }
  get state(): TransportState { return this.#state; }

  queue<T>(kind: string, payload: T, tick: number, reliable = true): NetworkEnvelopeP<T> | undefined {
    if (this.#state === 'offline') return undefined;
    const envelope: NetworkEnvelopeP<T> = Object.freeze({ protocol: 4, session: this.config.sessionId, sequence: this.#nextSequence++, ack: this.#highestReceived, tick: Math.max(0, integerP(tick)), reliable: Boolean(reliable), kind: String(kind).slice(0, 80), payload });
    const bytes = estimateBytes(envelope);
    if (bytes > this.config.maxPayloadBytes) { this.#dropped += 1; return undefined; }
    if (reliable && this.#reliable.length >= this.config.maxQueue) { this.#reliable.shift(); this.#dropped += 1; }
    if (reliable) this.#reliable.push(Object.freeze({ envelope, createdTick: envelope.tick, bytes }));
    this.#events?.emit('network:envelope', envelope);
    return envelope;
  }

  receive(envelope: NetworkEnvelopeP, currentTick: number): boolean {
    if (envelope.protocol !== 4 || envelope.session !== this.config.sessionId) { this.#dropped += 1; return false; }
    if (envelope.sequence <= this.#highestReceived || this.#seenSequences.has(envelope.sequence)) { this.#duplicates += 1; return false; }
    const age = integerP(currentTick) - integerP(envelope.tick);
    if (envelope.tick > currentTick + this.config.maxFutureTicks || age > this.config.maxSnapshotAgeTicks) { this.#dropped += 1; return false; }
    this.#seenSequences.add(envelope.sequence);
    this.#highestReceived = Math.max(this.#highestReceived, envelope.sequence);
    this.ack(envelope.ack);
    this.#events?.emit('network:envelope', envelope);
    while (this.#seenSequences.size > this.config.maxHistory) this.#seenSequences.delete(Math.min(...this.#seenSequences));
    return true;
  }

  ack(sequence: number): number {
    const target = Math.max(0, integerP(sequence));
    let removed = 0;
    while (this.#reliable.length && this.#reliable[0]!.envelope.sequence <= target) { this.#reliable.shift(); removed += 1; }
    this.#acked += removed;
    return removed;
  }

  drainReliable(max = 32): readonly PendingPacketP[] { return Object.freeze(this.#reliable.splice(0, Math.max(0, Math.min(this.#reliable.length, integerP(max, 32))))); }

  recordSnapshot(snapshot: WorldSnapshotP): void {
    validateSnapshot(snapshot);
    if (this.#history.length >= this.config.maxHistory) this.#history.shift();
    this.#history.push(Object.freeze({ ...snapshot, actors: Object.freeze(snapshot.actors.map(actor => Object.freeze({ ...actor }))) }));
    this.#snapshotCount += 1;
  }

  latestSnapshot(): WorldSnapshotP | undefined { return this.#history.at(-1); }
  snapshotAtOrBefore(tick: number): WorldSnapshotP | undefined { const target = integerP(tick); for (let index = this.#history.length - 1; index >= 0; index -= 1) if (this.#history[index]!.tick <= target) return this.#history[index]; return undefined; }

  diff(base: WorldSnapshotP, next: WorldSnapshotP): SnapshotDeltaP {
    if (next.tick < base.tick) throw new Error('snapshot delta cannot move backwards');
    const baseMap = new Map(base.actors.map(actor => [actor.id, actor]));
    const nextMap = new Map(next.actors.map(actor => [actor.id, actor]));
    const upserts: SnapshotActorP[] = [];
    const removals: number[] = [];
    for (const actor of next.actors) { const previous = baseMap.get(actor.id); if (!previous || checksumP(previous) !== checksumP(actor)) upserts.push(actor); }
    for (const actor of base.actors) if (!nextMap.has(actor.id)) removals.push(actor.id);
    upserts.sort((a, b) => a.id - b.id); removals.sort((a, b) => a - b);
    return Object.freeze({ protocol: 4, baseTick: base.tick, tick: next.tick, revision: next.revision, upserts: Object.freeze(upserts), removals: Object.freeze(removals), checksum: next.checksum });
  }

  applyDelta(base: WorldSnapshotP, delta: SnapshotDeltaP): WorldSnapshotP {
    if (delta.protocol !== 4 || delta.baseTick !== base.tick) throw new Error('snapshot delta base mismatch');
    const actors = new Map(base.actors.map(actor => [actor.id, actor]));
    for (const id of delta.removals) actors.delete(id);
    for (const actor of delta.upserts) actors.set(actor.id, actor);
    const nextActors = [...actors.values()].sort((a, b) => a.id - b.id);
    const snapshot: WorldSnapshotP = Object.freeze({ tick: delta.tick, revision: delta.revision, actors: Object.freeze(nextActors), checksum: checksumP(nextActors) });
    if (snapshot.checksum !== delta.checksum) throw new Error('snapshot delta checksum mismatch');
    return snapshot;
  }

  stats(): NetworkPipelineStatsP {
    const bytesQueued = this.#reliable.reduce((sum, packet) => sum + packet.bytes, 0);
    return Object.freeze({ state: this.#state, queued: this.#reliable.length, inFlight: this.#reliable.length, acked: this.#acked, dropped: this.#dropped, duplicatePackets: this.#duplicates, snapshots: this.#snapshotCount, bytesQueued, checksum: checksumP({ state: this.#state, queue: this.#reliable.map(item => item.envelope.sequence), latest: this.latestSnapshot()?.checksum ?? 0 }) });
  }
}

function validateSnapshot(snapshot: WorldSnapshotP): void {
  if (snapshot.tick < 0 || snapshot.revision < 0) throw new Error('invalid snapshot clock');
  let previousId = 0;
  for (const actor of snapshot.actors) {
    if (actor.id <= previousId || actor.id < 1) throw new Error('snapshot actors must be sorted by id');
    previousId = actor.id;
    if (![actor.x, actor.y, actor.z, actor.yaw, actor.health, actor.stamina].every(Number.isFinite)) throw new Error('snapshot contains non-finite actor value');
  }
  if (checksumP(snapshot.actors) !== snapshot.checksum) throw new Error('snapshot checksum mismatch');
}

function estimateBytes(value: unknown): number { return Math.max(0, new TextEncoder().encode(JSON.stringify(value)).byteLength); }
