import { checksumV5, type NetworkEnvelopeV5, type OutcomeV5, okV5, failV5, sequenceV5, tickV5, type SequenceV5, type TickV5 } from './runtimeContractV5';

export type ChannelV5 = NetworkEnvelopeV5['channel'];
export interface PeerStateV5 { readonly id: string; readonly connected: boolean; readonly lastSeen: number; readonly rttMs: number; readonly lossRatio: number; readonly remoteTick: TickV5; readonly pending: number; }
export interface NetworkSessionOptionsV5 { readonly maxPeers?: number; readonly maxPendingPerPeer?: number; readonly maxMessageBytes?: number; readonly retryBaseMs?: number; readonly maxRetries?: number; readonly now?: () => number; }
export interface PendingMessageV5<T> { readonly envelope: NetworkEnvelopeV5<T>; readonly encoded: string; readonly attempts: number; readonly nextRetryAt: number; }
export interface NetworkMetricsV5 { readonly peers: number; readonly connected: number; readonly sent: number; readonly received: number; readonly retransmits: number; readonly dropped: number; readonly bytesSent: number; readonly bytesReceived: number; }

function clampInt(value: number, min: number, max: number, fallback: number): number { const normalized = Number.isFinite(value) ? Math.floor(value) : fallback; return Math.max(min, Math.min(max, normalized)); }
function encode<T>(message: NetworkEnvelopeV5<T>): string { return JSON.stringify(message); }
function byteLength(text: string): number { return new TextEncoder().encode(text).byteLength; }
function finite(value: number, fallback: number): number { return Number.isFinite(value) ? value : fallback; }

export class NetworkSessionV5 {
  readonly maxPeers: number;
  readonly maxPendingPerPeer: number;
  readonly maxMessageBytes: number;
  readonly retryBaseMs: number;
  readonly maxRetries: number;
  #now: () => number;
  #peers = new Map<string, { state: PeerStateV5; pending: Map<SequenceV5, PendingMessageV5<unknown>>; seen: Set<SequenceV5>; }>();
  #sequence: SequenceV5 = sequenceV5(0);
  #sent = 0; #received = 0; #retransmits = 0; #dropped = 0; #bytesSent = 0; #bytesReceived = 0;

  constructor(options: NetworkSessionOptionsV5 = {}) {
    this.maxPeers = clampInt(options.maxPeers ?? 32, 1, 512, 32);
    this.maxPendingPerPeer = clampInt(options.maxPendingPerPeer ?? 256, 8, 10_000, 256);
    this.maxMessageBytes = clampInt(options.maxMessageBytes ?? 256 * 1024, 1024, 8 * 1024 * 1024, 256 * 1024);
    this.retryBaseMs = Math.max(20, Math.min(5000, finite(options.retryBaseMs ?? 250, 250)));
    this.maxRetries = clampInt(options.maxRetries ?? 5, 0, 20, 5);
    this.#now = options.now ?? (() => Date.now());
  }

