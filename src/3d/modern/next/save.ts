import { deterministicChecksum } from './determinism.ts';
import type { SaveEnvelope, SaveHeader, Tick } from './types.ts';

export interface Migration<TFrom, TTo> { readonly from: number; readonly to: number; migrate(value: TFrom): TTo; }

export class SaveCodec<TState> {
  readonly currentVersion: number;
  #migrations = new Map<number, Migration<unknown, unknown>>();

  constructor(currentVersion: number) {
    if (!Number.isInteger(currentVersion) || currentVersion < 1) throw new RangeError('currentVersion must be >= 1');
    this.currentVersion = currentVersion;
  }

  registerMigration<TFrom, TTo>(migration: Migration<TFrom, TTo>): void {
    if (!Number.isInteger(migration.from) || !Number.isInteger(migration.to) || migration.to !== migration.from + 1) throw new RangeError('migrations must advance exactly one version');
    if (this.#migrations.has(migration.from)) throw new Error(`migration already registered for v${migration.from}`);
    this.#migrations.set(migration.from, migration as Migration<unknown, unknown>);
  }

  encode(state: TState, createdAtTick: Tick): string {
    const payload = stableClone(state);
    const checksum = checksumState(payload);
    const envelope: SaveEnvelope<TState> = { header: { format: 'aapw-next-save', version: this.currentVersion, createdAtTick, checksum }, state: payload };
    return JSON.stringify(envelope);
  }

  decode(serialized: string): SaveEnvelope<TState> {
    const parsed: unknown = JSON.parse(serialized);
    if (!isSaveEnvelope(parsed)) throw new Error('invalid save envelope');
    let state: unknown = stableClone(parsed.state);
    let version = parsed.header.version;
    while (version < this.currentVersion) {
      const migration = this.#migrations.get(version);
      if (!migration) throw new Error(`missing migration v${version} -> v${version + 1}`);
      state = migration.migrate(state);
      version = migration.to;
    }
    if (version !== this.currentVersion) throw new Error(`unsupported save version: ${version}`);
    const checksum = checksumState(state);
    if (checksum !== parsed.header.checksum && version === parsed.header.version) throw new Error('save checksum mismatch');
    const header: SaveHeader = { ...parsed.header, version: this.currentVersion, checksum };
    return { header, state: state as TState };
  }
}

export function checksumState(value: unknown): string {
  return deterministicChecksum([canonicalize(value)]);
}

export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`;
  }
  return 'null';
}

function stableClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isSaveEnvelope(value: unknown): value is SaveEnvelope<unknown> {
  if (!value || typeof value !== 'object') return false;
  const envelope = value as Record<string, unknown>;
  const header = envelope.header;
  if (!header || typeof header !== 'object') return false;
  const h = header as Record<string, unknown>;
  return h.format === 'aapw-next-save' && Number.isInteger(h.version) && h.version >= 1 && Number.isInteger(h.createdAtTick) && typeof h.checksum === 'string' && 'state' in envelope;
}

export interface SaveSlot<TState> { readonly name: string; readonly updatedAtTick: Tick; readonly data: string; readonly state: TState; }

export class SaveSlotStore<TState> {
  #slots = new Map<string, SaveSlot<TState>>();
  #limit: number;
  constructor(limit = 12) { this.#limit = Math.max(1, Math.floor(limit)); }
  put(name: string, slot: Omit<SaveSlot<TState>, 'name'>): void {
    const normalized = name.trim();
    if (!normalized) throw new TypeError('slot name is empty');
    this.#slots.set(normalized, { name: normalized, ...slot });
    while (this.#slots.size > this.#limit) {
      const oldest = [...this.#slots.values()].sort((a, b) => a.updatedAtTick - b.updatedAtTick || a.name.localeCompare(b.name))[0];
      if (oldest) this.#slots.delete(oldest.name); else break;
    }
  }
  get(name: string): SaveSlot<TState> | undefined { return this.#slots.get(name.trim()); }
  delete(name: string): boolean { return this.#slots.delete(name.trim()); }
  list(): SaveSlot<TState>[] { return [...this.#slots.values()].sort((a, b) => b.updatedAtTick - a.updatedAtTick || a.name.localeCompare(b.name)); }
  clear(): void { this.#slots.clear(); }
}
