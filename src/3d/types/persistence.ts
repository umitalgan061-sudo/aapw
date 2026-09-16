export type SaveSlot = 'autosave' | 'manual-1' | 'manual-2' | 'manual-3' | 'checkpoint';
export type SnapshotVersion = `${number}.${number}.${number}`;

export interface SaveHeader {
  readonly format: 'aapw-save';
  readonly version: SnapshotVersion;
  readonly schemaHash: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly playTimeSeconds: number;
  readonly worldId: string;
  readonly tick: number;
}

export interface PlayerSnapshot {
  readonly id: string;
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number, number];
  readonly health: number;
  readonly stamina: number;
  readonly inventory: readonly { id: string; quantity: number }[];
  readonly quests: readonly { id: string; state: string; progress: number }[];
}

export interface WorldSnapshot {
  readonly seed: number;
  readonly regionStates: readonly { id: string; state: string; version: number }[];
  readonly discoveredLocations: readonly string[];
  readonly defeatedEncounters: readonly string[];
  readonly worldFlags: Readonly<Record<string, boolean>>;
}

export interface GameplaySnapshot {
  readonly header: SaveHeader;
  readonly player: PlayerSnapshot;
  readonly world: WorldSnapshot;
  readonly rngState: readonly number[];
  readonly customState: Readonly<Record<string, unknown>>;
}

export interface SaveEnvelope {
  readonly header: SaveHeader;
  readonly compression: 'none' | 'gzip' | 'brotli';
  readonly checksum: string;
  readonly payload: string;
}

export interface SaveStorage {
  read(slot: SaveSlot): Promise<string | undefined>;
  write(slot: SaveSlot, envelope: SaveEnvelope): Promise<void>;
  remove(slot: SaveSlot): Promise<void>;
  list(): Promise<readonly SaveSlot[]>;
}

export interface SaveCodec {
  encode(snapshot: GameplaySnapshot): Promise<SaveEnvelope>;
  decode(envelope: SaveEnvelope): Promise<GameplaySnapshot>;
}

export interface MigrationStep<From extends SnapshotVersion, To extends SnapshotVersion> {
  readonly from: From;
  readonly to: To;
  migrate(input: GameplaySnapshot): GameplaySnapshot;
}

export interface MigrationRegistry {
  readonly current: SnapshotVersion;
  register<From extends SnapshotVersion, To extends SnapshotVersion>(step: MigrationStep<From, To>): void;
  migrate(snapshot: GameplaySnapshot): GameplaySnapshot;
}

export function isSaveSlot(value: unknown): value is SaveSlot {
  return value === 'autosave' || value === 'manual-1' || value === 'manual-2' || value === 'manual-3' || value === 'checkpoint';
}

export function validateSaveHeader(header: SaveHeader): void {
  if (header.format !== 'aapw-save') throw new Error('Unsupported save format');
  if (!/^\d+\.\d+\.\d+$/.test(header.version)) throw new Error('Invalid save version');
  if (!header.schemaHash || header.schemaHash.length < 8) throw new Error('Missing schema hash');
  if (!Number.isSafeInteger(header.tick) || header.tick < 0) throw new Error('Invalid save tick');
  if (!Number.isFinite(header.playTimeSeconds) || header.playTimeSeconds < 0) throw new Error('Invalid play time');
}
