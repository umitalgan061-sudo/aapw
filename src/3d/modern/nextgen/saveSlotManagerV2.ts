import { Revision, SaveEnvelope, Tick, hashString, stableChecksum, tickValue } from './types.ts';

export interface SaveSlotMetadata {
  slot: string;
  title: string;
  playtimeSeconds: number;
  location?: string;
  updatedTick: Tick;
  revision: Revision;
  checksum: number;
}
export interface SaveSlot { metadata: SaveSlotMetadata; envelope: SaveEnvelope; }
export interface SaveStorage { read(key: string): string | null; write(key: string, value: string): void; remove(key: string): void; keys(): readonly string[]; }
export interface MigrationStep { from: number; to: number; migrate(value: SaveEnvelope): SaveEnvelope; }
export interface SaveManagerConfig { schemaVersion: number; maxSlots: number; keyPrefix: string; maxSerializedBytes: number; }
const DEFAULT_CONFIG: SaveManagerConfig = { schemaVersion: 2, maxSlots: 12, keyPrefix: 'aapw:save:', maxSerializedBytes: 2 * 1024 * 1024 };

function encode(slot: SaveSlot): string { return JSON.stringify(slot); }
function cloneEnvelope(envelope: SaveEnvelope): SaveEnvelope { return JSON.parse(JSON.stringify(envelope)) as SaveEnvelope; }

