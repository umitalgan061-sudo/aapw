/**
 * Flying dragons (FAZ 7). First pass (run 53): a single dragon circling at a fixed altitude above
 * a kingdom seat, looping its real `Fly` animation clip — no rig/animation work needed since
 * `DRAGON_CONFIG.MODEL_URL` (`black_dragon`, Free3D) already ships a skeleton + baked clips, unlike
 * the unrigged Meshy/Hitem3d reference dragons (see `gameplayConfig.js`'s `DRAGON_CONFIG` doc
 * comment and DECISIONS.md ADR-0071). Deliberately the smallest thing that reads as "a dragon
 * patrols the sky": a closed circular path at constant altitude, no ground collision, no
 * pathfinding — same scope discipline `gameplay/animals.js`'s first straight-line patrol pass set
 * for FAZ 6. Run 54 (DECISIONS.md ADR-0072) adds the first player-awareness: an edge-triggered
 * one-shot "notice" event through the shared `EventBus` when the player enters `noticeRadiusMeters`
 * of the dragon's real, current 3D position — the flight path itself is still untouched by it (no
 * diving/chasing/fleeing), same "awareness before behavior change" order FAZ 6's wolves went
 * through (flee trigger existed before pack-alert). Run 58 (DECISIONS.md ADR-0077) adds the actual
 * behavior change on top of that awareness: while the player stays inside `noticeRadiusMeters`, the
 * circle itself doesn't change (still no diving/chasing/pathfinding — that's a bigger future step),
 * but the dragon eases into flying its existing circle faster and banking harder, then eases back to
 * the calm baseline once the player leaves — a smoothly-blended "reaction", not an instant snap, and
 * still fully deterministic (driven only by `isInRadius` + elapsed `delta`, no `Math.random()`).
 * Run 64 (DECISIONS.md ADR-0082) adds the first real path deviation: a brief dive off the circle
 * when the player gets much closer than `noticeRadiusMeters` (a new, smaller `alarmRadiusMeters`),
 * swooping partway toward them and losing altitude, then easing back onto the ordinary circle once
 * they back off — blended the same linear-ease way as run 58's speed/bank reaction, just applied to
 * *position* this time, and terrain-safe (never dips below the real ground under it, plus a
 * clearance margin). Still no chasing/attacking/pathfinding back — the circle (`angle`) is never
 * actually left, only how far the rendered position is pulled off it, so "returning to the circle"
 * needs no separate path-planning: easing the dive blend back to 0 always lands exactly on the
 * ordinary circling pose.
 * Run 66 (DECISIONS.md ADR-0085) adds the real continuous chase runs 64/65 both flagged as the
 * natural next increment: instead of pulling the dragon a bounded fraction off a circle that stays
 * anchored to its home seat forever, the *circle itself* now travels — its center moves toward the
 * player at a bounded speed (`pursuitCenterSpeedMps`) while engaged, tightening its radius and
 * following terrain altitude as it goes, then travels back home the same way once the dragon
 * disengages. That keeps every property this module's earlier passes were built around (the dragon
 * is always exactly on a well-defined circle, so "return home" needs no path-planning, and every
 * value is still a pure function of `delta` + the player's position, so it stays deterministic)
 * while removing the one thing that made the dive stop short of a real chase: the dragon can now
 * actually reach the player, anywhere in the world, instead of being permanently tethered to its
 * seat. Engagement is time-boxed (`pursuitMaxSeconds`) and re-arms only after the player leaves
 * `pursuitRadiusMeters`, the same edge-trigger shape the notice event already uses — so a dragon
 * harries the player and then breaks off, rather than following them across the map forever.
 * `game3d.js` wires this in the same spawn-then-per-frame-update shape every other gameplay system
 * already uses, wrapped in a try/catch (GOVERNANCE.md §8.13 safe mode) since run 64 also touches
 * that call site.
 * Run 70 (DECISIONS.md ADR-0089) adds a small, deliberately damage-free polish pass on top of run
 * 66's chase: the `Fly` clip's own playback speed now reacts too, not just position/bank/circling
 * speed — the more agitated the dragon is (reusing the existing reactive/dive/pursuit blends,
 * whichever is currently strongest), the harder its wings visibly flap, easing back to the calm
 * baseline the same way every earlier reaction here already does. Purely cosmetic — no new radius,
 * trigger, or state, and still no health/damage/attack (see `QUESTIONS_FOR_OWNER.md`'s open
 * question on whether this project wants one at all).
 * @module gameplay/dragons
 */

