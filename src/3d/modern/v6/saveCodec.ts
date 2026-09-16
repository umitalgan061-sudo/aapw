/**
 * V6 versioned save codec.
 * Uses explicit schemas, checksums, migrations and bounded payload limits.
 * Storage remains injected so browser IndexedDB/localStorage can be swapped.
 */

export type SaveSlot = string & { readonly __brand: 'SaveSlot' };
export interface PlayerSaveState {
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly health: number;
  readonly stamina: number;
  readonly level: number;
  readonly experience: number;
  readonly inventory: readonly { readonly id: string; readonly quantity: number; readonly equipped: boolean }[];
}
export interface WorldSaveState {
  readonly seed: number;
  readonly simulationTick: number;
  readonly discovered: readonly string[];
  readonly quests: readonly { readonly id: string; readonly state: string; readonly progress: readonly number[] }[];
  readonly flags: Readonly<Record<string, boolean>>;
}
export interface SaveEnvelope<T = V6SavePayload> {
  readonly magic: 'AAPW-V6-SAVE';
  readonly schema: number;
  readonly slot: SaveSlot;
  readonly createdTick: number;
  readonly payload: T;
  readonly checksum: number;
}
export interface V6SavePayload {
  readonly player: PlayerSaveState;
  readonly world: WorldSaveState;
  readonly settings: Readonly<Record<string, string | number | boolean>>;
}
export interface SaveStore {
  read(slot: SaveSlot): Promise<string | undefined>;
  write(slot: SaveSlot, value: string): Promise<void>;
  remove(slot: SaveSlot): Promise<void>;
  list(): Promise<readonly SaveSlot[]>;
}
export interface SaveCodecConfig {
  readonly currentSchema: number;
  readonly maxBytes: number;
  readonly maxInventoryItems: number;
  readonly maxQuestEntries: number;
}

const DEFAULT_CONFIG: SaveCodecConfig = {
  currentSchema: 1,
  maxBytes: 512 * 1024,
  maxInventoryItems: 512,
  maxQuestEntries: 512,
};

function assertObject(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  return value as Record<string, unknown>;
}
function number(value: unknown, fallback = 0): number { return typeof value === 'number' && Number.isFinite(value) ? value : fallback; }
function integer(value: unknown, fallback = 0): number { return Number.isSafeInteger(value) ? value : fallback; }
function text(value: unknown, max: number): string { return String(value ?? '').replace(/[\u0000-\u001F\u007F]/g, '').slice(0, max); }
function bool(value: unknown): boolean { return value === true; }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

