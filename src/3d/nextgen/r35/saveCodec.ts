const MAGIC = 'AAPW-R35';
const VERSION = 1;
const HEADER_BYTES = 20;

export interface SaveHeader {
  readonly version: number;
  readonly flags: number;
  readonly tick: number;
  readonly payloadBytes: number;
  readonly checksum: number;
}

export interface SaveEnvelope<T> {
  readonly header: SaveHeader;
  readonly payload: T;
}

export interface SaveMigration<T> {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly migrate: (payload: unknown) => T;
}

function fnv1a(bytes: Uint8Array): number {
  let hash = 2166136261;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function encodeJson<T>(payload: T): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(payload));
}

function decodeJson<T>(bytes: Uint8Array): T {
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

function writeUint32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

function readUint32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

export class R35SaveCodec {
  readonly migrations: readonly SaveMigration<unknown>[];
  #migrations = new Map<number, SaveMigration<unknown>>();

  constructor(migrations: readonly SaveMigration<unknown>[] = []) {
    this.migrations = Object.freeze([...migrations]);
    for (const migration of migrations) this.#migrations.set(migration.fromVersion, migration);
  }

  encode<T>(payload: T, tick: number, flags = 0): Uint8Array {
    if (!Number.isInteger(tick) || tick < 0) throw new RangeError('tick must be a non-negative integer');
    const payloadBytes = encodeJson(payload);
    const output = new Uint8Array(HEADER_BYTES + payloadBytes.byteLength);
    const view = new DataView(output.buffer);
    output.set(new TextEncoder().encode(MAGIC), 0);
    view.setUint8(8, VERSION);
    view.setUint8(9, flags & 0xff);
    writeUint32(view, 10, tick);
    writeUint32(view, 14, payloadBytes.byteLength);
    writeUint32(view, 18, fnv1a(payloadBytes));
    output.set(payloadBytes, HEADER_BYTES);
    return output;
  }

  decode<T>(bytes: Uint8Array): SaveEnvelope<T> {
    if (bytes.byteLength < HEADER_BYTES) throw new Error('save payload is truncated');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const magic = new TextDecoder().decode(bytes.slice(0, 8));
    if (magic !== MAGIC) throw new Error('invalid save magic');
    const version = view.getUint8(8);
    const flags = view.getUint8(9);
    const tick = readUint32(view, 10);
    const payloadBytesLength = readUint32(view, 14);
    const expectedChecksum = readUint32(view, 18);
    if (HEADER_BYTES + payloadBytesLength !== bytes.byteLength) throw new Error('save length mismatch');
    const payloadBytes = bytes.slice(HEADER_BYTES);
    if (fnv1a(payloadBytes) !== expectedChecksum) throw new Error('save checksum mismatch');

    let payload: unknown = decodeJson(payloadBytes);
    let currentVersion = version;
    const visited = new Set<number>();
    while (currentVersion !== VERSION) {
      if (visited.has(currentVersion)) throw new Error('save migration cycle detected');
      visited.add(currentVersion);
      const migration = this.#migrations.get(currentVersion);
      if (!migration) throw new Error('missing save migration from version ' + currentVersion);
      payload = migration.migrate(payload);
      currentVersion = migration.toVersion;
    }

    return {
      header: {
        version: currentVersion,
        flags,
        tick,
        payloadBytes: payloadBytesLength,
        checksum: expectedChecksum,
      },
      payload: payload as T,
    };
  }

  validate(bytes: Uint8Array): { readonly valid: boolean; readonly reason: string | null } {
    try {
      this.decode(bytes);
      return { valid: true, reason: null };
    } catch (error) {
      return { valid: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }
}

export function createSaveMigration<T>(
  fromVersion: number,
  toVersion: number,
  migrate: (payload: unknown) => T,
): SaveMigration<T> {
  if (!Number.isInteger(fromVersion) || fromVersion < 0) throw new RangeError('invalid migration source');
  if (!Number.isInteger(toVersion) || toVersion <= fromVersion) throw new RangeError('migration target must be greater');
  return Object.freeze({ fromVersion, toVersion, migrate });
}

export function saveMagic(): string {
  return MAGIC;
}
