import {
  RuntimeFault,
  cloneCanonical,
  isRecord,
  normalizeIdentifier,
  stableFingerprint,
  stableSerialize,
  type Outcome,
  fail,
  succeed,
} from "./contracts";

export interface StoredEnvelope {
  readonly key: string;
  readonly schemaVersion: number;
  readonly revision: number;
  readonly savedAtTick: number;
  readonly payload: string;
  readonly fingerprint: string;
}

export interface PersistenceAdapter {
  read(key: string): Promise<StoredEnvelope | null>;
  compareAndSwap(key: string, expectedRevision: number | null, next: StoredEnvelope): Promise<boolean>;
  remove?(key: string, expectedRevision?: number): Promise<boolean>;
}

export interface PersistenceMigration {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly migrate: (input: unknown) => unknown;
}

export interface PersistenceOptions {
  readonly schemaVersion: number;
  readonly maxPayloadBytes?: number;
  readonly maxKeyLength?: number;
  readonly maxRetries?: number;
  readonly maxMigrations?: number;
}

export interface SaveReceipt {
  readonly key: string;
  readonly revision: number;
  readonly schemaVersion: number;
  readonly bytes: number;
  readonly fingerprint: string;
  readonly attempts: number;
}

export interface LoadReceipt<T> {
  readonly key: string;
  readonly revision: number;
  readonly sourceSchemaVersion: number;
  readonly schemaVersion: number;
  readonly migrated: boolean;
  readonly value: T;
  readonly fingerprint: string;
}

export interface ImportOptions {
  readonly dryRun?: boolean;
  readonly overwrite?: boolean;
  readonly savedAtTick: number;
}

export interface ImportReceipt {
  readonly key: string;
  readonly imported: boolean;
  readonly dryRun: boolean;
  readonly revision: number | null;
  readonly fingerprint: string;
}

function validateTick(tick: number, operation: string): void {
  if (!Number.isSafeInteger(tick) || tick < 0) {
    throw new RuntimeFault("INVALID_INPUT", "Tick must be a non-negative safe integer", operation);
  }
}

function digestEnvelope(envelope: Omit<StoredEnvelope, "fingerprint">): string {
  return stableFingerprint({
    key: envelope.key,
    schemaVersion: envelope.schemaVersion,
    revision: envelope.revision,
    savedAtTick: envelope.savedAtTick,
    payload: envelope.payload,
  });
}

export class PersistenceCoordinator {
  readonly schemaVersion: number;
  readonly maxPayloadBytes: number;
  readonly maxKeyLength: number;
  readonly maxRetries: number;
  readonly maxMigrations: number;
  readonly #adapter: PersistenceAdapter;
  #migrations = new Map<number, PersistenceMigration>();
  #lastGood = new Map<string, { revision: number; value: unknown; fingerprint: string }>();

  constructor(adapter: PersistenceAdapter, options: PersistenceOptions) {
    this.#adapter = adapter;
    this.schemaVersion = options.schemaVersion;
    this.maxPayloadBytes = options.maxPayloadBytes ?? 1_000_000;
    this.maxKeyLength = options.maxKeyLength ?? 128;
    this.maxRetries = options.maxRetries ?? 3;
    this.maxMigrations = options.maxMigrations ?? 32;
    for (const [name, value, min, max] of [
      ["schemaVersion", this.schemaVersion, 1, 10_000],
      ["maxPayloadBytes", this.maxPayloadBytes, 128, 50_000_000],
      ["maxKeyLength", this.maxKeyLength, 8, 512],
      ["maxRetries", this.maxRetries, 1, 20],
      ["maxMigrations", this.maxMigrations, 1, 256],
    ] as const) {
      if (!Number.isInteger(value) || value < min || value > max) {
        throw new RuntimeFault("INVALID_INPUT", "Persistence configuration is invalid", "persistence.constructor", {
          details: { name, value },
        });
      }
    }
  }

