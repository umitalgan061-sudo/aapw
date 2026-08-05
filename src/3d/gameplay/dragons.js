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
 * `game3d.js` wires this in the same spawn-then-per-frame-update shape every other gameplay system
 * already uses, wrapped in a try/catch (GOVERNANCE.md §8.13 safe mode) since run 64 also touches
 * that call site.
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
 * @param {number} [options.minAltitudeAboveGroundMeters] Terrain-safety floor: the dive's blended
 *   altitude is never allowed to end up below `sampleGroundY(x, z) + minAltitudeAboveGroundMeters`
 *   for the dragon's *actual* (post-blend) (x, z) that frame. Defaults to `10`.
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

	// Angular speed, not linear — constant so a shorter/longer radius never changes how fast the
	// dragon completes one lap in the same tuned "majestic patrol" feel (see DRAGON_CONFIG's own
	// speed/radius comment for the resulting ~0.08 rad/s at the default spawn).
	const calmAngularSpeedRadiansPerSecond = speedMps / circleRadiusMeters;
	const reactiveAngularSpeedRadiansPerSecond = (speedMps * reactiveSpeedMultiplier) / circleRadiusMeters;
	let angle = startAngleRadians;

	// Run 58 (ADR-0077) reactive flight: 0 = calm baseline, 1 = fully reactive (faster + harder
	// bank). Eased linearly toward its target each frame rather than snapped, so the reaction reads
	// as the dragon actually responding, not teleporting between two fixed states. Starts at 0 (calm)
	// — same "never assumed" convention `playerWasInNoticeRadius` below already follows.
	let reactiveBlend = 0;
	// Run 64 (ADR-0082) dive: 0 = on-circle, 1 = fully at the (terrain-clamped) dive target. Same
	// starts-at-0, eased-not-snapped shape as `reactiveBlend` above.
	let diveBlend = 0;

	/** Places `model` at the current `angle` on its circle and orients it along the direction of travel. */
	function applyPose(currentBankAngleRadians) {
		const x = centerX + circleRadiusMeters * Math.sin(angle);
		const z = centerZ + circleRadiusMeters * Math.cos(angle);
		model.position.set(x, centerY, z);
		// Tangent direction of a circle parameterized by (sin, cos) is (cos, -sin) — the same
		// atan2(dx, dz) yaw convention every other gameplay system here already uses (see
		// `gameplay/animals.js`'s `turnToward`), just derived analytically instead of from a
		// per-frame position delta since the path itself is a closed-form circle.
		const tangentX = Math.cos(angle);
		const tangentZ = -Math.sin(angle);
		model.rotation.set(0, Math.atan2(tangentX, tangentZ), currentBankAngleRadians);
	}
	applyPose(bankAngleRadians);

	const canNotice = Boolean(noticeRadiusMeters != null && eventsBus && eventName && noticeToast);
	const canDive = Boolean(alarmRadiusMeters != null && typeof sampleGroundY === 'function');
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
			if (playerPosition && (canNotice || canDive)) {
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
			const angularSpeedRadiansPerSecond = calmAngularSpeedRadiansPerSecond +
				(reactiveAngularSpeedRadiansPerSecond - calmAngularSpeedRadiansPerSecond) * reactiveBlend;
			const currentBankAngleRadians = bankAngleRadians + (reactiveBankAngleRadians - bankAngleRadians) * reactiveBlend;

			angle += angularSpeedRadiansPerSecond * delta;
			applyPose(currentBankAngleRadians); // pure on-circle pose — the dive below blends *away*
			// from this, never replaces the underlying path, so easing back to diveBlend 0 always
			// lands exactly here again.

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
				const diveTargetY = centerY - diveDropMeters;
				const blendedX = circleX + (diveTargetX - circleX) * diveBlend;
				const blendedZ = circleZ + (diveTargetZ - circleZ) * diveBlend;
				const blendedY = centerY + (diveTargetY - centerY) * diveBlend;
				// Terrain-collision safety floor: never let the dive put the dragon below the real
				// ground under its *new* (x, z), plus a clearance margin. Re-sampled every frame (the
				// position moves every frame while diving), not just once at the dive's start.
				const groundY = sampleGroundY(blendedX, blendedZ);
				const safeY = Math.max(blendedY, groundY + minAltitudeAboveGroundMeters);
				model.position.set(blendedX, safeY, blendedZ);
			}

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
 *   `diveTransitionSeconds`/`minAltitudeAboveGroundMeters` (run 64, ADR-0082) are passed straight
 *   through to `createDragon` — omitted per-spawn fields fall back to `createDragon`'s own no-op
 *   defaults (calm flight, unaffected by the player). `sampleGroundY` itself is always passed
 *   through too (run 64), needed for the dive's own terrain-safety clamp.
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
			});
		}),
	);
	return dragons.filter(Boolean);
}
