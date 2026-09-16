import type { Disposable, EngineResult } from './types.js';
import { hashTuple, toHex32 } from './deterministic.js';

export interface SaveEnvelope<T> {
  readonly schema: string;
  readonly version: number;
  readonly createdAt: number;
  readonly checksum: string;
  readonly payload: T;
}
export interface SaveSlotInfo { readonly slot: number; readonly version: number; readonly createdAt: number; readonly checksum: string; readonly bytes: number; readonly summary: string; }
export interface StorageAdapter { save(key: string, value: string): Promise<void>; load(key: string): Promise<string | null>; remove(key: string): Promise<void>; list(prefix: string): Promise<readonly string[]>; }
export interface SaveRuntimeOptions<T> { readonly schema: string; readonly version: number; readonly maxSlots?: number; readonly now?: () => number; readonly storage?: StorageAdapter; readonly migrations?: ReadonlyMap<number, (payload: unknown) => unknown>; readonly maxBytes?: number; }

const memoryStorage = (): StorageAdapter => {
  const values = new Map<string, string>();
  return {
    async save(key, value) { values.set(key, value); },
    async load(key) { return values.get(key) ?? null; },
    async remove(key) { values.delete(key); },
    async list(prefix) { return Object.freeze([...values.keys()].filter(key => key.startsWith(prefix)).sort()); },
  };
};

function checksum(value: unknown): string {
  const text = JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? `${item}n` : item);
  return toHex32(hashTuple(text.length, ...text.slice(0, 8192).split('').map(char => char.charCodeAt(0))));
}
function validateSlot(slot: number, maxSlots: number): boolean { return Number.isInteger(slot) && slot >= 0 && slot < maxSlots; }

export class PersistenceRuntime<T> implements Disposable {
  readonly schema: string;
  readonly version: number;
  readonly maxSlots: number;
  readonly maxBytes: number;
  #now: () => number;
  #storage: StorageAdapter;
  #migrations: Map<number, (payload: unknown) => unknown>;
  #disposed = false;

  constructor(options: SaveRuntimeOptions<T>) {
    this.schema = options.schema;
    this.version = Math.max(1, Math.trunc(options.version));
    this.maxSlots = Math.max(1, Math.min(99, Math.trunc(options.maxSlots ?? 12)));
    this.maxBytes = Math.max(1024, Math.trunc(options.maxBytes ?? 8 * 1024 * 1024));
    this.#now = options.now ?? (() => Date.now());
    this.#storage = options.storage ?? this.#browserStorage() ?? memoryStorage();
    this.#migrations = new Map(options.migrations ?? []);
  }

  async save(slot: number, payload: T, summary = ''): Promise<EngineResult<SaveEnvelope<T>>> {
    if (this.#disposed) return this.fail('SAVE_DISPOSED');
    if (!validateSlot(slot, this.maxSlots)) return this.fail('SAVE_SLOT_INVALID');
    const envelope: SaveEnvelope<T> = Object.freeze({ schema: this.schema, version: this.version, createdAt: this.#now(), checksum: checksum(payload), payload });
    const serialized = JSON.stringify(envelope);
    if (serialized.length > this.maxBytes) return this.fail('SAVE_TOO_LARGE');
    try { await this.#storage.save(this.#key(slot), serialized); return { ok: true, value: envelope }; }
    catch (cause) { return { ok: false, meta: { status: 'error', code: 'SAVE_WRITE_FAILED', cause } }; }
    void summary;
  }

  async load(slot: number): Promise<EngineResult<T | null>> {
    if (this.#disposed) return this.fail('SAVE_DISPOSED');
    if (!validateSlot(slot, this.maxSlots)) return this.fail('SAVE_SLOT_INVALID');
    try {
      const raw = await this.#storage.load(this.#key(slot));
      if (!raw) return { ok: true, value: null };
      if (raw.length > this.maxBytes) return this.fail('SAVE_TOO_LARGE');
      const envelope = JSON.parse(raw) as SaveEnvelope<T>;
      if (!envelope || envelope.schema !== this.schema) return this.fail('SAVE_SCHEMA_MISMATCH');
      if (!Number.isInteger(envelope.version) || envelope.version < 1 || envelope.version > this.version) return this.fail('SAVE_VERSION_INVALID');
      if (envelope.version === this.version && checksum(envelope.payload) !== envelope.checksum) return this.fail('SAVE_CHECKSUM_MISMATCH');
      let payload: unknown = envelope.payload;
      for (let version = envelope.version; version < this.version; version += 1) {
        const migrate = this.#migrations.get(version);
        if (!migrate) return this.fail('SAVE_MIGRATION_MISSING');
        payload = migrate(payload);
      }
      return { ok: true, value: payload as T };
    } catch (cause) { return { ok: false, meta: { status: 'error', code: 'SAVE_READ_FAILED', cause } }; }
  }

  async list(): Promise<readonly SaveSlotInfo[]> {
    if (this.#disposed) return [];
    const keys = await this.#storage.list(this.#prefix());
    const entries: SaveSlotInfo[] = [];
    for (const key of keys) {
      const slotText = key.slice(this.#prefix().length);
      const slot = Number(slotText);
      if (!validateSlot(slot, this.maxSlots)) continue;
      const raw = await this.#storage.load(key);
      if (!raw) continue;
      try {
        const envelope = JSON.parse(raw) as SaveEnvelope<T>;
        entries.push(Object.freeze({ slot, version: envelope.version, createdAt: envelope.createdAt, checksum: envelope.checksum, bytes: raw.length, summary: `${this.schema}@${envelope.version}` }));
      } catch { /* ignore corrupt index entry; load reports corruption */ }
    }
    return Object.freeze(entries.sort((a, b) => b.createdAt - a.createdAt || a.slot - b.slot));
  }

  async remove(slot: number): Promise<EngineResult<void>> {
    if (!validateSlot(slot, this.maxSlots)) return this.fail('SAVE_SLOT_INVALID');
    try { await this.#storage.remove(this.#key(slot)); return { ok: true, meta: { status: 'ok', code: 'SAVE_REMOVED' } }; }
    catch (cause) { return { ok: false, meta: { status: 'error', code: 'SAVE_REMOVE_FAILED', cause } }; }
  }

  registerMigration(fromVersion: number, migration: (payload: unknown) => unknown): boolean {
    if (!Number.isInteger(fromVersion) || fromVersion < 1 || fromVersion >= this.version || this.#migrations.has(fromVersion)) return false;
    this.#migrations.set(fromVersion, migration);
    return true;
  }

  dispose(): void { this.#disposed = true; }

  #prefix(): string { return `aapw.engine.save:${this.schema}:`; }
  #key(slot: number): string { return `${this.#prefix()}${slot}`; }
  #fail<V>(code: string): EngineResult<V> { return { ok: false, meta: { status: 'rejected', code } }; }
  #browserStorage(): StorageAdapter | null {
    if (typeof localStorage === 'undefined') return null;
    return {
      async save(key, value) { localStorage.setItem(key, value); },
      async load(key) { return localStorage.getItem(key); },
      async remove(key) { localStorage.removeItem(key); },
      async list(prefix) { const keys: string[] = []; for (let i = 0; i < localStorage.length; i += 1) { const key = localStorage.key(i); if (key?.startsWith(prefix)) keys.push(key); } return keys.sort(); },
    };
  }
}
