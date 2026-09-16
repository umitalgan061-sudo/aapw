import {
  type EntityIdV4,
  type TickId,
  type Vec3V4,
  type TransformV4,
  type NetworkDeltaV4,
  type NetworkPeerV4,
  type OutcomeV4,
  type RuntimeErrorV4,
  type NetworkEnvelopeV4,
  okV4,
  failV4,
  createRuntimeErrorV4,
  tickId,
  vec3V4,
  transformV4,
  quaternionV4,
  clampV4,
} from './runtimeContractsV4';

export type NetRoleV5 = 'authority' | 'replica' | 'spectator';
export type NetChannelV5 = 'input' | 'simulation' | 'state' | 'event' | 'voice' | 'telemetry';

export interface InputFrameV5<T = unknown> {
  readonly clientTick: TickId;
  readonly sequence: number;
  readonly timestamp: number;
  readonly payload: T;
  readonly checksum: string;
}

export interface AuthoritativeFrameV5<T = unknown> {
  readonly serverTick: TickId;
  readonly acknowledgedClientTick: TickId;
  readonly revision: number;
  readonly payload: T;
  readonly checksum: string;
}

export interface NetEntityV5 {
  readonly entity: EntityIdV4;
  readonly revision: number;
  readonly transform: TransformV4;
  readonly velocity: Vec3V4;
  readonly owner: string | null;
  readonly flags: number;
}

export interface NetCorrectionV5 {
  readonly entity: EntityIdV4;
  readonly positionError: Vec3V4;
  readonly distance: number;
  readonly accepted: boolean;
  readonly reason: string;
}

export interface NetPeerRuntimeV5 extends NetworkPeerV4 {
  readonly role: NetRoleV5;
  readonly lastInputTick: TickId;
  readonly lastAckTick: TickId;
  readonly sentBytes: number;
  readonly receivedBytes: number;
  readonly resyncs: number;
}

export interface NetcodeMetricsV5 {
  readonly ticks: number;
  readonly inputFrames: number;
  readonly authoritativeFrames: number;
  readonly corrections: number;
  readonly rejectedCorrections: number;
  readonly staleInputs: number;
  readonly malformedPackets: number;
  readonly sentBytes: number;
  readonly receivedBytes: number;
  readonly resyncs: number;
}

export interface NetcodeOptionsV5 {
  readonly maxPeers?: number;
  readonly maxInputHistory?: number;
  readonly maxEntities?: number;
  readonly correctionThreshold?: number;
  readonly now?: () => number;
}

const hash = (value: unknown): string => {
  const text = JSON.stringify(value);
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
};
const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;

export class NetcodeV5<TInput = unknown, TState = unknown> {
  readonly maxPeers: number;
  readonly maxInputHistory: number;
  readonly maxEntities: number;
  readonly correctionThreshold: number;
  #now: () => number;
  #peers = new Map<string, NetPeerRuntimeV5>();
  #entities = new Map<EntityIdV4, NetEntityV5>();
  #inputs = new Map<string, InputFrameV5<TInput>[]>();
  #serverRevision = 0;
  #serverTick = 0;
  #metrics = { ticks: 0, inputFrames: 0, authoritativeFrames: 0, corrections: 0, rejectedCorrections: 0, staleInputs: 0, malformedPackets: 0, sentBytes: 0, receivedBytes: 0, resyncs: 0 };

  constructor(options: NetcodeOptionsV5 = {}) {
    this.maxPeers = Math.max(1, Math.trunc(options.maxPeers ?? 64));
    this.maxInputHistory = Math.max(4, Math.trunc(options.maxInputHistory ?? 256));
    this.maxEntities = Math.max(16, Math.trunc(options.maxEntities ?? 20_000));
    this.correctionThreshold = Math.max(0.001, finite(options.correctionThreshold ?? 0.25, 0.25));
    this.#now = options.now ?? (() => performance.now());
  }

