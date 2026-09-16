export type SaveVersion = number;

export interface SaveEnvelope<T = unknown> {
  readonly format: 'aapw-save';
  readonly version: SaveVersion;
  readonly createdAtTick: number;
  readonly worldSeed: number;
  readonly profileId: string;
  readonly payload: T;
  readonly checksum: string;
}

export interface SaveMigration<TFrom = unknown, TTo = unknown> {
  readonly fromVersion: SaveVersion;
  readonly toVersion: SaveVersion;
  readonly id: string;
  readonly migrate: (value: TFrom) => TTo;
}

export interface SaveValidationResult {
  readonly valid: boolean;
  readonly version: SaveVersion | null;
  readonly errors: readonly string[];
}

export interface SaveStore {
  readonly write: (key: string, value: string) => Promise<void>;
  readonly read: (key: string) => Promise<string | null>;
  readonly remove: (key: string) => Promise<void>;
}

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stable(object[key])}`).join(',')}}`;
}

function checksum(value: unknown): string {
  const input = stable(value);
  let h = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    h ^= input.charCodeAt(index);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function validateSaveEnvelope(value: unknown, maxPayloadBytes = 2_000_000): SaveValidationResult {
  const errors: string[] = [];
  if (!value || typeof value !== 'object') return { valid: false, version: null, errors: ['save must be an object'] };
  const candidate = value as Partial<SaveEnvelope>;
  if (candidate.format !== 'aapw-save') errors.push('invalid format');
  if (!Number.isInteger(candidate.version) || Number(candidate.version) < 1) errors.push('invalid version');
  if (!Number.isInteger(candidate.createdAtTick) || Number(candidate.createdAtTick) < 0) errors.push('invalid createdAtTick');
  if (!Number.isFinite(candidate.worldSeed)) errors.push('invalid worldSeed');
  if (typeof candidate.profileId !== 'string' || !candidate.profileId.trim() || candidate.profileId.length > 128) errors.push('invalid profileId');
  if (!('payload' in candidate)) errors.push('missing payload');
  if (typeof candidate.checksum !== 'string' || !/^[0-9a-f]{8}$/.test(candidate.checksum)) errors.push('invalid checksum');
  try {
    const payloadText = stable(candidate.payload);
    if (new TextEncoder().encode(payloadText).byteLength > maxPayloadBytes) errors.push('payload exceeds size limit');
    if (candidate.checksum && checksum({
      format: candidate.format,
      version: candidate.version,
      createdAtTick: candidate.createdAtTick,
      worldSeed: candidate.worldSeed,
      profileId: candidate.profileId,
      payload: candidate.payload,
    }) !== candidate.checksum) errors.push('checksum mismatch');
  } catch {
    errors.push('payload serialization failed');
  }
  return { valid: errors.length === 0, version: Number.isInteger(candidate.version) ? Number(candidate.version) : null, errors };
}

export function encodeSave<T>(input: Omit<SaveEnvelope<T>, 'format' | 'checksum'>): string {
  if (!Number.isInteger(input.version) || input.version < 1) throw new RangeError('invalid version');
  if (!Number.isInteger(input.createdAtTick) || input.createdAtTick < 0) throw new RangeError('invalid createdAtTick');
  if (!Number.isFinite(input.worldSeed)) throw new RangeError('invalid worldSeed');
  if (!input.profileId.trim() || input.profileId.length > 128) throw new RangeError('invalid profileId');
  const body = {
    format: 'aapw-save' as const,
    version: input.version,
    createdAtTick: input.createdAtTick,
    worldSeed: input.worldSeed,
    profileId: input.profileId,
    payload: structuredClone(input.payload),
  };
  return JSON.stringify({ ...body, checksum: checksum(body) });
}

export function decodeSave<T = unknown>(encoded: string, maxPayloadBytes = 2_000_000): SaveEnvelope<T> {
  if (typeof encoded !== 'string' || encoded.length === 0) throw new Error('empty save');
  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded);
  } catch {
    throw new Error('malformed save JSON');
  }
  const validation = validateSaveEnvelope(parsed, maxPayloadBytes);
  if (!validation.valid) throw new Error(`invalid save: ${validation.errors.join(', ')}`);
  return parsed as SaveEnvelope<T>;
}

export class SaveMigrationGraph {
  readonly #migrations = new Map<SaveVersion, SaveMigration>();

