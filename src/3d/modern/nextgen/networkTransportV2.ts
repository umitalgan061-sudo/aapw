import { NetworkPacket, NetworkPeer, Tick, hashString, mixHash, stableChecksum, tickValue } from './types.ts';

export type TransportState = 'offline' | 'connecting' | 'online' | 'degraded' | 'closing';
export type ChannelMode = 'reliable-ordered' | 'reliable-unordered' | 'unreliable-sequenced';

export interface TransportChannel {
  id: string;
  mode: ChannelMode;
  maxQueue: number;
  maxPayloadBytes: number;
  priority: number;
}

export interface TransportConfig {
  protocol: number;
  heartbeatTicks: number;
  timeoutTicks: number;
  maxPacketBytes: number;
  maxOutboundPerTick: number;
  maxInboundPerTick: number;
}

export interface TransportPacket<T = unknown> extends NetworkPacket<T> {
  channel: string;
  sentTick: Tick;
  retries: number;
}

export interface TransportStats {
  state: TransportState;
  sentPackets: number;
  receivedPackets: number;
  droppedPackets: number;
  resentPackets: number;
  bytesOut: number;
  bytesIn: number;
  queueDepth: number;
  rttMs: number;
  packetLoss: number;
}

export interface TransportEvent {
  type: 'connected' | 'disconnected' | 'packet-sent' | 'packet-received' | 'packet-dropped' | 'peer-timeout' | 'channel-overflow';
  tick: Tick;
  channel?: string;
  sequence?: number;
  reason?: string;
}

interface QueuedPacket { packet: TransportPacket; channel: TransportChannel; }

const DEFAULT_CONFIG: TransportConfig = {
  protocol: 2,
  heartbeatTicks: 30,
  timeoutTicks: 180,
  maxPacketBytes: 32 * 1024,
  maxOutboundPerTick: 64,
  maxInboundPerTick: 128,
};

function packetBytes(packet: unknown): number {
  try { return new TextEncoder().encode(JSON.stringify(packet)).byteLength; } catch { return Number.MAX_SAFE_INTEGER; }
}

function clonePacket<T>(packet: TransportPacket<T>): TransportPacket<T> {
  return { ...packet, payload: packet.payload };
}

export class NetworkTransportV2<T = unknown> {
  readonly #config: TransportConfig;
  readonly #channels = new Map<string, TransportChannel>();
  readonly #outbound: QueuedPacket[] = [];
  readonly #inbound: TransportPacket[] = [];
  readonly #events: TransportEvent[] = [];
  readonly #unacked = new Map<number, QueuedPacket>();
  readonly #peers = new Map<string, NetworkPeer>();
  readonly #receivedSequences = new Set<number>();
  #state: TransportState = 'offline';
  #sequence = 0;
  #tick: Tick = tickValue(0);
  #lastHeartbeat = 0;
  #stats = { sentPackets: 0, receivedPackets: 0, droppedPackets: 0, resentPackets: 0, bytesOut: 0, bytesIn: 0 };

