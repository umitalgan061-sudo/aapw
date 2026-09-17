import { checksumP, integerP, nonNegativeP, type SaveSlotP } from './contracts.ts';

export interface SaveStorageP {
  read(slot: string): Promise<string | null>;
  write(slot: string, payload: string): Promise<void>;
  remove(slot: string): Promise<void>;
  list(): Promise<readonly string[]>;
}

export interface SaveMigrationP<T> {
  readonly from: number;
  readonly to: number;
  migrate(state: unknown): T;
}

export interface PersistencePipelineConfigP {
  readonly format: string;
  readonly currentVersion: number;
  readonly maxSlots: number;
  readonly maxBytesPerSlot: number;
}

export interface PersistenceStatsP {
  readonly slots: number;
  readonly writes: number;
  readonly reads: number;
  readonly deletes: number;
  readonly migrations: number;
  readonly failures: number;
  readonly bytesWritten: number;
  readonly checksum: number;
}

interface Envelope<T> {
  format: string;
  version: number;
  createdAt: number;
  tick: number;
  checksum: number;
  state: T;
}

const DEFAULTS: PersistencePipelineConfigP = Object.freeze({ format: 'aapw-production-save', currentVersion: 4, maxSlots: 12, maxBytesPerSlot: 2 * 1024 * 1024 });

export class ProductionPersistencePipeline<TState> {
  readonly config: PersistencePipelineConfigP;
  readonly #storage: SaveStorageP;
  readonly #migrations = new Map<number, SaveMigrationP<unknown>>();
  #writes = 0;
  #reads = 0;
  #deletes = 0;
  #migrationCount = 0;
  #failures = 0;
  #bytesWritten = 0;

  constructor(storage: SaveStorageP, config: Partial<PersistencePipelineConfigP> = {}) {
    this.#storage = storage;
    this.config = Object.freeze({ format: (config.format ?? DEFAULTS.format).slice(0, 80), currentVersion: Math.max(1, integerP(config.currentVersion ?? DEFAULTS.currentVersion)), maxSlots: Math.max(1, integerP(config.maxSlots ?? DEFAULTS.maxSlots)), maxBytesPerSlot: Math.max(1024, nonNegativeP(config.maxBytesPerSlot ?? DEFAULTS.maxBytesPerSlot)) });
  }

  registerMigration(migration: SaveMigrationP<unknown>): void {
    if (migration.to !== migration.from + 1) throw new Error('save migrations must advance exactly one version');
    this.#migrations.set(migration.from, migration);
  }