export class MemorySaveStorage implements SaveStorage {
  readonly #data = new Map<string, string>();
  read(key: string): string | null { return this.#data.get(key) ?? null; }
  write(key: string, value: string): void { this.#data.set(key, value); }
  remove(key: string): void { this.#data.delete(key); }
  keys(): string[] { return [...this.#data.keys()]; }
}

export class LocalStorageSaveStorage implements SaveStorage {
  readonly #storage: Storage;
  constructor(storage?: Storage) {
    if (storage) this.#storage = storage;
    else if (typeof localStorage !== 'undefined') this.#storage = localStorage;
    else throw new Error('localStorage is unavailable');
  }
  read(key: string): string | null { return this.#storage.getItem(key); }
  write(key: string, value: string): void { this.#storage.setItem(key, value); }
  remove(key: string): void { this.#storage.removeItem(key); }
  keys(): string[] { return Array.from({ length: this.#storage.length }, (_, index) => this.#storage.key(index)).filter((value): value is string => value !== null); }
}

export class SaveSlotManagerV2 {
  readonly #storage: SaveStorage;
  readonly #config: SaveManagerConfig;
  readonly #migrations = new Map<number, MigrationStep>();

  constructor(storage: SaveStorage, config: Partial<SaveManagerConfig> = {}) {
    this.#storage = storage;
    this.#config = { ...DEFAULT_CONFIG, ...config };
    if (this.#config.schemaVersion <= 0 || this.#config.maxSlots <= 0 || this.#config.maxSerializedBytes <= 0) throw new RangeError('Invalid save manager configuration');
  }

  registerMigration(step: MigrationStep): void {
    if (!Number.isInteger(step.from) || !Number.isInteger(step.to) || step.to !== step.from + 1) throw new RangeError('Migrations must advance exactly one schema version');
    if (this.#migrations.has(step.from)) throw new Error(`Migration ${step.from}->${step.to} already exists`);
    this.#migrations.set(step.from, step);
  }

  save(slot: string, envelope: SaveEnvelope, metadata: Omit<SaveSlotMetadata, 'slot' | 'revision' | 'checksum'>): SaveSlotMetadata {
    const normalized = this.#normalizeSlot(slot);
    if (envelope.header.version !== this.#config.schemaVersion) throw new Error(`Unsupported save version ${envelope.header.version}`);
    this.#validateEnvelope(envelope);
    const revision = envelope.header.revision;
    const bodyMetadata = { slot: normalized, ...metadata, revision };
    const metadataRecord: SaveSlotMetadata = { ...bodyMetadata, checksum: stableChecksum(bodyMetadata) };
    const save: SaveSlot = { metadata: metadataRecord, envelope: cloneEnvelope(envelope) };
    const serialized = encode(save);
    if (new TextEncoder().encode(serialized).byteLength > this.#config.maxSerializedBytes) throw new RangeError('Serialized save exceeds configured size');
    this.#storage.write(this.#key(normalized), serialized);
    this.#pruneSlots();
    return { ...metadataRecord };
  }

  load(slot: string): SaveSlot | undefined {
    const normalized = this.#normalizeSlot(slot);
    const raw = this.#storage.read(this.#key(normalized));
    if (!raw) return undefined;
    let parsed: SaveSlot;
    try { parsed = JSON.parse(raw) as SaveSlot; } catch { this.#storage.remove(this.#key(normalized)); throw new Error('Corrupt save JSON'); }
    const metadataBody: Record<string, unknown> = {
      slot: parsed.metadata.slot,
      title: parsed.metadata.title,
      playtimeSeconds: parsed.metadata.playtimeSeconds,
      updatedTick: parsed.metadata.updatedTick,
      revision: parsed.metadata.revision,
    };
    if (parsed.metadata.location !== undefined) metadataBody.location = parsed.metadata.location;
    if (stableChecksum(metadataBody) !== parsed.metadata.checksum) throw new Error('Save metadata checksum mismatch');
    const migrated = this.#migrate(parsed.envelope);
    this.#validateEnvelope(migrated);
    const metadata: SaveSlotMetadata = { ...parsed.metadata, revision: migrated.header.revision };
    return { metadata, envelope: cloneEnvelope(migrated) };
  }

  delete(slot: string): boolean {
    const normalized = this.#normalizeSlot(slot);
    const exists = this.#storage.read(this.#key(normalized)) !== null;
    this.#storage.remove(this.#key(normalized));
    return exists;
  }

  list(): SaveSlotMetadata[] {
    const metadata: SaveSlotMetadata[] = [];
    for (const key of this.#storage.keys()) {
      if (!key.startsWith(this.#config.keyPrefix)) continue;
      const slot = key.slice(this.#config.keyPrefix.length);
      try {
        const raw = this.#storage.read(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw) as SaveSlot;
        metadata.push({ ...parsed.metadata, slot: slot || parsed.metadata.slot });
      } catch {
        // Corrupt saves remain visible only through storageKeys/delete.
      }
    }
    return metadata.sort((a, b) => Number(b.updatedTick) - Number(a.updatedTick) || a.slot.localeCompare(b.slot));
  }

  has(slot: string): boolean { return this.#storage.read(this.#key(this.#normalizeSlot(slot))) !== null; }

  export(slot: string): string {
    const save = this.load(slot);
    if (!save) throw new Error(`Save ${slot} not found`);
    return encode(save);
  }

  import(serialized: string, slotOverride?: string): SaveSlotMetadata {
    if (new TextEncoder().encode(serialized).byteLength > this.#config.maxSerializedBytes) throw new RangeError('Serialized save exceeds configured size');
    const parsed = JSON.parse(serialized) as SaveSlot;
    const migrated = this.#migrate(parsed.envelope);
    this.#validateEnvelope(migrated);
    const slot = slotOverride ?? parsed.metadata.slot;
    const metadata: Omit<SaveSlotMetadata, 'slot' | 'revision' | 'checksum'> = {
      title: parsed.metadata.title,
      playtimeSeconds: parsed.metadata.playtimeSeconds,
      updatedTick: migrated.header.tick,
    };
    if (parsed.metadata.location !== undefined) metadata.location = parsed.metadata.location;
    return this.save(slot, migrated, metadata);
  }

  storageKeys(): string[] { return this.#storage.keys().filter((key) => key.startsWith(this.#config.keyPrefix)); }
  digest(): number { return hashString(JSON.stringify(this.list())); }

  #normalizeSlot(slot: string): string {
    const value = slot.trim();
    if (!value || value.length > 64 || !/^[a-zA-Z0-9_-]+$/.test(value)) throw new RangeError('Save slot must match [a-zA-Z0-9_-]{1,64}');
    return value;
  }
  #key(slot: string): string { return `${this.#config.keyPrefix}${slot}`; }

  #validateEnvelope(envelope: SaveEnvelope): void {
    if (envelope.header.magic !== 'AAPW-SAVE') throw new Error('Invalid save magic');
    if (envelope.header.version <= 0 || envelope.header.version > this.#config.schemaVersion) throw new Error(`Unsupported save schema ${envelope.header.version}`);
    if (envelope.world.checksum !== stableChecksum(envelope.world.entities)) throw new Error('World checksum mismatch');
    if (!Number.isInteger(Number(envelope.header.tick)) || Number(envelope.header.tick) < 0) throw new Error('Invalid save tick');
  }

  #migrate(input: SaveEnvelope): SaveEnvelope {
    let current = cloneEnvelope(input);
    while (current.header.version < this.#config.schemaVersion) {
      const step = this.#migrations.get(current.header.version);
      if (!step) throw new Error(`Missing migration ${current.header.version}->${current.header.version + 1}`);
      current = step.migrate(current);
      if (current.header.version !== step.to) throw new Error(`Migration ${step.from}->${step.to} returned version ${current.header.version}`);
    }
    return current;
  }

  #pruneSlots(): void {
    const slots = this.list();
    if (slots.length <= this.#config.maxSlots) return;
    for (const slot of slots.slice(this.#config.maxSlots)) this.delete(slot.slot);
  }
}

export function createSaveEnvelope(world: SaveEnvelope['world'], tick: Tick, revision: Revision, metadata: Record<string, string | number | boolean> = {}): SaveEnvelope {
  const headerBase = { magic: 'AAPW-SAVE', version: 2, tick, revision };
  return { header: { ...headerBase, checksum: stableChecksum(headerBase) }, world, metadata };
}
export function nextSaveRevision(previous: Revision): Revision { return (Number(previous) + 1) as Revision; }
export function zeroSaveTick(): Tick { return tickValue(0); }
