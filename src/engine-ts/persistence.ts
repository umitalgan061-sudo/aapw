import type { Result, Tick } from './coreTypes.ts';
import { REVISION, err, ok, safeJson } from './coreTypes.ts';

export const SAVE_FORMAT = 'aapw-save-v2' as const;
export const SAVE_SCHEMA_VERSION = 2 as const;
export type SaveSlot = `slot-${number}` | 'autosave' | 'quicksave' | 'recovery';

export interface SaveMetadata {
  readonly format: typeof SAVE_FORMAT;
  readonly schemaVersion: typeof SAVE_SCHEMA_VERSION;
  readonly slot: SaveSlot;
  readonly revision: number;
  readonly createdAtTick: Tick;
  readonly updatedAtTick: Tick;
  readonly playtimeSeconds: number;
  readonly worldSeed: string;
  readonly phase: string;
  readonly checksum: string;
  readonly payloadBytes: number;
}

export interface SaveEnvelope<T extends object = Record<string, unknown>> {
  readonly metadata: SaveMetadata;
  readonly payload: T;
}

export interface SaveStorage {
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
}

export interface AsyncSaveStorage {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface SaveJournalEntry {
  readonly revision: number;
  readonly checksum: string;
  readonly bytes: number;
  readonly tick: Tick;
  readonly committedAtMs: number;
}

export interface SaveRepositoryOptions {
  readonly namespace?: string;
  readonly backupSuffix?: string;
  readonly maxPayloadBytes?: number;
  readonly maxJournalEntries?: number;
}

const textEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
const byteLength = (value: string): number => textEncoder?.encode(value).byteLength ?? value.length;

const fnv1a = (text: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

const canonicalize = (value: unknown): unknown => {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) return null;
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  );
};

export const checksumPayload = (payload: unknown): string =>
  fnv1a(safeJson(canonicalize(payload)));

const parseEnvelope = <T extends object>(raw: string): Result<SaveEnvelope<T>, string> => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return err('save envelope is not an object');
    const envelope = parsed as Record<string, unknown>;
    const metadata = envelope.metadata;
    const payload = envelope.payload;
    if (!metadata || typeof metadata !== 'object' || !payload || typeof payload !== 'object') {
      return err('save envelope missing metadata or payload');
    }
    const meta = metadata as Record<string, unknown>;
    if (meta.format !== SAVE_FORMAT) return err('unsupported save format');
    if (meta.schemaVersion !== SAVE_SCHEMA_VERSION) return err('unsupported save schema');
    if (typeof meta.slot !== 'string' || typeof meta.revision !== 'number') return err('invalid save metadata');
    if (typeof meta.checksum !== 'string') return err('missing save checksum');
    if (checksumPayload(payload) !== meta.checksum) return err('save checksum mismatch');
    return ok({ metadata: meta as unknown as SaveMetadata, payload: payload as T });
  } catch (cause) {
    return err(cause instanceof Error ? cause.message : 'invalid save JSON');
  }
};

const defaultStorage = (): SaveStorage => {
  if (typeof localStorage !== 'undefined') {
    return {
      read: key => localStorage.getItem(key),
      write: (key, value) => localStorage.setItem(key, value),
      remove: key => localStorage.removeItem(key),
    };
  }
  const memory = new Map<string, string>();
  return {
    read: key => memory.get(key) ?? null,
    write: (key, value) => { memory.set(key, value); },
    remove: key => { memory.delete(key); },
  };
};

const defaultAsyncStorage = (): AsyncSaveStorage => {
  const sync = defaultStorage();
  return { read: key => Promise.resolve(sync.read(key)), write: (key, value) => Promise.resolve(sync.write(key, value)), remove: key => Promise.resolve(sync.remove(key)) };
};

export class SaveRepository<T extends object = Record<string, unknown>> {
  private readonly storage: SaveStorage;
  private readonly namespace: string;
  private readonly backupSuffix: string;
  private readonly maxPayloadBytes: number;
  private readonly maxJournalEntries: number;
  private readonly journal: SaveJournalEntry[] = [];
  private revisionValue = 0;

