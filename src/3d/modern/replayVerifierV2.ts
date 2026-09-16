import { stableDigest } from './deterministic.ts';

export interface ReplayInput<T> {
  readonly tick: number;
  readonly input: T;
  readonly expectedDigest: string;
}

export interface ReplayStepResult {
  readonly tick: number;
  readonly expectedDigest: string;
  readonly actualDigest: string;
  readonly matched: boolean;
}

export interface ReplayVerificationResult {
  readonly valid: boolean;
  readonly completedTicks: number;
  readonly mismatches: readonly ReplayStepResult[];
  readonly finalDigest: string;
  readonly reason: string;
}

export interface ReplayRunner<TInput, TState> {
  readonly seed: () => TState;
  readonly step: (state: TState, input: TInput, tick: number) => TState;
  readonly digest: (state: TState) => string;
}

export class ReplayVerifierV2<TInput, TState> {
  readonly #maxTicks: number;
  readonly #strictTicks: boolean;

  constructor(options: { maxTicks?: number; strictTicks?: boolean } = {}) {
    this.#maxTicks = Math.max(1, Math.floor(options.maxTicks ?? 100_000));
    this.#strictTicks = options.strictTicks ?? true;
  }

  verify(inputs: readonly ReplayInput<TInput>[], runner: ReplayRunner<TInput, TState>): ReplayVerificationResult {
    if (inputs.length > this.#maxTicks) return Object.freeze({ valid: false, completedTicks: 0, mismatches: [], finalDigest: '', reason: `Replay exceeds ${this.#maxTicks} ticks.` });
    const ordered = [...inputs].sort((a, b) => a.tick - b.tick);
    let state = runner.seed();
    const mismatches: ReplayStepResult[] = [];
    let expectedTick = ordered[0]?.tick ?? 0;
    let completedTicks = 0;
    for (const entry of ordered) {
      if (this.#strictTicks && entry.tick !== expectedTick) {
        return Object.freeze({ valid: false, completedTicks, mismatches, finalDigest: runner.digest(state), reason: `Unexpected replay tick ${entry.tick}; expected ${expectedTick}.` });
      }
      state = runner.step(state, entry.input, entry.tick);
      const actualDigest = runner.digest(state);
      const matched = actualDigest === entry.expectedDigest;
      const step = Object.freeze({ tick: entry.tick, expectedDigest: entry.expectedDigest, actualDigest, matched });
      if (!matched) mismatches.push(step);
      completedTicks += 1;
      expectedTick = entry.tick + 1;
      if (mismatches.length >= 128) break;
    }
    const finalDigest = runner.digest(state);
    return Object.freeze({ valid: mismatches.length === 0, completedTicks, mismatches, finalDigest, reason: mismatches.length ? 'Replay digest mismatch.' : 'Replay verified.' });
  }

  static fingerprint<T>(value: T): string { return stableDigest(value); }
}

export interface SnapshotCheckpoint<T> {
  readonly tick: number;
  readonly digest: string;
  readonly state: T;
}

export class ReplayCheckpointBuffer<T> {
  readonly #capacity: number;
  readonly #values: SnapshotCheckpoint<T>[] = [];
  constructor(capacity = 256) { this.#capacity = Math.max(2, Math.floor(capacity)); }
  push(checkpoint: SnapshotCheckpoint<T>): void {
    const next = Object.freeze({ tick: Math.max(0, Math.floor(checkpoint.tick)), digest: String(checkpoint.digest), state: checkpoint.state });
    this.#values.push(next);
    while (this.#values.length > this.#capacity) this.#values.shift();
  }
  nearest(tick: number): SnapshotCheckpoint<T> | undefined {
    let candidate: SnapshotCheckpoint<T> | undefined;
    for (const value of this.#values) {
      if (value.tick > tick) break;
      candidate = value;
    }
    return candidate;
  }
  latest(): SnapshotCheckpoint<T> | undefined { return this.#values.at(-1); }
  values(): readonly SnapshotCheckpoint<T>[] { return [...this.#values]; }
  clear(): void { this.#values.length = 0; }
}
