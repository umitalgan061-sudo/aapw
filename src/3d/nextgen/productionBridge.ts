import type {
  CharacterState,
  EntityRecord,
  InputIntent,
  RuntimeSnapshot,
  Vec3,
} from './kernelTypes.ts';
import {
  asEntityId,
  finite,
  stableHash,
  vec3,
} from './kernelTypes.ts';
import type { ProductionRuntime } from './productionRuntime.ts';

export interface LegacyVectorLike {
  readonly x?: number;
  readonly y?: number;
  readonly z?: number;
}

export interface LegacyPlayerLike {
  readonly object3D?: { position?: LegacyVectorLike };
  readonly position?: LegacyVectorLike;
  readonly velocity?: LegacyVectorLike;
  readonly health?: number;
  readonly stamina?: number;
  readonly heading?: number;
}

export interface LegacyEntityLike {
  readonly id?: string | number;
  readonly object3D?: { position?: LegacyVectorLike };
  readonly position?: LegacyVectorLike;
  readonly model?: { position?: LegacyVectorLike };
  readonly importance?: number;
  readonly tags?: readonly string[];
  readonly residentBytes?: number;
}

export interface BridgeInput {
  readonly player?: LegacyPlayerLike | null;
  readonly entities?: readonly LegacyEntityLike[];
  readonly input?: {
    readonly moveX?: number;
    readonly moveY?: number;
    readonly lookX?: number;
    readonly lookY?: number;
    readonly held?: readonly string[];
    readonly pressed?: readonly string[];
    readonly released?: readonly string[];
  };
  readonly deltaSeconds?: number;
}

export interface BridgeOutput {
  readonly player: CharacterState;
  readonly entities: readonly EntityRecord[];
  readonly snapshot: RuntimeSnapshot | null;
  readonly digest: string;
}

const readPosition = (value: LegacyVectorLike | undefined): Vec3 => vec3(
  finite(value?.x),
  finite(value?.y),
  finite(value?.z),
);

const readPlayerPosition = (player: LegacyPlayerLike | null | undefined): Vec3 =>
  readPosition(player?.object3D?.position ?? player?.position);

const readEntityPosition = (entity: LegacyEntityLike): Vec3 =>
  readPosition(entity.object3D?.position ?? entity.model?.position ?? entity.position);

const safeId = (id: string | number | undefined, index: number): string =>
  typeof id === 'number' || typeof id === 'string'
    ? String(id)
    : 'legacy-entity-' + index;

export const adaptLegacyInput = (
  input: BridgeInput['input'],
  timestampSeconds: number,
): {
  readonly source: 'synthetic';
  readonly moveX: number;
  readonly moveY: number;
  readonly lookX: number;
  readonly lookY: number;
  readonly held: readonly string[];
  readonly pressed: readonly string[];
  readonly released: readonly string[];
  readonly sampleTime: number;
} => Object.freeze({
  source: 'synthetic',
  moveX: finite(input?.moveX),
  moveY: finite(input?.moveY),
  lookX: finite(input?.lookX),
  lookY: finite(input?.lookY),
  held: Object.freeze([...(input?.held ?? [])]),
  pressed: Object.freeze([...(input?.pressed ?? [])]),
  released: Object.freeze([...(input?.released ?? [])]),
  sampleTime: Math.max(0, finite(timestampSeconds)),
});

export const syncLegacyWorld = (
  runtime: ProductionRuntime,
  input: BridgeInput,
): void => {
  const delta = Math.max(0, finite(input.deltaSeconds, 1 / 60));
  const timestamp = runtime.clock.simulatedSeconds();
  if (input.input) runtime.pushInput(adaptLegacyInput(input.input, timestamp));
  for (const [index, entity] of (input.entities ?? []).entries()) {
    runtime.registerEntity({
      id: safeId(entity.id, index),
      position: readEntityPosition(entity),
      importance: entity.importance ?? 1,
      residentBytes: entity.residentBytes ?? 0,
      tags: entity.tags ?? [],
      active: true,
    });
  }
  void delta;
};

export const snapshotToLegacyPlayer = (snapshot: RuntimeSnapshot | null): {
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly health: number;
  readonly stamina: number;
  readonly heading: number;
} | null => {
  if (!snapshot) return null;
  return Object.freeze({
    position: snapshot.character.position,
    velocity: snapshot.character.velocity,
    health: snapshot.character.health,
    stamina: snapshot.character.stamina,
    heading: snapshot.character.heading,
  });
};

export const applySnapshotToLegacyPlayer = (
  player: LegacyPlayerLike | null | undefined,
  snapshot: RuntimeSnapshot | null,
): void => {
  if (!player || !snapshot) return;
  const target = player.object3D ?? player;
  if (target.position && typeof target.position === 'object') {
    target.position.x = snapshot.character.position.x;
    target.position.y = snapshot.character.position.y;
    target.position.z = snapshot.character.position.z;
  }
};

export const runLegacyShadowFrame = (
  runtime: ProductionRuntime,
  input: BridgeInput,
): BridgeOutput => {
  syncLegacyWorld(runtime, input);
  const frame = runtime.tick({
    deltaSeconds: input.deltaSeconds ?? 1 / 60,
    inputSamples: input.input ? [adaptLegacyInput(input.input, runtime.clock.simulatedSeconds())] : [],
  });
  const entities = runtime.entities.values();
  return Object.freeze({
    player: frame.character,
    entities,
    snapshot: frame.snapshot,
    digest: stableHash({
      snapshot: frame.snapshot?.digest ?? null,
      entityCount: entities.length,
      player: readPlayerPosition(input.player),
    }),
  });
};

export const createLegacyBridgeContract = () => Object.freeze({
  version: 'r24',
  ownership: 'shadow-runtime',
  rendererOwnedBy: 'legacy-three',
  simulationOwnedBy: 'nextgen-typed',
  storageOwnedBy: 'nextgen-typed',
  browserInputOwnedBy: 'legacy-adapter',
  migrationStrategy: 'shadow-then-switch',
});

export const bridgeIdentity = () => stableHash(createLegacyBridgeContract());

export type LegacyInputIntent = InputIntent;
export const entityKey = (entity: LegacyEntityLike): string => String(asEntityId(safeId(entity.id, 0)));
