import { deterministicDigest } from '../runtime/deterministicClock.ts';
import { freeze, type PersistenceEnvelope, type Result, err, ok, unixMs } from '../domain/contracts.ts';

export interface StorageAdapter {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  clear?(): void;
}

export interface AsyncStorageAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface Migration<T> {
  readonly from: number;
  readonly to: number;
  readonly migrate: (value: unknown) => T;
}

export interface StorageResult<T> {
  readonly value: T;
  readonly migrated: boolean;
  readonly sourceSchema: number;
}

const json = (value: unknown): string => JSON.stringify(value);
const parse = (value: string): unknown => JSON.parse(value) as unknown;

export class VersionedStorage<T> {
  readonly #storage: StorageAdapter;
  readonly #key: string;
  readonly #schema: number;
  readonly #clock: () => number;
  readonly #migrations: readonly Migration<T>[];

  constructor(storage: StorageAdapter, key: string, schema: number, migrations: readonly Migration<T>[] = [], clock = () => Date.now()) {
    this.#storage = storage;
    this.#key = key;
    this.#schema = Math.max(1, Math.floor(schema));
    this.#clock = clock;
    this.#migrations = [...migrations].sort((a, b) => a.from - b.from);
  }

  save(value: T): Result<PersistenceEnvelope<T>> {
    try {
      const savedAt = unixMs(this.#clock());
      const envelope: PersistenceEnvelope<T> = freeze({ schema: this.#schema, savedAt, checksum: deterministicDigest(value), payload: value });
      this.#storage.set(this.#key, json(envelope));
      return ok(envelope);
    } catch (error) {
      return err({ code: 'STORAGE_WRITE_FAILED', message: error instanceof Error ? error.message : String(error) });
    }
  }

  load(): Result<StorageResult<T>> {
    const raw = this.#storage.get(this.#key);
    if (!raw) return err({ code: 'STORAGE_MISSING', message: `No data stored for ${this.#key}.` });
    try {
      const envelope = parse(raw) as Partial<PersistenceEnvelope<unknown>>;
      if (typeof envelope.schema !== 'number' || !('payload' in envelope)) {
        return err({ code: 'STORAGE_CORRUPT', message: 'Storage envelope is malformed.' });
      }
      const sourceSchema = Math.floor(envelope.schema);
      const checksum = deterministicDigest(envelope.payload);
      if (envelope.checksum !== checksum) return err({ code: 'STORAGE_CHECKSUM', message: 'Stored payload failed checksum validation.' });
      let value: unknown = envelope.payload;
      let migrated = false;
      let schema = sourceSchema;
      while (schema < this.#schema) {
        const migration = this.#migrations.find((candidate) => candidate.from === schema);
        if (!migration) return err({ code: 'STORAGE_MIGRATION_MISSING', message: `No migration exists from schema ${schema}.` });
        value = migration.migrate(value);
        schema = migration.to;
        migrated = true;
      }
      if (schema !== this.#schema) return err({ code: 'STORAGE_SCHEMA_UNSUPPORTED', message: `Cannot load schema ${sourceSchema} into ${this.#schema}.` });
      return ok({ value: value as T, migrated, sourceSchema });
    } catch (error) {
      return err({ code: 'STORAGE_READ_FAILED', message: error instanceof Error ? error.message : String(error) });
    }
  }

  remove(): void { this.#storage.remove(this.#key); }

  hasData(): boolean { return this.#storage.get(this.#key) !== null; }
}

export class MemoryStorage implements StorageAdapter {
  readonly #values = new Map<string, string>();
  get(key: string): string | null { return this.#values.get(key) ?? null; }
  set(key: string, value: string): void { this.#values.set(key, value); }
  remove(key: string): void { this.#values.delete(key); }
  clear(): void { this.#values.clear(); }
  size(): number { return this.#values.size; }
}

export const browserStorage = (): StorageAdapter => {
  if (typeof window === 'undefined' || !window.localStorage) return new MemoryStorage();
  return window.localStorage;
};

export const parseJsonSafe = <T>(value: string, fallback: T): T => {
  try { return JSON.parse(value) as T; } catch { return fallback; }
};

export const encodeBase64Url = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
};

export const decodeBase64Url = (value: string): string => {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(normalized);
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
};
