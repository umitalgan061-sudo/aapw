import type { Result } from './contracts.ts';
import { fail, ok, stableHash } from './contracts.ts';

export interface PersistenceEnvelopeR25<T> {
  readonly magic: 'AAPW-R25';
  readonly version: 1;
  readonly schema: number;
  readonly tick: number;
  readonly savedAtMs: number;
  readonly checksum: string;
  readonly payload: T;
  readonly byteLength: number;
}

export interface PersistenceSlotR25 {
  readonly slot: string;
  readonly updatedAtMs: number;
  readonly envelope: string;
}

export interface PersistenceAdapterR25 {
  get(slot: string): Promise<string | null>;
  set(slot: string, envelope: string): Promise<void>;
  remove(slot: string): Promise<void>;
  list(): Promise<readonly string[]>;
}

export interface PersistenceOptionsR25<T> {
  readonly schema: number;
  readonly maxBytes?: number;
  readonly clock?: () => number;
  readonly validate?: (value: unknown) => value is T;
  readonly migrate?: (payload: unknown, fromSchema: number, toSchema: number) => T;
}

export interface DecodedPersistenceR25<T> {
  readonly ok: true;
  readonly payload: T;
  readonly schema: number;
  readonly tick: number;
  readonly savedAtMs: number;
  readonly checksum: string;
}

