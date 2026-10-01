import type { EntityId, EntityState, Vec3 } from './types';
import { cloneEntityState } from './types';
import { hashJson, clamp } from './deterministic';

export type EditorOperation = 'translate' | 'rotate' | 'scale' | 'tag' | 'delete' | 'duplicate';
export interface EditorCommand { readonly id: string; readonly operation: EditorOperation; readonly entity: EntityId; readonly before: EntityState | null; readonly after: EntityState | null; readonly tick: number; readonly digest: string; }
export interface EditorSelection { readonly active: EntityId | null; readonly ids: readonly EntityId[]; }
export class RuntimeEditorBridge {
  #entities = new Map<EntityId, EntityState>();
  #undo: EditorCommand[] = [];
  #redo: EditorCommand[] = [];
  #selection: EditorSelection = Object.freeze({ active: null, ids: Object.freeze([]) });
  load(entity: EntityState): void { this.#entities.set(entity.id, cloneEntityState(entity)); }
  select(ids: readonly EntityId[]): void {
    const unique = [...new Set(ids)].filter((id) => this.#entities.has(id));
    this.#selection = Object.freeze({ active: unique[0] ?? null, ids: Object.freeze(unique) });
  }
  move(entity: EntityId, delta: Vec3, tick: number): EditorCommand | null {
    const current = this.#entities.get(entity); if (!current) return null;
    const after = Object.freeze({ ...current, transform: Object.freeze({ ...current.transform, position: Object.freeze({ x: current.transform.position.x + delta.x, y: current.transform.position.y + delta.y, z: current.transform.position.z + delta.z }) }) });
    return this.#commit('translate', entity, current, after, tick);
  }
  scale(entity: EntityId, factor: Vec3, tick: number): EditorCommand | null {
    const current = this.#entities.get(entity); if (!current) return null;
    const after = Object.freeze({ ...current, transform: Object.freeze({ ...current.transform, scale: Object.freeze({ x: clamp(current.transform.scale.x * factor.x, 0.001, 1000), y: clamp(current.transform.scale.y * factor.y, 0.001, 1000), z: clamp(current.transform.scale.z * factor.z, 0.001, 1000) }) }) });
    return this.#commit('scale', entity, current, after, tick);
  }
  tag(entity: EntityId, tag: string, enabled: boolean, tick: number): EditorCommand | null {
    const current = this.#entities.get(entity); if (!current || !/^[A-Za-z0-9_.:-]{1,48}$/.test(tag)) return null;
    const tags = new Set(current.tags); if (enabled) tags.add(tag); else tags.delete(tag);
    const after = Object.freeze({ ...current, tags: Object.freeze([...tags].sort()) });
    return this.#commit('tag', entity, current, after, tick);
  }
  delete(entity: EntityId, tick: number): EditorCommand | null { const current = this.#entities.get(entity); return current ? this.#commit('delete', entity, current, null, tick) : null; }
  duplicate(entity: EntityId, newId: EntityId, tick: number): EditorCommand | null {
    const current = this.#entities.get(entity); if (!current || this.#entities.has(newId)) return null;
    const copy = Object.freeze({ ...current, id: newId, transform: Object.freeze({ ...current.transform, position: Object.freeze({ x: current.transform.position.x + 1, y: current.transform.position.y, z: current.transform.position.z + 1 }) }) });
    return this.#commit('duplicate', newId, null, copy, tick);
  }
  undo(): EditorCommand | null { const command = this.#undo.pop(); if (!command) return null; this.#apply(command.entity, command.before); this.#redo.push(command); return command; }
  redo(): EditorCommand | null { const command = this.#redo.pop(); if (!command) return null; this.#apply(command.entity, command.after); this.#undo.push(command); return command; }
  entity(id: EntityId): EntityState | null { return this.#entities.get(id) ?? null; }
  selection(): EditorSelection { return this.#selection; }
  digest(): string { return hashJson([...this.#entities.values()].sort((a, b) => a.id.localeCompare(b.id))); }
  #apply(id: EntityId, value: EntityState | null): void { if (value) this.#entities.set(id, cloneEntityState(value)); else this.#entities.delete(id); }
  #commit(operation: EditorOperation, entity: EntityId, before: EntityState | null, after: EntityState | null, tick: number): EditorCommand {
    this.#apply(entity, after);
    const command = Object.freeze({ id: 'editor-' + String(this.#undo.length + this.#redo.length + 1), operation, entity, before: before && cloneEntityState(before), after: after && cloneEntityState(after), tick, digest: hashJson({ operation, entity, before, after, tick }) });
    this.#undo.push(command); this.#redo.length = 0; return command;
  }
  clear(): void { this.#entities.clear(); this.#undo.length = 0; this.#redo.length = 0; this.#selection = Object.freeze({ active: null, ids: Object.freeze([]) }); }
}
