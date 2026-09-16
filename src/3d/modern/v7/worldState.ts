import { asEntityId, clamp, digest, stableSort, type Disposable, type EntityId, type V7Result } from './primitives.js';

export interface WorldEntityState { readonly id: EntityId; readonly revision: number; readonly position: { readonly x: number; readonly y: number; readonly z: number }; readonly flags: number; readonly owner: string | null; readonly payload: Readonly<Record<string, unknown>>; }
export interface WorldDelta { readonly id: EntityId; readonly baseRevision: number; readonly nextRevision: number; readonly position?: WorldEntityState['position']; readonly flags?: number; readonly owner?: string | null; readonly patch?: Readonly<Record<string, unknown>>; readonly checksum: string; }
export interface WorldStateStats { readonly entities: number; readonly revisions: number; readonly deltas: number; readonly rejected: number; readonly stale: number; }

export class AuthoritativeWorldState implements Disposable {
  #entities = new Map<EntityId, WorldEntityState>(); #deltas = 0; #rejected = 0; #stale = 0; #disposed = false;
  upsert(state: Omit<WorldEntityState, 'id'> & { id: string }): V7Result<WorldEntityState> { if (this.#disposed) return this.fail('WORLD_DISPOSED'); if (!state.id) return this.fail('ENTITY_INVALID'); const id = asEntityId(state.id); const existing = this.#entities.get(id); const revision = Math.max(existing?.revision ?? 0, Math.trunc(state.revision)); if (existing && revision < existing.revision) return this.fail('REVISION_STALE'); const normalized = Object.freeze({ ...state, id, revision, flags: Math.trunc(state.flags), owner: state.owner ?? null, payload: Object.freeze({ ...state.payload }), position: Object.freeze({ ...state.position }) }); this.#entities.set(id, normalized); return { ok: true, value: normalized }; }
  applyDelta(delta: WorldDelta): V7Result<WorldEntityState> {
    if (this.#disposed) return this.fail('WORLD_DISPOSED'); const existing = this.#entities.get(delta.id); if (!existing) return this.fail('ENTITY_MISSING'); if (existing.revision !== delta.baseRevision || delta.nextRevision <= delta.baseRevision) { this.#stale += 1; return this.fail('DELTA_STALE'); }
    const expected = digest(delta.id, delta.baseRevision, delta.nextRevision, delta.position, delta.flags, delta.owner, delta.patch); if (expected !== delta.checksum) { this.#rejected += 1; return this.fail('DELTA_INTEGRITY'); }
    const merged: WorldEntityState = Object.freeze({ ...existing, revision: delta.nextRevision, position: delta.position ? Object.freeze({ ...delta.position }) : existing.position, flags: delta.flags === undefined ? existing.flags : Math.trunc(delta.flags), owner: delta.owner === undefined ? existing.owner : delta.owner, payload: Object.freeze({ ...existing.payload, ...(delta.patch ?? {}) }) }); this.#entities.set(delta.id, merged); this.#deltas += 1; return { ok: true, value: merged };
  }
  delta(id: EntityId, next: Partial<Omit<WorldEntityState, 'id' | 'revision'>>): V7Result<WorldDelta> { const current = this.#entities.get(id); if (!current) return this.fail('ENTITY_MISSING'); const revision = current.revision + 1; const patch = next.payload === undefined ? undefined : Object.freeze({ ...next.payload }); const delta: WorldDelta = Object.freeze({ id, baseRevision: current.revision, nextRevision: revision, position: next.position ? Object.freeze({ ...next.position }) : undefined, flags: next.flags, owner: next.owner, patch, checksum: digest(id, current.revision, revision, next.position, next.flags, next.owner, patch) }); return { ok: true, value: delta }; }
  get(id: EntityId): WorldEntityState | undefined { return this.#entities.get(id); }
  all(): readonly WorldEntityState[] { return Object.freeze(stableSort([...this.#entities.values()], (a, b) => String(a.id).localeCompare(String(b.id)))); }
  remove(id: EntityId): boolean { return this.#entities.delete(id); }
  clear(): void { this.#entities.clear(); }
  stats(): WorldStateStats { return Object.freeze({ entities: this.#entities.size, revisions: [...this.#entities.values()].reduce((sum, entity) => sum + entity.revision, 0), deltas: this.#deltas, rejected: this.#rejected, stale: this.#stale }); }
  dispose(): void { this.#disposed = true; this.clear(); }
  #fail<T>(code: string): V7Result<T> { return { ok: false, code, message: code, retryable: code === 'DELTA_STALE' }; }
}

export function quantizePosition(position: WorldEntityState['position'], quantum = 1000): WorldEntityState['position'] { const q = clamp(Math.trunc(quantum), 1, 1_000_000); return Object.freeze({ x: Math.round(position.x * q) / q, y: Math.round(position.y * q) / q, z: Math.round(position.z * q) / q }); }
