import type { Disposable, EntityId, Vec3 } from './coreTypes.js';
import { ENTITY_ID } from './coreTypes.js';

export type EditorCommand =
  | { readonly type: 'create'; readonly id: string; readonly position: Vec3; readonly tags: readonly string[] }
  | { readonly type: 'move'; readonly id: string; readonly position: Vec3 }
  | { readonly type: 'tag'; readonly id: string; readonly tag: string; readonly enabled: boolean }
  | { readonly type: 'delete'; readonly id: string }
  | { readonly type: 'select'; readonly id: string | null }
  | { readonly type: 'undo' }
  | { readonly type: 'redo' };
export interface EditorEntity { readonly id: EntityId; readonly position: Vec3; readonly tags: readonly string[]; }
export interface EditorSelection { readonly id: EntityId | null; readonly timestamp: number; }
export interface EditorTransaction { readonly id: number; readonly before: readonly EditorEntity[]; readonly after: readonly EditorEntity[]; readonly command: EditorCommand; }
export interface EditorStats { readonly entities: number; readonly undoDepth: number; readonly redoDepth: number; readonly commands: number; readonly selections: number; }

function cloneEntity(entity: EditorEntity): EditorEntity { return Object.freeze({ id: entity.id, position: Object.freeze({ ...entity.position }), tags: Object.freeze([...entity.tags]) }); }
function cloneState(entities: Map<EntityId, EditorEntity>): readonly EditorEntity[] { return Object.freeze([...entities.values()].sort((a, b) => String(a.id).localeCompare(String(b.id))).map(cloneEntity)); }

export class EditorRuntime implements Disposable {
  #entities = new Map<EntityId, EditorEntity>();
  #selection: EditorSelection = Object.freeze({ id: null, timestamp: 0 });
  #undo: EditorTransaction[] = [];
  #redo: EditorTransaction[] = [];
  #sequence = 1;
  #commands = 0;
  #selections = 0;
  #now: () => number;
  #disposed = false;

  constructor(now: () => number = () => typeof performance !== 'undefined' ? performance.now() : Date.now()) { this.#now = now; }

  execute(command: EditorCommand): boolean {
    if (this.#disposed) return false;
    if (command.type === 'undo') return this.undo();
    if (command.type === 'redo') return this.redo();
    const before = cloneState(this.#entities);
    let changed = false;
    switch (command.type) {
      case 'create': changed = this.#create(command.id, command.position, command.tags); break;
      case 'move': changed = this.#move(command.id, command.position); break;
      case 'tag': changed = this.#tag(command.id, command.tag, command.enabled); break;
      case 'delete': changed = this.#delete(command.id); break;
      case 'select': this.#select(command.id); return true;
      default: return false;
    }
    if (!changed) return false;
    const after = cloneState(this.#entities);
    this.#undo.push(Object.freeze({ id: this.#sequence++, before, after, command }));
    if (this.#undo.length > 512) this.#undo.shift();
    this.#redo.length = 0;
    this.#commands += 1;
    return true;
  }

  undo(): boolean {
    const tx = this.#undo.pop(); if (!tx || this.#disposed) return false;
    this.#restore(tx.before); this.#redo.push(tx); return true;
  }

  redo(): boolean {
    const tx = this.#redo.pop(); if (!tx || this.#disposed) return false;
    this.#restore(tx.after); this.#undo.push(tx); return true;
  }

  entity(id: EntityId): EditorEntity | undefined { return this.#entities.get(id); }
  entities(): readonly EditorEntity[] { return cloneState(this.#entities); }
  selection(): EditorSelection { return this.#selection; }
  stats(): EditorStats { return Object.freeze({ entities: this.#entities.size, undoDepth: this.#undo.length, redoDepth: this.#redo.length, commands: this.#commands, selections: this.#selections }); }
  clearHistory(): void { this.#undo.length = 0; this.#redo.length = 0; }
  dispose(): void { this.#disposed = true; this.#entities.clear(); this.clearHistory(); this.#selection = Object.freeze({ id: null, timestamp: this.#now() }); }

  #create(rawId: string, position: Vec3, tags: readonly string[]): boolean {
    const id = ENTITY_ID(rawId.trim()); if (!String(id) || this.#entities.has(id)) return false;
    this.#entities.set(id, Object.freeze({ id, position: Object.freeze({ ...position }), tags: Object.freeze([...new Set(tags.filter(Boolean))].sort()) })); return true;
  }
  #move(rawId: string, position: Vec3): boolean { const id = ENTITY_ID(rawId); const entity = this.#entities.get(id); if (!entity) return false; this.#entities.set(id, Object.freeze({ ...entity, position: Object.freeze({ ...position }) })); return true; }
  #tag(rawId: string, tag: string, enabled: boolean): boolean { const id = ENTITY_ID(rawId); const entity = this.#entities.get(id); if (!entity || !tag.trim()) return false; const tags = new Set(entity.tags); enabled ? tags.add(tag.trim()) : tags.delete(tag.trim()); this.#entities.set(id, Object.freeze({ ...entity, tags: Object.freeze([...tags].sort()) })); return true; }
  #delete(rawId: string): boolean { const id = ENTITY_ID(rawId); return this.#entities.delete(id); }
  #select(rawId: string | null): void { this.#selection = Object.freeze({ id: rawId === null ? null : ENTITY_ID(rawId), timestamp: this.#now() }); this.#selections += 1; }
  #restore(snapshot: readonly EditorEntity[]): void { this.#entities.clear(); for (const entity of snapshot) this.#entities.set(entity.id, cloneEntity(entity)); }
}
