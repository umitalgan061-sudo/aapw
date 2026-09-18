/**
 * TypeScript-first gameplay configuration facade.
 *
 * Domain owners keep their own configuration files; this module provides one typed entry point,
 * deterministic validation and a stable diagnostic snapshot for runtime/CI consumers.
 */

import { ANIMAL_CONFIG as ANIMAL_CONFIG_LEGACY } from './animalConfig.js';
import { DRAGON_CONFIG, validateDragonConfig } from './dragonConfig.ts';
import { INTERACTION_CONFIG as INTERACTION_CONFIG_LEGACY } from './interactionConfig.js';
import { NPC_CONFIG as NPC_CONFIG_LEGACY } from './npcConfig.js';
import { PLAYER_CONFIG, validatePlayerConfig } from './playerConfig.ts';

export interface NpcPatrol {
  readonly toOffsetXMeters: number;
  readonly toOffsetZMeters: number;
}

export interface NpcSpawn {
  readonly id: string;
  readonly modelUrl: string;
  readonly seatId: string;
  readonly offsetXMeters: number;
  readonly offsetZMeters: number;
  readonly rotationYRadians: number;
  readonly displayName: string;
  readonly patrol?: NpcPatrol;
}

export interface NpcConfig {
  readonly IDLE_ANIMATION_URL: string;
  readonly WALK_ANIMATION_URL: string;
  readonly PATROL_SPEED_MPS: number;
  readonly PATROL_PAUSE_SECONDS: number;
  readonly PATROL_TURN_RATE_RADIANS_PER_SECOND: number;
  readonly COMBAT_STANCE_TRIGGER_RADIUS_METERS: number;
  readonly COMBAT_STANCE_IDLE_TIME_SCALE: number;
  readonly COMBAT_STANCE_TRANSITION_SECONDS: number;
  readonly NAME_TAG_WIDTH_METERS: number;
  readonly NAME_TAG_HEIGHT_METERS: number;
  readonly NAME_TAG_VERTICAL_OFFSET_METERS: number;
  readonly SPAWNS: readonly NpcSpawn[];
}

export interface AnimalSpeciesConfig {
  readonly modelUrl: string;
  readonly clips: Readonly<{
    readonly idle: string;
    readonly walk?: string;
    readonly flee?: string;
  }>;
  readonly stripChildNames?: readonly string[];
}

export interface AnimalSpawn {
  readonly id: string;
  readonly seatId: string;
  readonly offsetXMeters: number;
  readonly offsetZMeters: number;
  readonly rotationYRadians: number;
  readonly patrol?: NpcPatrol;
}

export interface AnimalConfig {
  readonly SPECIES: Readonly<Record<string, AnimalSpeciesConfig>>;
  readonly WOLF_MODEL_URL: string;
  readonly HORSE_MODEL_URL: string;
  readonly IDLE_CLIP_NAME: string;
  readonly WALK_CLIP_NAME: string;
  readonly PATROL_SPEED_MPS: number;
  readonly PATROL_PAUSE_SECONDS: number;
  readonly PATROL_TURN_RATE_RADIANS_PER_SECOND: number;
  readonly FLEE_CLIP_NAME: string;
  readonly FLEE_TRIGGER_RADIUS_METERS: number;
  readonly FLEE_SPEED_MPS: number;
  readonly PACK_ALERT_RADIUS_METERS: number;
  readonly STRIP_CHILD_NAMES: readonly string[];
  readonly SPAWNS: readonly AnimalSpawn[];
}

export interface GameplayConfigSnapshot {
  readonly schemaVersion: 1;
  readonly domains: readonly ['player', 'npc', 'animal', 'dragon', 'interaction'];
  readonly playerMaxHealth: number;
  readonly playerSpawn: { readonly x: number; readonly y: number };
  readonly npcSpawnCount: number;
  readonly animalSpeciesCount: number;
  readonly animalSpawnCount: number;
  readonly dragonSpawnCount: number;
  readonly interactionConfigFrozen: boolean;
}

const isObjectRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

