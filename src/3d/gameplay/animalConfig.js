/**
 * `ANIMAL_CONFIG` (FAZ 6) — wild animals, see `gameplay/animals.js`. Split out of
 * `gameplay/gameplayConfig.js` (run 77, DECISIONS.md ADR-0100) once that file reached 597/600
 * lines — see `playerConfig.js`'s header for the full split rationale/precedent.
 * `gameplayConfig.js` re-exports this unchanged, so no importer of `ANIMAL_CONFIG` needed to change.
 * @module gameplay/animalConfig
 */

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