import * as THREE from 'three';
import { AssetLoader } from '../assetLoader.js';

/**
 * Loads the dragon model, places it on its circling flight path, and returns a small controller
 * object matching this project's usual `{object3D, update(delta), dispose()}` shape (see
 * `gameplay/animals.js`'s `createWolf`, `gameplay/npc.js`'s `createNPC`).
 * @param {object} options
 * @param {import('../assetLoader.js').AssetLoader} options.assetLoader
 * @param {string} options.modelUrl
 * @param {string} [options.texturesResourcePath] See `AssetLoader.loadFBXModel`'s `resourcePath` option.
 * @param {number} options.scale Uniform scale applied to the loaded model — see `DRAGON_CONFIG.SCALE`'s doc comment for why this can't reuse `AssetLoader.correctMixamoFbxScale`.
 * @param {string} options.flyClipName Exact `THREE.AnimationClip` name to loop.
 * @param {number} options.centerX World-space circle-center X (a kingdom seat's own position).
 * @param {number} options.centerZ World-space circle-center Z.
 * @param {number} options.centerY World-space altitude the dragon flies at (already
 *   ground-height + `altitudeMeters` — resolved by the caller, same convention
 *   `spawnConfiguredAnimals` uses for `sampleGroundY`).
 * @param {number} options.circleRadiusMeters
 * @param {number} options.speedMps Tangential speed around the circle.
 * @param {number} [options.bankAngleRadians] Constant visual roll while circling.
 * @param {number} [options.startAngleRadians] Initial position on the circle (radians).
 * @param {string} [options.name] Assigned to the loaded `Object3D` (useful for debugging/tests).
 * @param {number} [options.noticeRadiusMeters] Player-awareness (run 54, ADR-0072): when the player
 *   comes within this many meters of the dragon's real, current 3D position, `eventsBus.emit(
 *   eventName, noticeToast)` fires once — edge-triggered, re-arms only after the player leaves the
 *   radius again. Omit (along with `eventsBus`/`eventName`/`noticeToast`) to disable entirely — the
 *   controller then never reads `update()`'s `playerPosition` argument at all.
 * @param {import('../eventBus.js').EventBus} [options.eventsBus]
 * @param {string} [options.eventName] `EVENTS.WORLD_EVENT_TRIGGERED`, passed in rather than imported
 *   — same options-over-import precedent `gameplay/worldEvents.js` itself uses.
 * @param {{icon: string, title: string, desc: string, color: string}} [options.noticeToast] Payload
 *   emitted as-is — matches `ui/worldEventToast.js`'s existing `_show(event)` shape, so no new UI
 *   widget is needed for this first player-awareness pass.
 * @param {number} [options.reactiveSpeedMultiplier] Run 58 (ADR-0077) reactive flight: while the
 *   player is inside `noticeRadiusMeters`, the circling angular speed eases toward
 *   `speedMps * reactiveSpeedMultiplier / circleRadiusMeters` instead of the calm baseline. Defaults
 *   to `1` (no reaction) — same "omit to disable" convention `noticeRadiusMeters` already uses, so a
 *   dragon can have awareness without reactive flight, but not the reverse (reacting requires
 *   knowing the player is near in the first place).
 * @param {number} [options.reactiveBankAngleRadians] Bank angle eased toward while the player is
 *   inside range, replacing the calm `bankAngleRadians`. Defaults to `bankAngleRadians` (no change).
 * @param {number} [options.reactiveTransitionSeconds] How long, in seconds, easing from calm to
 *   reactive (or back) takes — a linear blend, not an instant snap, so the speed-up/bank-in reads as
 *   a reaction rather than a teleport. Defaults to `1.5`. Ignored if reactive params are both at
 *   their no-op defaults.
 * @param {number} [options.alarmRadiusMeters] Run 64 (ADR-0082) dive: when the player comes within
 *   this many meters of the dragon's real position — meant to be well inside `noticeRadiusMeters`,
 *   a "right underneath it" distance rather than "somewhere on the horizon" — the dragon eases off
 *   its circle toward them and loses altitude (see `diveDropMeters`/`diveLateralPullFraction`
 *   below), easing back once they retreat past it. Omit (along with `sampleGroundY`) to disable
 *   entirely — same "omit to disable" convention `noticeRadiusMeters`/reactive-flight already use, so
 *   a dragon can react (speed up/bank) without diving, but diving requires `sampleGroundY` for its
 *   own terrain-safety clamp.
 * @param {(worldX: number, worldZ: number) => number} [options.sampleGroundY] Real ground height at
 *   an (x, z) — same convention `spawnConfiguredAnimals`/`spawnConfiguredDragons` already use for
 *   `centerY`. Required for diving to activate; re-sampled every frame the dive blend is above 0
 *   (the dive position moves every frame, so a single sample at the dive's start wouldn't stay
 *   correct) to clamp the dragon's altitude above the real terrain under its new position.
 * @param {number} [options.diveDropMeters] How far below `centerY` the dive's raw target altitude
 *   is, before the terrain-safety clamp. Defaults to `25`. The actual altitude reached may be higher
 *   than `centerY - diveDropMeters` if the real ground there is close enough that
 *   `minAltitudeAboveGroundMeters` would otherwise be violated.
 * @param {number} [options.diveLateralPullFraction] How far horizontally the dive target is pulled
 *   toward the player's current (x, z), as a fraction of the distance from the dragon's on-circle
 *   position to the player (`0` = stays over the circle point, `1` = directly over the player).
 *   Defaults to `0.35` — a swoop toward them, not a teleport to stand on top of them. Clamped to
 *   `[0, 1]` internally (a bad config value can't send the dragon past the player or behind it).
 * @param {number} [options.diveTransitionSeconds] How long, in seconds, easing into (or out of) the
 *   dive takes — same linear-blend shape `reactiveTransitionSeconds` uses, just for position instead
 *   of speed/bank. Defaults to `1`.
 * @param {number} [options.minAltitudeAboveGroundMeters] Terrain-safety floor: the dragon's final
 *   altitude is never allowed to end up below `sampleGroundY(x, z) + minAltitudeAboveGroundMeters`
 *   for its *actual* (post-blend) (x, z) that frame. Defaults to `10`. Applied to every frame's
 *   final position whenever `sampleGroundY` is available (run 66) — not only while diving, as it
 *   was when run 64 first introduced it: once the circle center can travel (see
 *   `pursuitRadiusMeters` below) the ordinary circling pose flies over arbitrary terrain too, so
 *   clamping only the dive would leave the much more common case unguarded.
 * @param {number} [options.pursuitRadiusMeters] Run 66 (ADR-0085) continuous chase: while the
 *   player is within this many meters of the dragon's real position, the dragon *engages* — its
 *   circle center travels toward the player at `pursuitCenterSpeedMps`, the circle tightens toward
 *   `pursuitCircleRadiusMeters`, and its cruise altitude starts following the terrain under the
 *   moving center. Omit (along with `sampleGroundY`) to disable entirely, same "omit to disable"
 *   convention every earlier tier uses — a dragon can dive without pursuing, but pursuing requires
 *   `sampleGroundY` for the traveling circle's own terrain-following/safety math. Meant to sit
 *   between `alarmRadiusMeters` and `noticeRadiusMeters`: wide enough that a player who lingers
 *   gets chased, narrow enough that merely being seen from across the valley doesn't start one.
 * @param {number} [options.pursuitCenterSpeedMps] How fast the circle center itself travels, in
 *   m/s — toward the player while engaged, back toward the home center once disengaged. Bounded
 *   *speed*, deliberately not a blend fraction: a fraction-of-the-remaining-distance lerp would
 *   teleport the whole circle whenever the player moved a long way in one frame, whereas a speed
 *   limit means the dragon genuinely falls behind a sprinting player and has to close the gap.
 *   Defaults to `10` (vs. `PLAYER_CONFIG.RUN_SPEED_MPS`'s 6.5 — a dragon outruns a running player,
 *   but not instantly).
 * @param {number} [options.pursuitCircleRadiusMeters] Circle radius eased toward while engaged,
 *   replacing the calm `circleRadiusMeters` — a tighter ring directly over the player reads as
 *   stalking rather than patrolling. Defaults to `circleRadiusMeters` (no tightening). Tangential
 *   speed (`speedMps`) is held constant as this changes, so a tighter circle is flown *faster* in
 *   angular terms rather than the dragon appearing to slow down as it closes in.
 * @param {number} [options.pursuitTransitionSeconds] Ease time, in seconds, for the radius/altitude
 *   blend into and out of pursuit — same linear-blend shape `reactiveTransitionSeconds`/
 *   `diveTransitionSeconds` already use. Defaults to `2`. Note the *center's* travel is speed-
 *   limited rather than blended (see `pursuitCenterSpeedMps`), so this governs only the shape of
 *   the circle, not how fast the chase itself closes.
 * @param {number} [options.pursuitMaxSeconds] How long a single engagement may last before the
 *   dragon gives up and heads home. Defaults to `20`. Once exhausted it will not re-engage until
 *   the player has left `pursuitRadiusMeters` at least once — the same edge-trigger/re-arm shape
 *   `noticeRadiusMeters` already uses — so a player who stands their ground gets harried and then
 *   left alone, instead of being followed across the map indefinitely.
 * @param {number} [options.cruiseAltitudeAboveGroundMeters] The dragon's cruise height *above the
 *   terrain under its circle center*, used while pursuing so a chase up a mountainside climbs with
 *   it instead of flying into the slope. Omit to keep the fixed `centerY` at all times (exact
 *   pre-run-66 behavior). `spawnConfiguredDragons` passes each spawn's own `altitudeMeters` — the
 *   same number `centerY` was resolved from at spawn — so the two agree by construction at home.
 * @param {number} [options.agitatedWingFlapMultiplier] Run 70 (ADR-0089) wing-flap telegraph: the
 *   `Fly` clip's `AnimationAction.timeScale` is driven every frame by `agitationBlend` — the
 *   strongest of `reactiveBlend`/`diveBlend`/`pursuitBlend` this frame (a dragon that is both
 *   diving and pursuing flaps at the single fastest rate either implies, not a compounded one) —
 *   eased linearly from `1` (calm) up to this value (fully agitated), the same blend-driven-not
 *   -snapped shape every other reaction in this module already uses. Defaults to `1.5`: fast enough
 *   to read as a distinct "wings work harder" cue at a glance, not so fast the clip visibly
 *   stutters. Exposed on `object3D.userData.wingFlapTimeScale` each frame (no other public API
 *   change) so regression tests can assert it without reaching into the `AnimationMixer` internals.
 * @returns {Promise<{object3D: THREE.Object3D, update: (delta: number, playerPosition?: {x: number, y: number, z: number}) => void, dispose: () => void}>}
 */
