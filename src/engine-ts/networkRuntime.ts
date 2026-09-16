import type { Disposable, EngineResult, Tick } from './types.js';
import { hashTuple, toHex32 } from './deterministic.js';

export type Reliability = 'reliable' | 'unreliable';
export type Channel = 'state' | 'command' | 'event' | 'telemetry';
export type PeerState = 'disconnected' | 'connecting' | 'connected' | 'degraded' | 'closing';

export interface PeerConfig {
  readonly id: string;
  readonly authority: 'server' | 'client' | 'spectator';
  readonly maxPending: number;
  readonly timeoutMs: number;
  readonly retryLimit: number;
}

export interface NetworkPacket<T = unknown> {
  readonly sequence: number;
  readonly channel: Channel;
  readonly reliability: Reliability;
  readonly peerId: string;
  readonly tick: Tick;
  readonly sentAt: number;
  readonly expiresAt: number;
  readonly retries: number;
  readonly payload: T;
  readonly checksum: string;
}

export interface ReceivedPacket<T = unknown> {
  readonly packet: NetworkPacket<T>;
  readonly receivedAt: number;
}

export interface PeerStats {
  readonly id: string;
  readonly state: PeerState;
  readonly latencyMs: number;
  readonly packetLoss: number;
  readonly sent: number;
  readonly received: number;
  readonly resent: number;
  readonly dropped: number;
  readonly pending: number;
}

export interface NetworkStats {
  readonly peers: number;
  readonly connected: number;
  readonly pending: number;
  readonly sent: number;
  readonly received: number;
  readonly dropped: number;
  readonly retransmits: number;
  readonly averageLatencyMs: number;
}

export interface TransportAdapter {
  send<T>(packet: NetworkPacket<T>): Promise<void>;
}

const defaultTransport: TransportAdapter = Object.freeze({ async send() {} });

function checksumPayload(value: unknown): string {
  const serialized = JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? `${item}n` : item);
  return toHex32(hashTuple(serialized.length, ...serialized.slice(0, 4096).split('').map(ch => ch.charCodeAt(0))));
}

function clamp01(value: number): number { return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)); }

interface InternalPeer {
  readonly config: PeerConfig;
  state: PeerState;
  lastSeenAt: number;
  latencyMs: number;
  sent: number;
  received: number;
  resent: number;
  dropped: number;
  pending: Map<number, NetworkPacket>;
}

export class NetworkRuntime implements Disposable {
  readonly transport: TransportAdapter;
  #now: () => number;
  #peers = new Map<string, InternalPeer>();
  #nextSequence = 1;
  #disposed = false;
  #sent = 0;
  #received = 0;
  #dropped = 0;
  #retransmits = 0;

  constructor(transport: TransportAdapter = defaultTransport, now: () => number = () => typeof performance !== 'undefined' ? performance.now() : Date.now()) {
    this.transport = transport;
    this.#now = now;
  }

