import type { EngineResult, SerializedEnvelope } from './types.js';
import { deepFreeze } from './validation.js';

export interface SavePayload {
  readonly world: Readonly<Record<string, unknown>>;
  readonly player: Readonly<Record<string, unknown>>;
  readonly meta?: Readonly<Record<string, unknown>>;
}

export interface SaveBackend {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  keys?(): readonly string[];
}

export interface SaveRecord extends SerializedEnvelope {
  readonly slot: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly playtimeSeconds: number;
  readonly migration: number;
}

export interface SaveMigration {
  readonly from: number;
  readonly to: number;
  readonly migrate: (payload: unknown) => unknown;
}

export interface SaveValidation {
  readonly ok: boolean;
  readonly code: string;
  readonly message?: string;
}

export interface SaveSystemOptions {
  readonly prefix?: string;
  readonly schema?: string;
  readonly version?: number;
  readonly maxBytes?: number;
  readonly maxSlots?: number;
  readonly clock?: () => number;
}

const DEFAULTS = Object.freeze({ prefix: 'westeros3d:save:', schema: 'aapw.game.save', version: 4, maxBytes: 2_000_000, maxSlots: 8 });

export class MemorySaveBackend implements SaveBackend {
  private readonly values = new Map<string, string>();
  public get(key: string): string | null { return this.values.get(key) ?? null; }
  public set(key: string, value: string): void { this.values.set(key, value); }
  public remove(key: string): void { this.values.delete(key); }
  public keys(): readonly string[] { return [...this.values.keys()]; }
}

export class LocalStorageBackend implements SaveBackend {
  private readonly storage: Storage;
  public constructor(storage?: Storage) {
    if (storage) this.storage = storage;
    else if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) this.storage = globalThis.localStorage;
    else throw new Error('LOCAL_STORAGE_UNAVAILABLE');
  }
  public get(key: string): string | null { return this.storage.getItem(key); }
  public set(key: string, value: string): void { this.storage.setItem(key, value); }
  public remove(key: string): void { this.storage.removeItem(key); }
  public keys(): readonly string[] { const keys: string[] = []; for (let i = 0; i < this.storage.length; i += 1) { const key = this.storage.key(i); if (key) keys.push(key); } return keys; }
}

export class SaveSystem {
  private readonly backend: SaveBackend;
  private readonly prefix: string;
  private readonly schema: string;
  private readonly version: number;
  private readonly maxBytes: number;
  private readonly maxSlots: number;
  private readonly clock: () => number;
  private readonly migrations = new Map<number, SaveMigration>();
  private readonly history: SaveRecord[] = [];
  private revision = 0;

  public constructor(backend: SaveBackend, options: SaveSystemOptions = {}) {
    this.backend = backend;
    this.prefix = options.prefix ?? DEFAULTS.prefix;
    this.schema = options.schema ?? DEFAULTS.schema;
    this.version = Math.max(1, Math.trunc(options.version ?? DEFAULTS.version));
    this.maxBytes = Math.max(1024, Math.trunc(options.maxBytes ?? DEFAULTS.maxBytes));
    this.maxSlots = Math.max(1, Math.trunc(options.maxSlots ?? DEFAULTS.maxSlots));
    this.clock = options.clock ?? (() => Date.now());
  }

  public get currentVersion(): number { return this.version; }
  public get revisionNumber(): number { return this.revision; }
  public registerMigration(migration: SaveMigration): boolean {
    if (migration.from < 1 || migration.to !== migration.from + 1 || this.migrations.has(migration.from)) return false;
    this.migrations.set(migration.from, Object.freeze({ ...migration }));
    return true;
  }

  public encode(slot: string, payload: SavePayload, playtimeSeconds = 0): EngineResult<SaveRecord> {
    const safeSlot = normalizeSlot(slot, this.maxSlots);
    if (!safeSlot) return fail('SAVE_SLOT_INVALID');
    const createdAt = this.clock();
    const body = JSON.stringify({ world: payload.world, player: payload.player, ...(payload.meta ? { meta: payload.meta } : {}) });
    if (body.length > this.maxBytes) return fail('SAVE_PAYLOAD_TOO_LARGE');
    const checksum = digest(body);
    const record: SaveRecord = Object.freeze({ schema: this.schema, version: this.version, checksum, data: body, slot: safeSlot, createdAt, updatedAt: createdAt, playtimeSeconds: finite(playtimeSeconds), migration: this.version });
    return { ok: true, value: record, meta: { status: 'ok', code: 'SAVE_ENCODED' } };
  }

  public write(slot: string, payload: SavePayload, playtimeSeconds = 0): EngineResult<SaveRecord> {
    const encoded = this.encode(slot, payload, playtimeSeconds);
    if (!encoded.ok || !encoded.value) return encoded;
    try {
      this.backend.set(this.key(encoded.value.slot), JSON.stringify(encoded.value));
      this.history.push(encoded.value);
      while (this.history.length > 64) this.history.shift();
      this.revision += 1;
      return { ok: true, value: encoded.value, meta: { status: 'ok', code: 'SAVE_WRITTEN' } };
    } catch (error) { return fail('SAVE_BACKEND_WRITE', error instanceof Error ? error.message : 'write failed'); }
  }