  registerMigration(migration: PersistenceMigration): void {
    if (
      !Number.isInteger(migration.fromVersion) ||
      !Number.isInteger(migration.toVersion) ||
      migration.fromVersion < 1 ||
      migration.toVersion !== migration.fromVersion + 1 ||
      migration.toVersion > this.schemaVersion
    ) {
      throw new RuntimeFault("INVALID_INPUT", "Migrations must advance exactly one schema version", "persistence.registerMigration", {
        details: { from: migration.fromVersion, to: migration.toVersion },
      });
    }
    if (this.#migrations.has(migration.fromVersion)) {
      throw new RuntimeFault("CONFLICT", "Migration source version is already registered", "persistence.registerMigration", {
        details: { fromVersion: migration.fromVersion },
      });
    }
    this.#migrations.set(migration.fromVersion, Object.freeze({ ...migration }));
  }

  migrationPlan(fromVersion: number): readonly number[] {
    if (!Number.isInteger(fromVersion) || fromVersion < 1 || fromVersion > this.schemaVersion) {
      throw new RuntimeFault("INVALID_INPUT", "Source schema version is invalid", "persistence.migrationPlan");
    }
    const plan: number[] = [];
    let version = fromVersion;
    while (version < this.schemaVersion) {
      if (plan.length >= this.maxMigrations) {
        throw new RuntimeFault("CAPACITY_EXCEEDED", "Migration chain exceeds configured limit", "persistence.migrationPlan");
      }
      const migration = this.#migrations.get(version);
      if (!migration) {
        throw new RuntimeFault("UNAVAILABLE", "A required migration is not registered", "persistence.migrationPlan", {
          details: { missingFromVersion: version, targetVersion: this.schemaVersion },
        });
      }
      plan.push(version);
      version = migration.toVersion;
    }
    return Object.freeze(plan);
  }

  async save<T>(keyValue: string, value: T, savedAtTick: number): Promise<Outcome<SaveReceipt>> {
    const key = this.#normalizeKey(keyValue);
    validateTick(savedAtTick, "persistence.save");
    let payload: string;
    try {
      payload = stableSerialize(value);
    } catch (error) {
      return fail(error instanceof RuntimeFault ? error : new RuntimeFault("INVALID_INPUT", "Value cannot be serialized", "persistence.save"));
    }
    const bytes = new TextEncoder().encode(payload).byteLength;
    if (bytes > this.maxPayloadBytes) {
      return fail(new RuntimeFault("CAPACITY_EXCEEDED", "Serialized value exceeds the persistence budget", "persistence.save", {
        details: { bytes, maxPayloadBytes: this.maxPayloadBytes },
      }));
    }

    for (let attempt = 1; attempt <= this.maxRetries; attempt += 1) {
      let current: StoredEnvelope | null;
      try {
        current = await this.#adapter.read(key);
      } catch (error) {
        return fail(new RuntimeFault("STORAGE_FAILURE", "Unable to read current persistence revision", "persistence.save", {
          retryable: true, cause: error,
        }));
      }
      const revision = (current?.revision ?? 0) + 1;
      const envelopeBase = {
        key,
        schemaVersion: this.schemaVersion,
        revision,
        savedAtTick,
        payload,
      };
      const envelope: StoredEnvelope = Object.freeze({
        ...envelopeBase,
        fingerprint: digestEnvelope(envelopeBase),
      });
      try {
        const written = await this.#adapter.compareAndSwap(key, current?.revision ?? null, envelope);
        if (!written) continue;
      } catch (error) {
        return fail(new RuntimeFault("STORAGE_FAILURE", "Unable to commit persistence revision", "persistence.save", {
          retryable: true, cause: error,
        }));
      }
      const fingerprint = stableFingerprint(value);
      this.#rememberLastGood(key, revision, value, fingerprint);
      return succeed(Object.freeze({
        key, revision, schemaVersion: this.schemaVersion, bytes, fingerprint, attempts: attempt,
      }));
    }
    return fail(new RuntimeFault("CONFLICT", "Concurrent writes exceeded retry budget", "persistence.save", {
      retryable: true, details: { maxRetries: this.maxRetries },
    }));
  }

