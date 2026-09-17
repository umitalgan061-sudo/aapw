import type { PersistedState, PersistencePort, PortResult, SaveSlotRecord } from './portsR3.ts';

export interface SaveBackend<TState> {
  read(slot: number): Promise<string | null>;
  write(slot: number, encoded: string): Promise<void>;
  remove(slot: number): Promise<void>;
  list(): Promise<readonly number[]>;
}

export interface PersistenceRuntimeOptions {
  readonly schema: string;
  readonly version: number;
  readonly maxPayloadBytes?: number;
  readonly maxSlots?: number;
  readonly clock?: () => number;
}

export interface SaveEnvelopeR3<TState> {
  readonly schema: string;
  readonly version: number;
  readonly savedAtMs: number;
  readonly checksum: string;
  readonly payload: TState;
}

export interface PersistenceSnapshot {
  readonly schema: string;
  readonly version: number;
  readonly slots: readonly SaveSlotRecord[];
  readonly saves: number;
  readonly loads: number;
  readonly failures: number;
}

const utf8 = new TextEncoder();

function fnv1a(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(',')}}`;
}

function checksum<T>(value: T): string {
  return fnv1a(utf8.encode(stableStringify(value)));
}

function parseSlot(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 9999) throw new Error(`Invalid save slot: ${value}`);
  return value;
}

export class MemorySaveBackend<TState> implements SaveBackend<TState> {
  readonly #records = new Map<number, string>();

  async read(slot: number): Promise<string | null> {
    return this.#records.get(parseSlot(slot)) ?? null;
  }

  async write(slot: number, encoded: string): Promise<void> {
    this.#records.set(parseSlot(slot), encoded);
  }

  async remove(slot: number): Promise<void> {
    this.#records.delete(parseSlot(slot));
  }

  async list(): Promise<readonly number[]> {
    return [...this.#records.keys()].sort((a, b) => a - b);
  }
}

export class LocalStorageSaveBackend<TState> implements SaveBackend<TState> {
  readonly #prefix: string;
  readonly #storage: Storage;

  constructor(prefix = 'aapw:save:', storage?: Storage) {
    this.#prefix = prefix;
    const candidate = storage ?? (typeof globalThis !== 'undefined' ? globalThis.localStorage : undefined);
    if (!candidate) throw new Error('localStorage is unavailable.');
    this.#storage = candidate;
  }

  async read(slot: number): Promise<string | null> {
    return this.#storage.getItem(`${this.#prefix}${parseSlot(slot)}`);
  }

  async write(slot: number, encoded: string): Promise<void> {
    this.#storage.setItem(`${this.#prefix}${parseSlot(slot)}`, encoded);
  }

  async remove(slot: number): Promise<void> {
    this.#storage.removeItem(`${this.#prefix}${parseSlot(slot)}`);
  }

  async list(): Promise<readonly number[]> {
    const slots: number[] = [];
    for (let index = 0; index < this.#storage.length; index += 1) {
      const key = this.#storage.key(index);
      if (!key?.startsWith(this.#prefix)) continue;
      const parsed = Number(key.slice(this.#prefix.length));
      if (Number.isInteger(parsed) && parsed >= 0) slots.push(parsed);
    }
    return slots.sort((a, b) => a - b);
  }
}

export class PersistenceRuntimeR3<TState> implements PersistencePort<TState> {
  readonly #backend: SaveBackend<TState>;
  readonly #schema: string;
  readonly #version: number;
  readonly #maxPayloadBytes: number;
  readonly #maxSlots: number;
  readonly #clock: () => number;
  #saves = 0;
  #loads = 0;
  #failures = 0;

  constructor(backend: SaveBackend<TState>, options: PersistenceRuntimeOptions) {
    this.#backend = backend;
    this.#schema = options.schema;
    this.#version = Math.max(1, Math.floor(options.version));
    this.#maxPayloadBytes = Math.max(1024, Math.floor(options.maxPayloadBytes ?? 2 * 1024 * 1024));
    this.#maxSlots = Math.max(1, Math.floor(options.maxSlots ?? 32));
    this.#clock = options.clock ?? (() => 0);
  }

  async save(slot: number, state: TState): Promise<PortResult<PersistedState<TState>>> {
    try {
      const safeSlot = parseSlot(slot);
      const slots = await this.#backend.list();
      if (!slots.includes(safeSlot) && slots.length >= this.#maxSlots) {
        this.#failures += 1;
        return { ok: false, error: { code: 'SAVE_CAP', message: 'Maximum save-slot count reached.', retryable: false } };
      }
      const now = Math.max(0, Number.isFinite(this.#clock()) ? this.#clock() : 0);
      const envelope: SaveEnvelopeR3<TState> = {
        schema: this.#schema,
        version: this.#version,
        savedAtMs: now,
        checksum: checksum(state),
        payload: state,
      };
      const encoded = JSON.stringify(envelope);
      if (utf8.encode(encoded).byteLength > this.#maxPayloadBytes) {
        this.#failures += 1;
        return { ok: false, error: { code: 'SAVE_SIZE', message: 'Save payload exceeds configured size limit.', retryable: false } };
      }
      await this.#backend.write(safeSlot, encoded);
      this.#saves += 1;
      return { ok: true, value: { slot: safeSlot, schema: envelope.schema, version: envelope.version, checksum: envelope.checksum, savedAtMs: envelope.savedAtMs, state: envelope.payload } };
    } catch (error) {
      this.#failures += 1;
      return { ok: false, error: { code: 'SAVE_WRITE', message: error instanceof Error ? error.message : String(error), retryable: true } };
    }
  }

  async load(slot: number): Promise<PortResult<PersistedState<TState> | null>> {
    try {
      const safeSlot = parseSlot(slot);
      const encoded = await this.#backend.read(safeSlot);
      if (encoded === null) {
        this.#loads += 1;
        return { ok: true, value: null };
      }
      if (utf8.encode(encoded).byteLength > this.#maxPayloadBytes) {
        this.#failures += 1;
        return { ok: false, error: { code: 'SAVE_SIZE', message: 'Stored save exceeds configured size limit.', retryable: false } };
      }
      const parsed: unknown = JSON.parse(encoded);
      if (!this.#isEnvelope(parsed)) {
        this.#failures += 1;
        return { ok: false, error: { code: 'SAVE_SHAPE', message: 'Stored save envelope is invalid.', retryable: false } };
      }
      if (parsed.schema !== this.#schema || parsed.version !== this.#version) {
        this.#failures += 1;
        return { ok: false, error: { code: 'SAVE_VERSION', message: 'Stored save uses an incompatible schema version.', retryable: false } };
      }
      const actualChecksum = checksum(parsed.payload);
      if (actualChecksum !== parsed.checksum) {
        this.#failures += 1;
        return { ok: false, error: { code: 'SAVE_CHECKSUM', message: 'Stored save checksum does not match payload.', retryable: false } };
      }
      this.#loads += 1;
      return { ok: true, value: { slot: safeSlot, schema: parsed.schema, version: parsed.version, checksum: parsed.checksum, savedAtMs: parsed.savedAtMs, state: parsed.payload as TState } };
    } catch (error) {
      this.#failures += 1;
      return { ok: false, error: { code: 'SAVE_READ', message: error instanceof Error ? error.message : String(error), retryable: true } };
    }
  }

  async remove(slot: number): Promise<PortResult<void>> {
    try {
      await this.#backend.remove(parseSlot(slot));
      return { ok: true, value: undefined };
    } catch (error) {
      this.#failures += 1;
      return { ok: false, error: { code: 'SAVE_REMOVE', message: error instanceof Error ? error.message : String(error), retryable: true } };
    }
  }

  async slots(): Promise<readonly SaveSlotRecord[]> {
    const records: SaveSlotRecord[] = [];
    for (const slot of await this.#backend.list()) {
      const loaded = await this.load(slot);
      if (!loaded.ok || loaded.value === null) continue;
      records.push({ slot, schema: loaded.value.schema, version: loaded.value.version, checksum: loaded.value.checksum, savedAtMs: loaded.value.savedAtMs });
    }
    return records;
  }

  snapshot(): PersistenceSnapshot {
    return {
      schema: this.#schema,
      version: this.#version,
      slots: [],
      saves: this.#saves,
      loads: this.#loads,
      failures: this.#failures,
    };
  }

  #isEnvelope(value: unknown): value is SaveEnvelopeR3<unknown> {
    if (!value || typeof value !== 'object') return false;
    const object = value as Record<string, unknown>;
    return typeof object.schema === 'string'
      && Number.isInteger(object.version)
      && Number.isFinite(object.savedAtMs)
      && typeof object.checksum === 'string'
      && 'payload' in object;
  }
}

export function createMigrationSafeSerializer<TState>(): (state: TState) => string {
  return (state) => JSON.stringify({ version: 1, payload: state, checksum: checksum(state) });
}
