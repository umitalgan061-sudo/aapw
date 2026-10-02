import { stableHash } from './hash';
import type { InterestEntity } from './contracts';

export interface WorldSnapshot {
  readonly tick: number;
  readonly revision: number;
  readonly entities: readonly InterestEntity[];
  readonly digest: string;
}

export class WorldSnapshotStore {
  readonly maxSnapshots: number;
  #snapshots: WorldSnapshot[] = [];

  constructor(maxSnapshots = 64) {
    this.maxSnapshots = Math.max(
      4,
      Math.trunc(maxSnapshots),
    );
  }

  capture(
    tick: number,
    revision: number,
    entities: readonly InterestEntity[],
  ): WorldSnapshot {
    const normalized = Object.freeze(
      [...entities]
        .map(entity =>
          Object.freeze({ ...entity }),
        )
        .sort((a, b) =>
          a.id.localeCompare(b.id),
        ),
    );

    const digest = stableHash({
      tick,
      revision,
      entities: normalized,
    });

    const snapshot = Object.freeze({
      tick,
      revision,
      entities: normalized,
      digest,
    });

    this.#snapshots.push(snapshot);

    while (
      this.#snapshots.length
      > this.maxSnapshots
    ) {
      this.#snapshots.shift();
    }

    return snapshot;
  }

  get(tick: number): WorldSnapshot | null {
    const snapshot =
      this.#snapshots.find(
        item => item.tick === tick,
      );

    return snapshot
      ? cloneSnapshot(snapshot)
      : null;
  }

  nearest(
    tick: number,
  ): WorldSnapshot | null {
    const snapshot = [...this.#snapshots]
      .filter(item => item.tick <= tick)
      .sort(
        (a, b) =>
          b.tick - a.tick
          || b.revision - a.revision,
      )[0];

    return snapshot
      ? cloneSnapshot(snapshot)
      : null;
  }

  verify(snapshot: WorldSnapshot): boolean {
    return stableHash({
      tick: snapshot.tick,
      revision: snapshot.revision,
      entities: snapshot.entities,
    }) === snapshot.digest;
  }

  removeBefore(tick: number): number {
    const remaining =
      this.#snapshots.filter(
        snapshot => snapshot.tick >= tick,
      );
    const removed =
      this.#snapshots.length
      - remaining.length;

    this.#snapshots = remaining;
    return removed;
  }

  all(): readonly WorldSnapshot[] {
    return Object.freeze(
      this.#snapshots.map(cloneSnapshot),
    );
  }

  clear(): void {
    this.#snapshots = [];
  }

  size(): number {
    return this.#snapshots.length;
  }
}

function cloneSnapshot(
  snapshot: WorldSnapshot,
): WorldSnapshot {
  return Object.freeze({
    tick: snapshot.tick,
    revision: snapshot.revision,
    entities: Object.freeze(
      snapshot.entities.map(entity =>
        Object.freeze({ ...entity }),
      ),
    ),
    digest: snapshot.digest,
  });
}
