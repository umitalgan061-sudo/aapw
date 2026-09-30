import { stableDigest } from './deterministic.ts';

export interface InputFrameV3 {
  readonly tick: number;
  readonly sequence: number;
  readonly payload: unknown;
  readonly clientTimeMs: number;
}

export interface NetworkSnapshotV3<T> {
  readonly tick: number;
  readonly serverTimeMs: number;
  readonly sequence: number;
  readonly state: T;
  readonly digest: string;
}

export interface InterpolationSample<T> {
  readonly snapshot: NetworkSnapshotV3<T>;
  readonly alpha: number;
}

export interface ReconciliationResult<T> {
  readonly corrected: boolean;
  readonly baseTick: number;
  readonly replayedInputs: readonly InputFrameV3[];
  readonly state: T;
  readonly correctionMagnitude: number;
  readonly reason: 'ack' | 'snapshot' | 'digest-mismatch' | 'history-underflow' | 'none';
}

export interface NetworkSessionBudget {
  readonly maxInputHistory: number;
  readonly maxSnapshots: number;
  readonly maxBytesPerSecond: number;
  readonly interpolationDelayMs: number;
  readonly reconciliationTolerance: number;
}

export interface BandwidthSampleV3 {
  readonly timeMs: number;
  readonly bytes: number;
}

const cleanNumber = (value: number, fallback = 0): number =>
  Number.isFinite(value) ? value : fallback;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, cleanNumber(value, min)));

