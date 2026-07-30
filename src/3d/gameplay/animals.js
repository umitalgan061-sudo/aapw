/**
 * Wild animals (FAZ 6). First pass (run 26) was static/idling only, the same starting scope
 * `gameplay/npc.js` itself had in run 20. This run adds optional waypoint patrol (a straight line
 * between 2+ world-space points, reusing `npc.js`'s already-proven `patrolWaypoints` shape/behavior
 * — see DECISIONS.md ADR-0026) — no pathfinding/obstacle-avoidance/player-awareness yet.
 * @module gameplay/animals
 */

import * as THREE from 'three';
import { AssetLoader } from '../assetLoader.js';

/**
 * Removes any direct child of `object3D` whose name is in `names`, disposing its GPU resources.
 * Used to strip the wolf glTF's bundled non-skinned "Circle" ground-shadow-catcher disc — see
 * `config.js`'s `ANIMAL_CONFIG.STRIP_CHILD_NAMES` doc comment for why it exists in the source file.
 * @param {THREE.Object3D} object3D
 * @param {string[]} names
 */
function stripNamedChildren(object3D, names) {
	for (const child of [...object3D.children]) {
		if (names.includes(child.name)) {
			object3D.remove(child);
			AssetLoader.disposeObject3D(child);
		}
	}
}

/**
 * Loads a wolf model (glTF/GLB, `AssetLoader.loadModel`), places it, and returns a small controller
 * object matching `gameplay/npc.js`'s `{object3D, update(delta), dispose()}` shape.
 * @param {object} options
 * @param {import('../assetLoader.js').AssetLoader} options.assetLoader
 * @param {string} options.modelUrl
 * @param {string} options.idleClipName Exact `THREE.AnimationClip` name to loop (see `ANIMAL_CONFIG`).
 * @param {string[]} [options.stripChildNames] Root-level child names to remove before use (e.g. a
 *   bundled non-skinned decoration mesh that isn't part of the animal itself).
 * @param {number} options.worldX
 * @param {number} options.worldZ
 * @param {number} options.groundY
 * @param {number} [options.rotationYRadians]
 * @param {string} [options.name] Assigned to the loaded `Object3D` (useful for debugging/tests).
 * @param {{getGroundHeight: (x: number, z: number) => number}} [options.groundCollider] Required
 *   only when `patrolWaypoints` is passed — resamples ground height every frame while walking, same
 *   as `gameplay/npc.js`'s own movement.
 * @param {string} [options.walkClipName] Exact `THREE.AnimationClip` name for the walk cycle;
 *   required only for patrolling animals.
 * @param {{x: number, z: number}[]} [options.patrolWaypoints] World-space points to walk between, in
 *   order (index wraps via modulo — 2 points ping-pong, 3+ loop). Omit for a static, idle-only animal.
 * @param {number} [options.speedMps]
 * @param {number} [options.pauseSeconds] Idle dwell time at each waypoint before moving to the next.
 * @param {number} [options.turnRateRadiansPerSecond]
 * @returns {Promise<{object3D: THREE.Object3D, update: (delta: number) => void, dispose: () => void}>}
 */
export async function createWolf({
	assetLoader,
	modelUrl,
	idleClipName,
	stripChildNames = [],
	worldX,
	worldZ,
	groundY,
	rotationYRadians = 0,
	name,
	groundCollider,
	walkClipName,
	patrolWaypoints,
	speedMps = 2.2,
	pauseSeconds = 3,
	turnRateRadiansPerSecond = 4,
}) {
	const model = await assetLoader.loadModel(modelUrl, { fallbackColor: 0x5a5148, fallbackSize: 1.2 });
	stripNamedChildren(model, stripChildNames);
	if (name) model.name = name;
	model.position.set(worldX, groundY, worldZ);
	model.rotation.y = rotationYRadians;

	const mixer = new THREE.AnimationMixer(model);
	const idleClip = THREE.AnimationClip.findByName(model.animations, idleClipName);
	const idleAction = idleClip ? mixer.clipAction(idleClip) : null;

	const isPatrolling = Boolean(patrolWaypoints && patrolWaypoints.length > 0 && groundCollider && walkClipName);
	let walkAction = null;
	if (isPatrolling) {
		const walkClip = THREE.AnimationClip.findByName(model.animations, walkClipName);
		if (walkClip) walkAction = mixer.clipAction(walkClip);
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
