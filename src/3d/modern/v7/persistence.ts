import { digest, integer, stableSort, type Disposable, type Tick, type V7Result } from './primitives.js';

export interface SaveEnvelope<T = unknown> {
  readonly schema: number;
  readonly build: string;
  readonly tick: Tick;
  readonly slot: string;
  readonly revision: number;
  readonly payload: T;
  readonly checksum: string;
  readonly createdAt: string;
}
export interface Migration<T = unknown> { readonly from: number; readonly to: number; readonly apply: (payload: unknown) => T; }
export interface SaveAdapter { write(slot: string, serialized: string): Promise<void>; read(slot: string): Promise<string | null>; remove?(slot: string): Promise<void>; }
export interface PersistenceStats { readonly writes: number; readonly reads: number; readonly restores: number; readonly failures: number; readonly backups: number; }
export interface PersistenceOptions { readonly currentSchema?: number; readonly maxSlots?: number; readonly maxSerializedBytes?: number; readonly backupCount?: number; readonly build?: string; readonly adapter?: SaveAdapter; readonly clock?: () => string; }

const memoryAdapter: SaveAdapter = (() => { const store = new Map<string, string>(); return { async write(slot, value) { store.set(slot, value); }, async read(slot) { return store.get(slot) ?? null; }, async remove(slot) { store.delete(slot); } }; })();

