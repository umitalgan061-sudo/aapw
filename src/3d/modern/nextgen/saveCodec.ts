import { SaveEnvelope, SaveHeader, WorldSnapshot, hashString, stableStringify, tickValue, revisionValue } from './types.ts';

export const SAVE_MAGIC = 'AAPW-NEXTGEN-SAVE';
export const SAVE_VERSION = 1;
export const MAX_SAVE_BYTES = 8 * 1024 * 1024;

export interface SaveMetadata {
  profile: string;
  platform: string;
  build: string;
  [key: string]: string | number | boolean;
}

export interface EncodedSave {
  text: string;
  bytes: number;
  checksum: number;
}

export function encodeSave(world: WorldSnapshot, metadata: SaveMetadata): EncodedSave {
  const header: SaveHeader = {
    magic: SAVE_MAGIC,
    version: SAVE_VERSION,
    tick: world.tick,
    revision: world.revision,
    checksum: hashString(stableStringify(world)),
  };
  const envelope: SaveEnvelope = { header, world, metadata };
  const text = JSON.stringify(envelope);
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > MAX_SAVE_BYTES) throw new Error(`Save exceeds ${MAX_SAVE_BYTES} bytes`);
  return { text, bytes, checksum: hashString(text) };
}

export function decodeSave(text: string): SaveEnvelope {
  if (new TextEncoder().encode(text).byteLength > MAX_SAVE_BYTES) throw new Error('Save exceeds size limit');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid save JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed)) throw new Error('Save root must be an object');
  const header = parsed.header;
  const world = parsed.world;
  if (!isRecord(header) || !isRecord(world)) throw new Error('Save header/world missing');
  if (header.magic !== SAVE_MAGIC || header.version !== SAVE_VERSION) throw new Error('Unsupported save format');
  if (!Number.isInteger(header.tick) || header.tick < 0) throw new Error('Invalid save tick');
  if (!Number.isInteger(header.revision) || header.revision < 0) throw new Error('Invalid save revision');
  const envelope = parsed as SaveEnvelope;
  const expected = hashString(stableStringify(envelope.world));
  if (header.checksum !== expected) throw new Error('Save checksum mismatch');
  if (!Array.isArray(world.entities)) throw new Error('Save entities must be an array');
  return envelope;
}

export function migrateSave(text: string, targetVersion = SAVE_VERSION): SaveEnvelope {
  const envelope = decodeSave(text);
  if (envelope.header.version === targetVersion) return envelope;
  throw new Error(`No migration path from v${envelope.header.version} to v${targetVersion}`);
}

export function emptyWorldSnapshot(): WorldSnapshot {
  return { tick: tickValue(0), revision: revisionValue(0), entities: [], checksum: 0 };
}

export function saveDigest(envelope: SaveEnvelope): number {
  return hashString(stableStringify({ header: envelope.header, world: envelope.world, metadata: envelope.metadata }));
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