  public register<TFrom, TTo>(migration: SaveMigration<TFrom, TTo>): void {
    if (!Number.isInteger(migration.fromVersion) || migration.fromVersion < 1) throw new RangeError('invalid fromVersion');
    if (!Number.isInteger(migration.toVersion) || migration.toVersion <= migration.fromVersion) throw new RangeError('migration must move forward');
    if (!migration.id.trim()) throw new Error('migration id must not be empty');
    if (this.#migrations.has(migration.fromVersion)) throw new Error(`migration from ${migration.fromVersion} already exists`);
    this.#migrations.set(migration.fromVersion, migration as SaveMigration);
  }

  public path(fromVersion: SaveVersion, toVersion: SaveVersion): readonly SaveMigration[] {
    if (fromVersion === toVersion) return [];
    if (fromVersion > toVersion) throw new Error('downgrades are not supported');
    const result: SaveMigration[] = [];
    let version = fromVersion;
    const visited = new Set<number>();
    while (version < toVersion) {
      if (visited.has(version)) throw new Error('migration cycle detected');
      visited.add(version);
      const next = [...this.#migrations.values()]
        .filter((migration) => migration.fromVersion === version && migration.toVersion <= toVersion)
        .sort((a, b) => b.toVersion - a.toVersion || a.id.localeCompare(b.id))[0];
      if (!next) throw new Error(`no migration path from ${version} to ${toVersion}`);
      result.push(next);
      version = next.toVersion;
    }
    if (version !== toVersion) throw new Error(`migration path stopped at ${version}`);
    return result;
  }

  public migrate<T>(payload: T, fromVersion: SaveVersion, toVersion: SaveVersion): T {
    let value: unknown = structuredClone(payload);
    for (const migration of this.path(fromVersion, toVersion)) value = migration.migrate(value);
    return value as T;
  }

  public versions(): readonly SaveVersion[] {
    return [...this.#migrations.keys()].sort((a, b) => a - b);
  }
}

export class PersistentSaveManager<T> {
  readonly #store: SaveStore;
  readonly #keyPrefix: string;
  readonly #currentVersion: SaveVersion;
  readonly #graph: SaveMigrationGraph;

  public constructor(store: SaveStore, currentVersion: SaveVersion, graph = new SaveMigrationGraph(), keyPrefix = 'aapw') {
    if (!Number.isInteger(currentVersion) || currentVersion < 1) throw new RangeError('currentVersion must be positive integer');
    if (!keyPrefix.trim()) throw new Error('keyPrefix must not be empty');
    this.#store = store;
    this.#currentVersion = currentVersion;
    this.#graph = graph;
    this.#keyPrefix = keyPrefix;
  }

  public get migrationGraph(): SaveMigrationGraph {
    return this.#graph;
  }

  public async save(profileId: string, worldSeed: number, tick: number, payload: T): Promise<void> {
    const key = this.#key(profileId);
    const encoded = encodeSave({
      version: this.#currentVersion,
      createdAtTick: tick,
      worldSeed,
      profileId,
      payload,
    });
    await this.#store.write(key, encoded);
  }

  public async load(profileId: string): Promise<SaveEnvelope<T> | null> {
    const encoded = await this.#store.read(this.#key(profileId));
    if (!encoded) return null;
    const source = decodeSave(encoded) as SaveEnvelope<unknown>;
    if (source.version === this.#currentVersion) return source as SaveEnvelope<T>;
    const migratedPayload = this.#graph.migrate(source.payload, source.version, this.#currentVersion);
    return {
      ...source,
      version: this.#currentVersion,
      payload: migratedPayload,
      checksum: checksum({
        format: source.format,
        version: this.#currentVersion,
        createdAtTick: source.createdAtTick,
        worldSeed: source.worldSeed,
        profileId: source.profileId,
        payload: migratedPayload,
      }),
    };
  }

  public async remove(profileId: string): Promise<void> {
    await this.#store.remove(this.#key(profileId));
  }

  #key(profileId: string): string {
    if (!profileId.trim() || profileId.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(profileId)) throw new Error('invalid profileId');
    return `${this.#keyPrefix}:save:${profileId}`;
  }
}

export class MemorySaveStore implements SaveStore {
  readonly #values = new Map<string, string>();

  public async write(key: string, value: string): Promise<void> {
    this.#values.set(key, value);
  }

  public async read(key: string): Promise<string | null> {
    return this.#values.get(key) ?? null;
  }

  public async remove(key: string): Promise<void> {
    this.#values.delete(key);
  }

  public keys(): readonly string[] {
    return [...this.#values.keys()].sort();
  }
}

export interface SaveSlotSummary {
  readonly key: string;
  readonly profileId: string;
  readonly version: number;
  readonly createdAtTick: number;
  readonly worldSeed: number;
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export async function inspectSave<T = unknown>(store: SaveStore, key: string): Promise<SaveSlotSummary | null> {
  const encoded = await store.read(key);
  if (!encoded) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded);
  } catch {
    return { key, profileId: '', version: 0, createdAtTick: 0, worldSeed: 0, valid: false, errors: ['malformed save JSON'] };
  }
  const validation = validateSaveEnvelope(parsed);
  const value = parsed as Partial<SaveEnvelope>;
  return {
    key,
    profileId: typeof value.profileId === 'string' ? value.profileId : '',
    version: Number.isInteger(value.version) ? Number(value.version) : 0,
    createdAtTick: Number.isInteger(value.createdAtTick) ? Number(value.createdAtTick) : 0,
    worldSeed: Number.isFinite(value.worldSeed) ? Number(value.worldSeed) : 0,
    valid: validation.valid,
    errors: validation.errors,
  };
}
