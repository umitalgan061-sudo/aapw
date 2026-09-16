/**
 * V6 network session model.
 * Transport-agnostic reliability, sequence windows, interpolation, prediction
 * and authority reconciliation. No WebSocket/WebRTC dependency is assumed.
 */

export type NetworkRole = 'client' | 'server' | 'peer';
export type Delivery = 'unreliable' | 'reliable' | 'reliableOrdered';
export type SessionState = 'idle' | 'connecting' | 'connected' | 'degraded' | 'closed';

export interface NetworkEnvelope<P = unknown> {
  readonly channel: string;
  readonly delivery: Delivery;
  readonly sequence: number;
  readonly tick: number;
  readonly sentAtSeconds: number;
  readonly payload: P;
}

export interface AckWindow {
  readonly latest: number;
  readonly mask: number;
}

export interface NetworkMetrics {
  readonly rttMs: number;
  readonly jitterMs: number;
  readonly sendRate: number;
  readonly receiveRate: number;
  readonly lossRatio: number;
  readonly bufferedSnapshots: number;
  readonly predictionError: number;
}

export interface SnapshotFrame<T> {
  readonly tick: number;
  readonly serverTimeSeconds: number;
  readonly state: T;
}

export interface InterpolatedFrame<T> {
  readonly state: T;
  readonly fromTick: number;
  readonly toTick: number;
  readonly alpha: number;
}

export interface PredictionRecord<I, S> {
  readonly tick: number;
  readonly input: I;
  readonly predicted: S;
  readonly authoritative?: S;
}

export interface ReconciliationResult<S> {
  readonly corrected: boolean;
  readonly errorMagnitude: number;
  readonly replayFromTick?: number;
  readonly state: S;
}

export interface NetworkSessionConfig {
  readonly maxPendingReliable: number;
  readonly maxSnapshotBuffer: number;
  readonly interpolationDelayTicks: number;
  readonly maxPredictionHistory: number;
  readonly ackHistory: number;
  readonly degradedLossRatio: number;
  readonly degradedRttMs: number;
}

const DEFAULT_CONFIG: NetworkSessionConfig = {
  maxPendingReliable: 256,
  maxSnapshotBuffer: 64,
  interpolationDelayTicks: 2,
  maxPredictionHistory: 120,
  ackHistory: 32,
  degradedLossRatio: 0.15,
  degradedRttMs: 250,
};

function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }
function finite(value: number): number { return Number.isFinite(value) ? value : 0; }

function compareSequence(a: number, b: number): number {
  if (a === b) return 0;
  const delta = (a - b) >>> 0;
  return delta < 0x80000000 ? 1 : -1;
}

function sequenceIncluded(sequence: number, window: AckWindow): boolean {
  const delta = (window.latest - sequence) >>> 0;
  return delta === 0 || (delta <= 32 && ((window.mask >>> (delta - 1)) & 1) === 1);
}

function insertAck(sequence: number, window: AckWindow): AckWindow {
  if (compareSequence(sequence, window.latest) > 0) {
    const shift = Math.min(32, (sequence - window.latest) >>> 0);
    const mask = shift >= 32 ? 0 : (window.mask << shift) | (shift === 0 ? 0 : 1 << (shift - 1));
    return { latest: sequence >>> 0, mask: mask >>> 0 };
  }
  const delta = (window.latest - sequence) >>> 0;
  if (delta === 0 || delta > 32) return window;
  return { latest: window.latest, mask: (window.mask | (1 << (delta - 1))) >>> 0 };
}

export class NetworkSequenceWindow {
  #latest = 0;
  #mask = 0;

  accept(sequence: number): boolean {
    const normalized = sequence >>> 0;
    const before = this.snapshot();
    const next = insertAck(normalized, before);
    this.#latest = next.latest;
    this.#mask = next.mask;
    return !sequenceIncluded(normalized, before);
  }