  constructor(storage: SaveStorage = defaultStorage(), options: SaveRepositoryOptions = {}) {
    this.storage = storage;
    this.namespace = options.namespace ?? 'aapw:save';
    this.backupSuffix = options.backupSuffix ?? ':backup';
    this.maxPayloadBytes = Math.max(1024, options.maxPayloadBytes ?? 4_000_000);
    this.maxJournalEntries = Math.max(4, Math.trunc(options.maxJournalEntries ?? 32));
  }

  key(slot: SaveSlot): string { return `${this.namespace}:${slot}`; }
  backupKey(slot: SaveSlot): string { return `${this.key(slot)}${this.backupSuffix}`; }

  get revision(): number { return this.revisionValue; }
  get history(): readonly SaveJournalEntry[] { return [...this.journal]; }

  inspect(slot: SaveSlot): Result<SaveMetadata, string> {
    const raw = this.storage.read(this.key(slot));
    if (!raw) return err('save slot is empty');
    const parsed = parseEnvelope<T>(raw);
    return parsed.ok ? ok(parsed.value.metadata) : err(parsed.error);
  }

  load(slot: SaveSlot): Result<SaveEnvelope<T>, string> {
    const primary = this.storage.read(this.key(slot));
    if (primary) {
      const parsed = parseEnvelope<T>(primary);
      if (parsed.ok) {
        this.revisionValue = Math.max(this.revisionValue, parsed.value.metadata.revision);
        return parsed;
      }
    }
    const backup = this.storage.read(this.backupKey(slot));
    if (!backup) return err('save slot unavailable');
    const parsedBackup = parseEnvelope<T>(backup);
    if (!parsedBackup.ok) return err(`save recovery failed: ${parsedBackup.error}`);
    this.revisionValue = Math.max(this.revisionValue, parsedBackup.value.metadata.revision);
    return parsedBackup;
  }

  save(slot: SaveSlot, payload: T, context: Omit<SaveMetadata, 'format' | 'schemaVersion' | 'slot' | 'revision' | 'checksum' | 'payloadBytes'>): Result<SaveEnvelope<T>, string> {
    const normalizedPayload = canonicalize(payload) as T;
    const payloadChecksum = checksumPayload(normalizedPayload);
    const nextRevision = Math.max(this.revisionValue + 1, 1);
    const preliminary = { format: SAVE_FORMAT, schemaVersion: SAVE_SCHEMA_VERSION, slot, revision: nextRevision, ...context, checksum: payloadChecksum, payloadBytes: byteLength(safeJson(normalizedPayload)) } as SaveMetadata;
    if (preliminary.payloadBytes > this.maxPayloadBytes) return err(`save payload exceeds ${this.maxPayloadBytes} bytes`);
    const envelope: SaveEnvelope<T> = Object.freeze({ metadata: Object.freeze(preliminary), payload: normalizedPayload });
    const raw = JSON.stringify(envelope);
    try {
      const previous = this.storage.read(this.key(slot));
      if (previous) this.storage.write(this.backupKey(slot), previous);
      this.storage.write(this.key(slot), raw);
      this.revisionValue = nextRevision;
      this.journal.push(Object.freeze({ revision: nextRevision, checksum: payloadChecksum, bytes: byteLength(raw), tick: context.updatedAtTick, committedAtMs: Date.now() }));
      while (this.journal.length > this.maxJournalEntries) this.journal.shift();
      return ok(envelope);
    } catch (cause) {
      return err(cause instanceof Error ? cause.message : 'save write failed');
    }
  }

  remove(slot: SaveSlot): Result<void, string> {
    try {
      this.storage.remove(this.key(slot));
      this.storage.remove(this.backupKey(slot));
      return ok(undefined);
    } catch (cause) {
      return err(cause instanceof Error ? cause.message : 'save removal failed');
    }
  }
}

export interface AsyncSaveRepositoryOptions extends SaveRepositoryOptions {
  readonly now?: () => number;
}

export class AsyncSaveRepository<T extends object = Record<string, unknown>> {
  private readonly storage: AsyncSaveStorage;
  private readonly namespace: string;
  private readonly backupSuffix: string;
  private readonly maxPayloadBytes: number;
  private readonly now: () => number;
  private revisionValue = 0;

  constructor(storage = defaultAsyncStorage(), options: AsyncSaveRepositoryOptions = {}) {
    this.storage = storage;
    this.namespace = options.namespace ?? 'aapw:async-save';
    this.backupSuffix = options.backupSuffix ?? ':backup';
    this.maxPayloadBytes = Math.max(1024, options.maxPayloadBytes ?? 8_000_000);
    this.now = options.now ?? (() => Date.now());
  }

