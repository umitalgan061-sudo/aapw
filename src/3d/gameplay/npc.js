/**
 * NPCs (FAZ 5): reuses `gameplay/player.js`'s FBX-loading and Mixamo-scale-correction pattern for a
 * non-player character. Two modes, both driven by the same `update`/`dispose` shape as
 * `gameplay/player.js`'s `createPlayer`:
 *  - **Static** (no `patrolWaypoints` passed, the default — run 20): stands at a fixed world
 *    position, plays a looping idle animation. No AI, pathing, or interaction.
 *  - **Patrolling** (`patrolWaypoints` passed — run 22, pilot on 2 of 6 NPCs): walks a straight
 *    line between 2+ world-space points in order (wrapping via modulo, so 2 points ping-pong and
 *    3+ points loop), pausing to idle at each one, reusing `player.js`'s per-frame ground-height
 *    resampling and shortest-path yaw-turn pattern. No pathfinding/collision avoidance — a straight
 *    line between caller-supplied points, same "don't build a full behavior tree in one run" scope
 *    `3D_GAME_PROGRESS.md`'s FAZ 5 roadmap and DECISIONS.md ADR-0019/ADR-0021 call for.
 * @module gameplay/npc
 */

import * as THREE from 'three';
import { AssetLoader } from '../assetLoader.js';

/**
 * Loads one NPC's model (+ idle, and optionally walk, clips), places it, and returns a small
 * controller object.
 * @param {object} options
 * @param {import('../assetLoader.js').AssetLoader} options.assetLoader
 * @param {string} options.modelUrl Mixamo T-pose character FBX (must share `peasant_girl`'s skeleton).
 * @param {string} options.idleAnimationUrl Skin-less idle clip FBX (retargets onto any shared-skeleton model).
 * @param {number} options.worldX World-space spawn X, in meters.
 * @param {number} options.worldZ World-space spawn Z, in meters.
 * @param {number} options.groundY World-space Y the NPC's feet rest at — caller-sampled via the
 *   same `physics.js` ground collider (+ sea-level clamp) every other placement system uses.
 * @param {number} [options.rotationYRadians]
 * @param {string} [options.name] Assigned to the loaded `Object3D` (useful for debugging/tests).
 * @param {{getGroundHeight: (x: number, z: number) => number}} [options.groundCollider] Required
 *   only when `patrolWaypoints` is passed — resamples ground height every frame while walking, same
 *   as `player.js`'s own movement.
 * @param {string} [options.walkAnimationUrl] Skin-less walk clip; required only for patrolling NPCs.
 * @param {{x: number, z: number}[]} [options.patrolWaypoints] World-space points to walk between, in
 *   order (index wraps via modulo — 2 points ping-pong, 3+ loop). Omit for a static, idle-only NPC.
 * @param {number} [options.speedMps]
 * @param {number} [options.pauseSeconds] Idle dwell time at each waypoint before moving to the next.
 * @param {number} [options.turnRateRadiansPerSecond]
 * @returns {Promise<{object3D: THREE.Object3D, update: (delta: number) => void, dispose: () => void}>}
 */
export async function createNPC({
	assetLoader,
	modelUrl,
	idleAnimationUrl,
	worldX,
	worldZ,
	groundY,
	rotationYRadians = 0,
	name,
	groundCollider,
	walkAnimationUrl,
	patrolWaypoints,
	speedMps = 1.4,
	pauseSeconds = 3,
	turnRateRadiansPerSecond = 4,
}) {
	const model = await assetLoader.loadFBXModel(modelUrl, { fallbackColor: 0x9c6b30, fallbackSize: 1.8 });
	AssetLoader.correctMixamoFbxScale(model);
	if (name) model.name = name;
	model.position.set(worldX, groundY, worldZ);
	model.rotation.y = rotationYRadians;

	const mixer = new THREE.AnimationMixer(model);
	const idleSource = await assetLoader.loadFBXModel(idleAnimationUrl);
	const idleAction = idleSource.animations[0] ? mixer.clipAction(idleSource.animations[0]) : null;

	const isPatrolling = Boolean(patrolWaypoints && patrolWaypoints.length > 0 && groundCollider && walkAnimationUrl);
	let walkAction = null;
	if (isPatrolling) {
		const walkSource = await assetLoader.loadFBXModel(walkAnimationUrl);
		if (walkSource.animations[0]) walkAction = mixer.clipAction(walkSource.animations[0]);
	}

	let currentAction = null;
	/** Crossfades to `action`; a no-op if it's already playing or doesn't exist. */
	function playAction(action) {
		if (currentAction === action || !action) return;
		action.reset().fadeIn(0.25).play();
		if (currentAction) currentAction.fadeOut(0.25);
		currentAction = action;
	}
	playAction(idleAction);

	// Patrol state — unused (and never advanced) when isPatrolling is false.
	let waypointIndex = 0;
	let pauseTimer = isPatrolling ? pauseSeconds : 0;

	return {
		object3D: model,

		/** @param {number} delta Seconds since the last frame. */
		update(delta) {
			if (isPatrolling) {
				if (pauseTimer > 0) {
					pauseTimer -= delta;
					playAction(idleAction);
				} else {
					const target = patrolWaypoints[waypointIndex % patrolWaypoints.length];
					const dx = target.x - model.position.x;
					const dz = target.z - model.position.z;
					const distance = Math.hypot(dx, dz);
					const step = speedMps * delta;

					if (distance <= step) {
						model.position.x = target.x;
						model.position.z = target.z;
						model.position.y = groundCollider.getGroundHeight(target.x, target.z);
						waypointIndex += 1;
						pauseTimer = pauseSeconds;
						playAction(idleAction);
					} else {
						model.position.x += (dx / distance) * step;
						model.position.z += (dz / distance) * step;
						model.position.y = groundCollider.getGroundHeight(model.position.x, model.position.z);

						const targetYaw = Math.atan2(dx, dz);
						const turnStep = turnRateRadiansPerSecond * delta;
						model.rotation.y = THREE.MathUtils.lerp(
							model.rotation.y,
							model.rotation.y + THREE.MathUtils.euclideanModulo(targetYaw - model.rotation.y + Math.PI, Math.PI * 2) - Math.PI,
							Math.min(1, turnStep),
						);
						playAction(walkAction);
					}
				}
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
