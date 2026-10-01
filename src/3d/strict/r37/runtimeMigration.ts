import type { SaveEnvelope, WorldStateSnapshot } from './types.ts';
import { WorldStateR37 } from './worldState.ts';

export interface MigrationReport {
  readonly fromVersion: number;
  readonly toVersion: 37;
  readonly changed: boolean;
  readonly warnings: readonly string[];
}

export function migrateWorldSnapshot(input: unknown): { readonly snapshot: WorldStateSnapshot; readonly report: MigrationReport } {
  const warnings: string[] = [];
  const source = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const version = Number(source.version ?? 0);
  if (version === 37) {
    return Object.freeze({
      snapshot: normalizeCurrentSnapshot(source as unknown as WorldStateSnapshot),
      report: Object.freeze({ fromVersion: 37, toVersion: 37, changed: false, warnings: Object.freeze([]) }),
    });
  }
  if (version > 37) throw new RangeError('cannot downgrade world snapshot version ' + version);
  const entities = Array.isArray(source.entities) ? source.entities : [];
  const flags = source.flags && typeof source.flags === 'object' ? source.flags as Record<string, unknown> : {};
  const values = source.values && typeof source.values === 'object' ? source.values as Record<string, unknown> : {};
  warnings.push('legacy snapshot normalized into R37 schema');
  const snapshot: WorldStateSnapshot = Object.freeze({
    version: 37,
    seed: Number(source.seed ?? 37) | 0,
    tick: Math.max(0, Math.trunc(Number(source.tick ?? 0))),
    mode: 'running',
    entities: Object.freeze(entities.filter(Boolean).map((entity) => normalizeLegacyEntity(entity))),
    flags: Object.freeze(Object.fromEntries(Object.entries(flags).filter(([, value]) => typeof value === 'boolean'))),
    values: Object.freeze(Object.fromEntries(Object.entries(values).filter(([, value]) => Number.isFinite(Number(value))).map(([key, value]) => [key, Number(value)]))),
  });
  return Object.freeze({
    snapshot,
    report: Object.freeze({ fromVersion: Number.isFinite(version) ? version : 0, toVersion: 37, changed: true, warnings: Object.freeze(warnings) }),
  });
}

export function migrateSaveEnvelope(input: unknown): SaveEnvelope {
  const source = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const world = migrateWorldSnapshot(source.world).snapshot;
  return Object.freeze({
    schema: 37,
    profileId: String(source.profileId ?? 'migrated').slice(0, 64),
    createdAtMs: Math.max(0, Number(source.createdAtMs ?? 0)),
    world,
    inputSequence: Math.max(0, Math.trunc(Number(source.inputSequence ?? 0))),
    metadata: Object.freeze({ migrated: 'true', sourceSchema: String(source.schema ?? 0).slice(0, 32) }),
  });
}

export function applyMigration(world: WorldStateR37, input: unknown): MigrationReport {
  const result = migrateWorldSnapshot(input);
  world.restore(result.snapshot);
  return result.report;
}

function normalizeCurrentSnapshot(input: WorldStateSnapshot): WorldStateSnapshot {
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

function normalizeLegacyEntity(input: unknown): WorldStateSnapshot['entities'][number] {
  const source = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const position = source.position && typeof source.position === 'object' ? source.position as Record<string, unknown> : {};
  return Object.freeze({
    id: String(source.id ?? '').replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 96),
    kind: 'prop',
    transform: Object.freeze({
      position: Object.freeze({ x: Number(position.x ?? 0), y: Number(position.y ?? 0), z: Number(position.z ?? 0) }),
      rotation: Object.freeze({ x: 0, y: 0, z: 0 }),
      scale: Object.freeze({ x: 1, y: 1, z: 1 }),
    }),
    active: source.active !== false,
    version: Math.max(1, Math.trunc(Number(source.version ?? 1))),
    tags: Object.freeze([]),
    data: Object.freeze({ migrated: true }),
  });
}
