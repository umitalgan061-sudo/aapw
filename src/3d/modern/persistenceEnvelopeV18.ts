/**
 * AAPW Persistence Envelope V18.
 *
 * Versioned, checksummed, size-bounded save envelope with deterministic migration
 * and slot rotation. Payloads remain renderer-neutral and safe to inspect offline.
 */

export interface PersistenceRecordV18<T> {
  readonly magic: 'AAPW-SAVE-V18';
  readonly schema: number;
  readonly revision: number;
  readonly createdAtMs: number;
  readonly tick: number;
  readonly checksum: string;
  readonly payload: T;
}

export interface PersistenceSlotV18 {
  readonly name: string;
  readonly revision: number;
  readonly encoded: string;
  readonly checksum: string;
  readonly createdAtMs: number;
  readonly bytes: number;
}

export interface PersistenceLoadResultV18<T> {
  readonly ok: boolean;
  readonly found: boolean;
  readonly migrated: boolean;
  readonly revision: number;
  readonly payload: T | null;
  readonly error: string | null;
}

export interface PersistenceEnvelopeOptionsV18<T> {
  readonly schema: number;
  readonly maxBytes?: number;
  readonly clock?: () => number;
  readonly migrate?: (payload: unknown, fromSchema: number, toSchema: number) => T;
  readonly validate?: (payload: unknown) => payload is T;
  readonly adapter?: PersistenceAdapterV18;
}

export interface PersistenceAdapterV18 {
  read(slot: string): string | null | Promise<string | null>;
  write(slot: string, encoded: string): void | Promise<void>;
  remove?(slot: string): void | Promise<void>;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) {
    return `[${value.map(stable).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
    .join(',')}}`;
}

function hash(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;

  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c + i;
    h2 = Math.imul(h2, 0x27d4eb2d);
  }

  return (
    (h1 >>> 0).toString(16).padStart(8, '0') +
    (h2 >>> 0).toString(16).padStart(8, '0')
  ).repeat(4).slice(0, 64);
}

