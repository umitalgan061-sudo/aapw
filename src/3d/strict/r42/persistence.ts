/**
 * Versioned save/restore and migration ledger for R42.
 * Production TypeScript owner.
 */

import type { SaveEnvelope, WorldEntity } from './types.ts';
import { R42_VERSION, cloneEntity, deepFreeze, hashValue, safeInteger } from './types.ts';

export interface SaveStore {
  read(slot: string): Promise<string | null>;
  write(slot: string, payload: string): Promise<void>;
  remove(slot: string): Promise<void>;
  list(): Promise<readonly string[]>;
}

export class MemorySaveStoreR42 implements SaveStore {
  #entries = new Map<string, string>();

  async read(slot: string): Promise<string | null> { return this.#entries.get(slot) ?? null; }
  async write(slot: string, payload: string): Promise<void> { this.#entries.set(slot, payload); }
  async remove(slot: string): Promise<void> { this.#entries.delete(slot); }
  async list(): Promise<readonly string[]> { return Object.freeze([...this.#entries.keys()].sort()); }
}

export interface SaveMetadata {
  readonly version: number;
  readonly slot: string;
  readonly tick: number;
  readonly revision: number;
  readonly bytes: number;
  readonly checksum: number;
}

export class SaveSystemR42 {
  readonly store: SaveStore;
  readonly maxBytes: number;
  readonly maxEntities: number;

  constructor(store: SaveStore = new MemorySaveStoreR42(), maxBytes = 8 * 1024 * 1024, maxEntities = 8192) {
    this.store = store;
    this.maxBytes = Math.max(64 * 1024, Math.trunc(maxBytes));
    this.maxEntities = Math.max(1, Math.trunc(maxEntities));
  }

  encode(
    slot: string,
    tick: number,
    revision: number,
    world: readonly WorldEntity[],
    metadata: Readonly<Record<string, string>> = {},
  ): SaveEnvelope {
    const entities = world.slice(0, this.maxEntities).map(cloneEntity);
    const envelopeWithoutChecksum = {
      schema: R42_VERSION,
      slot: sanitizeSlot(slot),
      revision: safeInteger(revision),
      tick: safeInteger(tick),
      world: entities,
      metadata: Object.fromEntries(Object.entries(metadata).slice(0, 64)),
    };
    const checksum = hashValue(envelopeWithoutChecksum);
    return deepFreeze({
      ...envelopeWithoutChecksum,
      schema: 42,
      checksum,
    });
  }

  serialize(envelope: SaveEnvelope): string {
    const text = JSON.stringify(envelope);
    if (text.length > this.maxBytes) throw new Error('R42 save exceeds size budget.');
    return text;
  }

  parse(payload: string): SaveEnvelope {
    if (payload.length > this.maxBytes) throw new Error('R42 save payload exceeds size budget.');
    const parsed: unknown = JSON.parse(payload);
    if (!isSaveEnvelope(parsed)) throw new Error('R42 save schema is invalid.');
    const expected = hashValue({
      schema: parsed.schema,
      slot: parsed.slot,
      revision: parsed.revision,
      tick: parsed.tick,
      world: parsed.world,
      metadata: parsed.metadata,
    });
    if (expected !== parsed.checksum) throw new Error('R42 save checksum mismatch.');
    return deepFreeze({
      ...parsed,
      world: parsed.world.map(cloneEntity),
      metadata: Object.freeze({ ...parsed.metadata }),
    });
  }

  async save(
    slot: string,
    tick: number,
    revision: number,
    world: readonly WorldEntity[],
    metadata: Readonly<Record<string, string>> = {},
  ): Promise<SaveMetadata> {
    const envelope = this.encode(slot, tick, revision, world, metadata);
    const serialized = this.serialize(envelope);
    await this.store.write(envelope.slot, serialized);
    return Object.freeze({
      version: envelope.schema,
      slot: envelope.slot,
      tick: envelope.tick,
      revision: envelope.revision,
      bytes: serialized.length,
      checksum: envelope.checksum,
    });
  }

  async load(slot: string): Promise<SaveEnvelope | null> {
    const payload = await this.store.read(sanitizeSlot(slot));
    return payload === null ? null : this.parse(payload);
  }

  async delete(slot: string): Promise<void> {
    await this.store.remove(sanitizeSlot(slot));
  }

  async slots(): Promise<readonly string[]> {
    return this.store.list();
  }
}

function isSaveEnvelope(value: unknown): value is SaveEnvelope {
  if (!value || typeof value !== 'object') return false;
  const objectValue = value as Record<string, unknown>;
  return objectValue.schema === 42
    && typeof objectValue.slot === 'string'
    && typeof objectValue.revision === 'number'
    && typeof objectValue.tick === 'number'
    && Array.isArray(objectValue.world)
    && typeof objectValue.checksum === 'number'
    && !!objectValue.metadata
    && typeof objectValue.metadata === 'object';
}

function sanitizeSlot(value: string): string {
  return String(value).normalize('NFKC').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 64) || 'default';
}