export async function createDragon({
	assetLoader,
	modelUrl,
	texturesResourcePath,
	scale,
	flyClipName,
	centerX,
	centerZ,
	centerY,
	circleRadiusMeters,
	speedMps,
	bankAngleRadians = 0,
	startAngleRadians = 0,
	name,
	noticeRadiusMeters,
	eventsBus,
	eventName,
	noticeToast,
	reactiveSpeedMultiplier = 1,
	reactiveBankAngleRadians = bankAngleRadians,
	reactiveTransitionSeconds = 1.5,
	alarmRadiusMeters,
	sampleGroundY,
	diveDropMeters = 25,
	diveLateralPullFraction = 0.35,
	diveTransitionSeconds = 1,
	minAltitudeAboveGroundMeters = 10,
	pursuitRadiusMeters,
	pursuitCenterSpeedMps = 10,
	pursuitCircleRadiusMeters = circleRadiusMeters,
	pursuitTransitionSeconds = 2,
	pursuitMaxSeconds = 20,
	cruiseAltitudeAboveGroundMeters,
	agitatedWingFlapMultiplier = 1.5,
}) {
	const clampedDiveLateralPullFraction = Math.min(1, Math.max(0, diveLateralPullFraction));
	const model = await assetLoader.loadFBXModel(modelUrl, {
		fallbackColor: 0x2a2a2a,
		fallbackSize: 6,
		resourcePath: texturesResourcePath,
	});
	model.scale.setScalar(scale);
	if (name) model.name = name;

	const mixer = new THREE.AnimationMixer(model);
	const flyClip = THREE.AnimationClip.findByName(model.animations, flyClipName);
	const flyAction = flyClip ? mixer.clipAction(flyClip) : null;
	if (flyAction) flyAction.play();

	// Tangential speed is the tuned constant (see DRAGON_CONFIG's own speed/radius comment for the
	// resulting ~0.08 rad/s at the default spawn's 150m radius); angular speed is derived from it
	// against the circle's *current* radius each frame. With no pursuit configured the radius never
	// changes, so this is arithmetically identical to the fixed `speedMps / circleRadiusMeters`
	// run 53 used — it only starts to matter once run 66's pursuit tightens the circle, where
	// holding tangential (not angular) speed constant is what stops a closing dragon from appearing
	// to slow down as its ring shrinks.
	const calmAngularSpeedFor = (radiusMeters) => speedMps / radiusMeters;
	const reactiveAngularSpeedFor = (radiusMeters) => (speedMps * reactiveSpeedMultiplier) / radiusMeters;
	let angle = startAngleRadians;

	// Run 66 (ADR-0085) pursuit: the circle's center is no longer fixed at the spawn seat. These
	// track where it actually is right now; `centerX`/`centerZ`/`centerY` stay the immutable "home"
	// values the center travels back to on disengage.
	let currentCenterX = centerX;
	let currentCenterZ = centerZ;
	let currentCenterY = centerY;

	// Run 58 (ADR-0077) reactive flight: 0 = calm baseline, 1 = fully reactive (faster + harder
	// bank). Eased linearly toward its target each frame rather than snapped, so the reaction reads
	// as the dragon actually responding, not teleporting between two fixed states. Starts at 0 (calm)
	// — same "never assumed" convention `playerWasInNoticeRadius` below already follows.
	let reactiveBlend = 0;
	// Run 64 (ADR-0082) dive: 0 = on-circle, 1 = fully at the (terrain-clamped) dive target. Same
	// starts-at-0, eased-not-snapped shape as `reactiveBlend` above.
	let diveBlend = 0;
	// Run 66 (ADR-0085) pursuit: 0 = home-shaped circle (calm radius/altitude), 1 = fully engaged
	// (tightened radius, terrain-following cruise altitude). Same starts-at-0, eased-not-snapped
	// shape as the two blends above. The circle *center*'s travel is deliberately not driven by this
	// — it moves at a bounded speed instead, see `pursuitCenterSpeedMps`'s doc comment.
	let pursuitBlend = 0;
	let pursuitElapsedSeconds = 0;
	// Set once an engagement burns through `pursuitMaxSeconds`; blocks re-engaging until the player
	// leaves `pursuitRadiusMeters`, the same edge-trigger/re-arm shape `playerWasInNoticeRadius`
	// below already uses for the notice event.
	let pursuitExhausted = false;

	/** Places `model` at the current `angle` on its circle and orients it along the direction of travel. */
	function applyPose(currentBankAngleRadians, radiusMeters) {
		const x = currentCenterX + radiusMeters * Math.sin(angle);
		const z = currentCenterZ + radiusMeters * Math.cos(angle);
		model.position.set(x, currentCenterY, z);
		// Tangent direction of a circle parameterized by (sin, cos) is (cos, -sin) — the same
		// atan2(dx, dz) yaw convention every other gameplay system here already uses (see
		// `gameplay/animals.js`'s `turnToward`), just derived analytically instead of from a
		// per-frame position delta since the path itself is a closed-form circle.
		const tangentX = Math.cos(angle);
		const tangentZ = -Math.sin(angle);
		model.rotation.set(0, Math.atan2(tangentX, tangentZ), currentBankAngleRadians);
	}
	applyPose(bankAngleRadians, circleRadiusMeters);

	const canNotice = Boolean(noticeRadiusMeters != null && eventsBus && eventName && noticeToast);
	const canDive = Boolean(alarmRadiusMeters != null && typeof sampleGroundY === 'function');
	const canPursue = Boolean(pursuitRadiusMeters != null && typeof sampleGroundY === 'function');
	// Starts false: the very first `update()` call (typically seconds after boot) does its own
	// real distance check before deciding whether the player already started inside the radius —
	// never assumed true/false up front.
	let playerWasInNoticeRadius = false;

	return {
		object3D: model,

		/**
		 * @param {number} delta Seconds since the last frame.
		 * @param {{x: number, y: number, z: number}} [playerPosition] Current player world position —
		 *   only read when this dragon has player-awareness configured (`noticeRadiusMeters`).
		 */
		update(delta, playerPosition) {
			// Distance check (and the notice edge-trigger it already drove) now runs first, against
			// the dragon's position as of the end of the previous frame — same real distance the
			// original run-54 check used, just also reused below to pick this frame's reactive blend
			// target (and, run 64, the dive-alarm target) instead of only firing the one-shot notice
			// event.
			let distanceToPlayer = null;
			if (playerPosition && (canNotice || canDive || canPursue)) {
				const dx = model.position.x - playerPosition.x;
				const dy = model.position.y - playerPosition.y;
				const dz = model.position.z - playerPosition.z;
				distanceToPlayer = Math.hypot(dx, dy, dz);
			}

			let isInRadius = false;
			if (canNotice && distanceToPlayer != null) {
				isInRadius = distanceToPlayer < noticeRadiusMeters;
				if (isInRadius && !playerWasInNoticeRadius) {
					eventsBus.emit(eventName, noticeToast);
				}
				playerWasInNoticeRadius = isInRadius;
			}

			// Run 58 (ADR-0077): ease `reactiveBlend` linearly toward 1 (in radius) or 0 (not) over
			// `reactiveTransitionSeconds`, then use it to blend both the angular speed and the bank
			// angle between their calm and reactive values for this frame's move.
			const blendTarget = isInRadius ? 1 : 0;
			if (reactiveTransitionSeconds > 0) {
				const blendStep = delta / reactiveTransitionSeconds;
				if (reactiveBlend < blendTarget) reactiveBlend = Math.min(blendTarget, reactiveBlend + blendStep);
				else if (reactiveBlend > blendTarget) reactiveBlend = Math.max(blendTarget, reactiveBlend - blendStep);
			} else {
				reactiveBlend = blendTarget;
			}
			// Run 66 (ADR-0085) pursuit engagement. `isEngaged` gates both the center's travel target
			// and the radius/altitude blend below. Exhaustion re-arms only on the player actually
			// leaving the radius, so a stationary player can't be chased forever.
			let isEngaged = false;
			if (canPursue && distanceToPlayer != null) {
				const isInPursuitRadius = distanceToPlayer < pursuitRadiusMeters;
				if (!isInPursuitRadius) {
					pursuitExhausted = false; // left the radius — re-arm for a future engagement.
					pursuitElapsedSeconds = 0;
				} else if (!pursuitExhausted) {
					pursuitElapsedSeconds += delta;
					if (pursuitElapsedSeconds >= pursuitMaxSeconds) pursuitExhausted = true;
					else isEngaged = true;
				}
			}

			// The circle center travels at a bounded speed toward the player while engaged, and back
			// toward its immutable home center otherwise. Speed-limited rather than blended so a
			// sprinting player really does open a gap the dragon has to close (see
			// `pursuitCenterSpeedMps`'s doc comment for why a lerp would teleport the circle instead).
			if (canPursue) {
				const targetCenterX = isEngaged && playerPosition ? playerPosition.x : centerX;
				const targetCenterZ = isEngaged && playerPosition ? playerPosition.z : centerZ;
				const toTargetX = targetCenterX - currentCenterX;
				const toTargetZ = targetCenterZ - currentCenterZ;
				const distanceToTarget = Math.hypot(toTargetX, toTargetZ);
				const maxStep = pursuitCenterSpeedMps * delta;
				if (distanceToTarget > maxStep && distanceToTarget > 0) {
					currentCenterX += (toTargetX / distanceToTarget) * maxStep;
					currentCenterZ += (toTargetZ / distanceToTarget) * maxStep;
				} else {
					// Close enough to land exactly on the target this frame — snapping here (rather
					// than overshooting by the leftover step) is what makes "fully returned home"
					// an exact equality again, not an asymptote that never quite arrives.
					currentCenterX = targetCenterX;
					currentCenterZ = targetCenterZ;
				}
			}

			// Radius/altitude ease into and out of the engaged shape.
			const pursuitBlendTarget = isEngaged ? 1 : 0;
			if (pursuitTransitionSeconds > 0) {
				const pursuitStep = delta / pursuitTransitionSeconds;
				if (pursuitBlend < pursuitBlendTarget) pursuitBlend = Math.min(pursuitBlendTarget, pursuitBlend + pursuitStep);
				else if (pursuitBlend > pursuitBlendTarget) pursuitBlend = Math.max(pursuitBlendTarget, pursuitBlend - pursuitStep);
			} else {
				pursuitBlend = pursuitBlendTarget;
			}
			const currentCircleRadiusMeters = circleRadiusMeters +
				(pursuitCircleRadiusMeters - circleRadiusMeters) * pursuitBlend;
			// While pursuing, cruise altitude follows the terrain under the *moving* center rather
			// than staying pinned to the home seat's own ground height — otherwise a chase up a
			// mountainside would fly straight into the slope (the final safety clamp below would
			// still catch it, but as an emergency floor, not as flight that reads as deliberate).
			if (canPursue && cruiseAltitudeAboveGroundMeters != null) {
				const terrainFollowingCenterY = sampleGroundY(currentCenterX, currentCenterZ) + cruiseAltitudeAboveGroundMeters;
				currentCenterY = centerY + (terrainFollowingCenterY - centerY) * pursuitBlend;
			}

			const calmAngular = calmAngularSpeedFor(currentCircleRadiusMeters);
			const reactiveAngular = reactiveAngularSpeedFor(currentCircleRadiusMeters);
			const angularSpeedRadiansPerSecond = calmAngular + (reactiveAngular - calmAngular) * reactiveBlend;
			const currentBankAngleRadians = bankAngleRadians + (reactiveBankAngleRadians - bankAngleRadians) * reactiveBlend;

			angle += angularSpeedRadiansPerSecond * delta;
			applyPose(currentBankAngleRadians, currentCircleRadiusMeters); // pure on-circle pose — the
			// dive below blends *away* from this, never replaces the underlying path, so easing back
			// to diveBlend 0 always lands exactly here again.

			// Run 64 (ADR-0082): brief dive off the circle when the player is much closer than
			// `noticeRadiusMeters` (inside the smaller `alarmRadiusMeters`), easing back the same way
			// once they retreat — a linear ease-toward-a-target, same shape as `reactiveBlend` above,
			// just blending *position* instead of speed/bank.
			const isAlarmed = canDive && distanceToPlayer != null && distanceToPlayer < alarmRadiusMeters;
			const diveBlendTarget = isAlarmed ? 1 : 0;
			if (diveTransitionSeconds > 0) {
				const diveStep = delta / diveTransitionSeconds;
				if (diveBlend < diveBlendTarget) diveBlend = Math.min(diveBlendTarget, diveBlend + diveStep);
				else if (diveBlend > diveBlendTarget) diveBlend = Math.max(diveBlendTarget, diveBlend - diveStep);
			} else {
				diveBlend = diveBlendTarget;
			}
			if (diveBlend > 0 && playerPosition) {
				const circleX = model.position.x;
				const circleZ = model.position.z;
				// Pulled only partway toward the player's horizontal position, not all the way onto
				// it — a swoop toward them, not a teleport to stand on top of them.
				const diveTargetX = circleX + (playerPosition.x - circleX) * clampedDiveLateralPullFraction;
				const diveTargetZ = circleZ + (playerPosition.z - circleZ) * clampedDiveLateralPullFraction;
				const diveTargetY = currentCenterY - diveDropMeters;
				const blendedX = circleX + (diveTargetX - circleX) * diveBlend;
				const blendedZ = circleZ + (diveTargetZ - circleZ) * diveBlend;
				const blendedY = currentCenterY + (diveTargetY - currentCenterY) * diveBlend;
				model.position.set(blendedX, blendedY, blendedZ);
			}

			// Terrain-collision safety floor: never let the dragon end a frame below the real ground
			// under its *final* (x, z), plus a clearance margin. Re-sampled every frame (the position
			// moves every frame), and applied to the finished position rather than inside the dive
			// branch as run 64 originally had it — since run 66 the ordinary circling pose flies over
			// arbitrary terrain too (the center travels), so clamping only the dive would leave the
			// far more common case unguarded. Unchanged for any dragon with no `sampleGroundY`.
			if (typeof sampleGroundY === 'function') {
				const groundY = sampleGroundY(model.position.x, model.position.z);
				const minY = groundY + minAltitudeAboveGroundMeters;
				if (model.position.y < minY) model.position.y = minY;
			}

			// Run 70 (ADR-0089) wing-flap telegraph: reuses the three blends already computed above
			// this frame (reactive/dive/pursuit) rather than adding a new trigger — whichever reaction
			// is currently strongest sets how hard the wings flap, so a dragon that is merely reactive
			// (sped-up circling, no dive/pursuit) still gets a visible cue, and one that is diving or
			// pursuing doesn't flap faster than either alone implies.
			const agitationBlend = Math.max(reactiveBlend, diveBlend, pursuitBlend);
			const wingFlapTimeScale = 1 + (agitatedWingFlapMultiplier - 1) * agitationBlend;
			if (flyAction) flyAction.timeScale = wingFlapTimeScale;
			model.userData.wingFlapTimeScale = wingFlapTimeScale;

			mixer.update(delta);
		},

		/** Stops all animation actions and releases the model's GPU resources. */
		dispose() {
			mixer.stopAllAction();
			AssetLoader.disposeObject3D(model);
		},
	};
}

