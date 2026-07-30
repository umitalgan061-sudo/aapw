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
	/** Downward acceleration, m/s². Deliberately snappier than real-world 9.8 — a common
	 * game-feel choice (fast, responsive arc) rather than a physically-accurate simulation;
	 * see `physics.js`'s `integrateJumpArc`. */
	GRAVITY_MPS2: -20,
	/** Initial upward velocity, m/s, a jump launches at — peak height is
	 * `JUMP_SPEED_MPS² / (2 * -GRAVITY_MPS2)` ≈ 1.2m, a small hop over uneven ground/steps,
	 * not a platformer-scale jump. */
	JUMP_SPEED_MPS: 7,
	/** Spawn point, in 2D-map units — same coordinate space as `world/settlements.js`'s
	 * `KINGDOM_SEATS` (`mapX`/`mapY`), converted to world-space meters via `mapToWorldXZ` at
	 * `game3d.js`'s call site (not here, to avoid a `config.js` -> `world/settlements.js` import
	 * cycle). ~34 map units (≈60m) south (+mapY) of `umit` (Ümit Targeryan, mapX:3885/mapY:5370 —
	 * the project owner's own kingdom seat): far enough that the player doesn't spawn overlapping
	 * `SETTLEMENT_CONFIG`'s settlement collider (whose corner towers reach ≈35m from the keep
	 * center), and on the +mapY/+worldZ side so the castle sits in the default chase camera's
	 * forward (-Z) view on the very first rendered frame (camera starts at `player position +
	 * CAMERA_INITIAL_OFFSET_METERS`, i.e. behind the player on +Z, looking back toward -Z).
	 * Previously this was the world origin (0, 0) — the padded kingdom bounding box's *center*
	 * (`WORLD_SCALE.MAP_BOUNDS`), which put every one of the 14 kingdom seats 2.5-6km away, well
	 * beyond `fog.js`'s FogExp2 practical visibility (~3.8km day / ~2.8km night at
	 * FOG_DENSITY_DAY/NIGHT) — the player spawned in what looked like an empty world with no
	 * settlement, NPC, or animal visible or reachable. See DECISIONS.md ADR-0046. */
	SPAWN_MAP_X: 3885,
	SPAWN_MAP_Y: 5404,
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

/** First-pass static NPCs (FAZ 5, run 20): reuse the 6 already-downloaded Mixamo character FBXes
 * (T-pose, sharing `peasant_girl`'s skeleton, per `assets_manifest.json`'s notes) and
 * `peasant_girl`'s skin-less idle clip, retargeted the same way `gameplay/player.js` retargets its
 * own clips. Standing/idling only — no movement/AI/dialogue yet, see `gameplay/npc.js` and
 * DECISIONS.md ADR-0019. */
