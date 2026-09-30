import { createHash } from 'node:crypto';
import type { SaveEnvelope, SaveSlotId } from './contracts.ts';
import { saveSlotId } from './contracts.ts';

export interface SaveRecord<T> extends SaveEnvelope<T> {
  readonly bytes: number;
}

export interface SaveMigration<T> {
  readonly fromVersion: number;
  readonly toVersion: number;
  migrate(value: unknown): T;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'bigint') return `"${value.toString()}n"`;
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value instanceof Map) {
    const entries = [...value.entries()]
      .map(([key, item]) => [String(key), item] as const)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{"__map":[${entries.map(([key, item]) => `[${JSON.stringify(key)},${canonicalize(item)}]`).join(',')}]} `;
  }
  if (value instanceof Set) {
    return `{"__set":[${[...value].map(canonicalize).sort().join(',')}]} `;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(String(value));
}

export function canonicalJson(value: unknown): string {
  return canonicalize(value).replace(/\]\s*\}/g, ']}');
}

export function checksum(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export class SaveCodec<T> {
  readonly currentVersion: number;
  #migrations = new Map<number, SaveMigration<unknown>>();

  constructor(currentVersion = 1) {
    if (!Number.isInteger(currentVersion) || currentVersion < 1) throw new RangeError('currentVersion must be positive');
    this.currentVersion = currentVersion;
  }

  registerMigration(migration: SaveMigration<unknown>): void {
    if (migration.toVersion <= migration.fromVersion) throw new RangeError('Migration versions must increase');
    this.#migrations.set(migration.fromVersion, migration);
  }

  encode(slot: SaveSlotId | string, tick: number, data: T): SaveRecord<T> {
    const id = typeof slot === 'string' ? saveSlotId(slot) : slot;
    const payload = {
      magic: 'AAPW-R27' as const,
      schemaVersion: this.currentVersion,
      slot: id,
      createdAtTick: tick,
      updatedAtTick: tick,
      data,
    };
    const digest = checksum(payload);
    const envelope: SaveEnvelope<T> = {
      header: { ...payload, checksum: digest },
      data,
    };
    const bytes = new TextEncoder().encode(canonicalJson(envelope)).byteLength;
    return { ...envelope, bytes };
  }

  decode(envelope: SaveEnvelope<unknown>): T {
    if (envelope.header.magic !== 'AAPW-R27') throw new Error('Invalid save magic');
    const expected = checksum({
      magic: envelope.header.magic,
      schemaVersion: envelope.header.schemaVersion,
      slot: envelope.header.slot,
      createdAtTick: envelope.header.createdAtTick,
      updatedAtTick: envelope.header.updatedAtTick,
      data: envelope.data,
    });
    if (expected !== envelope.header.checksum) throw new Error('Save checksum mismatch');

    let version = envelope.header.schemaVersion;
    let value: unknown = envelope.data;
    while (version < this.currentVersion) {
      const migration = this.#migrations.get(version);
      if (!migration) throw new Error(`Missing save migration from v${version}`);
      value = migration.migrate(value);
      version = migration.toVersion;
    }

    if (version !== this.currentVersion) throw new Error(`Unsupported future save version: ${version}`);
    return value as T;
  }
}

export class InMemorySaveRepository<T> {
  #records = new Map<SaveSlotId, SaveRecord<T>>();
  readonly maxSlots: number;

  constructor(maxSlots = 8) {
    this.maxSlots = Math.max(1, Math.floor(maxSlots));
  }

  put(record: SaveRecord<T>): void {
    this.#records.set(record.header.slot, record);
    if (this.#records.size <= this.maxSlots) return;
    const oldest = [...this.#records.values()]
      .sort((a, b) => a.header.updatedAtTick - b.header.updatedAtTick || String(a.header.slot).localeCompare(String(b.header.slot)))[0];
    if (oldest) this.#records.delete(oldest.header.slot);
  }

  get(slot: SaveSlotId): SaveRecord<T> | undefined {
    return this.#records.get(slot);
  }

  remove(slot: SaveSlotId): boolean {
    return this.#records.delete(slot);
  }

  list(): readonly SaveRecord<T>[] {
    return [...this.#records.values()]
      .sort((a, b) => b.header.updatedAtTick - a.header.updatedAtTick || String(a.header.slot).localeCompare(String(b.header.slot)));
  }

  clear(): void {
    this.#records.clear();
  }
}
