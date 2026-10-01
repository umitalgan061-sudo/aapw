import type { SnapshotEnvelope, Tick } from './types';
import { hashJson, stableSort } from './deterministic';

export interface RollbackEntry<T> { readonly tick: Tick; readonly snapshot: SnapshotEnvelope<T>; readonly commandDigest: string; }
export interface RollbackConfig { readonly capacity: number; readonly keyframeInterval: number; }

export class RollbackRing<T> {
  readonly config: RollbackConfig;
  #entries: RollbackEntry<T>[] = [];
  constructor(config: Partial<RollbackConfig> = {}) { this.config = Object.freeze({ capacity: config.capacity ?? 120, keyframeInterval: config.keyframeInterval ?? 10 }); }
  push(tick: Tick, state: T, commands: readonly string[]): RollbackEntry<T> {
    const snapshot: SnapshotEnvelope<T> = Object.freeze({ version: 40, tick, revision: tick as never, digest: hashJson({ tick, state }), state: structuredClone(state) });
    const entry = Object.freeze({ tick, snapshot, commandDigest: hashJson(commands) });
    this.#entries.push(entry); if (this.#entries.length > this.config.capacity) this.#entries.shift(); return entry;
  }
  nearest(tick: Tick): RollbackEntry<T> | null {
    return stableSort(this.#entries.filter((entry) => Number(entry.tick) <= Number(tick)), (a, b) => Number(b.tick) - Number(a.tick))[0] ?? null;
  }
  range(start: Tick, end: Tick): readonly RollbackEntry<T>[] { return Object.freeze(this.#entries.filter((entry) => Number(entry.tick) >= Number(start) && Number(entry.tick) <= Number(end))); }
  latest(): RollbackEntry<T> | null { return this.#entries[this.#entries.length - 1] ?? null; }
  removeAfter(tick: Tick): number { const before = this.#entries.length; this.#entries = this.#entries.filter((entry) => Number(entry.tick) <= Number(tick)); return before - this.#entries.length; }
  digest(): string { return hashJson(this.#entries.map((entry) => [entry.tick, entry.snapshot.digest, entry.commandDigest])); }
  clear(): void { this.#entries.length = 0; }
}