  async load<T>(
    keyValue: string,
    validate: (value: unknown) => value is T,
  ): Promise<Outcome<LoadReceipt<T>>> {
    const key = this.#normalizeKey(keyValue);
    let envelope: StoredEnvelope | null;
    try {
      envelope = await this.#adapter.read(key);
    } catch (error) {
      return fail(new RuntimeFault("STORAGE_FAILURE", "Unable to read persisted state", "persistence.load", {
        retryable: true, cause: error,
      }));
    }
    if (!envelope) return fail(new RuntimeFault("NOT_FOUND", "No saved state exists for this key", "persistence.load", { details: { key } }));
    if (!this.#verifyEnvelope(key, envelope)) {
      const fallback = this.#lastGood.get(key);
      if (fallback && validate(fallback.value)) {
        return succeed(Object.freeze({
          key,
          revision: fallback.revision,
          sourceSchemaVersion: envelope.schemaVersion,
          schemaVersion: this.schemaVersion,
          migrated: false,
          value: cloneCanonical(fallback.value) as T,
          fingerprint: fallback.fingerprint,
        }));
      }
      return fail(new RuntimeFault("INTEGRITY_FAILURE", "Saved state fingerprint did not match its envelope", "persistence.load", {
        details: { key, revision: envelope.revision },
      }));
    }
    if (envelope.schemaVersion > this.schemaVersion) {
      return fail(new RuntimeFault("UNAVAILABLE", "Saved state was created by a newer schema", "persistence.load", {
        details: { storedSchema: envelope.schemaVersion, supportedSchema: this.schemaVersion },
      }));
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(envelope.payload) as unknown;
    } catch (error) {
      return fail(new RuntimeFault("INTEGRITY_FAILURE", "Persisted JSON could not be parsed", "persistence.load", { cause: error }));
    }
    const sourceSchemaVersion = envelope.schemaVersion;
    if (sourceSchemaVersion < this.schemaVersion) {
      let version = sourceSchemaVersion;
      try {
        for (const migrationFrom of this.migrationPlan(sourceSchemaVersion)) {
          const migration = this.#migrations.get(migrationFrom);
          if (!migration) throw new RuntimeFault("UNAVAILABLE", "Migration disappeared", "persistence.load");
          decoded = migration.migrate(decoded);
          version = migration.toVersion;
        }
        if (version !== this.schemaVersion) {
          throw new RuntimeFault("INTEGRITY_FAILURE", "Migration chain did not reach the current schema", "persistence.load");
        }
      } catch (error) {
        return fail(error instanceof RuntimeFault ? error : new RuntimeFault("INTEGRITY_FAILURE", "State migration failed", "persistence.load", { cause: error }));
      }
    }
    if (!validate(decoded)) {
      return fail(new RuntimeFault("INTEGRITY_FAILURE", "Loaded state failed domain validation", "persistence.load", {
        details: { key, schemaVersion: this.schemaVersion },
      }));
    }
    const fingerprint = stableFingerprint(decoded);
    this.#rememberLastGood(key, envelope.revision, decoded, fingerprint);
    return succeed(Object.freeze({
      key,
      revision: envelope.revision,
      sourceSchemaVersion,
      schemaVersion: this.schemaVersion,
      migrated: sourceSchemaVersion !== this.schemaVersion,
      value: decoded,
      fingerprint,
    }));
  }

  async exportEnvelope(keyValue: string): Promise<Outcome<StoredEnvelope>> {
    const key = this.#normalizeKey(keyValue);
    try {
      const envelope = await this.#adapter.read(key);
      if (!envelope) return fail(new RuntimeFault("NOT_FOUND", "Cannot export a missing save", "persistence.export"));
      if (!this.#verifyEnvelope(key, envelope)) {
        return fail(new RuntimeFault("INTEGRITY_FAILURE", "Cannot export a corrupt save", "persistence.export"));
      }
      return succeed(Object.freeze({ ...envelope }));
    } catch (error) {
      return fail(new RuntimeFault("STORAGE_FAILURE", "Unable to export save", "persistence.export", { cause: error }));
    }
  }

