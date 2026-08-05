/**
 * `PLAYER_CONFIG` (FAZ 4) — playable character: base mesh + Mixamo-retargeted animation clip file
 * paths, movement speeds, and camera/animation tuning. See `gameplay/player.js` and DECISIONS.md
 * ADR-0016. Split out of `gameplay/gameplayConfig.js` (run 77, DECISIONS.md ADR-0100) once that
 * file reached 597/600 lines with zero headroom left for the next gameplay addition — same
 * "give each domain its own file, re-export through the barrel" precedent `gameplay/dragons.js`
 * already set at 600/600 (run 71, ADR-0092, split into `dragonController.js`/`dragonFlightMath.js`/
 * `dragonSpawns.js`) and `gameplay/dialogueChoices.js` set before that (run 50, ADR-0066).
 * `gameplayConfig.js` re-exports this unchanged, so no importer of `PLAYER_CONFIG` needed to change.
 * @module gameplay/playerConfig
 */

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
	 * `game3d.js`'s call site (not here, to avoid a `gameplayConfig.js` -> `world/settlements.js`
	 * import cycle). ~34 map units (≈60m) south (+mapY) of `umit` (Ümit Targeryan, mapX:3885/mapY:5370 —
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
