import {
  type SaveMigration,
  type SaveRecord,
  type WorldSnapshot,
} from './coreContracts';
import { hashObject32, stableStringify } from './deterministicKernel';

export interface SaveHeader {
  readonly magic: 'AAPW-V3';
  readonly format: 3;
  readonly schema: number;
  readonly revision: number;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly playtimeMs: number;
  readonly checksum: string;
}

export interface SaveEnvelope<T> {
  readonly header: SaveHeader;
  readonly payload: T;
}

export interface SaveValidation {
  readonly ok: boolean;
  readonly reason?: 'invalid-json' | 'invalid-header' | 'checksum-mismatch' | 'schema-too-new' | 'payload-invalid';
  readonly header?: SaveHeader;
}

export interface SaveCodec<T> {
  readonly schema: number;
  encode(value: T): string;
  decode(serialized: string): T;
  checksum(value: T): string;
  validate(value: unknown): value is T;
}

export function createJsonCodec<T>(options: {
  readonly schema: number;
  readonly validate: (value: unknown) => value is T;
  readonly canonicalize?: (value: T) => unknown;
}): SaveCodec<T> {
  const canonicalize = options.canonicalize ?? ((value: T) => value);
  return {
    schema: options.schema,
    encode(value: T): string {
      if (!options.validate(value)) throw new Error('cannot encode invalid save payload');
      return stableStringify(canonicalize(value));
    },
    decode(serialized: string): T {
      let parsed: unknown;
      try {
        parsed = JSON.parse(serialized);
      } catch {
        throw new Error('invalid save JSON');
      }
      if (!options.validate(parsed)) throw new Error('invalid save payload');
      return structuredClone(parsed);
    },
    checksum(value: T): string {
      return hashObject32(canonicalize(value)).toString(16).padStart(8, '0');
    },
    validate: options.validate,
  };
}

export class SaveMigrationRegistry<T> {
  #migrations = new Map<number, SaveMigration<any, any>>();
  #latest: number;

  constructor(latestSchema: number) {
    this.#latest = latestSchema;
  }

  add<TFrom, TTo>(migration: SaveMigration<TFrom, TTo>): void {
    if (migration.to !== migration.from + 1) throw new Error('save migrations must be contiguous');
    if (this.#migrations.has(migration.from)) throw new Error(`duplicate migration from schema ${migration.from}`);
    this.#migrations.set(migration.from, migration as SaveMigration<any, any>);
  }

  migrate(value: unknown, fromSchema: number): unknown {
    if (fromSchema > this.#latest) throw new Error('save schema is newer than this runtime');
    let current = value;
    for (let schema = fromSchema; schema < this.#latest; schema += 1) {
      const migration = this.#migrations.get(schema);
      if (!migration) throw new Error(`missing migration from schema ${schema}`);
      current = migration.migrate(current);
    }
    return current;
  }

  latest(): number {
    return this.#latest;
  }
}

export function createSaveEnvelope<T>(options: {
  readonly payload: T;
  readonly codec: SaveCodec<T>;
  readonly revision: number;
  readonly playtimeMs: number;
  readonly nowMs?: number;
  readonly createdAtMs?: number;
}): SaveEnvelope<T> {
  const now = options.nowMs ?? Date.now();
  const created = options.createdAtMs ?? now;
  return {
    header: {
      magic: 'AAPW-V3',
      format: 3,
      schema: options.codec.schema,
      revision: Math.max(0, Math.trunc(options.revision)),
      createdAtMs: Math.max(0, Math.trunc(created)),
      updatedAtMs: Math.max(0, Math.trunc(now)),
      playtimeMs: Math.max(0, options.playtimeMs),
      checksum: options.codec.checksum(options.payload),
    },
    payload: structuredClone(options.payload),
  };
}

export function serializeSave<T>(envelope: SaveEnvelope<T>, codec: SaveCodec<T>): string {
  if (!codec.validate(envelope.payload)) throw new Error('save payload failed validation');
  const expected = codec.checksum(envelope.payload);
  if (expected !== envelope.header.checksum) throw new Error('save checksum mismatch before serialization');
  return stableStringify(envelope);
}

export function validateSerializedSave<T>(serialized: string, codec: SaveCodec<T>, latestSchema = codec.schema): SaveValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return { ok: false, reason: 'invalid-json' };
  }
  if (typeof parsed !== 'object' || parsed === null) return { ok: false, reason: 'invalid-header' };
  const object = parsed as { header?: unknown; payload?: unknown };
  const header = object.header;
  if (typeof header !== 'object' || header === null) return { ok: false, reason: 'invalid-header' };
  const h = header as Partial<SaveHeader>;
  if (h.magic !== 'AAPW-V3' || h.format !== 3 || !Number.isInteger(h.schema)) return { ok: false, reason: 'invalid-header' };
  if (Number(h.schema) > latestSchema) return { ok: false, reason: 'schema-too-new', header: h as SaveHeader };
  if (!codec.validate(object.payload)) return { ok: false, reason: 'payload-invalid', header: h as SaveHeader };
  const checksum = codec.checksum(object.payload);
  if (checksum !== h.checksum) return { ok: false, reason: 'checksum-mismatch', header: h as SaveHeader };
  return { ok: true, header: h as SaveHeader };
}

