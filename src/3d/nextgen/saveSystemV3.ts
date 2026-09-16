/** Versioned, checksummed save codec with migrations and bounded payloads. */

import { deterministicHash } from './deterministicMath';

export interface SaveHeader { magic: 'AAPW'; schema: number; createdTick: number; worldSeed: number; checksum: number; payloadBytes: number }
export interface SaveDocument<T> { header: SaveHeader; state: T }
export interface SaveMigration<TFrom, TTo> { from: number; to: number; migrate(value: TFrom): TTo }
export interface SaveValidation { valid: boolean; reason: string | null; checksum: number | null; bytes: number }

export interface PlayerSaveState {
  position: { x: number; y: number; z: number };
  yaw: number;
  health: number;
  stamina: number;
  inventory: string[];
  completedQuests: string[];
}

export interface WorldSaveState {
  schema: number;
  tick: number;
  seed: number;
  player: PlayerSaveState;
  discoveredLocations: string[];
  worldFlags: Record<string, boolean>;
  entities: Array<{ id: number; archetype: string; position: { x: number; y: number; z: number } }>;
}

const CURRENT_SCHEMA = 3;
const MAGIC = 'AAPW' as const;
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
}

function checksumText(value: string): number {
  const numbers: number[] = [];
  for (let index = 0; index < value.length; index += 1) numbers.push(value.charCodeAt(index));
  return deterministicHash(numbers);
}

export class SaveSystemV3<T extends object> {
  readonly currentSchema: number;
  readonly maxBytes: number;
  #migrations: SaveMigration<object, object>[] = [];

  constructor(currentSchema = CURRENT_SCHEMA, maxBytes = DEFAULT_MAX_BYTES) {
    this.currentSchema = currentSchema;
    this.maxBytes = maxBytes;
  }

  registerMigration<TFrom extends object, TTo extends object>(migration: SaveMigration<TFrom, TTo>): void {
    if (migration.to !== migration.from + 1) throw new Error('migrations must advance exactly one schema');
    if (this.#migrations.some((item) => item.from === migration.from)) throw new Error(`duplicate migration ${migration.from}`);
    this.#migrations.push(migration as SaveMigration<object, object>);
    this.#migrations.sort((a, b) => a.from - b.from);
  }

  encode(state: T, tick: number, worldSeed: number): Uint8Array {
    const normalized = this.normalizeState(state);
    const body = stableJson(normalized);
    const checksum = checksumText(body);
    const header: SaveHeader = { magic: MAGIC, schema: this.currentSchema, createdTick: tick, worldSeed, checksum, payloadBytes: body.length };
    const document = JSON.stringify({ header, state: normalized } satisfies SaveDocument<T>);
    const bytes = new TextEncoder().encode(document);
    if (bytes.byteLength > this.maxBytes) throw new Error(`save exceeds ${this.maxBytes} byte budget`);
    return bytes;
  }

  decode(bytes: Uint8Array): { state: T; header: SaveHeader } {
    if (bytes.byteLength > this.maxBytes) throw new Error('save payload exceeds configured budget');
    let document: SaveDocument<object>;
    try { document = JSON.parse(new TextDecoder().decode(bytes)) as SaveDocument<object>; } catch { throw new Error('save payload is not valid JSON'); }
    const validation = this.validateDocument(document, bytes.byteLength);
    if (!validation.valid) throw new Error(validation.reason ?? 'invalid save');
    let state = document.state;
    let schema = document.header.schema;
    while (schema < this.currentSchema) {
      const migration = this.#migrations.find((item) => item.from === schema);
      if (!migration) throw new Error(`missing save migration ${schema} -> ${schema + 1}`);
      state = migration.migrate(state);
      schema = migration.to;
    }
    if (schema !== this.currentSchema) throw new Error(`unsupported future save schema ${schema}`);
    return { state: this.normalizeState(state) as T, header: document.header };
  }

  validate(bytes: Uint8Array): SaveValidation {
    try {
      const document = JSON.parse(new TextDecoder().decode(bytes)) as SaveDocument<object>;
      return this.validateDocument(document, bytes.byteLength);
    } catch (error) {
      return { valid: false, reason: error instanceof Error ? error.message : String(error), checksum: null, bytes: bytes.byteLength };
    }
  }

  exportText(state: T, tick: number, worldSeed: number): string { return new TextDecoder().decode(this.encode(state, tick, worldSeed)); }

  private validateDocument(document: SaveDocument<object>, bytes: number): SaveValidation {
    if (document?.header?.magic !== MAGIC) return { valid: false, reason: 'bad save magic', checksum: null, bytes };
    if (!Number.isInteger(document.header.schema) || document.header.schema < 1) return { valid: false, reason: 'bad save schema', checksum: null, bytes };
    if (document.header.schema > this.currentSchema) return { valid: false, reason: `future save schema ${document.header.schema}`, checksum: null, bytes };
    const body = stableJson(document.state);
    const checksum = checksumText(body);
    if (checksum !== document.header.checksum) return { valid: false, reason: 'save checksum mismatch', checksum, bytes };
    return { valid: true, reason: null, checksum, bytes };
  }

  private normalizeState(value: object): object {
    if (!value || typeof value !== 'object') throw new Error('save state must be an object');
    return JSON.parse(stableJson(value)) as object;
  }
}

export function createWorldSaveState(seed = 1): WorldSaveState {
  return {
    schema: CURRENT_SCHEMA,
    tick: 0,
    seed,
    player: { position: { x: 0, y: 0, z: 0 }, yaw: 0, health: 100, stamina: 100, inventory: [], completedQuests: [] },
    discoveredLocations: [],
    worldFlags: {},
    entities: [],
  };
}

export function registerDefaultSaveMigrations(system: SaveSystemV3<WorldSaveState>): void {
  system.registerMigration({ from: 1, to: 2, migrate: (value: Partial<WorldSaveState>) => ({
    schema: 2,
    tick: value.tick ?? 0,
    seed: value.seed ?? 1,
    player: value.player ?? { position: { x: 0, y: 0, z: 0 }, yaw: 0, health: 100, stamina: 100, inventory: [], completedQuests: [] },
    discoveredLocations: value.discoveredLocations ?? [], worldFlags: value.worldFlags ?? {}, entities: value.entities ?? [],
  }) });
  system.registerMigration({ from: 2, to: 3, migrate: (value: WorldSaveState) => ({ ...value, schema: 3, entities: value.entities.map((entity) => ({ ...entity, position: { ...entity.position } })) }) });
}
