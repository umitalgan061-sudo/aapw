import { deterministicChecksum } from '../determinism.ts';
import { validatePayload, DEFAULT_SECURITY_LIMITS } from '../security.ts';
import { tick, type Tick, type Vec3 } from '../types.ts';
import type {
  ProductionSnapshot,
  RuntimeIdentity,
  SaveDescriptor,
  SaveSlotKind,
  EntityRuntimeState,
  RuntimeFault,
} from './contracts.ts';
import { PRODUCTION_CONTRACT_VERSION } from './contracts.ts';

export interface PersistenceStore {
  read(slot: string): Promise<string | undefined>;
  write(slot: string, value: string): Promise<void>;
  remove(slot: string): Promise<void>;
  list(): Promise<string[]>;
}

export interface PersistenceConfig {
  readonly maxSlots: number;
  readonly maxBytes: number;
  readonly maxStateBytes: number;
  readonly application: string;
  readonly version: number;
}

export interface SaveState {
  readonly position: Vec3;
  readonly health: number;
  readonly stamina: number;
  readonly flags: number;
  readonly entities: readonly EntityRuntimeState[];
  readonly tick: Tick;
  readonly custom?: Readonly<Record<string, unknown>>;
}

interface SaveEnvelope {
  readonly magic: 'AAPW-PROD-SAVE';
  readonly contractVersion: 1;
  readonly version: number;
  readonly application: string;
  readonly identity: RuntimeIdentity;
  readonly kind: SaveSlotKind;
  readonly slot: string;
  readonly createdAtMs: number;
  readonly state: SaveState;
  readonly checksum: string;
}

const DEFAULT_CONFIG: PersistenceConfig = {
  maxSlots: 12,
  maxBytes: 4 * 1024 * 1024,
  maxStateBytes: 2 * 1024 * 1024,
  application: 'aapw',
  version: 1,
};

export class MemoryPersistenceStore implements PersistenceStore {
  #values = new Map<string, string>();

  async read(slot: string): Promise<string | undefined> {
    return this.#values.get(slot);
  }

  async write(slot: string, value: string): Promise<void> {
    this.#values.set(slot, value);
  }

  async remove(slot: string): Promise<void> {
    this.#values.delete(slot);
  }

  async list(): Promise<string[]> {
    return [...this.#values.keys()].sort();
  }

  clear(): void {
    this.#values.clear();
  }
}

export class WebStoragePersistenceStore implements PersistenceStore {
  readonly storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
  }

  async read(slot: string): Promise<string | undefined> {
    return this.storage.getItem(slot) ?? undefined;
  }

  async write(slot: string, value: string): Promise<void> {
    this.storage.setItem(slot, value);
  }

  async remove(slot: string): Promise<void> {
    this.storage.removeItem(slot);
  }

  async list(): Promise<string[]> {
    const result: string[] = [];
    for (let index = 0; index < this.storage.length; index += 1) {
      const key = this.storage.key(index);
      if (key) result.push(key);
    }
    result.sort();
    return result;
  }
}

export class ProductionPersistenceRuntime {
  readonly config: PersistenceConfig;
  readonly store: PersistenceStore;
  #descriptors = new Map<string, SaveDescriptor>();
  #faults: RuntimeFault[] = [];
  #writes = 0;
  #reads = 0;
  #failures = 0;