export interface SaveSlotAdapter {
  read(slot: number): Promise<string | null> | string | null;
  write(slot: number, serialized: string): Promise<void> | void;
  remove(slot: number): Promise<void> | void;
  list(): Promise<readonly number[]> | readonly number[];
}

export class MemorySaveAdapter implements SaveSlotAdapter {
  #slots = new Map<number, string>();

  read(slot: number): string | null {
    return this.#slots.get(slot) ?? null;
  }

  write(slot: number, serialized: string): void {
    this.#slots.set(slot, serialized);
  }

  remove(slot: number): void {
    this.#slots.delete(slot);
  }

  list(): readonly number[] {
    return [...this.#slots.keys()].sort((a, b) => a - b);
  }
}

export class SaveManager<T> {
  readonly codec: SaveCodec<T>;
  readonly adapter: SaveSlotAdapter;
  readonly migrations?: SaveMigrationRegistry<T>;
  #revisionBySlot = new Map<number, number>();

  constructor(options: {
    readonly codec: SaveCodec<T>;
    readonly adapter?: SaveSlotAdapter;
    readonly migrations?: SaveMigrationRegistry<T>;
  }) {
    this.codec = options.codec;
    this.adapter = options.adapter ?? new MemorySaveAdapter();
    this.migrations = options.migrations;
  }

  async save(slot: number, payload: T, playtimeMs: number, nowMs = Date.now()): Promise<SaveRecord<T>> {
    const revision = (this.#revisionBySlot.get(slot) ?? 0) + 1;
    const envelope = createSaveEnvelope({ payload, codec: this.codec, revision, playtimeMs, nowMs });
    const serialized = serializeSave(envelope, this.codec);
    await this.adapter.write(slot, serialized);
    this.#revisionBySlot.set(slot, revision);
    return {
      slot,
      revision,
      schema: envelope.header.schema,
      createdAtMs: envelope.header.createdAtMs,
      updatedAtMs: envelope.header.updatedAtMs,
      playtimeMs: envelope.header.playtimeMs,
      checksum: envelope.header.checksum,
      payload: structuredClone(payload),
    };
  }

  async load(slot: number): Promise<SaveRecord<T> | null> {
    const serialized = await this.adapter.read(slot);
    if (!serialized) return null;
    const validation = validateSerializedSave(serialized, this.codec, this.migrations?.latest() ?? this.codec.schema);
    if (!validation.ok) throw new Error(`save validation failed: ${validation.reason}`);
    const parsed = JSON.parse(serialized) as SaveEnvelope<unknown>;
    let payload = parsed.payload;
    if (parsed.header.schema !== this.codec.schema) {
      if (!this.migrations) throw new Error('save needs migrations but none are configured');
      payload = this.migrations.migrate(payload, parsed.header.schema);
    }
    if (!this.codec.validate(payload)) throw new Error('migrated save payload failed validation');
    const header = parsed.header;
    this.#revisionBySlot.set(slot, header.revision);
    return {
      slot,
      revision: header.revision,
      schema: header.schema,
      createdAtMs: header.createdAtMs,
      updatedAtMs: header.updatedAtMs,
      playtimeMs: header.playtimeMs,
      checksum: this.codec.checksum(payload),
      payload: structuredClone(payload),
    };
  }

  async remove(slot: number): Promise<void> {
    await this.adapter.remove(slot);
    this.#revisionBySlot.delete(slot);
  }

  list(): Promise<readonly number[]> {
    return Promise.resolve(this.adapter.list());
  }
}

export function snapshotIsPersistable(snapshot: WorldSnapshot): boolean {
  if (!Number.isInteger(snapshot.revision) || snapshot.revision < 0) return false;
  if (!Number.isInteger(Number(snapshot.tick)) || Number(snapshot.tick) < 0) return false;
  if (typeof snapshot.checksum !== 'string' || snapshot.checksum.length < 1) return false;
  return Array.isArray(snapshot.entities) && snapshot.entities.every((entity) => typeof entity.id === 'string' && typeof entity.components === 'object');
}
