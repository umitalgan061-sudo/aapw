import type { Result, SaveEnvelope, SaveSlot, UnixMillis } from './types';
import { checksum, stableStringify } from './deterministic';

export interface PersistenceAdapter<T = unknown> {
  readonly save: (slot: number, envelope: SaveEnvelope<T>) => Promise<void>;
  readonly load: (slot: number) => Promise<SaveEnvelope<T> | null>;
  readonly list: () => Promise<readonly SaveSlot[]>;
  readonly remove: (slot: number) => Promise<void>;
}

export interface SaveSystemOptions<T> {
  readonly schema: string;
  readonly version: number;
  readonly maxSlots?: number;
  readonly now?: () => UnixMillis;
  readonly adapter?: PersistenceAdapter<T>;
}

const DEFAULT_MAX_SLOTS = 12;
const KEY_PREFIX = 'aapw.save.v2:';

function validateSlot(slot: number, maxSlots: number): void {
  if (!Number.isInteger(slot) || slot < 0 || slot >= maxSlots) throw new RangeError('Invalid save slot');
}

function createStorageAdapter<T>(maxSlots: number): PersistenceAdapter<T> {
  const local = typeof localStorage !== 'undefined' ? localStorage : null;
  return {
    async save(slot, envelope) {
      validateSlot(slot, maxSlots);
      if (!local) throw new Error('No local persistence backend available');
      local.setItem(KEY_PREFIX + slot, JSON.stringify(envelope));
    },
    async load(slot) {
      validateSlot(slot, maxSlots);
      if (!local) return null;
      const raw = local.getItem(KEY_PREFIX + slot);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') throw new Error('Corrupt save envelope');
      const envelope = parsed as SaveEnvelope<T>;
      if (typeof envelope.checksum !== 'string' || checksum(envelope.payload) !== envelope.checksum) throw new Error('Save checksum mismatch');
      return envelope;
    },
    async list() {
      if (!local) return [];
      const entries: SaveSlot[] = [];
      for (let slot = 0; slot < maxSlots; slot += 1) {
        const raw = local.getItem(KEY_PREFIX + slot);
        if (!raw) continue;
        try {
          const envelope = JSON.parse(raw) as SaveEnvelope<T>;
          entries.push({ slot, updatedAt: envelope.createdAt, playtimeMs: 0, checksum: envelope.checksum, summary: `${envelope.schema} v${envelope.version}` });
        } catch {
          // Corrupt slots remain addressable through load(), but do not pollute the picker.
        }
      }
      return entries.sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt));
    },
    async remove(slot) {
      validateSlot(slot, maxSlots);
      local?.removeItem(KEY_PREFIX + slot);
    },
  };
}

/** Versioned, checksummed persistence layer with schema migration hooks and atomic memory commit. */
export class SaveSystem<T> {
  readonly schema: string;
  readonly version: number;
  readonly maxSlots: number;
  #now: () => UnixMillis;
  #adapter: PersistenceAdapter<T>;
  #migrations = new Map<number, (payload: unknown) => unknown>();

  constructor(options: SaveSystemOptions<T>) {
    this.schema = options.schema;
    this.version = options.version;
    this.maxSlots = Math.max(1, Math.min(99, Math.floor(options.maxSlots ?? DEFAULT_MAX_SLOTS)));
    this.#now = options.now ?? (() => Date.now() as UnixMillis);
    this.#adapter = options.adapter ?? createStorageAdapter(this.maxSlots);
  }

  registerMigration(fromVersion: number, migrate: (payload: unknown) => unknown): this {
    if (!Number.isInteger(fromVersion) || fromVersion < 1 || fromVersion >= this.version) throw new RangeError('Migration version must precede current schema version');
    if (this.#migrations.has(fromVersion)) throw new Error(`Migration ${fromVersion} already registered`);
    this.#migrations.set(fromVersion, migrate);
    return this;
  }

  createEnvelope(payload: T): SaveEnvelope<T> {
    return { schema: this.schema, version: this.version, createdAt: this.#now(), checksum: checksum(payload), payload };
  }

  async save(slot: number, payload: T): Promise<Result<SaveEnvelope<T>>> {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.maxSlots) return { ok: false, error: { code: 'SAVE_SLOT_INVALID', message: 'Invalid save slot', retryable: false } };
    try {
      const envelope = this.createEnvelope(payload);
      await this.#adapter.save(slot, envelope);
      return { ok: true, value: envelope };
    } catch (cause) {
      return { ok: false, error: { code: 'SAVE_WRITE_FAILED', message: 'Unable to write save', retryable: true, cause } };
    }
  }

  async load(slot: number): Promise<Result<T | null>> {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.maxSlots) return { ok: false, error: { code: 'SAVE_SLOT_INVALID', message: 'Invalid save slot', retryable: false } };
    try {
      const envelope = await this.#adapter.load(slot);
      if (!envelope) return { ok: true, value: null };
      if (envelope.schema !== this.schema) return { ok: false, error: { code: 'SAVE_SCHEMA_MISMATCH', message: `Expected ${this.schema}`, retryable: false } };
      if (!Number.isInteger(envelope.version) || envelope.version < 1 || envelope.version > this.version) return { ok: false, error: { code: 'SAVE_VERSION_INVALID', message: 'Unsupported save version', retryable: false } };
      let payload: unknown = envelope.payload;
      for (let version = envelope.version; version < this.version; version += 1) {
        const migration = this.#migrations.get(version);
        if (!migration) return { ok: false, error: { code: 'SAVE_MIGRATION_MISSING', message: `Missing migration ${version} -> ${version + 1}`, retryable: false } };
        payload = migration(payload);
      }
      if (envelope.version === this.version && checksum(payload) !== envelope.checksum) return { ok: false, error: { code: 'SAVE_CHECKSUM_MISMATCH', message: 'Save payload checksum mismatch', retryable: false } };
      return { ok: true, value: payload as T };
    } catch (cause) {
      return { ok: false, error: { code: 'SAVE_READ_FAILED', message: 'Unable to read save', retryable: true, cause } };
    }
  }

  async list(): Promise<readonly SaveSlot[]> { return this.#adapter.list(); }
  async remove(slot: number): Promise<void> { validateSlot(slot, this.maxSlots); await this.#adapter.remove(slot); }
  static jsonSize(value: unknown): number { return new TextEncoder().encode(stableStringify(value)).byteLength; }
}
