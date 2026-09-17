import type { NetworkCodec, NetworkTransportPort, PortResult } from './portsR3.ts';

export type NetworkMessageKind = 'input' | 'snapshot' | 'event' | 'ack' | 'hello' | 'goodbye';

export interface NetworkHeader {
  readonly protocol: 3;
  readonly kind: NetworkMessageKind;
  readonly sequence: number;
  readonly tick: number;
  readonly sentAtMs: number;
}

export interface NetworkMessage<TPayload = unknown> {
  readonly header: NetworkHeader;
  readonly payload: TPayload;
}

export interface InputPacket {
  readonly playerId: string;
  readonly actions: readonly { readonly action: string; readonly value: number }[];
}

export interface SnapshotEntity {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly rotation: number;
  readonly state: number;
}

export interface SnapshotPacket {
  readonly baseSequence: number;
  readonly entities: readonly SnapshotEntity[];
  readonly removed: readonly string[];
}

export interface AckPacket {
  readonly sequence: number;
  readonly receivedAtTick: number;
}

export interface NetworkRuntimeOptions {
  readonly maxPayloadBytes?: number;
  readonly maxBufferedMessages?: number;
  readonly maxHistory?: number;
  readonly tickRate?: number;
}

export interface NetworkRuntimeStats {
  readonly sent: number;
  readonly received: number;
  readonly rejected: number;
  readonly dropped: number;
  readonly buffered: number;
  readonly acknowledged: number;
}

interface HistoryEntry {
  readonly message: NetworkMessage;
  readonly encodedBytes: number;
}

const HEADER_KEY = 12;
const MAX_STRING = 128;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)));
}

export class JsonNetworkCodec<T> implements NetworkCodec<NetworkMessage<T>> {
  encode(message: NetworkMessage<T>): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(message));
  }

  decode(bytes: Uint8Array): PortResult<NetworkMessage<T>> {
    try {
      const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
      if (!isRecord(value) || !isRecord(value.header) || !('payload' in value)) {
        return { ok: false, error: { code: 'NET_SHAPE', message: 'Network message shape is invalid.', retryable: false } };
      }
      const header = value.header;
      if (header.protocol !== 3 || typeof header.kind !== 'string' || !Number.isInteger(header.sequence) || !Number.isInteger(header.tick)) {
        return { ok: false, error: { code: 'NET_HEADER', message: 'Network header is invalid.', retryable: false } };
      }
      return { ok: true, value: { header: header as unknown as NetworkHeader, payload: value.payload as T } };
    } catch (error) {
      return { ok: false, error: { code: 'NET_DECODE', message: error instanceof Error ? error.message : String(error), retryable: false } };
    }
  }
}

export class NetworkRuntimeR3<T = unknown> {
  readonly #transport: NetworkTransportPort;
  readonly #codec: NetworkCodec<NetworkMessage<T>>;
  readonly #maxPayloadBytes: number;
  readonly #maxBufferedMessages: number;
  readonly #maxHistory: number;
  readonly #tickRate: number;
  readonly #outbox: Uint8Array[] = [];
  readonly #inbox: NetworkMessage<T>[] = [];
  readonly #history: HistoryEntry[] = [];
  readonly #seenSequences = new Set<number>();
  #sequence = 0;
  #tick = 0;
  #sent = 0;
  #received = 0;
  #rejected = 0;
  #dropped = 0;
  #acknowledged = 0;

  constructor(transport: NetworkTransportPort, codec: NetworkCodec<NetworkMessage<T>>, options: NetworkRuntimeOptions = {}) {
    this.#transport = transport;
    this.#codec = codec;
    this.#maxPayloadBytes = Math.max(256, Math.floor(options.maxPayloadBytes ?? 64 * 1024));
    this.#maxBufferedMessages = Math.max(8, Math.floor(options.maxBufferedMessages ?? 512));
    this.#maxHistory = Math.max(16, Math.floor(options.maxHistory ?? 256));
    this.#tickRate = Math.max(1, Math.floor(options.tickRate ?? 60));
  }

  setTick(tick: number): void {
    this.#tick = Math.max(this.#tick, Math.floor(tick));
  }

  createMessage<TPayload>(kind: NetworkMessageKind, payload: TPayload, sentAtMs: number): NetworkMessage<TPayload> {
    this.#sequence += 1;
    return {
      header: {
        protocol: 3,
        kind,
        sequence: this.#sequence,
        tick: this.#tick,
        sentAtMs: Number.isFinite(sentAtMs) ? Math.max(0, sentAtMs) : 0,
      },
      payload,
    };
  }