  async importEnvelope(envelopeValue: unknown, options: ImportOptions): Promise<Outcome<ImportReceipt>> {
    let envelope: StoredEnvelope;
    try {
      if (!isRecord(envelopeValue)) throw new RuntimeFault("INVALID_INPUT", "Envelope must be an object", "persistence.import");
      const { key, schemaVersion, revision, savedAtTick, payload, fingerprint } = envelopeValue;
      if (
        typeof key !== "string" ||
        typeof payload !== "string" ||
        typeof fingerprint !== "string" ||
        typeof schemaVersion !== "number" ||
        typeof revision !== "number" ||
        typeof savedAtTick !== "number"
      ) {
        throw new RuntimeFault("INVALID_INPUT", "Envelope fields are malformed", "persistence.import");
      }
      envelope = { key: this.#normalizeKey(key), schemaVersion, revision, savedAtTick, payload, fingerprint };
      validateTick(options.savedAtTick, "persistence.import");
      if (
        !Number.isInteger(envelope.schemaVersion) ||
        envelope.schemaVersion < 1 ||
        envelope.schemaVersion > this.schemaVersion ||
        !Number.isSafeInteger(envelope.revision) ||
        envelope.revision < 1 ||
        !Number.isSafeInteger(envelope.savedAtTick) ||
        envelope.savedAtTick < 0 ||
        new TextEncoder().encode(envelope.payload).byteLength > this.maxPayloadBytes ||
        !this.#verifyEnvelope(envelope.key, envelope)
      ) {
        throw new RuntimeFault("INTEGRITY_FAILURE", "Import envelope failed integrity checks", "persistence.import");
      }
    } catch (error) {
      return fail(error instanceof RuntimeFault ? error : new RuntimeFault("INVALID_INPUT", "Import envelope is invalid", "persistence.import", { cause: error }));
    }
    try {
      const current = await this.#adapter.read(envelope.key);
      if (current && options.overwrite !== true) {
        return fail(new RuntimeFault("CONFLICT", "Import target already exists", "persistence.import", { details: { key: envelope.key } }));
      }
      if (options.dryRun === true) {
        return succeed(Object.freeze({
          key: envelope.key, imported: false, dryRun: true, revision: current?.revision ?? null, fingerprint: envelope.fingerprint,
        }));
      }
      const next: StoredEnvelope = Object.freeze({
        ...envelope,
        revision: (current?.revision ?? 0) + 1,
        savedAtTick: options.savedAtTick,
      });
      const base = {
        key: next.key,
        schemaVersion: next.schemaVersion,
        revision: next.revision,
        savedAtTick: next.savedAtTick,
        payload: next.payload,
      };
      const committed = Object.freeze({ ...base, fingerprint: digestEnvelope(base) });
      const written = await this.#adapter.compareAndSwap(envelope.key, current?.revision ?? null, committed);
      if (!written) return fail(new RuntimeFault("CONFLICT", "Import target changed while importing", "persistence.import", { retryable: true }));
      this.#lastGood.delete(envelope.key);
      return succeed(Object.freeze({
        key: envelope.key, imported: true, dryRun: false, revision: committed.revision, fingerprint: committed.fingerprint,
      }));
    } catch (error) {
      return fail(new RuntimeFault("STORAGE_FAILURE", "Import could not be committed", "persistence.import", { retryable: true, cause: error }));
    }
  }

  async remove(keyValue: string): Promise<Outcome<boolean>> {
    const key = this.#normalizeKey(keyValue);
    if (!this.#adapter.remove) return fail(new RuntimeFault("UNAVAILABLE", "Adapter does not support remove", "persistence.remove"));
    try {
      const current = await this.#adapter.read(key);
      if (!current) return succeed(false);
      const removed = await this.#adapter.remove(key, current.revision);
      if (removed) this.#lastGood.delete(key);
      return succeed(removed);
    } catch (error) {
      return fail(new RuntimeFault("STORAGE_FAILURE", "Unable to remove persisted state", "persistence.remove", { cause: error }));
    }
  }

  #normalizeKey(value: string): string {
    const key = normalizeIdentifier(value, "persistence.key");
    if (key.length > this.maxKeyLength) {
      throw new RuntimeFault("INVALID_INPUT", "Persistence key exceeds configured length", "persistence.key");
    }
    return key;
  }

  #verifyEnvelope(expectedKey: string, envelope: StoredEnvelope): boolean {
    if (envelope.key !== expectedKey || !Number.isInteger(envelope.schemaVersion) || !Number.isInteger(envelope.revision)) return false;
    return digestEnvelope({
      key: envelope.key,
      schemaVersion: envelope.schemaVersion,
      revision: envelope.revision,
      savedAtTick: envelope.savedAtTick,
      payload: envelope.payload,
    }) === envelope.fingerprint;
  }

