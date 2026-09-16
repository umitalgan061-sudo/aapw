import { digest, stableSort, type Disposable, type EntityId, asEntityId, type V7Result } from './primitives.js';

export interface EditorEntity { readonly id: EntityId; readonly type: string; readonly name: string; readonly transform: { readonly x: number; readonly y: number; readonly z: number; readonly rx: number; readonly ry: number; readonly rz: number; readonly sx: number; readonly sy: number; readonly sz: number }; readonly properties: Readonly<Record<string, unknown>>; readonly revision: number; }
export interface EditOperation { readonly id: string; readonly type: 'create' | 'update' | 'delete'; readonly entity: EntityId; readonly before: EditorEntity | null; readonly after: EditorEntity | null; readonly author: string; readonly timestamp: number; }
export interface EditorTransaction { readonly id: string; readonly author: string; readonly operations: readonly EditOperation[]; readonly digest: string; }
export interface EditorStats { readonly entities: number; readonly undo: number; readonly redo: number; readonly transactions: number; readonly conflicts: number; }

function cloneEntity(entity: EditorEntity): EditorEntity { return Object.freeze(JSON.parse(JSON.stringify(entity)) as EditorEntity); }
function validName(value: string): boolean { return /^[\w .:-]{1,128}$/u.test(value); }

export class TransactionalEditorRuntime implements Disposable {
  #entities = new Map<EntityId, EditorEntity>(); #undo: EditorTransaction[] = []; #redo: EditorTransaction[] = []; #disposed = false; #conflicts = 0; #serial = 0;
  create(input: Omit<EditorEntity, 'id' | 'revision'> & { id?: string }, author = 'system'): V7Result<EditorEntity> {
    if (this.#disposed) return this.fail('EDITOR_DISPOSED'); const id = asEntityId(input.id ?? `editor:${this.#entities.size + 1}`); if (this.#entities.has(id) || !input.type || !validName(input.name)) return this.fail('ENTITY_INVALID');
    const entity = cloneEntity({ ...input, id, revision: 1 }); const operation: EditOperation = Object.freeze({ id: `op:${++this.#serial}`, type: 'create', entity: id, before: null, after: entity, author, timestamp: this.#serial }); this.#commit(operation, author); return { ok: true, value: entity };
  }
  update(id: EntityId, patch: Partial<Omit<EditorEntity, 'id' | 'revision'>>, author = 'system'): V7Result<EditorEntity> {
    const before = this.#entities.get(id); if (this.#disposed) return this.fail('EDITOR_DISPOSED'); if (!before) return this.fail('ENTITY_MISSING'); const after = cloneEntity({ ...before, ...patch, id, revision: before.revision + 1 }); if (!validName(after.name)) return this.fail('ENTITY_INVALID'); const operation: EditOperation = Object.freeze({ id: `op:${++this.#serial}`, type: 'update', entity: id, before: cloneEntity(before), after, author, timestamp: this.#serial }); this.#commit(operation, author); return { ok: true, value: after };
  }
  delete(id: EntityId, author = 'system'): boolean { const before = this.#entities.get(id); if (!before || this.#disposed) return false; const operation: EditOperation = Object.freeze({ id: `op:${++this.#serial}`, type: 'delete', entity: id, before: cloneEntity(before), after: null, author, timestamp: this.#serial }); this.#commit(operation, author); return true; }
  transaction(id: string, operations: readonly EditOperation[]): V7Result<EditorTransaction> { if (this.#disposed || !id || operations.length === 0 || operations.length > 256) return this.fail('TRANSACTION_INVALID'); const transaction = Object.freeze({ id, author: operations[0]!.author, operations: Object.freeze([...operations]), digest: digest(id, operations) }); this.#undo.push(transaction); this.#redo.length = 0; for (const operation of operations) this.#apply(operation.after); return { ok: true, value: transaction }; }
  undo(): boolean { const transaction = this.#undo.pop(); if (!transaction) return false; for (const operation of [...transaction.operations].reverse()) this.#apply(operation.before); this.#redo.push(transaction); return true; }
  redo(): boolean { const transaction = this.#redo.pop(); if (!transaction) return false; for (const operation of transaction.operations) this.#apply(operation.after); this.#undo.push(transaction); return true; }
  get(id: EntityId): EditorEntity | undefined { return this.#entities.get(id); }
  all(): readonly EditorEntity[] { return Object.freeze(stableSort([...this.#entities.values()], (a, b) => String(a.id).localeCompare(String(b.id)))); }
  stats(): EditorStats { return Object.freeze({ entities: this.#entities.size, undo: this.#undo.length, redo: this.#redo.length, transactions: this.#undo.length + this.#redo.length, conflicts: this.#conflicts }); }
  dispose(): void { this.#disposed = true; this.#entities.clear(); this.#undo.length = 0; this.#redo.length = 0; }
  #commit(operation: EditOperation, author: string): void { const transaction = Object.freeze({ id: `tx:${this.#serial}`, author, operations: Object.freeze([operation]), digest: digest(operation) }); this.#apply(operation.after); this.#undo.push(transaction); this.#redo.length = 0; }
  #apply(entity: EditorEntity | null): void { if (!entity) return; this.#entities.set(entity.id, cloneEntity(entity)); }
  #fail<T>(code: string): V7Result<T> { return { ok: false, code, message: code, retryable: false }; }
}

export function createEditorTransform(position = { x: 0, y: 0, z: 0 }): EditorEntity['transform'] { return Object.freeze({ x: position.x, y: position.y, z: position.z, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 }); }
