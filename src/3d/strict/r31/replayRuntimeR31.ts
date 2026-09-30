import type { RuntimeCommandR31, RuntimeSnapshotEnvelopeR31 } from './applicationTypesR31.ts';
import { canonicalDigestR31 } from './snapshotR31.ts';

export interface ReplayCommandR31 {
  readonly tick: number;
  readonly command: RuntimeCommandR31;
}

export interface ReplayCheckpointR31<T> {
  readonly tick: number;
  readonly snapshot: RuntimeSnapshotEnvelopeR31<T>;
}

export interface ReplayReportR31 {
  readonly ok: boolean;
  readonly commands: number;
  readonly checkpoints: number;
  readonly mismatches: readonly number[];
  readonly digest: string;
}

export class ReplayRuntimeR31<T> {
  readonly #commands: ReplayCommandR31[] = [];
  readonly #checkpoints: ReplayCheckpointR31<T>[] = [];
  #maxEntries: number;

  constructor(maxEntries = 2048) {
    if (!Number.isInteger(maxEntries) || maxEntries < 32) throw new Error('Replay capacity must be >= 32');
    this.#maxEntries = maxEntries;
  }

  recordCommand(tick: number, command: RuntimeCommandR31): void {
    this.#commands.push(Object.freeze({ tick: Math.max(0, Math.floor(tick)), command }));
    if (this.#commands.length > this.#maxEntries) this.#commands.shift();
  }

  recordCheckpoint(snapshot: RuntimeSnapshotEnvelopeR31<T>): void {
    this.#checkpoints.push(Object.freeze({ tick: snapshot.tick, snapshot }));
    if (this.#checkpoints.length > this.#maxEntries) this.#checkpoints.shift();
  }

  commands(fromTick = 0, toTick = Infinity): readonly ReplayCommandR31[] {
    return Object.freeze(this.#commands.filter((item) => item.tick >= fromTick && item.tick <= toTick));
  }

  checkpoints(fromTick = 0, toTick = Infinity): readonly ReplayCheckpointR31<T>[] {
    return Object.freeze(this.#checkpoints.filter((item) => item.tick >= fromTick && item.tick <= toTick));
  }

  verify(compare: (tick: number, expected: T) => T, fromTick = 0, toTick = Infinity): ReplayReportR31 {
    const mismatches: number[] = [];
    const checkpoints = this.checkpoints(fromTick, toTick);
    for (const checkpoint of checkpoints) {
      const actual = compare(checkpoint.tick, checkpoint.snapshot.state);
      if (canonicalDigestR31(actual) !== checkpoint.snapshot.digest) mismatches.push(checkpoint.tick);
    }
    return Object.freeze({
      ok: mismatches.length === 0,
      commands: this.commands(fromTick, toTick).length,
      checkpoints: checkpoints.length,
      mismatches: Object.freeze(mismatches),
      digest: canonicalDigestR31({
        commands: this.commands(fromTick, toTick).map((item) => item.command.id),
        mismatches,
      }),
    });
  }

  clear(): void {
    this.#commands.length = 0;
    this.#checkpoints.length = 0;
  }
}
