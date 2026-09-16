import type { Disposable, EntityId, TransformSnapshot, Vec3 } from './coreTypes.js';
import { stableNumber, stableSort } from './coreTypes.js';

export interface ReplicatedEntity { readonly id: EntityId; readonly revision: number; readonly owner: string; readonly transform: TransformSnapshot; readonly flags: number; readonly metadata: Readonly<Record<string, string | number | boolean>>; }
export interface WorldDelta { readonly revision: number; readonly tick: number; readonly added: readonly ReplicatedEntity[]; readonly updated: readonly ReplicatedEntity[]; readonly removed: readonly EntityId[]; readonly checksum: string; }
export interface ApplyResult { readonly accepted: boolean; readonly stale: number; readonly applied: number; readonly removed: number; readonly revision: number; }
export interface StateStats { readonly entities: number; readonly revision: number; readonly deltas: number; readonly rejected: number; readonly stale: number; readonly bytes: number; }

function checksum(value: unknown): string {
  const text = JSON.stringify(value, Object.keys(value as object).sort());
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
function normalizeTransform(transform: TransformSnapshot): TransformSnapshot {
  return Object.freeze({
    position: Object.freeze({ x: stableNumber(transform.position.x), y: stableNumber(transform.position.y), z: stableNumber(transform.position.z) }),
    rotation: Object.freeze({ x: stableNumber(transform.rotation.x), y: stableNumber(transform.rotation.y), z: stableNumber(transform.rotation.z), w: stableNumber(transform.rotation.w) }),
    scale: Object.freeze({ x: Math.max(0.001, stableNumber(transform.scale.x)), y: Math.max(0.001, stableNumber(transform.scale.y)), z: Math.max(0.001, stableNumber(transform.scale.z)) }),
  });
}
function position(value: Vec3): Vec3 { return Object.freeze({ x: stableNumber(value.x), y: stableNumber(value.y), z: stableNumber(value.z) }); }

export class WorldStateRuntime implements Disposable {
  #entities = new Map<EntityId, ReplicatedEntity>();
  #revision = 0;
  #deltas = 0;
  #rejected = 0;
  #stale = 0;
  #disposed = false;

  upsert(entity: ReplicatedEntity): boolean {
    if (this.#disposed || !entity.id || entity.revision < 0) { this.#rejected += 1; return false; }
    const current = this.#entities.get(entity.id);
    if (current && entity.revision < current.revision) { this.#stale += 1; return false; }
    this.#entities.set(entity.id, Object.freeze({ ...entity, transform: normalizeTransform(entity.transform), metadata: Object.freeze({ ...entity.metadata }) }));
    this.#revision = Math.max(this.#revision, entity.revision);
    return true;
  }

  remove(id: EntityId, revision = this.#revision + 1): boolean {
    const current = this.#entities.get(id);
    if (!current || revision < current.revision) { if (current) this.#stale += 1; return false; }
    this.#entities.delete(id);
    this.#revision = Math.max(this.#revision, revision);
    return true;
  }

  createDelta(previousRevision: number, tick: number): WorldDelta {
    const all = stableSort([...this.#entities.values()], (a, b) => String(a.id).localeCompare(String(b.id)));
    const updated = all.filter(entity => entity.revision > previousRevision);
    const delta: WorldDelta = Object.freeze({ revision: this.#revision, tick: Math.max(0, Math.trunc(tick)), added: Object.freeze(updated.filter(entity => entity.revision === 1)), updated: Object.freeze(updated.filter(entity => entity.revision > 1)), removed: Object.freeze([]), checksum: checksum(updated) });
    this.#deltas += 1;
    return delta;
  }

  applyDelta(delta: WorldDelta): ApplyResult {
    if (this.#disposed || delta.revision < this.#revision) { this.#rejected += 1; return Object.freeze({ accepted: false, stale: delta.revision < this.#revision ? 1 : 0, applied: 0, removed: 0, revision: this.#revision }); }
    if (checksum([...delta.added, ...delta.updated]) !== delta.checksum) { this.#rejected += 1; return Object.freeze({ accepted: false, stale: 0, applied: 0, removed: 0, revision: this.#revision }); }
    let applied = 0; let stale = 0;
    for (const entity of [...delta.added, ...delta.updated]) {
      if (this.upsert(entity)) applied += 1; else stale += 1;
    }
    let removed = 0;
    for (const id of delta.removed) if (this.remove(id, delta.revision)) removed += 1;
    this.#revision = Math.max(this.#revision, delta.revision);
    return Object.freeze({ accepted: true, stale, applied, removed, revision: this.#revision });
  }

  entity(id: EntityId): ReplicatedEntity | undefined { return this.#entities.get(id); }
  entities(): readonly ReplicatedEntity[] { return Object.freeze(stableSort([...this.#entities.values()], (a, b) => String(a.id).localeCompare(String(b.id)))); }
  queryRadius(center: Vec3, radius: number): readonly ReplicatedEntity[] {
    const max = Math.max(0, radius); const squared = max * max;
    return Object.freeze(this.entities().filter(entity => { const p = entity.transform.position; const dx = p.x - center.x; const dy = p.y - center.y; const dz = p.z - center.z; return dx * dx + dy * dy + dz * dz <= squared; }));
  }
  stats(): StateStats { return Object.freeze({ entities: this.#entities.size, revision: this.#revision, deltas: this.#deltas, rejected: this.#rejected, stale: this.#stale, bytes: JSON.stringify(this.entities()).length }); }
  snapshot(): readonly ReplicatedEntity[] { return Object.freeze(this.entities().map(entity => Object.freeze({ ...entity, transform: normalizeTransform(entity.transform) }))); }
  clear(): void { this.#entities.clear(); this.#revision = 0; }
  dispose(): void { this.#disposed = true; this.clear(); }
}

export const statePosition = (x: number, y: number, z: number): Vec3 => position({ x, y, z });
