import { digestValue, normalizeTick, safeJsonSize } from './deterministic.js';
import type { R16Result, R16Source } from './types.js';

export type R16EnvelopeKind = 'command' | 'event' | 'replication' | 'rpc';
export interface R16NetworkEnvelope<T = unknown> {
  readonly version: 16;
  readonly kind: R16EnvelopeKind;
  readonly peerId: string;
  readonly sequence: number;
  readonly tick: number;
  readonly source: R16Source;
  readonly topic: string;
  readonly payload: T;
  readonly sentAtMs: number;
  readonly expiresAtTick: number;
  readonly checksum: string;
}
export interface R16PeerSecurityPolicy {
  readonly peerId: string;
  readonly maxBytesPerTick: number;
  readonly maxMessagesPerTick: number;
  readonly maxPayloadBytes: number;
  readonly maxFutureTicks: number;
  readonly replayWindowTicks: number;
  readonly allowKinds: readonly R16EnvelopeKind[];
}
export interface R16NetworkSecurityStats {
  readonly accepted: number;
  readonly rejected: number;
  readonly replayRejected: number;
  readonly rateRejected: number;
  readonly byteRejected: number;
  readonly invalidRejected: number;
  readonly digest: string;
}

interface PeerState {
  readonly policy: R16PeerSecurityPolicy;
  messages: number;
  bytes: number;
  tick: number;
  lastSequence: number;
  recent: Map<number, number>;
  accepted: number;
  rejected: number;
}

const DEFAULT_POLICY: R16PeerSecurityPolicy = Object.freeze({
  peerId: 'default',
  maxBytesPerTick: 262144,
  maxMessagesPerTick: 256,
  maxPayloadBytes: 65536,
  maxFutureTicks: 4,
  replayWindowTicks: 120,
  allowKinds: Object.freeze(['command', 'event', 'replication', 'rpc']),
});

export class R16NetworkSecurityBoundary {
  readonly #peers = new Map<string, PeerState>();
  #accepted = 0;
  #rejected = 0;
  #replayRejected = 0;
  #rateRejected = 0;
  #byteRejected = 0;
  #invalidRejected = 0;

