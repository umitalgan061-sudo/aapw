/**
 * Versioned migration and canonical serialization helpers for R42.
 * Production TypeScript owner.
 */
import type { SaveEnvelope, WorldEntity } from './types.ts';
import { R42_VERSION, deepFreeze, hashValue, safeInteger } from './types.ts';

export interface LegacyEntityRecord {
  readonly id: string;
  readonly kind?: string;
  readonly position?: { x?: unknown; y?: unknown; z?: unknown };
  readonly health?: unknown;
  readonly stamina?: unknown;
  readonly active?: unknown;
  readonly tags?: unknown;
}

export interface MigrationResult {
  readonly migrated: boolean;
  readonly sourceVersion: number;
  readonly targetVersion: 42;
  readonly warnings: readonly string[];
  readonly entities: readonly WorldEntity[];
  readonly checksum: number;
}

export function migrateLegacyEntities(
  sourceVersion: number,
  records: readonly LegacyEntityRecord[],
): MigrationResult {
  const warnings: string[] = [];
  const entities: WorldEntity[] = [];

  for (const record of records.slice(0, 8192)) {
    const id = sanitizeId(record.id);
    if (!id) {
      warnings.push('Skipped legacy entity with empty id.');
      continue;
    }
    const position = {
      x: numberOr(record.position?.x, 0),
      y: numberOr(record.position?.y, 0),
      z: numberOr(record.position?.z, 0),
    };
    const health = clampNumber(record.health, 0, 100, 100);
    const stamina = clampNumber(record.stamina, 0, 100, 100);
    const entity: WorldEntity = deepFreeze({
      id,
      kind: normalizeKind(record.kind),
      transform: deepFreeze({
        position: deepFreeze(position),
        rotation: deepFreeze({ x: 0, y: 0, z: 0, w: 1 }),
        scale: deepFreeze({ x: 1, y: 1, z: 1 }),
      }),
      velocity: deepFreeze({
        linear: deepFreeze({ x: 0, y: 0, z: 0 }),
        angular: deepFreeze({ x: 0, y: 0, z: 0 }),
      }),
      combat: deepFreeze({
        health,
        maxHealth: 100,
        stamina,
        maxStamina: 100,
        poise: 0,
        maxPoise: 100,
        guarding: false,
        attacking: false,
        dodging: false,
        invulnerable: false,
        cooldownUntilTick: 0,
        comboIndex: 0,
        revision: 0,
      }),
      lod: 0,
      active: Boolean(record.active ?? true),
      revision: 1,
      tags: Object.freeze(
        Array.isArray(record.tags)
          ? record.tags.filter((value): value is string => typeof value === 'string').slice(0, 32).map(value => value.slice(0, 48)).sort()
          : [],
      ),
      components: Object.freeze({
        transform: true,
        velocity: true,
        health: true,
        stamina: true,
        combat: true,
        inventory: false,
        navigation: false,
        render: true,
        network: true,
        metadata: true,
      }),
      data: Object.freeze({ migratedFromVersion: sourceVersion }),
    });
    entities.push(entity);
  }

  return deepFreeze({
    migrated: sourceVersion !== R42_VERSION,
    sourceVersion: safeInteger(sourceVersion, 0),
    targetVersion: 42,
    warnings: [...new Set(warnings)],
    entities: entities.sort((a, b) => a.id.localeCompare(b.id)),
    checksum: hashValue(entities),
  });
}

export function verifyEnvelope(envelope: SaveEnvelope): boolean {
  const canonical = {
    schema: envelope.schema,
    slot: envelope.slot,
    revision: envelope.revision,
    tick: envelope.tick,
    world: envelope.world,
    metadata: envelope.metadata,
  };
  return envelope.schema === 42 && envelope.checksum === hashValue(canonical);
}

export function canonicalizeEnvelope(envelope: SaveEnvelope): SaveEnvelope {
  if (!verifyEnvelope(envelope)) throw new Error('R42 migration refused an invalid save envelope.');
  return deepFreeze({
    ...envelope,
    metadata: Object.fromEntries(Object.entries(envelope.metadata).sort()),
    world: [...envelope.world].sort((a, b) => a.id.localeCompare(b.id)),
    checksum: hashValue({
      schema: envelope.schema,
      slot: envelope.slot,
      revision: envelope.revision,
      tick: envelope.tick,
      world: [...envelope.world].sort((a, b) => a.id.localeCompare(b.id)),
      metadata: Object.fromEntries(Object.entries(envelope.metadata).sort()),
    }),
  });
}

function normalizeKind(value: string | undefined): WorldEntity['kind'] {
  const allowed: readonly WorldEntity['kind'][] = ['player','npc','animal','creature','dragon','vehicle','structure','prop','effect','system'];
  return allowed.includes(value as WorldEntity['kind']) ? value as WorldEntity['kind'] : 'prop';
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = numberOr(value, fallback);
  return Math.min(max, Math.max(min, number));
}

function sanitizeId(value: unknown): string {
  return String(value ?? '').normalize('NFKC').replace(/[^a-zA-Z0-9._:-]/g, '').slice(0, 128);
}
