/**
 * `NPC_CONFIG` (FAZ 5) — first-pass static NPCs (run 20): reuse the 6 already-downloaded Mixamo
 * character FBXes (T-pose, sharing `peasant_girl`'s skeleton, per `assets_manifest.json`'s notes)
 * and `peasant_girl`'s skin-less idle clip, retargeted the same way `gameplay/player.js` retargets
 * its own clips. See `gameplay/npc.js` and DECISIONS.md ADR-0019. Split out of
 * `gameplay/gameplayConfig.js` (run 77, DECISIONS.md ADR-0100) once that file reached 597/600
 * lines — see `playerConfig.js`'s header for the full split rationale/precedent.
 * `gameplayConfig.js` re-exports this unchanged, so no importer of `NPC_CONFIG` needed to change.
 * @module gameplay/npcConfig
 */

import { PLAYER_CONFIG } from './playerConfig.js';

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
	/** Run 73 (FAZ 11 "asker" archetype, DECISIONS.md ADR-0096) combat-stance: how close the player
	 * needs to be before a guard NPC turns to face them and holds its ground (pausing any patrol)
	 * instead of continuing its normal idle/patrol behavior. Larger than `INTERACTION_CONFIG`'s
	 * `PROMPT_RADIUS_METERS` (6) — a guard should visibly notice the player's approach before
	 * dialogue range, not exactly at it. First-pass value, `QUESTIONS_FOR_OWNER.md` entry recorded. */
	COMBAT_STANCE_TRIGGER_RADIUS_METERS: 10,
	/** Idle-clip time-scale multiplier at full alert (a faster, tenser idle loop) — the same
	 * "reuse an existing clip at an altered playback speed as a tension cue, since no dedicated
	 * clip exists" trick `gameplay/dragonController.js`'s wing-flap telegraph already established
	 * (ADR-0089), applied here to a guard's posture instead of a dragon's wingbeat. Matches that
	 * ADR's own default multiplier (1.5) for consistency between this codebase's two no-dedicated-
	 * clip tension cues. */
	COMBAT_STANCE_IDLE_TIME_SCALE: 1.5,
	/** Full 0->1 ease duration for the alert blend that drives the time-scale cue above — quicker
	 * than any of `dragonController.js`'s blends (which model an airborne creature's momentum),
	 * since this models a stationary human's posture snapping to attention, expected to read as
	 * near-instant rather than gradual. */
	COMBAT_STANCE_TRANSITION_SECONDS: 0.3,
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