  send<TPayload>(kind: NetworkMessageKind, payload: TPayload, sentAtMs: number): PortResult<number> {
    const message = this.createMessage(kind, payload, sentAtMs);
    const bytes = this.#codec.encode(message as NetworkMessage<T>);
    if (bytes.byteLength > this.#maxPayloadBytes) {
      this.#rejected += 1;
      return { ok: false, error: { code: 'NET_PAYLOAD', message: 'Encoded network payload exceeds limit.', retryable: false } };
    }
    if (this.#outbox.length >= this.#maxBufferedMessages) {
      this.#outbox.shift();
      this.#dropped += 1;
    }
    this.#outbox.push(bytes);
    this.#history.push({ message: message as NetworkMessage<T>, encodedBytes: bytes.byteLength });
    while (this.#history.length > this.#maxHistory) this.#history.shift();
    this.#flush();
    return { ok: true, value: message.header.sequence };
  }

  receive(bytes: Uint8Array): PortResult<NetworkMessage<T> | null> {
    if (bytes.byteLength > this.#maxPayloadBytes) {
      this.#rejected += 1;
      return { ok: false, error: { code: 'NET_PAYLOAD', message: 'Incoming payload exceeds limit.', retryable: false } };
    }
    const decoded = this.#codec.decode(bytes);
    if (!decoded.ok) {
      this.#rejected += 1;
      return decoded;
    }
    const { header } = decoded.value;
    if (this.#seenSequences.has(header.sequence)) return { ok: true, value: null };
    if (header.sequence <= 0 || header.kind.length > 32 || header.sequence > Number.MAX_SAFE_INTEGER) {
      this.#rejected += 1;
      return { ok: false, error: { code: 'NET_SEQUENCE', message: 'Incoming sequence is invalid.', retryable: false } };
    }
    this.#seenSequences.add(header.sequence);
    if (this.#seenSequences.size > this.#maxHistory * 2) {
      const oldest = [...this.#seenSequences].sort((a, b) => a - b).slice(0, this.#seenSequences.size - this.#maxHistory);
      for (const sequence of oldest) this.#seenSequences.delete(sequence);
    }
    if (this.#inbox.length >= this.#maxBufferedMessages) {
      this.#inbox.shift();
      this.#dropped += 1;
    }
    this.#inbox.push(decoded.value);
    this.#received += 1;
    if (header.kind === 'ack') this.#acknowledged += 1;
    return { ok: true, value: decoded.value };
  }

  drain(maxMessages = this.#maxBufferedMessages): readonly NetworkMessage<T>[] {
    const count = clampInt(maxMessages, 0, this.#inbox.length);
    return this.#inbox.splice(0, count);
  }

  historySince(sequence: number): readonly NetworkMessage<T>[] {
    return this.#history.filter((entry) => entry.message.header.sequence > sequence).map((entry) => entry.message);
  }

  stats(): NetworkRuntimeStats {
    return {
      sent: this.#sent,
      received: this.#received,
      rejected: this.#rejected,
      dropped: this.#dropped,
      buffered: this.#outbox.length + this.#inbox.length,
      acknowledged: this.#acknowledged,
    };
  }

  #flush(): void {
    while (this.#outbox.length > 0 && this.#transport.ready) {
      const bytes = this.#outbox[0];
      if (!bytes) {
        this.#outbox.shift();
        continue;
      }
      const result = this.#transport.send(bytes);
      if (!result.ok) break;
      this.#outbox.shift();
      this.#sent += 1;
      if (this.#transport.bufferedAmount > this.#maxPayloadBytes * 4) break;
    }
  }
}

export function validateInputPacket(value: unknown): PortResult<InputPacket> {
  if (!isRecord(value) || typeof value.playerId !== 'string' || value.playerId.length === 0 || value.playerId.length > MAX_STRING || !Array.isArray(value.actions)) {
    return { ok: false, error: { code: 'NET_INPUT_SHAPE', message: 'Input packet is invalid.', retryable: false } };
  }
  const actions: { action: string; value: number }[] = [];
  for (const item of value.actions) {
    if (!isRecord(item) || typeof item.action !== 'string' || item.action.length === 0 || item.action.length > MAX_STRING || typeof item.value !== 'number' || !Number.isFinite(item.value)) {
      return { ok: false, error: { code: 'NET_INPUT_ACTION', message: 'Input action is invalid.', retryable: false } };
    }
    actions.push({ action: item.action, value: Math.max(-2, Math.min(2, item.value)) });
  }
  return { ok: true, value: { playerId: value.playerId, actions } };
}

export function createNetworkRuntime<T>(transport: NetworkTransportPort, options?: NetworkRuntimeOptions): NetworkRuntimeR3<T> {
  return new NetworkRuntimeR3<T>(transport, new JsonNetworkCodec<T>(), options);
}