  public read(slot: string): EngineResult<SavePayload> {
    const safeSlot = normalizeSlot(slot, this.maxSlots);
    if (!safeSlot) return fail('SAVE_SLOT_INVALID');
    const raw = this.backend.get(this.key(safeSlot));
    if (!raw) return fail('SAVE_NOT_FOUND');
    const parsed = safeJson(raw);
    const validation = this.validateRecord(parsed);
    if (!validation.ok) return fail(validation.code, validation.message);
    const record = parsed as SaveRecord;
    let payload: unknown = safeJson(record.data);
    if (payload === undefined || payload === null || typeof payload !== 'object') return fail('SAVE_DATA_INVALID');
    payload = this.migrate(payload, record.version);
    if (!payload || typeof payload !== 'object') return fail('SAVE_MIGRATION_INVALID');
    return { ok: true, value: deepFreeze(payload as SavePayload), meta: { status: 'ok', code: 'SAVE_READ' } };
  }

  public remove(slot: string): boolean {
    const safeSlot = normalizeSlot(slot, this.maxSlots);
    if (!safeSlot) return false;
    try { this.backend.remove(this.key(safeSlot)); this.revision += 1; return true; } catch { return false; }
  }

  public validate(slot: string): SaveValidation {
    const safeSlot = normalizeSlot(slot, this.maxSlots);
    if (!safeSlot) return { ok: false, code: 'SAVE_SLOT_INVALID' };
    const raw = this.backend.get(this.key(safeSlot));
    if (!raw) return { ok: false, code: 'SAVE_NOT_FOUND' };
    const parsed = safeJson(raw);
    return this.validateRecord(parsed);
  }

  public slots(): readonly string[] {
    const keys = this.backend.keys?.() ?? [];
    return Object.freeze(keys.filter(key => key.startsWith(this.prefix)).map(key => key.slice(this.prefix.length)).filter(slot => normalizeSlot(slot, this.maxSlots) !== undefined).sort());
  }

  public snapshot(): Readonly<{ revision: number; slots: readonly string[]; history: readonly SaveRecord[] }> {
    return Object.freeze({ revision: this.revision, slots: this.slots(), history: Object.freeze([...this.history].map(record => Object.freeze({ ...record }))) });
  }

  public export(slot: string): EngineResult<string> {
    const safeSlot = normalizeSlot(slot, this.maxSlots);
    if (!safeSlot) return fail('SAVE_SLOT_INVALID');
    const raw = this.backend.get(this.key(safeSlot));
    return raw ? { ok: true, value: raw, meta: { status: 'ok', code: 'SAVE_EXPORTED' } } : fail('SAVE_NOT_FOUND');
  }

  public import(slot: string, raw: string): EngineResult<void> {
    const safeSlot = normalizeSlot(slot, this.maxSlots);
    if (!safeSlot || raw.length > this.maxBytes * 2) return fail('SAVE_IMPORT_REJECTED');
    const parsed = safeJson(raw);
    const validation = this.validateRecord(parsed);
    if (!validation.ok) return fail(validation.code, validation.message);
    try { this.backend.set(this.key(safeSlot), raw); this.revision += 1; return { ok: true, meta: { status: 'ok', code: 'SAVE_IMPORTED' } }; }
    catch (error) { return fail('SAVE_BACKEND_WRITE', error instanceof Error ? error.message : 'write failed'); }
  }

  private key(slot: string): string { return `${this.prefix}${slot}`; }

  private validateRecord(value: unknown): SaveValidation {
    if (!value || typeof value !== 'object') return { ok: false, code: 'SAVE_RECORD_INVALID' };
    const record = value as Partial<SaveRecord>;
    if (record.schema !== this.schema) return { ok: false, code: 'SAVE_SCHEMA_MISMATCH' };
    if (!Number.isInteger(record.version) || Number(record.version) < 1 || Number(record.version) > this.version) return { ok: false, code: 'SAVE_VERSION_UNSUPPORTED' };
    if (typeof record.data !== 'string') return { ok: false, code: 'SAVE_DATA_INVALID' };
    if (record.data.length > this.maxBytes) return { ok: false, code: 'SAVE_PAYLOAD_TOO_LARGE' };
    if (typeof record.checksum !== 'string' || digest(record.data) !== record.checksum) return { ok: false, code: 'SAVE_CHECKSUM_MISMATCH' };
    if (typeof record.slot !== 'string' || !normalizeSlot(record.slot, this.maxSlots)) return { ok: false, code: 'SAVE_SLOT_INVALID' };
    return { ok: true, code: 'SAVE_VALID' };
  }

  private migrate(payload: unknown, fromVersion: number): unknown {
    let current = payload;
    for (let version = fromVersion; version < this.version; version += 1) {
      const migration = this.migrations.get(version);
      if (!migration) return undefined;
      try { current = migration.migrate(current); } catch { return undefined; }
    }
    return current;
  }
}

export const normalizeSlot = (slot: string, maxSlots = DEFAULTS.maxSlots): string | undefined => {
  const value = String(slot ?? '').trim().toLowerCase();
  if (!/^slot-[0-9]+$/.test(value)) return undefined;
  const index = Number(value.slice(5));
  return Number.isInteger(index) && index >= 0 && index < maxSlots ? value : undefined;
};

export const digest = (value: string): string => {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < value.length; i += 1) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const finite = (value: number): number => Number.isFinite(value) ? Math.max(0, value) : 0;
const safeJson = (value: string): unknown => { try { return JSON.parse(value) as unknown; } catch { return undefined; } };
const fail = <T>(code: string, message?: string): EngineResult<T> => ({ ok: false, meta: { status: 'rejected', code, ...(message ? { message } : {}) } });
