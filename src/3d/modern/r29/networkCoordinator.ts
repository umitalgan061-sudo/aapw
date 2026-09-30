import { clampR29, stableObjectDigestR29, type R29InputIntent, type R29NetworkHealth, type R29NetworkReport, type R29NetworkSample, type R29NetworkSnapshot, type R29PredictionFrame, type R29Vector3 } from './contracts.ts';

export interface R29NetworkCoordinatorOptions {
  readonly maxSamples?: number;
  readonly maxPredictionFrames?: number;
  readonly interpolationTicks?: number;
}

export interface R29ReconciliationResult {
  readonly accepted: boolean;
  readonly acknowledgedInput: number;
  readonly replayed: number;
  readonly correctedEntities: number;
  readonly reason: string;
}

export class R29NetworkCoordinator {
  readonly maxSamples: number;
  readonly maxPredictionFrames: number;
  readonly baseInterpolationTicks: number;

  #samples: R29NetworkSample[] = [];
  #predictions: R29PredictionFrame[] = [];
  #lastServerTick = 0;
  #lastSequence = 0;
  #acknowledgedInput = 0;

  constructor(options: R29NetworkCoordinatorOptions = {}) {
    this.maxSamples = Math.max(8, Math.floor(options.maxSamples ?? 120));
    this.maxPredictionFrames = Math.max(16, Math.floor(options.maxPredictionFrames ?? 256));
    this.baseInterpolationTicks = Math.max(0, Math.floor(options.interpolationTicks ?? 2));
  }

  record(sample: R29NetworkSample): void {
    this.#samples.push(Object.freeze({
      ...sample,
      rttMs: Math.max(0, sample.rttMs),
      jitterMs: Math.max(0, sample.jitterMs),
      lossRatio: clampR29(sample.lossRatio, 0, 1),
      inboundBytes: Math.max(0, sample.inboundBytes),
      outboundBytes: Math.max(0, sample.outboundBytes),
      acknowledgedSequence: Math.max(0, Math.floor(sample.acknowledgedSequence)),
    }));
    this.#acknowledgedInput = Math.max(this.#acknowledgedInput, sample.acknowledgedSequence);
    while (this.#samples.length > this.maxSamples) this.#samples.shift();
  }

  queuePrediction(input: R29InputIntent, state: unknown): R29PredictionFrame {
    const prediction = Object.freeze({
      tick: input.tick,
      sequence: input.sequence,
      input,
      stateHash: stableObjectDigestR29(state),
    });
    this.#predictions.push(prediction);
    while (this.#predictions.length > this.maxPredictionFrames) this.#predictions.shift();
    this.#lastSequence = Math.max(this.#lastSequence, input.sequence);
    return prediction;
  }

  reconcile(snapshot: R29NetworkSnapshot, localState: unknown): R29ReconciliationResult {
    this.#lastServerTick = Math.max(this.#lastServerTick, snapshot.serverTick);
    this.#acknowledgedInput = Math.max(this.#acknowledgedInput, snapshot.acknowledgedInput);
    const localDigest = stableObjectDigestR29(localState);
    const exact = localDigest === snapshot.digest;
    this.#predictions = this.#predictions.filter((frame) => frame.sequence > snapshot.acknowledgedInput);
    if (exact) {
      return Object.freeze({
        accepted: true,
        acknowledgedInput: snapshot.acknowledgedInput,
        replayed: this.#predictions.length,
        correctedEntities: 0,
        reason: 'digest-match',
      });
    }
    return Object.freeze({
      accepted: true,
      acknowledgedInput: snapshot.acknowledgedInput,
      replayed: this.#predictions.length,
      correctedEntities: snapshot.entities.length,
      reason: 'digest-correction',
    });
  }

  report(): R29NetworkReport {
    if (this.#samples.length === 0) {
      return Object.freeze({
        health: 'offline',
        score: 0,
        averageRttMs: 0,
        jitterMs: 0,
        lossRatio: 1,
        inboundBytesPerSecond: 0,
        outboundBytesPerSecond: 0,
        interpolationTicks: this.baseInterpolationTicks + 2,
        inputRedundancy: 3,
      });
    }
    const count = this.#samples.length;
    const averageRttMs = this.#samples.reduce((sum, item) => sum + item.rttMs, 0) / count;
    const jitterMs = this.#samples.reduce((sum, item) => sum + item.jitterMs, 0) / count;
    const lossRatio = this.#samples.reduce((sum, item) => sum + item.lossRatio, 0) / count;
    const inboundBytesPerSecond = this.#samples.reduce((sum, item) => sum + item.inboundBytes, 0) * 60 / count;
    const outboundBytesPerSecond = this.#samples.reduce((sum, item) => sum + item.outboundBytes, 0) * 60 / count;
    const rttPenalty = Math.min(55, averageRttMs / 2);
    const jitterPenalty = Math.min(20, jitterMs / 2);
    const lossPenalty = Math.min(50, lossRatio * 100);
    const score = clampR29(100 - rttPenalty - jitterPenalty - lossPenalty, 0, 100);
    const health: R29NetworkHealth =
      score >= 88 ? 'excellent' :
      score >= 72 ? 'good' :
      score >= 50 ? 'degraded' :
      score > 0 ? 'poor' : 'offline';
    const interpolationTicks = this.baseInterpolationTicks +
      (health === 'excellent' ? 0 : health === 'good' ? 1 : health === 'degraded' ? 2 : 3);
    const inputRedundancy = health === 'excellent' || health === 'good' ? 1 : health === 'degraded' ? 2 : 3;
    return Object.freeze({
      health,
      score,
      averageRttMs,
      jitterMs,
      lossRatio,
      inboundBytesPerSecond,
      outboundBytesPerSecond,
      interpolationTicks,
      inputRedundancy,
    });
  }

  acknowledgedInput(): number {
    return this.#acknowledgedInput;
  }

  lastServerTick(): number {
    return this.#lastServerTick;
  }

  predictionCount(): number {
    return this.#predictions.length;
  }

  buildSnapshot(input: {
    readonly tick: number;
    readonly entities: readonly R29NetworkSnapshot['entities'][number][];
    readonly worldRevision: number;
  }): R29NetworkSnapshot {
    const digest = stableObjectDigestR29({
      tick: input.tick,
      entities: input.entities,
      worldRevision: input.worldRevision,
    });
    return Object.freeze({
      tick: input.tick,
      serverTick: Math.max(this.#lastServerTick, input.tick),
      sequence: this.#lastSequence,
      acknowledgedInput: this.#acknowledgedInput,
      entities: Object.freeze([...input.entities]),
      worldRevision: input.worldRevision,
      digest,
    });
  }

  reset(): void {
    this.#samples.length = 0;
    this.#predictions.length = 0;
    this.#lastServerTick = 0;
    this.#lastSequence = 0;
    this.#acknowledgedInput = 0;
  }
}

export function emptyR29Vector(): R29Vector3 {
  return { x: 0, y: 0, z: 0 };
}
