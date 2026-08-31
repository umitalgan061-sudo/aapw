/**
 * `gameplay/creatureBrain.js` — the behaviour-primitive state machine `gameplay/creatureSpeciesConfig.js`
 * has named since run 72 and run 326/327 (ADR-0272/ADR-0273) left as the declared "next safe step":
 * the piece that finally spawns a `creatureRig.js` body into the live scene and calls
 * `applyCreatureGait` from a real per-frame tick, instead of the rig sitting inert.
 *
 * **Scope for this pass.** `creatureSpeciesConfig.js` names nine behaviour primitives (`patrol`,
 * `flee-on-approach`, `approach-friendly`, `pounce`, `herd-bound`, `flock`, `combat-stance`, `charge`,
 * `regal-idle`). This module ships the two that cover every quadruped land animal without a pending
 * owner decision blocking them: a seeded **wander** (idle roam near the spawn point — the same "reuse
 * `patrol`'s straight-line-between-points idea, generalized to a self-chosen point instead of an
 * authored waypoint list" scope) and **reactive movement**, either away from the player (`flee-on-
 * approach`/`herd-bound`, most species) or toward the player (`approach-friendly`, `kopek` only) —
 * mirroring `gameplay/animals.js`'s wolf flee/pack-alert almost exactly (same shape, generalized from
 * one hard-coded species to a data table). `pounce` and `charge` are *not* implemented as their own
 * distinct lunge motion in this pass — both would need a real target/contact concept this project
 * doesn't have yet (`QUESTIONS_FOR_OWNER.md`'s still-open health/damage question is exactly why `charge`
 * stays a flee-shaped gesture for now), so `kedi`/`domuz` use the same reactive-flee branch as every
 * other skittish species — a smaller, honest first step, same "ship the smallest thing that earns the
 * behaviour name" discipline `animals.js`'s own header documents for its own flee/pack-alert.
 * `regal-idle`/`combat-stance` (already covered — `kral` has no model yet, `asker` already has real
 * combat-stance NPCs per `creatureSpeciesConfig.js`'s own `asker` entry) stay out of scope here for the
 * same "every species gets its own future sub-task" reason `creatureSpeciesConfig.js`'s header states.
 *
 * **Birds fly now (this pass's own addition).** `kuzgun`/`kartal`/`tavuk` previously had no
 * `CREATURE_BEHAVIOR_PROFILES` entry at all — this file's own header used to say flight/perch
 * locomotion "deserves its own pass rather than a bolted-on branch here". This pass is that pass, kept
 * deliberately small: every bird still uses the exact same ground-hop `stepGroundWander` wander a
 * quadruped's own wander branch uses (`restGait: 'hop'`, from `creatureBodyPlans.js`'s `BIRD_DEFAULTS`
 * — unchanged) while undisturbed, and a new **climb -> cruise -> land** state machine (`flightPhase`)
 * replaces the ground-flee branch once a player enters `reactiveTriggerRadiusMeters`: the being turns
 * to face directly away from the player, climbs at `takeoffClimbMps` to `flightAltitudeMeters` above
 * whatever ground is directly beneath it (`plan.alertGait: 'flap'` drives the wing animation the whole
 * time it is airborne), cruises outward for `flightDurationSeconds`, then descends and resumes ground
 * hopping at its new landing spot — a self-terminating flight, not an indefinitely circling one, so a
 * player standing still near a startled bird doesn't watch it loop overhead forever. This same flight
 * controller now also consumes the established same-species bounded alert primitive for `flock`:
 * a directly startled bird may wake nearby birds of its own species, while receiver-only reactions do
 * not relay onward because `livingWorldSpawner.js` only publishes direct-player threat sources.
 * `playerCollider` is intentionally not consulted while airborne (climbing/cruising/landing) — a bird
 * flying over a castle wall or a cottage roof is correct, not a bug, unlike a ground quadruped walking
 * through one.
 *
 * **Social herd cohesion.** `creatureSpawner.js` now carries the deterministic cluster anchor that
 * social species already use at spawn time into each spawn record. Ground herd species reuse that
 * anchor as their idle wander center rather than treating every member's individual spawn point as a
 * separate home. Their calm wander radius is capped below half the existing same-species alert radius,
 * keeping two independently wandering herd members inside the communication envelope in steady state.
 * Threat reactions remain unconstrained: a frightened animal may still flee well outside the herd;
 * once calm, the existing wander movement naturally walks it back toward the shared anchor. Flight
 * species deliberately retain their landing-local wander center because forcing a landed bird to
 * ground-hop all the way back to its pre-flight flock anchor would look less realistic, not more.
 *
 * **Which species.** Every `CREATURE_BEHAVIOR_PROFILES` key below is a `gameplay/creatureBodyPlans.js`
 * body-plan id, *except* `kurt` (already a real, shipped, asset-driven wolf — `gameplay/animals.js` —
 * spawning a second, procedural wolf population alongside it would just look like a visual downgrade
 * duplicate, not new content) and `insan`/`asker` (humans stay `gameplay/npc.js`'s domain; a generic
 * unnamed, dialogue-less human wandering the map would read as a bug, not a villager).
 *
 * **Animation.** Each being keeps its own `gaitClockSeconds`, advanced by `delta` only while actually
 * moving (wandering or reacting) and held while paused/idle — `applyCreatureGait` ties leg/tail/wing
 * rotation to one clock, so a frozen clock is what keeps a paused creature's legs from sliding in
 * place; `resetCreatureGaitPose` is called once on the transition into "paused" so a leg doesn't hang
 * mid-swing. `restGait`/`alertGait` come straight from the being's own `CREATURE_BODY_PLANS` entry
 * (wander uses `restGait`, reactive movement uses `alertGait`) — no new gait vocabulary invented here.
 *
 * Determinism: each being's wander-target picker is a `mulberry32` stream seeded from its own spawn
 * position (via a plain FNV-1a string hash — `world/terrain.js`'s `mulberry32` takes a numeric seed,
 * this is just the string->number step, not a second RNG algorithm), so replaying the same spawn list
 * reproduces the same sequence of wander targets (GOVERNANCE.md §8.9). Movement itself is still an
 * ordinary per-frame `delta` integration (same as `animals.js`'s wolf), so it is only as
 * frame-rate-independent as the rest of this project's movement code already is — not a new limitation.
 * @module gameplay/creatureBrain
 */

