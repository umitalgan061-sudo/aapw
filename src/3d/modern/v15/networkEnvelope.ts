import {
  checksumV15,
  sequenceV15,
  stableStringifyV15,
  tickV15,
  type NetworkEnvelopeV15,
  type NetworkStatsV15,
} from "./types.ts";

export interface NetworkOptionsV15 {
  readonly protocol?: number;
  readonly maxPayloadBytes?: number;
  readonly maxPacketsPerSecond?: number;
  readonly maxBytesPerSecond?: number;
  readonly historySize?: number;
}

interface BucketV15 {
  tokens: number;
  bytes: number;
  lastMs: number;
}

function payloadBytes(value: unknown): number {
  return new TextEncoder().encode(stableStringifyV15(value)).byteLength;
}

function validKind(value: string): boolean {
  return /^[a-zA-Z0-9._:-]{1,64}$/.test(value);
}

export class SecureNetworkEnvelopeV15<T = unknown> {
  readonly #protocol: number;
  readonly #maxPayloadBytes: number;
  readonly #maxPacketsPerSecond: number;
  readonly #maxBytesPerSecond: number;
  readonly #historySize: number;
  readonly #sent = new Map<number, NetworkEnvelopeV15<T>>();
  readonly #received = new Map<number, NetworkEnvelopeV15<T>>();
  #sentCount = 0;
  #receivedCount = 0;
  #dropped = 0;
  #bytesOut = 0;
  #bytesIn = 0;
  #retransmits = 0;
  #rttMs = 0;
  #nextSequence = sequenceV15(0);
  #lastAck = sequenceV15(0);
  #state: NetworkStatsV15["state"] = "offline";
  #bucket: BucketV15 = { tokens: 60, bytes: 2 * 1024 * 1024, lastMs: 0 };

  constructor(options: NetworkOptionsV15 = {}) {
    this.#protocol = Math.max(1, Math.floor(options.protocol ?? 15));
    this.#maxPayloadBytes = Math.max(512, Math.floor(options.maxPayloadBytes ?? 32_768));
    this.#maxPacketsPerSecond = Math.max(1, Math.floor(options.maxPacketsPerSecond ?? 120));
    this.#maxBytesPerSecond = Math.max(1_024, Math.floor(options.maxBytesPerSecond ?? 2 * 1024 * 1024));
    this.#historySize = Math.max(8, Math.floor(options.historySize ?? 256));
    this.#bucket = { tokens: this.#maxPacketsPerSecond / 2, bytes: this.#maxBytesPerSecond, lastMs: 0 };
  }

