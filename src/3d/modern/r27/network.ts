import type {
  InputFrame,
  NetworkSequence,
  RuntimeSnapshot,
  SnapshotEnvelope,
} from './contracts.ts';

export interface ClientInputCommand {
  readonly sequence: NetworkSequence;
  readonly tick: number;
  readonly input: InputFrame;
  readonly predicted: boolean;
}

export interface BandwidthBudget {
  readonly bytesPerSecond: number;
  readonly burstBytes: number;
}

export interface NetworkSample {
  readonly tick: number;
  readonly bytes: number;
  readonly rttMs: number;
  readonly loss: number;
}

export interface ReconciliationResult {
  readonly accepted: boolean;
  readonly replayFromTick: number | null;
  readonly corrected: boolean;
  readonly errorDistance: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function seqValue(value: NetworkSequence): number {
  return value.value >>> 0;
}

export function nextSequence(current: NetworkSequence): NetworkSequence {
  return { value: (seqValue(current) + 1) >>> 0 };
}

export function isSequenceNewer(a: NetworkSequence, b: NetworkSequence): boolean {
  const delta = (seqValue(a) - seqValue(b)) >>> 0;
  return delta !== 0 && delta < 0x8000_0000;
}

export class InputCommandBuffer {
  readonly maxCommands: number;
  #commands = new Map<number, ClientInputCommand>();

  constructor(maxCommands = 256) {
    this.maxCommands = Math.max(1, Math.floor(maxCommands));
  }

  push(command: ClientInputCommand): void {
    this.#commands.set(seqValue(command.sequence), command);
    while (this.#commands.size > this.maxCommands) {
      const oldest = [...this.#commands.keys()].sort((a, b) => a - b)[0];
      if (oldest === undefined) break;
      this.#commands.delete(oldest);
    }
  }

  acknowledge(sequence: NetworkSequence): readonly ClientInputCommand[] {
    const acknowledged: ClientInputCommand[] = [];
    for (const [key, command] of [...this.#commands.entries()].sort(([a], [b]) => a - b)) {
      if (isSequenceNewer(sequence, command.sequence) || key === seqValue(sequence)) {
        acknowledged.push(command);
        this.#commands.delete(key);
      }
    }
    return acknowledged;
  }

  since(tick: number): readonly ClientInputCommand[] {
    return [...this.#commands.values()]
      .filter((command) => command.tick >= tick)
      .sort((a, b) => a.tick - b.tick || seqValue(a.sequence) - seqValue(b.sequence));
  }

  size(): number {
    return this.#commands.size;
  }
}

export class SnapshotBuffer {
  readonly maxSnapshots: number;
  #snapshots: SnapshotEnvelope[] = [];

  constructor(maxSnapshots = 32) {
    this.maxSnapshots = Math.max(2, Math.floor(maxSnapshots));
  }

  push(snapshot: SnapshotEnvelope): void {
    const existing = this.#snapshots.findIndex((value) => seqValue(value.sequence) === seqValue(snapshot.sequence));
    if (existing >= 0) this.#snapshots.splice(existing, 1);
    this.#snapshots.push(snapshot);
    this.#snapshots.sort((a, b) => a.serverTick - b.serverTick || seqValue(a.sequence) - seqValue(b.sequence));
    while (this.#snapshots.length > this.maxSnapshots) this.#snapshots.shift();
  }

  latest(): SnapshotEnvelope | undefined {
    return this.#snapshots.at(-1);
  }

  sample(renderTick: number): RuntimeSnapshot | undefined {
    if (this.#snapshots.length === 0) return undefined;
    if (this.#snapshots.length === 1) return this.#snapshots[0]?.state;

    let older = this.#snapshots[0];
    let newer = this.#snapshots[1];
    for (let index = 1; index < this.#snapshots.length; index++) {
      const candidate = this.#snapshots[index];
      if (!candidate) continue;
      if (candidate.serverTick <= renderTick) older = candidate;
      if (candidate.serverTick >= renderTick) {
        newer = candidate;
        break;
      }
      older = candidate;
      newer = candidate;
    }

    if (older.serverTick === newer.serverTick) return older.state;
    const alpha = clamp((renderTick - older.serverTick) / (newer.serverTick - older.serverTick), 0, 1);
    return interpolateSnapshots(older.state, newer.state, alpha);
  }

  clear(): void {
    this.#snapshots = [];
  }
}

function interpolateSnapshots(a: RuntimeSnapshot, b: RuntimeSnapshot, alpha: number): RuntimeSnapshot {
  const byIdB = new Map(b.entities.map((entity) => [Number(entity.id), entity]));
  const entities = a.entities.map((entity) => {
    const next = byIdB.get(Number(entity.id));
    if (!next || !entity.transform || !next.transform) return next ?? entity;
    const position = {
      x: entity.transform.position.x + (next.transform.position.x - entity.transform.position.x) * alpha,
      y: entity.transform.position.y + (next.transform.position.y - entity.transform.position.y) * alpha,
      z: entity.transform.position.z + (next.transform.position.z - entity.transform.position.z) * alpha,
    };
    return {
      ...next,
      transform: { ...next.transform, position },
    };
  });
  for (const entity of b.entities) {
    if (!entities.some((item) => item.id === entity.id)) entities.push(entity);
  }
  return {
    ...b,
    tick: Math.round(a.tick + (b.tick - a.tick) * alpha),
    timeSeconds: a.timeSeconds + (b.timeSeconds - a.timeSeconds) * alpha,
    entities: entities.sort((x, y) => Number(x.id) - Number(y.id)),
  };
}

export class TokenBucket {
  readonly budget: BandwidthBudget;
  #tokens: number;
  #lastTick = 0;

  constructor(budget: BandwidthBudget) {
    this.budget = {
      bytesPerSecond: Math.max(1, budget.bytesPerSecond),
      burstBytes: Math.max(budget.bytesPerSecond, budget.burstBytes),
    };
    this.#tokens = this.budget.burstBytes;
  }

  refill(currentTick: number, ticksPerSecond = 60): void {
    const deltaTicks = Math.max(0, currentTick - this.#lastTick);
    this.#lastTick = currentTick;
    this.#tokens = Math.min(
      this.budget.burstBytes,
      this.#tokens + (deltaTicks / Math.max(1, ticksPerSecond)) * this.budget.bytesPerSecond,
    );
  }

  tryConsume(bytes: number): boolean {
    const amount = Math.max(0, bytes);
    if (amount > this.#tokens) return false;
    this.#tokens -= amount;
    return true;
  }

  available(): number {
    return Math.floor(this.#tokens);
  }
}

export function reconcile(
  predicted: readonly { tick: number; x: number; y: number; z: number }[],
  authoritative: readonly { tick: number; x: number; y: number; z: number }[],
  tolerance = 0.05,
): ReconciliationResult {
  const last = authoritative.at(-1);
  if (!last) return { accepted: false, replayFromTick: null, corrected: false, errorDistance: 0 };
  const predictedState = predicted.find((sample) => sample.tick === last.tick);
  if (!predictedState) return { accepted: true, replayFromTick: last.tick, corrected: true, errorDistance: Number.POSITIVE_INFINITY };

  const errorDistance = Math.hypot(
    predictedState.x - last.x,
    predictedState.y - last.y,
    predictedState.z - last.z,
  );

  return {
    accepted: true,
    replayFromTick: errorDistance > tolerance ? last.tick : null,
    corrected: errorDistance > tolerance,
    errorDistance,
  };
}
