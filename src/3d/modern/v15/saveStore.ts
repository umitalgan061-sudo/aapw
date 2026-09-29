import {
  checksumV15,
  revisionV15,
  stableStringifyV15,
  tickV15,
  type RevisionV15,
  type SaveEnvelopeV15,
  type TickV15,
} from "./types.ts";

export interface SaveStorageV15 {
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
  keys(): readonly string[];
}

export class MemorySaveStorageV15 implements SaveStorageV15 {
  readonly #values = new Map<string, string>();
  read(key: string): string | null { return this.#values.get(key) ?? null; }
  write(key: string, value: string): void { this.#values.set(key, value); }
  remove(key: string): void { this.#values.delete(key); }
  keys(): readonly string[] { return Object.freeze([...this.#values.keys()].sort()); }
}

export class LocalSaveStorageV15 implements SaveStorageV15 {
  readonly #storage: Storage;
  constructor(storage?: Storage) {
    if (storage) this.#storage = storage;
    else if (typeof localStorage !== "undefined") this.#storage = localStorage;
    else throw new Error("localStorage unavailable");
  }
  read(key: string): string | null { return this.#storage.getItem(key); }
  write(key: string, value: string): void { this.#storage.setItem(key, value); }
  remove(key: string): void { this.#storage.removeItem(key); }
  keys(): readonly string[] {
    const keys: string[] = [];
    for (let index = 0; index < this.#storage.length; index += 1) {
      const key = this.#storage.key(index);
      if (key) keys.push(key);
    }
    return Object.freeze(keys.sort());
  }
}

export interface SaveSlotV15<T> {
  readonly slot: string;
  readonly envelope: SaveEnvelopeV15<T>;
  readonly metadata: Readonly<{ title: string; location?: string; playtimeSeconds: number }>;
}

export interface SaveManagerOptionsV15 {
  readonly prefix?: string;
  readonly maxSerializedBytes?: number;
  readonly now?: () => number;
}

interface StoredSaveV15<T> {
  readonly slot: string;
  readonly envelope: SaveEnvelopeV15<T>;
  readonly metadata: SaveSlotV15<T>["metadata"];
}

export class SaveManagerV15<T> {
  readonly #storage: SaveStorageV15;
  readonly #prefix: string;
  readonly #maxBytes: number;
  readonly #now: () => number;
  #revision = revisionV15(0);

  constructor(storage: SaveStorageV15, options: SaveManagerOptionsV15 = {}) {
    this.#storage = storage;
    this.#prefix = options.prefix ?? "aapw:v15:save:";
    this.#maxBytes = Math.max(1_024, Math.floor(options.maxSerializedBytes ?? 1_500_000));
    this.#now = options.now ?? (() => Date.now());
  }

  save(slot: string, payload: T, tick: TickV15, metadata: SaveSlotV15<T>["metadata"]): SaveSlotV15<T> {
    const normalized = normalizeSlotV15(slot);
    if (!Number.isInteger(Number(tick)) || Number(tick) < 0) throw new RangeError("invalid save tick");
    const revision = revisionV15(Number(this.#revision) + 1);
    const base: Omit<SaveEnvelopeV15<T>, "checksum"> = {
      magic: "AAPW-SAVE-V15",
      version: 15,
      revision,
      tick,
      createdAt: this.#now(),
      payload,
    };
    const envelope: SaveEnvelopeV15<T> = Object.freeze({ ...base, checksum: checksumV15(base) });
    const stored: StoredSaveV15<T> = {
      slot: normalized,
      envelope,
      metadata: Object.freeze({
        title: String(metadata.title).slice(0, 120),
        ...(metadata.location === undefined ? {} : { location: String(metadata.location).slice(0, 160) }),
        playtimeSeconds: Math.max(0, Number(metadata.playtimeSeconds) || 0),
      }),
    };
    const serialized = stableStringifyV15(stored);
    if (new TextEncoder().encode(serialized).byteLength > this.#maxBytes) throw new RangeError("save exceeds configured size");
    this.#storage.write(this.#key(normalized), serialized);
    this.#revision = revision;
    return Object.freeze(stored);
  }

  load(slot: string): SaveSlotV15<T> | undefined {
    const normalized = normalizeSlotV15(slot);
    const raw = this.#storage.read(this.#key(normalized));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as StoredSaveV15<T>;
    if (parsed.slot !== normalized) throw new Error("save slot mismatch");
    validateEnvelopeV15(parsed.envelope, this.#maxBytes);
    this.#revision = revisionV15(Math.max(Number(this.#revision), Number(parsed.envelope.revision)));
    return Object.freeze({
      slot: normalized,
      envelope: Object.freeze({ ...parsed.envelope }),
      metadata: Object.freeze({ ...parsed.metadata }),
    });
  }

  list(): readonly Readonly<{ slot: string; revision: RevisionV15; tick: TickV15; title: string; location?: string; playtimeSeconds: number; bytes: number }>[] {
    const result: { slot: string; revision: RevisionV15; tick: TickV15; title: string; location?: string; playtimeSeconds: number; bytes: number }[] = [];
    for (const key of this.#storage.keys()) {
      if (!key.startsWith(this.#prefix)) continue;
      const slot = key.slice(this.#prefix.length);
      try {
        const loaded = this.load(slot);
        if (!loaded) continue;
        result.push({
          slot,
          revision: loaded.envelope.revision,
          tick: loaded.envelope.tick,
          title: loaded.metadata.title,
          ...(loaded.metadata.location === undefined ? {} : { location: loaded.metadata.location }),
          playtimeSeconds: loaded.metadata.playtimeSeconds,
          bytes: new TextEncoder().encode(this.#storage.read(key) ?? "").byteLength,
        });
      } catch {
        // Invalid/corrupt slots stay invisible to the healthy index.
      }
    }
    return Object.freeze(result.sort((a, b) => Number(b.revision) - Number(a.revision) || a.slot.localeCompare(b.slot)));
  }

  remove(slot: string): boolean {
    const normalized = normalizeSlotV15(slot);
    const key = this.#key(normalized);
    if (this.#storage.read(key) === null) return false;
    this.#storage.remove(key);
    return true;
  }

  export(slot: string): string {
    const loaded = this.load(slot);
    if (!loaded) throw new Error("save not found");
    return JSON.stringify(loaded);
  }

  import(serialized: string, slotOverride?: string): SaveSlotV15<T> {
    if (new TextEncoder().encode(serialized).byteLength > this.#maxBytes) throw new RangeError("serialized save exceeds configured size");
    const parsed = JSON.parse(serialized) as StoredSaveV15<T>;
    const slot = normalizeSlotV15(slotOverride ?? parsed.slot);
    validateEnvelopeV15(parsed.envelope, this.#maxBytes);
    return this.save(slot, parsed.envelope.payload, parsed.envelope.tick, parsed.metadata);
  }

  revision(): RevisionV15 { return this.#revision; }
  digest(): number { return checksumV15(this.list().map(item => ({ ...item, revision: Number(item.revision), tick: Number(item.tick) }))); }

  #key(slot: string): string { return this.#prefix + slot; }
}

function validateEnvelopeV15<T>(envelope: SaveEnvelopeV15<T>, maxBytes: number): void {
  if (envelope.magic !== "AAPW-SAVE-V15" || envelope.version !== 15) throw new Error("unsupported save envelope");
  if (!Number.isInteger(Number(envelope.revision)) || Number(envelope.revision) < 1) throw new Error("invalid save revision");
  const { checksum, ...base } = envelope;
  if (checksumV15(base) !== checksum) throw new Error("save checksum mismatch");
  if (new TextEncoder().encode(stableStringifyV15(envelope.payload)).byteLength > maxBytes) throw new RangeError("save payload too large");
}

function normalizeSlotV15(value: string): string {
  const slot = value.trim();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(slot)) throw new RangeError("invalid save slot");
  return slot;
}