  connect(): void { this.#state = "connecting"; }
  ready(): void { this.#state = "online"; }
  disconnect(): void {
    this.#state = "offline";
    this.#sent.clear();
    this.#received.clear();
  }

  build(kind: string, payload: T, tick: number, nowMs = this.#now()): NetworkEnvelopeV15<T> | undefined {
    if (!validKind(kind)) return undefined;
    const bytes = payloadBytes(payload);
    if (bytes > this.#maxPayloadBytes || !this.#consumeBudget(bytes, nowMs)) {
      this.#dropped += 1;
      this.#state = "degraded";
      return undefined;
    }
    const sequence = sequenceV15(Number(this.#nextSequence) + 1);
    this.#nextSequence = sequence;
    const base = {
      protocol: this.#protocol,
      kind,
      sequence,
      ack: this.#lastAck,
      tick: tickV15(Math.max(0, Math.floor(tick))),
      payload,
    };
    const packet = Object.freeze({ ...base, checksum: checksumV15(base) });
    this.#sent.set(Number(sequence), packet);
    this.#sentCount += 1;
    this.#bytesOut += payloadBytes(packet);
    this.#trim();
    return packet;
  }

  parse(envelope: unknown, nowMs = this.#now()): NetworkEnvelopeV15<T> | undefined {
    if (!this.#consumeBudget(0, nowMs)) {
      this.#dropped += 1;
      return undefined;
    }
    if (!envelope || typeof envelope !== "object") {
      this.#dropped += 1;
      return undefined;
    }
    const value = envelope as Partial<NetworkEnvelopeV15<T>>;
    if (value.protocol !== this.#protocol || typeof value.kind !== "string" || !validKind(value.kind)) {
      this.#dropped += 1;
      return undefined;
    }
    if (!Number.isInteger(Number(value.sequence)) || Number(value.sequence) <= 0) {
      this.#dropped += 1;
      return undefined;
    }
    if (!Number.isInteger(Number(value.ack ?? 0)) || Number(value.ack ?? 0) < 0) {
      this.#dropped += 1;
      return undefined;
    }
    if (!Number.isInteger(Number(value.tick ?? 0)) || Number(value.tick ?? 0) < 0) {
      this.#dropped += 1;
      return undefined;
    }
    const base = {
      protocol: this.#protocol,
      kind: value.kind,
      sequence: sequenceV15(Number(value.sequence)),
      ack: sequenceV15(Number(value.ack ?? 0)),
      tick: tickV15(Number(value.tick ?? 0)),
      payload: value.payload as T,
    };
    if (checksumV15(base) !== Number(value.checksum)) {
      this.#dropped += 1;
      return undefined;
    }
    if (payloadBytes(base.payload) > this.#maxPayloadBytes) {
      this.#dropped += 1;
      return undefined;
    }
    const packet = Object.freeze({ ...base, checksum: Number(value.checksum) });
    this.#received.set(Number(base.sequence), packet);
    this.#lastAck = sequenceV15(Math.max(Number(this.#lastAck), Number(base.sequence)));
    this.#receivedCount += 1;
    this.#bytesIn += payloadBytes(packet);
    this.#updateRtt(Number(base.ack), nowMs);
    this.#trim();
    return packet;
  }

  acknowledge(sequence: number): void {
    const key = Math.max(0, Math.floor(sequence));
    this.#sent.delete(key);
    this.#lastAck = sequenceV15(Math.max(Number(this.#lastAck), key));
  }

  markRetransmitted(sequence: number): boolean {
    const packet = this.#sent.get(Math.floor(sequence));
    if (!packet) return false;
    this.#retransmits += 1;
    return true;
  }

  pending(): readonly NetworkEnvelopeV15<T>[] {
    return Object.freeze([...this.#sent.values()].sort((a, b) => Number(a.sequence) - Number(b.sequence)));
  }

  received(): readonly NetworkEnvelopeV15<T>[] {
    return Object.freeze([...this.#received.values()].sort((a, b) => Number(a.sequence) - Number(b.sequence)));
  }

  stats(): NetworkStatsV15 {
    return Object.freeze({
      sent: this.#sentCount,
      received: this.#receivedCount,
      dropped: this.#dropped,
      bytesOut: this.#bytesOut,
      bytesIn: this.#bytesIn,
      retransmits: this.#retransmits,
      rttMs: Number(this.#rttMs.toFixed(3)),
      state: this.#state,
    });
  }

  digest(): number {
    return checksumV15({
      protocol: this.#protocol,
      next: this.#nextSequence,
      ack: this.#lastAck,
      pending: this.pending().map(packet => packet.checksum),
      received: this.received().map(packet => packet.checksum),
      state: this.#state,
    });
  }

  #consumeBudget(bytes: number, nowMs: number): boolean {
    if (!Number.isFinite(nowMs) || nowMs < 0) return false;
    if (nowMs < this.#bucket.lastMs) return false;
    const elapsed = Math.max(0, nowMs - this.#bucket.lastMs) / 1_000;
    this.#bucket.tokens = Math.min(this.#maxPacketsPerSecond, this.#bucket.tokens + elapsed * this.#maxPacketsPerSecond);
    this.#bucket.bytes = Math.min(this.#maxBytesPerSecond, this.#bucket.bytes + elapsed * this.#maxBytesPerSecond);
    this.#bucket.lastMs = nowMs;
    if (this.#bucket.tokens < 1 || this.#bucket.bytes < bytes) return false;
    this.#bucket.tokens -= 1;
    this.#bucket.bytes -= bytes;
    return true;
  }

  #updateRtt(ack: number, nowMs: number): void {
    const sent = this.#sent.get(ack);
    if (!sent) return;
    const estimated = Math.max(0, nowMs - Number(sent.tick) * (1_000 / 60));
    this.#rttMs = this.#rttMs === 0 ? estimated : this.#rttMs * 0.8 + estimated * 0.2;
  }

  #trim(): void {
    while (this.#sent.size > this.#historySize) {
      const first = [...this.#sent.keys()].sort((a, b) => a - b)[0];
      if (first === undefined) break;
      this.#sent.delete(first);
    }
    while (this.#received.size > this.#historySize) {
      const first = [...this.#received.keys()].sort((a, b) => a - b)[0];
      if (first === undefined) break;
      this.#received.delete(first);
    }
  }

  #now(): number {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
  }
}
