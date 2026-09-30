export type RollbackReason = 'desync' | 'invalid-command' | 'server-correction' | 'local-recovery' | 'manual';

export interface RollbackFrame<T> {
  readonly tick: number;
  readonly state: T;
  readonly digest: string;
}

export interface RollbackPlan {
  readonly fromTick: number;
  readonly toTick: number;
  readonly replayCount: number;
  readonly reason: RollbackReason;
}

export interface RollbackResult<T> {
  readonly ok: boolean;
  readonly state: T;
  readonly finalTick: number;
  readonly replayed: number;
  readonly reason: string;
}

export class RollbackController<TInput, TState> {
  readonly #capacity: number;
  readonly #frames: RollbackFrame<TState>[] = [];
  readonly #inputs = new Map<number, TInput>();
  #latestTick = -1;

  constructor(options: { capacity?: number } = {}) { this.#capacity = Math.max(8, Math.floor(options.capacity ?? 256)); }

  record(frame: RollbackFrame<TState>, input?: TInput): void {
    const normalized = Object.freeze({ tick: Math.max(0, Math.floor(frame.tick)), state: frame.state, digest: String(frame.digest) });
    const existing = this.#frames.findIndex((candidate) => candidate.tick === normalized.tick);
    if (existing >= 0) this.#frames[existing] = normalized;
    else this.#frames.push(normalized);
    this.#frames.sort((a, b) => a.tick - b.tick);
    if (input !== undefined) this.#inputs.set(normalized.tick, input);
    while (this.#frames.length > this.#capacity) {
      const removed = this.#frames.shift();
      if (removed) this.#inputs.delete(removed.tick);
    }
    this.#latestTick = Math.max(this.#latestTick, normalized.tick);
  }

  plan(targetTick: number, reason: RollbackReason): RollbackPlan | null {
    const tick = Math.max(0, Math.floor(targetTick));
    const frame = this.#frames.find((candidate) => candidate.tick <= tick);
    if (!frame || tick > this.#latestTick) return null;
    return Object.freeze({ fromTick: tick, toTick: this.#latestTick, replayCount: Math.max(0, this.#latestTick - tick), reason });
  }

  rollback(targetTick: number, reason: RollbackReason, runner: { restore: (state: TState) => void; step: (state: TState, input: TInput, tick: number) => TState; digest: (state: TState) => string }): RollbackResult<TState> {
    const plan = this.plan(targetTick, reason);
    if (!plan) return Object.freeze({ ok: false, state: undefined as unknown as TState, finalTick: this.#latestTick, replayed: 0, reason: 'rollback target is unavailable' });
    const checkpoint = this.#frames.find((frame) => frame.tick === plan.fromTick) ?? this.#frames.find((frame) => frame.tick <= plan.fromTick);
    if (!checkpoint) return Object.freeze({ ok: false, state: undefined as unknown as TState, finalTick: this.#latestTick, replayed: 0, reason: 'checkpoint missing' });
    let state = checkpoint.state;
    runner.restore(state);
    let replayed = 0;
    for (let tick = checkpoint.tick + 1; tick <= plan.toTick; tick += 1) {
      const input = this.#inputs.get(tick);
      if (input === undefined) continue;
      state = runner.step(state, input, tick);
      replayed += 1;
    }
    const digest = runner.digest(state);
    void digest;
    return Object.freeze({ ok: true, state, finalTick: plan.toTick, replayed, reason: `${reason}: rollback and replay complete` });
  }

  frames(): readonly RollbackFrame<TState>[] { return [...this.#frames]; }
  latest(): RollbackFrame<TState> | undefined { return this.#frames.at(-1); }
  clear(): void { this.#frames.length = 0; this.#inputs.clear(); this.#latestTick = -1; }
}
