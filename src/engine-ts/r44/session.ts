import { compareNumbers, compareStrings, err, ok, stableDigest, stableStringify, type Result } from "./contracts.ts";

export interface SessionInput<T = unknown> {
  readonly sessionId: string;
  readonly epoch: number;
  readonly sequence: number;
  readonly tick: number;
  readonly clientTimeMs: number;
  readonly payload: T;
  readonly digest: string;
}

export interface InputDecision {
  readonly accepted: boolean;
  readonly reason: "accepted" | "wrong-session" | "wrong-epoch" | "stale-sequence" | "sequence-gap" | "stale-tick" | "future-tick" | "digest-mismatch" | "payload-invalid";
  readonly expectedSequence: number;
  readonly resyncRequired: boolean;
}

export interface SessionPolicy {
  readonly maxGap: number;
  readonly maxTickLag: number;
  readonly maxFutureTicks: number;
  readonly maxInputHistory: number;
  readonly maxPayloadBytes: number;
}

export interface SessionSummary {
  readonly sessionId: string;
  readonly epoch: number;
  readonly lastSequence: number;
  readonly lastTick: number;
  readonly inputCount: number;
  readonly rejectedCount: number;
  readonly digest: string;
}

const DEFAULT_POLICY: SessionPolicy = Object.freeze({
  maxGap: 32,
  maxTickLag: 240,
  maxFutureTicks: 8,
  maxInputHistory: 2048,
  maxPayloadBytes: 32 * 1024,
});

export function createInputEnvelope<T>(
  sessionId: string,
  epoch: number,
  sequence: number,
  tick: number,
  clientTimeMs: number,
  payload: T,
): SessionInput<T> {
  const base = {
    sessionId: sessionId.trim(),
    epoch: Math.max(0, Math.trunc(epoch)),
    sequence: Math.max(1, Math.trunc(sequence)),
    tick: Math.max(0, Math.trunc(tick)),
    clientTimeMs: Math.max(0, Number.isFinite(clientTimeMs) ? clientTimeMs : 0),
    payload,
  };
  return Object.freeze({ ...base, digest: stableDigest(base) });
}

/**
 * Server-authoritative sequence and tick gate. Inputs are stored in a bounded
 * ring-like timeline and returned in tick/sequence order for deterministic replay.
 */
export class SessionTimeline<T = unknown> {
  readonly sessionId: string;
  readonly policy: SessionPolicy;
  #epoch = 0;
  #lastSequence = 0;
  #lastTick = 0;
  #inputs: SessionInput<T>[] = [];
  #rejectedCount = 0;
  #acceptedCount = 0;

  constructor(sessionId: string, policy: Partial<SessionPolicy> = {}) {
    const normalizedId = sessionId.trim().slice(0, 160);
    if (!normalizedId) throw new Error("Session identifier must not be empty.");
    this.sessionId = normalizedId;
    this.policy = Object.freeze({
      maxGap: Math.max(1, Math.trunc(policy.maxGap ?? DEFAULT_POLICY.maxGap)),
      maxTickLag: Math.max(1, Math.trunc(policy.maxTickLag ?? DEFAULT_POLICY.maxTickLag)),
      maxFutureTicks: Math.max(0, Math.trunc(policy.maxFutureTicks ?? DEFAULT_POLICY.maxFutureTicks)),
      maxInputHistory: Math.max(32, Math.trunc(policy.maxInputHistory ?? DEFAULT_POLICY.maxInputHistory)),
      maxPayloadBytes: Math.max(128, Math.trunc(policy.maxPayloadBytes ?? DEFAULT_POLICY.maxPayloadBytes)),
    });
  }

  get epoch(): number {
    return this.#epoch;
  }

  get lastSequence(): number {
    return this.#lastSequence;
  }

