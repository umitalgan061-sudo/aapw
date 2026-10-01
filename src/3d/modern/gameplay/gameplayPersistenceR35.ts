/**
 * R35 gameplay persistence.
 *
 * Versioned envelopes, deterministic checksums and migrations keep gameplay
 * saves forward-compatible while retaining a browser-free core representation.
 */
import type { EntityId } from '../types.ts';
import type { GameplaySessionSnapshotR35 } from './gameplaySessionAuthorityR35.ts';

export interface GameplaySaveEnvelopeR35 {
  readonly magic: 'AAPW-R35';
  readonly version: 1;
  readonly slot: number;
  readonly ownerId: EntityId;
  readonly createdAtTick: number;
  readonly checksum: string;
  readonly payload: GameplaySessionSnapshotR35;
}

export interface GameplaySaveSummaryR35 {
  readonly slot: number;
  readonly checksum: string;
  readonly level: number;
  readonly experience: number;
  readonly itemCount: number;
  readonly equippedCount: number;
  readonly dialogueNode: string | null;
}

export interface SaveStorageR35 {
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
  keys(): readonly string[];
}

export class MemorySaveStorageR35 implements SaveStorageR35 {
  #values = new Map<string, string>();

  read(key: string): string | null {
    return this.#values.get(key) ?? null;
  }

  write(key: string, value: string): void {
    this.#values.set(key, value);
  }

  remove(key: string): void {
    this.#values.delete(key);
  }

