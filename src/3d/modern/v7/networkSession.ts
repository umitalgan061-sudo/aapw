import { asEntityId, clamp, digest, integer, stableSort, type Disposable, type EntityId, type V7Result } from './primitives.js';

export type Channel = 'reliable' | 'unreliable' | 'state';
export type PeerState = 'new' | 'connecting' | 'connected' | 'degraded' | 'closing' | 'closed';
export interface NetworkEnvelope { readonly channel: Channel; readonly serial: number; readonly tick: number; readonly source: EntityId; readonly target: EntityId | null; readonly payload: unknown; readonly bytes: number; readonly checksum: string; }
export interface PeerMetrics { readonly rttMs: number; readonly jitterMs: number; readonly loss01: number; readonly sent: number; readonly received: number; readonly dropped: number; readonly backpressure01: number; }
export interface PeerRecord { readonly id: EntityId; readonly state: PeerState; readonly lastTick: number; readonly metrics: PeerMetrics; readonly revision: number; }
export interface PredictionFrame { readonly tick: number; readonly input: unknown; readonly stateDigest: string; }
export interface ReconciliationResult { readonly accepted: boolean; readonly rewindTick: number | null; readonly replayFrom: number | null; readonly reason: string; }

const emptyMetrics = (): PeerMetrics => Object.freeze({ rttMs: 0, jitterMs: 0, loss01: 0, sent: 0, received: 0, dropped: 0, backpressure01: 0 });

export class NetworkSession implements Disposable {
  readonly maxPeers: number; readonly maxQueue: number; readonly maxPayloadBytes: number;
  #peers = new Map<EntityId, PeerRecord>(); #queue: NetworkEnvelope[] = []; #seen = new Set<string>(); #predictions: PredictionFrame[] = [];
  #serial = 0; #tick = 0; #disposed = false; #dropped = 0;
  constructor(maxPeers = 64, maxQueue = 1024, maxPayloadBytes = 65_536) { this.maxPeers = clamp(integer(maxPeers), 1, 256); this.maxQueue = clamp(integer(maxQueue), 32, 65_536); this.maxPayloadBytes = clamp(integer(maxPayloadBytes), 256, 1_048_576); }
  connect(id: string): V7Result<PeerRecord> {
    if (this.#disposed) return { ok: false, code: 'NETWORK_DISPOSED', message: 'Network session is disposed', retryable: false };
    const peerId = asEntityId(id); if (!peerId || this.#peers.size >= this.maxPeers || this.#peers.has(peerId)) return { ok: false, code: 'PEER_REJECTED', message: 'Peer is invalid, duplicate or capacity is exhausted', retryable: true };
    const peer = Object.freeze({ id: peerId, state: 'connected' as const, lastTick: this.#tick, metrics: emptyMetrics(), revision: 1 }); this.#peers.set(peerId, peer); return { ok: true, value: peer };
  }
  disconnect(id: EntityId): boolean { const peer = this.#peers.get(id); if (!peer) return false; this.#peers.set(id, Object.freeze({ ...peer, state: 'closed' })); return true; }
  send(channel: Channel, source: EntityId, payload: unknown, target: EntityId | null = null): V7Result<NetworkEnvelope> {
    if (this.#disposed) return { ok: false, code: 'NETWORK_DISPOSED', message: 'Network session is disposed', retryable: false };
    if (this.#queue.length >= this.maxQueue) { this.#dropped += 1; return { ok: false, code: 'NETWORK_QUEUE_FULL', message: 'Network queue is full', retryable: true }; }
    let serialized = ''; try { serialized = JSON.stringify(payload) ?? 'null'; } catch { return { ok: false, code: 'NETWORK_SERIALIZE', message: 'Payload is not serializable', retryable: false }; }
    if (serialized.length > this.maxPayloadBytes) return { ok: false, code: 'NETWORK_PAYLOAD_LIMIT', message: 'Payload exceeds the byte limit', retryable: false };
    this.#serial += 1; const envelope = Object.freeze({ channel, serial: this.#serial, tick: this.#tick, source, target, payload, bytes: serialized.length, checksum: digest(channel, this.#serial, this.#tick, source, target, payload) }); this.#queue.push(envelope); return { ok: true, value: envelope };
  }
  drain(max = 128): readonly NetworkEnvelope[] { if (this.#disposed) return []; const take = clamp(integer(max), 1, this.#queue.length); const drained = stableSort(this.#queue.splice(0, take), (a, b) => a.tick - b.tick || a.serial - b.serial); return Object.freeze(drained); }
  receive(envelope: NetworkEnvelope): V7Result<void> {
    if (this.#disposed) return { ok: false, code: 'NETWORK_DISPOSED', message: 'Network session is disposed', retryable: false };
    const key = `${envelope.source}:${envelope.serial}`; if (this.#seen.has(key)) return { ok: false, code: 'NETWORK_DUPLICATE', message: 'Envelope was already received', retryable: false };
    if (envelope.bytes > this.maxPayloadBytes || envelope.checksum !== digest(envelope.channel, envelope.serial, envelope.tick, envelope.source, envelope.target, envelope.payload)) return { ok: false, code: 'NETWORK_INTEGRITY', message: 'Envelope failed integrity validation', retryable: false };
    this.#seen.add(key); if (this.#seen.size > this.maxQueue * 4) { const ordered = [...this.#seen].sort(); this.#seen.delete(ordered[0]!); } if (this.#peers.has(envelope.source)) this.#touchPeer(envelope.source, envelope.tick, true); return { ok: true, value: undefined };
  }
  recordPrediction(frame: PredictionFrame): void { if (this.#disposed) return; this.#predictions.push(Object.freeze({ ...frame })); this.#predictions = this.#predictions.slice(-120); }
  reconcile(authoritativeTick: number, authoritativeDigest: string): ReconciliationResult {
    const tick = integer(authoritativeTick); const local = this.#predictions.find((frame) => frame.tick === tick);
    if (local && local.stateDigest === authoritativeDigest) { this.#predictions = this.#predictions.filter((frame) => frame.tick > tick); return Object.freeze({ accepted: true, rewindTick: null, replayFrom: null, reason: 'prediction-confirmed' }); }
    const oldest = this.#predictions.find((frame) => frame.tick >= tick); if (oldest) return Object.freeze({ accepted: false, rewindTick: tick, replayFrom: oldest.tick, reason: 'authoritative-divergence' });
    return Object.freeze({ accepted: true, rewindTick: null, replayFrom: null, reason: 'no-local-prediction' });
  }
  setTick(tick: number): void { this.#tick = Math.max(this.#tick, integer(tick)); }
  peer(id: EntityId): PeerRecord | undefined { return this.#peers.get(id); }
  peers(): readonly PeerRecord[] { return Object.freeze(stableSort([...this.#peers.values()], (a, b) => String(a.id).localeCompare(String(b.id)))); }
  stats(): Readonly<{ peers: number; queued: number; dropped: number; predictions: number }> { return Object.freeze({ peers: this.#peers.size, queued: this.#queue.length, dropped: this.#dropped, predictions: this.#predictions.length }); }
  dispose(): void { this.#disposed = true; this.#queue.length = 0; this.#peers.clear(); this.#seen.clear(); this.#predictions.length = 0; }
  #touchPeer(id: EntityId, tick: number, received: boolean): void { const peer = this.#peers.get(id); if (!peer) return; const metrics = { ...peer.metrics, received: peer.metrics.received + Number(received) }; this.#peers.set(id, Object.freeze({ ...peer, lastTick: tick, metrics: Object.freeze(metrics) })); }
}