export const NPC_CONFIG = Object.freeze({
	/** Skin-less idle clip retargeted onto every NPC (shared Mixamo skeleton, no bone remapping). */
	IDLE_ANIMATION_URL: PLAYER_CONFIG.ANIMATION_URLS.idle,
	/** Walking clip for patrolling NPCs (run 22) — same skin-less, "In Place" `peasant_girl` clip
	 * `player.js` uses, retargeted the same way. Only loaded for `SPAWNS` entries that define a
	 * `patrol` (most NPCs remain static/idle-only). */
	WALK_ANIMATION_URL: PLAYER_CONFIG.ANIMATION_URLS.walking,
	/** Deliberately slower than `PLAYER_CONFIG.WALK_SPEED_MPS` (3.2) — a guard's patrol pace, not a
	 * player sprinting between two points. */
	PATROL_SPEED_MPS: 1.4,
	/** How long a patrolling NPC idles at each waypoint before turning back. */
	PATROL_PAUSE_SECONDS: 3,
	/** Slower turn than the player's (10) — a deliberate, unhurried guard-turn, not snappy input response. */
	PATROL_TURN_RATE_RADIANS_PER_SECOND: 4,
	/** Billboard name-tag sprite size, in real world-space meters (not screen-space px) — it shrinks
	 * with camera distance like any other object, so no separate LOD/culling is needed yet at 6 NPCs.
	 * See `gameplay/npc.js`'s `createNameTagSprite` and DECISIONS.md ADR-0022. */
	NAME_TAG_WIDTH_METERS: 2.4,
	NAME_TAG_HEIGHT_METERS: 0.6,
	/** Height, in meters above the NPC model's own local origin (its feet), the tag is centered at —
	 * clears every downloaded Mixamo character's head after the shared scale correction. */
	NAME_TAG_VERTICAL_OFFSET_METERS: 2.1,
	/** Static placements, each anchored to a `world/settlements.js` kingdom-seat id and offset from
	 * that castle's keep center (in meters) so the NPC clears the keep's own footprint
	 * (`SETTLEMENT_CONFIG.KEEP_WIDTH_METERS` is 34, so a 12m offset stands comfortably outside the
	 * wall) instead of intersecting it. First pass (run 20) placed just 2, at `stannis` — the kingdom
	 * seat closest to the player's world-origin spawn point, easiest to reach for manual/future
	 * verification without a dedicated fast-travel debug tool. This run (21) extends to 4 more seats
	 * (`umit`, `cersei`, `berkalp`, `doran` — one per remaining major house, spread across the map
	 * rather than clustered near the origin) using the 4 remaining downloaded character files
	 * (`dreyar.fbx` ~7.3MB, `erika_archer.fbx` ~18.7MB, `paladin_wprop_j_nordstrom.fbx` ~8.8MB,
	 * `uriel_a_plotexia.fbx` ~13MB) — config-only, no new asset download, no new code (`game3d.js`'s
	 * spawn-resolution loop already iterates this list generically). All 6 downloaded character
	 * files are now placed; every model here gets offline-precached in `service-worker.js`, so asset
	 * weight remains a real, tracked cost (~64MB across all 6 FBX files). Run 31 adds an 11th NPC at
	 * `Xaro` (Qarth) — a house not yet represented by any NPC — reusing `dreyar.fbx` a second time
	 * (already placed once at `umit`), same zero-new-asset/zero-new-code reasoning as ADR-0024's
	 * 4-seat extension. Run 34 covers the last 3 real kingdom seats (`berk`/`olena`/`twin` — all 3
	 * belong to a house already represented elsewhere: Tyrell at `ziya`, Lannister at `cersei` —
	 * per the "lower value than a new house, but still real coverage" note left by run 33; a genuinely
	 * *new* house isn't available since run 31's `Xaro` addition already used the last one. Reuses
	 * already-downloaded/precached models, same displayName convention as the house's existing
	 * guard (a real-world army routinely has more than one soldier sharing the same generic title;
	 * `jon`'s distinct "Duvar Muhafızı" is the deliberate exception for a *thematically* distinct
	 * seat, not the rule). `Night King` remains the one deliberately excluded seat (ADR-0024) — every
	 * other real kingdom seat now has at least one NPC. */
	SPAWNS: Object.freeze([
		Object.freeze({
			id: 'stannis-guard-1',
			modelUrl: 'assets/models/characters/paladin_j_nordstrom.fbx',
			seatId: 'stannis',
			offsetXMeters: 12,
			offsetZMeters: 12,
			rotationYRadians: Math.PI,
			displayName: 'Baratheon Muhafızı I',
			// Pilot for the FAZ 5 waypoint-patrol sub-task (run 22): walks a straight 24m line to
			// (12, -12) and back, staying at the same 16.97m radial distance from the keep center as
			// the static spawn point already does — no new wall-clearance risk (see DECISIONS.md
			// ADR-0021). The other 5 NPCs are untouched and remain static/idle-only.
			patrol: Object.freeze({ toOffsetXMeters: 12, toOffsetZMeters: -12 }),
		}),
		Object.freeze({
			id: 'stannis-guard-2',
			modelUrl: 'assets/models/characters/arissa.fbx',
			seatId: 'stannis',
			offsetXMeters: -12,
			offsetZMeters: 12,
			rotationYRadians: Math.PI,
			displayName: 'Baratheon Muhafızı II',
			patrol: Object.freeze({ toOffsetXMeters: -12, toOffsetZMeters: -12 }),
		}),
		Object.freeze({
			id: 'umit-guard-1',
			modelUrl: 'assets/models/characters/dreyar.fbx',
			seatId: 'umit',
			offsetXMeters: 12,
			offsetZMeters: 12,
			rotationYRadians: Math.PI,
			displayName: 'Targeryan Muhafızı',
			// Patrol extension (run 24) — same geometry ADR-0021 already proved safe on the 2 stannis
			// guards: flip the Z offset sign, same 16.97m radial distance from the keep center, same
			// shared castle template every kingdom seat uses (world/settlements.js).
			patrol: Object.freeze({ toOffsetXMeters: 12, toOffsetZMeters: -12 }),
		}),
		Object.freeze({
			id: 'cersei-guard-1',
			modelUrl: 'assets/models/characters/paladin_wprop_j_nordstrom.fbx',
			seatId: 'cersei',
			offsetXMeters: 12,
			offsetZMeters: 12,
			rotationYRadians: Math.PI,
			displayName: 'Lannister Muhafızı',
			patrol: Object.freeze({ toOffsetXMeters: 12, toOffsetZMeters: -12 }),
		}),
		Object.freeze({
			id: 'berkalp-guard-1',
			modelUrl: 'assets/models/characters/erika_archer.fbx',
			seatId: 'berkalp',
			offsetXMeters: -12,
			offsetZMeters: 12,
			rotationYRadians: Math.PI,
			displayName: 'Stark Muhafızı',
			patrol: Object.freeze({ toOffsetXMeters: -12, toOffsetZMeters: -12 }),
		}),
		Object.freeze({
			id: 'doran-guard-1',
			modelUrl: 'assets/models/characters/uriel_a_plotexia.fbx',
			seatId: 'doran',
			offsetXMeters: -12,
			offsetZMeters: 12,
			rotationYRadians: Math.PI,
			displayName: 'Martell Muhafızı',
			patrol: Object.freeze({ toOffsetXMeters: -12, toOffsetZMeters: -12 }),
		}),
		Object.freeze({
			id: 'ziya-guard-1',
			modelUrl: 'assets/models/characters/arissa.fbx',
			seatId: 'ziya',
			offsetXMeters: 12,
			offsetZMeters: 12,
			rotationYRadians: Math.PI,
			// Seat extension (run 25) — reuses an already-downloaded/precached model (no new asset), same
			// spawn geometry as every other guard (see DECISIONS.md ADR-0020/ADR-0023 for why this is safe
			// to reuse unmodified across any kingdom seat: identical shared castle template).
			displayName: 'Tyrell Muhafızı',
			patrol: Object.freeze({ toOffsetXMeters: 12, toOffsetZMeters: -12 }),
		}),
		Object.freeze({
			id: 'balon-guard-1',
			modelUrl: 'assets/models/characters/paladin_wprop_j_nordstrom.fbx',
			seatId: 'balon',
			offsetXMeters: -12,
			offsetZMeters: 12,
			rotationYRadians: Math.PI,
			displayName: 'Greyjoy Muhafızı',
			patrol: Object.freeze({ toOffsetXMeters: -12, toOffsetZMeters: -12 }),
		}),
		Object.freeze({
			id: 'robin-guard-1',
			modelUrl: 'assets/models/characters/erika_archer.fbx',
			seatId: 'robin',
			offsetXMeters: 12,
			offsetZMeters: 12,
			rotationYRadians: Math.PI,
			displayName: 'Arryn Muhafızı',
			patrol: Object.freeze({ toOffsetXMeters: 12, toOffsetZMeters: -12 }),
		}),
		Object.freeze({
			id: 'jon-guard-1',
			modelUrl: 'assets/models/characters/uriel_a_plotexia.fbx',
			seatId: 'jon',
			offsetXMeters: -12,
			offsetZMeters: 12,
			rotationYRadians: Math.PI,
			// 'jon' (Jon Snow) is titled "Duvar Muhafızı" (Wall Guardian) in script.js's INIT_KINGDOMS —
			// a distinct Night's Watch label instead of another plain 'Stark Muhafızı' (already used at
			// berkalp/Winterfell), since Jon's seat is thematically the Wall, not Winterfell itself.
			displayName: 'Gece Nöbeti Muhafızı',
			patrol: Object.freeze({ toOffsetXMeters: -12, toOffsetZMeters: -12 }),
		}),
		Object.freeze({
			id: 'xaro-guard-1',
			modelUrl: 'assets/models/characters/dreyar.fbx',
			seatId: 'Xaro',
			offsetXMeters: 12,
			offsetZMeters: 12,
			rotationYRadians: Math.PI,
			displayName: 'Qarth Muhafızı',
			patrol: Object.freeze({ toOffsetXMeters: 12, toOffsetZMeters: -12 }),
		}),
		Object.freeze({
			id: 'berk-guard-1',
			modelUrl: 'assets/models/characters/paladin_j_nordstrom.fbx',
			seatId: 'berk',
			offsetXMeters: 12,
			offsetZMeters: 12,
			rotationYRadians: Math.PI,
			displayName: 'Tyrell Muhafızı',
			patrol: Object.freeze({ toOffsetXMeters: 12, toOffsetZMeters: -12 }),
		}),
		Object.freeze({
			id: 'olena-guard-1',
			modelUrl: 'assets/models/characters/arissa.fbx',
			seatId: 'olena',
			offsetXMeters: -12,
			offsetZMeters: 12,
			rotationYRadians: Math.PI,
			displayName: 'Tyrell Muhafızı',
			patrol: Object.freeze({ toOffsetXMeters: -12, toOffsetZMeters: -12 }),
		}),
		Object.freeze({
			id: 'twin-guard-1',
			modelUrl: 'assets/models/characters/paladin_wprop_j_nordstrom.fbx',
			seatId: 'twin',
			offsetXMeters: 12,
			offsetZMeters: 12,
			rotationYRadians: Math.PI,
			displayName: 'Lannister Muhafızı',
			patrol: Object.freeze({ toOffsetXMeters: 12, toOffsetZMeters: -12 }),
		}),
	]),
});

