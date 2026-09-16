import {
  type OutcomeV4,
  okV4,
  failV4,
  createRuntimeErrorV4,
} from './runtimeContractsV4';

export interface SaveEnvelopeV5<T = unknown> {
  readonly schema: string;
  readonly version: number;
  readonly slot: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly payload: T;
  readonly checksum: string;
  readonly bytes: number;
}

export interface SaveAdapterV5<T = unknown> {
  readonly write: (slot: number, envelope: SaveEnvelopeV5<T>) => Promise<void>;
  readonly read: (slot: number) => Promise<SaveEnvelopeV5<T> | null>;
  readonly list: () => Promise<readonly SaveEnvelopeV5<T>[]>;
  readonly remove: (slot: number) => Promise<void>;
}

export interface SaveRecordV5 {
  readonly slot: number;
  readonly version: number;
  readonly updatedAt: number;
  readonly bytes: number;
  readonly checksum: string;
}

export interface PersistenceOptionsV5 {
  readonly schema: string;
  readonly version: number;
  readonly maxSlots?: number;
  readonly maxBytes?: number;
  readonly now?: () => number;
  readonly adapter?: SaveAdapterV5;
}

export interface MigrationV5 {
  readonly from: number;
  readonly to: number;
  readonly migrate: (payload: unknown) => unknown;
}

const hash = (value: unknown): string => {
  const text = JSON.stringify(value);
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
};

export class MemorySaveAdapterV5<T> implements SaveAdapterV5<T> {
  #records = new Map<number, SaveEnvelopeV5<T>>();

