import type { EntityId, Result, Vec3 } from './types';
import { checksum } from './deterministic';

export interface NetworkEntityState {
  readonly id: EntityId;
  readonly position: Vec3;
  readonly rotation: { x: number; y: number; z: number; w: number };
  readonly velocity: Vec3;
  readonly flags: number;
}

export interface WorldSnapshot {
  readonly tick: number;
  readonly baseline: string | null;
  readonly entities: readonly NetworkEntityState[];
  readonly digest: string;
}

export interface SnapshotDelta {
  readonly tick: number;
  readonly removed: readonly EntityId[];
  readonly changed: readonly NetworkEntityState[];
  readonly unchanged: number;
  readonly digest: string;
}

function nearlyEqual(a: number, b: number, epsilon = 1e-4): boolean {
  return Math.abs(a - b) <= epsilon;
}

function sameEntity(a: NetworkEntityState, b: NetworkEntityState): boolean {
  return nearlyEqual(a.position.x, b.position.x) && nearlyEqual(a.position.y, b.position.y) && nearlyEqual(a.position.z, b.position.z)
    && nearlyEqual(a.rotation.x, b.rotation.x) && nearlyEqual(a.rotation.y, b.rotation.y) && nearlyEqual(a.rotation.z, b.rotation.z)
    && nearlyEqual(a.rotation.w, b.rotation.w) && nearlyEqual(a.velocity.x, b.velocity.x) && nearlyEqual(a.velocity.y, b.velocity.y)
    && nearlyEqual(a.velocity.z, b.velocity.z) && a.flags === b.flags;
}

/** Snapshot/delta codec for future multiplayer or worker boundaries; no transport assumptions. */
export class SnapshotCodec {
  #history = new Map<number, WorldSnapshot>();
  #maxHistory: number;

  constructor(maxHistory = 32) { this.#maxHistory = Math.max(2, Math.floor(maxHistory)); }

  encode(tick: number, entities: readonly NetworkEntityState[], baselineTick: number | null = null): WorldSnapshot {
    if (!Number.isSafeInteger(tick) || tick < 0) throw new RangeError('invalid snapshot tick');
    const normalized = [...entities].sort((a, b) => a.id.localeCompare(b.id)).map((entity) => structuredClone(entity));
    const snapshot: WorldSnapshot = {
      tick,
      baseline: baselineTick === null ? null : String(baselineTick),
      entities: normalized,
      digest: checksum({ tick, entities: normalized }),
    };
    this.#history.set(tick, snapshot);
    this.#trim();
    return snapshot;
  }

  delta(current: WorldSnapshot, baselineTick: number | null): Result<SnapshotDelta> {
    const baseline = baselineTick === null ? null : this.#history.get(baselineTick);
    if (baselineTick !== null && !baseline) return { ok: false, error: { code: 'SNAPSHOT_BASELINE_MISSING', message: `Missing baseline ${baselineTick}`, retryable: true } };
    const previous = new Map((baseline?.entities ?? []).map((entity) => [entity.id, entity]));
    const changed: NetworkEntityState[] = [];
    for (const entity of current.entities) {
      const before = previous.get(entity.id);
      if (!before || !sameEntity(before, entity)) changed.push(entity);
      previous.delete(entity.id);
    }
    const removed = [...previous.keys()].sort();
    return {
      ok: true,
      value: {
        tick: current.tick,
        removed,
        changed: changed.sort((a, b) => a.id.localeCompare(b.id)),
        unchanged: Math.max(0, current.entities.length - changed.length),
        digest: checksum({ tick: current.tick, removed, changed }),
      },
    };
  }

  remember(snapshot: WorldSnapshot): void { this.#history.set(snapshot.tick, snapshot); this.#trim(); }
  get(tick: number): WorldSnapshot | undefined { return this.#history.get(tick); }
  clear(): void { this.#history.clear(); }

  #trim(): void {
    while (this.#history.size > this.#maxHistory) {
      const first = this.#history.keys().next().value as number | undefined;
      if (first === undefined) break;
      this.#history.delete(first);
    }
  }
}
