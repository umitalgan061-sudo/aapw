/**
 * Wild animals (FAZ 6). First pass (run 26) was static/idling only, the same starting scope
 * `gameplay/npc.js` itself had in run 20. Run 27 added optional waypoint patrol (a straight line
 * between 2+ world-space points, reusing `npc.js`'s already-proven `patrolWaypoints` shape/behavior
 * — see DECISIONS.md ADR-0026). Run 28 adds player-awareness: a wolf within `fleeTriggerRadiusMeters`
 * of the player overrides its idle/patrol state and runs directly away instead (see DECISIONS.md
 * ADR-0027) — still no real pathfinding/obstacle-avoidance, just a straight-line flee vector. Run 29
 * adds a first pack/herd reaction (`packAlertRadiusMeters` — see DECISIONS.md ADR-0029): a wolf not
 * yet close enough to the player still flees if a packmate within that radius is already fleeing.
 * Run 29 also moves `game3d.js`'s inline spawn-resolution loop into this module's
 * `spawnConfiguredAnimals` (DECISIONS.md ADR-0028), so `game3d.js` stays under the project's 600-line
 * cap and this folder owns its own spawn wiring, same as `npc.js`'s `spawnConfiguredNPCs`.
 * @module gameplay/animals
 */

import * as THREE from 'three';
import { AssetLoader } from '../assetLoader.js';

const MAX_WILDLIFE_SIMULATION_STEP_SECONDS = 0.1;
const DEFAULT_FLEE_RELEASE_MARGIN_METERS = 3;

function boundedWildlifeDelta(delta) {
	if (!Number.isFinite(delta) || delta <= 0) return 0;
	return Math.min(delta, MAX_WILDLIFE_SIMULATION_STEP_SECONDS);
}