  registerPolicy(policy: R16PeerSecurityPolicy): R16Result<void> {
    if (!policy.peerId || policy.peerId.length > 96) {
      return this.invalid('NET_PEER_ID', 'Peer id is invalid');
    }
    if (
      !Number.isInteger(policy.maxMessagesPerTick) ||
      policy.maxMessagesPerTick < 1 ||
      policy.maxMessagesPerTick > 10000
    ) {
      return this.invalid('NET_MESSAGE_CAP', 'Message rate limit is invalid');
    }
    if (
      !Number.isInteger(policy.maxBytesPerTick) ||
      policy.maxBytesPerTick < 1024 ||
      policy.maxBytesPerTick > 16 * 1024 * 1024
    ) {
      return this.invalid('NET_BYTE_CAP', 'Byte rate limit is invalid');
    }
    if (
      !Number.isInteger(policy.maxPayloadBytes) ||
      policy.maxPayloadBytes < 256 ||
      policy.maxPayloadBytes > 4 * 1024 * 1024
    ) {
      return this.invalid('NET_PAYLOAD_CAP', 'Payload limit is invalid');
    }

    const normalized: R16PeerSecurityPolicy = Object.freeze({
      ...policy,
      peerId: policy.peerId.slice(0, 96),
      maxMessagesPerTick: Math.trunc(policy.maxMessagesPerTick),
      maxBytesPerTick: Math.trunc(policy.maxBytesPerTick),
      maxPayloadBytes: Math.trunc(policy.maxPayloadBytes),
      maxFutureTicks: Math.max(0, Math.trunc(policy.maxFutureTicks)),
      replayWindowTicks: Math.max(1, Math.trunc(policy.replayWindowTicks)),
      allowKinds: Object.freeze([...new Set(policy.allowKinds)]),
    });

    this.#peers.set(policy.peerId, {
      policy: normalized,
      messages: 0,
      bytes: 0,
      tick: -1,
      lastSequence: -1,
      recent: new Map(),
      accepted: 0,
      rejected: 0,
    });

    return { ok: true, value: undefined };
  }

  validate<T>(
    envelope: R16NetworkEnvelope<T>,
    currentTick: number,
  ): R16Result<R16NetworkEnvelope<T>> {
    const policy = this.#peer(envelope.peerId);
    const tick = normalizeTick(currentTick);

    if (
      envelope.version !== 16 ||
      !envelope.peerId ||
      !envelope.topic ||
      envelope.topic.length > 96 ||
      !Number.isInteger(envelope.sequence) ||
      envelope.sequence < 0
    ) {
      return this.reject(policy, 'NET_ENVELOPE_INVALID', 'Envelope shape is invalid', 'invalid');
    }

    if (!policy.policy.allowKinds.includes(envelope.kind)) {
      return this.reject(policy, 'NET_KIND_DENIED', 'Envelope kind is not allowed', 'invalid');
    }

    if (envelope.tick > tick + policy.policy.maxFutureTicks) {
      return this.reject(policy, 'NET_FUTURE_TICK', 'Envelope is too far ahead of the local simulation', 'invalid');
    }

    if (
      envelope.expiresAtTick < tick ||
      envelope.expiresAtTick < envelope.tick
    ) {
      return this.reject(policy, 'NET_EXPIRED', 'Envelope is expired', 'invalid');
    }

    if (
      !Number.isFinite(envelope.sentAtMs) ||
      envelope.sentAtMs < 0 ||
      envelope.sentAtMs > Number.MAX_SAFE_INTEGER
    ) {
      return this.reject(policy, 'NET_TIME_INVALID', 'Envelope timestamp is invalid', 'invalid');
    }

    const payloadBytes = safeJsonSize(envelope.payload);
    if (payloadBytes > policy.policy.maxPayloadBytes) {
      return this.reject(policy, 'NET_PAYLOAD_TOO_LARGE', 'Envelope payload exceeds limit', 'byte');
    }

    if (envelope.sequence <= policyState(policy).lastSequence) {
      return this.reject(policy, 'NET_SEQUENCE_REPLAY', 'Envelope sequence is not monotonic', 'replay');
    }

    const recentTick = policyState(policy).recent.get(envelope.sequence);
    if (
      recentTick !== undefined &&
      recentTick >= tick - policy.policy.replayWindowTicks
    ) {
      return this.reject(policy, 'NET_DUPLICATE', 'Envelope was already observed', 'replay');
    }

    const expected = digestValue({
      version: envelope.version,
      kind: envelope.kind,
      peerId: envelope.peerId,
      sequence: envelope.sequence,
      tick: envelope.tick,
      source: envelope.source,
      topic: envelope.topic,
      payload: envelope.payload,
      sentAtMs: envelope.sentAtMs,
      expiresAtTick: envelope.expiresAtTick,
    });

    if (expected !== envelope.checksum) {
      return this.reject(policy, 'NET_CHECKSUM', 'Envelope checksum mismatch', 'invalid');
    }

    if (policyState(policy).tick !== tick) {
      const state = policyState(policy);
      state.messages = 0;
      state.bytes = 0;
      state.tick = tick;
    }

    const nextBytes = policyState(policy).bytes + payloadBytes;
    if (policyState(policy).messages + 1 > policy.policy.maxMessagesPerTick) {
      return this.reject(policy, 'NET_RATE_LIMIT', 'Message rate limit exceeded', 'rate');
    }

    if (nextBytes > policy.policy.maxBytesPerTick) {
      return this.reject(policy, 'NET_BYTE_RATE_LIMIT', 'Per-tick byte rate limit exceeded', 'byte');
    }

    const state = policyState(policy);
    state.messages += 1;
    state.bytes = nextBytes;
    state.lastSequence = envelope.sequence;
    state.recent.set(envelope.sequence, tick);
    this.prune(state, tick);
    state.accepted += 1;
    this.#accepted += 1;

    return { ok: true, value: Object.freeze(envelope) };
  }

  createEnvelope<T>(
    kind: R16EnvelopeKind,
    peerId: string,
    sequence: number,
    tick: number,
    source: R16Source,
    topic: string,
    payload: T,
    sentAtMs: number,
    expiresAtTick = tick + 120,
  ): R16NetworkEnvelope<T> {
    const normalizedTick = normalizeTick(tick);
    const envelope = {
      version: 16 as const,
      kind,
      peerId: peerId.slice(0, 96),
      sequence: Math.max(0, Math.trunc(sequence)),
      tick: normalizedTick,
      source,
      topic: topic.slice(0, 96),
      payload,
      sentAtMs: Math.max(0, Number.isFinite(sentAtMs) ? sentAtMs : 0),
      expiresAtTick: Math.max(normalizedTick, Math.trunc(expiresAtTick)),
    };

    return Object.freeze({
      ...envelope,
      checksum: digestValue(envelope),
    });
  }

  peerStats(peerId: string): Readonly<Record<string, number | string>> {
    const state = this.#peerState(peerId);
    return Object.freeze({
      peerId: state.policy.peerId,
      messages: state.messages,
      bytes: state.bytes,
      accepted: state.accepted,
      rejected: state.rejected,
      lastSequence: state.lastSequence,
      digest: digestValue({
        peerId: state.policy.peerId,
        messages: state.messages,
        bytes: state.bytes,
        accepted: state.accepted,
        rejected: state.rejected,
        lastSequence: state.lastSequence,
      }),
    });
  }

  stats(): R16NetworkSecurityStats {
    return Object.freeze({
      accepted: this.#accepted,
      rejected: this.#rejected,
      replayRejected: this.#replayRejected,
      rateRejected: this.#rateRejected,
      byteRejected: this.#byteRejected,
      invalidRejected: this.#invalidRejected,
      digest: digestValue({
        accepted: this.#accepted,
        rejected: this.#rejected,
        replayRejected: this.#replayRejected,
        rateRejected: this.#rateRejected,
        byteRejected: this.#byteRejected,
        invalidRejected: this.#invalidRejected,
      }),
    });
  }

  clear(): void {
    this.#peers.clear();
    this.#accepted = 0;
    this.#rejected = 0;
    this.#replayRejected = 0;
    this.#rateRejected = 0;
    this.#byteRejected = 0;
    this.#invalidRejected = 0;
  }

  #peer(peerId: string): R16PeerSecurityPolicy {
    if (!this.#peers.has(peerId)) {
      this.registerPolicy({
        ...DEFAULT_POLICY,
        peerId: peerId || DEFAULT_POLICY.peerId,
      });
    }

    return this.#peers.get(peerId)?.policy ?? DEFAULT_POLICY;
  }

  #peerStateFromPolicy(policy: R16PeerSecurityPolicy): PeerState {
    return this.#peers.get(policy.peerId)!;
  }

  privatePeerState(policy: R16PeerSecurityPolicy): PeerState {
    return this.#peerStateFromPolicy(policy);
  }

  private invalid(code: string, message: string): R16Result<void> {
    this.#invalidRejected += 1;
    return { ok: false, error: { code, message, retryable: false } };
  }

  private reject(
    policy: R16PeerSecurityPolicy,
    code: string,
    message: string,
    className: 'replay' | 'rate' | 'byte' | 'invalid',
  ): R16Result<never> {
    const state = this.privatePeerState(policy);
    state.rejected += 1;
    this.#rejected += 1;

    if (className === 'replay') this.#replayRejected += 1;
    else if (className === 'rate') this.#rateRejected += 1;
    else if (className === 'byte') this.#byteRejected += 1;
    else this.#invalidRejected += 1;

    return { ok: false, error: { code, message, retryable: className === 'rate' || className === 'byte' } };
  }

  private prune(state: PeerState, tick: number): void {
    const minimumTick = tick - state.policy.replayWindowTicks;
    for (const [sequence, seenTick] of state.recent) {
      if (seenTick < minimumTick) state.recent.delete(sequence);
    }
  }
}

function policyState(policy: R16PeerSecurityPolicy): PeerState {
  return (globalThis as unknown as { __aapwR16NetState?: Map<string, PeerState> }).__aapwR16NetState?.get(policy.peerId) ?? (() => {
    throw new Error('Internal network policy state unavailable');
  })();
}