  private key(slot: SaveSlot): string { return `${this.namespace}:${slot}`; }
  private backupKey(slot: SaveSlot): string { return `${this.key(slot)}${this.backupSuffix}`; }

  async load(slot: SaveSlot): Promise<Result<SaveEnvelope<T>, string>> {
    const raw = await this.storage.read(this.key(slot));
    if (raw) {
      const primary = parseEnvelope<T>(raw);
      if (primary.ok) {
        this.revisionValue = Math.max(this.revisionValue, primary.value.metadata.revision);
        return primary;
      }
    }
    const backupRaw = await this.storage.read(this.backupKey(slot));
    if (!backupRaw) return err('save slot unavailable');
    const backup = parseEnvelope<T>(backupRaw);
    if (!backup.ok) return err(backup.error);
    this.revisionValue = Math.max(this.revisionValue, backup.value.metadata.revision);
    return backup;
  }

  async save(slot: SaveSlot, payload: T, context: Omit<SaveMetadata, 'format' | 'schemaVersion' | 'slot' | 'revision' | 'checksum' | 'payloadBytes'>): Promise<Result<SaveEnvelope<T>, string>> {
    const normalizedPayload = canonicalize(payload) as T;
    const rawPayload = safeJson(normalizedPayload);
    const payloadBytes = byteLength(rawPayload);
    if (payloadBytes > this.maxPayloadBytes) return err(`save payload exceeds ${this.maxPayloadBytes} bytes`);
    const revision = Math.max(1, this.revisionValue + 1);
    const envelope: SaveEnvelope<T> = Object.freeze({
      metadata: Object.freeze({ format: SAVE_FORMAT, schemaVersion: SAVE_SCHEMA_VERSION, slot, revision, ...context, checksum: checksumPayload(normalizedPayload), payloadBytes }),
      payload: normalizedPayload,
    });
    const raw = JSON.stringify(envelope);
    try {
      const previous = await this.storage.read(this.key(slot));
      if (previous) await this.storage.write(this.backupKey(slot), previous);
      await this.storage.write(this.key(slot), raw);
      this.revisionValue = revision;
      return ok(envelope);
    } catch (cause) {
      return err(cause instanceof Error ? cause.message : 'async save write failed');
    }
  }

  timestamp(): number { return this.now(); }
  revision(): number { return REVISION(this.revisionValue); }
}

export interface GameplaySnapshot {
  readonly player: { readonly x: number; readonly y: number; readonly z: number; readonly health: number };
  readonly world: { readonly seed: string; readonly phase: string; readonly day: number; readonly weather: string };
  readonly questFlags: readonly string[];
  readonly inventory: readonly { readonly id: string; readonly count: number }[];
  readonly settings: { readonly quality: string; readonly audioMuted: boolean };
}

export const validateGameplaySnapshot = (value: unknown): value is GameplaySnapshot => {
  if (!value || typeof value !== 'object') return false;
  const root = value as Record<string, unknown>;
  const player = root.player;
  const world = root.world;
  return !!player && typeof player === 'object'
    && Number.isFinite((player as Record<string, unknown>).x)
    && Number.isFinite((player as Record<string, unknown>).y)
    && Number.isFinite((player as Record<string, unknown>).z)
    && Number.isFinite((player as Record<string, unknown>).health)
    && !!world && typeof world === 'object'
    && typeof (world as Record<string, unknown>).seed === 'string'
    && typeof (world as Record<string, unknown>).phase === 'string'
    && Number.isFinite((world as Record<string, unknown>).day)
    && typeof (world as Record<string, unknown>).weather === 'string'
    && Array.isArray(root.questFlags)
    && root.questFlags.every(flag => typeof flag === 'string')
    && Array.isArray(root.inventory)
    && root.inventory.every(item => !!item && typeof item === 'object' && typeof (item as Record<string, unknown>).id === 'string' && Number.isFinite((item as Record<string, unknown>).count))
    && !!root.settings && typeof root.settings === 'object'
    && typeof (root.settings as Record<string, unknown>).quality === 'string'
    && typeof (root.settings as Record<string, unknown>).audioMuted === 'boolean';
};
