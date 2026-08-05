/**
 * Gameplay-system config/constants — `PLAYER_CONFIG` (FAZ 4), `NPC_CONFIG` (FAZ 5), `ANIMAL_CONFIG`
 * (FAZ 6), `INTERACTION_CONFIG` (FAZ 5 dialogue). Extracted verbatim from `config.js` (run 43,
 * DECISIONS.md ADR-0057) once that file reached its 600-line cap with zero headroom left for FAZ 7
 * or any other future gameplay addition — same "give the owning folder its own config" precedent
 * `gameplay/worldEvents.js`'s local `WORLD_EVENTS` list and `debug/freeCamera.js`'s local
 * `FAR_PLANE_METERS` already set, just applied retroactively to the 4 gameplay-owned config blocks
 * that predated that pattern. `config.js` itself keeps everything else (`WORLD_DEFAULTS`,
 * `WORLD_SCALE`, `CHUNK_CONFIG`, `SETTLEMENT_CONFIG`, `EVENTS`, ...) — this file is gameplay/'s own,
 * matching the blast-radius rule (`gameplay/README.md`: only `gameplay/`, `eventBus.js`,
 * `physics.js`, `input.js` should be touched for a gameplay-system change).
 * @module gameplay/gameplayConfig
 */

import { CHOICES_BY_NPC_ID } from './dialogueChoices.js';

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
/** `ivory_stallion.glb` — geometry-only (no texture, no rig, no animation clips), per
 * `assets_manifest.json`'s own notes. `spawnConfiguredAnimals` still loads it through the same
 * `createWolf` controller every other animal uses: `THREE.AnimationClip.findByName` against an
 * empty `model.animations` array safely returns `null` (see `createWolf`'s `idleAction`/
 * `walkAction`/`fleeAction` construction, each already null-guarded), so the horse simply renders
 * static/idle with no crossfade — a real, working first pass, not a placeholder. Declared outside
 * `ANIMAL_CONFIG` (not inline in its `SPAWNS` entry below) so both can reference the same constant
 * without a self-referential object literal. Needs rigging before a real walk/flee animation is
 * possible — see DECISIONS.md ADR-0047. */
const HORSE_MODEL_URL = 'assets/models/animals/ivory_stallion.glb';

export const ANIMAL_CONFIG = Object.freeze({
	WOLF_MODEL_URL: 'assets/models/animals/wolf/Wolf-Blender-2.82a.glb',
	HORSE_MODEL_URL,
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
		/** FAZ 6's first non-wolf animal (run 39, DECISIONS.md ADR-0047) — a static, idle-only horse
		 * at `umit` (the same seat the player now spawns next to, ADR-0046), reusing the already-
		 * downloaded `HORSE_MODEL_URL`. No `patrol` field and `canFlee: false` (no flee/pack-alert
		 * branches at all — `HORSE_MODEL_URL` has no animation clips to run them with regardless, and
		 * a rigless model sliding across the ground with no walk cycle would look broken, unlike the
		 * wolves' fully-animated patrol/flee). Offset (-30, 0) keeps it outside `SETTLEMENT_CONFIG`'s
		 * collider (reaches ≈35m from keep center at its farthest corner tower, but the box half-width
		 * is only 17m and this offset's |x|=30 clears both) and clear of `umit-guard-1`'s own 12m
		 * patrol zone. */
		Object.freeze({
			id: 'umit-horse-1',
			seatId: 'umit',
			modelUrl: HORSE_MODEL_URL,
			canFlee: false,
			offsetXMeters: -30,
			offsetZMeters: 0,
			rotationYRadians: Math.PI * 0.5,
		}),
	]),
});

