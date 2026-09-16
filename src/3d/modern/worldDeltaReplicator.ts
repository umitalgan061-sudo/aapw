import { checksum, quantize } from './deterministic';
import type { FrameId } from './types';

export interface ReplicatedTransform {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
}

export interface ReplicatedEntity {
  readonly id: string;
  readonly kind: string;
  readonly transform: ReplicatedTransform;
  readonly state: number;
  readonly revision: number;
}

export interface WorldDelta {
  readonly baseRevision: number;
  readonly revision: number;
  readonly frame: FrameId;
  readonly upserts: readonly ReplicatedEntity[];
  readonly removes: readonly string[];
  readonly checksum: string;
}

export interface ReconciliationResult {
  readonly accepted: boolean;
  readonly applied: number;
  readonly rejected: number;
  readonly revision: number;
  readonly reason: string | null;
}

function normalizeTransform(transform: ReplicatedTransform): ReplicatedTransform {
  return Object.freeze({ x: quantize(Number.isFinite(transform.x) ? transform.x : 0, 0.001), y: quantize(Number.isFinite(transform.y) ? transform.y : 0, 0.001), z: quantize(Number.isFinite(transform.z) ? transform.z : 0, 0.001), yaw: quantize(Number.isFinite(transform.yaw) ? transform.yaw : 0, 0.0001) });
}

function normalizeEntity(entity: ReplicatedEntity): ReplicatedEntity {
  return Object.freeze({ id: entity.id.slice(0, 128), kind: entity.kind.slice(0, 64), transform: normalizeTransform(entity.transform), state: entity.state >>> 0, revision: Math.max(0, Math.trunc(entity.revision)) });
}

/** Client-authoritative reconciliation helper for protocol-neutral multiplayer/state sync. */
export class WorldDeltaReplicator {
  #revision = 0;
  #entities = new Map<string, ReplicatedEntity>();
  #seen = new Set<number>();
  #maxEntities: number;
  #maxDeltaEntities: number;

  constructor(options: { maxEntities?: number; maxDeltaEntities?: number } = {}) {
    this.#maxEntities = Math.max(64, Math.trunc(options.maxEntities ?? 20_000));
    this.#maxDeltaEntities = Math.max(1, Math.min(4096, Math.trunc(options.maxDeltaEntities ?? 512)));
  }

  get revision(): number { return this.#revision; }
  entities(): readonly ReplicatedEntity[] { return Object.freeze([...this.#entities.values()].map(normalizeEntity)); }

  set(entity: ReplicatedEntity): boolean {
    if (!entity.id || entity.id.length > 128 || entity.kind.length > 64) return false;
    if (!this.#entities.has(entity.id) && this.#entities.size >= this.#maxEntities) return false;
    const normalized = normalizeEntity(entity);
    const current = this.#entities.get(entity.id);
    if (current && current.revision > normalized.revision) return false;
    this.#entities.set(entity.id, normalized);
    return true;
  }

  remove(id: string): boolean { return this.#entities.delete(id); }

  createDelta(previous: ReadonlyMap<string, ReplicatedEntity>, frame: FrameId): WorldDelta {
    const upserts: ReplicatedEntity[] = [];
    const removes: string[] = [];
    for (const [id, entity] of this.#entities) {
      const before = previous.get(id);
      if (!before || checksum(normalizeEntity(before)) !== checksum(entity)) upserts.push(entity);
    }
    for (const id of previous.keys()) if (!this.#entities.has(id)) removes.push(id);
    upserts.sort((a, b) => a.id.localeCompare(b.id));
    removes.sort();
    const boundedUpserts = upserts.slice(0, this.#maxDeltaEntities);
    const boundedRemoves = removes.slice(0, this.#maxDeltaEntities);
    const baseRevision = this.#revision;
    const revision = ++this.#revision;
    const delta: WorldDelta = Object.freeze({ baseRevision, revision, frame, upserts: Object.freeze(boundedUpserts.map(normalizeEntity)), removes: Object.freeze(boundedRemoves), checksum: checksum({ baseRevision, revision, frame, upserts: boundedUpserts, removes: boundedRemoves }) });
    return delta;
  }

  applyDelta(delta: WorldDelta): ReconciliationResult {
    if (delta.revision <= this.#revision || this.#seen.has(delta.revision)) return { accepted: false, applied: 0, rejected: delta.upserts.length + delta.removes.length, revision: this.#revision, reason: 'stale-revision' };
    if (delta.baseRevision !== this.#revision) return { accepted: false, applied: 0, rejected: delta.upserts.length + delta.removes.length, revision: this.#revision, reason: 'base-revision-mismatch' };
    if (delta.upserts.length > this.#maxDeltaEntities || delta.removes.length > this.#maxDeltaEntities) return { accepted: false, applied: 0, rejected: delta.upserts.length + delta.removes.length, revision: this.#revision, reason: 'delta-limit' };
    const expected = checksum({ baseRevision: delta.baseRevision, revision: delta.revision, frame: delta.frame, upserts: delta.upserts, removes: delta.removes });
    if (expected !== delta.checksum) return { accepted: false, applied: 0, rejected: delta.upserts.length + delta.removes.length, revision: this.#revision, reason: 'checksum-mismatch' };
    let applied = 0;
    let rejected = 0;
    for (const entity of delta.upserts) if (this.set(entity)) applied += 1; else rejected += 1;
    for (const id of delta.removes) if (this.remove(id)) applied += 1;
    this.#revision = delta.revision;
    this.#seen.add(delta.revision);
    if (this.#seen.size > 256) this.#seen.delete([...this.#seen][0]!);
    return { accepted: true, applied, rejected, revision: this.#revision, reason: null };
  }

  clear(): void { this.#revision = 0; this.#entities.clear(); this.#seen.clear(); }
}
