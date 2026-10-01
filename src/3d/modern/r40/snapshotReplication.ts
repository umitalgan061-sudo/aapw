import type { EntityId, Revision, SnapshotEnvelope, Tick, WorldDelta } from './types';
import { hashJson, stableSort } from './deterministic';

export interface ReplicationLimits { readonly maxDeltasPerTick: number; readonly maxSnapshotBytes: number; readonly maxHistory: number; }
export interface ReplicationFrame { readonly tick: Tick; readonly revision: Revision; readonly deltas: readonly WorldDelta[]; readonly digest: string; }
const DEFAULT_LIMITS: ReplicationLimits = Object.freeze({ maxDeltasPerTick: 1024, maxSnapshotBytes: 1048576, maxHistory: 32 });

export class SnapshotReplicator<T> {
  readonly limits: ReplicationLimits; #history: SnapshotEnvelope<T>[] = []; #lastRevision = 0;
  constructor(limits: Partial<ReplicationLimits> = {}) { this.limits = Object.freeze({ ...DEFAULT_LIMITS, ...limits }); }
  publish(tick: Tick, revision: Revision, state: T): SnapshotEnvelope<T> {
    const snapshot = Object.freeze({ version: 40, tick, revision, digest: hashJson({ version: 40, tick, revision, state }), state: structuredClone(state) });
    this.#history.push(snapshot); if (this.#history.length > this.limits.maxHistory) this.#history.shift(); this.#lastRevision = Math.max(this.#lastRevision, Number(revision)); return snapshot;
  }
  accept(snapshot: SnapshotEnvelope<T>): boolean {
    if (Number(snapshot.revision) < this.#lastRevision || snapshot.version !== 40) return false;
    if (hashJson({ version: snapshot.version, tick: snapshot.tick, revision: snapshot.revision, state: snapshot.state }) !== snapshot.digest) return false;
    this.#history.push(Object.freeze({ ...snapshot, state: structuredClone(snapshot.state) })); if (this.#history.length > this.limits.maxHistory) this.#history.shift();
    this.#lastRevision = Number(snapshot.revision); return true;
  }
  frame(tick: Tick, revision: Revision, deltas: readonly WorldDelta[]): ReplicationFrame {
    const ordered = stableSort(deltas, (a, b) => Number(a.revision) - Number(b.revision) || String(a.entityId).localeCompare(String(b.entityId))).slice(0, this.limits.maxDeltasPerTick);
    return Object.freeze({ tick, revision, deltas: Object.freeze(ordered), digest: hashJson({ tick, revision, deltas: ordered }) });
  }
  validateFrame(frame: ReplicationFrame): boolean {
    if (frame.deltas.length > this.limits.maxDeltasPerTick) return false;
    return hashJson({ tick: frame.tick, revision: frame.revision, deltas: frame.deltas }) === frame.digest;
  }
  latest(): SnapshotEnvelope<T> | null { return this.#history[this.#history.length - 1] ?? null; }
  byRevision(revision: Revision): SnapshotEnvelope<T> | null { return this.#history.find((item) => Number(item.revision) === Number(revision)) ?? null; }
  history(): readonly SnapshotEnvelope<T>[] { return Object.freeze([...this.#history]); }
  lastRevision(): Revision { return this.#lastRevision as Revision; }
  clear(): void { this.#history.length = 0; this.#lastRevision = 0; }
}
export function deltaDigest(entityId: EntityId, revision: Revision, tick: Tick): string { return hashJson({ entityId, revision, tick }); }