  snapshot(): AckWindow { return { latest: this.#latest, mask: this.#mask }; }
  includes(sequence: number): boolean { return sequenceIncluded(sequence >>> 0, this.snapshot()); }
  reset(): void { this.#latest = 0; this.#mask = 0; }
}

export class SnapshotBuffer<T> {
  readonly #capacity: number;
  readonly #frames: SnapshotFrame<T>[] = [];

  constructor(capacity = DEFAULT_CONFIG.maxSnapshotBuffer) { this.#capacity = Math.max(2, Math.floor(capacity)); }

  push(frame: SnapshotFrame<T>): void {
    if (!Number.isSafeInteger(frame.tick) || frame.tick < 0) throw new RangeError('invalid snapshot tick');
    const index = this.#frames.findIndex((entry) => entry.tick >= frame.tick);
    if (index === -1) this.#frames.push(frame);
    else if (this.#frames[index]!.tick === frame.tick) this.#frames[index] = frame;
    else this.#frames.splice(index, 0, frame);
    while (this.#frames.length > this.#capacity) this.#frames.shift();
  }

  latest(): SnapshotFrame<T> | undefined { return this.#frames[this.#frames.length - 1]; }
  oldest(): SnapshotFrame<T> | undefined { return this.#frames[0]; }
  values(): readonly SnapshotFrame<T>[] { return this.#frames; }
  clear(): void { this.#frames.length = 0; }

  sample(targetTick: number, interpolate: (a: T, b: T, alpha: number) => T): InterpolatedFrame<T> | undefined {
    if (this.#frames.length === 0) return undefined;
    if (targetTick <= this.#frames[0]!.tick) {
      const first = this.#frames[0]!;
      return { state: first.state, fromTick: first.tick, toTick: first.tick, alpha: 0 };
    }
    for (let index = 1; index < this.#frames.length; index += 1) {
      const left = this.#frames[index - 1]!;
      const right = this.#frames[index]!;
      if (targetTick <= right.tick) {
        const alpha = clamp((targetTick - left.tick) / Math.max(1, right.tick - left.tick), 0, 1);
        return { state: interpolate(left.state, right.state, alpha), fromTick: left.tick, toTick: right.tick, alpha };
      }
    }
    const latest = this.latest()!;
    return { state: latest.state, fromTick: latest.tick, toTick: latest.tick, alpha: 0 };
  }
}

export class PredictionHistory<I, S> {
  readonly #capacity: number;
  readonly #records: PredictionRecord<I, S>[] = [];

  constructor(capacity = DEFAULT_CONFIG.maxPredictionHistory) { this.#capacity = Math.max(1, Math.floor(capacity)); }

  push(record: PredictionRecord<I, S>): void {
    this.#records.push(record);
    while (this.#records.length > this.#capacity) this.#records.shift();
  }

  fromTick(tick: number): PredictionRecord<I, S>[] { return this.#records.filter((record) => record.tick >= tick); }
  find(tick: number): PredictionRecord<I, S> | undefined { return this.#records.find((record) => record.tick === tick); }
  values(): readonly PredictionRecord<I, S>[] { return this.#records; }
  removeBefore(tick: number): void { while (this.#records.length && this.#records[0]!.tick < tick) this.#records.shift(); }
  clear(): void { this.#records.length = 0; }
}

export class NetworkSession {
  readonly #config: NetworkSessionConfig;
  readonly #role: NetworkRole;
  readonly #sequence = new NetworkSequenceWindow();
  readonly #incoming = new Map<string, NetworkSequenceWindow>();
  readonly #pendingReliable = new Map<number, NetworkEnvelope>();
  readonly #snapshots = new SnapshotBuffer<unknown>();
  readonly #prediction = new PredictionHistory<unknown, unknown>();
  #nextSequence = 0;
  #state: SessionState = 'idle';
  #rttMs = 0;
  #jitterMs = 0;
  #lossRatio = 0;
  #sent = 0;
  #received = 0;
  #predictionError = 0;
  #lastRtt = 0;

  constructor(role: NetworkRole, config: Partial<NetworkSessionConfig> = {}) {
    this.#role = role;
    const merged = { ...DEFAULT_CONFIG, ...config };
    this.#config = {
      maxPendingReliable: Math.max(1, Math.floor(merged.maxPendingReliable)),
      maxSnapshotBuffer: Math.max(2, Math.floor(merged.maxSnapshotBuffer)),
      interpolationDelayTicks: Math.max(0, Math.floor(merged.interpolationDelayTicks)),
      maxPredictionHistory: Math.max(1, Math.floor(merged.maxPredictionHistory)),
      ackHistory: Math.max(1, Math.floor(merged.ackHistory)),
      degradedLossRatio: clamp(merged.degradedLossRatio, 0, 1),
      degradedRttMs: Math.max(1, merged.degradedRttMs),
    };
  }

  get role(): NetworkRole { return this.#role; }
  get state(): SessionState { return this.#state; }

  open(): void { if (this.#state === 'closed') throw new Error('network session is closed'); this.#state = 'connected'; }
  close(): void { this.#state = 'closed'; this.#pendingReliable.clear(); }

  send<P>(channel: string, payload: P, tick: number, nowSeconds: number, delivery: Delivery = 'unreliable'): NetworkEnvelope<P> {
    if (this.#state !== 'connected' && this.#state !== 'degraded') throw new Error('network session is not connected');
    if (!channel || channel.length > 80) throw new TypeError('invalid channel');
    const envelope: NetworkEnvelope<P> = { channel, payload, tick, sentAtSeconds: finite(nowSeconds), delivery, sequence: ++this.#nextSequence };
    this.#sent += 1;
    if (delivery !== 'unreliable') {
      if (this.#pendingReliable.size >= this.#config.maxPendingReliable) throw new Error('reliable send window exhausted');
      this.#pendingReliable.set(envelope.sequence, envelope);
    }
    return envelope;
  }

  receive(envelope: NetworkEnvelope, nowSeconds: number): boolean {
    if (this.#state !== 'connected' && this.#state !== 'degraded') return false;
    const channelWindow = this.#incoming.get(envelope.channel) ?? new NetworkSequenceWindow();
    this.#incoming.set(envelope.channel, channelWindow);
    const accepted = channelWindow.accept(envelope.sequence);
    if (!accepted) return false;
    this.#received += 1;
    if (envelope.delivery !== 'unreliable') this.#sequence.accept(envelope.sequence);
    const observedRtt = Math.max(0, (finite(nowSeconds) - envelope.sentAtSeconds) * 1000);
    this.#updateRtt(observedRtt);
    if (envelope.channel === 'snapshot') this.#snapshots.push(envelope.payload as SnapshotFrame<unknown>);
    this.#refreshHealth();
    return true;
  }

  acknowledge(window: AckWindow): number {
    let acknowledged = 0;
    for (const [sequence] of this.#pendingReliable) {
      if (sequenceIncluded(sequence, window)) { this.#pendingReliable.delete(sequence); acknowledged += 1; }
    }
    return acknowledged;
  }

  pendingReliable(): readonly NetworkEnvelope[] { return [...this.#pendingReliable.values()].sort((a, b) => a.sequence - b.sequence); }

  addPrediction<I, S>(tick: number, input: I, predicted: S): void {
    this.#prediction.push({ tick, input, predicted });
  }

  reconcile<S>(tick: number, authoritative: S, distance: (a: S, b: S) => number, replay: (state: S, inputs: readonly unknown[]) => S): ReconciliationResult<S> {
    const record = this.#prediction.find(tick);
    if (!record) return { corrected: false, errorMagnitude: 0, state: authoritative };
    const predicted = record.predicted as S;
    const errorMagnitude = Math.max(0, finite(distance(predicted, authoritative)));
    this.#predictionError = errorMagnitude;
    if (errorMagnitude <= 0.0001) {
      this.#prediction.removeBefore(tick);
      return { corrected: false, errorMagnitude, state: predicted };
    }
    const future = this.#prediction.fromTick(tick + 1);
    const inputs = future.map((entry) => entry.input);
    const state = replay(authoritative, inputs);
    this.#prediction.removeBefore(tick);
    return { corrected: true, errorMagnitude, replayFromTick: tick, state };
  }

  interpolate<T>(renderTick: number, interpolate: (a: T, b: T, alpha: number) => T): InterpolatedFrame<T> | undefined {
    const target = renderTick - this.#config.interpolationDelayTicks;
    return this.#snapshots.sample(target, interpolate) as InterpolatedFrame<T> | undefined;
  }

  metrics(): NetworkMetrics {
    const receiveRate = Math.min(1, this.#received / Math.max(1, this.#sent));
    return {
      rttMs: this.#rttMs,
      jitterMs: this.#jitterMs,
      sendRate: this.#sent,
      receiveRate: this.#received,
      lossRatio: this.#lossRatio || clamp(1 - receiveRate, 0, 1),
      bufferedSnapshots: this.#snapshots.values().length,
      predictionError: this.#predictionError,
    };
  }

  snapshots(): readonly SnapshotFrame<unknown>[] { return this.#snapshots.values() as readonly SnapshotFrame<unknown>[]; }
  ackWindow(): AckWindow { return this.#sequence.snapshot(); }

  markLoss(sampleRatio: number): void {
    const sample = clamp(finite(sampleRatio), 0, 1);
    this.#lossRatio = this.#lossRatio * 0.8 + sample * 0.2;
    this.#refreshHealth();
  }

  #updateRtt(value: number): void {
    const previous = this.#rttMs;
    this.#rttMs = previous === 0 ? value : previous * 0.9 + value * 0.1;
    this.#jitterMs = this.#jitterMs * 0.9 + Math.abs(value - this.#lastRtt) * 0.1;
    this.#lastRtt = value;
  }

  #refreshHealth(): void {
    if (this.#state === 'closed' || this.#state === 'idle') return;
    this.#state = this.#lossRatio >= this.#config.degradedLossRatio || this.#rttMs >= this.#config.degradedRttMs ? 'degraded' : 'connected';
  }
}

export function interpolateNumber(a: number, b: number, alpha: number): number { return a + (b - a) * clamp(alpha, 0, 1); }
export function interpolateVector3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, alpha: number) {
  const t = clamp(alpha, 0, 1);
  return { x: interpolateNumber(a.x, b.x, t), y: interpolateNumber(a.y, b.y, t), z: interpolateNumber(a.z, b.z, t) };
}

export function validateEnvelope(envelope: NetworkEnvelope): void {
  if (!envelope.channel || envelope.channel.length > 80) throw new TypeError('invalid channel');
  if (!Number.isSafeInteger(envelope.sequence) || envelope.sequence < 1) throw new RangeError('invalid sequence');
  if (!Number.isSafeInteger(envelope.tick) || envelope.tick < 0) throw new RangeError('invalid tick');
  if (!Number.isFinite(envelope.sentAtSeconds) || envelope.sentAtSeconds < 0) throw new RangeError('invalid timestamp');
}