  addPeer(config: PeerConfig): EngineResult<void> {
    if (this.#disposed) return this.fail('NETWORK_DISPOSED');
    if (!config.id || this.#peers.has(config.id)) return this.fail('PEER_DUPLICATE');
    const peer: InternalPeer = { config: Object.freeze({ ...config, maxPending: Math.max(8, config.maxPending), timeoutMs: Math.max(50, config.timeoutMs), retryLimit: Math.max(0, config.retryLimit) }), state: 'disconnected', lastSeenAt: this.#now(), latencyMs: 0, sent: 0, received: 0, resent: 0, dropped: 0, pending: new Map() };
    this.#peers.set(config.id, peer);
    return { ok: true, meta: { status: 'ok', code: 'PEER_ADDED' } };
  }

  connect(peerId: string): boolean {
    const peer = this.#peers.get(peerId);
    if (!peer || this.#disposed) return false;
    peer.state = 'connected';
    peer.lastSeenAt = this.#now();
    return true;
  }

  disconnect(peerId: string): boolean {
    const peer = this.#peers.get(peerId);
    if (!peer) return false;
    peer.state = 'disconnected';
    peer.pending.clear();
    return true;
  }

  async send<T>(peerId: string, channel: Channel, payload: T, tick: Tick, reliability: Reliability = 'reliable', ttlMs = 250): Promise<EngineResult<NetworkPacket<T>>> {
    const peer = this.#peers.get(peerId);
    if (!peer || (peer.state !== 'connected' && peer.state !== 'degraded')) return this.fail('PEER_NOT_CONNECTED');
    if (peer.pending.size >= peer.config.maxPending && reliability === 'reliable') return this.fail('NETWORK_BACKPRESSURE');
    const sentAt = this.#now();
    const packet: NetworkPacket<T> = Object.freeze({
      sequence: this.#nextSequence++, channel, reliability, peerId, tick,
      sentAt, expiresAt: sentAt + Math.max(1, ttlMs), retries: 0,
      payload, checksum: checksumPayload(payload),
    });
    try {
      await this.transport.send(packet);
      peer.sent += 1;
      this.#sent += 1;
      if (reliability === 'reliable') peer.pending.set(packet.sequence, packet as NetworkPacket);
      return { ok: true, value: packet };
    } catch (cause) {
      peer.dropped += 1;
      this.#dropped += 1;
      return { ok: false, meta: { status: 'error', code: 'NETWORK_SEND_FAILED', cause } };
    }
  }

  receive<T>(packet: NetworkPacket<T>): EngineResult<ReceivedPacket<T>> {
    if (this.#disposed) return this.fail('NETWORK_DISPOSED');
    const peer = this.#peers.get(packet.peerId);
    if (!peer) return this.fail('PEER_UNKNOWN');
    if (packet.expiresAt < this.#now()) return this.fail('PACKET_EXPIRED');
    if (checksumPayload(packet.payload) !== packet.checksum) return this.fail('PACKET_CHECKSUM');
    peer.received += 1;
    peer.lastSeenAt = this.#now();
    this.#received += 1;
    if (packet.reliability === 'reliable') peer.pending.delete(packet.sequence);
    const sampleLatency = Math.max(0, this.#now() - packet.sentAt);
    peer.latencyMs = peer.latencyMs === 0 ? sampleLatency : peer.latencyMs * 0.8 + sampleLatency * 0.2;
    peer.state = peer.latencyMs > 250 ? 'degraded' : 'connected';
    return { ok: true, value: Object.freeze({ packet, receivedAt: this.#now() }) };
  }

  async update(): Promise<void> {
    if (this.#disposed) return;
    const now = this.#now();
    for (const peer of this.#peers.values()) {
      const expired = [...peer.pending.values()].filter(packet => packet.expiresAt <= now);
      for (const packet of expired) {
        peer.pending.delete(packet.sequence);
        if (packet.retries >= peer.config.retryLimit) {
          peer.dropped += 1;
          this.#dropped += 1;
          continue;
        }
        const retry: NetworkPacket = Object.freeze({ ...packet, retries: packet.retries + 1, sentAt: now, expiresAt: now + peer.config.timeoutMs });
        try {
          await this.transport.send(retry);
          retry.retries > 0 && (peer.resent += 1, this.#retransmits += 1);
          peer.pending.set(retry.sequence, retry);
        } catch {
          peer.dropped += 1;
          this.#dropped += 1;
        }
      }
      if (now - peer.lastSeenAt > peer.config.timeoutMs * 4 && peer.state === 'connected') peer.state = 'degraded';
    }
  }

  acknowledge(peerId: string, sequence: number): boolean {
    const peer = this.#peers.get(peerId);
    if (!peer) return false;
    return peer.pending.delete(sequence);
  }

  peerStats(peerId: string): PeerStats | undefined {
    const peer = this.#peers.get(peerId);
    if (!peer) return undefined;
    const total = peer.sent + peer.received;
    const loss = total === 0 ? 0 : clamp01(peer.dropped / Math.max(1, peer.sent));
    return Object.freeze({ id: peer.config.id, state: peer.state, latencyMs: peer.latencyMs, packetLoss: loss, sent: peer.sent, received: peer.received, resent: peer.resent, dropped: peer.dropped, pending: peer.pending.size });
  }

  stats(): NetworkStats {
    let connected = 0; let pending = 0; let sent = 0; let received = 0; let latencySum = 0;
    for (const peer of this.#peers.values()) {
      if (peer.state === 'connected' || peer.state === 'degraded') connected += 1;
      pending += peer.pending.size;
      sent += peer.sent;
      received += peer.received;
      latencySum += peer.latencyMs;
    }
    return Object.freeze({ peers: this.#peers.size, connected, pending, sent, received, dropped: this.#dropped, retransmits: this.#retransmits, averageLatencyMs: this.#peers.size ? latencySum / this.#peers.size : 0 });
  }

  dispose(): void {
    this.#disposed = true;
    for (const peer of this.#peers.values()) peer.pending.clear();
    this.#peers.clear();
  }

  #fail<T>(code: string): EngineResult<T> { return { ok: false, meta: { status: 'rejected', code } }; }
}