  connect(peerId: string): OutcomeV5<PeerStateV5> {
    if (!peerId || peerId.length > 128) return failV5('PEER_ID', 'Invalid peer id');
    const existing = this.#peers.get(peerId);
    if (existing) { const state = Object.freeze({ ...existing.state, connected: true, lastSeen: this.#now() }); existing.state = state; return okV5(state); }
    if (this.#peers.size >= this.maxPeers) return failV5('PEER_LIMIT', 'Maximum peer count reached');
    const state: PeerStateV5 = Object.freeze({ id: peerId, connected: true, lastSeen: this.#now(), rttMs: 0, lossRatio: 0, remoteTick: tickV5(0), pending: 0 });
    this.#peers.set(peerId, { state, pending: new Map(), seen: new Set() });
    return okV5(state);
  }

  disconnect(peerId: string): boolean { const peer = this.#peers.get(peerId); if (!peer) return false; peer.state = Object.freeze({ ...peer.state, connected: false, pending: peer.pending.size }); return true; }
  remove(peerId: string): boolean { return this.#peers.delete(peerId); }
  peer(peerId: string): PeerStateV5 | null { return this.#peers.get(peerId)?.state ?? null; }
  peers(): readonly PeerStateV5[] { return Object.freeze([...this.#peers.values()].map((peer) => peer.state).sort((a, b) => a.id.localeCompare(b.id))); }

  create<T>(peerId: string, channel: ChannelV5, tick: TickV5, payload: T, reliable = true): OutcomeV5<NetworkEnvelopeV5<T>> {
    if (!this.#peers.has(peerId)) return failV5('PEER_NOT_FOUND', 'Peer is not connected');
    const sequence = sequenceV5(this.#sequence + 1); this.#sequence = sequence;
    const envelope: NetworkEnvelopeV5<T> = Object.freeze({ sequence, tick, channel, reliable, payload, checksum: checksumV5(payload) });
    const encoded = encode(envelope);
    if (byteLength(encoded) > this.maxMessageBytes) return failV5('MESSAGE_TOO_LARGE', 'Network message exceeds configured byte limit');
    return okV5(envelope);
  }

  send<T>(peerId: string, envelope: NetworkEnvelopeV5<T>): OutcomeV5<string> {
    const peer = this.#peers.get(peerId);
    if (!peer || !peer.state.connected) return failV5('PEER_OFFLINE', 'Peer is offline');
    const encoded = encode(envelope);
    const bytes = byteLength(encoded);
    if (bytes > this.maxMessageBytes) return failV5('MESSAGE_TOO_LARGE', 'Network message exceeds configured byte limit');
    if (envelope.reliable && peer.pending.size >= this.maxPendingPerPeer) return failV5('BACKPRESSURE', 'Peer reliable queue is full', tickV5(envelope.tick), 'warn', true);
    this.#sent += 1; this.#bytesSent += bytes; peer.state = Object.freeze({ ...peer.state, lastSeen: this.#now(), pending: peer.pending.size + (envelope.reliable ? 1 : 0) });
    if (envelope.reliable) peer.pending.set(envelope.sequence, { envelope, encoded, attempts: 1, nextRetryAt: this.#now() + this.retryBaseMs });
    return okV5(encoded);
  }

  receive<T>(peerId: string, raw: string): OutcomeV5<NetworkEnvelopeV5<T>> {
    const peer = this.#peers.get(peerId);
    if (!peer || !peer.state.connected) return failV5('PEER_OFFLINE', 'Peer is offline');
    if (byteLength(raw) > this.maxMessageBytes) return failV5('MESSAGE_TOO_LARGE', 'Incoming message exceeds configured byte limit');
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return failV5('MESSAGE_PARSE', 'Malformed network payload'); }
    if (!parsed || typeof parsed !== 'object') return failV5('MESSAGE_SHAPE', 'Network envelope is not an object');
    const envelope = parsed as NetworkEnvelopeV5<T>;
    if (!Number.isInteger(envelope.sequence) || !Number.isInteger(envelope.tick)) return failV5('MESSAGE_META', 'Invalid network sequence or tick');
    if (!['state', 'command', 'event', 'snapshot', 'control'].includes(envelope.channel)) return failV5('MESSAGE_CHANNEL', 'Unsupported network channel');
    if (checksumV5(envelope.payload) !== envelope.checksum) return failV5('MESSAGE_CHECKSUM', 'Network checksum mismatch');
    if (peer.seen.has(envelope.sequence)) return failV5('MESSAGE_DUPLICATE', 'Duplicate network message', tickV5(envelope.tick), 'debug', false);
    peer.seen.add(envelope.sequence);
    if (peer.seen.size > 4096) peer.seen.delete([...peer.seen][0]!);
    this.#received += 1; this.#bytesReceived += byteLength(raw);
    peer.state = Object.freeze({ ...peer.state, lastSeen: this.#now(), remoteTick: envelope.tick });
    if (envelope.reliable) this.#ack(peer, envelope.sequence);
    return okV5(envelope);
  }

  acknowledge(peerId: string, sequence: SequenceV5): boolean {
    const peer = this.#peers.get(peerId); if (!peer) return false; return this.#ack(peer, sequence);
  }

  retryDue(): readonly { peerId: string; encoded: string }[] {
    const now = this.#now(); const retry: Array<{ peerId: string; encoded: string }> = [];
    for (const [peerId, peer] of this.#peers) {
      for (const [sequence, pending] of [...peer.pending]) {
        if (pending.nextRetryAt > now) continue;
        if (pending.attempts > this.maxRetries) { peer.pending.delete(sequence); this.#dropped += 1; continue; }
        const updated: PendingMessageV5<unknown> = Object.freeze({ ...pending, attempts: pending.attempts + 1, nextRetryAt: now + this.retryBaseMs * (2 ** Math.min(6, pending.attempts)) });
        peer.pending.set(sequence, updated); retry.push({ peerId, encoded: updated.encoded }); this.#retransmits += 1;
      }
      peer.state = Object.freeze({ ...peer.state, pending: peer.pending.size });
    }
    return Object.freeze(retry);
  }

  updateRtt(peerId: string, rttMs: number): void { const peer = this.#peers.get(peerId); if (!peer) return; peer.state = Object.freeze({ ...peer.state, rttMs: Math.max(0, Math.min(60_000, finite(rttMs, 0))) }); }
  updateLoss(peerId: string, lossRatio: number): void { const peer = this.#peers.get(peerId); if (!peer) return; peer.state = Object.freeze({ ...peer.state, lossRatio: Math.max(0, Math.min(1, finite(lossRatio, 0))) }); }
  metrics(): NetworkMetricsV5 { const connected = [...this.#peers.values()].filter((peer) => peer.state.connected).length; return Object.freeze({ peers: this.#peers.size, connected, sent: this.#sent, received: this.#received, retransmits: this.#retransmits, dropped: this.#dropped, bytesSent: this.#bytesSent, bytesReceived: this.#bytesReceived }); }
  pending(peerId: string): number { return this.#peers.get(peerId)?.pending.size ?? 0; }
  clearPeer(peerId: string): void { const peer = this.#peers.get(peerId); if (!peer) return; peer.pending.clear(); peer.seen.clear(); peer.state = Object.freeze({ ...peer.state, pending: 0 }); }
  clear(): void { this.#peers.clear(); this.#sequence = sequenceV5(0); this.#sent = 0; this.#received = 0; this.#retransmits = 0; this.#dropped = 0; this.#bytesSent = 0; this.#bytesReceived = 0; }

  #ack(peer: { state: PeerStateV5; pending: Map<SequenceV5, PendingMessageV5<unknown>> }, sequence: SequenceV5): boolean {
    const had = peer.pending.delete(sequence); peer.state = Object.freeze({ ...peer.state, pending: peer.pending.size }); return had;
  }
}

export function createLoopbackNetworkV5(options: NetworkSessionOptionsV5 = {}): NetworkSessionV5 {
  const network = new NetworkSessionV5(options); network.connect('loopback'); return network;
}