/** Wild animals (FAZ 6 — see `gameplay/animals.js`). Only the wolf is wired up so far; the `wolf`
 * glTF (`assets_manifest.json`) was already downloaded for this phase (run 20's era) and sat unused
 * until run 26. Modeled after `NPC_CONFIG`'s seat-anchored spawn shape, but animals get no name tag.
 * Waypoint patrol (run 27) reuses `NPC_CONFIG`'s own proven `patrol` field shape/behavior — see
 * DECISIONS.md ADR-0026. Player-awareness (run 28, flee): a wolf within `FLEE_TRIGGER_RADIUS_METERS`
 * of the player overrides its idle/patrol state and runs directly away instead — see DECISIONS.md
 * ADR-0027. `NPC_CONFIG`'s guards have no equivalent yet (still open FAZ 5 work, out of this scope). */
export const ANIMAL_CONFIG = Object.freeze({
	WOLF_MODEL_URL: 'assets/models/animals/wolf/Wolf-Blender-2.82a.glb',
	/** Exact glTF animation-clip names (`THREE.AnimationClip.findByName`) — confirmed against the
	 * source file's own `.gltf` JSON sidecar, not guessed: `01_Run_Armature_0`, `02_walk_Armature_0`,
	 * `03_creep_Armature_0`, `04_Idle_Armature_0`, `05_site_Armature_0`. Idle/walk/run are used. */
	IDLE_CLIP_NAME: '04_Idle_Armature_0',
	/** Walking clip for patrolling animals (run 27) — same "In Place" assumption `NPC_CONFIG.
	 * WALK_ANIMATION_URL` relies on for Mixamo clips; unlike Mixamo, this glTF's own root bone is not
	 * independently verified "in place" vs. root-motion-baked, but the run-27 smoke test's own
	 * position-over-time sample (see DECISIONS.md ADR-0026) confirms the net result looks correct
	 * either way, since `createWolf`'s controller code drives translation itself regardless. */
	WALK_CLIP_NAME: '02_walk_Armature_0',
	/** Deliberately faster than `NPC_CONFIG.PATROL_SPEED_MPS` (1.4) — a wolf's trot, not a guard's
	 * walking pace. */
	PATROL_SPEED_MPS: 2.2,
	/** How long a patrolling wolf idles at each waypoint before turning back. */
	PATROL_PAUSE_SECONDS: 3,
	/** Same turn rate as `NPC_CONFIG.PATROL_TURN_RATE_RADIANS_PER_SECOND` — no reason for a wolf to
	 * turn faster/slower than a patrolling guard at this scope. */
	PATROL_TURN_RATE_RADIANS_PER_SECOND: 4,
	/** Run clip for fleeing (run 28) — a wolf sprinting away from the player, distinct from its
	 * unhurried patrol walk. */
	FLEE_CLIP_NAME: '01_Run_Armature_0',
	/** A wolf within this many meters of the player flees; picked to trigger only once the player has
	 * actually approached (not merely entered the same 40-60m spawn-offset neighborhood), while still
	 * comfortably inside the same terrain chunk everything else here already assumes is grounded. */
	FLEE_TRIGGER_RADIUS_METERS: 15,
	/** Faster than `PATROL_SPEED_MPS` (2.2) — a fleeing sprint, not a patrol trot. */
	FLEE_SPEED_MPS: 4.5,
	/** First FAZ 6 herd/pack reaction (run 29, see DECISIONS.md ADR-0029): a wolf not yet within its
	 * own `FLEE_TRIGGER_RADIUS_METERS` of the player still flees if a packmate within this many
	 * meters is *already* fleeing. Sized larger than `FLEE_TRIGGER_RADIUS_METERS` (15) so it's a real
	 * pack-awareness radius, not a coincidence of the two overlapping — the two `berkalp` wolves'
	 * patrol lines (see SPAWNS below) can come within ~0-20m of each other at closest approach, so
	 * this comfortably covers a realistic "saw my packmate bolt" distance without reading as
	 * telepathic pack-wide panic across the whole seat. */
	PACK_ALERT_RADIUS_METERS: 20,
	/** The source file bundles a flat, non-skinned "Circle" mesh (a Blender shadow-catcher disc) as
	 * a sibling of the wolf's own skinned meshes at the scene root — confirmed via the `.gltf` JSON
	 * (`meshes[5].name === 'Circle'`), not part of the animal itself. `gameplay/animals.js` strips
	 * any root child with this name before adding the model to the scene, so it doesn't render as a
	 * stray flat disc floating near the wolf's feet on real terrain. */
	STRIP_CHILD_NAMES: Object.freeze(['Circle']),
	/** Placements, each anchored to a `world/settlements.js` kingdom-seat id and offset from that
	 * castle's keep center (in meters) — same convention as `NPC_CONFIG.SPAWNS`, but offset further
	 * out (40-56m vs. NPCs' 12m) so a wolf reads as roaming just outside the walls rather than
	 * standing in the guards' own spot. All three wolves at `berkalp` (House Stark/Winterfell — the
	 * direwolf is Stark's own sigil, a deliberate lore fit, not an arbitrary seat pick). All patrol
	 * a short 20m line, in different spots and along different axes from each other so their paths
	 * don't cross or overlap the guard NPCs' own ±12m patrol zone at the same seat, or each other's
	 * lines. `berkalp-wolf-3` (added run 30, config-only, reuses the same already-downloaded
	 * `WOLF_MODEL_URL` — no new asset) is placed within `PACK_ALERT_RADIUS_METERS` (20m) of
	 * `berkalp-wolf-2`'s spawn (~14.4m) but outside it from `berkalp-wolf-1`'s spawn (~28.8m),
	 * deliberately so a chained pack-alert (wolf-1 flees the player -> wolf-2 pack-flees off wolf-1
	 * -> wolf-3 pack-flees off wolf-2, one frame later) is the only path that reaches wolf-3 — see
	 * DECISIONS.md ADR-0030 for the live verification this was added to run. */
	SPAWNS: Object.freeze([
		Object.freeze({
			id: 'berkalp-wolf-1',
			seatId: 'berkalp',
			offsetXMeters: 40,
			offsetZMeters: -30,
			rotationYRadians: 0,
			patrol: Object.freeze({ toOffsetXMeters: 60, toOffsetZMeters: -30 }),
		}),
		Object.freeze({
			id: 'berkalp-wolf-2',
			seatId: 'berkalp',
			offsetXMeters: 48,
			offsetZMeters: -18,
			rotationYRadians: Math.PI * 0.5,
			patrol: Object.freeze({ toOffsetXMeters: 48, toOffsetZMeters: -38 }),
		}),
		Object.freeze({
			id: 'berkalp-wolf-3',
			seatId: 'berkalp',
			offsetXMeters: 56,
			offsetZMeters: -6,
			rotationYRadians: Math.PI * 0.5,
			patrol: Object.freeze({ toOffsetXMeters: 56, toOffsetZMeters: -26 }),
		}),
	]),
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

/** FAZ 5 (run 32-33): `ui/interactionPrompt.js` shows a proximity *affordance* ("E - Selamla") when
 * the player is near any NPC; pressing E while it's showing opens `ui/dialogueBox.js` with a single
 * generic greeting line built from `GREETING_TEMPLATE` (run 33, DECISIONS.md ADR-0033) — still no
 * real per-NPC dialogue content/branching/replies, deliberately scoped smaller than a full dialogue
 * system (see 3D_GAME_PROGRESS.md Known Issues). */
export const INTERACTION_CONFIG = Object.freeze({
	/** Closer than `NPC_CONFIG`'s 12m keep-clearance offset — a "standing right next to them" cue,
	 * not a "somewhere in this courtyard" one. */
	PROMPT_RADIUS_METERS: 6,
	/** `{name}` is replaced with the NPC's `displayName` — see `game3d.js`'s `openDialogue`. One
	 * generic line for every NPC; not a real per-character/per-house greeting yet (that needs actual
	 * dialogue-writing, a separate future decision, not a config constant). */
	GREETING_TEMPLATE: '{name}: Uzak yollardan mı geliyorsun, yabancı?',
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
