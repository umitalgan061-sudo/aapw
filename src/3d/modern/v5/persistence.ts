import { SaveEnvelope, RuntimeSnapshot, EntityRecord, Tick, checksumObject, stableStringify, asTick, RUNTIME_SCHEMA, cloneEntity } from './domain.ts';
import { EcsWorldV5 } from './ecs.ts';

export interface SaveStorage {
  read(key: string): string | null | Promise<string | null>;
  write(key: string, value: string): void | Promise<void>;
  remove?(key: string): void | Promise<void>;
}

export interface SavePolicy {
  readonly key: string;
  readonly maxBytes: number;
  readonly backupCount: number;
  readonly debounceTicks: number;
}

export const DEFAULT_SAVE_POLICY: SavePolicy = Object.freeze({ key: 'aapw.runtime.v5', maxBytes: 16 * 1024 * 1024, backupCount: 2, debounceTicks: 30 });

export interface SaveResult {
  readonly ok: boolean;
  readonly bytes: number;
  readonly checksum: string;
  readonly tick: Tick;
  readonly error: string | null;
}

export interface LoadResult {
  readonly ok: boolean;
  readonly snapshot: RuntimeSnapshot | null;
  readonly error: string | null;
}

export class MemorySaveStorage implements SaveStorage {
  readonly #data = new Map<string, string>();
  read(key: string): string | null { return this.#data.get(key) ?? null; }
  write(key: string, value: string): void { this.#data.set(key, value); }
  remove(key: string): void { this.#data.delete(key); }
  keys(): readonly string[] { return [...this.#data.keys()].sort(); }
}

const encode = (snapshot: RuntimeSnapshot): string => {
  const envelope: SaveEnvelope = {
    schema: 'aapw-runtime-v5',
    version: 5,
    createdAtEpochMs: Date.now(),
    snapshot,
    checksum: checksumObject(snapshot),
  };
  return stableStringify(envelope);
};

const parseEnvelope = (raw: string): SaveEnvelope => {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) throw new Error('save payload must be an object');
  const envelope = parsed as Partial<SaveEnvelope>;
  if (envelope.schema !== 'aapw-runtime-v5' || envelope.version !== 5) throw new Error('unsupported save schema');
  if (!envelope.snapshot || typeof envelope.checksum !== 'string') throw new Error('invalid save envelope');
  const expected = checksumObject(envelope.snapshot);
  if (expected !== envelope.checksum) throw new Error('save checksum mismatch');
  return envelope as SaveEnvelope;
};

export class SaveRuntimeV5 {
  #lastSavedTick = asTick(0);
  readonly #policy: SavePolicy;
  readonly #storage: SaveStorage;

  constructor(storage: SaveStorage = new MemorySaveStorage(), policy: Partial<SavePolicy> = {}) {
    this.#storage = storage;
    this.#policy = { ...DEFAULT_SAVE_POLICY, ...policy };
    if (this.#policy.maxBytes < 1024) throw new RangeError('save maxBytes is too small');
  }

  async save(snapshot: RuntimeSnapshot): Promise<SaveResult> {
    if (snapshot.version !== 5) return { ok: false, bytes: 0, checksum: '', tick: snapshot.tick, error: 'unsupported-runtime-version' };
    const encoded = encode(snapshot);
    const bytes = new TextEncoder().encode(encoded).byteLength;
    if (bytes > this.#policy.maxBytes) return { ok: false, bytes, checksum: '', tick: snapshot.tick, error: 'save-size-limit' };
    const checksum = checksumObject(snapshot);
    try {
      const previous = await this.#storage.read(this.#policy.key);
      for (let index = this.#policy.backupCount - 1; index >= 1; index -= 1) {
        const source = index === 1 ? this.#policy.key : `${this.#policy.key}.bak${index - 1}`;
        const target = `${this.#policy.key}.bak${index}`;
        const value = await this.#storage.read(source);
        if (value !== null) await this.#storage.write(target, value);
      }
      if (previous !== null && this.#policy.backupCount > 0) await this.#storage.write(`${this.#policy.key}.bak1`, previous);
      await this.#storage.write(this.#policy.key, encoded);
      this.#lastSavedTick = snapshot.tick;
      return { ok: true, bytes, checksum, tick: snapshot.tick, error: null };
    } catch (error) {
      return { ok: false, bytes, checksum, tick: snapshot.tick, error: error instanceof Error ? error.message : 'save-failed' };
    }
  }

  async load(): Promise<LoadResult> {
    try {
      const raw = await this.#storage.read(this.#policy.key);
      if (!raw) return { ok: false, snapshot: null, error: 'save-not-found' };
      const envelope = parseEnvelope(raw);
      return { ok: true, snapshot: {
        ...envelope.snapshot,
        entities: envelope.snapshot.entities.map(cloneEntity),
      }, error: null };
    } catch (error) {
      return { ok: false, snapshot: null, error: error instanceof Error ? error.message : 'load-failed' };
    }
  }

  async loadBackup(index = 1): Promise<LoadResult> {
    if (!Number.isInteger(index) || index < 1 || index > this.#policy.backupCount) return { ok: false, snapshot: null, error: 'invalid-backup-index' };
    try {
      const raw = await this.#storage.read(`${this.#policy.key}.bak${index}`);
      if (!raw) return { ok: false, snapshot: null, error: 'backup-not-found' };
      const envelope = parseEnvelope(raw);
      return { ok: true, snapshot: { ...envelope.snapshot, entities: envelope.snapshot.entities.map(cloneEntity) }, error: null };
    } catch (error) {
      return { ok: false, snapshot: null, error: error instanceof Error ? error.message : 'backup-load-failed' };
    }
  }

  shouldSave(tick: Tick): boolean {
    return Number(tick) - Number(this.#lastSavedTick) >= this.#policy.debounceTicks;
  }

  lastSavedTick(): Tick { return this.#lastSavedTick; }

  async remove(): Promise<void> {
    if (this.#storage.remove) {
      await this.#storage.remove(this.#policy.key);
      for (let index = 1; index <= this.#policy.backupCount; index += 1) await this.#storage.remove(`${this.#policy.key}.bak${index}`);
    }
  }
}

export const snapshotFromWorld = (world: EcsWorldV5, metadata: Readonly<Record<string, unknown>> = {}): RuntimeSnapshot => {
  const entities = world.snapshot();
  const digest = {
    tick: world.tick,
    entityCount: entities.length,
    commandCount: 0,
    eventCount: 0,
    checksum: checksumObject(entities),
  };
  return { version: 5, tick: world.tick, digest, entities, metadata };
};

export const restoreWorld = (world: EcsWorldV5, snapshot: RuntimeSnapshot): void => {
  if (snapshot.version !== 5) throw new Error(`Unsupported snapshot version ${snapshot.version}`);
  world.restore(snapshot.entities.map((entity) => cloneEntity(entity)), asTick(Number(snapshot.tick)));
};

export const schemaCompatibility = (): { schema: string; version: number; minReaderVersion: number; minWriterVersion: number } => ({ ...RUNTIME_SCHEMA });