export function makeSaveSlot(value: string): SaveSlot {
  const safe = text(value, 64);
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(safe)) throw new TypeError('invalid save slot');
  return safe as SaveSlot;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(',')}}`;
}

export function checksum(value: unknown): number {
  const source = stableStringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function normalizePlayer(raw: unknown, config: SaveCodecConfig): PlayerSaveState {
  const object = assertObject(raw, 'player');
  const position = assertObject(object.position, 'player.position');
  const inventory = Array.isArray(object.inventory) ? object.inventory.slice(0, config.maxInventoryItems) : [];
  return {
    position: { x: number(position.x), y: number(position.y), z: number(position.z) },
    health: Math.max(0, number(object.health)),
    stamina: Math.max(0, number(object.stamina)),
    level: Math.max(1, integer(object.level, 1)),
    experience: Math.max(0, number(object.experience)),
    inventory: inventory.map((entry) => {
      const item = assertObject(entry, 'inventory item');
      return { id: text(item.id, 96), quantity: Math.max(0, integer(item.quantity)), equipped: bool(item.equipped) };
    }).filter((item) => item.id.length > 0),
  };
}

function normalizeWorld(raw: unknown, config: SaveCodecConfig): WorldSaveState {
  const object = assertObject(raw, 'world');
  const quests = Array.isArray(object.quests) ? object.quests.slice(0, config.maxQuestEntries) : [];
  const flagsObject = object.flags && typeof object.flags === 'object' ? object.flags as Record<string, unknown> : {};
  const flags: Record<string, boolean> = {};
  for (const key of Object.keys(flagsObject).slice(0, 512)) flags[text(key, 96)] = bool(flagsObject[key]);
  return {
    seed: integer(object.seed),
    simulationTick: Math.max(0, integer(object.simulationTick)),
    discovered: Array.isArray(object.discovered) ? object.discovered.map((value) => text(value, 96)).filter(Boolean).slice(0, 2048) : [],
    quests: quests.map((entry) => {
      const quest = assertObject(entry, 'quest');
      return {
        id: text(quest.id, 96),
        state: text(quest.state, 32),
        progress: Array.isArray(quest.progress) ? quest.progress.map((value) => number(value)).slice(0, 64) : [],
      };
    }).filter((quest) => quest.id.length > 0),
    flags,
  };
}

export function normalizePayload(raw: unknown, config: SaveCodecConfig = DEFAULT_CONFIG): V6SavePayload {
  const object = assertObject(raw, 'payload');
  const settingsRaw = object.settings && typeof object.settings === 'object' ? object.settings as Record<string, unknown> : {};
  const settings: Record<string, string | number | boolean> = {};
  for (const key of Object.keys(settingsRaw).slice(0, 128)) {
    const value = settingsRaw[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') settings[text(key, 96)] = value;
  }
  return { player: normalizePlayer(object.player, config), world: normalizeWorld(object.world, config), settings };
}

export function encodeSave(slot: SaveSlot, tick: number, payload: V6SavePayload, config: Partial<SaveCodecConfig> = {}): string {
  const options = { ...DEFAULT_CONFIG, ...config };
  const normalized = normalizePayload(payload, options);
  const body = { magic: 'AAPW-V6-SAVE' as const, schema: options.currentSchema, slot, createdTick: Math.max(0, Math.floor(tick)), payload: normalized };
  const envelope: SaveEnvelope = { ...body, checksum: checksum(body) };
  const encoded = stableStringify(envelope);
  if (encoded.length > options.maxBytes) throw new RangeError('save payload exceeds size budget');
  return encoded;
}

export function decodeSave(raw: string, config: Partial<SaveCodecConfig> = {}): SaveEnvelope {
  const options = { ...DEFAULT_CONFIG, ...config };
  if (raw.length === 0 || raw.length > options.maxBytes) throw new RangeError('save payload size is invalid');
  let parsed: unknown;
  try { parsed = JSON.parse(raw) as unknown; } catch { throw new Error('invalid save JSON'); }
  const object = assertObject(parsed, 'save');
  if (object.magic !== 'AAPW-V6-SAVE') throw new Error('unknown save format');
  const schema = integer(object.schema);
  if (schema < 1 || schema > options.currentSchema) throw new Error('unsupported save schema');
  const slot = makeSaveSlot(text(object.slot, 64));
  const body = { magic: 'AAPW-V6-SAVE' as const, schema, slot, createdTick: Math.max(0, integer(object.createdTick)), payload: normalizePayload(object.payload, options) };
  const actualChecksum = integer(object.checksum);
  if (checksum(body) !== actualChecksum) throw new Error('save checksum mismatch');
  return { ...body, checksum: actualChecksum };
}

export function migrateSave(envelope: SaveEnvelope, targetSchema: number): SaveEnvelope {
  if (targetSchema < envelope.schema) throw new RangeError('cannot migrate backwards');
  let current: SaveEnvelope = clone(envelope);
  while (current.schema < targetSchema) current = migrateOne(current, current.schema + 1);
  return current;
}

function migrateOne(envelope: SaveEnvelope, targetSchema: number): SaveEnvelope {
  const payload = clone(envelope.payload);
  if (targetSchema === 2) {
    const settings = { ...payload.settings, migration_v2: true };
    return rebuildEnvelope({ ...envelope, schema: targetSchema, payload: { ...payload, settings } });
  }
  if (targetSchema === 3) {
    const discovered = [...new Set(payload.world.discovered)].sort();
    return rebuildEnvelope({ ...envelope, schema: targetSchema, payload: { ...payload, world: { ...payload.world, discovered } } });
  }
  throw new Error(`no migration path to schema ${targetSchema}`);
}

function rebuildEnvelope(input: SaveEnvelope): SaveEnvelope {
  const body = { magic: input.magic, schema: input.schema, slot: input.slot, createdTick: input.createdTick, payload: input.payload };
  return { ...body, checksum: checksum(body) };
}

export class MemorySaveStore implements SaveStore {
  readonly #values = new Map<SaveSlot, string>();
  async read(slot: SaveSlot): Promise<string | undefined> { return this.#values.get(slot); }
  async write(slot: SaveSlot, value: string): Promise<void> { this.#values.set(slot, value); }
  async remove(slot: SaveSlot): Promise<void> { this.#values.delete(slot); }
  async list(): Promise<readonly SaveSlot[]> { return [...this.#values.keys()].sort(); }
}

export class SaveManager {
  readonly #store: SaveStore;
  readonly #config: SaveCodecConfig;
  constructor(store: SaveStore, config: Partial<SaveCodecConfig> = {}) { this.#store = store; this.#config = { ...DEFAULT_CONFIG, ...config }; }

  async save(slot: SaveSlot, tick: number, payload: V6SavePayload): Promise<SaveEnvelope> {
    const raw = encodeSave(slot, tick, payload, this.#config);
    await this.#store.write(slot, raw);
    return decodeSave(raw, this.#config);
  }

  async load(slot: SaveSlot): Promise<SaveEnvelope | undefined> {
    const raw = await this.#store.read(slot);
    return raw ? decodeSave(raw, this.#config) : undefined;
  }

  async delete(slot: SaveSlot): Promise<void> { await this.#store.remove(slot); }
  async slots(): Promise<readonly SaveSlot[]> { return this.#store.list(); }
}

export function buildSavePayload(input: Partial<V6SavePayload>): V6SavePayload {
  return normalizePayload({ player: input.player ?? {}, world: input.world ?? {}, settings: input.settings ?? {} });
}
