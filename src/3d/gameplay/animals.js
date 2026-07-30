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
 * @param {{getGroundHeight: (x: number, z: number) => number}} [options.groundCollider] Required for
 *   patrol and/or flee — resamples ground height every frame while moving, same as
 *   `gameplay/npc.js`'s own movement.
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
	walkClipName,
	patrolWaypoints,
	speedMps = 2.2,
	pauseSeconds = 3,
	turnRateRadiansPerSecond = 4,
	fleeClipName,
	fleeTriggerRadiusMeters,
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
	let fleeAction = null;
	if (canFlee) {
		const fleeClip = THREE.AnimationClip.findByName(model.animations, fleeClipName);
		if (fleeClip) fleeAction = mixer.clipAction(fleeClip);
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

	/**
	 * Turns `model` toward `targetYaw` at `turnRateRadiansPerSecond`, shortest-path (never spins the
	 * long way around). Shared by both the patrol-walk and flee movement branches below.
	 * @param {number} targetYaw
	 * @param {number} delta
	 */
	function turnToward(targetYaw, delta) {
		const turnStep = turnRateRadiansPerSecond * delta;
		model.rotation.y = THREE.MathUtils.lerp(
			model.rotation.y,
			model.rotation.y + THREE.MathUtils.euclideanModulo(targetYaw - model.rotation.y + Math.PI, Math.PI * 2) - Math.PI,
			Math.min(1, turnStep),
		);
	}

	// Patrol state — unused (and never advanced) when isPatrolling is false.
	let waypointIndex = 0;
	let pauseTimer = isPatrolling ? pauseSeconds : 0;
	// Read by this frame's other wolves (via the `isFleeing` getter below) to build their own
	// `packmateFleePositions` — see DECISIONS.md ADR-0029. Starts false; only `update()` writes it.
	let currentlyFleeing = false;

	return {
		object3D: model,

		/** Whether this wolf is currently fleeing (player-triggered or pack-alerted) — read by the
		 * caller to build other animals' `packmateFleePositions` for the next `update()` call. */
		get isFleeing() {
			return currentlyFleeing;
		},

		/**
		 * @param {number} delta Seconds since the last frame.
		 * @param {{x: number, z: number}} [playerPosition] Current player world position — only read
		 *   when this animal can flee (see `fleeTriggerRadiusMeters`).
		 * @param {{x: number, z: number}[]} [packmateFleePositions] World positions of other animals
		 *   already fleeing this frame — see `packAlertRadiusMeters`. Omit/empty for no pack reaction.
		 */
		update(delta, playerPosition, packmateFleePositions) {
			const dxFromPlayer = playerPosition ? model.position.x - playerPosition.x : Infinity;
			const dzFromPlayer = playerPosition ? model.position.z - playerPosition.z : Infinity;
			const distanceFromPlayer = Math.hypot(dxFromPlayer, dzFromPlayer);
			const isFleeingFromPlayer = canFlee && distanceFromPlayer < fleeTriggerRadiusMeters;

			// Pack awareness (run 29, DECISIONS.md ADR-0029): only checked when not already triggered
			// directly (cheap early-out) and only when playerPosition is known (the flee direction
			// below is always "away from the player," so a pack-alerted flee still needs it — see
			// this function's own JSDoc for why player-relative, not packmate-relative).
			let isFleeingFromPack = false;
			if (canFlee && !isFleeingFromPlayer && playerPosition && packAlertRadiusMeters != null && packmateFleePositions) {
				for (const packmatePosition of packmateFleePositions) {
					const dx = model.position.x - packmatePosition.x;
					const dz = model.position.z - packmatePosition.z;
					if (Math.hypot(dx, dz) < packAlertRadiusMeters) {
						isFleeingFromPack = true;
						break;
					}
				}
			}

			currentlyFleeing = isFleeingFromPlayer || isFleeingFromPack;

			if (currentlyFleeing) {
				// Straight-line flight directly away from the player — no pathfinding/obstacle-avoidance,
				// the smallest thing that earns "flees" (same scope discipline as patrol's own "straight
				// line between waypoints, no pathfinding" — see DECISIONS.md ADR-0021/ADR-0026).
				const safeDistance = Math.max(distanceFromPlayer, 1e-6); // guards atan2/divide when the
				// player stands exactly on the wolf's own position (distance 0) — picks an arbitrary but
				// stable flee direction instead of producing a NaN velocity.
				const dirX = dxFromPlayer / safeDistance;
				const dirZ = dzFromPlayer / safeDistance;
				const step = fleeSpeedMps * delta;
				model.position.x += dirX * step;
				model.position.z += dirZ * step;
				model.position.y = groundCollider.getGroundHeight(model.position.x, model.position.z);
				turnToward(Math.atan2(dirX, dirZ), delta);
				playAction(fleeAction ?? walkAction ?? idleAction);
			} else if (isPatrolling) {
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
						turnToward(Math.atan2(dx, dz), delta);
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

/**
 * Resolves and loads every configured animal spawn (`config.js`'s `ANIMAL_CONFIG.SPAWNS`) against a
 * kingdom-seat lookup, in parallel — moved out of `game3d.js` (run 29, DECISIONS.md ADR-0028) to
 * keep that file a thin orchestrator, mirroring `npc.js`'s own `spawnConfiguredNPCs`. A spawn
 * referencing an unknown `seatId` is skipped with a console warning, not thrown — matches
 * `game3d.js`'s prior inline behavior exactly. Only wolves exist so far (see `ANIMAL_CONFIG`'s doc
 * comment) — a future animal type would branch on a per-spawn "kind" field here, not duplicate this
 * function.
 * @param {object} options
 * @param {import('../assetLoader.js').AssetLoader} options.assetLoader
 * @param {typeof import('../config.js').ANIMAL_CONFIG} options.animalConfig
 * @param {Map<string, {id: string, x: number, z: number}>} options.seatsById
 * @param {(worldX: number, worldZ: number) => number} options.sampleGroundY
 * @param {{getGroundHeight: (x: number, z: number) => number}} options.groundCollider
 * @returns {Promise<Awaited<ReturnType<typeof createWolf>>[]>} Already filtered — no `null` entries.
 */
export async function spawnConfiguredAnimals({ assetLoader, animalConfig, seatsById, sampleGroundY, groundCollider }) {
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
			return createWolf({
				assetLoader,
				modelUrl: animalConfig.WOLF_MODEL_URL,
				idleClipName: animalConfig.IDLE_CLIP_NAME,
				stripChildNames: animalConfig.STRIP_CHILD_NAMES,
				worldX,
				worldZ,
				groundY: sampleGroundY(worldX, worldZ),
				rotationYRadians: spawn.rotationYRadians,
				name: spawn.id,
				groundCollider,
				walkClipName: patrolWaypoints ? animalConfig.WALK_CLIP_NAME : undefined,
				patrolWaypoints,
				speedMps: animalConfig.PATROL_SPEED_MPS,
				pauseSeconds: animalConfig.PATROL_PAUSE_SECONDS,
				turnRateRadiansPerSecond: animalConfig.PATROL_TURN_RATE_RADIANS_PER_SECOND,
				fleeClipName: animalConfig.FLEE_CLIP_NAME,
				fleeTriggerRadiusMeters: animalConfig.FLEE_TRIGGER_RADIUS_METERS,
				fleeSpeedMps: animalConfig.FLEE_SPEED_MPS,
				packAlertRadiusMeters: animalConfig.PACK_ALERT_RADIUS_METERS,
			});
		}),
	);
	return animals.filter(Boolean);
}
