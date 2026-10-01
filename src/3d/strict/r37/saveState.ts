import type { SaveEnvelope, WorldStateSnapshot } from './types.ts';
import { stableJson } from './math.ts';
import { WorldStateR37 } from './worldState.ts';

export interface SaveCodecConfig {
  readonly profileId: string;
  readonly maxSerializedBytes: number;
}

const DEFAULT_CONFIG: SaveCodecConfig = Object.freeze({
  profileId: 'default',
  maxSerializedBytes: 2_000_000,
});

export class SaveStateR37 {
  readonly config: SaveCodecConfig;
  #slots = new Map<string, SaveEnvelope>();

  constructor(config: Partial<SaveCodecConfig> = {}) {
    this.config = Object.freeze({
      ...DEFAULT_CONFIG,
      ...config,
      profileId: String(config.profileId ?? DEFAULT_CONFIG.profileId).slice(0, 64),
      maxSerializedBytes: Math.max(1024, Math.trunc(Number(config.maxSerializedBytes ?? DEFAULT_CONFIG.maxSerializedBytes))),
    });
  }

  createEnvelope(world: WorldStateR37, inputSequence: number, metadata: Readonly<Record<string, string>> = {}): SaveEnvelope {
    const envelope: SaveEnvelope = Object.freeze({
      schema: 37,
      profileId: this.config.profileId,
      createdAtMs: nowMs(),
      world: world.snapshot(),
      inputSequence: Math.max(0, Math.trunc(inputSequence)),
      metadata: Object.freeze(Object.fromEntries(Object.entries(metadata).slice(0, 64).map(([key, value]) => [key.slice(0, 64), String(value).slice(0, 256)]))),
    });
    this.#assertSize(envelope);
    return envelope;
  }

  write(slot: string, envelope: SaveEnvelope): boolean {
    const safeSlot = sanitizeSlot(slot);
    if (!safeSlot) return false;
    try {
      this.#assertSize(envelope);
      this.#slots.set(safeSlot, envelope);
      return true;
    } catch {
      return false;
    }
  }

  read(slot: string): SaveEnvelope | undefined {
    return this.#slots.get(sanitizeSlot(slot));
  }

  remove(slot: string): boolean {
    return this.#slots.delete(sanitizeSlot(slot));
  }

  list(): readonly string[] {
    return Object.freeze([...this.#slots.keys()].sort());
  }

  encode(envelope: SaveEnvelope): string {
    this.#assertSize(envelope);
    return stableJson(envelope);
  }

  decode(serialized: string): SaveEnvelope {
    if (serialized.length > this.config.maxSerializedBytes) throw new RangeError('save payload exceeds limit');
    const parsed = JSON.parse(serialized) as Partial<SaveEnvelope>;
    if (parsed.schema !== 37 || !parsed.world || parsed.world.version !== 37) throw new RangeError('unsupported save schema');
    return normalizeEnvelope(parsed as SaveEnvelope);
  }

  restore(world: WorldStateR37, envelope: SaveEnvelope): void {
    world.restore(envelope.world);
  }

  cloneWorldSnapshot(snapshot: WorldStateSnapshot): WorldStateSnapshot {
    return normalizeWorld(snapshot);
  }

  #assertSize(value: unknown): void {
    const serialized = stableJson(value);
    if (serialized.length > this.config.maxSerializedBytes) throw new RangeError('save payload exceeds limit');
  }
}

function normalizeEnvelope(input: SaveEnvelope): SaveEnvelope {
  return Object.freeze({
    schema: 37,
    profileId: String(input.profileId).slice(0, 64),
    createdAtMs: Math.max(0, Number(input.createdAtMs)),
    world: normalizeWorld(input.world),
    inputSequence: Math.max(0, Math.trunc(Number(input.inputSequence))),
    metadata: Object.freeze(Object.fromEntries(Object.entries(input.metadata ?? {}).slice(0, 64).map(([key, value]) => [String(key).slice(0, 64), String(value).slice(0, 256)]))),
  });
}

function normalizeWorld(input: WorldStateSnapshot): WorldStateSnapshot {
  return Object.freeze({
    version: 37,
    seed: Math.trunc(Number(input.seed)),
    tick: Math.max(0, Math.trunc(Number(input.tick))),
    mode: input.mode,
    entities: Object.freeze([...input.entities]),
    flags: Object.freeze({ ...input.flags }),
    values: Object.freeze({ ...input.values }),
  });
}

function sanitizeSlot(value: string): string {
  return String(value ?? '').trim().replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 64);
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : 0;
}