  constructor(store: PersistenceStore = new MemoryPersistenceStore(), config: Partial<PersistenceConfig> = {}) {
    this.store = store;
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      maxSlots: clampInt(config.maxSlots, 1, 64, DEFAULT_CONFIG.maxSlots),
      maxBytes: clampInt(config.maxBytes, 64 * 1024, 32 * 1024 * 1024, DEFAULT_CONFIG.maxBytes),
      maxStateBytes: clampInt(config.maxStateBytes, 16 * 1024, 16 * 1024 * 1024, DEFAULT_CONFIG.maxStateBytes),
      application: normalize(config.application ?? DEFAULT_CONFIG.application, 64),
      version: clampInt(config.version, 1, 32, DEFAULT_CONFIG.version),
    };
  }

  async save(
    slot: string,
    kind: SaveSlotKind,
    identity: RuntimeIdentity,
    state: SaveState,
    createdAtMs: number,
  ): Promise<SaveDescriptor> {
    const normalizedSlot = normalizeSlot(slot);
    if (!normalizedSlot) throw new TypeError('save slot is empty');
    await this.#enforceSlotLimit(normalizedSlot);

    const safeState = normalizeSaveState(state, this.config.maxStateBytes);
    const stateValidation = validatePayload(safeState, {
      ...DEFAULT_SECURITY_LIMITS,
      maxPayloadBytes: this.config.maxStateBytes,
      maxArrayLength: 20_000,
    });
    if (!stateValidation.ok) {
      this.#failures += 1;
      throw new Error(stateValidation.reason);
    }

    const envelopeWithoutChecksum = {
      magic: 'AAPW-PROD-SAVE' as const,
      contractVersion: PRODUCTION_CONTRACT_VERSION,
      version: this.config.version,
      application: this.config.application,
      identity,
      kind,
      slot: normalizedSlot,
      createdAtMs: Math.max(0, createdAtMs),
      state: safeState,
    };
    const checksum = deterministicChecksum(stableValues(envelopeWithoutChecksum));
    const envelope: SaveEnvelope = { ...envelopeWithoutChecksum, checksum };
    const encoded = JSON.stringify(envelope);
    const bytes = new TextEncoder().encode(encoded).byteLength;
    if (bytes > this.config.maxBytes) {
      this.#failures += 1;
      throw new Error('save exceeds persistence byte budget');
    }

    await this.store.write(normalizedSlot, encoded);
    this.#writes += 1;
    const descriptor: SaveDescriptor = {
      slot: normalizedSlot,
      kind,
      version: envelope.version,
      tick: safeState.tick,
      bytes,
      checksum,
      createdAtMs: envelope.createdAtMs,
    };
    this.#descriptors.set(normalizedSlot, descriptor);
    return descriptor;
  }

  async load(slot: string): Promise<{ descriptor: SaveDescriptor; state: SaveState; identity: RuntimeIdentity } | undefined> {
    const normalizedSlot = normalizeSlot(slot);
    const encoded = await this.store.read(normalizedSlot);
    this.#reads += 1;
    if (!encoded) return undefined;
    try {
      const envelope = JSON.parse(encoded) as SaveEnvelope;
      this.#validateEnvelope(envelope, normalizedSlot);
      const checksum = deterministicChecksum(stableValues({
        magic: envelope.magic,
        contractVersion: envelope.contractVersion,
        version: envelope.version,
        application: envelope.application,
        identity: envelope.identity,
        kind: envelope.kind,
        slot: envelope.slot,
        createdAtMs: envelope.createdAtMs,
        state: envelope.state,
      }));
      if (checksum !== envelope.checksum) throw new Error('save checksum mismatch');
      const state = normalizeSaveState(envelope.state, this.config.maxStateBytes);
      const descriptor: SaveDescriptor = {
        slot: normalizedSlot,
        kind: envelope.kind,
        version: envelope.version,
        tick: state.tick,
        bytes: new TextEncoder().encode(encoded).byteLength,
        checksum: envelope.checksum,
        createdAtMs: Math.max(0, envelope.createdAtMs),
      };
      this.#descriptors.set(normalizedSlot, descriptor);
      return { descriptor, state, identity: envelope.identity };
    } catch (error) {
      this.#failures += 1;
      this.#faults.push({
        subsystem: 'persistence',
        policy: 'degrade',
        message: error instanceof Error ? error.message : String(error),
        tick: tick(0),
        recoverable: true,
        details: { slot: normalizedSlot },
      });
      if (this.#faults.length > 32) this.#faults.shift();
      return undefined;
    }
  }

  async remove(slot: string): Promise<boolean> {
    const normalizedSlot = normalizeSlot(slot);
    const present = Boolean(await this.store.read(normalizedSlot));
    if (!present) return false;
    await this.store.remove(normalizedSlot);
    this.#descriptors.delete(normalizedSlot);
    return true;
  }

  async descriptors(): Promise<SaveDescriptor[]> {
    const slots = await this.store.list();
    const result: SaveDescriptor[] = [];
    for (const slot of slots.slice(0, this.config.maxSlots)) {
      const descriptor = this.#descriptors.get(slot);
      if (descriptor) {
        result.push(descriptor);
        continue;
      }
      const loaded = await this.load(slot);
      if (loaded) result.push(loaded.descriptor);
    }
    return result.sort((a, b) => a.slot.localeCompare(b.slot));
  }

  async has(slot: string): Promise<boolean> {
    return Boolean(await this.store.read(normalizeSlot(slot)));
  }

  async clear(): Promise<void> {
    const slots = await this.store.list();
    for (const slot of slots) await this.store.remove(slot);
    this.#descriptors.clear();
  }

  async exportSlot(slot: string): Promise<string | undefined> {
    const encoded = await this.store.read(normalizeSlot(slot));
    if (!encoded) return undefined;
    return encoded;
  }

  async importSlot(encoded: string, fallbackSlot?: string): Promise<SaveDescriptor> {
    if (new TextEncoder().encode(encoded).byteLength > this.config.maxBytes) throw new Error('import exceeds persistence byte budget');
    const parsed = JSON.parse(encoded) as SaveEnvelope;
    const targetSlot = normalizeSlot(parsed.slot) || normalizeSlot(fallbackSlot ?? '');
    if (!targetSlot) throw new TypeError('import slot is empty');
    const loaded = normalizeSaveState(parsed.state, this.config.maxStateBytes);
    this.#validateEnvelope(parsed, targetSlot);
    const checksum = deterministicChecksum(stableValues({
      magic: parsed.magic,
      contractVersion: parsed.contractVersion,
      version: parsed.version,
      application: parsed.application,
      identity: parsed.identity,
      kind: parsed.kind,
      slot: targetSlot,
      createdAtMs: parsed.createdAtMs,
      state: loaded,
    }));
    if (checksum !== parsed.checksum) throw new Error('import checksum mismatch');
    await this.store.write(targetSlot, JSON.stringify({ ...parsed, slot: targetSlot, state: loaded }));
    return {
      slot: targetSlot,
      kind: parsed.kind,
      version: parsed.version,
      tick: loaded.tick,
      bytes: new TextEncoder().encode(encoded).byteLength,
      checksum: parsed.checksum,
      createdAtMs: parsed.createdAtMs,
    };
  }

  snapshotState(identity: RuntimeIdentity, slot: string, kind: SaveSlotKind, runtime: ProductionSnapshot): SaveState {
    const entities = runtime.entities.map((entity) => ({
      ...entity,
      transform: {
        ...entity.transform,
        position: { ...entity.transform.position },
        velocity: { ...entity.transform.velocity },
      },
    }));
    const position = entities[0]?.transform.position ?? { x: 0, y: 0, z: 0 };
    const primary = entities[0];
    return {
      position: { ...position },
      health: primary?.health ?? 0,
      stamina: primary?.stamina ?? 0,
      flags: primary?.flags ?? 0,
      entities,
      tick: runtime.tick,
      custom: {
        identity,
        slot,
        kind,
        contractVersion: runtime.contractVersion,
        simTimeSeconds: runtime.simTimeSeconds,
        inputSequence: runtime.inputSequence,
      },
    };
  }

  stats(): { writes: number; reads: number; failures: number; cachedDescriptors: number } {
    return { writes: this.#writes, reads: this.#reads, failures: this.#failures, cachedDescriptors: this.#descriptors.size };
  }

  faults(): readonly RuntimeFault[] {
    return this.#faults.slice();
  }

  #validateEnvelope(envelope: SaveEnvelope, slot: string): void {
    if (envelope.magic !== 'AAPW-PROD-SAVE') throw new Error('invalid save magic');
    if (envelope.contractVersion !== PRODUCTION_CONTRACT_VERSION) throw new Error('unsupported save contract version');
    if (envelope.version > this.config.version) throw new Error('save requires a newer runtime');
    if (envelope.application !== this.config.application) throw new Error('save belongs to another application');
    if (normalizeSlot(envelope.slot) !== slot) throw new Error('save slot mismatch');
    if (!['manual','autosave','checkpoint','recovery'].includes(envelope.kind)) throw new Error('invalid save kind');
    if (!envelope.state || !Array.isArray(envelope.state.entities)) throw new Error('invalid save state');
  }

  async #enforceSlotLimit(slot: string): Promise<void> {
    const slots = await this.store.list();
    if (slots.includes(slot) || slots.length < this.config.maxSlots) return;
    const descriptors = await this.descriptors();
    descriptors.sort((a, b) => a.createdAtMs - b.createdAtMs || a.slot.localeCompare(b.slot));
    const victim = descriptors.find((descriptor) => descriptor.kind !== 'manual') ?? descriptors[0];
    if (victim) await this.remove(victim.slot);
  }
}