/**
 * Resolves and loads every configured dragon spawn (`gameplayConfig.js`'s `DRAGON_CONFIG.SPAWNS`)
 * against a kingdom-seat lookup, in parallel — same shape as `gameplay/animals.js`'s
 * `spawnConfiguredAnimals` / `gameplay/npc.js`'s `spawnConfiguredNPCs`, keeping `game3d.js` a thin
 * orchestrator. A spawn referencing an unknown `seatId` is skipped with a console warning, not
 * thrown, matching both of those modules' existing behavior.
 * @param {object} options
 * @param {import('../assetLoader.js').AssetLoader} options.assetLoader
 * @param {typeof import('./gameplayConfig.js').DRAGON_CONFIG} options.dragonConfig
 * @param {Map<string, {id: string, x: number, z: number}>} options.seatsById
 * @param {(worldX: number, worldZ: number) => number} options.sampleGroundY
 * @param {import('../eventBus.js').EventBus} [options.eventsBus] Player-awareness (ADR-0072) — see
 *   `createDragon`'s own doc comment. Omit to spawn every configured dragon with awareness disabled.
 * @param {string} [options.eventName] `EVENTS.WORLD_EVENT_TRIGGERED`.
 * @returns {Promise<Awaited<ReturnType<typeof createDragon>>[]>} Already filtered — no `null` entries.
 *   Each spawn's own `reactiveSpeedMultiplier`/`reactiveBankAngleRadians`/`reactiveTransitionSeconds`
 *   (run 58, ADR-0077) and `alarmRadiusMeters`/`diveDropMeters`/`diveLateralPullFraction`/
 *   `diveTransitionSeconds`/`minAltitudeAboveGroundMeters` (run 64, ADR-0082) and
 *   `pursuitRadiusMeters`/`pursuitCenterSpeedMps`/`pursuitCircleRadiusMeters`/
 *   `pursuitTransitionSeconds`/`pursuitMaxSeconds` (run 66, ADR-0085) and
 *   `agitatedWingFlapMultiplier` (run 70, ADR-0089) are passed straight
 *   through to `createDragon` — omitted per-spawn fields fall back to `createDragon`'s own no-op
 *   defaults (calm flight, unaffected by the player). `sampleGroundY` itself is always passed
 *   through too (run 64), needed for the dive's and the traveling circle's terrain-safety clamp.
 */
