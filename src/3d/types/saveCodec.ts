import type { GameplaySnapshot, MigrationStep, SaveEnvelope, SaveHeader, SaveSlot, SnapshotVersion, WorldId, Tick } from './platform.js';

export interface SaveCodecOptions {
  readonly schemaHash: string;
  readonly version: SnapshotVersion;
  readonly compression?: CompressionStream['constructor'] extends never ? never : 'gzip' | 'deflate' | 'none';
}

export interface SaveValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

export interface SaveMigrationRegistry {
  readonly current: SnapshotVersion;
  add(step: MigrationStep<SnapshotVersion, SnapshotVersion>): void;
  migrate(snapshot: GameplaySnapshot): GameplaySnapshot;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

async function digestHex(value: string): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return fnv1a(value);
  const bytes = await crypto.subtle.digest('SHA-256', textEncoder.encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (const byte of textEncoder.encode(value)) { hash ^= byte; hash = Math.imul(hash, 0x01000193); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(',')}}`;
}

export class VersionedSaveCodec {
  readonly #options: { readonly schemaHash: string; readonly version: SnapshotVersion; readonly compression: 'gzip' | 'deflate' | 'none' };
  readonly #migrations = new Map<SnapshotVersion, MigrationStep<SnapshotVersion, SnapshotVersion>>();

  constructor(options: SaveCodecOptions) {
    if (!options.schemaHash.trim()) throw new TypeError('Save schema hash is required');
    if (!/^\d+\.\d+\.\d+$/.test(options.version)) throw new TypeError('Save version must be semantic');
    this.#options = { schemaHash: options.schemaHash, version: options.version, compression: options.compression ?? 'none' };
  }

  register(step: MigrationStep<SnapshotVersion, SnapshotVersion>): void {
    if (this.#migrations.has(step.from)) throw new Error(`Duplicate save migration from ${step.from}`);
    this.#migrations.set(step.from, step);
  }

  migrate(snapshot: GameplaySnapshot): GameplaySnapshot {
    let current = snapshot;
    const seen = new Set<SnapshotVersion>();
    while (current.header.version !== this.#options.version) {
      if (seen.has(current.header.version)) throw new Error(`Save migration cycle at ${current.header.version}`);
      seen.add(current.header.version);
      const step = this.#migrations.get(current.header.version);
      if (!step) throw new Error(`No save migration from ${current.header.version} to ${this.#options.version}`);
      current = step.migrate(current);
    }
    return current;
  }

  async encode(snapshot: GameplaySnapshot): Promise<SaveEnvelope> {
    const migrated = this.migrate(snapshot);
    const canonical = stableStringify(migrated);
    const checksum = await digestHex(canonical);
    const encoded = this.#options.compression === 'none' ? canonical : await this.#compress(canonical);
    const header: SaveHeader = {
      ...migrated.header,
      format: 'aapw-save',
      version: this.#options.version,
      schemaHash: this.#options.schemaHash,
      updatedAt: Date.now(),
    };
    return { header, compression: this.#options.compression === 'gzip' ? 'gzip' : this.#options.compression === 'deflate' ? 'none' : 'none', checksum, payload: encoded };
  }

  async decode(envelope: SaveEnvelope): Promise<GameplaySnapshot> {
    const errors = validateSaveEnvelope(envelope);
    if (!errors.valid) throw new Error(errors.errors.join('; '));
    const canonical = envelope.compression === 'gzip' ? await this.#decompress(envelope.payload) : envelope.payload;
    const checksum = await digestHex(canonical);
    if (checksum !== envelope.checksum) throw new Error('Save checksum mismatch');
    const parsed = JSON.parse(canonical) as GameplaySnapshot;
    return this.migrate(parsed);
  }

  async #compress(value: string): Promise<string> {
    if (typeof CompressionStream === 'undefined') return value;
    const stream = new CompressionStream(this.#options.compression === 'gzip' ? 'gzip' : 'deflate');
    const writer = stream.writable.getWriter();
    await writer.write(textEncoder.encode(value));
    await writer.close();
    const bytes = new Uint8Array(await new Response(stream.readable).arrayBuffer());
    return btoa(String.fromCharCode(...bytes));
  }

  async #decompress(value: string): Promise<string> {
    if (typeof DecompressionStream === 'undefined') throw new Error('DecompressionStream unavailable');
    const binary = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
    const stream = new DecompressionStream('gzip');
    const writer = stream.writable.getWriter();
    await writer.write(binary);
    await writer.close();
    return textDecoder.decode(await new Response(stream.readable).arrayBuffer());
  }
}

export function validateSaveEnvelope(envelope: SaveEnvelope): SaveValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (envelope.header.format !== 'aapw-save') errors.push('unsupported format');
  if (!/^\d+\.\d+\.\d+$/.test(envelope.header.version)) errors.push('invalid version');
  if (!envelope.header.schemaHash.trim()) errors.push('missing schema hash');
  if (!Number.isFinite(envelope.header.createdAt) || envelope.header.createdAt <= 0) errors.push('invalid createdAt');
  if (!Number.isFinite(envelope.header.updatedAt) || envelope.header.updatedAt <= 0) errors.push('invalid updatedAt');
  if (!Number.isSafeInteger(envelope.header.tick) || Number(envelope.header.tick) < 0) errors.push('invalid tick');
  if (!Number.isFinite(envelope.header.playTimeSeconds) || envelope.header.playTimeSeconds < 0) errors.push('invalid play time');
  if (!envelope.payload) errors.push('missing payload');
  if (!/^[0-9a-f]+$/i.test(envelope.checksum) || envelope.checksum.length < 8) errors.push('invalid checksum');
  if (envelope.compression === 'brotli') warnings.push('brotli is reserved for a future codec revision');
  return { valid: errors.length === 0, errors, warnings };
}

export interface SaveMetadata {
  readonly slot: SaveSlot;
  readonly worldId: WorldId;
  readonly tick: Tick;
  readonly createdAt: number;
  readonly bytes: number;
}

export function buildSaveMetadata(slot: SaveSlot, envelope: SaveEnvelope): SaveMetadata {
  return { slot, worldId: envelope.header.worldId, tick: envelope.header.tick, createdAt: envelope.header.createdAt, bytes: new TextEncoder().encode(envelope.payload).byteLength };
}
