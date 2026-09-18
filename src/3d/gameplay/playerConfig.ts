/**
 * Strict TypeScript source of truth for the shipped third-person player configuration.
 *
 * The legacy playerConfig.js file remains a compatibility barrel so existing Vite/service-worker
 * imports do not need a coordinated cut-over. Runtime values are immutable and validated here.
 */

export interface PlayerVector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface PlayerSpawnMapPosition {
  readonly x: number;
  readonly y: number;
}

export interface PlayerAnimationUrls {
  readonly idle: string;
  readonly walking: string;
  readonly running: string;
}

export interface PlayerConfig {
  readonly MODEL_URL: string;
  readonly ANIMATION_URLS: PlayerAnimationUrls;
  readonly WALK_SPEED_MPS: number;
  readonly RUN_SPEED_MPS: number;
  readonly TURN_RATE_RADIANS_PER_SECOND: number;
  readonly ANIMATION_CROSSFADE_SECONDS: number;
  readonly GRAVITY_MPS2: number;
  readonly JUMP_SPEED_MPS: number;
  readonly SPAWN_MAP_X: number;
  readonly SPAWN_MAP_Y: number;
  readonly CAMERA_TARGET_HEIGHT_METERS: number;
  readonly CAMERA_MIN_DISTANCE_METERS: number;
  readonly CAMERA_MAX_DISTANCE_METERS: number;
  readonly CAMERA_INITIAL_OFFSET_METERS: PlayerVector3;
  readonly CAMERA_COLLISION_MARGIN_METERS: number;
  readonly CAMERA_COLLISION_MIN_DISTANCE_METERS: number;
  readonly MAX_HEALTH: number;
}

const PLAYER_CONFIG_SOURCE = {
  MODEL_URL: 'assets/models/characters/peasant_girl.fbx',
  ANIMATION_URLS: {
    idle: 'assets/animations/peasant_girl/idle.fbx',
    walking: 'assets/animations/peasant_girl/walking.fbx',
    running: 'assets/animations/peasant_girl/running.fbx',
  },
  WALK_SPEED_MPS: 3.2,
  RUN_SPEED_MPS: 6.5,
  TURN_RATE_RADIANS_PER_SECOND: 10,
  ANIMATION_CROSSFADE_SECONDS: 0.25,
  GRAVITY_MPS2: -20,
  JUMP_SPEED_MPS: 7,
  SPAWN_MAP_X: 3885,
  SPAWN_MAP_Y: 5404,
  CAMERA_TARGET_HEIGHT_METERS: 1.5,
  CAMERA_MIN_DISTANCE_METERS: 3,
  CAMERA_MAX_DISTANCE_METERS: 40,
  CAMERA_INITIAL_OFFSET_METERS: { x: 0, y: 3.2, z: 7 },
  CAMERA_COLLISION_MARGIN_METERS: 0.4,
  CAMERA_COLLISION_MIN_DISTANCE_METERS: 1.5,
  MAX_HEALTH: 100,
} as const satisfies PlayerConfig;

const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);

export const PLAYER_CONFIG: Readonly<PlayerConfig> = freeze({
  ...PLAYER_CONFIG_SOURCE,
  ANIMATION_URLS: freeze({ ...PLAYER_CONFIG_SOURCE.ANIMATION_URLS }),
  CAMERA_INITIAL_OFFSET_METERS: freeze({ ...PLAYER_CONFIG_SOURCE.CAMERA_INITIAL_OFFSET_METERS }),
});

const positiveFinite = (value: number): boolean => Number.isFinite(value) && value >= 0;

export function validatePlayerConfig(config: PlayerConfig = PLAYER_CONFIG): void {
  if (!config.MODEL_URL || !config.MODEL_URL.endsWith('.fbx')) throw new Error('Player model must be an FBX asset path.');
  const animations = Object.values(config.ANIMATION_URLS);
  if (animations.length !== 3 || animations.some((path) => !path.endsWith('.fbx'))) throw new Error('Player animation family must contain three FBX clips.');
  if (!(config.WALK_SPEED_MPS > 0 && config.RUN_SPEED_MPS > config.WALK_SPEED_MPS)) throw new Error('Player walk/run speed ordering is invalid.');
  if (!(config.TURN_RATE_RADIANS_PER_SECOND > 0 && config.ANIMATION_CROSSFADE_SECONDS > 0)) throw new Error('Player rotation/animation timing is invalid.');
  if (!(config.GRAVITY_MPS2 < 0 && config.JUMP_SPEED_MPS > 0)) throw new Error('Player jump arc tuning is invalid.');
  if (!(config.CAMERA_MIN_DISTANCE_METERS > 0 && config.CAMERA_MAX_DISTANCE_METERS > config.CAMERA_MIN_DISTANCE_METERS)) throw new Error('Player camera distance range is invalid.');
  if (!positiveFinite(config.CAMERA_TARGET_HEIGHT_METERS) || !positiveFinite(config.CAMERA_COLLISION_MARGIN_METERS) || !positiveFinite(config.CAMERA_COLLISION_MIN_DISTANCE_METERS)) throw new Error('Player camera safety distances are invalid.');
  if (!(positiveFinite(config.MAX_HEALTH) && config.MAX_HEALTH > 0)) throw new Error('Player max health is invalid.');
}

export function playerAnimationUrl(name: keyof PlayerAnimationUrls): string {
  validatePlayerConfig();
  return PLAYER_CONFIG.ANIMATION_URLS[name];
}

export function playerSpawnMapPosition(): PlayerSpawnMapPosition {
  return Object.freeze({ x: PLAYER_CONFIG.SPAWN_MAP_X, y: PLAYER_CONFIG.SPAWN_MAP_Y });
}

validatePlayerConfig();
