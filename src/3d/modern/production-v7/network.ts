import { ContentHashV7, EntityDeltaV7, InputCommandV7, NetworkBudgetV7, NetworkConnectionV7, NetworkStatsV7, PacketV7, PredictionStateV7, SequenceV7, TickV7, WorldSnapshotV7, hashV7, sequenceV7, tickV7 } from './types.ts';
import { SequenceWindowV7, checksumV7, hashNumbersV7 } from './deterministic.ts';

export interface OutboundMessageV7<T> {
  readonly packet: PacketV7<T>;
  readonly reliable: boolean;
  readonly expiresAtTick: TickV7;
  retransmits: number;
}

export interface NetworkConfigV7 extends NetworkBudgetV7 {
  readonly inputBufferTicks: number;
  readonly predictionBufferSize: number;
  readonly maxReorderDistance: number;
  readonly snapshotHistory: number;
}

export const DEFAULT_NETWORK_CONFIG_V7: NetworkConfigV7 = Object.freeze({
  maxBytesPerSecond: 64 * 1024,
  maxPacketBytes: 1200,
  maxSnapshotsPerSecond: 30,
  maxCommandsPerSecond: 120,
  inputBufferTicks: 120,
  predictionBufferSize: 256,
  maxReorderDistance: 128,
  snapshotHistory: 64,
});

const byteEstimate = (value: unknown): number => {
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
  catch { return Number.POSITIVE_INFINITY; }
};
const clampCounter = (value: number): number => Math.max(0, Math.trunc(value));

export class NetworkRuntimeV7<TWorld> {
  readonly #config: NetworkConfigV7;
  readonly #receiveWindow: SequenceWindowV7;
  readonly #sent = new Map<number, OutboundMessageV7<unknown>>();
  readonly #snapshotHistory: WorldSnapshotV7[] = [];
  readonly #inputs: InputCommandV7[] = [];
  readonly #predictions: PredictionStateV7[] = [];
  #state: NetworkConnectionV7 = 'offline';
  #sequence = 0;
  #lastAck = 0;
  #lastSecondTick = 0;
  #sentThisWindow = 0;
  #commandsThisWindow = 0;
  #snapshotsThisWindow = 0;
  #sentPackets = 0;
  #receivedPackets = 0;
  #droppedPackets = 0;
  #retransmits = 0;
  #sentBytes = 0;
  #receivedBytes = 0;
  #rtt = 80;
  #jitter = 0;
  #lastRtt = 80;

  constructor(config: Partial<NetworkConfigV7> = {}) {
    this.#config = Object.freeze({ ...DEFAULT_NETWORK_CONFIG_V7, ...config });
    this.#receiveWindow = new SequenceWindowV7(this.#config.maxReorderDistance * 2);
  }