import { createCreatureRig } from './creatureRig.js';
import { applyCreatureGait, resetCreatureGaitPose } from './creatureGait.js';
import { CREATURE_BODY_PLANS } from './creatureBodyPlans.js';

/**
 * Per-species movement tuning. Every value here is this pass's own first-pass engineering judgment —
 * same "temporary default, no real playtest yet" category as every other feel constant this codebase
 * has logged in `QUESTIONS_FOR_OWNER.md` (ADR-0075/0076/0085/0096/.../0273) — scaled from each body
 * plan's own real-meter proportions and, where a `creatureSpeciesConfig.js` entry of the same id
 * exists (`kedi`, `kopek`, `at`, `koyun`), its `speedProfile`/`behaviorTags` directly.
 *
 * @typedef {object} CreatureBehaviorProfile
 * @property {number} wanderRadiusMeters How far a being roams from its own spawn point before turning
 *   back — small on purpose (this is idle "grazing" liveliness, not a real patrol route).
 * @property {number} wanderSpeedMps
 * @property {number} wanderPauseSeconds Idle dwell time at each wander stop.
 * @property {'away'|'toward'} reactiveDirection `'away'` = flee (`flee-on-approach`/`herd-bound`,
 *   every species below except `kopek`); `'toward'` = `approach-friendly` (`kopek` only, the mirror
 *   image `creatureSpeciesConfig.js`'s own `kopek` entry names).
 * @property {number} reactiveTriggerRadiusMeters Player distance that triggers the reactive branch.
 * @property {number} reactiveSpeedMps
 * @property {number} [reactiveStopDistanceMeters] `reactiveDirection: 'toward'` only — how close an
 *   approaching being gets before it stops, so it never visually pushes into the player.
 * @property {number|null} packAlertRadiusMeters Same primitive as `animals.js`'s wolf pack-alert: a
 *   being not yet within its own `reactiveTriggerRadiusMeters` of the player still reacts if a
 *   same-species herdmate within this radius is already reacting. `null` = solitary, no herd/flock check.
 * @property {'flight'} [locomotion] Omit (the default) for every quadruped — identical shape/behavior
 *   as before flight species existed. `'flight'` opts a being into the climb/cruise/land state machine
 *   in place of the ground reactive-flee branch (see this file's own "Birds fly now" header section);
 *   only `kuzgun`/`kartal`/`tavuk` set this today. The three properties below are meaningless/unused
 *   unless this is `'flight'`.
 * @property {number} [flightAltitudeMeters] Cruise height in meters above the ground directly under
 *   the being once a climb completes.
 * @property {number} [takeoffClimbMps] Vertical speed used both climbing away and descending back to
 *   land — symmetric, a bird lands about as fast as it takes off.
 * @property {number} [flightDurationSeconds] How long a being stays airborne once startled, measured
 *   from the moment it leaves the ground, before it lands regardless of the player's position — keeps
 *   a bird from circling forever if the player just stands nearby.
 */