const assertPositiveFinite = (name: string, value: unknown): asserts value is number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number.`);
  }
};

const assertAssetPath = (name: string, value: unknown, extension: string): asserts value is string => {
  if (typeof value !== 'string' || !value.startsWith('assets/') || !value.endsWith(extension)) {
    throw new Error(`${name} must be a shipped ${extension} asset path.`);
  }
};

function validateNpcConfig(config: NpcConfig): void {
  assertAssetPath('NPC idle animation', config.IDLE_ANIMATION_URL, '.fbx');
  assertAssetPath('NPC walk animation', config.WALK_ANIMATION_URL, '.fbx');
  assertPositiveFinite('NPC patrol speed', config.PATROL_SPEED_MPS);
  assertPositiveFinite('NPC patrol pause', config.PATROL_PAUSE_SECONDS);
  assertPositiveFinite('NPC patrol turn rate', config.PATROL_TURN_RATE_RADIANS_PER_SECOND);
  assertPositiveFinite('NPC combat trigger radius', config.COMBAT_STANCE_TRIGGER_RADIUS_METERS);
  assertPositiveFinite('NPC idle time scale', config.COMBAT_STANCE_IDLE_TIME_SCALE);
  assertPositiveFinite('NPC combat transition', config.COMBAT_STANCE_TRANSITION_SECONDS);
  assertPositiveFinite('NPC name-tag width', config.NAME_TAG_WIDTH_METERS);
  assertPositiveFinite('NPC name-tag height', config.NAME_TAG_HEIGHT_METERS);
  assertPositiveFinite('NPC name-tag offset', config.NAME_TAG_VERTICAL_OFFSET_METERS);
  if (config.SPAWNS.length < 1) throw new Error('NPC config must contain at least one spawn.');
  const ids = new Set<string>();
  for (const spawn of config.SPAWNS) {
    if (!spawn.id || ids.has(spawn.id)) throw new Error(`NPC spawn id must be unique: ${spawn.id}`);
    ids.add(spawn.id);
    assertAssetPath(`NPC model ${spawn.id}`, spawn.modelUrl, '.fbx');
    if (!spawn.seatId || !spawn.displayName) throw new Error(`NPC spawn ${spawn.id} has incomplete identity.`);
    if (spawn.patrol) {
      if (!Number.isFinite(spawn.patrol.toOffsetXMeters) || !Number.isFinite(spawn.patrol.toOffsetZMeters)) {
        throw new Error(`NPC patrol target is invalid: ${spawn.id}`);
      }
    }
  }
}

function validateAnimalConfig(config: AnimalConfig): void {
  assertPositiveFinite('Animal patrol speed', config.PATROL_SPEED_MPS);
  assertPositiveFinite('Animal patrol pause', config.PATROL_PAUSE_SECONDS);
  assertPositiveFinite('Animal patrol turn rate', config.PATROL_TURN_RATE_RADIANS_PER_SECOND);
  assertPositiveFinite('Animal flee trigger radius', config.FLEE_TRIGGER_RADIUS_METERS);
  assertPositiveFinite('Animal flee speed', config.FLEE_SPEED_MPS);
  assertPositiveFinite('Animal pack alert radius', config.PACK_ALERT_RADIUS_METERS);
  if (!config.SPECIES || Object.keys(config.SPECIES).length < 3) throw new Error('Animal species registry is unexpectedly small.');
  for (const [kind, species] of Object.entries(config.SPECIES)) {
    assertAssetPath(`Animal model ${kind}`, species.modelUrl, '.glb');
    if (!species.clips.idle) throw new Error(`Animal idle clip is missing: ${kind}`);
    if (species.clips.walk !== undefined && !species.clips.walk) throw new Error(`Animal walk clip is empty: ${kind}`);
    if (species.clips.flee !== undefined && !species.clips.flee) throw new Error(`Animal flee clip is empty: ${kind}`);
  }
  if (config.SPAWNS.length < 1) throw new Error('Animal config must contain at least one spawn.');
  const ids = new Set<string>();
  for (const spawn of config.SPAWNS) {
    if (!spawn.id || ids.has(spawn.id)) throw new Error(`Animal spawn id must be unique: ${spawn.id}`);
    ids.add(spawn.id);
    if (!spawn.seatId) throw new Error(`Animal spawn ${spawn.id} has no seat id.`);
  }
}

function validateInteractionConfig(config: unknown): void {
  if (!isObjectRecord(config)) throw new Error('Interaction config must be an object.');
  if (!Object.isFrozen(config)) throw new Error('Interaction config must be immutable at runtime.');
}

export const NPC_CONFIG: Readonly<NpcConfig> = NPC_CONFIG_LEGACY as NpcConfig;
export const ANIMAL_CONFIG: Readonly<AnimalConfig> = ANIMAL_CONFIG_LEGACY as AnimalConfig;
export const INTERACTION_CONFIG = INTERACTION_CONFIG_LEGACY;

export { PLAYER_CONFIG, DRAGON_CONFIG };

export function validateGameplayConfig(): void {
  validatePlayerConfig();
  validateNpcConfig(NPC_CONFIG);
  validateAnimalConfig(ANIMAL_CONFIG);
  validateDragonConfig();
  validateInteractionConfig(INTERACTION_CONFIG);
}

export function getGameplayConfigSnapshot(): GameplayConfigSnapshot {
  validateGameplayConfig();
  return Object.freeze({
    schemaVersion: 1,
    domains: ['player', 'npc', 'animal', 'dragon', 'interaction'] as const,
    playerMaxHealth: PLAYER_CONFIG.MAX_HEALTH,
    playerSpawn: Object.freeze({ x: PLAYER_CONFIG.SPAWN_MAP_X, y: PLAYER_CONFIG.SPAWN_MAP_Y }),
    npcSpawnCount: NPC_CONFIG.SPAWNS.length,
    animalSpeciesCount: Object.keys(ANIMAL_CONFIG.SPECIES).length,
    animalSpawnCount: ANIMAL_CONFIG.SPAWNS.length,
    dragonSpawnCount: DRAGON_CONFIG.SPAWNS.length,
    interactionConfigFrozen: Object.isFrozen(INTERACTION_CONFIG),
  });
}

validateGameplayConfig();