  constructor(config: Partial<TransportConfig> = {}) { this.#config = { ...DEFAULT_CONFIG, ...config }; }

  get state(): TransportState { return this.#state; }
  get tick(): Tick { return this.#tick; }

  registerChannel(channel: TransportChannel): void {
    if (!channel.id.trim()) throw new RangeError('Channel id must not be empty');
    if (this.#channels.has(channel.id)) throw new Error(`Channel ${channel.id} already registered`);
    if (!Number.isInteger(channel.maxQueue) || channel.maxQueue <= 0) throw new RangeError('maxQueue must be positive integer');
    if (!Number.isInteger(channel.maxPayloadBytes) || channel.maxPayloadBytes <= 0) throw new RangeError('maxPayloadBytes must be positive integer');
    this.#channels.set(channel.id, { ...channel });
  }

  registerDefaults(): void {
    if (!this.#channels.size) {
      this.registerChannel({ id: 'state', mode: 'unreliable-sequenced', maxQueue: 32, maxPayloadBytes: 16 * 1024, priority: 100 });
      this.registerChannel({ id: 'commands', mode: 'reliable-ordered', maxQueue: 128, maxPayloadBytes: 8 * 1024, priority: 90 });
      this.registerChannel({ id: 'events', mode: 'reliable-unordered', maxQueue: 128, maxPayloadBytes: 8 * 1024, priority: 50 });
      this.registerChannel({ id: 'assets', mode: 'reliable-ordered', maxQueue: 16, maxPayloadBytes: 32 * 1024, priority: 10 });
    }
  }

  connect(tick: Tick): void {
    if (this.#state === 'online' || this.#state === 'connecting') return;
    this.#tick = tick;
    this.#state = 'connecting';
    this.#state = 'online';
    this.#pushEvent({ type: 'connected', tick });
  }

  close(tick: Tick, reason = 'manual'): void {
    if (this.#state === 'offline') return;
    this.#state = 'closing';
    this.#outbound.length = 0;
    this.#inbound.length = 0;
    this.#unacked.clear();
    this.#state = 'offline';
    this.#pushEvent({ type: 'disconnected', tick, reason });
  }

  addPeer(peer: NetworkPeer): void { this.#peers.set(peer.id, { ...peer }); }
  removePeer(id: string): boolean { return this.#peers.delete(id); }

  send(channelId: string, payload: T, tick: Tick): TransportPacket<T> | undefined {
    const channel = this.#channels.get(channelId);
    if (!channel || this.#state !== 'online') return undefined;
    if (this.#outbound.filter((item) => item.channel.id === channelId).length >= channel.maxQueue) {
      this.#stats.droppedPackets += 1;
      this.#pushEvent({ type: 'channel-overflow', tick, channel: channelId, reason: 'queue_full' });
      return undefined;
    }
    const sequence = ++this.#sequence;
    const body = { protocol: this.#config.protocol, kind: channelId, sequence, tick, ack: this.#highestAck(), payload };
    const packet: TransportPacket<T> = {
      ...body,
      channel: channelId,
      sentTick: tick,
      retries: 0,
      checksum: stableChecksum(body),
    };
    const bytes = packetBytes(packet);
    if (bytes > Math.min(this.#config.maxPacketBytes, channel.maxPayloadBytes)) {
      this.#stats.droppedPackets += 1;
      this.#pushEvent({ type: 'packet-dropped', tick, channel: channelId, sequence, reason: 'payload_too_large' });
      return undefined;
    }
    const item = { packet: clonePacket(packet), channel };
    this.#outbound.push(item);
    if (channel.mode !== 'unreliable-sequenced') this.#unacked.set(sequence, item);
    return clonePacket(packet);
  }

  injectIncoming(packet: TransportPacket<T>): boolean {
    if (this.#state !== 'online') return false;
    if (!this.#channels.has(packet.channel) || packet.protocol !== this.#config.protocol) return false;
    if (stableChecksum({ protocol: packet.protocol, kind: packet.kind, sequence: packet.sequence, tick: packet.tick, ack: packet.ack, payload: packet.payload }) !== packet.checksum) return false;
    const channel = this.#channels.get(packet.channel)!;
    if (packetBytes(packet) > Math.min(this.#config.maxPacketBytes, channel.maxPayloadBytes)) return false;
    if (channel.mode === 'unreliable-sequenced' && this.#receivedSequences.has(packet.sequence)) return false;
    this.#inbound.push(clonePacket(packet));
    return true;
  }

  flushOutbound(tick: Tick): TransportPacket<T>[] {
    this.#tick = tick;
    const sent: TransportPacket<T>[] = [];
    this.#outbound.sort((a, b) => (b.channel.priority - a.channel.priority) || (a.packet.sequence - b.packet.sequence));
    while (sent.length < this.#config.maxOutboundPerTick && this.#outbound.length) {
      const item = this.#outbound.shift()!;
      sent.push(clonePacket(item.packet as TransportPacket<T>));
      this.#stats.sentPackets += 1;
      this.#stats.bytesOut += packetBytes(item.packet);
      this.#pushEvent({ type: 'packet-sent', tick, channel: item.channel.id, sequence: item.packet.sequence });
    }
    this.#advanceReliability(tick);
    return sent;
  }

  drainInbound(tick: Tick): TransportPacket<T>[] {
    this.#tick = tick;
    const result = this.#inbound.splice(0, this.#config.maxInboundPerTick);
    for (const packet of result) {
      this.#stats.receivedPackets += 1;
      this.#stats.bytesIn += packetBytes(packet);
      this.#receivedSequences.add(packet.sequence);
      this.#ack(packet.ack);
      this.#pushEvent({ type: 'packet-received', tick, channel: packet.channel, sequence: packet.sequence });
    }
    if (this.#receivedSequences.size > 4096) {
      const sequences = [...this.#receivedSequences].sort((a, b) => a - b);
      for (const sequence of sequences.slice(0, sequences.length - 2048)) this.#receivedSequences.delete(sequence);
    }
    return result;
  }

  update(tick: Tick): void {
    this.#tick = tick;
    if (this.#state !== 'online') return;
    if (Number(tick) - this.#lastHeartbeat >= this.#config.heartbeatTicks) {
      this.#lastHeartbeat = Number(tick);
      this.send('events', { heartbeat: true, tick: Number(tick) } as T, tick);
    }
    for (const peer of this.#peers.values()) {
      if (Number(tick) - Number(peer.lastReceiveTick) > this.#config.timeoutTicks) {
        this.#pushEvent({ type: 'peer-timeout', tick, reason: peer.id });
      }
    }
  }

  acknowledge(sequence: number): void { this.#unacked.delete(sequence); }

  stats(): TransportStats {
    const peers = [...this.#peers.values()];
    const rttMs = peers.length ? peers.reduce((sum, peer) => sum + peer.rttMs, 0) / peers.length : 0;
    const packetLoss = peers.length ? peers.reduce((sum, peer) => sum + peer.packetLoss, 0) / peers.length : 0;
    return { state: this.#state, ...this.#stats, queueDepth: this.#outbound.length + this.#inbound.length, rttMs, packetLoss };
  }

  events(): TransportEvent[] { return this.#events.map((event) => ({ ...event })); }
  drainEvents(): TransportEvent[] { const result = this.events(); this.#events.length = 0; return result; }

  digest(): number {
    let digest = hashString(this.#state);
    digest = mixHash(digest, this.#sequence);
    digest = mixHash(digest, this.#stats.sentPackets);
    digest = mixHash(digest, this.#stats.receivedPackets);
    digest = mixHash(digest, this.#stats.resentPackets);
    for (const channel of [...this.#channels.values()].sort((a, b) => a.id.localeCompare(b.id))) digest = mixHash(digest, hashString(`${channel.id}:${channel.mode}`));
    return digest;
  }

  #highestAck(): number { return Math.max(0, ...this.#receivedSequences); }

  #ack(sequence: number): void {
    if (sequence > 0) for (const candidate of [...this.#unacked.keys()]) if (candidate <= sequence) this.#unacked.delete(candidate);
  }

  #advanceReliability(tick: Tick): void {
    for (const [sequence, item] of this.#unacked) {
      const age = Number(tick) - Number(item.packet.sentTick);
      if (age < this.#config.heartbeatTicks * 2) continue;
      if (item.packet.retries >= 3) {
        this.#unacked.delete(sequence);
        this.#stats.droppedPackets += 1;
        this.#pushEvent({ type: 'packet-dropped', tick, channel: item.channel.id, sequence, reason: 'retry_exhausted' });
        continue;
      }
      item.packet.retries += 1;
      item.packet.sentTick = tick;
      this.#outbound.push(item);
      this.#stats.resentPackets += 1;
    }
  }

  #pushEvent(input: TransportEvent): void {
    this.#events.push({ ...input });
    if (this.#events.length > 2048) this.#events.splice(0, this.#events.length - 2048);
  }
}

export function validateTransportConfig(config: TransportConfig): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(config.protocol) || config.protocol <= 0) errors.push('protocol');
  if (!Number.isInteger(config.heartbeatTicks) || config.heartbeatTicks <= 0) errors.push('heartbeatTicks');
  if (!Number.isInteger(config.timeoutTicks) || config.timeoutTicks <= config.heartbeatTicks) errors.push('timeoutTicks');
  if (!Number.isInteger(config.maxPacketBytes) || config.maxPacketBytes <= 0) errors.push('maxPacketBytes');
  if (!Number.isInteger(config.maxOutboundPerTick) || config.maxOutboundPerTick <= 0) errors.push('maxOutboundPerTick');
  if (!Number.isInteger(config.maxInboundPerTick) || config.maxInboundPerTick <= 0) errors.push('maxInboundPerTick');
  return errors;
}