/** Shared by every profile unless overridden. */
const DEFAULT_TURN_RATE_RADIANS_PER_SECOND = 3.2;

// A calm ground herd member may roam at most 42% of the existing pack-alert radius from the shared
// anchor. Two members at opposite extremes therefore remain at 84% of the communication radius.
export const CREATURE_SOCIAL_WANDER_RADIUS_FACTOR = 0.42;

/** @type {Record<string, CreatureBehaviorProfile>} */
export const CREATURE_BEHAVIOR_PROFILES = Object.freeze({
	kedi: Object.freeze({
		wanderRadiusMeters: 5, wanderSpeedMps: 0.9, wanderPauseSeconds: 3,
		reactiveDirection: 'away', reactiveTriggerRadiusMeters: 6, reactiveSpeedMps: 3.5,
		packAlertRadiusMeters: null,
	}),
	kopek: Object.freeze({
		wanderRadiusMeters: 6, wanderSpeedMps: 1.8, wanderPauseSeconds: 3,
		reactiveDirection: 'toward', reactiveTriggerRadiusMeters: 10, reactiveSpeedMps: 2.5,
		reactiveStopDistanceMeters: 2.5, packAlertRadiusMeters: null,
	}),
	at: Object.freeze({
		wanderRadiusMeters: 12, wanderSpeedMps: 2.0, wanderPauseSeconds: 4,
		reactiveDirection: 'away', reactiveTriggerRadiusMeters: 12, reactiveSpeedMps: 9,
		packAlertRadiusMeters: 20,
	}),
	fil: Object.freeze({
		wanderRadiusMeters: 10, wanderSpeedMps: 1.0, wanderPauseSeconds: 5,
		reactiveDirection: 'away', reactiveTriggerRadiusMeters: 14, reactiveSpeedMps: 4,
		packAlertRadiusMeters: null,
	}),
	geyik: Object.freeze({
		wanderRadiusMeters: 10, wanderSpeedMps: 1.5, wanderPauseSeconds: 4,
		reactiveDirection: 'away', reactiveTriggerRadiusMeters: 15, reactiveSpeedMps: 6.5,
		packAlertRadiusMeters: 18,
	}),
	koyun: Object.freeze({
		wanderRadiusMeters: 8, wanderSpeedMps: 0.7, wanderPauseSeconds: 6,
		reactiveDirection: 'away', reactiveTriggerRadiusMeters: 4, reactiveSpeedMps: 1.5,
		packAlertRadiusMeters: 6,
	}),
	inek: Object.freeze({
		wanderRadiusMeters: 10, wanderSpeedMps: 1.0, wanderPauseSeconds: 5,
		reactiveDirection: 'away', reactiveTriggerRadiusMeters: 5, reactiveSpeedMps: 2.5,
		packAlertRadiusMeters: 8,
	}),
	keci: Object.freeze({
		wanderRadiusMeters: 9, wanderSpeedMps: 1.2, wanderPauseSeconds: 4,
		reactiveDirection: 'away', reactiveTriggerRadiusMeters: 6, reactiveSpeedMps: 3,
		packAlertRadiusMeters: 10,
	}),
	domuz: Object.freeze({
		wanderRadiusMeters: 8, wanderSpeedMps: 1.0, wanderPauseSeconds: 3,
		reactiveDirection: 'away', reactiveTriggerRadiusMeters: 8, reactiveSpeedMps: 6,
		packAlertRadiusMeters: null,
	}),
	tavsan: Object.freeze({
		wanderRadiusMeters: 6, wanderSpeedMps: 1.2, wanderPauseSeconds: 3,
		reactiveDirection: 'away', reactiveTriggerRadiusMeters: 8, reactiveSpeedMps: 3.6,
		packAlertRadiusMeters: null,
	}),
	ayi: Object.freeze({
		wanderRadiusMeters: 10, wanderSpeedMps: 1.2, wanderPauseSeconds: 5,
		reactiveDirection: 'away', reactiveTriggerRadiusMeters: 10, reactiveSpeedMps: 2.4,
		packAlertRadiusMeters: null,
	}),
	aslan: Object.freeze({
		wanderRadiusMeters: 10, wanderSpeedMps: 1.3, wanderPauseSeconds: 5,
		reactiveDirection: 'away', reactiveTriggerRadiusMeters: 12, reactiveSpeedMps: 2.7,
		packAlertRadiusMeters: null,
	}),
	zurafa: Object.freeze({
		wanderRadiusMeters: 12, wanderSpeedMps: 0.8, wanderPauseSeconds: 5,
		reactiveDirection: 'away', reactiveTriggerRadiusMeters: 14, reactiveSpeedMps: 1.6,
		packAlertRadiusMeters: 20,
	}),
	// Birds — ground-hop wander (see BIRD_DEFAULTS' restGait: 'hop'), climb-away-and-land in place of
	// ground flee once startled. Flock alert radii deliberately reuse the same same-species-only,
	// non-relaying registry contract as quadruped herds; they do not create a second flock framework.
	kuzgun: Object.freeze({
		wanderRadiusMeters: 4, wanderSpeedMps: 0.6, wanderPauseSeconds: 2.5,
		reactiveDirection: 'away', reactiveTriggerRadiusMeters: 9, reactiveSpeedMps: 7,
		packAlertRadiusMeters: 12,
		locomotion: 'flight', flightAltitudeMeters: 12, takeoffClimbMps: 6, flightDurationSeconds: 6,
	}),
	kartal: Object.freeze({
		wanderRadiusMeters: 5, wanderSpeedMps: 0.5, wanderPauseSeconds: 4,
		reactiveDirection: 'away', reactiveTriggerRadiusMeters: 16, reactiveSpeedMps: 8,
		packAlertRadiusMeters: 20,
		locomotion: 'flight', flightAltitudeMeters: 22, takeoffClimbMps: 5, flightDurationSeconds: 9,
	}),
	tavuk: Object.freeze({
		wanderRadiusMeters: 3, wanderSpeedMps: 0.5, wanderPauseSeconds: 2,
		reactiveDirection: 'away', reactiveTriggerRadiusMeters: 5, reactiveSpeedMps: 4,
		packAlertRadiusMeters: 8,
		locomotion: 'flight', flightAltitudeMeters: 4, takeoffClimbMps: 4, flightDurationSeconds: 2.5,
	}),
});

