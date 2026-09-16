import type { Disposable, Result, RuntimeError, SaveEnvelope, SaveId, SaveMetadata, SaveStoreAdapter, SaveStoreOptions, TimestampMs, WorldSnapshot } from './types';
import { asSaveId, asTimestampMs, err, ok } from './types';
import { stableHash } from './eventBus';

const DEFAULT_NAMESPACE = 'westeros3d-modern';
const MEMORY = new Map<string, string>();

export class MemorySaveAdapter implements SaveStoreAdapter {
  public async get(key: string): Promise<string | null> { return MEMORY.get(key) ?? null; }
  public async set(key: string, value: string): Promise<void> { MEMORY.set(key, value); }
  public async remove(key: string): Promise<void> { MEMORY.delete(key); }
  public async list(prefix: string): Promise<readonly string[]> {
    return [...MEMORY.keys()].filter((key) => key.startsWith(prefix)).sort();
  }
}

export class LocalStorageSaveAdapter implements SaveStoreAdapter {
  private readonly fallback = new MemorySaveAdapter();

  private storage(): Storage | null {
    try {
      if (typeof localStorage === 'undefined') return null;
      const probe = '__aapw_storage_probe__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return localStorage;
    } catch {
      return null;
    }
  }

  public async get(key: string): Promise<string | null> {
    return this.storage()?.getItem(key) ?? this.fallback.get(key);
  }

  public async set(key: string, value: string): Promise<void> {
    const store = this.storage();
    if (!store) return this.fallback.set(key, value);
    store.setItem(key, value);
  }

  public async remove(key: string): Promise<void> {
    const store = this.storage();
    if (!store) return this.fallback.remove(key);
    store.removeItem(key);
  }

  public async list(prefix: string): Promise<readonly string[]> {
    const store = this.storage();
    if (!store) return this.fallback.list(prefix);
    const keys: string[] = [];
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    return keys.sort();
  }
}

export interface SaveCodec<T> {
  encode(value: T): string;
  decode(value: string): T;
}

export const JSON_SAVE_CODEC: SaveCodec<unknown> = {
  encode: (value) => JSON.stringify(value),
  decode: (value) => JSON.parse(value) as unknown,
};

export interface SaveStoreStats {
  readonly saves: number;
  readonly bytes: number;
  readonly namespace: string;
  readonly schemaVersion: number;
}

/**
 * Versioned save store with checksums, atomic temporary writes and legacy-key
 * migration hooks. It is intentionally async so an IndexedDB adapter can be
 * dropped in later without changing gameplay APIs.
 */
export class SaveStore<T = unknown> implements Disposable {
  private readonly namespace: string;
  private readonly schemaVersion: number;
  private readonly maxBytes: number;
  private readonly now: () => TimestampMs;
  private readonly adapter: SaveStoreAdapter;
  private readonly codec: SaveCodec<T>;
  private disposed = false;

  public constructor(options: SaveStoreOptions, codec: SaveCodec<T> = JSON_SAVE_CODEC as SaveCodec<T>) {
    this.namespace = sanitize(options.namespace || DEFAULT_NAMESPACE);
    this.schemaVersion = Math.max(1, Math.floor(options.schemaVersion));
    this.maxBytes = Math.max(1024, Math.floor(options.maxBytes));
    this.now = options.now ?? (() => asTimestampMs(Date.now()));
    this.adapter = options.adapter ?? new LocalStorageSaveAdapter();
    this.codec = codec;
  }

  public key(saveId: SaveId): string {
    return `${this.namespace}:save:${saveId}`;
  }