  keys(): readonly string[] {
    return [...this.#values.keys()].sort();
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);

  if (Array.isArray(value)) {
    return '[' + value.map((entry) => stableStringify(entry)).join(',') + ']';
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return (
    '{' +
    keys
      .map((key) => JSON.stringify(key) + ':' + stableStringify(record[key]))
      .join(',') +
    '}'
  );
}

function hash32(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function positiveSlot(slot: number): number {
  return Number.isInteger(slot) && slot >= 0 ? slot : 0;
}

function finiteTick(tick: number): number {
  return Number.isFinite(tick) && tick >= 0 ? Math.floor(tick) : 0;
}

function assertSnapshotShape(snapshot: GameplaySessionSnapshotR35): void {
  if (snapshot.version !== 1) throw new Error('unsupported gameplay snapshot version');
  if (!snapshot.player.entityId) throw new Error('save owner id is missing');
  if (snapshot.inventory.ownerId !== snapshot.player.entityId) {
    throw new Error('inventory owner differs from player');
  }
  if (snapshot.equipment.ownerId !== snapshot.player.entityId) {
    throw new Error('equipment owner differs from player');
  }
  if (snapshot.abilities.ownerId !== snapshot.player.entityId) {
    throw new Error('ability owner differs from player');
  }
}

export class GameplayPersistenceR35 {
  readonly storage: SaveStorageR35;

  constructor(storage: SaveStorageR35 = new MemorySaveStorageR35()) {
    this.storage = storage;
  }

  key(slot: number): string {
    return 'aapw:r35:gameplay:' + positiveSlot(slot).toString(10);
  }

  checksum(snapshot: GameplaySessionSnapshotR35): string {
    assertSnapshotShape(snapshot);
    return hash32(stableStringify(snapshot));
  }

  encode(
    slot: number,
    createdAtTick: number,
    snapshot: GameplaySessionSnapshotR35,
  ): GameplaySaveEnvelopeR35 {
    const normalizedSlot = positiveSlot(slot);
    const payload: GameplaySaveEnvelopeR35 = {
      magic: 'AAPW-R35',
      version: 1,
      slot: normalizedSlot,
      ownerId: snapshot.player.entityId,
      createdAtTick: finiteTick(createdAtTick),
      checksum: this.checksum(snapshot),
      payload: snapshot,
    };
    return payload;
  }

  serialize(envelope: GameplaySaveEnvelopeR35): string {
    if (envelope.magic !== 'AAPW-R35') throw new Error('invalid save magic');
    if (envelope.version !== 1) throw new Error('unsupported save envelope');
    assertSnapshotShape(envelope.payload);
    if (envelope.ownerId !== envelope.payload.player.entityId) {
      throw new Error('save owner mismatch');
    }
    if (envelope.checksum !== this.checksum(envelope.payload)) {
      throw new Error('save checksum mismatch');
    }
    return stableStringify(envelope);
  }

  parse(serialized: string): GameplaySaveEnvelopeR35 {
    let decoded: unknown;
    try {
      decoded = JSON.parse(serialized);
    } catch {
      throw new Error('save payload is not valid JSON');
    }

    if (
      typeof decoded !== 'object' ||
      decoded === null
    ) {
      throw new Error('save payload must be an object');
    }

    const envelope = decoded as Partial<GameplaySaveEnvelopeR35>;
    if (envelope.magic !== 'AAPW-R35') throw new Error('invalid save magic');
    if (envelope.version !== 1) throw new Error('unsupported save version');
    if (!envelope.payload || !envelope.ownerId || !envelope.checksum) {
      throw new Error('save envelope is incomplete');
    }

    const payload = envelope.payload as GameplaySessionSnapshotR35;
    assertSnapshotShape(payload);

    const normalized: GameplaySaveEnvelopeR35 = {
      magic: 'AAPW-R35',
      version: 1,
      slot: positiveSlot(Number(envelope.slot)),
      ownerId: envelope.ownerId,
      createdAtTick: finiteTick(Number(envelope.createdAtTick)),
      checksum: String(envelope.checksum),
      payload,
    };

    if (normalized.ownerId !== payload.player.entityId) {
      throw new Error('save owner mismatch');
    }
    if (normalized.checksum !== this.checksum(payload)) {
      throw new Error('save checksum mismatch');
    }

    return normalized;
  }

  save(
    slot: number,
    tick: number,
    snapshot: GameplaySessionSnapshotR35,
  ): GameplaySaveEnvelopeR35 {
    const envelope = this.encode(slot, tick, snapshot);
    this.storage.write(this.key(slot), this.serialize(envelope));
    return envelope;
  }

  load(slot: number): GameplaySaveEnvelopeR35 | null {
    const serialized = this.storage.read(this.key(slot));
    return serialized ? this.parse(serialized) : null;
  }

  delete(slot: number): void {
    this.storage.remove(this.key(slot));
  }

  listSlots(): readonly number[] {
    const prefix = 'aapw:r35:gameplay:';
    return this.storage
      .keys()
      .filter((key) => key.startsWith(prefix))
      .map((key) => Number(key.slice(prefix.length)))
      .filter((slot) => Number.isInteger(slot))
      .sort((a, b) => a - b);
  }

  summarize(envelope: GameplaySaveEnvelopeR35): GameplaySaveSummaryR35 {
    const payload = envelope.payload;
    const itemCount = payload.inventory.slots.reduce(
      (sum, slot) => sum + (slot.item?.quantity ?? 0),
      0,
    );
    const equippedCount = Object.values(payload.equipment.equipped).filter(
      Boolean,
    ).length;

    return {
      slot: envelope.slot,
      checksum: envelope.checksum,
      level: payload.player.level,
      experience: payload.player.experience,
      itemCount,
      equippedCount,
      dialogueNode: payload.dialogue.activeNodeId,
    };
  }

  duplicate(
    sourceSlot: number,
    targetSlot: number,
  ): GameplaySaveEnvelopeR35 | null {
    const source = this.load(sourceSlot);
    if (!source) return null;
    const clone = this.encode(
      targetSlot,
      source.createdAtTick,
      source.payload,
    );
    this.storage.write(this.key(targetSlot), this.serialize(clone));
    return clone;
  }

  exportSlot(slot: number): string | null {
    return this.storage.read(this.key(slot));
  }

  importSlot(
    slot: number,
    serialized: string,
  ): GameplaySaveEnvelopeR35 {
    const parsed = this.parse(serialized);
    const normalized: GameplaySaveEnvelopeR35 = {
      ...parsed,
      slot: positiveSlot(slot),
    };
    this.storage.write(this.key(normalized.slot), this.serialize(normalized));
    return normalized;
  }

  verify(serialized: string): boolean {
    try {
      this.parse(serialized);
      return true;
    } catch {
      return false;
    }
  }
}