export interface PersistenceErrorR25 {
  readonly code:
    | 'EMPTY'
    | 'TOO_LARGE'
    | 'MALFORMED'
    | 'MAGIC'
    | 'VERSION'
    | 'SCHEMA'
    | 'CHECKSUM'
    | 'VALIDATION'
    | 'MIGRATION';
  readonly message: string;
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function freeze<T>(value: T): T {
  return Object.freeze(value);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function normalizeSlot(value: string): string {
  const slot = value.trim();
  if (!slot) throw new Error('R25_PERSISTENCE_SLOT_EMPTY');
  return slot.slice(0, 96);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class MemoryPersistenceAdapterR25 implements PersistenceAdapterR25 {
  readonly #slots = new Map<string, string>();

  public async get(slot: string): Promise<string | null> {
    return this.#slots.get(normalizeSlot(slot)) ?? null;
  }

  public async set(slot: string, envelope: string): Promise<void> {
    this.#slots.set(normalizeSlot(slot), envelope);
  }

  public async remove(slot: string): Promise<void> {
    this.#slots.delete(normalizeSlot(slot));
  }

  public async list(): Promise<readonly string[]> {
    return freeze([...this.#slots.keys()].sort());
  }

  public clear(): void {
    this.#slots.clear();
  }
}

export class LocalStoragePersistenceAdapterR25 implements PersistenceAdapterR25 {
  readonly #storage: Storage | null;
  readonly #prefix: string;

  public constructor(
    storage: Storage | null,
    prefix = 'aapw:r25:',
  ) {
    this.#storage = storage;
    this.#prefix = prefix.slice(0, 64);
  }

  public async get(slot: string): Promise<string | null> {
    if (!this.#storage) return null;
    return this.#storage.getItem(this.#key(slot));
  }

  public async set(slot: string, envelope: string): Promise<void> {
    if (!this.#storage) throw new Error('R25_LOCAL_STORAGE_UNAVAILABLE');
    this.#storage.setItem(this.#key(slot), envelope);
  }

  public async remove(slot: string): Promise<void> {
    if (!this.#storage) return;
    this.#storage.removeItem(this.#key(slot));
  }

  public async list(): Promise<readonly string[]> {
    if (!this.#storage) return freeze([]);
    const slots: string[] = [];
    for (let index = 0; index < this.#storage.length; index += 1) {
      const key = this.#storage.key(index);
      if (!key?.startsWith(this.#prefix)) continue;
      slots.push(key.slice(this.#prefix.length));
    }
    return freeze(slots.sort());
  }

  #key(slot: string): string {
    return this.#prefix + normalizeSlot(slot);
  }
}

export class PersistenceLedgerR25<T> {
  readonly #options: Required<Pick<PersistenceOptionsR25<T>, 'schema' | 'maxBytes'>> & Omit<PersistenceOptionsR25<T>, 'schema' | 'maxBytes'>;

  public constructor(options: PersistenceOptionsR25<T>) {
    this.#options = {
      ...options,
      schema: Math.max(1, Math.trunc(options.schema)),
      maxBytes: Math.max(1024, Math.trunc(options.maxBytes ?? 4 * 1024 * 1024)),
    };
  }

  public encode(payload: T, tick = 0): string {
    const schema = this.#options.schema;
    const jsonPayload = cloneJson(payload);
    const canonical = JSON.stringify({
      magic: 'AAPW-R25',
      version: 1,
      schema,
      tick: Math.max(0, Math.trunc(finite(tick, 0))),
      payload: jsonPayload,
    });

    const checksum = stableHash(canonical);
    const envelope: PersistenceEnvelopeR25<T> = freeze({
      magic: 'AAPW-R25',
      version: 1,
      schema,
      tick: Math.max(0, Math.trunc(finite(tick, 0))),
      savedAtMs: Math.max(0, finite(this.#options.clock?.(), 0)),
      checksum,
      payload: jsonPayload,
      byteLength: 0,
    });

    const encodedWithoutLength = JSON.stringify(envelope);
    const sized = freeze({
      ...envelope,
      byteLength: byteLength(encodedWithoutLength),
    });
    const encoded = JSON.stringify(sized);

    if (byteLength(encoded) > this.#options.maxBytes) {
      throw new Error('R25_PERSISTENCE_TOO_LARGE');
    }

    return encoded;
  }

  public decode(
    encoded: string,
    options: { readonly allowMigration?: boolean } = {},
  ): Result<DecodedPersistenceR25<T>, PersistenceErrorR25> {
    if (!encoded.trim()) {
      return fail({ code: 'EMPTY', message: 'persistence envelope is empty' });
    }

    if (byteLength(encoded) > this.#options.maxBytes) {
      return fail({ code: 'TOO_LARGE', message: 'persistence envelope exceeds limit' });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(encoded);
    } catch {
      return fail({ code: 'MALFORMED', message: 'persistence envelope is not valid JSON' });
    }

    if (!parsed || typeof parsed !== 'object') {
      return fail({ code: 'MALFORMED', message: 'persistence envelope must be an object' });
    }

    const candidate = parsed as Record<string, unknown>;

    if (candidate.magic !== 'AAPW-R25') {
      return fail({ code: 'MAGIC', message: 'persistence magic mismatch' });
    }

    if (candidate.version !== 1) {
      return fail({ code: 'VERSION', message: 'unsupported persistence version' });
    }

    const schema = finite(candidate.schema, -1);
    if (!Number.isInteger(schema) || schema < 1) {
      return fail({ code: 'SCHEMA', message: 'invalid persistence schema' });
    }

    if (typeof candidate.checksum !== 'string' || !candidate.checksum) {
      return fail({ code: 'CHECKSUM', message: 'persistence checksum missing' });
    }

    const checksum = this.#checksumFromCandidate(candidate);
    if (checksum !== candidate.checksum) {
      return fail({ code: 'CHECKSUM', message: 'persistence checksum mismatch' });
    }

    let payload = candidate.payload;

    if (schema !== this.#options.schema) {
      if (!options.allowMigration || !this.#options.migrate) {
        return fail({
          code: 'SCHEMA',
          message: `schema ${schema} cannot be loaded as ${this.#options.schema}`,
        });
      }

      try {
        payload = this.#options.migrate(
          payload,
          schema,
          this.#options.schema,
        );
      } catch {
        return fail({
          code: 'MIGRATION',
          message: `migration from schema ${schema} failed`,
        });
      }
    }

    if (this.#options.validate && !this.#options.validate(payload)) {
      return fail({
        code: 'VALIDATION',
        message: 'decoded payload failed schema validation',
      });
    }

    return ok(freeze({
      ok: true as const,
      payload: payload as T,
      schema: this.#options.schema,
      tick: Math.max(0, Math.trunc(finite(candidate.tick, 0))),
      savedAtMs: Math.max(0, finite(candidate.savedAtMs, 0)),
      checksum: String(candidate.checksum),
    }));
  }

  public async save(
    adapter: PersistenceAdapterR25,
    slot: string,
    payload: T,
    tick = 0,
  ): Promise<PersistenceSlotR25> {
    const key = normalizeSlot(slot);
    const envelope = this.encode(payload, tick);
    await adapter.set(key, envelope);
    return freeze({
      slot: key,
      updatedAtMs: Math.max(0, finite(this.#options.clock?.(), 0)),
      envelope,
    });
  }

  public async load(
    adapter: PersistenceAdapterR25,
    slot: string,
    options: { readonly allowMigration?: boolean } = {},
  ): Promise<Result<DecodedPersistenceR25<T>, PersistenceErrorR25>> {
    const envelope = await adapter.get(normalizeSlot(slot));
    if (!envelope) {
      return fail({
        code: 'EMPTY',
        message: 'persistence slot is empty',
      });
    }
    return this.decode(envelope, options);
  }

  public async remove(
    adapter: PersistenceAdapterR25,
    slot: string,
  ): Promise<void> {
    await adapter.remove(normalizeSlot(slot));
  }

  public async slots(
    adapter: PersistenceAdapterR25,
  ): Promise<readonly string[]> {
    return freeze([...(await adapter.list())].sort());
  }

  #checksumFromCandidate(
    candidate: Record<string, unknown>,
  ): string {
    const canonical = JSON.stringify({
      magic: candidate.magic,
      version: candidate.version,
      schema: candidate.schema,
      tick: candidate.tick,
      payload: candidate.payload,
    });
    return stableHash(canonical);
  }
}

export interface PatchOperationR25 {
  readonly op: 'set' | 'remove';
  readonly path: readonly (string | number)[];
  readonly value?: unknown;
}

export function diffJsonR25(
  before: unknown,
  after: unknown,
  basePath: readonly (string | number)[] = [],
): readonly PatchOperationR25[] {
  if (Object.is(before, after)) return freeze([]);

  if (
    before === null ||
    after === null ||
    typeof before !== 'object' ||
    typeof after !== 'object'
  ) {
    return freeze([{ op: 'set', path: freeze([...basePath]), value: cloneJson(after) }]);
  }

  if (Array.isArray(before) || Array.isArray(after)) {
    if (!Array.isArray(before) || !Array.isArray(after)) {
      return freeze([{ op: 'set', path: freeze([...basePath]), value: cloneJson(after) }]);
    }

    const operations: PatchOperationR25[] = [];
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      const path = [...basePath, index];
      if (index >= after.length) {
        operations.push({ op: 'remove', path: freeze(path) });
      } else if (index >= before.length) {
        operations.push({ op: 'set', path: freeze(path), value: cloneJson(after[index]) });
      } else {
        operations.push(...diffJsonR25(before[index], after[index], path));
      }
    }
    return freeze(operations);
  }

  const left = before as Record<string, unknown>;
  const right = after as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  const operations: PatchOperationR25[] = [];

  for (const key of [...keys].sort()) {
    const path = [...basePath, key];
    if (!(key in right)) {
      operations.push({ op: 'remove', path: freeze(path) });
    } else if (!(key in left)) {
      operations.push({ op: 'set', path: freeze(path), value: cloneJson(right[key]) });
    } else {
      operations.push(...diffJsonR25(left[key], right[key], path));
    }
  }

  return freeze(operations);
}

export function applyJsonPatchR25(
  source: unknown,
  operations: readonly PatchOperationR25[],
): unknown {
  let root = cloneJson(source) as unknown;

  for (const operation of operations) {
    if (operation.path.length === 0) {
      root = operation.op === 'set' ? cloneJson(operation.value) : undefined;
      continue;
    }

    root = cloneJson(root);
    let cursor = root as Record<string, unknown> | unknown[];
    for (let index = 0; index < operation.path.length - 1; index += 1) {
      const key = operation.path[index]!;
      const next = operation.path[index + 1]!;
      const objectKey = String(key);

      if (Array.isArray(cursor)) {
        const arrayIndex = Number(key);
        if (!Number.isInteger(arrayIndex) || arrayIndex < 0) {
          throw new Error('R25_PATCH_INVALID_ARRAY_PATH');
        }
        const child = cursor[arrayIndex];
        if (child === undefined || child === null || typeof child !== 'object') {
          cursor[arrayIndex] = typeof next === 'number' ? [] : {};
        }
        cursor = cursor[arrayIndex] as Record<string, unknown> | unknown[];
      } else {
        const child = cursor[objectKey];
        if (child === undefined || child === null || typeof child !== 'object') {
          cursor[objectKey] = typeof next === 'number' ? [] : {};
        }
        cursor = cursor[objectKey] as Record<string, unknown> | unknown[];
      }
    }

    const last = operation.path[operation.path.length - 1]!;
    if (Array.isArray(cursor)) {
      const arrayIndex = Number(last);
      if (!Number.isInteger(arrayIndex) || arrayIndex < 0) {
        throw new Error('R25_PATCH_INVALID_ARRAY_INDEX');
      }
      if (operation.op === 'remove') {
        cursor.splice(arrayIndex, 1);
      } else {
        cursor[arrayIndex] = cloneJson(operation.value);
      }
    } else {
      const key = String(last);
      if (operation.op === 'remove') {
        delete cursor[key];
      } else {
        cursor[key] = cloneJson(operation.value);
      }
    }
  }

  return root;
}

export function compactPatchR25(
  operations: readonly PatchOperationR25[],
  maxOperations = 512,
): readonly PatchOperationR25[] {
  const limit = Math.max(1, Math.trunc(maxOperations));
  if (operations.length <= limit) return freeze([...operations]);
  return freeze([{ op: 'set', path: freeze([]), value: null }]);
}