function bytesOf(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export class PersistenceEnvelopeV18<T> {
  readonly #schema: number;
  readonly #maxBytes: number;
  readonly #clock: () => number;
  readonly #migrate: PersistenceEnvelopeOptionsV18<T>['migrate'] | undefined;
  readonly #validate: PersistenceEnvelopeOptionsV18<T>['validate'] | undefined;
  readonly #adapter: PersistenceAdapterV18 | undefined;
  #revision = 0;

  public constructor(options: PersistenceEnvelopeOptionsV18<T>) {
    this.#schema = Math.max(1, Math.trunc(options.schema));
    this.#maxBytes = Math.max(1024, Math.trunc(clamp(options.maxBytes ?? 8 * 1024 * 1024, 1024, 64 * 1024 * 1024)));
    this.#clock = options.clock ?? (() => Date.now());
    this.#migrate = options.migrate;
    this.#validate = options.validate;
    this.#adapter = options.adapter;
  }

  public encode(payload: T, tick = 0): string {
    if (this.#validate && !this.#validate(payload)) {
      throw new TypeError('Persistence payload failed validation.');
    }

    const nextRevision = this.#revision + 1;
    const createdAtMs = Math.max(0, this.#clock());
    const unsigned = {
      magic: 'AAPW-SAVE-V18' as const,
      schema: this.#schema,
      revision: nextRevision,
      createdAtMs,
      tick: Math.max(0, Math.trunc(tick)),
      payload,
    };

    const checksum = hash(stable(unsigned));
    const envelope: PersistenceRecordV18<T> = {
      ...unsigned,
      checksum,
    };

    const encoded = JSON.stringify(envelope);
    if (bytesOf(encoded) > this.#maxBytes) {
      throw new RangeError(`Persistence envelope exceeds ${this.#maxBytes} bytes.`);
    }

    this.#revision = nextRevision;
    return encoded;
  }

  public decode(encoded: string): PersistenceLoadResultV18<T> {
    if (!encoded || bytesOf(encoded) > this.#maxBytes) {
      return this.#failure('SIZE_LIMIT');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(encoded);
    } catch {
      return this.#failure('INVALID_JSON');
    }

    if (!this.#isEnvelope(parsed)) {
      return this.#failure('INVALID_ENVELOPE');
    }

    const withoutChecksum = {
      magic: parsed.magic,
      schema: parsed.schema,
      revision: parsed.revision,
      createdAtMs: parsed.createdAtMs,
      tick: parsed.tick,
      payload: parsed.payload,
    };

    if (hash(stable(withoutChecksum)) !== parsed.checksum) {
      return this.#failure('CHECKSUM_MISMATCH');
    }

    let payload: unknown = parsed.payload;
    let migrated = false;

    if (parsed.schema !== this.#schema) {
      if (!this.#migrate) {
        return this.#failure('SCHEMA_MISMATCH');
      }

      try {
        payload = this.#migrate(payload, parsed.schema, this.#schema);
        migrated = true;
      } catch {
        return this.#failure('MIGRATION_FAILED');
      }
    }

    if (this.#validate && !this.#validate(payload)) {
      return this.#failure('PAYLOAD_INVALID');
    }

    this.#revision = Math.max(this.#revision, parsed.revision);

    return Object.freeze({
      ok: true,
      found: true,
      migrated,
      revision: parsed.revision,
      payload: payload as T,
      error: null,
    });
  }

  public async save(
    slot: string,
    payload: T,
    tick = 0,
  ): Promise<PersistenceSlotV18> {
    if (!this.#adapter) throw new Error('Persistence adapter is not configured.');

    const encoded = this.encode(payload, tick);
    const parsed = JSON.parse(encoded) as PersistenceRecordV18<T>;
    await this.#adapter.write(slot, encoded);

    return Object.freeze({
      name: slot,
      revision: parsed.revision,
      encoded,
      checksum: parsed.checksum,
      createdAtMs: parsed.createdAtMs,
      bytes: bytesOf(encoded),
    });
  }

  public async load(slot: string): Promise<PersistenceLoadResultV18<T>> {
    if (!this.#adapter) throw new Error('Persistence adapter is not configured.');

    const encoded = await this.#adapter.read(slot);
    if (encoded === null) {
      return Object.freeze({
        ok: true,
        found: false,
        migrated: false,
        revision: 0,
        payload: null,
        error: null,
      });
    }

    return this.decode(encoded);
  }

  public async remove(slot: string): Promise<void> {
    await this.#adapter?.remove?.(slot);
  }

  public createRotatingSave(
    slots: readonly string[],
    payload: T,
    tick = 0,
  ): Promise<PersistenceSlotV18> {
    if (slots.length === 0) {
      throw new RangeError('At least one persistence slot is required.');
    }

    const ordered = [...new Set(slots.map((slot) => slot.trim()).filter(Boolean))];
    const target = ordered[this.#revision % ordered.length] ?? ordered[0];
    if (!target) throw new RangeError('Persistence slot name is empty.');
    return this.save(target, payload, tick);
  }

  public snapshot(): Readonly<{ schema: number; revision: number; maxBytes: number }> {
    return Object.freeze({
      schema: this.#schema,
      revision: this.#revision,
      maxBytes: this.#maxBytes,
    });
  }

  #failure(error: string): PersistenceLoadResultV18<T> {
    return Object.freeze({
      ok: false,
      found: true,
      migrated: false,
      revision: 0,
      payload: null,
      error,
    });
  }

  #isEnvelope(value: unknown): value is PersistenceRecordV18<unknown> {
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;

    return (
      record.magic === 'AAPW-SAVE-V18' &&
      Number.isInteger(record.schema) &&
      Number.isInteger(record.revision) &&
      typeof record.createdAtMs === 'number' &&
      Number.isInteger(record.tick) &&
      typeof record.checksum === 'string' &&
      'payload' in record
    );
  }
}

export class MemoryPersistenceAdapterV18 implements PersistenceAdapterV18 {
  readonly #slots = new Map<string, string>();

  public read(slot: string): string | null {
    return this.#slots.get(slot) ?? null;
  }

  public write(slot: string, encoded: string): void {
    this.#slots.set(slot, encoded);
  }

  public remove(slot: string): void {
    this.#slots.delete(slot);
  }

  public snapshot(): Readonly<Record<string, string>> {
    return Object.freeze(Object.fromEntries([...this.#slots.entries()].sort(([a], [b]) => a.localeCompare(b))));
  }
}

export function createLocalStoragePersistenceAdapterV18(
  storage: Storage | null = typeof localStorage === 'undefined' ? null : localStorage,
): PersistenceAdapterV18 {
  return {
    read(slot) {
      try {
        return storage?.getItem(slot) ?? null;
      } catch {
        return null;
      }
    },
    write(slot, encoded) {
      if (!storage) return;
      storage.setItem(slot, encoded);
    },
    remove(slot) {
      storage?.removeItem(slot);
    },
  };
}