  registerPeer(peer: NetworkPeerV4, role: NetRoleV5 = peer.authority === 'server' ? 'authority' : 'replica'): OutcomeV4<NetPeerRuntimeV5> {
    if (this.#peers.has(peer.id)) return okV4(this.#peers.get(peer.id)!);
    if (this.#peers.size >= this.maxPeers) return failV4(createRuntimeErrorV4('NET_PEER_LIMIT', 'Network peer capacity reached', true));
    const runtimePeer: NetPeerRuntimeV5 = Object.freeze({ ...peer, role, lastInputTick: tickId(0), lastAckTick: tickId(0), sentBytes: 0, receivedBytes: 0, resyncs: 0 });
    this.#peers.set(peer.id, runtimePeer);
    this.#inputs.set(peer.id, []);
    return okV4(runtimePeer);
  }

  removePeer(peerId: string): boolean {
    this.#inputs.delete(peerId);
    return this.#peers.delete(peerId);
  }

  peers(): readonly NetPeerRuntimeV5[] { return Object.freeze([...this.#peers.values()].sort((a, b) => a.id.localeCompare(b.id))); }

  upsertEntity(entity: NetEntityV5): OutcomeV4<boolean> {
    if (this.#entities.size >= this.maxEntities && !this.#entities.has(entity.entity)) return failV4(createRuntimeErrorV4('NET_ENTITY_LIMIT', 'Network entity capacity reached', true));
    const current = this.#entities.get(entity.entity);
    if (current && current.revision > entity.revision) return failV4(createRuntimeErrorV4('NET_ENTITY_STALE', 'Entity revision is stale', true));
    this.#entities.set(entity.entity, Object.freeze({ ...entity }));
    return okV4(true);
  }

  removeEntity(entity: EntityIdV4): boolean { return this.#entities.delete(entity); }

  receiveInput(peerId: string, payload: TInput, clientTick: TickId, sequence: number): OutcomeV4<InputFrameV5<TInput>> {
    const peer = this.#peers.get(peerId);
    const history = this.#inputs.get(peerId);
    if (!peer || !history) return failV4(createRuntimeErrorV4('NET_PEER_UNKNOWN', 'Input peer is not registered', true));
    if (Number(clientTick) < Number(peer.lastInputTick)) {
      this.#metrics.staleInputs += 1;
      return failV4(createRuntimeErrorV4('NET_INPUT_STALE', 'Input tick is older than acknowledged input', false));
    }
    const frameCore = { clientTick, sequence: Math.max(0, Math.trunc(sequence)), timestamp: this.#now(), payload };
    const frame = Object.freeze({ ...frameCore, checksum: hash(frameCore) });
    history.push(frame);
    while (history.length > this.maxInputHistory) history.shift();
    this.#metrics.inputFrames += 1;
    this.#metrics.receivedBytes += JSON.stringify(payload).length;
    this.#peers.set(peerId, Object.freeze({ ...peer, lastInputTick: clientTick, receivedBytes: peer.receivedBytes + JSON.stringify(payload).length }));
    return okV4(frame);
  }

  consumeInputs(peerId: string, max = 16): readonly InputFrameV5<TInput>[] {
    const history = this.#inputs.get(peerId);
    if (!history) return Object.freeze([]);
    return Object.freeze(history.splice(0, Math.max(0, Math.trunc(max))));
  }

  authoritativeFrame(payload: TState, acknowledgedClientTick: TickId): AuthoritativeFrameV5<TState> {
    this.#serverTick += 1;
    this.#serverRevision += 1;
    const core = { serverTick: tickId(this.#serverTick), acknowledgedClientTick, revision: this.#serverRevision, payload };
    const frame = Object.freeze({ ...core, checksum: hash(core) });
    this.#metrics.authoritativeFrames += 1;
    this.#metrics.ticks = this.#serverTick;
    return frame;
  }

  verifyAuthoritativeFrame(frame: AuthoritativeFrameV5<TState>): boolean {
    return hash({ serverTick: frame.serverTick, acknowledgedClientTick: frame.acknowledgedClientTick, revision: frame.revision, payload: frame.payload }) === frame.checksum;
  }

  correctEntity(entity: EntityIdV4, authoritative: Vec3V4, maxSnapDistance = this.correctionThreshold): NetCorrectionV5 | null {
    const current = this.#entities.get(entity);
    if (!current) return null;
    const local = current.transform.position;
    const dx = authoritative.x - local.x;
    const dy = authoritative.y - local.y;
    const dz = authoritative.z - local.z;
    const distance = Math.hypot(dx, dy, dz);
    this.#metrics.corrections += 1;
    if (distance <= this.correctionThreshold) {
      return Object.freeze({ entity, positionError: vec3V4(dx, dy, dz), distance, accepted: true, reason: 'within-interpolation-threshold' });
    }
    if (distance > Math.max(this.correctionThreshold, maxSnapDistance) * 8) {
      this.#metrics.rejectedCorrections += 1;
      return Object.freeze({ entity, positionError: vec3V4(dx, dy, dz), distance, accepted: false, reason: 'correction-too-large' });
    }
    this.#entities.set(entity, Object.freeze({ ...current, transform: transformV4(authoritative, current.transform.rotation, current.transform.scale), revision: current.revision + 1 }));
    return Object.freeze({ entity, positionError: vec3V4(dx, dy, dz), distance, accepted: true, reason: 'authoritative-snap' });
  }

  interpolateEntity(entity: EntityIdV4, authoritative: Vec3V4, alpha: number): TransformV4 | null {
    const current = this.#entities.get(entity);
    if (!current) return null;
    const t = clampV4(finite(alpha), 0, 1);
    const p = current.transform.position;
    return transformV4(vec3V4(p.x + (authoritative.x - p.x) * t, p.y + (authoritative.y - p.y) * t, p.z + (authoritative.z - p.z) * t), current.transform.rotation, current.transform.scale);
  }

  makeEnvelope<T>(peerId: string, channel: NetChannelV5, payload: T, reliable = true): OutcomeV4<NetworkEnvelopeV4<T>> {
    if (!this.#peers.has(peerId)) return failV4(createRuntimeErrorV4('NET_PEER_UNKNOWN', 'Peer is not registered', true));
    const envelope: NetworkEnvelopeV4<T> = Object.freeze({ sequence: ++this.#serverRevision, reliable, channel: channel as NetworkEnvelopeV4['channel'], sentAt: this.#now(), retries: 0, payload });
    const size = JSON.stringify(envelope).length;
    const peer = this.#peers.get(peerId)!;
    this.#peers.set(peerId, Object.freeze({ ...peer, sentBytes: peer.sentBytes + size }));
    this.#metrics.sentBytes += size;
    return okV4(envelope);
  }

  deserializeDelta<T>(delta: NetworkDeltaV4<T>): OutcomeV4<T> {
    const expected = hash({ tick: delta.tick, source: delta.source, payload: delta.payload, version: delta.version });
    if (expected !== delta.checksum) {
      this.#metrics.malformedPackets += 1;
      return failV4(createRuntimeErrorV4('NET_DELTA_CHECKSUM', 'Network delta checksum mismatch', false));
    }
    return okV4(delta.payload);
  }

  tick(): TickId { return tickId(this.#serverTick); }

  entity(entity: EntityIdV4): NetEntityV5 | undefined { return this.#entities.get(entity); }

  entities(): readonly NetEntityV5[] { return Object.freeze([...this.#entities.values()].sort((a, b) => a.entity - b.entity)); }

  metrics(): NetcodeMetricsV5 { return Object.freeze({ ...this.#metrics }); }

  resync(peerId: string): OutcomeV4<number> {
    const peer = this.#peers.get(peerId);
    if (!peer) return failV4(createRuntimeErrorV4('NET_PEER_UNKNOWN', 'Peer is not registered', true));
    const next = Object.freeze({ ...peer, resyncs: peer.resyncs + 1 });
    this.#peers.set(peerId, next);
    this.#metrics.resyncs += 1;
    return okV4(this.#entities.size);
  }

  clear(): void { this.#entities.clear(); this.#inputs.clear(); this.#peers.clear(); }
}

export function createNetworkEntityV5(entity: number, x = 0, y = 0, z = 0, owner: string | null = null): NetEntityV5 {
  return Object.freeze({ entity: entityId(entity), revision: 1, transform: transformV4(vec3V4(x, y, z), quaternionV4(), vec3V4(1, 1, 1)), velocity: vec3V4(), owner, flags: 0 });
}

function entityId(value: number): EntityIdV4 { return value as EntityIdV4; }
