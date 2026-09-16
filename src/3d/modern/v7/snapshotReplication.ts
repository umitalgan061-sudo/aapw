import { digest, stableSort, type Disposable, type EntityId } from './primitives.js';

export interface SnapshotEntity { readonly id: EntityId; readonly revision: number; readonly position: { readonly x: number; readonly y: number; readonly z: number }; readonly velocity: { readonly x: number; readonly y: number; readonly z: number }; readonly flags: number; }
export interface WorldSnapshot { readonly tick: number; readonly revision: number; readonly entities: readonly SnapshotEntity[]; readonly checksum: string; }
export interface SnapshotDelta { readonly tick: number; readonly baseRevision: number; readonly nextRevision: number; readonly changed: readonly SnapshotEntity[]; readonly removed: readonly EntityId[]; readonly checksum: string; }
export interface SnapshotHistoryStats { readonly snapshots: number; readonly deltas: number; readonly bytesEstimate: number; readonly dropped: number; }

function stableEntities(items: readonly SnapshotEntity[]): readonly SnapshotEntity[] { return Object.freeze(stableSort(items, (a, b) => String(a.id).localeCompare(String(b.id)) || a.revision - b.revision).map((entity) => Object.freeze({ ...entity, position: Object.freeze({ ...entity.position }), velocity: Object.freeze({ ...entity.velocity }) }))); }

export class SnapshotReplicationRuntime implements Disposable {
  readonly maxSnapshots: number; readonly maxEntities: number;
  #snapshots: WorldSnapshot[] = []; #revision = 0; #deltas = 0; #dropped = 0; #disposed = false;
  constructor(maxSnapshots = 120, maxEntities = 8192) { this.maxSnapshots = Math.max(4, Math.min(2048, Math.trunc(maxSnapshots))); this.maxEntities = Math.max(16, Math.min(100_000, Math.trunc(maxEntities))); }
  capture(tick: number, entities: readonly SnapshotEntity[]): WorldSnapshot { if (this.#disposed) return Object.freeze({ tick, revision: 0, entities: [], checksum: 'disposed' }); const limited = stableEntities(entities).slice(0, this.maxEntities); const snapshot = Object.freeze({ tick: Math.trunc(tick), revision: ++this.#revision, entities: Object.freeze(limited), checksum: digest(tick, this.#revision, limited) }); this.#snapshots.push(snapshot); if (this.#snapshots.length > this.maxSnapshots) { this.#snapshots.shift(); this.#dropped += 1; } return snapshot; }
  latest(): WorldSnapshot | null { return this.#snapshots.at(-1) ?? null; }
  atRevision(revision: number): WorldSnapshot | null { return this.#snapshots.find((snapshot) => snapshot.revision === revision) ?? null; }
  delta(fromRevision: number, toRevision = this.#revision): SnapshotDelta | null { const from = this.atRevision(fromRevision); const to = this.atRevision(toRevision); if (!from || !to || from.revision >= to.revision) return null; const before = new Map(from.entities.map((entity) => [entity.id, entity])); const changed = to.entities.filter((entity) => { const previous = before.get(entity.id); return !previous || previous.revision !== entity.revision || previous.position.x !== entity.position.x || previous.position.y !== entity.position.y || previous.position.z !== entity.position.z || previous.flags !== entity.flags; }); const after = new Set(to.entities.map((entity) => entity.id)); const removed = from.entities.filter((entity) => !after.has(entity.id)).map((entity) => entity.id); const delta = Object.freeze({ tick: to.tick, baseRevision: from.revision, nextRevision: to.revision, changed: Object.freeze(changed), removed: Object.freeze(removed), checksum: digest(to.tick, from.revision, to.revision, changed, removed) }); this.#deltas += 1; return delta; }
  verify(snapshot: WorldSnapshot): boolean { return snapshot.checksum === digest(snapshot.tick, snapshot.revision, snapshot.entities); }
  history(): readonly WorldSnapshot[] { return Object.freeze([...this.#snapshots]); }
  stats(): SnapshotHistoryStats { const bytesEstimate = this.#snapshots.reduce((sum, snapshot) => sum + JSON.stringify(snapshot).length, 0); return Object.freeze({ snapshots: this.#snapshots.length, deltas: this.#deltas, bytesEstimate, dropped: this.#dropped }); }
  clear(): void { this.#snapshots.length = 0; }
  dispose(): void { this.#disposed = true; this.clear(); }
}
