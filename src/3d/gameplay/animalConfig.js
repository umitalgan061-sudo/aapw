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

/**
 * Per-species model + animation-clip table. `spawnConfiguredAnimals`'s own JSDoc predicted this
 * exact refactor ("a 'kind' field / per-species lookup table would be cleaner if a 3rd
 * non-wolf-shaped animal shows up... revisit if a 3rd species needs its own knobs") — run 300+
 * cashes that in, because the 10 real rigged/animated animal models the project owner manually
 * downloaded (`assets_manifest.json`, all `rigged: true, animated: true`) sat entirely unused: a
 * repo-wide grep for each of their ids/filenames returned zero `src/` hits. They could not be
 * spawned through the pre-existing config shape at all, because `IDLE_CLIP_NAME`/`WALK_CLIP_NAME`/
 * `FLEE_CLIP_NAME` were single global constants holding the *wolf* glTF's Blender-exported clip
 * names (`04_Idle_Armature_0` etc.), and every one of these models names its clips differently
 * (plain `Idle`/`Walk`/`Gallop`, or `Run` for the zebra). A per-spawn `modelUrl` override alone was
 * therefore not enough — the clip names had to become per-species too.
 *
 * Every `clips` value below is copied from that asset's own verified `animationClips` array in
 * `assets_manifest.json` (recorded when each model was imported), not guessed. `walk`/`flee` are
 * optional: a species whose source file genuinely has no locomotion clip (see `sheep`) declares
 * neither, and `spawnConfiguredAnimals` then drives it exactly the way the rigless
 * `ivory_stallion.glb` horse was already handled — static/idle, no patrol, no flee branch.
 *
 * `flee` deliberately reuses each species' fastest natural gait rather than inventing a shared
 * name: quadrupeds bolt with `Gallop`, the zebra's file calls the same thing `Run`, and the wolf
 * keeps its own `01_Run_Armature_0`. Speeds stay on `ANIMAL_CONFIG`'s existing global
 * `PATROL_SPEED_MPS`/`FLEE_SPEED_MPS` for now — per-species gait tuning is a separate, measurable
 * pass and mixing it into this wiring change would make the visual result impossible to attribute.
 */
