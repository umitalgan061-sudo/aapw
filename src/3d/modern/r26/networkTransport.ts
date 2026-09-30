import { stableDigest } from '../deterministic.ts';

export interface NetworkInputR26 {
  readonly tick: number;
  readonly sequence: number;
  readonly payload: unknown;
  readonly clientTimeMs: number;
}

export interface NetworkSnapshotR26<T> {
  readonly tick: number;
  readonly sequence: number;
  readonly serverTimeMs: number;
  readonly state: T;
  readonly digest: string;
}

export interface NetworkAckR26 {
  readonly inputSequence: number;
  readonly snapshotSequence: number;
  readonly serverTick: number;
  readonly serverTimeMs: number;
}

export interface NetworkPacketR26 {
  readonly kind: 'input' | 'snapshot' | 'ack' | 'reliable' | 'heartbeat';
  readonly sequence: number;
  readonly sentAtMs: number;
  readonly bytes: number;
  readonly payload: unknown;
}

export interface NetworkSessionBudgetR26 {
  readonly maxInputHistory: number;
  readonly maxSnapshotHistory: number;
  readonly maxPacketBytes: number;
  readonly maxBytesPerSecond: number;
  readonly interpolationDelayMs: number;
  readonly predictionWindowTicks: number;
}

export interface ReconcileResultR26<T> {
  readonly corrected: boolean;
  readonly baseTick: number;
  readonly state: T;
  readonly correctionMagnitude: number;
  readonly replayed: readonly NetworkInputR26[];
  readonly reason: 'none' | 'history-underflow' | 'correction' | 'prediction-window';
}

const finite = (value: number, fallback = 0): number =>
  Number.isFinite(value) ? value : fallback;

