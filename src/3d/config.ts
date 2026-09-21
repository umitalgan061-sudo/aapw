export const VENDOR_PATHS = Object.freeze({ THREE_CORE: './src/3d/vendor/three/three.module.js', ADDONS_ROOT: './src/3d/vendor/three/addons/' });

export const ASSET_PATHS = Object.freeze({
  MODELS: 'assets/models/',
  TEXTURES: 'assets/textures/',
  AUDIO: 'assets/audio/',
  ANIMATIONS: 'assets/animations/',
  SHADERS: 'assets/shaders/',
  SKYBOXES: 'assets/skyboxes/',
  PARTICLES: 'assets/particles/',
  ICONS: 'assets/icons/',
});

export const QUALITY_LEVELS = Object.freeze({ ULTRA: 'ultra', HIGH: 'high', MEDIUM: 'medium', LOW: 'low', AUTOMATIC: 'automatic' });
export type QualityLevel = typeof QUALITY_LEVELS[keyof typeof QUALITY_LEVELS];

export const QUALITY_PRESETS = Object.freeze({
  [QUALITY_LEVELS.ULTRA]: Object.freeze({ shadowMapSize: 4096, drawDistance: 1200, pixelRatioCap: 2, textureSize: 2048 }),
  [QUALITY_LEVELS.HIGH]: Object.freeze({ shadowMapSize: 2048, drawDistance: 900, pixelRatioCap: 2, textureSize: 2048 }),
  [QUALITY_LEVELS.MEDIUM]: Object.freeze({ shadowMapSize: 1024, drawDistance: 600, pixelRatioCap: 1.5, textureSize: 1024 }),
  [QUALITY_LEVELS.LOW]: Object.freeze({ shadowMapSize: 512, drawDistance: 350, pixelRatioCap: 1, textureSize: 512 }),
});

export const WORLD_DEFAULTS = Object.freeze({
  DEFAULT_QUALITY: QUALITY_LEVELS.AUTOMATIC,
  FALLBACK_QUALITY: QUALITY_LEVELS.MEDIUM,
  TARGET_FPS_DESKTOP: 60,
  TARGET_FPS_MOBILE: 30,
  FAR_PLANE: 2000,
  NEAR_PLANE: 0.1,
  FOV_DEGREES: 60,
  WORLD_SEED: 1337,
  WATER_LEVEL_METERS: 6,
  DAY_LENGTH_SECONDS: 720,
  START_TIME_OF_DAY_RATIO: 0.3,
});

export const WORLD_SCALE = Object.freeze({
  METERS_PER_MAP_UNIT: 1.477342100713197,
  MAP_BOUNDS: Object.freeze({ minX: 0, maxX: 9000, minY: 0, maxY: 7000 }),
  WORLD_WIDTH_METERS: 13296.078906418774,
  WORLD_DEPTH_METERS: 10341.394704992379,
});

export const CHUNK_CONFIG = Object.freeze({ CHUNK_SIZE_METERS: 500, GRID_COLUMNS: 27, GRID_ROWS: 21, STREAM_RADIUS_CHUNKS: 2, PHASE1_PREVIEW_RADIUS_CHUNKS: 11, TERRAIN_SEGMENTS_DESKTOP: 64, TERRAIN_SEGMENTS_MOBILE: 64 });

export const SETTLEMENT_CONFIG = Object.freeze({
  KEEP_WIDTH_METERS: 34,
  KEEP_HEIGHT_METERS: 20,
  KEEP_DEPTH_METERS: 34,
  TOWER_RADIUS_TOP_METERS: 5,
  TOWER_RADIUS_BOTTOM_METERS: 6.5,
  TOWER_HEIGHT_METERS: 30,
  TOWER_CORNER_OFFSET_METERS: 20,
  ROOF_RADIUS_METERS: 7.2,
  ROOF_HEIGHT_METERS: 9,
  MIN_GROUND_CLEARANCE_METERS: 1.5,
});

export const TOUCH_JOYSTICK_CONFIG = Object.freeze({ RADIUS_PX: 50, DEADZONE_RATIO: 0.15, RUN_THRESHOLD_RATIO: 0.75 });

export const STORAGE_KEYS = Object.freeze({
  QUALITY_SETTING: 'westeros3d_quality',
  SAVE_SLOT: 'westeros3d_save',
  LAST_PHASE_LOADED: 'westeros3d_debug_lastPhase',
  SOUND_MUTED: 'westeros3d_soundMuted',
});

export const EVENTS = Object.freeze({
  ASSET_PROGRESS: 'asset:progress',
  ASSET_LOADED: 'asset:loaded',
  ASSET_ERROR: 'asset:error',
  ASSETS_READY: 'assets:ready',
  GAME_READY: 'game:ready',
  GAME_ERROR: 'game:error',
  WORLD_EVENT_TRIGGERED: 'world:eventTriggered',
  PLAYER_DAMAGED: 'player:damaged',
  PLAYER_HEALTH_CHANGED: 'player:healthChanged',
  PLAYER_DIED: 'player:died',
});

export const MOBILE_VEGETATION_CULLING_CONFIG_RUN141 = Object.freeze({ INTERSECTION_MARGIN_METERS: 100 });

export interface QualityPreset {
  readonly shadowMapSize: number;
  readonly drawDistance: number;
  readonly pixelRatioCap: number;
  readonly textureSize: number;
}

export const getQualityPreset = (quality: Exclude<QualityLevel, 'automatic'>): QualityPreset => QUALITY_PRESETS[quality];

export const isQualityLevel = (value: unknown): value is QualityLevel => typeof value === 'string' && Object.values(QUALITY_LEVELS).includes(value as QualityLevel);