/** FAZ 7 (run 53), first pass: a single dragon flying a fixed circle above `umit` (the player's own
 * seat, ADR-0046) — see `gameplay/dragons.js` and DECISIONS.md ADR-0071. Picked `black_dragon`
 * (Free3D, `assets_manifest.json`) over the unrigged Meshy/Hitem3d reference models (`verdant_wyrm`,
 * `dragon_reference_v2_decimated`, ...) specifically because it already ships a real skeleton +
 * baked animation clips — no rigging work needed for a first flight pass. The manifest's own
 * `animationClips` list (`"Run cycle"`, `"Walk cycle"`, `"Idle"`, `"Jump"`, `"Open Wings"`, `"Fly"`)
 * turned out to not match the file's real clip names — confirmed by actually loading it through
 * `AssetLoader.loadFBXModel` in a headless-Chromium page (not assumed from the manifest text): the
 * file really has 4 clips, `Armature|Walk_New`, `Armature|Run_New`, `Armature|Idel_New` (sic — typo
 * in the source asset itself, not this project's), `Armature|Fly_New`. No `Jump`/`Open Wings` clip
 * exists. `assets_manifest.json`'s entry was corrected this run to match. */
export const DRAGON_CONFIG = Object.freeze({
	MODEL_URL: 'assets/models/creatures/dragon/Dragon_Baked_Actions_fbx_7.4_binary.fbx',
	/** The FBX's embedded material references its textures by bare filename (e.g.
	 * `Dragon_ground_color.jpg`), which `FBXLoader` resolves relative to the FBX file's own directory
	 * by default — but the real files live one level down, in `textures/`. Passed as
	 * `AssetLoader.loadFBXModel`'s `resourcePath` option. Found via real 404s in a headless-Chromium
	 * run (see `gameplay/dragons.js`), not assumed. */
	TEXTURES_RESOURCE_PATH: 'assets/models/creatures/dragon/textures/',
	FLY_CLIP_NAME: 'Armature|Fly_New',
	/** Unlike the Mixamo characters (`PLAYER_CONFIG`/`NPC_CONFIG`), this FBX's own
	 * `userData.unitScaleFactor` is already `1` (confirmed the same headless-render way as the clip
	 * names above) — `AssetLoader.correctMixamoFbxScale` is therefore a no-op for it, so this needs
	 * its own manual scale instead of relying on that shared helper. The file's raw bounding box
	 * measured ~7684x4546x9777 units; `SCALE` brings its largest raw dimension down to
	 * `TARGET_MAX_DIMENSION_METERS` below (20 / 9776.5626 ≈ 0.0020457) — a large, dramatic flying
	 * creature (bigger than the wolf/horse/NPCs) without hand-guessing a factor. */
	SCALE: 20 / 9776.562514437788,
	TARGET_MAX_DIMENSION_METERS: 20,
	/** World-space circling flight, centered on a `world/settlements.js` kingdom-seat id + a fixed
	 * altitude above that seat's own ground height (not absolute Y — keeps clearance consistent even
	 * though `sampleGroundY` varies slightly across the terrain under the flight path). No ground
	 * collision/pathfinding — the smallest thing that reads as "a dragon patrolling the sky above a
	 * castle," same scope discipline `gameplay/animals.js`'s straight-line patrol/flee already set. */
	SPAWNS: Object.freeze([
		Object.freeze({
			id: 'umit-dragon-1',
			seatId: 'umit',
			altitudeMeters: 90,
			circleRadiusMeters: 150,
			/** Tangential speed around the circle; combined with `circleRadiusMeters` this gives an
			 * angular speed of speed/radius ≈ 0.08 rad/s — a slow, majestic patrol, not a dive-bomb. */
			speedMps: 12,
			/** Constant visual roll (radians) into the turn while circling — a circling dragon banks
			 * continuously, unlike the wolves' straight-line patrol which never needs one. */
			bankAngleRadians: 0.35,
			/** FAZ 7 player-awareness (run 54, DECISIONS.md ADR-0072): the first thing beyond a static
			 * flight path — a one-shot "you're near the real dragon" notice, edge-triggered (fires once
			 * on crossing from outside to inside this many meters of the dragon's real, current 3D
			 * position — not the seat/circle-center — and re-arms once the player leaves it), same
			 * edge-triggered shape `gameplay/animals.js`'s `fleeTriggerRadiusMeters` already
			 * established for wolves. Sized to comfortably cover the whole circle's real distance range
			 * from a player standing near `umit` (spawns ~60m from the seat, ADR-0046; the dragon's own
			 * distance from that spot varies roughly 90-210m over one lap, by the law of cosines against
			 * a 150m-radius circle) — so it's a real "welcome, look up" moment shortly after boot, not a
			 * random flavor line. */
			noticeRadiusMeters: 220,
			/** Distinct from `gameplay/worldEvents.js`'s existing `dragon_shadow` ambient flavor entry
			 * ("a shadow passed — or did you imagine it?") — that one is a random, disconnected line;
			 * this one is a *real* proximity trigger tied to the actual dragon's position, so its own
			 * copy says so plainly instead of reusing the same "was it real?" uncertainty. Reuses
			 * `ui/worldEventToast.js`'s existing `{icon, title, desc, color}` shape/UI rather than
			 * building a second toast widget — see `gameplay/dragons.js`'s own doc comment for why this
			 * is emitted through the same `EVENTS.WORLD_EVENT_TRIGGERED` bus event `worldEvents.js`
			 * already uses. */
			noticeToast: Object.freeze({
				id: 'dragon_sighted_real',
				icon: '🐉',
				title: 'Ejderha Görüldü!',
				desc: 'Gökyüzünde gerçek bir ejderha süzülüyor — kalenin üzerinde daireler çiziyor.',
				color: '#c8430a',
			}),
			/** FAZ 7 reactive flight (run 58, DECISIONS.md ADR-0077): the actual behavior change on top
			 * of run 54's awareness-only notice. While the player stays inside `noticeRadiusMeters`
			 * above, the dragon eases (over `reactiveTransitionSeconds`) from its calm patrol into flying
			 * the same circle faster and banking harder, then eases back once the player leaves — still
			 * no diving/chasing/pathfinding (that's a bigger future step), just a felt reaction to being
			 * noticed. See `gameplay/dragons.js`'s `createDragon` doc comment for the exact blend math. */
			reactiveSpeedMultiplier: 1.6,
			reactiveBankAngleRadians: 0.65,
			reactiveTransitionSeconds: 1.2,
			/** FAZ 7 dive (run 64, DECISIONS.md ADR-0082): the first real path deviation, layered on
			 * top of run 58's speed/bank-only reaction. `alarmRadiusMeters` must clear
			 * `altitudeMeters` (90 above) — the dragon's 3D distance to a player standing exactly
			 * under its current circle position can never read below its own altitude, so anything
			 * <=90 here would simply never trigger. 110 gives ~63m of horizontal slack
			 * (sqrt(110²-90²)) around the nearest point on the 150m-radius circle — reachable by
			 * standing near the seat while the dragon happens to be passing low nearly overhead, not
			 * a de-facto-permanent state. `diveDropMeters`/`minAltitudeAboveGroundMeters` are this
			 * run's own engineering judgment (no existing project value to reuse, same as
			 * ADR-0077's reactive-flight numbers) — see `gameplay/dragons.js`'s `createDragon` doc
			 * comment for the exact blend + terrain-clamp math. */
			alarmRadiusMeters: 110,
			diveDropMeters: 30,
			diveLateralPullFraction: 0.3,
			diveTransitionSeconds: 0.8,
			minAltitudeAboveGroundMeters: 12,
		}),
	]),
});

