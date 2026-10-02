
import type { Migration, SaveEnvelope, WorldSnapshot } from './types.ts';
import { R41_VERSION, stableHash } from './types.ts';

export interface SaveStore {
  write(slot: string, envelope: SaveEnvelope): boolean;
  read(slot: string): SaveEnvelope | null;
  remove(slot: string): boolean;
  list(): readonly string[];
  clear(): void;
}

export class MemorySaveStoreR41 implements SaveStore {
  #slots = new Map<string, SaveEnvelope>();

  write(slot: string, envelope: SaveEnvelope): boolean {
    const id = sanitizeSlot(slot);
    if (!id) return false;
    this.#slots.set(id, structuredClone(envelope));
    return true;
  }

  read(slot: string): SaveEnvelope | null {
    const value = this.#slots.get(sanitizeSlot(slot));
    return value ? structuredClone(value) : null;
  }

  remove(slot: string): boolean { return this.#slots.delete(sanitizeSlot(slot)); }
  list(): readonly string[] { return Object.freeze([...this.#slots.keys()].sort()); }
  clear(): void { this.#slots.clear(); }
}

export interface PersistenceOptions {
  readonly store?: SaveStore;
  readonly profileId?: string;
  readonly now?: () => number;
  readonly maxSlotLength?: number;
}

export class PersistenceR41 {
  readonly store: SaveStore;
  readonly profileId: string;
  readonly now: () => number;
  readonly maxSlotLength: number;
  #migrations: Migration<unknown>[] = [];

  constructor(options: PersistenceOptions = {}) {
    this.store = options.store ?? new MemorySaveStoreR41();
    this.profileId = sanitizeSlot(options.profileId ?? 'default');
    this.now = options.now ?? defaultNow;
    this.maxSlotLength = Math.max(8, Math.trunc(options.maxSlotLength ?? 48));
  }

  registerMigration<T>(migration: Migration<T>): void {
    if (migration.to <= migration.from) throw new Error('R41 migration target must increase');
    this.#migrations.push(migration as Migration<unknown>);
    this.#migrations.sort((a, b) => a.from - b.from);
  }

  create(slot: string, world: WorldSnapshot, metadata: Readonly<Record<string, string>> = {}): SaveEnvelope {
    const normalized = sanitizeSlot(slot).slice(0, this.maxSlotLength);
    const checksum = envelopeChecksum(R41_VERSION, normalized, world, metadata, this.profileId);
    return Object.freeze({
      schema: R41_VERSION,
      slot: normalized,
      createdAtMs: this.now(),
      world: structuredClone(world),
      metadata: Object.freeze({ ...metadata }),
      checksum,
    });
  }

  save(slot: string, world: WorldSnapshot, metadata: Readonly<Record<string, string>> = {}): SaveEnvelope {
    const envelope = this.create(slot, world, metadata);
    if (!this.store.write(envelope.slot, envelope)) throw new Error('R41 save write rejected');
    return envelope;
  }

  load(slot: string): SaveEnvelope | null {
    const envelope = this.store.read(slot);
    if (!envelope) return null;
    if (!this.verify(envelope)) throw new Error('R41 save checksum mismatch');
    return envelope.schema === R41_VERSION ? envelope : this.migrate(envelope);
  }

  verify(envelope: SaveEnvelope): boolean {
    return envelope.checksum === envelopeChecksum(
      envelope.schema,
      envelope.slot,
      envelope.world,
      envelope.metadata,
      this.profileId,
    );
  }

  migrate(envelope: SaveEnvelope): SaveEnvelope {
    let current: unknown = envelope;
    let version = envelope.schema;
    let guard = 0;
    while (version < R41_VERSION && guard < 64) {
      const migration = this.#migrations.find(item => item.from === version);
      if (!migration) throw new Error('R41 missing migration from ' + version);
      current = migration.migrate(current);
      version = migration.to;
      guard += 1;
    }
    if (version !== R41_VERSION) throw new Error('R41 migration did not reach target');
    return structuredClone(current) as SaveEnvelope;
  }

  remove(slot: string): boolean { return this.store.remove(slot); }
  slots(): readonly string[] { return this.store.list(); }
  clear(): void { this.store.clear(); }
}

export class RollbackJournalR41 {
  readonly capacity: number;
  #snapshots: WorldSnapshot[] = [];

  constructor(capacity = 120) {
    this.capacity = Math.max(2, Math.trunc(capacity));
  }

  push(snapshot: WorldSnapshot): void {
    this.#snapshots.push(structuredClone(snapshot));
    if (this.#snapshots.length > this.capacity) this.#snapshots.shift();
  }

  latest(): WorldSnapshot | null {
    const value = this.#snapshots[this.#snapshots.length - 1];
    return value ? structuredClone(value) : null;
  }

  atOrBefore(tick: number): WorldSnapshot | null {
    const target = Math.trunc(tick);
    for (let index = this.#snapshots.length - 1; index >= 0; index -= 1) {
      const snapshot = this.#snapshots[index];
      if (snapshot && snapshot.tick <= target) return structuredClone(snapshot);
    }
    return null;
  }

  removeAfter(tick: number): number {
    const target = Math.trunc(tick);
    const before = this.#snapshots.length;
    this.#snapshots = this.#snapshots.filter(snapshot => snapshot.tick <= target);
    return before - this.#snapshots.length;
  }

  clear(): void { this.#snapshots = []; }
  size(): number { return this.#snapshots.length; }
}

function envelopeChecksum(
  schema: number,
  slot: string,
  world: WorldSnapshot,
  metadata: Readonly<Record<string, string>>,
  profileId: string,
): number {
  return stableHash({ schema, slot, world, metadata, profileId });
}

function sanitizeSlot(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 64) || 'default';
}

function defaultNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : 0;
}