export const ANIMAL_SPECIES = Object.freeze({
	wolf: Object.freeze({
		modelUrl: 'assets/models/animals/wolf/Wolf-Blender-2.82a.glb',
		clips: Object.freeze({ idle: '04_Idle_Armature_0', walk: '02_walk_Armature_0', flee: '01_Run_Armature_0' }),
		/** See `ANIMAL_CONFIG.STRIP_CHILD_NAMES` — only the wolf glTF bundles a shadow-catcher disc. */
		stripChildNames: Object.freeze(['Circle']),
	}),
	/** Replaces the rigless `ivory_stallion.glb` as the live horse — see `HORSE_MODEL_URL`'s note and
	 * DECISIONS.md ADR-0047, which explicitly recorded "needs rigging before a real walk/flee
	 * animation is possible" as the blocker. This model is rigged and ships `Walk`/`Gallop`/`Idle`/
	 * `Eating`, so that blocker is now genuinely resolved rather than worked around. */
	horse: Object.freeze({
		modelUrl: 'assets/models/animals/white_horse_bEdE4rmZy9.glb',
		clips: Object.freeze({ idle: 'Idle', walk: 'Walk', flee: 'Gallop' }),
	}),
	cow: Object.freeze({
		modelUrl: 'assets/models/animals/cow_26zM1outCr.glb',
		clips: Object.freeze({ idle: 'Idle', walk: 'Walk', flee: 'Gallop' }),
	}),
	bull: Object.freeze({
		modelUrl: 'assets/models/animals/bull_a8PIIYwF7r.glb',
		clips: Object.freeze({ idle: 'Idle', walk: 'Walk', flee: 'Gallop' }),
	}),
	deer: Object.freeze({
		modelUrl: 'assets/models/animals/deer_T6Cs7tmMHJ.glb',
		clips: Object.freeze({ idle: 'Idle', walk: 'Walk', flee: 'Gallop' }),
	}),
	stag: Object.freeze({
		modelUrl: 'assets/models/animals/stag_tQdzbZ1Cmw.glb',
		clips: Object.freeze({ idle: 'Idle', walk: 'Walk', flee: 'Gallop' }),
	}),
	fox: Object.freeze({
		modelUrl: 'assets/models/animals/fox_Bc97C66HKi.glb',
		clips: Object.freeze({ idle: 'Idle', walk: 'Walk', flee: 'Gallop' }),
	}),
	/** Fills FAZ 6's long-standing "dog" gap (`3D_GAME_PROGRESS.md` listed at/araba/köpek-kedi/kuş as
	 * needing a manual human download — the dog half is now covered by a real animated model). */
	dog: Object.freeze({
		modelUrl: 'assets/models/animals/husky_wcWiuEqwzq.glb',
		clips: Object.freeze({ idle: 'Idle', walk: 'Walk', flee: 'Gallop' }),
	}),
	alpaca: Object.freeze({
		modelUrl: 'assets/models/animals/alpaca_bCVFD48i2l.glb',
		clips: Object.freeze({ idle: 'Idle', walk: 'Walk', flee: 'Gallop' }),
	}),
	/** Two separate per-species quirks in one file, both verified by reading this GLB's own embedded
	 * JSON chunk rather than trusting `assets_manifest.json`: it names its sprint `Run` (not `Gallop`
	 * like the other quadrupeds), *and* it prefixes every clip with `Armature|`. The manifest recorded
	 * the unprefixed names, so copying them would have left this animal silently frozen — the exact
	 * failure mode the clip-name verification pass was written to catch. */
	zebra: Object.freeze({
		modelUrl: 'assets/models/animals/zebra_iclPBR6SBZ.glb',
		clips: Object.freeze({ idle: 'Armature|Idle', walk: 'Armature|Walk', flee: 'Armature|Run' }),
	}),
	/** Genuinely only ships `Idle` + `Jump` (verified in `assets_manifest.json`) — no walk, no run.
	 * Declaring no `walk`/`flee` is the honest encoding: it renders grazing-still and never enters the
	 * patrol or flee branch, exactly like the rigless horse did, instead of silently failing a
	 * `findByName` lookup every frame. Worth revisiting only if a better-animated sheep is sourced. */
	sheep: Object.freeze({
		modelUrl: 'assets/models/animals/sheep_C39AUXUUes.glb',
		clips: Object.freeze({ idle: 'Armature|Idle' }),
	}),
});

