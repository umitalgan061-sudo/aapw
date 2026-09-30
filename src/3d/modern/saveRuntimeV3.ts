/**
 * Versioned save runtime for AAPW v3.
 *
 * Saves are treated as untrusted input. The codec validates structural limits, canonicalises data,
 * records a migration path, and supports deterministic checksums. Storage is injected so the game can
 * use localStorage, IndexedDB, filesystem adapters, cloud sync, or an in-memory test double.
 */

export const SAVE_SCHEMA_V3 = 3;
export const SAVE_FORMAT_V3 = 'aapw-save';
export const SAVE_MAX_BYTES_V3 = 2 * 1024 * 1024;
export const SAVE_MAX_ENTITIES_V3 = 20000;
export const SAVE_MAX_STRING_V3 = 512;

export interface SaveEntityV3 {
  readonly id: number;
  readonly archetype: string;
  readonly transform?: { x: number; y: number; z: number; yaw: number };
  readonly values: Readonly<Record<string, number | string | boolean | null>>;
}

export interface SavePayloadV3 {
  readonly schema: 3;
  readonly format: typeof SAVE_FORMAT_V3;
  readonly worldSeed: number;
  readonly tick: number;
  readonly createdTick: number;
  readonly entities: readonly SaveEntityV3[];
  readonly questState: Readonly<Record<string, string | number | boolean>>;
  readonly playerState: Readonly<Record<string, number | string | boolean>>;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface SaveEnvelopeV3 {
  readonly magic: typeof SAVE_FORMAT_V3;
  readonly schema: 3;
  readonly checksum: string;
  readonly byteLength: number;
  readonly payload: SavePayloadV3;
}

export interface SaveStorageV3 {
  read(slot: string): Promise<string | null>;
  write(slot: string, value: string): Promise<void>;
  remove(slot: string): Promise<void>;
  list?(): Promise<readonly string[]>;
}

export interface SaveMetricsV3 {
  reads: number;
  writes: number;
  deletes: number;
  bytesRead: number;
  bytesWritten: number;
  migrations: number;
  corruptions: number;
}

const finite = (value: number): boolean => Number.isFinite(value);
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);
const boundedString = (value: unknown): value is string => typeof value === 'string' && value.length <= SAVE_MAX_STRING_V3;

