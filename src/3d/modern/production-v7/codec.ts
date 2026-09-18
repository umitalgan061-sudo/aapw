import { ContentHashV7, EntityRecordV7, RuntimeCommandV7, WorldSnapshotV7, hashV7, tickV7, revisionV7, TickV7, RevisionV7 } from './types.ts';
import { checksumV7, stableStringifyV7 } from './deterministic.ts';

export type CodecErrorCodeV7 = 'invalid-json' | 'invalid-envelope' | 'checksum' | 'size' | 'unsupported-protocol' | 'invalid-command';

export interface CodecLimitsV7 { readonly maxBytes: number; readonly maxEntities: number; readonly maxTagsPerEntity: number; }
export const DEFAULT_CODEC_LIMITS_V7: CodecLimitsV7 = Object.freeze({ maxBytes: 512 * 1024, maxEntities: 10_000, maxTagsPerEntity: 64 });

export interface EncodedSnapshotV7 { readonly protocol: 7; readonly payload: string; readonly bytes: number; readonly checksum: ContentHashV7; }

const utf8Bytes = (value: string): number => new TextEncoder().encode(value).byteLength;

export class RuntimeCodecV7 {
  readonly #limits: CodecLimitsV7;
  constructor(limits: Partial<CodecLimitsV7> = {}) { this.#limits = Object.freeze({ ...DEFAULT_CODEC_LIMITS_V7, ...limits }); }

  encodeSnapshot(snapshot: WorldSnapshotV7): EncodedSnapshotV7 {
    this.#validateSnapshotShape(snapshot);
    const payload = stableStringifyV7(snapshot);
    const bytes = utf8Bytes(payload);
    if (bytes > this.#limits.maxBytes) throw new RangeError('Snapshot exceeds codec byte limit');
    return Object.freeze({ protocol: 7, payload, bytes, checksum: checksumV7(snapshot) });
  }

  decodeSnapshot(encoded: EncodedSnapshotV7): WorldSnapshotV7 {
    if (encoded.protocol !== 7) throw new Error('Unsupported snapshot protocol');
    if (encoded.bytes > this.#limits.maxBytes) throw new RangeError('Encoded snapshot exceeds byte limit');
    let parsed: unknown;
    try { parsed = JSON.parse(encoded.payload); } catch { throw new Error('Invalid snapshot JSON'); }
    this.#validateSnapshotShape(parsed);
    if (checksumV7(parsed) !== encoded.checksum) throw new Error('Snapshot checksum mismatch');
    return parsed as WorldSnapshotV7;
  }

  encodeCommand(command: RuntimeCommandV7): string {
    if (command.type === 'tag' && command.tag.length > this.#limits.maxTagsPerEntity) throw new Error('Tag exceeds configured entity tag limit');
    const payload = stableStringifyV7({ protocol: 7, command });
    if (utf8Bytes(payload) > this.#limits.maxBytes) throw new RangeError('Command exceeds codec byte limit');
    return payload;
  }

  decodeCommand(payload: string): RuntimeCommandV7 {
    if (utf8Bytes(payload) > this.#limits.maxBytes) throw new RangeError('Command exceeds codec byte limit');
    try {
      const parsed = JSON.parse(payload) as { protocol?: unknown; command?: RuntimeCommandV7 };
      if (parsed.protocol !== 7 || !parsed.command || typeof parsed.command.type !== 'string') throw new Error('invalid envelope');
      if (!this.#validCommand(parsed.command)) throw new Error('invalid command');
      return parsed.command;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'invalid payload';
      throw new Error(message);
    }
  }

  #validateSnapshotShape(value: unknown): asserts value is WorldSnapshotV7 {
    if (!value || typeof value !== 'object') throw new Error('invalid snapshot envelope');
    const candidate = value as Partial<WorldSnapshotV7>;
    if (Number(candidate.tick) < 0 || Number(candidate.revision) < 0 || !Array.isArray(candidate.entities) || !Array.isArray(candidate.deltas) || typeof candidate.checksum !== 'string') throw new Error('invalid snapshot envelope');
    if (candidate.entities.length > this.#limits.maxEntities) throw new RangeError('snapshot entity limit exceeded');
    for (const entity of candidate.entities) {
      if (!entity || typeof entity !== 'object' || !entity.components || entity.components.tags.length > this.#limits.maxTagsPerEntity) throw new Error('invalid entity payload');
    }
  }

  #validCommand(command: RuntimeCommandV7): boolean {
    const base = command as { type?: unknown };
    if (!['spawn', 'despawn', 'move', 'damage', 'heal', 'interest', 'tag', 'mode'].includes(String(base.type))) return false;
    if ('id' in command && (!Number.isInteger(Number((command as { id?: number }).id)) || Number((command as { id?: number }).id) < 0)) return false;
    if ((command.type === 'damage' || command.type === 'heal') && (!Number.isFinite(command.amount) || command.amount < 0)) return false;
    return true;
  }
}
