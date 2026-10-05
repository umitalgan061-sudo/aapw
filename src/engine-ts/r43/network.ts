import { stableDigest, type NetworkEnvelope, type Result, type RuntimeSnapshot } from './contracts.ts';

export interface SequenceAcceptance {
  readonly accepted: boolean;
  readonly duplicate: boolean;
  readonly tooOld: boolean;
  readonly highest: number;
}

export class SequenceWindow {
  readonly width: number;
  #highest = -1;
  #seen = new Set<number>();

  constructor(width = 64) {
    this.width = Math.max(8, Math.trunc(width));
  }

  accept(sequence: number): SequenceAcceptance {
    const safe = Math.trunc(sequence);
    if (safe < 0) return Object.freeze({ accepted: false, duplicate: false, tooOld: true, highest: this.#highest });
    if (safe > this.#highest) {
      this.#highest = safe;
      this.#seen.add(safe);
      this.#trim();
      return Object.freeze({ accepted: true, duplicate: false, tooOld: false, highest: this.#highest });
    }
    if (this.#seen.has(safe)) return Object.freeze({ accepted: false, duplicate: true, tooOld: false, highest: this.#highest });
    if (this.#highest - safe >= this.width) {
      return Object.freeze({ accepted: false, duplicate: false, tooOld: true, highest: this.#highest });
    }
    this.#seen.add(safe);
    this.#trim();
    return Object.freeze({ accepted: true, duplicate: false, tooOld: false, highest: this.#highest });
  }

  highest(): number {
    return this.#highest;
  }

  reset(): void {
    this.#highest = -1;
    this.#seen.clear();
  }

  #trim(): void {
    const floor = this.#highest - this.width + 1;
    for (const value of this.#seen) if (value < floor) this.#seen.delete(value);
  }
}

export interface SnapshotDelta<T extends Record<string, unknown>> {
  readonly changed: Partial<T>;
  readonly removed: readonly string[];
}

export function diffRecord<T extends Record<string, unknown>>(before: T, after: T): SnapshotDelta<T> {
  const changed: Partial<T> = {};
  const removed: string[] = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of [...keys].sort()) {
    if (!(key in after)) {
      removed.push(key);
      continue;
    }
    const beforeValue = before[key];
    const afterValue = after[key];
    if (stableDigest(beforeValue) !== stableDigest(afterValue)) {
      (changed as Record<string, unknown>)[key] = afterValue;
    }
  }
  return Object.freeze({ changed, removed: Object.freeze(removed) });
}

export function applyRecordDelta<T extends Record<string, unknown>>(base: T, delta: SnapshotDelta<T>): T {
  const next: Record<string, unknown> = { ...base };
  for (const key of delta.removed) delete next[key];
  for (const [key, value] of Object.entries(delta.changed)) next[key] = value;
  return next as T;
}

export class SnapshotRing<T> {
  readonly capacity: number;
  #items: NetworkEnvelope<T>[] = [];

  constructor(capacity = 64) {
    this.capacity = Math.max(8, Math.trunc(capacity));
  }

  push(snapshot: NetworkEnvelope<T>): void {
    this.#items.push(snapshot);
    while (this.#items.length > this.capacity) this.#items.shift();
  }

  latest(): NetworkEnvelope<T> | undefined {
    return this.#items[this.#items.length - 1];
  }

  get(sequence: number): NetworkEnvelope<T> | undefined {
    return this.#items.find((item) => item.sequence === sequence);
  }

  since(sequence: number): readonly NetworkEnvelope<T>[] {
    return Object.freeze(this.#items.filter((item) => item.sequence > sequence));
  }

  size(): number {
    return this.#items.length;
  }

  clear(): void {
    this.#items = [];
  }

  values(): readonly NetworkEnvelope<T>[] {
    return Object.freeze([...this.#items]);
  }
}

export interface PredictionFrame<S, I> {
  readonly frame: number;
  readonly input: I;
  readonly state: S;
}

export class PredictionBuffer<S, I> {
  readonly capacity: number;
  #frames: PredictionFrame<S, I>[] = [];

  constructor(capacity = 120) {
    this.capacity = Math.max(8, Math.trunc(capacity));
  }

  push(frame: PredictionFrame<S, I>): void {
    this.#frames.push(frame);
    while (this.#frames.length > this.capacity) this.#frames.shift();
  }

  acknowledge(frame: number): void {
    this.#frames = this.#frames.filter((item) => item.frame > frame);
  }

  replayFrom(
    frame: number,
    initial: S,
    step: (state: S, input: I, frame: number) => S,
  ): S {
    let state = initial;
    for (const item of this.#frames.filter((entry) => entry.frame >= frame).sort((a, b) => a.frame - b.frame)) {
      state = step(state, item.input, item.frame);
    }
    return state;
  }

  size(): number {
    return this.#frames.length;
  }

  values(): readonly PredictionFrame<S, I>[] {
    return Object.freeze([...this.#frames]);
  }

  clear(): void {
    this.#frames = [];
  }
}

export interface NetworkSessionOptions {
  readonly sessionId: string;
  readonly snapshotHz: number;
  readonly maxPayloadBytes: number;
}

export class NetworkSession<S extends Record<string, unknown>> {
  readonly options: NetworkSessionOptions;
  readonly received = new SequenceWindow(128);
  readonly sent = new SnapshotRing<S>();
  #nextSequence = 0;

  constructor(options: NetworkSessionOptions) {
    this.options = Object.freeze({
      sessionId: String(options.sessionId).slice(0, 128),
      snapshotHz: Math.max(1, Math.min(120, Math.trunc(options.snapshotHz))),
      maxPayloadBytes: Math.max(1024, Math.trunc(options.maxPayloadBytes)),
    });
  }

  createEnvelope(payload: S, tick: number, sentAtMs: number, acknowledgedSequence: number): NetworkEnvelope<S> {
    const envelope: NetworkEnvelope<S> = Object.freeze({
      sessionId: this.options.sessionId,
      sequence: this.#nextSequence++,
      acknowledgedSequence: Math.max(-1, Math.trunc(acknowledgedSequence)),
      tick: Math.max(0, Math.trunc(tick)),
      sentAtMs: Math.max(0, Number.isFinite(sentAtMs) ? sentAtMs : 0),
      payload,
    });
    const encoded = stableDigest(envelope);
    if (encoded.length * 8 > this.options.maxPayloadBytes) throw new Error('Network envelope exceeds configured payload budget');
    this.sent.push(envelope);
    return envelope;
  }

  accept(envelope: NetworkEnvelope<S>): Result<S> {
    if (envelope.sessionId !== this.options.sessionId) {
      return { ok: false, error: { code: 'NETWORK_SESSION_MISMATCH', message: 'Session id mismatch.', retryable: false } };
    }
    if (stableDigest(envelope.payload).length * 8 > this.options.maxPayloadBytes) {
      return { ok: false, error: { code: 'NETWORK_PAYLOAD_LIMIT', message: 'Network payload budget exceeded.', retryable: false } };
    }
    const sequence = this.received.accept(envelope.sequence);
    if (!sequence.accepted) {
      return { ok: false, error: { code: 'NETWORK_SEQUENCE_REJECTED', message: sequence.duplicate ? 'Duplicate network packet.' : 'Old network packet.', retryable: false } };
    }
    return { ok: true, value: envelope.payload };
  }

  latestSent(): NetworkEnvelope<S> | undefined {
    return this.sent.latest();
  }
}

export function snapshotDigest(snapshot: RuntimeSnapshot): string {
  return stableDigest({
    version: snapshot.version,
    frame: snapshot.frame,
    tick: snapshot.tick,
    simTimeSeconds: snapshot.simTimeSeconds,
    entities: snapshot.entities,
  });
}
