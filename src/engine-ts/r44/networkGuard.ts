/**
 * Protocol boundary and replay/rate guards for untrusted runtime messages.
 * This is validation, not encryption or authentication; network adapters still
 * need transport security and cryptographic peer identity.
 */
import {
  R44BoundaryError,
  type R44Fingerprint,
  type R44JsonValue,
  r44FiniteInteger,
  r44NormalizeId,
  r44NormalizeLabel,
} from "./contracts.js";
import { r44CanonicalStringify, r44Fingerprint } from "./hash.js";

export interface R44NetworkEnvelope {
  readonly protocol: number;
  readonly channel: string;
  readonly sender: string;
  readonly sequence: number;
  readonly tick: number;
  readonly messageId: string;
  readonly kind: string;
  readonly payload: R44JsonValue;
  readonly fingerprint?: string;
}

export interface R44NetworkGuardPolicy {
  readonly protocol: number;
  readonly allowedKinds: readonly string[];
  readonly allowedChannels: readonly string[];
  readonly maxPayloadBytes: number;
  readonly maxFutureTickDelta: number;
  readonly maxPastTickDelta: number;
  readonly replayWindowSize: number;
  readonly rateCapacity: number;
  readonly rateRefillPerTick: number;
  readonly maxTrackedSenders: number;
}

export type R44NetworkRejectCode =
  | "invalid-envelope"
  | "protocol-mismatch"
  | "channel-denied"
  | "kind-denied"
  | "payload-too-large"
  | "fingerprint-mismatch"
  | "tick-out-of-range"
  | "replay"
  | "rate-limited"
  | "sender-capacity";

export interface R44NetworkValidation {
  readonly accepted: boolean;
  readonly code: R44NetworkRejectCode | null;
  readonly message: string | null;
  readonly sender: string | null;
  readonly fingerprint: R44Fingerprint | null;
  readonly remainingTokens: number;
  readonly observedAtTick: number;
}

interface R44ReplayWindow {
  highest: number;
  readonly received: Set<number>;
}

interface R44TokenBucket {
  tokens: number;
  lastTick: number;
}

const R44_DEFAULT_POLICY: R44NetworkGuardPolicy = Object.freeze({
  protocol: 1,
  allowedKinds: Object.freeze(["input", "snapshot", "delta", "command", "event", "ack"]),
  allowedChannels: Object.freeze(["gameplay", "world", "session", "telemetry"]),
  maxPayloadBytes: 64 * 1024,
  maxFutureTickDelta: 240,
  maxPastTickDelta: 60 * 60 * 60,
  replayWindowSize: 128,
  rateCapacity: 120,
  rateRefillPerTick: 2,
  maxTrackedSenders: 4096,
});

export class R44NetworkGuard {
  readonly #policy: R44NetworkGuardPolicy;
  readonly #allowedKinds: ReadonlySet<string>;
  readonly #allowedChannels: ReadonlySet<string>;
  readonly #replay = new Map<string, R44ReplayWindow>();
  readonly #buckets = new Map<string, R44TokenBucket>();
  #lastTick = 0;
  #accepted = 0;
  #rejected = 0;
  #rejections: Record<string, number> = Object.create(null) as Record<string, number>;