const clone = <T>(value: T): T => {
  if (value === null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
};

export class InputJournalV3 {
  readonly #capacity: number;
  readonly #frames: InputFrameV3[] = [];
  #nextSequence = 1;

  constructor(capacity = 512) {
    this.#capacity = Math.max(16, Math.floor(capacity));
  }

  append(tick: number, payload: unknown, clientTimeMs: number): InputFrameV3 {
    const frame = Object.freeze({
      tick: Math.max(0, Math.floor(tick)),
      sequence: this.#nextSequence++,
      payload: clone(payload),
      clientTimeMs: Math.max(0, cleanNumber(clientTimeMs)),
    });
    this.#frames.push(frame);
    while (this.#frames.length > this.#capacity) this.#frames.shift();
    return frame;
  }

  acknowledge(sequence: number): void {
    const cutoff = Math.floor(sequence);
    while (this.#frames[0] && this.#frames[0].sequence <= cutoff) this.#frames.shift();
  }

  afterTick(tick: number): readonly InputFrameV3[] {
    return Object.freeze(this.#frames.filter((frame) => frame.tick > tick).map(clone));
  }

  afterSequence(sequence: number): readonly InputFrameV3[] {
    return Object.freeze(this.#frames.filter((frame) => frame.sequence > sequence).map(clone));
  }

  latest(): InputFrameV3 | undefined {
    return this.#frames.at(-1);
  }

  oldest(): InputFrameV3 | undefined {
    return this.#frames[0];
  }

  size(): number {
    return this.#frames.length;
  }

  all(): readonly InputFrameV3[] {
    return Object.freeze(this.#frames.map(clone));
  }

  clear(): void {
    this.#frames.length = 0;
  }
}

export class SnapshotBufferV3<T> {
  readonly #capacity: number;
  readonly #snapshots: NetworkSnapshotV3<T>[] = [];

  constructor(capacity = 64) {
    this.#capacity = Math.max(4, Math.floor(capacity));
  }

  push(snapshot: NetworkSnapshotV3<T>): void {
    this.#snapshots.push(Object.freeze({
      ...snapshot,
      state: clone(snapshot.state),
    }));
    this.#snapshots.sort((a, b) => a.serverTimeMs - b.serverTimeMs || a.tick - b.tick || a.sequence - b.sequence);
    const dedupe = new Map<number, NetworkSnapshotV3<T>>();
    for (const item of this.#snapshots) dedupe.set(item.sequence, item);
    this.#snapshots.length = 0;
    this.#snapshots.push(...[...dedupe.values()].slice(-this.#capacity));
  }

  latest(): NetworkSnapshotV3<T> | undefined {
    const value = this.#snapshots.at(-1);
    return value ? Object.freeze({ ...value, state: clone(value.state) }) : undefined;
  }

  atOrBefore(serverTimeMs: number): NetworkSnapshotV3<T> | undefined {
    let selected: NetworkSnapshotV3<T> | undefined;
    for (const snapshot of this.#snapshots) {
      if (snapshot.serverTimeMs <= serverTimeMs) selected = snapshot;
      else break;
    }
    return selected ? Object.freeze({ ...selected, state: clone(selected.state) }) : undefined;
  }

  pair(serverTimeMs: number): readonly [NetworkSnapshotV3<T> | undefined, NetworkSnapshotV3<T> | undefined] {
    let before: NetworkSnapshotV3<T> | undefined;
    let after: NetworkSnapshotV3<T> | undefined;
    for (const snapshot of this.#snapshots) {
      if (snapshot.serverTimeMs <= serverTimeMs) before = snapshot;
      if (snapshot.serverTimeMs >= serverTimeMs) {
        after = snapshot;
        break;
      }
    }
    return [before, after];
  }

  interpolate(
    serverTimeMs: number,
    interpolate: (a: T, b: T, alpha: number) => T,
  ): InterpolationSample<T> | null {
    const [before, after] = this.pair(serverTimeMs);
    if (!before && !after) return null;
    if (!before) return Object.freeze({ snapshot: after!, alpha: 1 });
    if (!after || before.sequence === after.sequence) return Object.freeze({ snapshot: before, alpha: 0 });
    const span = Math.max(1, after.serverTimeMs - before.serverTimeMs);
    const alpha = clamp((serverTimeMs - before.serverTimeMs) / span, 0, 1);
    const state = interpolate(before.state, after.state, alpha);
    const synthetic = Object.freeze({
      tick: before.tick,
      serverTimeMs,
      sequence: before.sequence,
      state: clone(state),
      digest: stableDigest(state),
    });
    return Object.freeze({ snapshot: synthetic, alpha });
  }

  afterTick(tick: number): readonly NetworkSnapshotV3<T>[] {
    return Object.freeze(this.#snapshots.filter((item) => item.tick > tick).map((item) => ({ ...item, state: clone(item.state) })));
  }

  removeThrough(sequence: number): void {
    const cutoff = Math.floor(sequence);
    while (this.#snapshots[0] && this.#snapshots[0].sequence <= cutoff) this.#snapshots.shift();
  }

  all(): readonly NetworkSnapshotV3<T>[] {
    return Object.freeze(this.#snapshots.map((item) => ({ ...item, state: clone(item.state) })));
  }

  size(): number {
    return this.#snapshots.length;
  }

  clear(): void {
    this.#snapshots.length = 0;
  }
}

export class BandwidthEstimatorV3 {
  readonly #windowMs: number;
  readonly #samples: BandwidthSampleV3[] = [];

  constructor(windowMs = 2_000) {
    this.#windowMs = Math.max(250, Math.floor(windowMs));
  }

  observe(timeMs: number, bytes: number): void {
    const sample = Object.freeze({
      timeMs: Math.max(0, cleanNumber(timeMs)),
      bytes: Math.max(0, Math.floor(cleanNumber(bytes))),
    });
    this.#samples.push(sample);
    this.#trim(sample.timeMs);
  }

  bytesPerSecond(nowMs: number): number {
    const now = Math.max(0, cleanNumber(nowMs));
    this.#trim(now);
    const total = this.#samples.reduce((sum, item) => sum + item.bytes, 0);
    if (this.#samples.length < 2) return total * 1000 / Math.max(1, this.#windowMs);
    const start = this.#samples[0]!.timeMs;
    const elapsed = Math.max(1, now - start);
    return total * 1000 / elapsed;
  }

  sampleCount(): number {
    return this.#samples.length;
  }

  clear(): void {
    this.#samples.length = 0;
  }

  #trim(nowMs: number): void {
    const floor = nowMs - this.#windowMs;
    while (this.#samples[0] && this.#samples[0].timeMs < floor) this.#samples.shift();
  }
}

export class NetworkSessionV3<T> {
  readonly #budget: NetworkSessionBudget;
  readonly #inputs: InputJournalV3;
  readonly #snapshots: SnapshotBufferV3<T>;
  readonly #bandwidth = new BandwidthEstimatorV3();
  #serverAckSequence = 0;
  #authoritativeTick = 0;
  #latestServerTimeMs = 0;
  #lastDigest = '';
  #predicted: T | null = null;
  #predictionTick = 0;
  #sequence = 1;
  #corrections = 0;

  constructor(
    budget: Partial<NetworkSessionBudget> = {},
    inputCapacity = 512,
    snapshotCapacity = 64,
  ) {
    this.#budget = Object.freeze({
      maxInputHistory: Math.max(16, Math.floor(budget.maxInputHistory ?? 512)),
      maxSnapshots: Math.max(4, Math.floor(budget.maxSnapshots ?? 64)),
      maxBytesPerSecond: Math.max(1024, Math.floor(budget.maxBytesPerSecond ?? 512 * 1024)),
      interpolationDelayMs: Math.max(0, cleanNumber(budget.interpolationDelayMs, 100)),
      reconciliationTolerance: Math.max(0, cleanNumber(budget.reconciliationTolerance, 0.001)),
    });
    this.#inputs = new InputJournalV3(Math.min(inputCapacity, this.#budget.maxInputHistory));
    this.#snapshots = new SnapshotBufferV3(Math.min(snapshotCapacity, this.#budget.maxSnapshots));
  }

  submitInput(tick: number, payload: unknown, clientTimeMs: number): InputFrameV3 {
    return this.#inputs.append(tick, payload, clientTimeMs);
  }

  receiveSnapshot(snapshot: NetworkSnapshotV3<T>, receivedAtMs: number, packetBytes = 0): void {
    const safeSnapshot = Object.freeze({
      ...snapshot,
      tick: Math.max(0, Math.floor(snapshot.tick)),
      sequence: Math.max(0, Math.floor(snapshot.sequence)),
      serverTimeMs: Math.max(0, cleanNumber(snapshot.serverTimeMs)),
      state: clone(snapshot.state),
    });
    this.#snapshots.push(safeSnapshot);
    this.#authoritativeTick = Math.max(this.#authoritativeTick, safeSnapshot.tick);
    this.#latestServerTimeMs = Math.max(this.#latestServerTimeMs, safeSnapshot.serverTimeMs);
    this.#lastDigest = safeSnapshot.digest;
    this.#bandwidth.observe(receivedAtMs, Math.max(0, Math.floor(packetBytes)));
  }

  acknowledgeInput(sequence: number): void {
    this.#serverAckSequence = Math.max(this.#serverAckSequence, Math.floor(sequence));
    this.#inputs.acknowledge(this.#serverAckSequence);
  }

  setPredictedState(state: T, tick: number): void {
    this.#predicted = clone(state);
    this.#predictionTick = Math.max(0, Math.floor(tick));
  }

  predictedState(): T | null {
    return this.#predicted === null ? null : clone(this.#predicted);
  }

  reconcile(
    authoritative: T,
    authoritativeTick: number,
    applyInput: (state: T, input: InputFrameV3) => T,
    distance: (a: T, b: T) => number,
  ): ReconciliationResult<T> {
    const baseTick = Math.max(0, Math.floor(authoritativeTick));
    if (this.#predicted === null) {
      this.setPredictedState(authoritative, baseTick);
      return Object.freeze({
        corrected: true,
        baseTick,
        replayedInputs: Object.freeze([]),
        state: clone(authoritative),
        correctionMagnitude: 0,
        reason: 'history-underflow',
      });
    }
    const correctionMagnitude = Math.max(0, cleanNumber(distance(this.#predicted, authoritative)));
    const needsCorrection = correctionMagnitude > this.#budget.reconciliationTolerance || this.#predictionTick < baseTick;
    const replayed = this.#inputs.afterTick(baseTick);
    if (!needsCorrection) {
      return Object.freeze({
        corrected: false,
        baseTick,
        replayedInputs: Object.freeze(replayed),
        state: clone(this.#predicted),
        correctionMagnitude,
        reason: 'none',
      });
    }
    let state = clone(authoritative);
    for (const frame of replayed) state = applyInput(state, frame);
    this.#predicted = clone(state);
    this.#predictionTick = replayed.at(-1)?.tick ?? baseTick;
    this.#corrections += 1;
    const reason: ReconciliationResult<T>['reason'] =
      correctionMagnitude > this.#budget.reconciliationTolerance ? 'digest-mismatch' : 'snapshot';
    return Object.freeze({
      corrected: true,
      baseTick,
      replayedInputs: Object.freeze(replayed),
      state: clone(state),
      correctionMagnitude,
      reason,
    });
  }

  interpolationState(
    clientNowMs: number,
    interpolate: (a: T, b: T, alpha: number) => T,
  ): InterpolationSample<T> | null {
    const target = Math.max(0, cleanNumber(clientNowMs)) - this.#budget.interpolationDelayMs;
    return this.#snapshots.interpolate(target, interpolate);
  }

  latestSnapshot(): NetworkSnapshotV3<T> | undefined {
    return this.#snapshots.latest();
  }

  inputHistory(): readonly InputFrameV3[] {
    return this.#inputs.all();
  }

  snapshots(): readonly NetworkSnapshotV3<T>[] {
    return this.#snapshots.all();
  }

  bandwidthBytesPerSecond(nowMs: number): number {
    return Math.min(this.#budget.maxBytesPerSecond, this.#bandwidth.bytesPerSecond(nowMs));
  }

  stats(): Readonly<{
    acknowledgedSequence: number;
    authoritativeTick: number;
    predictedTick: number;
    latestServerTimeMs: number;
    inputHistory: number;
    snapshots: number;
    corrections: number;
    bandwidthBytesPerSecond: number;
    digest: string;
  }> {
    const digest = stableDigest({
      ack: this.#serverAckSequence,
      authoritative: this.#authoritativeTick,
      predicted: this.#predictionTick,
      serverTime: this.#latestServerTimeMs,
      inputs: this.#inputs.size(),
      snapshots: this.#snapshots.size(),
      corrections: this.#corrections,
      digest: this.#lastDigest,
      sequence: this.#sequence,
    });
    return Object.freeze({
      acknowledgedSequence: this.#serverAckSequence,
      authoritativeTick: this.#authoritativeTick,
      predictedTick: this.#predictionTick,
      latestServerTimeMs: this.#latestServerTimeMs,
      inputHistory: this.#inputs.size(),
      snapshots: this.#snapshots.size(),
      corrections: this.#corrections,
      bandwidthBytesPerSecond: this.#bandwidth.bytesPerSecond(this.#latestServerTimeMs),
      digest,
    });
  }

  clear(): void {
    this.#inputs.clear();
    this.#snapshots.clear();
    this.#predicted = null;
    this.#predictionTick = 0;
    this.#serverAckSequence = 0;
    this.#authoritativeTick = 0;
    this.#latestServerTimeMs = 0;
    this.#lastDigest = '';
    this.#bandwidth.clear();
    this.#sequence = 1;
  }
}
