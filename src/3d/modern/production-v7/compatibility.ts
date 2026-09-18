import type { NextGenRuntimeFacadeV2, RuntimeFrameSummary } from '../nextgen/index.ts';
import type { ActorState } from '../nextgen/actorSimulationV2.ts';
import type { EntityRecordV7, EntityIdV7, RuntimeCommandV7, TickV7 } from './types.ts';
import { vec3V7, entityIdV7 } from './types.ts';
import { checksumV7 } from './deterministic.ts';

export interface CompatibilityActorV7 {
  readonly id: EntityIdV7;
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly velocity: { readonly x: number; readonly y: number; readonly z: number };
  readonly health: number;
  readonly maxHealth: number;
  readonly stamina: number;
  readonly mode: string;
}

export interface CompatibilityReportV7 {
  readonly imported: number;
  readonly skipped: number;
  readonly checksum: string;
  readonly frame: RuntimeFrameSummary | null;
}

export function actorToEntityV7(actor: ActorState): EntityRecordV7 {
  const position = vec3V7(actor.position.x, actor.position.y, actor.position.z);
  return Object.freeze({
    id: entityIdV7(Number(actor.id)),
    archetype: actor.kind,
    createdTick: actor.lastDamagedTick as TickV7,
    components: Object.freeze({
      transform: Object.freeze({ position, yaw: Math.atan2(actor.forward.x, actor.forward.z), pitch: 0, scale: vec3V7(1, 1, 1) }),
      kinematics: Object.freeze({ velocity: vec3V7(actor.velocity.x, actor.velocity.y, actor.velocity.z), acceleration: vec3V7(), grounded: actor.position.y <= 0.001, maxSpeed: actor.stats.moveSpeed }),
      vital: Object.freeze({ health: actor.stats.health, maxHealth: actor.stats.maxHealth, stamina: actor.stats.stamina, maxStamina: actor.stats.maxStamina, poise: actor.stats.maxHealth, maxPoise: actor.stats.maxHealth, invulnerableUntilTick: actor.lastDamagedTick as TickV7 }),
      interest: Object.freeze({ priority: 0, simulationLod: 1 as const, renderLod: 1 as const, alwaysRelevant: actor.kind === 'player' }),
      network: Object.freeze({ owner: 'nextgen', dirtyRevision: 0 as never, lastAckedSequence: 0 as never, replicated: true }),
      tags: Object.freeze([...actor.tags]),
    }),
  });
}

export function importNextGenActors(runtime: NextGenRuntimeFacadeV2, sink: (record: EntityRecordV7) => boolean): CompatibilityReportV7 {
  let imported = 0; let skipped = 0; const checksums: string[] = [];
  for (const actor of runtime.actors.list()) {
    try {
      const record = actorToEntityV7(actor);
      if (sink(record)) { imported += 1; checksums.push(checksumV7(record)); }
      else skipped += 1;
    } catch { skipped += 1; }
  }
  return Object.freeze({ imported, skipped, checksum: checksumV7(checksums), frame: null });
}

export function commandToNextGenV7(command: RuntimeCommandV7): { readonly type: string; readonly entity: number; readonly payload: unknown } | null {
  switch (command.type) {
    case 'move': return { type: 'move', entity: Number(command.id), payload: { position: command.position, velocity: command.velocity } };
    case 'damage': return { type: 'damage', entity: Number(command.id), payload: { amount: command.amount, source: command.source ? Number(command.source) : null } };
    case 'heal': return { type: 'heal', entity: Number(command.id), payload: { amount: command.amount } };
    case 'despawn': return { type: 'despawn', entity: Number(command.id), payload: null };
    case 'spawn': return { type: 'spawn', entity: Number(command.id), payload: { archetype: command.archetype } };
    case 'tag': return { type: 'tag', entity: Number(command.id), payload: { tag: command.tag, enabled: command.enabled } };
    case 'interest': return { type: 'interest', entity: Number(command.id), payload: { priority: command.priority, simulationLod: command.simulationLod, renderLod: command.renderLod } };
    case 'mode': return { type: 'mode', entity: 0, payload: { mode: command.mode } };
    default: return null;
  }
}

export function summarizeCompatibilityV7(records: readonly EntityRecordV7[]): CompatibilityReportV7 {
  return Object.freeze({ imported: records.length, skipped: 0, checksum: checksumV7(records), frame: null });
}
