import { MigrationStep, SaveDocument, SaveHeader, Tick, asTick, hashString, stableJson } from './contracts.ts';

export interface StorageAdapter {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  keys?(): Promise<readonly string[]>;
}

export interface SavePolicy {
  readonly keyPrefix: string;
  readonly currentSchema: number;
  readonly maxBytes: number;
  readonly slots: number;
}

export interface SaveResult {
  readonly ok: boolean;
  readonly key: string;
  readonly schema: number;
  readonly bytes: number;
  readonly checksum: string;
}

export interface LoadResult<T> {
  readonly document: SaveDocument<T>;
  readonly migrated: boolean;
  readonly sourceSchema: number;
  readonly checksum: string;
}

export const DEFAULT_SAVE_POLICY: SavePolicy = Object.freeze({ keyPrefix: 'aapw:save:', currentSchema: 5, maxBytes: 2 * 1024 * 1024, slots: 8 });

export class MemoryStorage implements StorageAdapter {
  readonly #map = new Map<string, string>();
  async read(key: string): Promise<string | null> { return this.#map.get(key) ?? null; }
  async write(key: string, value: string): Promise<void> { this.#map.set(key, value); }
  async remove(key: string): Promise<void> { this.#map.delete(key); }
  async keys(): Promise<readonly string[]> { return Object.freeze([...this.#map.keys()].sort()); }
}

export const documentChecksum = <T>(header: Omit<SaveHeader, 'checksum'>, state: T): string => hashString(stableJson({ header, state }));

export const encodeSave = <T>(state: T, options: { schema: number; build: string; tick: Tick; updatedAt: number; createdAt?: number }): string => {
  const headerBase = { schema: options.schema, build: options.build, createdAt: options.createdAt ?? options.updatedAt, updatedAt: options.updatedAt, tick: options.tick };
  const header: SaveHeader = Object.freeze({ ...headerBase, checksum: documentChecksum(headerBase, state) });
  return JSON.stringify({ header, state });
};

export const decodeSave = <T>(serialized: string, maxBytes = DEFAULT_SAVE_POLICY.maxBytes): SaveDocument<T> => {
  const bytes = new TextEncoder().encode(serialized).byteLength;
  if (bytes > maxBytes) throw new Error(`save exceeds ${maxBytes} bytes`);
  let parsed: unknown;
  try { parsed = JSON.parse(serialized); } catch { throw new Error('save JSON is invalid'); }
  if (!parsed || typeof parsed !== 'object') throw new Error('save root must be an object');
  const value = parsed as { header?: Partial<SaveHeader>; state?: T };
  const header = value.header;
  if (!header || typeof header.schema !== 'number' || typeof header.build !== 'string' || typeof header.tick !== 'number' || typeof header.checksum !== 'string' || value.state === undefined) throw new Error('save schema is invalid');
  const base = { schema: Math.floor(header.schema), build: header.build, createdAt: Number(header.createdAt ?? 0), updatedAt: Number(header.updatedAt ?? 0), tick: asTick(header.tick) };
  const expected = documentChecksum(base, value.state);
  if (expected !== header.checksum) throw new Error('save checksum mismatch');
  return Object.freeze({ header: Object.freeze({ ...base, checksum: header.checksum }), state: value.state });
};

export class SaveMigrationRegistry<T> {
  readonly #steps: MigrationStep<any, any>[] = [];
  add<TFrom, TTo>(step: MigrationStep<TFrom, TTo>): void {
    if (step.to !== step.from + 1) throw new Error('save migrations must advance one schema at a time');
    if (this.#steps.some((existing) => existing.from === step.from)) throw new Error(`migration ${step.from}->${step.to} already exists`);
    this.#steps.push(step as MigrationStep<any, any>);
    this.#steps.sort((a, b) => a.from - b.from);
  }

  migrate(value: unknown, fromSchema: number, toSchema: number): { state: T; migrated: boolean } {
    if (fromSchema > toSchema) throw new Error('downgrade migrations are not supported');
    let state = value;
    let schema = fromSchema;
    while (schema < toSchema) {
      const step = this.#steps.find((candidate) => candidate.from === schema);
      if (!step) throw new Error(`missing migration ${schema}->${schema + 1}`);
      state = step.migrate(state);
      schema = step.to;
    }
    return { state: state as T, migrated: fromSchema !== toSchema };
  }

  path(fromSchema: number, toSchema: number): readonly number[] {
    const path = [fromSchema];
    for (let schema = fromSchema; schema < toSchema; schema += 1) path.push(schema + 1);
    return Object.freeze(path);
  }
}

export class SaveRepository<T> {
  readonly #storage: StorageAdapter;
  readonly #policy: SavePolicy;
  readonly #migrations: SaveMigrationRegistry<T>;
  readonly #build: string;
  #createdAt = new Map<string, number>();

  constructor(storage: StorageAdapter, policy: SavePolicy = DEFAULT_SAVE_POLICY, migrations = new SaveMigrationRegistry<T>(), build = 'dev') {
    this.#storage = storage;
    this.#policy = policy;
    this.#migrations = migrations;
    this.#build = build;
  }

  key(slot: number): string {
    const normalized = Math.max(0, Math.min(this.#policy.slots - 1, Math.floor(slot)));
    return `${this.#policy.keyPrefix}${normalized}`;
  }

  async save(slot: number, state: T, tick: Tick, now = Date.now()): Promise<SaveResult> {
    const key = this.key(slot);
    const createdAt = this.#createdAt.get(key) ?? now;
    const payload = encodeSave(state, { schema: this.#policy.currentSchema, build: this.#build, tick, updatedAt: now, createdAt });
    const bytes = new TextEncoder().encode(payload).byteLength;
    if (bytes > this.#policy.maxBytes) throw new Error(`save exceeds policy: ${bytes} > ${this.#policy.maxBytes}`);
    await this.#storage.write(key, payload);
    this.#createdAt.set(key, createdAt);
    const document = decodeSave<T>(payload, this.#policy.maxBytes);
    return Object.freeze({ ok: true, key, schema: document.header.schema, bytes, checksum: document.header.checksum });
  }

  async load(slot: number): Promise<LoadResult<T> | null> {
    const key = this.key(slot);
    const serialized = await this.#storage.read(key);
    if (!serialized) return null;
    const source = decodeSave<unknown>(serialized, this.#policy.maxBytes);
    const migrated = this.#migrations.migrate(source.state, source.header.schema, this.#policy.currentSchema);
    const document = migrated.migrated
      ? decodeSave<T>(encodeSave(migrated.state, { schema: this.#policy.currentSchema, build: this.#build, tick: source.header.tick, createdAt: source.header.createdAt, updatedAt: Date.now() }), this.#policy.maxBytes)
      : source as SaveDocument<T>;
    return Object.freeze({ document, migrated: migrated.migrated, sourceSchema: source.header.schema, checksum: document.header.checksum });
  }

  async remove(slot: number): Promise<void> { await this.#storage.remove(this.key(slot)); }
  async list(): Promise<readonly string[]> { const keys = await this.#storage.keys?.(); return keys ? Object.freeze(keys.filter((key) => key.startsWith(this.#policy.keyPrefix))) : Object.freeze([]); }
}

export const localStorageAdapter = (): StorageAdapter => ({
  async read(key) { try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; } },
  async write(key, value) { try { globalThis.localStorage?.setItem(key, value); } catch (error) { throw new Error(`localStorage write failed: ${String(error)}`); } },
  async remove(key) { try { globalThis.localStorage?.removeItem(key); } catch { /* best effort */ } },
  async keys() { try { return Object.freeze(Object.keys(globalThis.localStorage ?? {}).sort()); } catch { return Object.freeze([]); } },
});
