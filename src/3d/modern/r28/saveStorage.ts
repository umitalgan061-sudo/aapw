import type { SaveRecord } from '../r27/save.ts';
import type { SaveSlotId } from '../r27/contracts.ts';

export interface SaveStorage {
  get(slot: SaveSlotId): Promise<string | null>;
  set(slot: SaveSlotId, value: string): Promise<void>;
  remove(slot: SaveSlotId): Promise<void>;
  keys(): Promise<readonly SaveSlotId[]>;
}

export class BrowserLocalSaveStorage implements SaveStorage {
  readonly prefix: string;
  #memory = new Map<SaveSlotId, string>();

  constructor(prefix = 'aapw:r27:save:') {
    this.prefix = prefix;
  }

  async get(slot: SaveSlotId): Promise<string | null> {
    try {
      const value = window.localStorage.getItem(this.prefix + String(slot));
      return value ?? this.#memory.get(slot) ?? null;
    } catch {
      return this.#memory.get(slot) ?? null;
    }
  }

  async set(slot: SaveSlotId, value: string): Promise<void> {
    this.#memory.set(slot, value);
    try {
      window.localStorage.setItem(this.prefix + String(slot), value);
    } catch {
      // Memory fallback remains authoritative for this session.
    }
  }

  async remove(slot: SaveSlotId): Promise<void> {
    this.#memory.delete(slot);
    try {
      window.localStorage.removeItem(this.prefix + String(slot));
    } catch {
      // Memory fallback has already been cleared.
    }
  }

  async keys(): Promise<readonly SaveSlotId[]> {
    const values = new Set<SaveSlotId>(this.#memory.keys());
    try {
      for (let index = 0; index < window.localStorage.length; index++) {
        const key = window.localStorage.key(index);
        if (key?.startsWith(this.prefix)) values.add(key.slice(this.prefix.length) as SaveSlotId);
      }
    } catch {
      // Return memory keys only.
    }
    return [...values].sort((a, b) => String(a).localeCompare(String(b)));
  }
}

export class SaveStorageAdapter<T> {
  constructor(
    private readonly storage: SaveStorage,
    private readonly encode: (value: T) => string,
    private readonly decode: (value: string) => T,
  ) {}

  async write(record: SaveRecord<T>): Promise<void> {
    await this.storage.set(record.header.slot, this.encode(record));
  }

  async read(slot: SaveSlotId): Promise<SaveRecord<T> | null> {
    const value = await this.storage.get(slot);
    return value === null ? null : this.decode(value) as SaveRecord<T>;
  }

  async remove(slot: SaveSlotId): Promise<void> {
    await this.storage.remove(slot);
  }

  async slots(): Promise<readonly SaveSlotId[]> {
    return this.storage.keys();
  }
}
