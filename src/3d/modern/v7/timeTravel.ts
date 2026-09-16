import { digest, stableSort, type Disposable, type Tick } from './primitives.js';

export interface TimelineCheckpoint<T = unknown> {
  readonly tick: Tick;
  readonly revision: number;
  readonly state: T;
  readonly digest: string;
}

export interface TimelineCursor {
  readonly tick: Tick;
  readonly revision: number;
  readonly checkpointCount: number;
}

export interface TimeTravelStats {
  readonly checkpoints: number;
  readonly restores: number;
  readonly branches: number;
  readonly bytesEstimate: number;
}

export class DeterministicTimeTravel<T> implements Disposable {
  readonly checkpointLimit: number;
  #checkpoints: TimelineCheckpoint<T>[] = [];
  #branches = new Map<string, TimelineCheckpoint<T>[]>();
  #restores = 0;
  #disposed = false;
  #revision = 0;

  constructor(checkpointLimit = 256) {
    this.checkpointLimit = Math.max(8, Math.min(4096, Math.trunc(checkpointLimit)));
  }

  checkpoint(tick: Tick, state: T): TimelineCheckpoint<T> {
    if (this.#disposed) throw new Error('timeline-disposed');
    const checkpoint = Object.freeze({ tick, revision: ++this.#revision, state, digest: digest(tick, this.#revision, state) });
    this.#checkpoints.push(checkpoint);
    if (this.#checkpoints.length > this.checkpointLimit) this.#checkpoints.shift();
    return checkpoint;
  }

  restore(tick: Tick): TimelineCheckpoint<T> | null {
    if (this.#disposed) return null;
    const candidates = this.#checkpoints.filter((checkpoint) => checkpoint.tick <= tick);
    const checkpoint = candidates.at(-1) ?? null;
    if (checkpoint) this.#restores += 1;
    return checkpoint;
  }

  branch(name: string, fromTick: Tick): boolean {
    if (this.#disposed || !name || this.#branches.has(name)) return false;
    const source = this.#checkpoints.filter((checkpoint) => checkpoint.tick <= fromTick);
    if (!source.length) return false;
    this.#branches.set(name, [...source]);
    return true;
  }

  appendBranch(name: string, checkpoint: TimelineCheckpoint<T>): boolean {
    const branch = this.#branches.get(name);
    if (!branch || this.#disposed) return false;
    const latest = branch.at(-1);
    if (latest && checkpoint.tick < latest.tick) return false;
    branch.push(checkpoint);
    if (branch.length > this.checkpointLimit) branch.shift();
    return true;
  }

  cursor(): TimelineCursor {
    const latest = this.#checkpoints.at(-1);
    return Object.freeze({ tick: latest?.tick ?? (0 as Tick), revision: latest?.revision ?? 0, checkpointCount: this.#checkpoints.length });
  }

  checkpoints(): readonly TimelineCheckpoint<T>[] {
    return Object.freeze(stableSort([...this.#checkpoints], (a, b) => a.tick - b.tick || a.revision - b.revision));
  }

  branchNames(): readonly string[] {
    return Object.freeze([...this.#branches.keys()].sort());
  }

  branch(name: string): readonly TimelineCheckpoint<T>[] {
    return Object.freeze([...(this.#branches.get(name) ?? [])]);
  }

  stats(): TimeTravelStats {
    const bytesEstimate = this.#checkpoints.reduce((sum, checkpoint) => sum + JSON.stringify(checkpoint).length, 0);
    return Object.freeze({ checkpoints: this.#checkpoints.length, restores: this.#restores, branches: this.#branches.size, bytesEstimate });
  }

  clear(): void {
    this.#checkpoints.length = 0;
    this.#branches.clear();
    this.#revision = 0;
  }

  dispose(): void {
    this.#disposed = true;
    this.clear();
  }
}