  get state(): NetworkConnectionV7 { return this.#state; }

  connect(): void { if (this.#state === 'offline') this.#state = 'connecting'; }
  markConnected(): void { this.#state = 'connected'; }
  disconnect(): void { this.#state = 'draining'; }
  markOffline(): void { this.#state = 'offline'; }

  pushInput(input: InputCommandV7): boolean {
    if (this.#inputs.length >= this.#config.inputBufferTicks) this.#inputs.shift();
    if (this.#inputs.some((candidate) => Number(candidate.sequence) === Number(input.sequence))) return false;
    this.#inputs.push(Object.freeze({ ...input, actions: Object.freeze([...input.actions]) }));
    this.#inputs.sort((a, b) => Number(a.sequence) - Number(b.sequence));
    return true;
  }

  consumeInputs(untilTick: TickV7): readonly InputCommandV7[] {
    const consumed = this.#inputs.filter((input) => Number(input.tick) <= Number(untilTick));
    if (consumed.length) {
      const keepFrom = Number(consumed.at(-1)!.sequence);
      while (this.#inputs.length && Number(this.#inputs[0]!.sequence) <= keepFrom) this.#inputs.shift();
    }
    return Object.freeze(consumed);
  }

  recordPrediction(state: PredictionStateV7): void {
    this.#predictions.push(state);
    while (this.#predictions.length > this.#config.predictionBufferSize) this.#predictions.shift();
  }

  reconcile(server: PredictionStateV7, positionTolerance = 0.15): { readonly corrected: boolean; readonly rollbackFrom: TickV7 | null } {
    const local = [...this.#predictions].reverse().find((item) => Number(item.tick) === Number(server.tick));
    if (!local) return Object.freeze({ corrected: false, rollbackFrom: null });
    const error = Math.hypot(local.position.x - server.position.x, local.position.y - server.position.y, local.position.z - server.position.z);
    const corrected = error > Math.max(0, positionTolerance);
    if (corrected) {
      while (this.#predictions.length && Number(this.#predictions[0]!.tick) <= Number(server.tick)) this.#predictions.shift();
    }
    return Object.freeze({ corrected, rollbackFrom: corrected ? server.tick : null });
  }

  canSendCommand(tick: TickV7): boolean {
    this.#rollWindow(tick);
    return this.#commandsThisWindow < this.#config.maxCommandsPerSecond && this.#sentThisWindow < this.#config.maxBytesPerSecond;
  }

  buildCommandPacket(payload: TWorld, tick: TickV7, reliable = false): PacketV7<TWorld> | null {
    if (!this.canSendCommand(tick)) { this.#droppedPackets += 1; return null; }
    const bytes = byteEstimate(payload);
    if (!Number.isFinite(bytes) || bytes > this.#config.maxPacketBytes) { this.#droppedPackets += 1; return null; }
    const packet: PacketV7<TWorld> = Object.freeze({
      protocol: 7, sequence: sequenceV7(++this.#sequence), ack: sequenceV7(this.#lastAck),
      sentTick: tick, baseline: null, payload, bytes, reliable,
    });
    this.#trackOutbound(packet, tick);
    this.#commandsThisWindow += 1;
    return packet;
  }

  buildSnapshotPacket(snapshot: WorldSnapshotV7, tick: TickV7, reliable = true): PacketV7<WorldSnapshotV7> | null {
    this.#rollWindow(tick);
    if (this.#snapshotsThisWindow >= this.#config.maxSnapshotsPerSecond) { this.#droppedPackets += 1; return null; }
    const bytes = byteEstimate(snapshot);
    if (!Number.isFinite(bytes) || bytes > this.#config.maxPacketBytes) { this.#droppedPackets += 1; return null; }
    const baseline = this.#snapshotHistory.at(-1)?.checksum ?? null;
    const effective = Object.freeze({ ...snapshot, baseline });
    const packet: PacketV7<WorldSnapshotV7> = Object.freeze({
      protocol: 7, sequence: sequenceV7(++this.#sequence), ack: sequenceV7(this.#lastAck),
      sentTick: tick, baseline, payload: effective, bytes, reliable,
    });
    this.#snapshotHistory.push(effective);
    while (this.#snapshotHistory.length > this.#config.snapshotHistory) this.#snapshotHistory.shift();
    this.#trackOutbound(packet, tick);
    this.#snapshotsThisWindow += 1;
    return packet;
  }

  receive(packet: PacketV7<unknown>, currentTick: TickV7): boolean {
    if (packet.protocol !== 7 || packet.bytes > this.#config.maxPacketBytes) { this.#droppedPackets += 1; return false; }
    if (Number(packet.sentTick) > Number(currentTick) + this.#config.maxReorderDistance) { this.#droppedPackets += 1; return false; }
    if (!this.#receiveWindow.accept(Number(packet.sequence))) { this.#droppedPackets += 1; return false; }
    this.#lastAck = Math.max(this.#lastAck, Number(packet.sequence));
    this.#receivedPackets += 1;
    this.#receivedBytes += packet.bytes;
    if (this.#state === 'connecting') this.#state = 'connected';
    return true;
  }

  acknowledge(sequence: SequenceV7, rttMs?: number): void {
    this.#lastAck = Math.max(this.#lastAck, Number(sequence));
    this.#sent.delete(Number(sequence));
    if (rttMs !== undefined && Number.isFinite(rttMs)) {
      const next = Math.max(0, rttMs);
      this.#jitter = this.#jitter * 0.75 + Math.abs(next - this.#lastRtt) * 0.25;
      this.#rtt = this.#rtt * 0.8 + next * 0.2;
      this.#lastRtt = next;
    }
  }

  tick(currentTick: TickV7): void {
    this.#rollWindow(currentTick);
    for (const [sequence, message] of this.#sent) {
      if (Number(currentTick) >= Number(message.expiresAtTick)) {
        if (!message.reliable || message.retransmits >= 3) { this.#sent.delete(sequence); continue; }
        message.retransmits += 1;
        this.#retransmits += 1;
        message.retransmits += 0;
      }
    }
    if (this.#state === 'draining' && this.#sent.size === 0) this.#state = 'offline';
  }

  stats(): NetworkStatsV7 {
    const sentBytes = clampCounter(this.#sentBytes);
    const receivedBytes = clampCounter(this.#receivedBytes);
    const total = this.#receivedPackets + this.#droppedPackets;
    return Object.freeze({
      state: this.#state,
      sentPackets: this.#sentPackets,
      receivedPackets: this.#receivedPackets,
      droppedPackets: this.#droppedPackets,
      retransmits: this.#retransmits,
      sentBytes,
      receivedBytes,
      estimatedRttMs: Number(this.#rtt.toFixed(2)),
      jitterMs: Number(this.#jitter.toFixed(2)),
      lossRatio: total > 0 ? Number((this.#droppedPackets / total).toFixed(4)) : 0,
    });
  }

  digest(): number {
    return hashNumbersV7(
      this.#sequence, this.#lastAck, this.#sentPackets, this.#receivedPackets,
      this.#droppedPackets, this.#retransmits, this.#sentBytes, this.#receivedBytes,
    ) ^ checksumV7([...this.#snapshotHistory, ...this.#predictions]).toString().split('').reduce((a, ch) => a ^ ch.charCodeAt(0), 0);
  }

  #trackOutbound(packet: PacketV7<unknown>, tick: TickV7): void {
    this.#sentPackets += 1;
    this.#sentBytes += packet.bytes;
    this.#sentThisWindow += packet.bytes;
    if (packet.reliable) this.#sent.set(Number(packet.sequence), { packet, reliable: true, expiresAtTick: tickV7(Number(tick) + 30), retransmits: 0 });
  }

  #rollWindow(tick: TickV7): void {
    if (Number(tick) - this.#lastSecondTick >= 60) {
      this.#lastSecondTick = Number(tick);
      this.#sentThisWindow = 0;
      this.#commandsThisWindow = 0;
      this.#snapshotsThisWindow = 0;
    }
  }
}