  async save(slotValue: string, state: TState, tick = 0, now = Date.now()): Promise<SaveSlotP<TState>> {
    const slot = normalizeSlot(slotValue);
    const envelope: Envelope<TState> = { format: this.config.format, version: this.config.currentVersion, createdAt: Math.max(0, nonNegativeP(now)), tick: Math.max(0, integerP(tick)), checksum: checksumP(state), state: structuredCloneSafe(state) };
    const payload = JSON.stringify(envelope);
    const bytes = new TextEncoder().encode(payload).byteLength;
    if (bytes > this.config.maxBytesPerSlot) throw new Error(`save slot exceeds byte budget: ${bytes}`);
    try {
      await this.#ensureSlotBudget(slot);
      await this.#storage.write(slot, payload);
      this.#writes += 1; this.#bytesWritten += bytes;
      return Object.freeze({ slot, version: envelope.version, tick: envelope.tick, createdAt: envelope.createdAt, checksum: envelope.checksum, state: envelope.state });
    } catch (error) { this.#failures += 1; throw normalizeSaveError(error); }
  }

  async load(slotValue: string): Promise<SaveSlotP<TState> | null> {
    const slot = normalizeSlot(slotValue);
    try {
      const raw = await this.#storage.read(slot);
      this.#reads += 1;
      if (raw === null) return null;
      if (new TextEncoder().encode(raw).byteLength > this.config.maxBytesPerSlot) throw new Error('save payload exceeds byte budget');
      const envelope = parseEnvelope<unknown>(raw, this.config.format);
      let state = envelope.state;
      let version = envelope.version;
      while (version < this.config.currentVersion) {
        const migration = this.#migrations.get(version);
        if (!migration) throw new Error(`missing save migration ${version} -> ${version + 1}`);
        state = migration.migrate(state); version = migration.to; this.#migrationCount += 1;
      }
      if (version !== this.config.currentVersion) throw new Error('unsupported save version');
      const expected = checksumP(state);
      if (expected !== envelope.checksum && version === envelope.version) throw new Error('save checksum mismatch');
      return Object.freeze({ slot, version, tick: envelope.tick, createdAt: envelope.createdAt, checksum: expected, state: state as TState });
    } catch (error) { this.#failures += 1; throw normalizeSaveError(error); }
  }

  async remove(slotValue: string): Promise<boolean> { const slot = normalizeSlot(slotValue); try { await this.#storage.remove(slot); this.#deletes += 1; return true; } catch (error) { this.#failures += 1; throw normalizeSaveError(error); } }

  async list(): Promise<readonly string[]> { const slots = await this.#storage.list(); return Object.freeze(slots.map(normalizeSlot).filter(Boolean).sort()); }

  async prune(): Promise<number> {
    const slots = await this.list();
    if (slots.length <= this.config.maxSlots) return 0;
    let removed = 0;
    for (const slot of slots.slice(0, slots.length - this.config.maxSlots)) { await this.remove(slot); removed += 1; }
    return removed;
  }

  stats(): PersistenceStatsP {
    const digest = checksumP({ format: this.config.format, version: this.config.currentVersion, writes: this.#writes, reads: this.#reads, deletes: this.#deletes, migrations: this.#migrationCount, failures: this.#failures });
    return Object.freeze({ slots: 0, writes: this.#writes, reads: this.#reads, deletes: this.#deletes, migrations: this.#migrationCount, failures: this.#failures, bytesWritten: this.#bytesWritten, checksum: digest });
  }

  async #ensureSlotBudget(currentSlot: string): Promise<void> {
    const slots = await this.list();
    const known = slots.includes(currentSlot) ? slots : [...slots, currentSlot];
    if (known.length <= this.config.maxSlots) return;
    for (const slot of known.slice(0, known.length - this.config.maxSlots)) if (slot !== currentSlot) await this.#storage.remove(slot);
  }
}

export class MemorySaveStorageP implements SaveStorageP {
  readonly #values = new Map<string, string>();
  async read(slot: string): Promise<string | null> { return this.#values.get(slot) ?? null; }
  async write(slot: string, payload: string): Promise<void> { this.#values.set(slot, payload); }
  async remove(slot: string): Promise<void> { this.#values.delete(slot); }
  async list(): Promise<readonly string[]> { return Object.freeze([...this.#values.keys()].sort()); }
}

function parseEnvelope<T>(raw: string, format: string): Envelope<T> {
  const value = JSON.parse(raw) as Partial<Envelope<T>>;
  if (value.format !== format) throw new Error('invalid save format');
  if (!Number.isInteger(value.version) || Number(value.version) < 1) throw new Error('invalid save version');
  if (!Number.isInteger(value.tick) || Number(value.tick) < 0) throw new Error('invalid save tick');
  if (!Number.isInteger(value.checksum)) throw new Error('invalid save checksum');
  if (value.state === undefined) throw new Error('save state missing');
  return value as Envelope<T>;
}

function structuredCloneSafe<T>(state: T): T { if (typeof structuredClone === 'function') return structuredClone(state); return JSON.parse(JSON.stringify(state)) as T; }
function normalizeSlot(slot: string): string { const normalized = String(slot).trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64); if (!normalized) throw new Error('save slot is empty'); return normalized; }
function normalizeSaveError(error: unknown): Error { return error instanceof Error ? error : new Error(String(error)); }