  #rememberLastGood(key: string, revision: number, value: unknown, fingerprint: string): void {
    if (this.#lastGood.size >= 256 && !this.#lastGood.has(key)) {
      const oldest = this.#lastGood.keys().next().value;
      if (oldest !== undefined) this.#lastGood.delete(oldest);
    }
    this.#lastGood.set(key, { revision, value: cloneCanonical(value), fingerprint });
  }
}

export class MemoryPersistenceAdapter implements PersistenceAdapter {
  readonly maxKeys: number;
  readonly maxBytes: number;
  #entries = new Map<string, StoredEnvelope>();
  #bytes = 0;

  constructor(options: { maxKeys?: number; maxBytes?: number } = {}) {
    this.maxKeys = options.maxKeys ?? 256;
    this.maxBytes = options.maxBytes ?? 20_000_000;
    if (!Number.isInteger(this.maxKeys) || this.maxKeys < 1 || !Number.isInteger(this.maxBytes) || this.maxBytes < 128) {
      throw new RuntimeFault("INVALID_INPUT", "Memory adapter capacity is invalid", "memoryPersistence.constructor");
    }
  }

  async read(key: string): Promise<StoredEnvelope | null> {
    const envelope = this.#entries.get(key);
    return envelope ? Object.freeze({ ...envelope }) : null;
  }

  async compareAndSwap(key: string, expectedRevision: number | null, next: StoredEnvelope): Promise<boolean> {
    const current = this.#entries.get(key);
    if ((current?.revision ?? null) !== expectedRevision) return false;
    if (next.key !== key || next.revision !== (expectedRevision ?? 0) + 1) {
      throw new RuntimeFault("INVALID_INPUT", "Envelope revision does not follow the compare-and-swap contract", "memoryPersistence.compareAndSwap");
    }
    const previousBytes = current ? new TextEncoder().encode(stableSerialize(current)).byteLength : 0;
    const nextBytes = new TextEncoder().encode(stableSerialize(next)).byteLength;
    if (!current && this.#entries.size >= this.maxKeys) {
      throw new RuntimeFault("CAPACITY_EXCEEDED", "Memory save key capacity is full", "memoryPersistence.compareAndSwap");
    }
    if (this.#bytes - previousBytes + nextBytes > this.maxBytes) {
      throw new RuntimeFault("CAPACITY_EXCEEDED", "Memory persistence byte capacity is full", "memoryPersistence.compareAndSwap");
    }
    this.#entries.set(key, Object.freeze({ ...next }));
    this.#bytes = this.#bytes - previousBytes + nextBytes;
    return true;
  }

  async remove(key: string, expectedRevision?: number): Promise<boolean> {
    const current = this.#entries.get(key);
    if (!current || (expectedRevision !== undefined && current.revision !== expectedRevision)) return false;
    this.#entries.delete(key);
    this.#bytes -= new TextEncoder().encode(stableSerialize(current)).byteLength;
    return true;
  }

  stats(): Readonly<{ keys: number; bytes: number; maxKeys: number; maxBytes: number }> {
    return Object.freeze({ keys: this.#entries.size, bytes: this.#bytes, maxKeys: this.maxKeys, maxBytes: this.maxBytes });
  }

  corruptForTest(key: string, mutate: (envelope: StoredEnvelope) => StoredEnvelope): boolean {
    const current = this.#entries.get(key);
    if (!current) return false;
    this.#entries.set(key, Object.freeze(mutate({ ...current })));
    return true;
  }
}