  rotateEpoch(nextEpoch: number): Result<true> {
    const next = Math.trunc(nextEpoch);
    if (!Number.isSafeInteger(next) || next <= this.#epoch) return err("SESSION_EPOCH_MONOTONIC", "Session epoch must increase.");
    this.#epoch = next;
    this.#lastSequence = 0;
    this.#inputs = [];
    return ok(true);
  }

  accept(input: SessionInput<T>, authoritativeTick: number): InputDecision {
    const reject = (reason: InputDecision["reason"], resyncRequired: boolean): InputDecision => {
      this.#rejectedCount += 1;
      return Object.freeze({
        accepted: false,
        reason,
        expectedSequence: this.#lastSequence + 1,
        resyncRequired,
      });
    };
    if (input.sessionId !== this.sessionId) return reject("wrong-session", false);
    if (input.epoch !== this.#epoch) return reject("wrong-epoch", true);
    if (!Number.isSafeInteger(input.sequence) || input.sequence <= this.#lastSequence) return reject("stale-sequence", false);
    if (input.sequence !== this.#lastSequence + 1) {
      return reject(input.sequence - this.#lastSequence > this.policy.maxGap ? "sequence-gap" : "sequence-gap", true);
    }
    const currentTick = Math.max(0, Math.trunc(authoritativeTick));
    if (input.tick < currentTick - this.policy.maxTickLag) return reject("stale-tick", true);
    if (input.tick > currentTick + this.policy.maxFutureTicks) return reject("future-tick", false);
    const base = {
      sessionId: input.sessionId,
      epoch: input.epoch,
      sequence: input.sequence,
      tick: input.tick,
      clientTimeMs: input.clientTimeMs,
      payload: input.payload,
    };
    try {
      if (new TextEncoder().encode(stableStringify(input.payload)).byteLength > this.policy.maxPayloadBytes) {
        return reject("payload-invalid", false);
      }
    } catch {
      return reject("payload-invalid", false);
    }
    if (stableDigest(base) !== input.digest) return reject("digest-mismatch", false);
    const detached = JSON.parse(stableStringify(input)) as SessionInput<T>;
    this.#inputs.push(Object.freeze(detached));
    while (this.#inputs.length > this.policy.maxInputHistory) this.#inputs.shift();
    this.#lastSequence = input.sequence;
    this.#lastTick = Math.max(this.#lastTick, input.tick);
    this.#acceptedCount += 1;
    return Object.freeze({ accepted: true, reason: "accepted", expectedSequence: this.#lastSequence + 1, resyncRequired: false });
  }

  inputs(fromTick = 0, toTick = Number.MAX_SAFE_INTEGER): readonly SessionInput<T>[] {
    const from = Math.max(0, Math.trunc(fromTick));
    const to = Math.max(from, Math.trunc(toTick));
    return Object.freeze(this.#inputs
      .filter((input) => input.tick >= from && input.tick <= to)
      .sort((a, b) => compareNumbers(a.tick, b.tick) || compareNumbers(a.sequence, b.sequence)));
  }

  rewindWindow(currentTick: number): readonly SessionInput<T>[] {
    const target = Math.max(0, Math.trunc(currentTick));
    return this.inputs(Math.max(0, target - this.policy.maxTickLag), target);
  }

  summary(): SessionSummary {
    const body = {
      sessionId: this.sessionId,
      epoch: this.#epoch,
      lastSequence: this.#lastSequence,
      lastTick: this.#lastTick,
      inputCount: this.#acceptedCount,
      rejectedCount: this.#rejectedCount,
    };
    return Object.freeze({ ...body, digest: stableDigest({ ...body, inputs: this.#inputs.map((input) => input.digest) }) });
  }

  clear(): void {
    this.#inputs = [];
    this.#lastSequence = 0;
    this.#lastTick = 0;
    this.#acceptedCount = 0;
    this.#rejectedCount = 0;
  }
}

export interface SnapshotPacket<T> {
  readonly sessionId: string;
  readonly epoch: number;
  readonly sequence: number;
  readonly tick: number;
  readonly createdAtMs: number;
  readonly payload: T;
  readonly digest: string;
}

export type SnapshotApplyDecision =
  | { readonly accepted: true; readonly reason: "applied"; readonly expectedSequence: number }
  | { readonly accepted: false; readonly reason: "wrong-session" | "wrong-epoch" | "stale" | "gap" | "invalid-digest" | "too-old" | "too-future"; readonly expectedSequence: number; readonly resyncRequired: boolean };

export class SnapshotSequenceGate<T = unknown> {
  readonly sessionId: string;
  readonly maxAgeMs: number;
  readonly maxFutureSkewMs: number;
  #epoch = 0;
  #sequence = 0;
  #tick = 0;
  #lastCreatedAtMs = 0;
  #payload: T | undefined;

  constructor(sessionId: string, options: { readonly maxAgeMs?: number; readonly maxFutureSkewMs?: number } = {}) {
    this.sessionId = sessionId;
    this.maxAgeMs = Math.max(1, Math.trunc(options.maxAgeMs ?? 5000));
    this.maxFutureSkewMs = Math.max(0, Math.trunc(options.maxFutureSkewMs ?? 250));
  }

  apply(packet: SnapshotPacket<T>, nowMs: number, currentTick: number): SnapshotApplyDecision {
    const reject = (reason: Exclude<SnapshotApplyDecision, { accepted: true }>["reason"], resyncRequired: boolean): SnapshotApplyDecision =>
      Object.freeze({ accepted: false, reason, expectedSequence: this.#sequence + 1, resyncRequired });
    if (packet.sessionId !== this.sessionId) return reject("wrong-session", false);
    if (packet.epoch !== this.#epoch) return reject("wrong-epoch", true);
    if (packet.sequence <= this.#sequence) return reject("stale", false);
    if (packet.sequence !== this.#sequence + 1) return reject("gap", true);
    const now = Math.max(0, Number.isFinite(nowMs) ? nowMs : 0);
    if (packet.createdAtMs < now - this.maxAgeMs) return reject("too-old", true);
    if (packet.createdAtMs > now + this.maxFutureSkewMs) return reject("too-future", false);
    if (packet.tick < this.#tick || packet.tick > Math.max(0, currentTick) + 16) return reject("too-future", true);
    const body = {
      sessionId: packet.sessionId,
      epoch: packet.epoch,
      sequence: packet.sequence,
      tick: packet.tick,
      createdAtMs: packet.createdAtMs,
      payload: packet.payload,
    };
    try {
      if (stableDigest(body) !== packet.digest) return reject("invalid-digest", false);
      stableStringify(packet.payload);
    } catch {
      return reject("invalid-digest", false);
    }
    this.#sequence = packet.sequence;
    this.#tick = packet.tick;
    this.#lastCreatedAtMs = packet.createdAtMs;
    this.#payload = JSON.parse(stableStringify(packet.payload)) as T;
    return Object.freeze({ accepted: true, reason: "applied", expectedSequence: this.#sequence + 1 });
  }

  rotateEpoch(epoch: number): Result<true> {
    if (!Number.isSafeInteger(epoch) || epoch <= this.#epoch) return err("SNAPSHOT_EPOCH_MONOTONIC", "Snapshot epoch must increase.");
    this.#epoch = epoch;
    this.#sequence = 0;
    this.#tick = 0;
    this.#lastCreatedAtMs = 0;
    this.#payload = undefined;
    return ok(true);
  }

  get payload(): T | undefined {
    return this.#payload;
  }

  get latest(): Readonly<{ sequence: number; tick: number; createdAtMs: number; epoch: number }> {
    return Object.freeze({ sequence: this.#sequence, tick: this.#tick, createdAtMs: this.#lastCreatedAtMs, epoch: this.#epoch });
  }
}

/** Constructs a versioned snapshot envelope after validating deterministic JSON serializability. */
export function createSnapshotPacket<T>(
  sessionId: string,
  epoch: number,
  sequence: number,
  tick: number,
  createdAtMs: number,
  payload: T,
): Result<SnapshotPacket<T>> {
  const body = {
    sessionId: sessionId.trim(),
    epoch: Math.max(0, Math.trunc(epoch)),
    sequence: Math.max(1, Math.trunc(sequence)),
    tick: Math.max(0, Math.trunc(tick)),
    createdAtMs: Math.max(0, Number.isFinite(createdAtMs) ? createdAtMs : 0),
    payload,
  };
  try {
    stableStringify(body);
    return ok(Object.freeze({ ...body, digest: stableDigest(body) }));
  } catch (cause) {
    return err("SNAPSHOT_PAYLOAD_INVALID", cause instanceof Error ? cause.message : String(cause));
  }
}