/** FNV-1a 32-bit string hash — the string->numeric-seed step feeding `mulberry32` (imported by the
 * caller from `world/terrain.js`, not duplicated here). Deterministic, no `Math.random()`. */
function hashSeedString(text) {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

/**
 * Builds one procedural creature: rig + wander/reactive-movement state machine. Shape matches
 * `gameplay/animals.js`'s `createWolf` return contract (`{object3D, isFleeing, update, dispose}`) so
 * it slots into `game3d.js`'s existing `updateEntitiesSafely` loop unchanged.
 * @param {object} options
 * @param {string} options.speciesId Key into both `CREATURE_BODY_PLANS` and `CREATURE_BEHAVIOR_PROFILES`.
 * @param {string} options.spawnId Unique id (also used to seed this being's own wander RNG).
 * @param {number} options.worldX
 * @param {number} options.worldZ
 * @param {number} options.groundY
 * @param {number} [options.rotationYRadians]
 * @param {number} [options.socialAnchorX] Shared deterministic herd center supplied by creatureSpawner.
 * @param {number} [options.socialAnchorZ] Shared deterministic herd center supplied by creatureSpawner.
 * @param {{getGroundHeight: (x: number, z: number) => number}} options.groundCollider
 * @param {{resolveXZ: (x: number, z: number) => {x: number, z: number}}} [options.playerCollider]
 *   Run 332's own follow-up to Run 331's own named gap: the same castle+village obstacle collider
 *   `sceneManager.js` builds for `gameplay/player.js` (see its own JSDoc), applied to both the
 *   wander and reactive movement branches here so a being pushes back out of a house/keep instead of
 *   wandering/fleeing straight through it. Optional — omit (the default) for any caller with no
 *   obstacle collider available (e.g. a unit test).
 * @param {(seed: number) => () => number} options.mulberry32 Passed in rather than imported directly
 *   from `world/terrain.js` — keeps this gameplay module's only coupling to `world/` explicit and
 *   caller-controlled, same "generator takes plain data, not a live import graph" rule `world/README.md`
 *   already holds `world/vegetation.js` to.
 * @returns {{object3D: import('three').Object3D, isFleeing: boolean, update: (delta: number, playerPosition?: {x:number,z:number}, herdmateReactivePositions?: {x:number,z:number}[]) => void, dispose: () => void}}
 */
export function createCreatureBeing({
	speciesId,
	spawnId,
	worldX,
	worldZ,
	groundY,
	rotationYRadians = 0,
	socialAnchorX = null,
	socialAnchorZ = null,
	groundCollider,
	playerCollider = null,
	mulberry32,
}) {
	const profile = CREATURE_BEHAVIOR_PROFILES[speciesId];
	if (!profile) {
		throw new Error(`[gameplay/creatureBrain] no CREATURE_BEHAVIOR_PROFILES entry for species "${speciesId}"`);
	}
	const plan = CREATURE_BODY_PLANS[speciesId];
	const rig = createCreatureRig({ speciesId, variant: spawnId });
	const object3D = rig.object3D;
	object3D.name = spawnId;
	object3D.position.set(worldX, groundY, worldZ);
	object3D.rotation.y = Number.isFinite(rotationYRadians) ? rotationYRadians : 0;

	const socialCohesionEnabled = profile.locomotion !== 'flight'
		&& profile.packAlertRadiusMeters != null
		&& Number.isFinite(socialAnchorX)
		&& Number.isFinite(socialAnchorZ);
	const idleWanderRadiusMeters = socialCohesionEnabled
		? Math.min(profile.wanderRadiusMeters, profile.packAlertRadiusMeters * CREATURE_SOCIAL_WANDER_RADIUS_FACTOR)
		: profile.wanderRadiusMeters;
	const rng = mulberry32(hashSeedString(spawnId) ^ 0x42524e00); // "BRN\0"-ish tag
	const wanderCenter = socialCohesionEnabled
		? { x: socialAnchorX, z: socialAnchorZ }
		: { x: worldX, z: worldZ };
	let wanderTarget = { x: worldX, z: worldZ };
	let pauseTimer = profile.wanderPauseSeconds;
	let gaitClockSeconds = 0;
	let wasMoving = false;
	let currentlyReacting = false;
	const isFlightSpecies = profile.locomotion === 'flight';
	object3D.userData.creatureSocial = Object.freeze({
		enabled: socialCohesionEnabled,
		anchorX: socialCohesionEnabled ? socialAnchorX : null,
		anchorZ: socialCohesionEnabled ? socialAnchorZ : null,
		idleWanderRadiusMeters: Number(idleWanderRadiusMeters.toFixed(3)),
		alertRadiusMeters: profile.packAlertRadiusMeters ?? null,
	});
	// Flight-only state — declared unconditionally (cheap, and keeps this function's shape uniform) but
	// only ever read/written when `isFlightSpecies` is true.
	let flightPhase = 'grounded'; // 'grounded' | 'climbing' | 'cruising' | 'landing'
	let flightAltitudeMeters = 0;
	let flightHeadingX = 0;
	let flightHeadingZ = 1;
	let flightElapsedSeconds = 0;

	/** Shortest-path yaw turn — copied from `gameplay/animals.js`'s `createWolf` (small, per-species
	 * controller; this project's own established precedent — see that module's own header — prefers
	 * this over a shared cross-module helper for a function this small). */
	function turnToward(targetYaw, delta) {
		const turnStep = DEFAULT_TURN_RATE_RADIANS_PER_SECOND * delta;
		object3D.rotation.y +=
			(((targetYaw - object3D.rotation.y + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI) *
			Math.min(1, turnStep);
	}

	function pickNewWanderTarget() {
		const angle = rng() * Math.PI * 2;
		const radius = idleWanderRadiusMeters * Math.sqrt(rng());
		wanderTarget = { x: wanderCenter.x + Math.cos(angle) * radius, z: wanderCenter.z + Math.sin(angle) * radius };
	}

	// Matches the established wolf fallback: when threat and creature occupy the same X/Z point there
	// is no separable vector to normalize, so use the creature's finite facing instead of a zero vector.
	// This keeps exact-overlap reactions deterministic and guarantees an actual escape/takeoff attempt.
	function reactiveDirection(dx, dz, distance, sign = 1) {
		const hasSeparationVector = Number.isFinite(distance) && distance > 1e-6;
		const fallbackYaw = Number.isFinite(object3D.rotation.y) ? object3D.rotation.y : 0;
		const baseX = hasSeparationVector ? dx / distance : Math.sin(fallbackYaw);
		const baseZ = hasSeparationVector ? dz / distance : Math.cos(fallbackYaw);
		return { x: baseX * sign, z: baseZ * sign };
	}

	// Movement is committed only after every external boundary has returned a finite candidate. This
	// prevents collider/terrain faults from leaving a creature with new X/Z but an old or invalid Y.
	function tryCommitGroundedMove(candidateX, candidateZ) {
		if (!Number.isFinite(candidateX) || !Number.isFinite(candidateZ)) return false;
		let resolvedX = candidateX;
		let resolvedZ = candidateZ;
		try {
			if (playerCollider) {
				const resolved = playerCollider.resolveXZ(candidateX, candidateZ);
				if (!Number.isFinite(resolved?.x) || !Number.isFinite(resolved?.z)) return false;
				resolvedX = resolved.x;
				resolvedZ = resolved.z;
			}
			const resolvedY = groundCollider.getGroundHeight(resolvedX, resolvedZ);
			if (!Number.isFinite(resolvedY)) return false;
			object3D.position.set(resolvedX, resolvedY, resolvedZ);
			return true;
		} catch {
			return false;
		}
	}

	// Airborne birds deliberately bypass playerCollider, but terrain-relative altitude still has to be
	// resolved before publishing any transform or flight-state progress. A failed sample freezes this
	// simulation step and is retried on the next update without partially moving the bird.
	function tryCommitFlightMove(candidateX, candidateZ, candidateAltitudeMeters) {
		if (!Number.isFinite(candidateX) || !Number.isFinite(candidateZ) || !Number.isFinite(candidateAltitudeMeters)) return false;
		try {
			const terrainY = groundCollider.getGroundHeight(candidateX, candidateZ);
			const candidateY = terrainY + candidateAltitudeMeters;
			if (!Number.isFinite(terrainY) || !Number.isFinite(candidateY)) return false;
			object3D.position.set(candidateX, candidateY, candidateZ);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Ground-hop wander step — the exact wander behavior every species used before flight species
	 * existed, extracted unchanged so a flight species can reuse it verbatim while grounded (see this
	 * file's own "Birds fly now" header section). Returns whether movement happened this frame.
	 */
	function stepGroundWander(delta) {
		if (pauseTimer > 0) {
			pauseTimer -= delta;
			return false;
		}
		const dx = wanderTarget.x - object3D.position.x;
		const dz = wanderTarget.z - object3D.position.z;
		const distance = Math.hypot(dx, dz);
		const step = profile.wanderSpeedMps * delta;
		if (distance <= step) {
			if (!tryCommitGroundedMove(wanderTarget.x, wanderTarget.z)) return false;
			pickNewWanderTarget();
			pauseTimer = profile.wanderPauseSeconds;
			return false;
		}
		const nextX = object3D.position.x + (dx / distance) * step;
		const nextZ = object3D.position.z + (dz / distance) * step;
		if (!tryCommitGroundedMove(nextX, nextZ)) return false;
		turnToward(Math.atan2(dx, dz), delta);
		return true;
	}

	return {
		object3D,
		get isFleeing() {
			return currentlyReacting || (isFlightSpecies && flightPhase !== 'grounded');
		},
		update(delta, playerPosition, herdmateReactivePositions) {
			const dxFromPlayer = playerPosition ? object3D.position.x - playerPosition.x : Infinity;
			const dzFromPlayer = playerPosition ? object3D.position.z - playerPosition.z : Infinity;
			const distanceFromPlayer = Math.hypot(dxFromPlayer, dzFromPlayer);
			let reactingDirectly = distanceFromPlayer < profile.reactiveTriggerRadiusMeters;

			// `approach-friendly` (`kopek`): stop reacting once close enough that closing further would
			// visually push into the player — mirrors `flee-on-approach`'s own trigger-radius shape.
			if (profile.reactiveDirection === 'toward' && distanceFromPlayer <= (profile.reactiveStopDistanceMeters ?? 0)) {
				reactingDirectly = false;
			}

			let reactingFromHerd = false;
			if (!reactingDirectly && playerPosition && profile.packAlertRadiusMeters != null && herdmateReactivePositions) {
				for (const herdmatePosition of herdmateReactivePositions) {
					const dx = object3D.position.x - herdmatePosition.x;
					const dz = object3D.position.z - herdmatePosition.z;
					if (Math.hypot(dx, dz) < profile.packAlertRadiusMeters) {
						reactingFromHerd = true;
						break;
					}
			}

			currentlyReacting = reactingDirectly || reactingFromHerd;
			let isMoving = false;

			if (isFlightSpecies) {
				// Climb -> cruise -> land. Grounded takeoff and every airborne state are committed only
				// after the terrain-relative candidate is finite, so transform and flight state cannot
				// diverge when the live terrain provider is temporarily unavailable.
				if (flightPhase === 'grounded') {
					if (currentlyReacting) {
						const heading = reactiveDirection(dxFromPlayer, dzFromPlayer, distanceFromPlayer);
						const nextHeadingX = heading.x;
						const nextHeadingZ = heading.z;
						const nextAltitude = Math.min(profile.flightAltitudeMeters, profile.takeoffClimbMps * delta);
						const nextX = object3D.position.x + nextHeadingX * profile.reactiveSpeedMps * delta;
						const nextZ = object3D.position.z + nextHeadingZ * profile.reactiveSpeedMps * delta;
						if (tryCommitFlightMove(nextX, nextZ, nextAltitude)) {
							flightHeadingX = nextHeadingX;
							flightHeadingZ = nextHeadingZ;
							flightAltitudeMeters = nextAltitude;
							flightElapsedSeconds = delta;
							flightPhase = nextAltitude >= profile.flightAltitudeMeters ? 'cruising' : 'climbing';
							turnToward(Math.atan2(flightHeadingX, flightHeadingZ), delta);
							isMoving = true;
						}
					} else {
						isMoving = stepGroundWander(delta);
					}
				} else if (flightPhase === 'landing') {
					const nextAltitude = Math.max(0, flightAltitudeMeters - profile.takeoffClimbMps * delta);
					if (tryCommitFlightMove(object3D.position.x, object3D.position.z, nextAltitude)) {
						flightAltitudeMeters = nextAltitude;
						isMoving = true;
						if (flightAltitudeMeters <= 0) {
							flightPhase = 'grounded';
							wanderCenter.x = object3D.position.x;
							wanderCenter.z = object3D.position.z;
							pickNewWanderTarget();
							pauseTimer = profile.wanderPauseSeconds;
						}
					}
				} else {
					// 'climbing' or 'cruising' — both fly the same fixed heading at reactiveSpeedMps,
					// differing only in whether altitude is still increasing.
					const nextElapsedSeconds = flightElapsedSeconds + delta;
					const nextX = object3D.position.x + flightHeadingX * profile.reactiveSpeedMps * delta;
					const nextZ = object3D.position.z + flightHeadingZ * profile.reactiveSpeedMps * delta;
					let nextAltitude = flightAltitudeMeters;
					let nextPhase = flightPhase;
					if (flightPhase === 'climbing') {
						nextAltitude = Math.min(profile.flightAltitudeMeters, flightAltitudeMeters + profile.takeoffClimbMps * delta);
						if (nextAltitude >= profile.flightAltitudeMeters) nextPhase = 'cruising';
					} else if (nextElapsedSeconds >= profile.flightDurationSeconds) {
						nextPhase = 'landing';
					}
					if (tryCommitFlightMove(nextX, nextZ, nextAltitude)) {
						flightElapsedSeconds = nextElapsedSeconds;
						flightAltitudeMeters = nextAltitude;
						flightPhase = nextPhase;
						turnToward(Math.atan2(flightHeadingX, flightHeadingZ), delta);
						isMoving = true;
					}
				}

				if (isMoving) {
					gaitClockSeconds += delta;
					applyCreatureGait(rig, { gaitName: flightPhase === 'grounded' ? plan.restGait : plan.alertGait, elapsedSeconds: gaitClockSeconds });
				} else if (wasMoving) {
					resetCreatureGaitPose(rig);
				}
				wasMoving = isMoving;
				return;
			}

			if (currentlyReacting) {
				const sign = profile.reactiveDirection === 'toward' ? -1 : 1;
				const direction = reactiveDirection(dxFromPlayer, dzFromPlayer, distanceFromPlayer, sign);
				const dirX = direction.x;
				const dirZ = direction.z;
				const step = profile.reactiveSpeedMps * delta;
				const nextX = object3D.position.x + dirX * step;
				const nextZ = object3D.position.z + dirZ * step;
				if (tryCommitGroundedMove(nextX, nextZ)) {
					turnToward(Math.atan2(dirX, dirZ), delta);
					isMoving = true;
				}
			} else {
				isMoving = stepGroundWander(delta);
			}

			if (isMoving) {
				gaitClockSeconds += delta;
				applyCreatureGait(rig, { gaitName: currentlyReacting ? plan.alertGait : plan.restGait, elapsedSeconds: gaitClockSeconds });
			} else if (wasMoving) {
				resetCreatureGaitPose(rig);
			}
			wasMoving = isMoving;
		},
		dispose() {
			rig.dispose();
		},
	};
}

/**
 * Bulk-instantiates every entry of a procedural spawn list (see `gameplay/creatureSpawner.js`) into
 * live `createCreatureBeing` controllers — same "resolve + load in one call, `game3d.js` just adds the
 * results to the scene" shape as `animals.js`'s `spawnConfiguredAnimals`, minus the `Promise.all`/
 * asset-download step: a procedural rig has nothing to `await` (no network fetch, no glTF parse), so
 * this stays a plain synchronous function rather than an async one that never actually suspends.
 * @param {object} options
 * @param {{id: string, speciesId: string, x: number, z: number, rotationYRadians?: number, socialAnchorX?: number, socialAnchorZ?: number}[]} options.spawns
 * @param {{getGroundHeight: (x: number, z: number) => number}} options.groundCollider
 * @param {{resolveXZ: (x: number, z: number) => {x: number, z: number}}} [options.playerCollider]
 *   Forwarded to every `createCreatureBeing` call — see that function's own JSDoc.
 * @param {(seed: number) => () => number} options.mulberry32
 * @returns {ReturnType<typeof createCreatureBeing>[]} Already filtered — malformed coordinates,
 *   unsafe terrain samples, and species with no behavior profile are skipped per entry so one bad
 *   spawn cannot poison the rest of the procedural population.
 */
export function spawnConfiguredCreatures({ spawns, groundCollider, playerCollider, mulberry32 }) {
	const beings = [];
	for (const spawn of spawns) {
		if (!CREATURE_BEHAVIOR_PROFILES[spawn.speciesId]) {
			console.warn(`[gameplay/creatureBrain] spawn "${spawn.id}" names species "${spawn.speciesId}" with no behavior profile — skipping.`);
			continue;
		}
		if (!Number.isFinite(spawn.x) || !Number.isFinite(spawn.z)) {
			console.warn(`[gameplay/creatureBrain] spawn "${spawn.id}" has non-finite world coordinates — skipping.`);
			continue;
		}
		let groundY;
		try {
			groundY = groundCollider.getGroundHeight(spawn.x, spawn.z);
		} catch (error) {
			console.warn(`[gameplay/creatureBrain] spawn "${spawn.id}" ground sample failed — skipping.`, error);
			continue;
		}
		if (!Number.isFinite(groundY)) {
			console.warn(`[gameplay/creatureBrain] spawn "${spawn.id}" resolved non-finite ground — skipping.`);
			continue;
		}
		beings.push(
			createCreatureBeing({
				speciesId: spawn.speciesId,
				spawnId: spawn.id,
				worldX: spawn.x,
				worldZ: spawn.z,
				groundY,
				rotationYRadians: spawn.rotationYRadians ?? 0,
				socialAnchorX: spawn.socialAnchorX ?? null,
				socialAnchorZ: spawn.socialAnchorZ ?? null,
				groundCollider,
				playerCollider,
				mulberry32,
			}),
		);
	}
	return beings;
}