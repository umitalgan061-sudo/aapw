/**
 * Central configuration and constants for the 3D Westeros world.
 * No magic numbers should live in gameplay/rendering code — add them here instead.
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
	/** Sea level, in world-space meters (same Y axis as terrain height). A shared constant because
	 * more than one future system needs it (water.js's flood plane, later settlements.js should
	 * never place a castle below it, roads/rivers should respect it) — not water.js-local tuning.
	 * `terrain.js`'s default `maxHeightMeters` is 24, so this floods roughly the lowest quarter of
	 * the FBM height range into natural-looking lakes/coastline without any change to terrain
	 * generation itself (see DECISIONS.md ADR-0005). */
	WATER_LEVEL_METERS: 6,
	/** Real seconds for one full day/night cycle (`lighting.js`). 720s (12 real minutes) = 1 game
	 * day — fast enough to see the full cycle within a short play session without every frame's
	 * lighting change being imperceptible. Tune once there's a real player to feel it against. */
	DAY_LENGTH_SECONDS: 720,
	/** Where in the [0, 1) day/night ratio a session starts (0 = midnight, 0.5 = noon). 0.3 lands
	 * just after sunrise, so a fresh session doesn't always boot into full darkness. */
	START_TIME_OF_DAY_RATIO: 0.3,
});

/**
 * World scale, derived from the 2D map's `INIT_KINGDOMS` coordinates in `script.js` so the 3D
 * open world can eventually cover every kingdom seat, not just a small demo valley.
 * `#map-canvas` in `style.css` is 9000x7000 px; kingdom seats span roughly x:[920,6190], y:[300,5370]
 * within it (computed from `script.js` on 2026-07-29 — re-derive if kingdom data changes materially).
 * See DECISIONS.md ADR-0001 for the bounding-box/padding rationale and ADR-0003 for why
 * `METERS_PER_MAP_UNIT` is 1.75, not ADR-0001's original 10 (total world area must stay under
 * 150 km² to be achievable; the padded kingdom bounding box below is unchanged).
 * @see DECISIONS.md
 */
export const WORLD_SCALE = Object.freeze({
	/** Meters represented by one 2D-map pixel unit. Kept small (see ADR-0003) so the whole padded
	 * kingdom bounding box fits inside a ~100-150 km² world instead of a continent-scale one. */
	METERS_PER_MAP_UNIT: 1.75,
	/** Kingdom-seat bounding box in map units, padded 800 units per side and clamped to the map canvas. */
	MAP_BOUNDS: Object.freeze({ minX: 120, maxX: 6990, minY: 0, maxY: 6170 }),
	/** World extent in meters (map bounds above * METERS_PER_MAP_UNIT). */
	WORLD_WIDTH_METERS: 12022.5,
	WORLD_DEPTH_METERS: 10797.5,
});

/** Chunk/streaming grid (World Partition). See DECISIONS.md ADR-0001, ADR-0002, and ADR-0003. */
export const CHUNK_CONFIG = Object.freeze({
	CHUNK_SIZE_METERS: 500,
	/** ceil(WORLD_WIDTH_METERS / CHUNK_SIZE_METERS), ceil(WORLD_DEPTH_METERS / CHUNK_SIZE_METERS). */
	GRID_COLUMNS: 25,
	GRID_ROWS: 22,
	/** Radius, in chunks, kept loaded around the *player* once one exists (FAZ 4+). Small on
	 * purpose — must fit the mobile budget (drawCalls<500, triangles<500K) at all times, since
	 * this is the radius a phone keeps resident during real gameplay. Tune per QUALITY_PRESETS in
	 * Phase 10. Do NOT reuse this for the Phase 1 no-player preview load below — see ADR-0002. */
	STREAM_RADIUS_CHUNKS: 2,
	/** Radius, in chunks, `game3d.js` loads once at boot purely to preview world-generation
	 * progress before a player/streaming system exists. Only used on non-touch (desktop-class)
	 * pointers — `game3d.js` picks this vs. STREAM_RADIUS_CHUNKS via a `(pointer: coarse)` check
	 * before calling `loadSquare`, so a touch device never actually loads this many chunks (see
	 * DECISIONS.md ADR-0010). See ADR-0002 for why this is a separate constant from
	 * STREAM_RADIUS_CHUNKS rather than the same number. Bumped 8 -> 10 (289 -> 441 chunks) to push
	 * desktop World Coverage across FAZ 3/10's 80% gate — see DECISIONS.md ADR-0014; still
	 * comfortably inside the desktop triangle/draw-call budget (see 3D_GAME_PROGRESS.md). */
	PHASE1_PREVIEW_RADIUS_CHUNKS: 10,
});

/** Procedural castle dimensions for `world/settlements.js` (FAZ 3). One shared silhouette (box
 * keep + 4 corner towers + conical roofs) reused for every kingdom seat, distinguished only by
 * the roof/banner color — see DECISIONS.md ADR-0013. Kept here, not hardcoded in
 * `settlements.js`, per the project's "no magic numbers in gameplay/rendering code" rule. */