  public async write(saveId: SaveId, payload: T, label = 'Autosave'): Promise<Result<SaveMetadata, RuntimeError>> {
    this.ensureActive();
    const now = this.now();
    const serialized = this.codec.encode(payload);
    const bytes = utf8Bytes(serialized);
    if (bytes > this.maxBytes) return err(this.error('SAVE_TOO_LARGE', `save is ${bytes} bytes; limit is ${this.maxBytes}`));
    const key = this.key(saveId);
    const previousRaw = await this.adapter.get(key);
    const previous = previousRaw ? this.parseEnvelope(previousRaw) : null;
    const createdAt = previous.ok ? previous.value.createdAt : now;
    const envelope: SaveEnvelope<T> = {
      magic: 'AAPW_SAVE',
      schemaVersion: this.schemaVersion,
      saveId,
      createdAt,
      updatedAt: now,
      checksum: checksum(serialized, this.schemaVersion, saveId),
      payload,
    };
    const encoded = JSON.stringify(envelope);
    const stagingKey = `${key}:staging`;
    await this.adapter.set(stagingKey, encoded);
    const staged = await this.adapter.get(stagingKey);
    if (staged !== encoded) return err(this.error('SAVE_STAGE_VERIFY_FAILED', 'staged save could not be verified'));
    await this.adapter.set(key, encoded);
    await this.adapter.remove(stagingKey);
    const metadata: SaveMetadata = {
      saveId,
      label: sanitizeLabel(label),
      createdAt,
      updatedAt: now,
      bytes: utf8Bytes(encoded),
      schemaVersion: this.schemaVersion,
    };
    await this.writeMetadata(metadata);
    return ok(metadata);
  }

  public async read(saveId: SaveId): Promise<Result<T, RuntimeError>> {
    this.ensureActive();
    const raw = await this.adapter.get(this.key(saveId));
    if (!raw) return err(this.error('SAVE_NOT_FOUND', `save ${saveId} does not exist`));
    const envelope = this.parseEnvelope(raw);
    if (!envelope.ok) return envelope;
    if (envelope.value.schemaVersion > this.schemaVersion) {
      return err(this.error('SAVE_VERSION_NEWER', 'save was created by a newer runtime'));
    }
    if (envelope.value.schemaVersion < this.schemaVersion) {
      const migrated = await this.migrate(envelope.value);
      if (!migrated.ok) return migrated;
      return ok(migrated.value.payload);
    }
    return ok(envelope.value.payload);
  }

  public async inspect(saveId: SaveId): Promise<Result<SaveEnvelope<T>, RuntimeError>> {
    this.ensureActive();
    const raw = await this.adapter.get(this.key(saveId));
    if (!raw) return err(this.error('SAVE_NOT_FOUND', `save ${saveId} does not exist`));
    return this.parseEnvelope(raw);
  }

