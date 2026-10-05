import { stableDigest, type Result, type RuntimeSnapshot, type SaveEnvelope } from './contracts.ts';

export interface SaveStorage {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export class MemorySaveStorage implements SaveStorage {
  #values = new Map<string, string>();

  async read(key: string): Promise<string | null> {
    return this.#values.get(key) ?? null;
  }

  async write(key: string, value: string): Promise<void> {
    this.#values.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.#values.delete(key);
  }

  clear(): void {
    this.#values.clear();
  }
}

export interface SaveMigration<T> {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly migrate: (value: T) => T;
}

export class SaveMigrationRegistry<T> {
  #migrations = new Map<number, SaveMigration<T>>();

  add(migration: SaveMigration<T>): void {
    if (migration.toVersion !== migration.fromVersion + 1) throw new Error('Save migrations must be single-step');
    if (this.#migrations.has(migration.fromVersion)) throw new Error('Duplicate save migration: ' + migration.fromVersion);
    this.#migrations.set(migration.fromVersion, migration);
  }

  migrate(value: T, fromVersion: number, targetVersion: number): T {
    let version = fromVersion;
    let current = value;
    while (version < targetVersion) {
      const migration = this.#migrations.get(version);
      if (!migration) throw new Error('Missing save migration from version ' + version);
      current = migration.migrate(current);
      version = migration.toVersion;
    }
    if (version !== targetVersion) throw new Error('Unsupported save migration path');
    return current;
  }

  versions(): readonly number[] {
    return Object.freeze([...this.#migrations.keys()].sort((a, b) => a - b));
  }
}

export interface EncodedSave {
  readonly json: string;
  readonly checksum: string;
  readonly bytes: number;
}

export class SaveCodec<T> {
  readonly schema: string;
  readonly version: number;
  readonly maxBytes: number;
  readonly migrations: SaveMigrationRegistry<T>;

  constructor(options: { readonly schema: string; readonly version: number; readonly maxBytes?: number; readonly migrations?: SaveMigrationRegistry<T> }) {
    this.schema = String(options.schema);
    this.version = Math.max(1, Math.trunc(options.version));
    this.maxBytes = Math.max(1024, Math.trunc(options.maxBytes ?? 8 * 1024 * 1024));
    this.migrations = options.migrations ?? new SaveMigrationRegistry<T>();
  }

  encode(payload: T, tick: number): Result<EncodedSave> {
    const envelope: SaveEnvelope<T> = Object.freeze({
      schema: this.schema,
      version: this.version,
      createdAtTick: Math.max(0, Math.trunc(tick)),
      checksum: stableDigest(payload),
      payload,
    });
    const json = JSON.stringify(envelope);
    const bytes = new TextEncoder().encode(json).byteLength;
    if (bytes > this.maxBytes) {
      return { ok: false, error: { code: 'SAVE_SIZE_LIMIT', message: 'Save exceeds configured size budget.', retryable: false } };
    }
    return { ok: true, value: Object.freeze({ json, checksum: envelope.checksum, bytes }) };
  }

  decode(json: string): Result<SaveEnvelope<T>> {
    try {
      const bytes = new TextEncoder().encode(json).byteLength;
      if (bytes > this.maxBytes) return { ok: false, error: { code: 'SAVE_SIZE_LIMIT', message: 'Save exceeds configured size budget.', retryable: false } };
      const parsed = JSON.parse(json) as SaveEnvelope<T>;
      if (!parsed || parsed.schema !== this.schema) return { ok: false, error: { code: 'SAVE_SCHEMA_MISMATCH', message: 'Save schema mismatch.', retryable: false } };
      if (stableDigest(parsed.payload) !== parsed.checksum) {
        return { ok: false, error: { code: 'SAVE_CHECKSUM_MISMATCH', message: 'Save integrity check failed.', retryable: false } };
      }
      let payload = parsed.payload;
      if (parsed.version < this.version) payload = this.migrations.migrate(payload, parsed.version, this.version);
      return {
        ok: true,
        value: Object.freeze({
          ...parsed,
          version: this.version,
          checksum: stableDigest(payload),
          payload,
        }),
      };
    } catch (cause) {
      return { ok: false, error: { code: 'SAVE_DECODE_FAILED', message: String(cause), retryable: false, cause } };
    }
  }
}

export class CheckpointStore {
  readonly capacity: number;
  #snapshots: RuntimeSnapshot[] = [];

  constructor(capacity = 32) {
    this.capacity = Math.max(4, Math.trunc(capacity));
  }

  push(snapshot: RuntimeSnapshot): void {
    this.#snapshots.push(snapshot);
    while (this.#snapshots.length > this.capacity) this.#snapshots.shift();
  }

  latest(): RuntimeSnapshot | undefined {
    return this.#snapshots[this.#snapshots.length - 1];
  }

  atOrBefore(tick: number): RuntimeSnapshot | undefined {
    return [...this.#snapshots].reverse().find((snapshot) => snapshot.tick <= tick);
  }

  values(): readonly RuntimeSnapshot[] {
    return Object.freeze([...this.#snapshots]);
  }

  clear(): void {
    this.#snapshots = [];
  }
}

export class RuntimeSaveManager<T> {
  readonly codec: SaveCodec<T>;
  readonly storage: SaveStorage;
  readonly key: string;

  constructor(codec: SaveCodec<T>, storage: SaveStorage, key: string) {
    this.codec = codec;
    this.storage = storage;
    this.key = key;
  }

  async save(payload: T, tick: number): Promise<Result<EncodedSave>> {
    const encoded = this.codec.encode(payload, tick);
    if (!encoded.ok || !encoded.value) return encoded;
    await this.storage.write(this.key, encoded.value.json);
    return encoded;
  }

  async load(): Promise<Result<SaveEnvelope<T> | null>> {
    const json = await this.storage.read(this.key);
    if (!json) return { ok: true, value: null };
    return this.codec.decode(json);
  }

  async clear(): Promise<void> {
    await this.storage.remove(this.key);
  }
}
