import type { NetworkPortR31 } from './applicationTypesR31.ts';
import { RateLimiterR31, DEFAULT_SECURITY_POLICY_R31, estimatePayloadBytesR31, validatePayloadR31 } from './securityR31.ts';

export interface NetworkPacketR31 {
  readonly sequence: number;
  readonly tick: number;
  readonly sentAtMs: number;
  readonly kind: 'input' | 'snapshot' | 'event' | 'ack';
  readonly payload: unknown;
}

export interface NetworkSessionConfigR31 {
  readonly maxPacketBytes: number;
  readonly maxPacketsPerSecond: number;
  readonly maxBufferedPackets: number;
  readonly interpolationDelayTicks: number;
}

export interface NetworkSessionDiagnosticsR31 {
  readonly connected: boolean;
  readonly sentPackets: number;
  readonly receivedPackets: number;
  readonly rejectedPackets: number;
  readonly droppedPackets: number;
  readonly bytesSent: number;
  readonly bytesReceived: number;
  readonly sequence: number;
  readonly lastRemoteTick: number;
  readonly interpolationDelayTicks: number;
}

export const DEFAULT_NETWORK_SESSION_R31: NetworkSessionConfigR31 = Object.freeze({
  maxPacketBytes: DEFAULT_SECURITY_POLICY_R31.maxPayloadBytes,
  maxPacketsPerSecond: 60,
  maxBufferedPackets: 128,
  interpolationDelayTicks: 2,
});

export class NetworkSessionR31 {
  readonly #port: NetworkPortR31;
  readonly #config: NetworkSessionConfigR31;
  readonly #limiter: RateLimiterR31;
  readonly #inbound: NetworkPacketR31[] = [];
  #sequence = 0;
  #remoteTick = 0;
  #sentPackets = 0;
  #receivedPackets = 0;
  #rejectedPackets = 0;
  #droppedPackets = 0;
  #bytesSent = 0;
  #bytesReceived = 0;

  constructor(port: NetworkPortR31, config: NetworkSessionConfigR31 = DEFAULT_NETWORK_SESSION_R31) {
    if (config.maxPacketBytes < 128) throw new Error('maxPacketBytes is too small');
    if (config.maxBufferedPackets < 1) throw new Error('maxBufferedPackets must be positive');
    this.#port = port;
    this.#config = Object.freeze({ ...config });
    this.#limiter = new RateLimiterR31(config.maxPacketsPerSecond, 1000);
  }

  send(packet: Omit<NetworkPacketR31, 'sequence'>, nowMs: number): boolean {
    if (!this.#port.connected()) return false;
    if (!this.#limiter.allow(nowMs)) {
      this.#rejectedPackets++;
      return false;
    }
    const candidate: NetworkPacketR31 = Object.freeze({ ...packet, sequence: ++this.#sequence });
    const validation = validatePayloadR31(candidate.payload);
    if (!validation.allowed || estimatePayloadBytesR31(candidate) > this.#config.maxPacketBytes) {
      this.#rejectedPackets++;
      return false;
    }
    const bytes = new TextEncoder().encode(JSON.stringify(candidate));
    if (bytes.byteLength > this.#config.maxPacketBytes) {
      this.#rejectedPackets++;
      return false;
    }
    this.#port.send(bytes);
    this.#sentPackets++;
    this.#bytesSent += bytes.byteLength;
    return true;
  }

  receive(bytes: Uint8Array): boolean {
    if (bytes.byteLength > this.#config.maxPacketBytes) {
      this.#rejectedPackets++;
      return false;
    }
    try {
      const packet = JSON.parse(new TextDecoder().decode(bytes)) as NetworkPacketR31;
      if (!Number.isInteger(packet.sequence) || packet.sequence < 1) throw new Error('invalid-sequence');
      if (!Number.isInteger(packet.tick) || packet.tick < 0) throw new Error('invalid-tick');
      const validation = validatePayloadR31(packet.payload);
      if (!validation.allowed) throw new Error(validation.reason);
      this.#remoteTick = Math.max(this.#remoteTick, packet.tick);
      this.#receivedPackets++;
      this.#bytesReceived += bytes.byteLength;
      this.#inbound.push(Object.freeze(packet));
      this.#inbound.sort((a, b) => a.tick - b.tick || a.sequence - b.sequence);
      while (this.#inbound.length > this.#config.maxBufferedPackets) {
        this.#inbound.shift();
        this.#droppedPackets++;
      }
      return true;
    } catch {
      this.#rejectedPackets++;
      return false;
    }
  }

  drain(maxPackets = this.#config.maxBufferedPackets): readonly NetworkPacketR31[] {
    const count = Math.max(0, Math.floor(maxPackets));
    const packets = this.#inbound.splice(0, count);
    return Object.freeze(packets);
  }

  close(): void {
    this.#inbound.length = 0;
    this.#port.close();
  }

  diagnostics(): NetworkSessionDiagnosticsR31 {
    return Object.freeze({
      connected: this.#port.connected(),
      sentPackets: this.#sentPackets,
      receivedPackets: this.#receivedPackets,
      rejectedPackets: this.#rejectedPackets,
      droppedPackets: this.#droppedPackets,
      bytesSent: this.#bytesSent,
      bytesReceived: this.#bytesReceived,
      sequence: this.#sequence,
      lastRemoteTick: this.#remoteTick,
      interpolationDelayTicks: this.#config.interpolationDelayTicks,
    });
  }
}
