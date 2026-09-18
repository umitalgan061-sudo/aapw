import { EntityRecordV7, RuntimeCommandV7, TickV7, WorldSnapshotV7, hashV7, tickV7 } from './types.ts';
import { checksumV7 } from './deterministic.ts';
import { RuntimeValidatorV7 } from './validation.ts';

export interface LegacyEntityLikeV7 {
  readonly id?: number | string;
  readonly type?: string;
  readonly x?: number;
  readonly y?: number;
  readonly z?: number;
  readonly health?: number;
  readonly maxHealth?: number;
  readonly stamina?: number;
  readonly tags?: readonly unknown[];
}

export interface LegacyWorldPayloadV7 {
  readonly tick?: number;
  readonly revision?: number;
  readonly entities?: readonly LegacyEntityLikeV7[];
}

export interface MigrationReportV7 {
  readonly sourceSchema: string;
  readonly targetSchema: 7;
  readonly imported: number;
  readonly skipped: number;
  readonly warnings: readonly string[];
  readonly checksum: string;
}

const number = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return fallback;
};

const id = (value: unknown, fallback: number): number => Math.max(0, Math.min(0x7fffffff, Math.trunc(number(value, fallback))));
const text = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string') return fallback;
  const result = value.normalize('NFKC').trim().slice(0, 64);
  return result || fallback;
};

export function migrateLegacyEntityV7(input: LegacyEntityLikeV7, index: number): EntityRecordV7 | null {
  const entityId = id(input.id, index + 1) as never;
  const health = Math.max(0, number(input.health, 100));
  const maxHealth = Math.max(health, number(input.maxHealth, Math.max(100, health)));
  const stamina = Math.max(0, number(input.stamina, 100));
  const tagValues = Array.isArray(input.tags) ? input.tags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.normalize('NFKC').trim().slice(0, 48)).filter(Boolean) : [];
  return Object.freeze({
    id: entityId,
    archetype: text(input.type, 'legacy-actor'),
    createdTick: tickV7(0),
    components: Object.freeze({
      transform: Object.freeze({ position: { x: number(input.x), y: number(input.y), z: number(input.z) }, yaw: 0, pitch: 0, scale: { x: 1, y: 1, z: 1 } }),
      kinematics: Object.freeze({ velocity: { x: 0, y: 0, z: 0 }, acceleration: { x: 0, y: 0, z: 0 }, grounded: number(input.y) <= 0.01, maxSpeed: 5 }),
      vital: Object.freeze({ health, maxHealth, stamina, maxStamina: 100, poise: maxHealth, maxPoise: maxHealth, invulnerableUntilTick: tickV7(0) }),
      interest: Object.freeze({ priority: 0, simulationLod: 1, renderLod: 1, alwaysRelevant: text(input.type, '') === 'player' }),
      network: Object.freeze({ owner: 'legacy', dirtyRevision: 0 as never, lastAckedSequence: 0 as never, replicated: true }),
      tags: Object.freeze([...new Set(tagValues)].sort()),
    }),
  });
}

export function migrateLegacyWorldV7(payload: LegacyWorldPayloadV7): { readonly snapshot: WorldSnapshotV7; readonly report: MigrationReportV7 } {
  const warnings: string[] = [];
  const validator = new RuntimeValidatorV7();
  const entities: EntityRecordV7[] = [];
  let skipped = 0;
  for (const [index, input] of (payload.entities ?? []).entries()) {
    try {
      const entity = migrateLegacyEntityV7(input, index);
      if (!entity) { skipped += 1; continue; }
      const validation = validator.validateSnapshot({
        tick: 0, revision: 0, baseline: null, entities: [entity], deltas: [], checksum: 'migration',
      });
      if (!validation.ok) { skipped += 1; warnings.push(`entity ${index + 1} failed validation`); continue; }
      entities.push(entity);
    } catch (error) {
      skipped += 1;
      warnings.push(error instanceof Error ? error.message : `entity ${index + 1} migration failed`);
    }
  }
  const base = {
    tick: tickV7(number(payload.tick)),
    revision: Math.max(0, Math.trunc(number(payload.revision))),
    baseline: null,
    entities: Object.freeze(entities),
    deltas: Object.freeze([]),
  };
  const snapshot: WorldSnapshotV7 = Object.freeze({ ...base, checksum: checksumV7(base) });
  return Object.freeze({
    snapshot,
    report: Object.freeze({
      sourceSchema: 'legacy-v1',
      targetSchema: 7,
      imported: entities.length,
      skipped,
      warnings: Object.freeze(warnings),
      checksum: checksumV7({ imported: entities.length, skipped, snapshot: snapshot.checksum }),
    }),
  });
}

export function commandFromLegacyEventV7(event: { readonly type?: string; readonly id?: number | string; readonly amount?: number; readonly x?: number; readonly y?: number; readonly z?: number }): RuntimeCommandV7 | null {
  const entity = Math.max(0, Math.trunc(number(event.id, 0))) as never;
  switch (event.type) {
    case 'damage': return { type: 'damage', id: entity, amount: Math.max(0, number(event.amount, 0)) };
    case 'heal': return { type: 'heal', id: entity, amount: Math.max(0, number(event.amount, 0)) };
    case 'move': return { type: 'move', id: entity, position: { x: number(event.x), y: number(event.y), z: number(event.z) }, velocity: { x: 0, y: 0, z: 0 } };
    case 'despawn': return { type: 'despawn', id: entity };
    default: return null;
  }
}

export function migrationDigestV7(payload: unknown): string {
  return String(hashV7(checksumV7(payload)));
}