function checksum(value: string): string {
  let a = 2166136261;
  let b = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    a ^= code;
    a = Math.imul(a, 16777619);
    b ^= code + index;
    b = Math.imul(b ^ (b >>> 13), 0x85ebca6b);
  }
  return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`;
}

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) result[key] = stableValue(source[key]);
    return result;
  }
  return value;
};

export function encodeSaveV3(payload: SavePayloadV3): string {
  validateSavePayloadV3(payload);
  return JSON.stringify(stableValue(payload));
}

export function decodeSaveV3(raw: string): SavePayloadV3 {
  if (typeof raw !== 'string' || raw.length === 0) throw new Error('Save payload is empty');
  if (new TextEncoder().encode(raw).byteLength > SAVE_MAX_BYTES_V3) throw new Error('Save payload exceeds byte limit');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Save payload is not valid JSON');
  }
  validateSavePayloadV3(parsed);
  return parsed;
}

export function validateSavePayloadV3(payload: unknown): asserts payload is SavePayloadV3 {
  if (!payload || typeof payload !== 'object') throw new Error('Save payload must be an object');
  const data = payload as Record<string, unknown>;
  if (data.schema !== SAVE_SCHEMA_V3) throw new Error(`Unsupported save schema: ${String(data.schema)}`);
  if (data.format !== SAVE_FORMAT_V3) throw new Error('Save format marker mismatch');
  if (!integer(data.worldSeed) || !finite(data.worldSeed)) throw new Error('Invalid world seed');
  if (!integer(data.tick) || data.tick < 0) throw new Error('Invalid save tick');
  if (!integer(data.createdTick) || data.createdTick < 0 || data.createdTick > data.tick) throw new Error('Invalid created tick');
  if (!Array.isArray(data.entities)) throw new Error('Save entities must be an array');
  if (data.entities.length > SAVE_MAX_ENTITIES_V3) throw new Error('Save entity count exceeds limit');
  const ids = new Set<number>();
  for (const entity of data.entities) {
    if (!entity || typeof entity !== 'object') throw new Error('Invalid save entity');
    const current = entity as Record<string, unknown>;
    if (!integer(current.id) || current.id < 0) throw new Error('Invalid entity id');
    if (ids.has(current.id)) throw new Error(`Duplicate entity id: ${current.id}`);
    ids.add(current.id);
    if (!boundedString(current.archetype) || current.archetype.length === 0) throw new Error('Invalid archetype');
    if (!current.values || typeof current.values !== 'object' || Array.isArray(current.values)) throw new Error('Invalid entity values');
    for (const [key, value] of Object.entries(current.values as Record<string, unknown>)) {
      if (!boundedString(key)) throw new Error('Invalid entity value key');
      if (!(typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null)) throw new Error('Unsupported entity value');
      if (typeof value === 'number' && !finite(value)) throw new Error('Invalid numeric entity value');
      if (typeof value === 'string' && !boundedString(value)) throw new Error('Entity value string too long');
    }
    if (current.transform !== undefined) {
      if (!current.transform || typeof current.transform !== 'object') throw new Error('Invalid transform');
      const transform = current.transform as Record<string, unknown>;
      for (const field of ['x', 'y', 'z', 'yaw']) {
        if (!finite(Number(transform[field]))) throw new Error(`Invalid transform.${field}`);
      }
    }
  }
  for (const collectionName of ['questState', 'playerState', 'metadata']) {
    const collection = data[collectionName];
    if (!collection || typeof collection !== 'object' || Array.isArray(collection)) throw new Error(`Invalid ${collectionName}`);
  }
  for (const value of Object.values(data.questState as Record<string, unknown>)) {
    if (!(typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) throw new Error('Invalid quest state value');
  }
  for (const value of Object.values(data.playerState as Record<string, unknown>)) {
    if (!(typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) throw new Error('Invalid player state value');
  }
  for (const [key, value] of Object.entries(data.metadata as Record<string, unknown>)) {
    if (!boundedString(key) || !boundedString(value)) throw new Error('Invalid metadata');
  }
}

export class MemorySaveStorageV3 implements SaveStorageV3 {
  #slots = new Map<string, string>();
  async read(slot: string): Promise<string | null> { return this.#slots.get(slot) ?? null; }
  async write(slot: string, value: string): Promise<void> { this.#slots.set(slot, value); }
  async remove(slot: string): Promise<void> { this.#slots.delete(slot); }
  async list(): Promise<readonly string[]> { return Object.freeze([...this.#slots.keys()].sort()); }
}

export interface SaveMigrationV3 {
  readonly from: number;
  readonly to: number;
  migrate(value: unknown): unknown;
}

export class SaveRuntimeV3 {
  readonly storage: SaveStorageV3;
  #migrations = new Map<number, SaveMigrationV3>();
  #metrics: SaveMetricsV3 = { reads: 0, writes: 0, deletes: 0, bytesRead: 0, bytesWritten: 0, migrations: 0, corruptions: 0 };

  constructor(storage: SaveStorageV3) { this.storage = storage; }

  registerMigration(migration: SaveMigrationV3): void {
    if (!Number.isInteger(migration.from) || !Number.isInteger(migration.to) || migration.to <= migration.from) throw new Error('Invalid save migration range');
    if (this.#migrations.has(migration.from)) throw new Error(`Migration already registered from ${migration.from}`);
    this.#migrations.set(migration.from, migration);
  }

  async write(slot: string, payload: SavePayloadV3): Promise<SaveEnvelopeV3> {
    if (!slot.trim()) throw new Error('Save slot is required');
    const body = encodeSaveV3(payload);
    const envelope: SaveEnvelopeV3 = {
      magic: SAVE_FORMAT_V3,
      schema: SAVE_SCHEMA_V3,
      checksum: checksum(body),
      byteLength: new TextEncoder().encode(body).byteLength,
      payload,
    };
    const encoded = JSON.stringify(stableValue(envelope));
    if (new TextEncoder().encode(encoded).byteLength > SAVE_MAX_BYTES_V3) throw new Error('Save envelope exceeds byte limit');
    await this.storage.write(slot, encoded);
    this.#metrics.writes += 1;
    this.#metrics.bytesWritten += new TextEncoder().encode(encoded).byteLength;
    return envelope;
  }

  async read(slot: string): Promise<SavePayloadV3 | null> {
    const raw = await this.storage.read(slot);
    this.#metrics.reads += 1;
    if (!raw) return null;
    const bytes = new TextEncoder().encode(raw).byteLength;
    this.#metrics.bytesRead += bytes;
    if (bytes > SAVE_MAX_BYTES_V3) { this.#metrics.corruptions += 1; throw new Error('Saved data exceeds byte limit'); }
    let envelope: unknown;
    try { envelope = JSON.parse(raw); } catch { this.#metrics.corruptions += 1; throw new Error('Saved envelope is invalid JSON'); }
    if (!envelope || typeof envelope !== 'object') throw new Error('Saved envelope is invalid');
    const record = envelope as Record<string, unknown>;
    if (record.magic !== SAVE_FORMAT_V3 || record.schema !== SAVE_SCHEMA_V3) throw new Error('Saved envelope marker mismatch');
    if (typeof record.checksum !== 'string' || typeof record.payload !== 'object' || !record.payload) throw new Error('Saved envelope fields invalid');
    const body = encodeSaveV3(record.payload as SavePayloadV3);
    if (checksum(body) !== record.checksum) { this.#metrics.corruptions += 1; throw new Error('Save checksum mismatch'); }
    return record.payload as SavePayloadV3;
  }

  async remove(slot: string): Promise<void> {
    await this.storage.remove(slot);
    this.#metrics.deletes += 1;
  }

  async slots(): Promise<readonly string[]> { return this.storage.list ? this.storage.list() : Object.freeze([]); }

  metrics(): SaveMetricsV3 { return { ...this.#metrics }; }
}

export const createEmptySaveV3 = (worldSeed: number): SavePayloadV3 => ({
  schema: SAVE_SCHEMA_V3,
  format: SAVE_FORMAT_V3,
  worldSeed,
  tick: 0,
  createdTick: 0,
  entities: [],
  questState: {},
  playerState: {},
  metadata: { runtime: 'v3' },
});