/**
 * Removes any direct child of `object3D` whose name is in `names`, disposing its GPU resources.
 * Used to strip the wolf glTF's bundled non-skinned "Circle" ground-shadow-catcher disc — see
 * `gameplay/gameplayConfig.js`'s `ANIMAL_CONFIG.STRIP_CHILD_NAMES` doc comment for why it exists in the source file.
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
 * @param {{getGroundHeight: (x: number, z: number) => number}} [options.groundCollider] Required for
 *   patrol and/or flee — resamples ground height every frame while moving, same as
 *   `gameplay/npc.js`'s own movement.
 * @param {{resolveXZ: (x: number, z: number) => {x: number, z: number}}} [options.playerCollider]
 *   Run 332's own follow-up to Run 331's own named gap: the same castle+village obstacle collider
 *   `sceneManager.js` builds for `gameplay/player.js` (see its own JSDoc), applied to both the
 *   patrol-walk and flee movement branches here so a wolf pushes back out of a house/keep instead of
 *   running through it. Optional — omit (the default) for any caller with no obstacle collider
 *   available (e.g. a unit test).
 * @param {string} [options.walkClipName] Exact `THREE.AnimationClip` name for the walk cycle;
 *   required only for patrolling animals.
 * @param {{x: number, z: number}[]} [options.patrolWaypoints] World-space points to walk between, in
 *   order (index wraps via modulo — 2 points ping-pong, 3+ loop). Omit for a static, idle-only animal.
 * @param {number} [options.speedMps] Patrol walk speed.
 * @param {number} [options.pauseSeconds] Idle dwell time at each waypoint before moving to the next.
 * @param {number} [options.turnRateRadiansPerSecond]
 * @param {string} [options.fleeClipName] Exact `THREE.AnimationClip` name for the flee/run cycle;
 *   required (along with `groundCollider` and a non-null `fleeTriggerRadiusMeters`) for flee to
 *   activate.
 * @param {number} [options.fleeTriggerRadiusMeters] A wolf within this distance of the
 *   `playerPosition` passed to `update()` overrides idle/patrol and runs directly away. `null`/
 *   `undefined` disables flee entirely (static/patrol-only animal).
 * @param {number} [options.fleeReleaseMarginMeters] Extra distance beyond the trigger radius that
 *   an already-fleeing wolf must clear before it may return to patrol. Prevents boundary jitter.
 * @param {number} [options.fleeSpeedMps]
 * @param {number} [options.packAlertRadiusMeters] A wolf not yet within `fleeTriggerRadiusMeters` of
 *   the player still flees if a packmate within this distance is already fleeing (`update()`'s
 *   `packmateFleePositions` argument) — see DECISIONS.md ADR-0029. `null`/`undefined` disables pack
 *   awareness (this wolf only ever flees from its own direct player-proximity check).
 * @returns {Promise<{object3D: THREE.Object3D, isFleeing: boolean, update: (delta: number, playerPosition?: {x: number, z: number}, packmateFleePositions?: {x: number, z: number}[]) => void, dispose: () => void}>}
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
	playerCollider = null,
	walkClipName,
	patrolWaypoints,
	speedMps = 2.2,
	pauseSeconds = 3,
	turnRateRadiansPerSecond = 4,
	fleeClipName,
	fleeTriggerRadiusMeters,
	fleeReleaseMarginMeters = DEFAULT_FLEE_RELEASE_MARGIN_METERS,
	fleeSpeedMps = 4.5,
	packAlertRadiusMeters,
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

	const canFlee = Boolean(groundCollider && fleeClipName && fleeTriggerRadiusMeters != null);
	const releaseMarginMeters = Number.isFinite(fleeReleaseMarginMeters)
		? Math.max(0, Math.min(12, fleeReleaseMarginMeters))
		: DEFAULT_FLEE_RELEASE_MARGIN_METERS;
	const fleeReleaseRadiusMeters = canFlee ? Math.max(0, fleeTriggerRadiusMeters) + releaseMarginMeters : 0;
	let fleeAction = null;
	if (canFlee) {
		const fleeClip = THREE.AnimationClip.findByName(model.animations, fleeClipName);
		if (fleeClip) fleeAction = mixer.clipAction(fleeClip);
	}

	let currentAction = null;
	function playAction(action) {
		if (currentAction === action || !action) return;
		action.reset().fadeIn(0.25).play();
		if (currentAction) currentAction.fadeOut(0.25);
		currentAction = action;
	}
	playAction(idleAction);

	function turnToward(targetYaw, delta) {
		const turnStep = turnRateRadiansPerSecond * delta;
		model.rotation.y = THREE.MathUtils.lerp(
			model.rotation.y,
			model.rotation.y + THREE.MathUtils.euclideanModulo(targetYaw - model.rotation.y + Math.PI, Math.PI * 2) - Math.PI,
			Math.min(1, turnStep),
		);
	}

	function tryCommitGroundedMove(candidateX, candidateZ) {
		let resolvedX = candidateX;
		let resolvedZ = candidateZ;
		if (playerCollider) {
			const resolved = playerCollider.resolveXZ(candidateX, candidateZ);
			if (!Number.isFinite(resolved?.x) || !Number.isFinite(resolved?.z)) return false;
			resolvedX = resolved.x;
			resolvedZ = resolved.z;
		}
		if (!Number.isFinite(resolvedX) || !Number.isFinite(resolvedZ)) return false;
		const resolvedY = groundCollider.getGroundHeight(resolvedX, resolvedZ);
		if (!Number.isFinite(resolvedY)) return false;
		model.position.set(resolvedX, resolvedY, resolvedZ);
		return true;
	}

	let waypointIndex = 0;
	let pauseTimer = 0;
	let currentlyFleeing = false;
	model.userData.wildlifeFlee = Object.freeze({ phase: isPatrolling ? 'patrol' : 'idle', direct: false, pack: false, recovering: false, distanceMeters: null, triggerRadiusMeters: fleeTriggerRadiusMeters ?? null, releaseRadiusMeters: canFlee ? fleeReleaseRadiusMeters : null });

	return {
		object3D: model,
		get isFleeing() {
			return currentlyFleeing;
		},
		update(delta, playerPosition, packmateFleePositions) {
			const simulationDelta = boundedWildlifeDelta(delta);
			const hasFinitePlayerPosition = Number.isFinite(playerPosition?.x) && Number.isFinite(playerPosition?.z);
			const dxFromPlayer = hasFinitePlayerPosition ? model.position.x - playerPosition.x : Infinity;
			const dzFromPlayer = hasFinitePlayerPosition ? model.position.z - playerPosition.z : Infinity;
			const distanceFromPlayer = Math.hypot(dxFromPlayer, dzFromPlayer);
			const directThreat = canFlee && distanceFromPlayer < fleeTriggerRadiusMeters;
			let isFleeingFromPack = false;
			let packThreatDx = 0;
			let packThreatDz = 0;
			let nearestPackThreatDistance = Infinity;
			let nearestPackThreatX = Infinity;
			let nearestPackThreatZ = Infinity;
			const hasPackmateIterable = packmateFleePositions != null
				&& typeof packmateFleePositions[Symbol.iterator] === 'function';
			if (canFlee && !directThreat && packAlertRadiusMeters != null && hasPackmateIterable) {
				for (const packmatePosition of packmateFleePositions) {
					if (!Number.isFinite(packmatePosition?.x) || !Number.isFinite(packmatePosition?.z)) continue;
					const dx = model.position.x - packmatePosition.x;
					const dz = model.position.z - packmatePosition.z;
					const distance = Math.hypot(dx, dz);
					const distanceDelta = distance - nearestPackThreatDistance;
					const isCloser = distanceDelta < -1e-9;
					const isStableTie = Math.abs(distanceDelta) <= 1e-9
						&& (packmatePosition.x < nearestPackThreatX
							|| (packmatePosition.x === nearestPackThreatX && packmatePosition.z < nearestPackThreatZ));
					if (distance < packAlertRadiusMeters && (isCloser || isStableTie)) {
						isFleeingFromPack = true;
						packThreatDx = dx;
						packThreatDz = dz;
						nearestPackThreatDistance = distance;
						nearestPackThreatX = packmatePosition.x;
						nearestPackThreatZ = packmatePosition.z;
					}
				}
			}
			const recovering = canFlee
				&& currentlyFleeing
				&& !directThreat
				&& !isFleeingFromPack
				&& hasFinitePlayerPosition
				&& distanceFromPlayer < fleeReleaseRadiusMeters;
			currentlyFleeing = directThreat || isFleeingFromPack || recovering;
			model.userData.wildlifeFlee = Object.freeze({
				phase: currentlyFleeing ? (directThreat ? 'flee' : isFleeingFromPack ? 'pack-flee' : 'recover') : (isPatrolling ? 'patrol' : 'idle'),
				direct: directThreat,
				pack: isFleeingFromPack,
				recovering,
				distanceMeters: hasFinitePlayerPosition ? Number(distanceFromPlayer.toFixed(3)) : null,
				triggerRadiusMeters: fleeTriggerRadiusMeters ?? null,
				releaseRadiusMeters: canFlee ? fleeReleaseRadiusMeters : null,
			});

			if (currentlyFleeing && simulationDelta > 0) {
				const separationDx = hasFinitePlayerPosition ? dxFromPlayer : packThreatDx;
				const separationDz = hasFinitePlayerPosition ? dzFromPlayer : packThreatDz;
				const separationDistance = hasFinitePlayerPosition ? distanceFromPlayer : nearestPackThreatDistance;
				const hasSeparationVector = Number.isFinite(separationDistance) && separationDistance > 1e-6;
				const dirX = hasSeparationVector ? separationDx / separationDistance : Math.sin(model.rotation.y);
				const dirZ = hasSeparationVector ? separationDz / separationDistance : Math.cos(model.rotation.y);
				const step = fleeSpeedMps * simulationDelta;
				const moved = tryCommitGroundedMove(model.position.x + dirX * step, model.position.z + dirZ * step);
				if (moved) {
					turnToward(Math.atan2(dirX, dirZ), simulationDelta);
					playAction(fleeAction ?? walkAction ?? idleAction);
				} else {
					playAction(idleAction);
				}
			} else if (isPatrolling && simulationDelta > 0) {
				if (pauseTimer > 0) {
					pauseTimer = Math.max(0, pauseTimer - simulationDelta);
					playAction(idleAction);
				} else {
					const target = patrolWaypoints[waypointIndex % patrolWaypoints.length];
					const dx = target.x - model.position.x;
					const dz = target.z - model.position.z;
					const distance = Math.hypot(dx, dz);
					const step = speedMps * simulationDelta;
					if (distance <= step) {
						if (tryCommitGroundedMove(target.x, target.z)) {
							waypointIndex += 1;
							pauseTimer = pauseSeconds;
						}
						playAction(idleAction);
					} else {
						const moved = tryCommitGroundedMove(
							model.position.x + (dx / distance) * step,
							model.position.z + (dz / distance) * step,
						);
						if (moved) {
							turnToward(Math.atan2(dx, dz), simulationDelta);
							playAction(walkAction);
						} else {
							playAction(idleAction);
						}
					}
				}
			}
			mixer.update(simulationDelta);
		},
		dispose() {
			mixer.stopAllAction();
			AssetLoader.disposeObject3D(model);
		},
	};
}

export async function spawnConfiguredAnimals({ assetLoader, animalConfig, seatsById, sampleGroundY, groundCollider, playerCollider }) {
	const animals = await Promise.all(
		animalConfig.SPAWNS.map(async (spawn) => {
			const seat = seatsById.get(spawn.seatId);
			if (!seat) {
				console.warn(`[gameplay/animals] Animal spawn "${spawn.id}" references unknown seat "${spawn.seatId}" — skipping.`);
				return null;
			}
			const worldX = seat.x + spawn.offsetXMeters;
			const worldZ = seat.z + spawn.offsetZMeters;
			const patrolWaypoints = spawn.patrol
				? [
						{ x: worldX, z: worldZ },
						{ x: seat.x + spawn.patrol.toOffsetXMeters, z: seat.z + spawn.patrol.toOffsetZMeters },
					]
				: undefined;
			const species = spawn.speciesId ? animalConfig.SPECIES?.[spawn.speciesId] : null;
			if (spawn.speciesId && !species) {
				console.warn(`[gameplay/animals] Animal spawn "${spawn.id}" references unknown species "${spawn.speciesId}" — skipping.`);
				return null;
			}
			const clips = species?.clips;
			const walkClipName = species ? clips?.walk : animalConfig.WALK_CLIP_NAME;
			const effectiveWaypoints = walkClipName ? patrolWaypoints : undefined;
			const fleeClipName = species ? clips?.flee : animalConfig.FLEE_CLIP_NAME;
			const canFlee = spawn.canFlee !== false && Boolean(fleeClipName);
			return createWolf({
				assetLoader,
				modelUrl: species?.modelUrl ?? spawn.modelUrl ?? animalConfig.WOLF_MODEL_URL,
				idleClipName: species ? clips?.idle : animalConfig.IDLE_CLIP_NAME,
				stripChildNames: species ? (species.stripChildNames ?? []) : animalConfig.STRIP_CHILD_NAMES,
				worldX,
				worldZ,
				groundY: sampleGroundY(worldX, worldZ),
				rotationYRadians: spawn.rotationYRadians,
				name: spawn.id,
				groundCollider,
				playerCollider,
				walkClipName: effectiveWaypoints ? walkClipName : undefined,
				patrolWaypoints: effectiveWaypoints,
				speedMps: animalConfig.PATROL_SPEED_MPS,
				pauseSeconds: animalConfig.PATROL_PAUSE_SECONDS,
				turnRateRadiansPerSecond: animalConfig.PATROL_TURN_RATE_RADIANS_PER_SECOND,
				fleeClipName: canFlee ? fleeClipName : undefined,
				fleeTriggerRadiusMeters: canFlee ? animalConfig.FLEE_TRIGGER_RADIUS_METERS : undefined,
				fleeSpeedMps: animalConfig.FLEE_SPEED_MPS,
				packAlertRadiusMeters: canFlee ? animalConfig.PACK_ALERT_RADIUS_METERS : undefined,
			});
		}),
	);
	return animals.filter(Boolean);
}