  constructor(policy: Partial<R44NetworkGuardPolicy> = {}) {
    this.#policy = Object.freeze({
      ...R44_DEFAULT_POLICY,
      ...policy,
      allowedKinds: Object.freeze([...(policy.allowedKinds ?? R44_DEFAULT_POLICY.allowedKinds)]),
      allowedChannels: Object.freeze([...(policy.allowedChannels ?? R44_DEFAULT_POLICY.allowedChannels)]),
    });
    r44FiniteInteger(this.#policy.protocol, "protocol", 1, 1_000_000);
    r44FiniteInteger(this.#policy.maxPayloadBytes, "maxPayloadBytes", 128, 16 * 1024 * 1024);
    r44FiniteInteger(this.#policy.maxFutureTickDelta, "maxFutureTickDelta", 0);
    r44FiniteInteger(this.#policy.maxPastTickDelta, "maxPastTickDelta", 0);
    r44FiniteInteger(this.#policy.replayWindowSize, "replayWindowSize", 8, 65_536);
    r44FiniteInteger(this.#policy.rateCapacity, "rateCapacity", 1, 10_000_000);
    if (!Number.isFinite(this.#policy.rateRefillPerTick) || this.#policy.rateRefillPerTick < 0) {
      throw new R44BoundaryError("network-refill", "rateRefillPerTick must be non-negative");
    }
    r44FiniteInteger(this.#policy.maxTrackedSenders, "maxTrackedSenders", 1, 1_000_000);
    this.#allowedKinds = new Set(this.#policy.allowedKinds.map((value) => r44NormalizeLabel(value, 96)));
    this.#allowedChannels = new Set(this.#policy.allowedChannels.map((value) => r44NormalizeLabel(value, 96)));
  }

  get acceptedCount(): number { return this.#accepted; }
  get rejectedCount(): number { return this.#rejected; }

  validate(envelopeInput: R44NetworkEnvelope, currentTickInput: number): R44NetworkValidation {
    const currentTick = r44FiniteInteger(currentTickInput, "currentTick", this.#lastTick);
    this.#lastTick = currentTick;
    let sender: string | null = null;
    try {
      const envelope = this.#normalizeEnvelope(envelopeInput);
      sender = envelope.sender;
      if (envelope.protocol !== this.#policy.protocol) return this.#reject("protocol-mismatch", "Unsupported protocol", sender, currentTick);
      if (!this.#allowedChannels.has(envelope.channel)) return this.#reject("channel-denied", "Channel is not allowlisted", sender, currentTick);
      if (!this.#allowedKinds.has(envelope.kind)) return this.#reject("kind-denied", "Message kind is not allowlisted", sender, currentTick);
      if (envelope.tick > currentTick + this.#policy.maxFutureTickDelta || envelope.tick < currentTick - this.#policy.maxPastTickDelta) {
        return this.#reject("tick-out-of-range", "Message tick is outside the accepted horizon", sender, currentTick);
      }
      const encoded = r44CanonicalStringify({
        protocol: envelope.protocol,
        channel: envelope.channel,
        sender: envelope.sender,
        sequence: envelope.sequence,
        tick: envelope.tick,
        messageId: envelope.messageId,
        kind: envelope.kind,
        payload: envelope.payload,
      } as unknown as R44JsonValue, { maxEncodedLength: this.#policy.maxPayloadBytes + 4096 });
      if (new TextEncoder().encode(encoded).byteLength > this.#policy.maxPayloadBytes) {
        return this.#reject("payload-too-large", "Envelope exceeds payload limit", sender, currentTick);
      }
      const fingerprint = r44Fingerprint(JSON.parse(encoded) as R44JsonValue).fingerprint;
      if (envelope.fingerprint !== undefined && envelope.fingerprint !== fingerprint) {
        return this.#reject("fingerprint-mismatch", "Envelope fingerprint mismatch", sender, currentTick);
      }
      if (!this.#consumeRate(sender, envelope.channel, currentTick)) {
        return this.#reject("rate-limited", "Sender exceeded protocol rate budget", sender, currentTick);
      }
      if (!this.#acceptSequence(sender, envelope.channel, envelope.sequence)) {
        return this.#reject("replay", "Duplicate or stale message sequence", sender, currentTick);
      }
      this.#accepted += 1;
      return Object.freeze({
        accepted: true,
        code: null,
        message: null,
        sender,
        fingerprint,
        remainingTokens: this.#buckets.get(this.#bucketKey(sender, envelope.channel))?.tokens ?? 0,
        observedAtTick: currentTick,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid envelope";
      return this.#reject("invalid-envelope", message, sender, currentTick);
    }
  }

  allowlisted(kind: string, channel: string): boolean {
    return this.#allowedKinds.has(kind) && this.#allowedChannels.has(channel);
  }

  snapshot(): Readonly<Record<string, R44JsonValue>> {
    const senderSequences = [...this.#replay.entries()].map(([key, window]) => ({
      key, highest: window.highest, retainedSequences: window.received.size,
    }));
    const rejectionCounts: Record<string, R44JsonValue> = Object.create(null) as Record<string, R44JsonValue>;
    for (const [key, value] of Object.entries(this.#rejections)) rejectionCounts[key] = value;
    return Object.freeze({
      protocol: this.#policy.protocol,
      observedTick: this.#lastTick,
      accepted: this.#accepted,
      rejected: this.#rejected,
      trackedSenders: this.#replay.size,
      senderSequences,
      rejectionCounts,
    });
  }

  clearSender(senderInput: string): number {
    const sender = r44NormalizeId(senderInput, "sender", 128);
    let removed = 0;
    for (const key of [...this.#replay.keys()]) {
      if (key.startsWith(sender + "|")) {
        this.#replay.delete(key);
        this.#buckets.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  #normalizeEnvelope(input: R44NetworkEnvelope): R44NetworkEnvelope {
    if (input === null || typeof input !== "object") throw new R44BoundaryError("envelope-type", "Envelope must be an object");
    const protocol = r44FiniteInteger(input.protocol, "protocol", 1, 1_000_000);
    const channel = r44NormalizeLabel(input.channel, 96);
    const sender = r44NormalizeId(input.sender, "sender", 128);
    const sequence = r44FiniteInteger(input.sequence, "sequence", 1, Number.MAX_SAFE_INTEGER);
    const tick = r44FiniteInteger(input.tick, "tick", 0, Number.MAX_SAFE_INTEGER);
    const messageId = r44NormalizeId(input.messageId, "messageId", 160);
    const kind = r44NormalizeLabel(input.kind, 96);
    return Object.freeze({ ...input, protocol, channel, sender, sequence, tick, messageId, kind });
  }

  #acceptSequence(sender: string, channel: string, sequence: number): boolean {
    const key = this.#bucketKey(sender, channel);
    let window = this.#replay.get(key);
    if (window === undefined) {
      if (this.#replay.size >= this.#policy.maxTrackedSenders) {
        const oldest = this.#replay.keys().next().value as string | undefined;
        if (oldest === undefined) return false;
        this.#replay.delete(oldest);
        this.#buckets.delete(oldest);
      }
      window = { highest: sequence, received: new Set([sequence]) };
      this.#replay.set(key, window);
      return true;
    }
    if (sequence <= window.highest - this.#policy.replayWindowSize) return false;
    if (window.received.has(sequence)) return false;
    window.received.add(sequence);
    if (sequence > window.highest) window.highest = sequence;
    const minimum = Math.max(1, window.highest - this.#policy.replayWindowSize + 1);
    for (const prior of window.received) if (prior < minimum) window.received.delete(prior);
    return true;
  }

  #consumeRate(sender: string, channel: string, tick: number): boolean {
    const key = this.#bucketKey(sender, channel);
    let bucket = this.#buckets.get(key);
    if (bucket === undefined) {
      bucket = { tokens: this.#policy.rateCapacity, lastTick: tick };
      this.#buckets.set(key, bucket);
    }
    if (tick < bucket.lastTick) return false;
    bucket.tokens = Math.min(this.#policy.rateCapacity, bucket.tokens + (tick - bucket.lastTick) * this.#policy.rateRefillPerTick);
    bucket.lastTick = tick;
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  #bucketKey(sender: string, channel: string): string {
    return sender + "|" + channel;
  }

  #reject(code: R44NetworkRejectCode, message: string, sender: string | null, tick: number): R44NetworkValidation {
    this.#rejected += 1;
    this.#rejections[code] = (this.#rejections[code] ?? 0) + 1;
    return Object.freeze({
      accepted: false,
      code,
      message: message.slice(0, 512),
      sender,
      fingerprint: null,
      remainingTokens: sender === null ? 0 : this.#buckets.get(this.#bucketKey(sender, "gameplay"))?.tokens ?? 0,
      observedAtTick: tick,
    });
  }
}
