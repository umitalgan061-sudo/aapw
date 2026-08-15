/**
 * Central configuration and constants for the 3D Westeros world's core/world/UI systems. No magic
 * numbers should live in rendering/world code — add them here instead. Gameplay-system config
 * (`PLAYER_CONFIG`, `NPC_CONFIG`, `ANIMAL_CONFIG`, `INTERACTION_CONFIG`) moved to
 * `gameplay/gameplayConfig.js` (run 43, DECISIONS.md ADR-0057) once this file hit the project's
 * 600-line cap — see that file's own doc comment for why.
 * @module config
 */

/** Base paths for the vendored Three.js build and addons (matches the import map in game3d.html). */
export const VENDOR_PATHS = Object.freeze({
	THREE_CORE: './src/3d/vendor/three/three.module.js',
	ADDONS_ROOT: './src/3d/vendor/three/addons/',
});

/** Root folders for original/CC0/CC-BY assets, grouped by type. */
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

/** Graphics quality presets, selected manually or via automatic GPU-tier detection (Phase 10). */
export const QUALITY_LEVELS = Object.freeze({
	ULTRA: 'ultra',
	HIGH: 'high',
	MEDIUM: 'medium',
	LOW: 'low',
	AUTOMATIC: 'automatic',
});

/** Per-quality-level tuning knobs. Systems should read from here rather than hardcoding values. */
export const QUALITY_PRESETS = Object.freeze({
	[QUALITY_LEVELS.ULTRA]: Object.freeze({ shadowMapSize: 4096, drawDistance: 1200, pixelRatioCap: 2, textureSize: 2048 }),
	[QUALITY_LEVELS.HIGH]: Object.freeze({ shadowMapSize: 2048, drawDistance: 900, pixelRatioCap: 2, textureSize: 2048 }),
	[QUALITY_LEVELS.MEDIUM]: Object.freeze({ shadowMapSize: 1024, drawDistance: 600, pixelRatioCap: 1.5, textureSize: 1024 }),
	[QUALITY_LEVELS.LOW]: Object.freeze({ shadowMapSize: 512, drawDistance: 350, pixelRatioCap: 1, textureSize: 512 }),
});

/** Default render/world constants used until the settings system (Phase 10) overrides them. */
export const WORLD_DEFAULTS = Object.freeze({
	DEFAULT_QUALITY: QUALITY_LEVELS.AUTOMATIC,
	FALLBACK_QUALITY: QUALITY_LEVELS.MEDIUM,
	TARGET_FPS_DESKTOP: 60,
	TARGET_FPS_MOBILE: 30,
	FAR_PLANE: 2000,
	NEAR_PLANE: 0.1,
	FOV_DEGREES: 60,
	/** Master seed for all procedural world generation (terrain, later vegetation/rivers/etc.).
	 * Every generator must derive from this via a seeded PRNG — never `Math.random()` — so the
	 * same seed always reproduces the same world. */
	WORLD_SEED: 1337,
	/** Shared sea level in world-space metres. */
	WATER_LEVEL_METERS: 6,
	/** Real seconds for one full day/night cycle (`lighting.js`). */
	DAY_LENGTH_SECONDS: 720,
	/** Where in the [0, 1) day/night ratio a session starts (0 = midnight, 0.5 = noon). */
	START_TIME_OF_DAY_RATIO: 0.3,
});

/**
 * Full owner-map runtime extent. The 9000x7000 canonical canvas is preserved at the standing
 * ~137.5 km² target from `worldReferenceExtent.js`, keeping the world below the 150 km² cap while
 * making every GeoCell reachable by the shipped renderer/physics coordinate system.
 */
export const WORLD_SCALE = Object.freeze({
	METERS_PER_MAP_UNIT: 1.477342100713197,
	MAP_BOUNDS: Object.freeze({ minX: 0, maxX: 9000, minY: 0, maxY: 7000 }),
	WORLD_WIDTH_METERS: 13296.078906418774,
	WORLD_DEPTH_METERS: 10341.394704992379,
});

/** Chunk/streaming grid (World Partition). */
export const CHUNK_CONFIG = Object.freeze({
	CHUNK_SIZE_METERS: 500,
	GRID_COLUMNS: 27,
	GRID_ROWS: 21,
	/** Radius, in chunks, kept loaded around the player on the established desktop path. */
	STREAM_RADIUS_CHUNKS: 2,
	/** Desktop boot preview radius; touch devices use the smaller streaming radius. */
	PHASE1_PREVIEW_RADIUS_CHUNKS: 11,
});

/** Procedural castle dimensions for `world/settlements.js` (FAZ 3). */
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

/** On-screen touch joystick (FAZ 4, mobile input). */
export const TOUCH_JOYSTICK_CONFIG = Object.freeze({
	RADIUS_PX: 50,
	DEADZONE_RATIO: 0.15,
	RUN_THRESHOLD_RATIO: 0.75,
});

/** LocalStorage/sessionStorage keys owned by the 3D mode. */
export const STORAGE_KEYS = Object.freeze({
	QUALITY_SETTING: 'westeros3d_quality',
	SAVE_SLOT: 'westeros3d_save',
	LAST_PHASE_LOADED: 'westeros3d_debug_lastPhase',
});

/** Named events shared across systems via the EventBus. */
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

/** Run 141 / ADR-0165 — whole-disc mobile vegetation culling safety margin. */
export const MOBILE_VEGETATION_CULLING_CONFIG_RUN141 = Object.freeze({
	INTERSECTION_MARGIN_METERS: 100,
});