export const SETTLEMENT_CONFIG = Object.freeze({
	KEEP_WIDTH_METERS: 34,
	KEEP_HEIGHT_METERS: 20,
	KEEP_DEPTH_METERS: 34,
	TOWER_RADIUS_TOP_METERS: 5,
	TOWER_RADIUS_BOTTOM_METERS: 6.5,
	TOWER_HEIGHT_METERS: 30,
	/** Distance from keep-center to each corner tower's center, on both X and Z. */
	TOWER_CORNER_OFFSET_METERS: 20,
	ROOF_RADIUS_METERS: 7.2,
	ROOF_HEIGHT_METERS: 9,
	/** Minimum height, in meters, above `WORLD_DEFAULTS.WATER_LEVEL_METERS` a castle's ground
	 * point is clamped up to — see `world/README.md`'s "Sea level" convention: any system placing
	 * things by height must check against it, not assume its own threshold. All 14 real kingdom
	 * seats sample above sea level already (measured, not assumed — see DECISIONS.md ADR-0013),
	 * but one (`jon`, the Wall) lands within a meter of it, close enough that this margin is a real
	 * safety net, not dead code. */
	MIN_GROUND_CLEARANCE_METERS: 1.5,
});

/** Playable character (FAZ 4): base mesh + Mixamo-retargeted animation clip file paths, movement
 * speeds, and camera/animation tuning. See `gameplay/player.js` and DECISIONS.md ADR-0016. */
export const PLAYER_CONFIG = Object.freeze({
	MODEL_URL: 'assets/models/characters/peasant_girl.fbx',
	/** Skin-less clips ("In Place", per `assets_manifest.json`) retargeted onto the model's skeleton. */
	ANIMATION_URLS: Object.freeze({
		idle: 'assets/animations/peasant_girl/idle.fbx',
		walking: 'assets/animations/peasant_girl/walking.fbx',
		running: 'assets/animations/peasant_girl/running.fbx',
	}),
	WALK_SPEED_MPS: 3.2,
	RUN_SPEED_MPS: 6.5,
	/** Turn speed, in radians/second the model rotates toward its movement heading. */
	TURN_RATE_RADIANS_PER_SECOND: 10,
	ANIMATION_CROSSFADE_SECONDS: 0.25,
	/** World-space spawn point — the world origin, always inside the boot-preview area on both
	 * desktop and mobile (see CHUNK_CONFIG), so the player never spawns on an unloaded chunk. */
	SPAWN_X_METERS: 0,
	SPAWN_Z_METERS: 0,
	/** Height above the player's feet the chase camera's `OrbitControls.target` is held at, so the
	 * camera looks at roughly chest/head height instead of the ground at the player's feet. */
	CAMERA_TARGET_HEIGHT_METERS: 1.5,
	/** `OrbitControls` distance limits once a player exists — much tighter than Phase 1's
	 * overview-preview defaults (20-1800m in `camera.js`), since this is now a third-person chase
	 * camera, not a free "look at the whole valley" dev camera. */
	CAMERA_MIN_DISTANCE_METERS: 3,
	CAMERA_MAX_DISTANCE_METERS: 40,
	/** Camera position, relative to the player, the chase camera starts framed at (behind and
	 * above) — the user can then orbit/zoom freely from there via `OrbitControls`. */
	CAMERA_INITIAL_OFFSET_METERS: Object.freeze({ x: 0, y: 3.2, z: 7 }),
	/** How far, in meters, `camera.js`'s `resolveCameraCollision` pulls the camera in front of
	 * whatever terrain/castle surface it hits, so the lens sits just short of the geometry instead
	 * of exactly on it (which would still clip on the near plane as the player keeps moving). */
	CAMERA_COLLISION_MARGIN_METERS: 0.4,
	/** Hard floor, in meters, the collision-resolved camera distance is never pulled closer than —
	 * keeps the camera from ending up inside the player model itself when a wall is hit very close
	 * to `CAMERA_MIN_DISTANCE_METERS`. Comfortably above `WORLD_DEFAULTS.NEAR_PLANE` (0.1m). */
	CAMERA_COLLISION_MIN_DISTANCE_METERS: 1.5,
});

/** On-screen touch joystick (FAZ 4, mobile input). See `src/3d/ui/touchJoystick.js`. */
export const TOUCH_JOYSTICK_CONFIG = Object.freeze({
	/** Radius, in CSS pixels, the knob can be dragged from the base's center before clamping. */
	RADIUS_PX: 50,
	/** Drag distance below this fraction of `RADIUS_PX` reads as zero input — absorbs small
	 * accidental finger jitter around the base's center without needing a physical dead zone. */
	DEADZONE_RATIO: 0.15,
	/** Drag distance at/above this fraction of `RADIUS_PX` sets `running: true` — lets one joystick
	 * cover both walk and run (push gently to walk, push to the edge to run) instead of needing a
	 * separate run button. */
	RUN_THRESHOLD_RATIO: 0.75,
});

/** LocalStorage/sessionStorage keys owned by the 3D mode. Never reuse or collide with 2D game keys. */
export const STORAGE_KEYS = Object.freeze({
	QUALITY_SETTING: 'westeros3d_quality',
	SAVE_SLOT: 'westeros3d_save',
	LAST_PHASE_LOADED: 'westeros3d_debug_lastPhase',
});

/** Named events shared across systems via the EventBus. Keeping them here avoids typo'd string mismatches. */
export const EVENTS = Object.freeze({
	ASSET_PROGRESS: 'asset:progress',
	ASSET_LOADED: 'asset:loaded',
	ASSET_ERROR: 'asset:error',
	ASSETS_READY: 'assets:ready',
	GAME_READY: 'game:ready',
	GAME_ERROR: 'game:error',
});