export const ANIMAL_CONFIG = Object.freeze({
	/** Per-species model/clip table (see `ANIMAL_SPECIES`). Exposed on `ANIMAL_CONFIG` too so
	 * `spawnConfiguredAnimals` keeps taking exactly one config object, as it already did. */
	SPECIES: ANIMAL_SPECIES,
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
		/** Upgraded (run 300+) from the rigless `HORSE_MODEL_URL` to the real rigged `horse` species.
		 * ADR-0047 recorded the original as static/idle-only with "needs rigging before a real walk/flee
		 * animation is possible"; the manually-downloaded `white_horse` model is rigged and ships
		 * `Walk`/`Gallop`, so this spawn now gets a real patrol line and the flee branch its species
		 * table finally supports. Kept at the same (-30, 0) offset — that placement was already verified
		 * against `SETTLEMENT_CONFIG`'s collider and `umit-guard-1`'s 12m patrol zone, and reusing it
		 * means the only thing this change alters is the model + whether it moves. */
		Object.freeze({
			id: 'umit-horse-1',
			seatId: 'umit',
			speciesId: 'horse',
			offsetXMeters: -30,
			offsetZMeters: 0,
			rotationYRadians: Math.PI * 0.5,
			patrol: Object.freeze({ toOffsetXMeters: -30, toOffsetZMeters: -24 }),
		}),
		/** House Baratheon's sigil is a crowned stag, so `stannis` gets the stag — the same deliberate
		 * lore-fit reasoning that put every wolf at `berkalp` (House Stark/direwolf), not an arbitrary
		 * seat pick. */
		Object.freeze({
			id: 'stannis-stag-1',
			seatId: 'stannis',
			speciesId: 'stag',
			offsetXMeters: 36,
			offsetZMeters: 10,
			rotationYRadians: Math.PI,
			patrol: Object.freeze({ toOffsetXMeters: 36, toOffsetZMeters: -14 }),
		}),
		/** `ziya`/`berk`/`olena` are the three Tyrell seats — the agricultural heartland in this world's
		 * own 2D lore — so the farm animals (cows, sheep) cluster there rather than at a war seat. Two
		 * cows on parallel, non-crossing patrol lines read as a small grazing herd. */
		Object.freeze({
			id: 'ziya-cow-1',
			seatId: 'ziya',
			speciesId: 'cow',
			offsetXMeters: -28,
			offsetZMeters: 24,
			rotationYRadians: 0,
			patrol: Object.freeze({ toOffsetXMeters: -46, toOffsetZMeters: 24 }),
		}),
		Object.freeze({
			id: 'ziya-cow-2',
			seatId: 'ziya',
			speciesId: 'cow',
			offsetXMeters: -30,
			offsetZMeters: 38,
			rotationYRadians: 0,
			patrol: Object.freeze({ toOffsetXMeters: -48, toOffsetZMeters: 38 }),
		}),
		/** Sheep are deliberately static — their source file has no walk clip at all (see the `sheep`
		 * species entry). No `patrol`, and `canFlee: false` for the same reason the rigless horse used
		 * it: a model with no run cycle sliding across terrain looks broken. */
		Object.freeze({
			id: 'berk-sheep-1',
			seatId: 'berk',
			speciesId: 'sheep',
			canFlee: false,
			offsetXMeters: 30,
			offsetZMeters: -22,
			rotationYRadians: Math.PI * 0.25,
		}),
		Object.freeze({
			id: 'berk-sheep-2',
			seatId: 'berk',
			speciesId: 'sheep',
			canFlee: false,
			offsetXMeters: 39,
			offsetZMeters: -28,
			rotationYRadians: Math.PI * 0.75,
		}),
		/** Lannister/Westerlands seat — a bull as working livestock at the richest seat. */
		Object.freeze({
			id: 'cersei-bull-1',
			seatId: 'cersei',
			speciesId: 'bull',
			offsetXMeters: -32,
			offsetZMeters: -26,
			rotationYRadians: Math.PI * 1.5,
			patrol: Object.freeze({ toOffsetXMeters: -32, toOffsetZMeters: -46 }),
		}),
		/** Arryn's Vale seat — mountain/forest country, so wild game (deer) rather than livestock. */
		Object.freeze({
			id: 'robin-deer-1',
			seatId: 'robin',
			speciesId: 'deer',
			offsetXMeters: 42,
			offsetZMeters: 18,
			rotationYRadians: Math.PI * 0.5,
			patrol: Object.freeze({ toOffsetXMeters: 62, toOffsetZMeters: 18 }),
		}),
		Object.freeze({
			id: 'olena-fox-1',
			seatId: 'olena',
			speciesId: 'fox',
			offsetXMeters: 26,
			offsetZMeters: 30,
			rotationYRadians: Math.PI,
			patrol: Object.freeze({ toOffsetXMeters: 26, toOffsetZMeters: 50 }),
		}),
		/** The North/Wall seat gets the working dog — closes the "köpek" half of FAZ 6's outstanding
		 * at/araba/köpek-kedi/kuş gap with a real animated model instead of another manual-download note
		 * in `QUESTIONS_FOR_OWNER.md`. */
		Object.freeze({
			id: 'jon-dog-1',
			seatId: 'jon',
			speciesId: 'dog',
			offsetXMeters: -30,
			offsetZMeters: 55,
			rotationYRadians: Math.PI * 1.25,
			patrol: Object.freeze({ toOffsetXMeters: -48, toOffsetZMeters: 75 }),
		}),
		/** `Xaro` is this world's Qarth merchant seat — the one place non-native, imported exotic
		 * animals (zebra, alpaca) are a deliberate thematic fit rather than a continuity break. Placed
		 * on divergent axes so their patrol lines never intersect. */
		Object.freeze({
			id: 'Xaro-zebra-1',
			seatId: 'Xaro',
			speciesId: 'zebra',
			offsetXMeters: 34,
			offsetZMeters: -20,
			rotationYRadians: Math.PI * 0.5,
			patrol: Object.freeze({ toOffsetXMeters: 54, toOffsetZMeters: -20 }),
		}),
		Object.freeze({
			id: 'Xaro-alpaca-1',
			seatId: 'Xaro',
			speciesId: 'alpaca',
			offsetXMeters: 28,
			offsetZMeters: 28,
			rotationYRadians: Math.PI,
			patrol: Object.freeze({ toOffsetXMeters: 28, toOffsetZMeters: 48 }),
		}),
	]),
});