export async function spawnConfiguredDragons({ assetLoader, dragonConfig, seatsById, sampleGroundY, eventsBus, eventName }) {
	const dragons = await Promise.all(
		dragonConfig.SPAWNS.map(async (spawn) => {
			const seat = seatsById.get(spawn.seatId);
			if (!seat) {
				console.warn(`[gameplay/dragons] Dragon spawn "${spawn.id}" references unknown seat "${spawn.seatId}" — skipping.`);
				return null;
			}
			return createDragon({
				assetLoader,
				modelUrl: dragonConfig.MODEL_URL,
				texturesResourcePath: dragonConfig.TEXTURES_RESOURCE_PATH,
				scale: dragonConfig.SCALE,
				flyClipName: dragonConfig.FLY_CLIP_NAME,
				centerX: seat.x,
				centerZ: seat.z,
				centerY: sampleGroundY(seat.x, seat.z) + spawn.altitudeMeters,
				circleRadiusMeters: spawn.circleRadiusMeters,
				speedMps: spawn.speedMps,
				bankAngleRadians: spawn.bankAngleRadians,
				name: spawn.id,
				noticeRadiusMeters: spawn.noticeRadiusMeters,
				eventsBus,
				eventName,
				noticeToast: spawn.noticeToast,
				reactiveSpeedMultiplier: spawn.reactiveSpeedMultiplier,
				reactiveBankAngleRadians: spawn.reactiveBankAngleRadians,
				reactiveTransitionSeconds: spawn.reactiveTransitionSeconds,
				alarmRadiusMeters: spawn.alarmRadiusMeters,
				sampleGroundY,
				diveDropMeters: spawn.diveDropMeters,
				diveLateralPullFraction: spawn.diveLateralPullFraction,
				diveTransitionSeconds: spawn.diveTransitionSeconds,
				minAltitudeAboveGroundMeters: spawn.minAltitudeAboveGroundMeters,
				pursuitRadiusMeters: spawn.pursuitRadiusMeters,
				pursuitCenterSpeedMps: spawn.pursuitCenterSpeedMps,
				pursuitCircleRadiusMeters: spawn.pursuitCircleRadiusMeters,
				pursuitTransitionSeconds: spawn.pursuitTransitionSeconds,
				pursuitMaxSeconds: spawn.pursuitMaxSeconds,
				// The same number `centerY` above was resolved from — passed separately so the
				// traveling circle can re-derive its cruise altitude over new terrain (run 66).
				cruiseAltitudeAboveGroundMeters: spawn.altitudeMeters,
				agitatedWingFlapMultiplier: spawn.agitatedWingFlapMultiplier,
			});
		}),
	);
	return dragons.filter(Boolean);
}