  async write(slot: number, envelope: SaveEnvelopeV5<T>): Promise<void> { this.#records.set(slot, envelope); }
  async read(slot: number): Promise<SaveEnvelopeV5<T> | null> { return this.#records.get(slot) ?? null; }
  async list(): Promise<readonly SaveEnvelopeV5<T>[]> { return Object.freeze([...this.#records.values()].sort((a, b) => b.updatedAt - a.updatedAt)); }
  async remove(slot: number): Promise<void> { this.#records.delete(slot); }
}

export class PersistenceV5<T = unknown> {
  readonly schema: string;
  readonly version: number;
  readonly maxSlots: number;
  readonly maxBytes: number;
  #now: () => number;
  #adapter: SaveAdapterV5<T>;
  #migrations = new Map<number, MigrationV5>();
  #writeLocks = new Set<number>();

  constructor(options: PersistenceOptionsV5) {
    if (!options.schema.trim()) throw new Error('Persistence schema is required');
    if (!Number.isInteger(options.version) || options.version < 1) throw new Error('Persistence version must be positive');
    this.schema = options.schema;
    this.version = options.version;
    this.maxSlots = Math.max(1, Math.trunc(options.maxSlots ?? 16));
    this.maxBytes = Math.max(1024, Math.trunc(options.maxBytes ?? 8 * 1024 * 1024));
    this.#now = options.now ?? (() => performance.now());
    this.#adapter = options.adapter ?? new MemorySaveAdapterV5<T>();
  }

  registerMigration(migration: MigrationV5): void {
    if (migration.to !== migration.from + 1) throw new Error('Migrations must advance one schema version at a time');
    if (migration.from < 1 || migration.to > this.version) throw new Error('Migration is outside current schema');
    if (this.#migrations.has(migration.from)) throw new Error(`Migration already exists: ${migration.from}`);
    this.#migrations.set(migration.from, migration);
  }

  async save(slot: number, payload: T): Promise<OutcomeV4<SaveEnvelopeV5<T>>> {
    const valid = this.#validateSlot(slot);
    if (!valid.ok) return valid;
    if (this.#writeLocks.has(slot)) return failV4(createRuntimeErrorV4('SAVE_BUSY', 'Save slot is already being written', true));
    const bytes = this.#bytes(payload);
    if (bytes > this.maxBytes) return failV4(createRuntimeErrorV4('SAVE_TOO_LARGE', 'Save payload exceeds maximum size', false));
    this.#writeLocks.add(slot);
    try {
      const previous = await this.#adapter.read(slot);
      const now = this.#now();
      const envelopeCore = { schema: this.schema, version: this.version, slot, createdAt: previous?.createdAt ?? now, updatedAt: now, payload };
      const envelope = Object.freeze({ ...envelopeCore, checksum: hash(envelopeCore), bytes });
      await this.#adapter.write(slot, envelope);
      return okV4(envelope);
    } catch (cause) {
      return failV4(createRuntimeErrorV4('SAVE_WRITE_FAILED', cause instanceof Error ? cause.message.slice(0, 300) : 'Save write failed', true));
    } finally {
      this.#writeLocks.delete(slot);
    }
  }

  async load(slot: number): Promise<OutcomeV4<T | null>> {
    const valid = this.#validateSlot(slot);
    if (!valid.ok) return valid;
    try {
      const envelope = await this.#adapter.read(slot);
      if (!envelope) return okV4(null);
      if (envelope.schema !== this.schema) return failV4(createRuntimeErrorV4('SAVE_SCHEMA_MISMATCH', `Expected schema ${this.schema}`, false));
      if (this.#bytes(envelope.payload) !== envelope.bytes) return failV4(createRuntimeErrorV4('SAVE_BYTES_MISMATCH', 'Save size metadata mismatch', false));
      const core = { schema: envelope.schema, version: envelope.version, slot: envelope.slot, createdAt: envelope.createdAt, updatedAt: envelope.updatedAt, payload: envelope.payload };
      if (hash(core) !== envelope.checksum) return failV4(createRuntimeErrorV4('SAVE_CHECKSUM_MISMATCH', 'Save checksum mismatch', false));
      let payload: unknown = envelope.payload;
      for (let version = envelope.version; version < this.version; version += 1) {
        const migration = this.#migrations.get(version);
        if (!migration) return failV4(createRuntimeErrorV4('SAVE_MIGRATION_MISSING', `Missing migration ${version} -> ${version + 1}`, false));
        payload = migration.migrate(payload);
      }
      return okV4(payload as T);
    } catch (cause) {
      return failV4(createRuntimeErrorV4('SAVE_READ_FAILED', cause instanceof Error ? cause.message.slice(0, 300) : 'Save read failed', true));
    }
  }

  async list(): Promise<readonly SaveRecordV5[]> {
    const records = await this.#adapter.list();
    return Object.freeze(records.map((record) => Object.freeze({ slot: record.slot, version: record.version, updatedAt: record.updatedAt, bytes: record.bytes, checksum: record.checksum })));
  }

  async remove(slot: number): Promise<OutcomeV4<boolean>> {
    const valid = this.#validateSlot(slot);
    if (!valid.ok) return valid;
    try { await this.#adapter.remove(slot); return okV4(true); }
    catch (cause) { return failV4(createRuntimeErrorV4('SAVE_REMOVE_FAILED', cause instanceof Error ? cause.message.slice(0, 300) : 'Save remove failed', true)); }
  }

  async clone(slot: number, targetSlot: number): Promise<OutcomeV4<SaveEnvelopeV5<T>>> {
    const source = await this.load(slot);
    if (!source.ok || source.value === null) return source as OutcomeV4<SaveEnvelopeV5<T>>;
    return this.save(targetSlot, source.value);
  }

  async wipe(): Promise<number> {
    const records = await this.#adapter.list();
    await Promise.all(records.map((record) => this.#adapter.remove(record.slot)));
    return records.length;
  }

  bytes(payload: unknown): number { return this.#bytes(payload); }

  #bytes(payload: unknown): number { return new TextEncoder().encode(JSON.stringify(payload)).byteLength; }
  #validateSlot(slot: number): OutcomeV4<boolean> { return Number.isInteger(slot) && slot >= 0 && slot < this.maxSlots ? okV4(true) : failV4(createRuntimeErrorV4('SAVE_SLOT_INVALID', `Invalid save slot: ${slot}`, false)); }
}

export function createPersistenceV5<T>(schema: string, version: number): PersistenceV5<T> { return new PersistenceV5<T>({ schema, version }); }