  public async list(): Promise<readonly SaveMetadata[]> {
    this.ensureActive();
    const keys = await this.adapter.list(`${this.namespace}:meta:`);
    const result: SaveMetadata[] = [];
    for (const key of keys) {
      const value = await this.adapter.get(key);
      if (!value) continue;
      try {
        const metadata = JSON.parse(value) as SaveMetadata;
        if (metadata?.saveId) result.push(metadata);
      } catch {
        // Ignore corrupted index records; the actual save remains addressable.
      }
    }
    return result.sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt));
  }

  public async delete(saveId: SaveId): Promise<void> {
    this.ensureActive();
    await this.adapter.remove(this.key(saveId));
    await this.adapter.remove(this.metadataKey(saveId));
    await this.adapter.remove(`${this.key(saveId)}:staging`);
  }

  public async recoverStaging(): Promise<readonly SaveId[]> {
    this.ensureActive();
    const keys = await this.adapter.list(`${this.namespace}:save:`);
    const recovered: SaveId[] = [];
    for (const key of keys) {
      if (!key.endsWith(':staging')) continue;
      const staged = await this.adapter.get(key);
      const saveId = key.slice(`${this.namespace}:save:`.length, -':staging'.length) as SaveId;
      if (!staged) continue;
      const parsed = this.parseEnvelope(staged);
      if (!parsed.ok) {
        await this.adapter.remove(key);
        continue;
      }
      const canonical = await this.adapter.get(this.key(saveId));
      if (!canonical) {
        await this.adapter.set(this.key(saveId), staged);
        recovered.push(saveId);
      }
      await this.adapter.remove(key);
    }
    return recovered;
  }

  public async migrateLegacy(legacyKey: string, saveId: SaveId): Promise<Result<SaveMetadata, RuntimeError>> {
    this.ensureActive();
    const legacy = await this.adapter.get(legacyKey);
    if (!legacy) return err(this.error('LEGACY_SAVE_NOT_FOUND', `legacy key ${legacyKey} does not exist`));
    let payload: T;
    try {
      payload = this.codec.decode(legacy);
    } catch (cause) {
      return err(this.error('LEGACY_SAVE_INVALID', 'legacy save could not be decoded', cause));
    }
    const result = await this.write(saveId, payload, 'Migrated save');
    if (result.ok) await this.adapter.remove(legacyKey);
    return result;
  }

  public stats(): Promise<SaveStoreStats> {
    return this.list().then(async (saves) => {
      let bytes = 0;
      for (const save of saves) bytes += save.bytes;
      return { saves: saves.length, bytes, namespace: this.namespace, schemaVersion: this.schemaVersion };
    });
  }

  private parseEnvelope(raw: string): Result<SaveEnvelope<T>, RuntimeError> {
    try {
      const envelope = JSON.parse(raw) as SaveEnvelope<T>;
      if (envelope.magic !== 'AAPW_SAVE') return err(this.error('SAVE_MAGIC_INVALID', 'invalid save header'));
      if (!envelope.saveId || !envelope.checksum) return err(this.error('SAVE_HEADER_INVALID', 'missing save header fields'));
      const payloadString = this.codec.encode(envelope.payload);
      const expected = checksum(payloadString, envelope.schemaVersion, envelope.saveId);
      if (expected !== envelope.checksum) return err(this.error('SAVE_CHECKSUM_FAILED', 'save integrity verification failed'));
      return ok(envelope);
    } catch (cause) {
      return err(this.error('SAVE_PARSE_FAILED', 'save could not be parsed', cause));
    }
  }

  private async migrate(envelope: SaveEnvelope<T>): Promise<Result<SaveEnvelope<T>, RuntimeError>> {
    // Schema migrations are explicit instead of silently reshaping gameplay state.
    // Version 1 remains identity-compatible with the current modern snapshot model.
    if (envelope.schemaVersion === 1) return ok({ ...envelope, schemaVersion: this.schemaVersion });
    return err(this.error('SAVE_MIGRATION_UNAVAILABLE', `cannot migrate schema ${envelope.schemaVersion} to ${this.schemaVersion}`));
  }

  private async writeMetadata(metadata: SaveMetadata): Promise<void> {
    await this.adapter.set(this.metadataKey(metadata.saveId), JSON.stringify(metadata));
  }

  private metadataKey(saveId: SaveId): string {
    return `${this.namespace}:meta:${saveId}`;
  }

  private error(code: string, message: string, cause?: unknown): RuntimeError {
    return { code, message, recoverable: true, cause, context: { namespace: this.namespace } };
  }

  private ensureActive(): void {
    if (this.disposed) throw new Error('SAVE_STORE_DISPOSED');
  }

  public dispose(): void {
    this.disposed = true;
  }
}

export interface SnapshotCodec {
  capture(): WorldSnapshot;
  restore(snapshot: WorldSnapshot): void;
}

export interface GameplaySavePayload {
  readonly world: WorldSnapshot;
  readonly player?: Readonly<Record<string, unknown>>;
  readonly quests?: readonly Readonly<Record<string, unknown>>[];
  readonly flags?: Readonly<Record<string, boolean | number | string>>;
  readonly playtimeSeconds: number;
}

export const gameplaySnapshot = (codec: SnapshotCodec, playtimeSeconds: number, extras: Omit<GameplaySavePayload, 'world' | 'playtimeSeconds'> = {}): GameplaySavePayload => ({
  world: codec.capture(),
  playtimeSeconds: Math.max(0, Number.isFinite(playtimeSeconds) ? playtimeSeconds : 0),
  ...extras,
});

const checksum = (payload: string, version: number, saveId: SaveId): string => {
  const value = `${version}|${saveId}|${payload}`;
  return stableHash(value).toString(16).padStart(8, '0');
};

const utf8Bytes = (value: string): number => new TextEncoder().encode(value).byteLength;
const sanitize = (value: string): string => value.replace(/[^a-zA-Z0-9._:-]/g, '_').slice(0, 80) || DEFAULT_NAMESPACE;
const sanitizeLabel = (value: string): string => value.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80) || 'Save';
