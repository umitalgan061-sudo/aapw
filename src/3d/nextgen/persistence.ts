import type { Outcome } from './kernelTypes.ts';
import { fault, stableHash } from './kernelTypes.ts';

export interface StorageAdapter {
  readonly read: (key: string) => Promise<string | null> | string | null;
  readonly write: (key: string, value: string) => Promise<void> | void;
  readonly remove: (key: string) => Promise<void> | void;
}

export class MemoryStorage implements StorageAdapter {
  #values = new Map<string, string>();
  read(key: string): string | null { return this.#values.get(key) ?? null; }
  write(key: string, value: string): void { this.#values.set(key, value); }
  remove(key: string): void { this.#values.delete(key); }
}

export interface SaveEnvelope<T = unknown> {
  readonly schema: string;
  readonly version: number;
  readonly build: string;
  readonly tick: number;
  readonly payload: T;
  readonly checksum: string;
}

export interface SaveMigration {
  readonly from: number;
  readonly to: number;
  readonly migrate: (payload: unknown) => unknown;
}

export interface SavePolicy {
  readonly keyPrefix: string;
  readonly schema: string;
  readonly build: string;
  readonly currentVersion: number;
  readonly maxBytes: number;
}

export const DEFAULT_SAVE_POLICY: SavePolicy = Object.freeze({
  keyPrefix: 'aapw.r24.',
  schema: 'aapw-runtime-save',
  build: 'r24',
  currentVersion: 1,
  maxBytes: 2 * 1024 * 1024,
});

export class SaveRuntime {
  readonly policy: SavePolicy;
  readonly storage: StorageAdapter;
  #migrations = new Map<number, SaveMigration>();
  #disposed = false;

  constructor(storage: StorageAdapter, policy: SavePolicy = DEFAULT_SAVE_POLICY) {
    this.storage = storage;
    this.policy = Object.freeze({ ...policy });
  }

  registerMigration(migration: SaveMigration): void {
    if (migration.to !== migration.from + 1) throw new Error('Save migrations must be contiguous.');
    this.#migrations.set(migration.from, migration);
  }

  #envelope<T>(payload: T, tick: number, version = this.policy.currentVersion): SaveEnvelope<T> {
    const core = {
      schema: this.policy.schema,
      version,
      build: this.policy.build,
      tick: Math.max(0, Math.floor(tick)),
      payload,
    };
    return Object.freeze({ ...core, checksum: stableHash(core) });
  }

  validate<T>(envelope: SaveEnvelope<T>): Outcome<SaveEnvelope<T>> {
    if (envelope.schema !== this.policy.schema) return { ok: false, error: fault('checksum', 'Save schema mismatch.', true) };
    if (!Number.isSafeInteger(envelope.version) || envelope.version < 1 || envelope.version > this.policy.currentVersion) {
      return { ok: false, error: fault('invalid', 'Unsupported save version.', true, { version: envelope.version }) };
    }
    if (stableHash({
      schema: envelope.schema,
      version: envelope.version,
      build: envelope.build,
      tick: envelope.tick,
      payload: envelope.payload,
    }) !== envelope.checksum) {
      return { ok: false, error: fault('checksum', 'Save checksum mismatch.', false) };
    }
    return { ok: true, value: envelope };
  }

  async save<T>(slot: string, payload: T, tick: number): Promise<Outcome<SaveEnvelope<T>>> {
    if (this.#disposed) return { ok: false, error: fault('disposed', 'Save runtime is disposed.', false) };
    const envelope = this.#envelope(payload, tick);
    const serialized = JSON.stringify(envelope);
    if (serialized.length > this.policy.maxBytes) return { ok: false, error: fault('budget', 'Save payload exceeds size budget.', true, { bytes: serialized.length }) };
    await this.storage.write(this.policy.keyPrefix + slot, serialized);
    return { ok: true, value: envelope };
  }

  async load<T>(slot: string): Promise<Outcome<SaveEnvelope<T>>> {
    if (this.#disposed) return { ok: false, error: fault('disposed', 'Save runtime is disposed.', false) };
    const raw = await this.storage.read(this.policy.keyPrefix + slot);
    if (!raw) return { ok: false, error: fault('invalid', 'Save slot does not exist.', true, { slot }) };
    if (raw.length > this.policy.maxBytes) return { ok: false, error: fault('budget', 'Stored save exceeds size budget.', true) };
    let decoded: SaveEnvelope<unknown>;
    try { decoded = JSON.parse(raw) as SaveEnvelope<unknown>; }
    catch { return { ok: false, error: fault('checksum', 'Stored save is not valid JSON.', false) }; }

    const valid = this.validate(decoded);
    if (!valid.ok) return valid;
    let current = valid.value;
    while (current.version < this.policy.currentVersion) {
      const migration = this.#migrations.get(current.version);
      if (!migration) return { ok: false, error: fault('invalid', 'No migration exists for stored save version.', true, { version: current.version }) };
      const payload = migration.migrate(current.payload);
      current = this.#envelope(payload, current.tick, migration.to);
    }
    return { ok: true, value: current as SaveEnvelope<T> };
  }

  async remove(slot: string): Promise<void> {
    await this.storage.remove(this.policy.keyPrefix + slot);
  }

  async slots(): Promise<readonly string[]> {
    if (this.storage instanceof MemoryStorage) return [];
    return [];
  }

  dispose(): void { this.#disposed = true; this.#migrations.clear(); }
}
