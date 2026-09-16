import { SaveEnvelope, SnapshotEntity, WorldSnapshot, hashString, stableChecksum, stableStringify, tickValue } from './types.ts';

export interface EncodedWorldState {
  schema: 2;
  tick: number;
  revision: number;
  entities: readonly SnapshotEntity[];
  checksum: number;
  bytes: number;
}

export interface DecodeResult {
  ok: boolean;
  state?: WorldSnapshot;
  errors: readonly string[];
}

export interface CompressionStats {
  rawBytes: number;
  encodedBytes: number;
  ratio: number;
}

function cloneEntity(entity: SnapshotEntity): SnapshotEntity {
  return { id: entity.id, mask: entity.mask, components: JSON.parse(JSON.stringify(entity.components)) as Record<string, unknown> };
}

function canonicalEntities(entities: readonly SnapshotEntity[]): SnapshotEntity[] {
  return [...entities]
    .map(cloneEntity)
    .sort((a, b) => Number(a.id) - Number(b.id));
}

export class WorldStateCodecV2 {
  readonly #maxEntities: number;
  readonly #maxBytes: number;

  constructor(maxEntities = 12000, maxBytes = 2 * 1024 * 1024) {
    if (!Number.isInteger(maxEntities) || maxEntities <= 0) throw new RangeError('maxEntities must be positive integer');
    if (!Number.isInteger(maxBytes) || maxBytes <= 0) throw new RangeError('maxBytes must be positive integer');
    this.#maxEntities = maxEntities;
    this.#maxBytes = maxBytes;
  }

  encode(state: WorldSnapshot): EncodedWorldState {
    const entities = canonicalEntities(state.entities);
    if (entities.length > this.#maxEntities) throw new RangeError('Entity count exceeds codec limit');
    const body = { schema: 2 as const, tick: Number(state.tick), revision: Number(state.revision), entities };
    const checksum = stableChecksum(entities);
    if (state.checksum !== checksum) throw new Error('Cannot encode invalid world checksum');
    const serialized = JSON.stringify({ ...body, checksum });
    const bytes = new TextEncoder().encode(serialized).byteLength;
    if (bytes > this.#maxBytes) throw new RangeError('Encoded world state exceeds codec byte limit');
    return { ...body, checksum, bytes };
  }

  serialize(state: WorldSnapshot): string {
    return JSON.stringify(this.encode(state));
  }

  decode(serialized: string): DecodeResult {
    const errors: string[] = [];
    let parsed: EncodedWorldState;
    try { parsed = JSON.parse(serialized) as EncodedWorldState; } catch { return { ok: false, errors: ['invalid_json'] }; }
    if (new TextEncoder().encode(serialized).byteLength > this.#maxBytes) errors.push('byte_limit');
    if (parsed.schema !== 2) errors.push('schema');
    if (!Number.isInteger(parsed.tick) || parsed.tick < 0) errors.push('tick');
    if (!Number.isInteger(parsed.revision) || parsed.revision < 0) errors.push('revision');
    if (!Array.isArray(parsed.entities) || parsed.entities.length > this.#maxEntities) errors.push('entities');
    if (!Number.isInteger(parsed.checksum)) errors.push('checksum');
    if (!Number.isFinite(parsed.bytes) || parsed.bytes < 0) errors.push('bytes');
    if (errors.length) return { ok: false, errors };
    const entities = canonicalEntities(parsed.entities);
    const checksum = stableChecksum(entities);
    if (checksum !== parsed.checksum) return { ok: false, errors: ['checksum_mismatch'] };
    return {
      ok: true,
      state: {
        tick: tickValue(parsed.tick),
        revision: parsed.revision as WorldSnapshot['revision'],
        entities,
        checksum,
      },
      errors,
    };
  }

  compressibility(state: WorldSnapshot): CompressionStats {
    const raw = JSON.stringify(state);
    const encoded = this.serialize(state);
    const rawBytes = new TextEncoder().encode(raw).byteLength;
    const encodedBytes = new TextEncoder().encode(encoded).byteLength;
    return { rawBytes, encodedBytes, ratio: rawBytes === 0 ? 1 : encodedBytes / rawBytes };
  }

  envelope(state: WorldSnapshot, metadata: Record<string, string | number | boolean> = {}): SaveEnvelope {
    const body = {
      magic: 'AAPW-SAVE',
      version: 2,
      tick: state.tick,
      revision: state.revision,
    };
    return {
      header: { ...body, checksum: stableChecksum(body) },
      world: state,
      metadata,
    };
  }

  verifyEnvelope(envelope: SaveEnvelope): string[] {
    const errors: string[] = [];
    if (envelope.header.magic !== 'AAPW-SAVE') errors.push('magic');
    if (envelope.header.version !== 2) errors.push('version');
    const expectedHeader = stableChecksum({ magic: envelope.header.magic, version: envelope.header.version, tick: envelope.header.tick, revision: envelope.header.revision });
    if (expectedHeader !== envelope.header.checksum) errors.push('header_checksum');
    if (stableChecksum(envelope.world.entities) !== envelope.world.checksum) errors.push('world_checksum');
    return errors;
  }

  digest(state: WorldSnapshot): number {
    let digest = hashString(String(state.tick));
    digest = Math.imul(digest ^ Number(state.revision), 16777619) >>> 0;
    for (const entity of canonicalEntities(state.entities)) {
      digest = Math.imul(digest ^ Number(entity.id), 16777619) >>> 0;
      digest = Math.imul(digest ^ entity.mask, 16777619) >>> 0;
      digest = Math.imul(digest ^ stableChecksum(entity.components), 16777619) >>> 0;
    }
    return digest >>> 0;
  }

  canonicalJson(state: WorldSnapshot): string {
    return stableStringify({ tick: state.tick, revision: state.revision, entities: canonicalEntities(state.entities), checksum: state.checksum });
  }
}