function safeJson(value: unknown): V7Result<string> { try { return { ok: true, value: JSON.stringify(value) ?? 'null' }; } catch { return { ok: false, code: 'PERSIST_SERIALIZE', message: 'Value is not serializable', retryable: false }; } }
function parseJson(value: string): V7Result<unknown> { try { return { ok: true, value: JSON.parse(value) as unknown }; } catch { return { ok: false, code: 'PERSIST_PARSE', message: 'Stored value is not valid JSON', retryable: false }; }

export class VersionedPersistence implements Disposable {
  readonly currentSchema: number; readonly maxSlots: number; readonly maxSerializedBytes: number; readonly backupCount: number; readonly build: string;
  #adapter: SaveAdapter; #clock: () => string; #migrations = new Map<number, Migration>(); #revisions = new Map<string, number>(); #disposed = false;
  #writes = 0; #reads = 0; #restores = 0; #failures = 0; #backups = 0;
  constructor(options: PersistenceOptions = {}) { this.currentSchema = Math.max(1, integer(options.currentSchema ?? 1)); this.maxSlots = Math.max(1, Math.min(128, integer(options.maxSlots ?? 16))); this.maxSerializedBytes = Math.max(4096, Math.min(8 * 1024 * 1024, integer(options.maxSerializedBytes ?? 2 * 1024 * 1024))); this.backupCount = Math.max(0, Math.min(8, integer(options.backupCount ?? 2))); this.build = options.build ?? 'aapw-v7'; this.#adapter = options.adapter ?? memoryAdapter; this.#clock = options.clock ?? (() => new Date().toISOString()); }
  registerMigration(migration: Migration): V7Result<void> { if (this.#disposed) return this.fail('PERSIST_DISPOSED'); if (migration.to !== migration.from + 1 || migration.from < 0 || migration.to > this.currentSchema) return this.fail('MIGRATION_INVALID'); this.#migrations.set(migration.from, migration); return { ok: true, value: undefined }; }
  async save<T>(slot: string, payload: T, tick: Tick): Promise<V7Result<SaveEnvelope<T>>> {
    if (this.#disposed) return this.fail('PERSIST_DISPOSED'); if (!validSlot(slot)) return this.fail('SLOT_INVALID'); if (this.#revisions.size >= this.maxSlots && !this.#revisions.has(slot)) return this.fail('SLOT_LIMIT');
    const revision = (this.#revisions.get(slot) ?? 0) + 1; const envelope: SaveEnvelope<T> = Object.freeze({ schema: this.currentSchema, build: this.build, tick, slot, revision, payload, checksum: digest(this.currentSchema, this.build, tick, slot, revision, payload), createdAt: this.#clock() });
    const serialized = safeJson(envelope); if (!serialized.ok) return serialized as V7Result<SaveEnvelope<T>>; if (serialized.value.length > this.maxSerializedBytes) return this.fail('SAVE_SIZE_LIMIT');
    try { await this.#backup(slot); await this.#adapter.write(slot, serialized.value); this.#revisions.set(slot, revision); this.#writes += 1; return { ok: true, value: envelope }; } catch { this.#failures += 1; return this.fail('SAVE_WRITE'); }
  }
  async load<T = unknown>(slot: string): Promise<V7Result<SaveEnvelope<T>>> {
    if (this.#disposed) return this.fail('PERSIST_DISPOSED'); if (!validSlot(slot)) return this.fail('SLOT_INVALID'); this.#reads += 1;
    try { const raw = await this.#adapter.read(slot); if (!raw) return this.fail('SAVE_NOT_FOUND'); const parsed = parseJson(raw); if (!parsed.ok) return parsed as V7Result<SaveEnvelope<T>>; const envelope = parsed.value as SaveEnvelope<T>; if (!this.#validEnvelope(envelope)) return this.fail('SAVE_INTEGRITY'); return { ok: true, value: Object.freeze(envelope) }; } catch { this.#failures += 1; return this.fail('SAVE_READ'); }
  }
  async restore<T = unknown>(slot: string): Promise<V7Result<SaveEnvelope<T>>> {
    const loaded = await this.load<T>(slot); if (!loaded.ok) return loaded; const migrated = this.#migrate(loaded.value); if (!migrated.ok) return migrated as V7Result<SaveEnvelope<T>>; this.#restores += 1; return migrated as V7Result<SaveEnvelope<T>>;
  }
  async remove(slot: string): Promise<V7Result<void>> { if (this.#disposed) return this.fail('PERSIST_DISPOSED'); try { await this.#adapter.remove?.(slot); this.#revisions.delete(slot); return { ok: true, value: undefined }; } catch { this.#failures += 1; return this.fail('SAVE_REMOVE'); } }
  slots(): readonly string[] { return Object.freeze(stableSort([...this.#revisions.keys()], (a, b) => a.localeCompare(b))); }
  stats(): PersistenceStats { return Object.freeze({ writes: this.#writes, reads: this.#reads, restores: this.#restores, failures: this.#failures, backups: this.#backups }); }
  dispose(): void { this.#disposed = true; this.#revisions.clear(); this.#migrations.clear(); }
  #backup(slot: string): Promise<void> { if (!this.backupCount) return Promise.resolve(); return this.#adapter.read(slot).then(async (raw) => { if (!raw) return; for (let index = this.backupCount; index >= 1; index -= 1) { const source = index === 1 ? slot : `${slot}.bak${index - 1}`; const target = `${slot}.bak${index}`; const content = await this.#adapter.read(source); if (content) await this.#adapter.write(target, content); } this.#backups += 1; }); }
  #validEnvelope(envelope: SaveEnvelope): boolean { return Boolean(envelope && validSlot(envelope.slot) && Number.isInteger(envelope.schema) && envelope.schema >= 1 && envelope.schema <= this.currentSchema && Number.isInteger(envelope.revision) && envelope.revision >= 1 && envelope.checksum === digest(envelope.schema, envelope.build, envelope.tick, envelope.slot, envelope.revision, envelope.payload)); }
  #migrate<T>(envelope: SaveEnvelope<T>): V7Result<SaveEnvelope<T>> { let current = envelope as SaveEnvelope<unknown>; while (current.schema < this.currentSchema) { const migration = this.#migrations.get(current.schema); if (!migration) return this.fail('MIGRATION_MISSING'); let payload: unknown; try { payload = migration.apply(current.payload); } catch { return this.fail('MIGRATION_FAILED'); } const revision = current.revision + 1; current = Object.freeze({ ...current, schema: migration.to, payload, revision, checksum: digest(migration.to, this.build, current.tick, current.slot, revision, payload) }); } return { ok: true, value: current as SaveEnvelope<T> }; }
  #fail<T>(code: string): V7Result<T> { return { ok: false, code, message: code, retryable: code.startsWith('SAVE_') }; }
}

function validSlot(slot: string): boolean { return typeof slot === 'string' && /^[a-zA-Z0-9._-]{1,64}$/.test(slot); }