/** FAZ 5 (run 32-33, per-NPC content run 40): `ui/interactionPrompt.js` shows a proximity
 * *affordance* ("E - Selamla") when the player is near any NPC; pressing E while it's showing opens
 * `ui/dialogueBox.js` with that NPC's own greeting — see DECISIONS.md ADR-0033 (the open/close
 * mechanism) and ADR-0051 (real per-NPC content, replacing the single generic line every NPC used
 * to share). Still no branching/replies/quest hooks — one static line per NPC, not a real dialogue
 * tree (see 3D_GAME_PROGRESS.md Known Issues). */
export const INTERACTION_CONFIG = Object.freeze({
	/** Closer than `NPC_CONFIG`'s 12m keep-clearance offset — a "standing right next to them" cue,
	 * not a "somewhere in this courtyard" one. */
	PROMPT_RADIUS_METERS: 6,
	/** Fallback only, for any NPC id not present in `GREETINGS_BY_NPC_ID` below (none today — every
	 * real `NPC_CONFIG.SPAWNS` entry has its own line — but a future spawn added without a matching
	 * entry degrades gracefully instead of showing `undefined`). `{name}` is replaced with the NPC's
	 * `displayName` — see `gameplay/interaction.js`'s `openDialogue`. */
	GREETING_TEMPLATE: '{name}: Uzak yollardan mı geliyorsun, yabancı?',
	/** One hand-written, house-flavored line per `NPC_CONFIG.SPAWNS` entry, keyed by that entry's
	 * `id` (already carried onto `object3D.name` — see `gameplay/npc.js`'s `createNPC`, no new field
	 * needed to look this up). Original writing, not adapted from the show — same "Westeros theme
	 * freely, no real show media" constraint every asset in this project already follows. See
	 * DECISIONS.md ADR-0051 for why per-id (not per-house): `twin-guard-1` and `cersei-guard-1` are
	 * both House Lannister but distinct seats, and reusing one line for both read as less "real"
	 * than the per-house grouping this map still visibly shares (`berk-guard-1`/`olena-guard-1`
	 * intentionally echo `ziya-guard-1`'s Tyrell flavor, same as their shared `displayName` already
	 * does — see ADR-0036). */
	GREETINGS_BY_NPC_ID: Object.freeze({
		'stannis-guard-1': '{name}: Kral Stannis\'in adaleti bu topraklarda hüküm sürer. İşin nedir, yabancı?',
		'stannis-guard-2': '{name}: İkinci nöbetçi benim, gözüm hep tepede. Sakin dur, seni izliyorum.',
		'umit-guard-1': '{name}: Ümit Targeryan\'ın kalesine hoş geldin! Ejderha kanı bu surlarda hâlâ akar derler.',
		'cersei-guard-1': '{name}: Bir Lannister borcunu öder. Sen de saygını göster, yeter.',
		'berkalp-guard-1': '{name}: Kışın geldiğini unutma, yolcu. Kuzeyde sözler boşa verilmez.',
		'doran-guard-1': '{name}: Dorne asla dize gelmedi. Burada da eğilmeyeceğiz.',
		'ziya-guard-1': '{name}: Büyüyen güç bizimdir. Ziya Hanım\'ın bahçeleri seni bekliyor olabilir.',
		'balon-guard-1': '{name}: Biz tohum ekmeyiz, biçeriz. Demir Adalar\'da hoş karşılanmak kolay değildir.',
		'robin-guard-1': '{name}: Yükseklik güçtür, yabancı. Arryn\'in kartalları her şeyi görür.',
		'jon-guard-1': '{name}: Gece Nöbeti sınırdadır. Duvar\'ın ötesinde ne olduğunu bilmek istemezsin.',
		'xaro-guard-1': '{name}: Qarth\'ın on üç kapısı vardır, ama sana yalnızca biri açık, yabancı.',
		'berk-guard-1': '{name}: Berk Bey\'in toprakları verimlidir, ama misafirperverliğimiz sınırsız değildir.',
		'olena-guard-1': '{name}: Olena Hanım keskin dilinden ödün vermez. Sözlerine dikkat et.',
		'twin-guard-1': '{name}: İkiz Kuleler\'in gölgesinde yürüyorsun. Burada her adım izlenir.',
	}),
	/** FAZ 5's real branching pilot (started run 44, DECISIONS.md ADR-0058; grown through run 50,
	 * DECISIONS.md ADR-0060/0062/0063/0064/0067; content itself moved out to its own file run 50,
	 * DECISIONS.md ADR-0066, once this growth pattern pushed `gameplayConfig.js` to 566/600 lines).
	 * 12 of 14 NPCs get 2 numbered choices after their greeting; picking one (Digit1/Digit2 — see
	 * `gameplay/interaction.js`'s `DIALOGUE_CHOICE_KEY_CODES`) shows that choice's own response line,
	 * replacing `{name}` the same way `GREETINGS_BY_NPC_ID` does. Every other NPC has no entry here —
	 * an absent/empty array means the old greeting-then-close-on-E behavior, unchanged. See
	 * `gameplay/dialogueChoices.js` for the full per-NPC content, growth history, and the
	 * `jon-guard-1` exclusion rationale. */
	CHOICES_BY_NPC_ID,
});
