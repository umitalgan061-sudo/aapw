import { SaveEnvelopeV7, SaveSlotSummaryV7, ContentHashV7, RevisionV7, TickV7, hashV7, revisionV7, tickV7 } from './types.ts';
import { checksumV7, stableStringifyV7 } from './deterministic.ts';

export interface SaveMigrationV7 {
  readonly fromSchema: number;
  readonly toSchema: number;
  readonly id: string;
  readonly migrate: (payload: unknown) => unknown;
}

export interface SaveStorageV7 {
  read(key: string): string | undefined;
  write(key: string, value: string): void;
  remove(key: string): void;
  keys(prefix: string): readonly string[];
}

export class MemorySaveStorageV7 implements SaveStorageV7 {
  readonly #values = new Map<string, string>();
  read(key: string): string | undefined { return this.#values.get(key); }
  write(key: string, value: string): void { this.#values.set(key, value); }
  remove(key: string): void { this.#values.delete(key); }
  keys(prefix: string): readonly string[] { return Object.freeze([...this.#values.keys()].filter((key) => key.startsWith(prefix)).sort()); }
}

export interface SaveManagerConfigV7 {
  readonly prefix: string;
  readonly slots: number;
  readonly maxBytes: number;
  readonly schema: number;
}

const envelopeChecksum = <T>(envelope: Omit<SaveEnvelopeV7<T>, 'checksum'>): ContentHashV7 => checksumV7(envelope);

export function createSaveEnvelopeV7<T>(slot: number, tick: TickV7, revision: RevisionV7, payload: T, migrations: readonly string[] = []): SaveEnvelopeV7<T> {
  const base = {
    schema: 7 as const,
    slot: Math.max(0, Math.trunc(slot)),
    createdAtIso: new Date(0).toISOString(),
    tick,
    revision,
    payload,
    migrations: Object.freeze([...migrations]),
  };
  return Object.freeze({ ...base, checksum: envelopeChecksum(base) });
}

export class SaveManagerV7<T> {
  readonly #storage: SaveStorageV7;
  readonly #config: SaveManagerConfigV7;
  readonly #migrations: SaveMigrationV7[];

  constructor(storage: SaveStorageV7, config: Partial<SaveManagerConfigV7> = {}, migrations: readonly SaveMigrationV7[] = []) {
    this.#storage = storage;
    this.#config = Object.freeze({ prefix: 'aapw:v7:save:', slots: 8, maxBytes: 8 * 1024 * 1024, schema: 7, ...config });
    if (this.#config.slots <= 0 || this.#config.maxBytes < 1024) throw new RangeError('Invalid save configuration');
    this.#migrations = [...migrations].sort((a, b) => a.fromSchema - b.fromSchema || a.toSchema - b.toSchema || a.id.localeCompare(b.id));
  }

  save(slot: number, tick: TickV7, revision: RevisionV7, payload: T, migrations: readonly string[] = []): SaveEnvelopeV7<T> {
    const normalized = Math.max(0, Math.min(this.#config.slots - 1, Math.trunc(slot)));
    const envelope = createSaveEnvelopeV7(normalized, tick, revision, payload, migrations);
    const raw = JSON.stringify(envelope);
    if (new TextEncoder().encode(raw).byteLength > this.#config.maxBytes) throw new RangeError('Save exceeds configured byte budget');
    this.#storage.write(this.#key(normalized), raw);
    return envelope;
  }

  load(slot: number): SaveEnvelopeV7<T> | undefined {
    const normalized = Math.max(0, Math.min(this.#config.slots - 1, Math.trunc(slot)));
    const raw = this.#storage.read(this.#key(normalized));
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    const migrated = this.#migrate(parsed);
    if (!this.#valid(migrated)) throw new Error('Invalid or tampered save payload');
    return migrated as SaveEnvelopeV7<T>;
  }

  remove(slot: number): boolean {
    const normalized = Math.max(0, Math.min(this.#config.slots - 1, Math.trunc(slot)));
    const key = this.#key(normalized);
    const existed = this.#storage.read(key) !== undefined;
    this.#storage.remove(key);
    return existed;
  }

  list(): readonly SaveSlotSummaryV7[] {
    const result: SaveSlotSummaryV7[] = [];
    for (let slot = 0; slot < this.#config.slots; slot += 1) {
      const envelope = this.load(slot);
      result.push(Object.freeze({
        slot, exists: envelope !== undefined, schema: envelope?.schema ?? null,
        tick: envelope?.tick ?? null, revision: envelope?.revision ?? null,
        bytes: envelope ? new TextEncoder().encode(JSON.stringify(envelope)).byteLength : 0,
        checksum: envelope?.checksum ?? null,
      }));
    }
    return Object.freeze(result);
  }

  #key(slot: number): string { return `${this.#config.prefix}${slot}`; }

  #migrate(value: unknown): unknown {
    let current = value as Record<string, unknown>;
    let changed = false;
    const migrations: string[] = Array.isArray(current.migrations) ? current.migrations.filter((item): item is string => typeof item === 'string') : [];
    while (Number(current.schema) < this.#config.schema) {
      const migration = this.#migrations.find((candidate) => candidate.fromSchema === Number(current.schema));
      if (!migration) throw new Error(`Missing save migration from schema ${String(current.schema)}`);
      current = { ...current, schema: migration.toSchema, payload: migration.migrate(current.payload), migrations: [...migrations, migration.id] };
      changed = true;
      if (migration.toSchema <= migration.fromSchema) throw new Error('Save migration must advance schema');
    }
    if (changed) current.migrations = Object.freeze([...(current.migrations as string[])]);
    return current;
  }

  #valid(value: unknown): value is SaveEnvelopeV7<T> {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Record<string, unknown>;
    if (candidate.schema !== 7 || typeof candidate.checksum !== 'string' || typeof candidate.payload === 'undefined') return false;
    const { checksum: _checksum, ...withoutChecksum } = candidate;
    return checksumV7(withoutChecksum) === candidate.checksum;
  }
}
