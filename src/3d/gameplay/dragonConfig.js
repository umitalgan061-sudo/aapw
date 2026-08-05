/**
 * `DRAGON_CONFIG` (FAZ 7) — see `gameplay/dragons.js` and DECISIONS.md ADR-0071. Split out of
 * `gameplay/gameplayConfig.js` (run 77, DECISIONS.md ADR-0100) once that file reached 597/600
 * lines — see `playerConfig.js`'s header for the full split rationale/precedent.
 * `gameplayConfig.js` re-exports this unchanged, so no importer of `DRAGON_CONFIG` needed to change.
 * @module gameplay/dragonConfig
 */

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
			/** FAZ 7 dive telegraph (run 72): no explicit override here — `createDragon`'s own
			 * `diveTelegraphSeconds`/`diveTelegraphTransitionSeconds` defaults (0.4s / 0.15s) already
			 * fit this spawn's own `diveTransitionSeconds` (0.8) well (a beat that reads as roughly
			 * half the dive's own motion time, not longer than it), so this spawn simply inherits
			 * them rather than duplicating the same numbers here. See `dragonController.js`'s
			 * `createDragon` doc comment for the full reasoning. */
			minAltitudeAboveGroundMeters: 12,
			/** FAZ 7 continuous chase (run 66, DECISIONS.md ADR-0085): the dragon's circle center
			 * itself now travels to the player instead of staying tethered to this seat forever —
			 * see `gameplay/dragons.js`'s `createDragon` doc comment for the full travel/blend/
			 * terrain-following math. Sits deliberately between `alarmRadiusMeters` (110, the dive)
			 * and `noticeRadiusMeters` (220, the toast): wide enough that lingering near the castle
			 * gets you chased, narrow enough that being spotted from across the valley doesn't.
			 * Like `alarmRadiusMeters` it must clear `altitudeMeters` (90) to ever trigger; 160
			 * leaves ~132m of horizontal slack (sqrt(160²-90²)). Speed beats
			 * `PLAYER_CONFIG.RUN_SPEED_MPS` (6.5) so fleeing buys distance but not escape, and the
			 * ring tightens 150m -> 55m so an engaged dragon visibly closes in. Time-boxed at 18s,
			 * re-arming only once the player leaves the radius — harried, then left alone. */
			pursuitRadiusMeters: 160,
			pursuitCenterSpeedMps: 10,
			pursuitCircleRadiusMeters: 55,
			pursuitTransitionSeconds: 2.5,
			pursuitMaxSeconds: 18,
		}),
	]),
});
