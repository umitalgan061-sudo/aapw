/**
 * Deterministic input replay and rollback checkpoints for R42.
 * Production TypeScript owner.
 */
import type { InputFrame, WorldEntity } from './types.ts';
import { cloneEntity, deepFreeze, hashValue, safeInteger } from './types.ts';

export interface ReplayCheckpoint {
  readonly tick: number;
  readonly revision: number;
  readonly entities: readonly WorldEntity[];
  readonly inputSequence: number;
  readonly checksum: number;
}

export interface ReplayRecord {
  readonly tick: number;
  readonly input: InputFrame;
}

export interface ReplayVerification {
  readonly ok: boolean;
  readonly ticksChecked: number;
  readonly divergenceTick: number | null;
  readonly expectedChecksum: number;
  readonly actualChecksum: number;
  readonly reason: string | null;
}

export class ReplayJournalR42 {
  readonly maxCheckpoints: number;
  readonly maxInputs: number;
  #checkpoints: ReplayCheckpoint[] = [];
  #inputs: ReplayRecord[] = [];

  constructor(maxCheckpoints = 64, maxInputs = 1024) {
    this.maxCheckpoints = Math.max(4, Math.trunc(maxCheckpoints));
    this.maxInputs = Math.max(32, Math.trunc(maxInputs));
  }

  recordInput(tick: number, input: InputFrame): void {
    this.#inputs.push(Object.freeze({
      tick: Math.max(0, safeInteger(tick)),
      input: Object.freeze({ ...input }),
    }));
    if (this.#inputs.length > this.maxInputs) this.#inputs.shift();
  }

  checkpoint(tick: number, revision: number, entities: readonly WorldEntity[], inputSequence: number): ReplayCheckpoint {
    const snapshot = entities.map(cloneEntity);
    const checkpoint = deepFreeze({
      tick: Math.max(0, safeInteger(tick)),
      revision: Math.max(0, safeInteger(revision)),
      entities: snapshot,
      inputSequence: Math.max(-1, safeInteger(inputSequence, -1)),
      checksum: hashValue({
        tick,
        revision,
        entities: snapshot,
        inputSequence,
      }),
    });
    this.#checkpoints.push(checkpoint);
    if (this.#checkpoints.length > this.maxCheckpoints) this.#checkpoints.shift();
    return checkpoint;
  }

  nearestCheckpoint(tick: number): ReplayCheckpoint | null {
    const target = Math.max(0, safeInteger(tick));
    let result: ReplayCheckpoint | null = null;
    for (const checkpoint of this.#checkpoints) {
      if (checkpoint.tick <= target && (!result || checkpoint.tick > result.tick)) result = checkpoint;
    }
    return result;
  }

  inputsAfter(tick: number): readonly ReplayRecord[] {
    const target = Math.max(0, safeInteger(tick));
    return Object.freeze(this.#inputs.filter(record => record.tick > target).sort(
      (a, b) => a.tick - b.tick || a.input.sequence - b.input.sequence,
    ));
  }

  verify(
    startTick: number,
    endTick: number,
    replay: (checkpoint: ReplayCheckpoint, records: readonly ReplayRecord[]) => number,
  ): ReplayVerification {
    const start = Math.max(0, safeInteger(startTick));
    const end = Math.max(start, safeInteger(endTick));
    const checkpoint = this.nearestCheckpoint(start);
    if (!checkpoint) {
      return Object.freeze({
        ok: false,
        ticksChecked: 0,
        divergenceTick: start,
        expectedChecksum: 0,
        actualChecksum: 0,
        reason: 'checkpoint-not-found',
      });
    }

    const records = this.#inputs.filter(record => record.tick > checkpoint.tick && record.tick <= end);
    const expected = hashValue({
      tick: end,
      revision: checkpoint.revision,
      entities: checkpoint.entities,
      records,
    });
    const actual = replay(checkpoint, records);
    return Object.freeze({
      ok: expected === actual,
      ticksChecked: end - start + 1,
      divergenceTick: expected === actual ? null : end,
      expectedChecksum: expected,
      actualChecksum: actual,
      reason: expected === actual ? null : 'checksum-divergence',
    });
  }

  checkpoints(): readonly ReplayCheckpoint[] {
    return Object.freeze([...this.#checkpoints]);
  }

  records(): readonly ReplayRecord[] {
    return Object.freeze([...this.#inputs]);
  }

  clear(): void {
    this.#checkpoints = [];
    this.#inputs = [];
  }
}

export interface RollbackPlanR42 {
  readonly fromTick: number;
  readonly toTick: number;
  readonly replayTicks: readonly number[];
  readonly checkpoint: ReplayCheckpoint;
}

export function planRollbackR42(
  journal: ReplayJournalR42,
  fromTick: number,
  toTick: number,
): RollbackPlanR42 | null {
  const from = Math.max(0, safeInteger(fromTick));
  const to = Math.max(0, safeInteger(toTick));
  if (to >= from) return null;
  const checkpoint = journal.nearestCheckpoint(to);
  if (!checkpoint) return null;
  const replayTicks: number[] = [];
  for (let tick = checkpoint.tick + 1; tick <= from; tick += 1) replayTicks.push(tick);
  return deepFreeze({
    fromTick: from,
    toTick: to,
    replayTicks: Object.freeze(replayTicks),
    checkpoint,
  });
}