function normalizeSaveState(state: SaveState, maxBytes: number): SaveState {
  const normalized: SaveState = {
    position: normalizeVec3(state.position),
    health: finite(state.health, 0, 1_000_000),
    stamina: finite(state.stamina, 0, 1_000_000),
    flags: Math.max(0, Math.floor(state.flags)) >>> 0,
    entities: state.entities.slice(0, 20_000).map((entity) => ({
      transform: {
        ...entity.transform,
        position: normalizeVec3(entity.transform.position),
        velocity: normalizeVec3(entity.transform.velocity),
      },
      health: finite(entity.health, 0, 1_000_000),
      stamina: finite(entity.stamina, 0, 1_000_000),
      flags: Math.max(0, Math.floor(entity.flags)) >>> 0,
      residency: entity.residency,
      updatedTick: tick(entity.updatedTick),
    })),
    tick: tick(state.tick),
    custom: state.custom ? sanitizeCustom(state.custom) : undefined,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(normalized)).byteLength;
  if (bytes > maxBytes) throw new Error('save state exceeds normalized byte budget');
  return normalized;
}

function sanitizeCustom(value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value).slice(0, 256)) {
    const normalizedKey = normalize(key, 128);
    if (!normalizedKey) continue;
    const validation = validatePayload(nested, { ...DEFAULT_SECURITY_LIMITS, maxObjectDepth: 6, maxArrayLength: 256, maxStringLength: 1024, maxPayloadBytes: 16 * 1024 });
    if (validation.ok) output[normalizedKey] = validation.normalized;
  }
  return output;
}

function stableValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValues);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a],[b]) => a.localeCompare(b)).map(([key,nested]) => [key,stableValues(nested)]));
  }
  return value;
}

function normalizeVec3(value: Vec3 | Partial<Vec3>): Vec3 {
  return {
    x: finite(value?.x, -1_000_000, 1_000_000),
    y: finite(value?.y, -1_000_000, 1_000_000),
    z: finite(value?.z, -1_000_000, 1_000_000),
  };
}

function finite(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  return Math.min(max, Math.max(min, Math.floor(Number.isFinite(value) ? Number(value) : fallback)));
}

function normalize(value: string, limit: number): string {
  return String(value).trim().slice(0, limit);
}

function normalizeSlot(slot: string): string {
  return normalize(slot, 64).replace(/[^a-zA-Z0-9._-]/g, '_');
}