const clone = <T>(value: T): T => {
  if (value === null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
};

export class NetworkSessionR26<T> {
  readonly #budget: NetworkSessionBudgetR26;
  readonly #inputs: NetworkInputR26[] = [];
  readonly #snapshots: NetworkSnapshotR26<T>[] = [];
  readonly #packets: NetworkPacketR26[] = [];
  #inputSequence = 1;
  #packetSequence = 1;
  #ack: NetworkAckR26 = Object.freeze({
    inputSequence: 0,
    snapshotSequence: 0,
    serverTick: 0,
    serverTimeMs: 0,
  });
  #predicted: T | null = null;
  #predictedTick = 0;
  #bandwidthWindowStart = 0;
  #bandwidthWindowBytes = 0;
  #corrections = 0;

  constructor(budget: Partial<NetworkSessionBudgetR26> = {}) {
    this.#budget = Object.freeze({
      maxInputHistory: Math.max(16, Math.floor(budget.maxInputHistory ?? 512)),
      maxSnapshotHistory: Math.max(4, Math.floor(budget.maxSnapshotHistory ?? 64)),
      maxPacketBytes: Math.max(256, Math.floor(budget.maxPacketBytes ?? 256 * 1024)),
      maxBytesPerSecond: Math.max(1024, Math.floor(budget.maxBytesPerSecond ?? 512 * 1024)),
      interpolationDelayMs: Math.max(0, finite(budget.interpolationDelayMs, 100)),
      predictionWindowTicks: Math.max(1, Math.floor(budget.predictionWindowTicks ?? 12)),
    });
  }

  submitInput(tick: number, payload: unknown, clientTimeMs: number): NetworkInputR26 {
    const frame = Object.freeze({
      tick: Math.max(0, Math.floor(tick)),
      sequence: this.#inputSequence++,
      payload: clone(payload),
      clientTimeMs: Math.max(0, finite(clientTimeMs)),
    });
    this.#inputs.push(frame);
    while (this.#inputs.length > this.#budget.maxInputHistory) this.#inputs.shift();
    return frame;
  }

  receiveSnapshot(snapshot: NetworkSnapshotR26<T>, receivedAtMs: number, packetBytes: number): void {
    if (packetBytes > this.#budget.maxPacketBytes) {
      throw new Error('R26_PACKET_TOO_LARGE');
    }

    const item = Object.freeze({
      ...snapshot,
      tick: Math.max(0, Math.floor(snapshot.tick)),
      sequence: Math.max(0, Math.floor(snapshot.sequence)),
      serverTimeMs: Math.max(0, finite(snapshot.serverTimeMs)),
      state: clone(snapshot.state),
    });
    this.#snapshots.push(item);
    this.#snapshots.sort((a, b) =>
      a.serverTimeMs - b.serverTimeMs || a.tick - b.tick || a.sequence - b.sequence,
    );

    const dedupe = new Map<number, NetworkSnapshotR26<T>>();
    for (const entry of this.#snapshots) dedupe.set(entry.sequence, entry);
    this.#snapshots.length = 0;
    this.#snapshots.push(...[...dedupe.values()].slice(-this.#budget.maxSnapshotHistory));

    this.#recordPacket('snapshot', packetBytes, receivedAtMs);
    this.#ack = Object.freeze({
      ...this.#ack,
      snapshotSequence: Math.max(this.#ack.snapshotSequence, item.sequence),
      serverTick: Math.max(this.#ack.serverTick, item.tick),
      serverTimeMs: Math.max(this.#ack.serverTimeMs, item.serverTimeMs),
    });
  }

  acknowledge(ack: NetworkAckR26): void {
    this.#ack = Object.freeze({
      inputSequence: Math.max(this.#ack.inputSequence, Math.floor(ack.inputSequence)),
      snapshotSequence: Math.max(this.#ack.snapshotSequence, Math.floor(ack.snapshotSequence)),
      serverTick: Math.max(this.#ack.serverTick, Math.floor(ack.serverTick)),
      serverTimeMs: Math.max(this.#ack.serverTimeMs, finite(ack.serverTimeMs)),
    });
    while (this.#inputs[0] && this.#inputs[0].sequence <= this.#ack.inputSequence) this.#inputs.shift();
  }

  setPredictedState(state: T, tick: number): void {
    this.#predicted = clone(state);
    this.#predictedTick = Math.max(0, Math.floor(tick));
  }

  predictedState(): T | null {
    return this.#predicted === null ? null : clone(this.#predicted);
  }

  reconcile(
    authoritative: T,
    authoritativeTick: number,
    applyInput: (state: T, input: NetworkInputR26) => T,
    distance: (a: T, b: T) => number,
  ): ReconcileResultR26<T> {
    const baseTick = Math.max(0, Math.floor(authoritativeTick));
    if (this.#predicted === null) {
      this.setPredictedState(authoritative, baseTick);
      return Object.freeze({
        corrected: true,
        baseTick,
        state: clone(authoritative),
        correctionMagnitude: 0,
        replayed: Object.freeze([]),
        reason: 'history-underflow',
      });
    }

    const correctionMagnitude = Math.max(0, finite(distance(this.#predicted, authoritative)));
    const replayed = this.#inputs.filter((input) => input.tick > baseTick);
    const predictionTooFarAhead = this.#predictedTick - baseTick > this.#budget.predictionWindowTicks;

    if (correctionMagnitude <= 0.001 && !predictionTooFarAhead) {
      return Object.freeze({
        corrected: false,
        baseTick,
        state: clone(this.#predicted),
        correctionMagnitude,
        replayed: Object.freeze(replayed.map(clone)),
        reason: 'none',
      });
    }

    let state = clone(authoritative);
    for (const input of replayed) state = applyInput(state, input);
    this.#predicted = clone(state);
    this.#predictedTick = replayed.at(-1)?.tick ?? baseTick;
    this.#corrections += 1;

    return Object.freeze({
      corrected: true,
      baseTick,
      state: clone(state),
      correctionMagnitude,
      replayed: Object.freeze(replayed.map(clone)),
      reason: predictionTooFarAhead ? 'prediction-window' : 'correction',
    });
  }

  interpolate(
    clientNowMs: number,
    interpolate: (a: T, b: T, alpha: number) => T,
  ): NetworkSnapshotR26<T> | null {
    const target = Math.max(0, finite(clientNowMs)) - this.#budget.interpolationDelayMs;
    let before: NetworkSnapshotR26<T> | undefined;
    let after: NetworkSnapshotR26<T> | undefined;

    for (const snapshot of this.#snapshots) {
      if (snapshot.serverTimeMs <= target) before = snapshot;
      if (snapshot.serverTimeMs >= target) {
        after = snapshot;
        break;
      }
    }

    if (!before && !after) return null;
    if (!before) return clone(after!);
    if (!after || before.sequence === after.sequence) return clone(before);

    const alpha = Math.min(
      1,
      Math.max(0, (target - before.serverTimeMs) / Math.max(1, after.serverTimeMs - before.serverTimeMs)),
    );
    const state = interpolate(before.state, after.state, alpha);
    return Object.freeze({
      tick: before.tick,
      sequence: before.sequence,
      serverTimeMs: target,
      state: clone(state),
      digest: stableDigest(state),
    });
  }

  packet(kind: NetworkPacketR26['kind'], payload: unknown, nowMs: number, bytes: number): NetworkPacketR26 | null {
    const packetBytes = Math.max(0, Math.floor(bytes));
    if (packetBytes > this.#budget.maxPacketBytes) return null;
    if (!this.#withinBandwidthBudget(nowMs, packetBytes)) return null;
    const packet = Object.freeze({
      kind,
      sequence: this.#packetSequence++,
      sentAtMs: Math.max(0, finite(nowMs)),
      bytes: packetBytes,
      payload: clone(payload),
    });
    this.#packets.push(packet);
    if (this.#packets.length > 1024) this.#packets.splice(0, this.#packets.length - 1024);
    return packet;
  }

  latestSnapshot(): NetworkSnapshotR26<T> | undefined {
    const latest = this.#snapshots.at(-1);
    return latest ? clone(latest) : undefined;
  }

  inputsAfterTick(tick: number): readonly NetworkInputR26[] {
    return Object.freeze(this.#inputs.filter((input) => input.tick > tick).map(clone));
  }

  stats(nowMs: number): Readonly<{
    inputHistory: number;
    snapshots: number;
    packets: number;
    predictedTick: number;
    serverTick: number;
    corrections: number;
    bytesPerSecond: number;
    digest: string;
  }> {
    const bytesPerSecond = this.#bytesPerSecond(nowMs);
    const digest = stableDigest({
      inputHistory: this.#inputs.length,
      snapshots: this.#snapshots.length,
      packets: this.#packets.length,
      predictedTick: this.#predictedTick,
      serverTick: this.#ack.serverTick,
      corrections: this.#corrections,
    });
    return Object.freeze({
      inputHistory: this.#inputs.length,
      snapshots: this.#snapshots.length,
      packets: this.#packets.length,
      predictedTick: this.#predictedTick,
      serverTick: this.#ack.serverTick,
      corrections: this.#corrections,
      bytesPerSecond,
      digest,
    });
  }

  clear(): void {
    this.#inputs.length = 0;
    this.#snapshots.length = 0;
    this.#packets.length = 0;
    this.#predicted = null;
    this.#predictedTick = 0;
    this.#ack = Object.freeze({
      inputSequence: 0,
      snapshotSequence: 0,
      serverTick: 0,
      serverTimeMs: 0,
    });
    this.#packetSequence = 1;
    this.#inputSequence = 1;
    this.#bandwidthWindowStart = 0;
    this.#bandwidthWindowBytes = 0;
    this.#corrections = 0;
  }

  #recordPacket(kind: NetworkPacketR26['kind'], packetBytes: number, nowMs: number): void {
    this.packet(kind, null, nowMs, packetBytes);
  }

  #withinBandwidthBudget(nowMs: number, packetBytes: number): boolean {
    const time = Math.max(0, finite(nowMs));
    if (this.#bandwidthWindowStart === 0 || time - this.#bandwidthWindowStart >= 1000) {
      this.#bandwidthWindowStart = time;
      this.#bandwidthWindowBytes = 0;
    }
    if (this.#bandwidthWindowBytes + packetBytes > this.#budget.maxBytesPerSecond) return false;
    this.#bandwidthWindowBytes += packetBytes;
    return true;
  }

  #bytesPerSecond(nowMs: number): number {
    const time = Math.max(0, finite(nowMs));
    const elapsed = Math.max(1, time - this.#bandwidthWindowStart);
    return this.#bandwidthWindowBytes * 1000 / elapsed;
  }
}
