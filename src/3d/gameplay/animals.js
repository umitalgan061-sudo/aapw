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
	// Starts at 0, not `pauseSeconds` (fixed run 38, DECISIONS.md ADR-0045) — same fix as
	// `gameplay/npc.js`'s identical copied logic. `patrolWaypoints[0]` is always this animal's own
	// spawn point (see `spawnConfiguredAnimals`), so the very first `update()` call resolves it as an
	// immediate zero-distance "arrival" (a no-op) and *then* starts the real `pauseSeconds` dwell
	// before the first actual step, instead of idling a second, redundant full cycle first.
	let pauseTimer = 0;
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
				let nextX = model.position.x + dirX * step;
				let nextZ = model.position.z + dirZ * step;
				if (playerCollider) {
					({ x: nextX, z: nextZ } = playerCollider.resolveXZ(nextX, nextZ));
				}
				model.position.x = nextX;
				model.position.z = nextZ;
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
						let targetX = target.x;
						let targetZ = target.z;
						if (playerCollider) {
							({ x: targetX, z: targetZ } = playerCollider.resolveXZ(targetX, targetZ));
						}
						model.position.x = targetX;
						model.position.z = targetZ;
						model.position.y = groundCollider.getGroundHeight(targetX, targetZ);
						waypointIndex += 1;
						pauseTimer = pauseSeconds;
						playAction(idleAction);
					} else {
						let nextPatrolX = model.position.x + (dx / distance) * step;
						let nextPatrolZ = model.position.z + (dz / distance) * step;
						if (playerCollider) {
							({ x: nextPatrolX, z: nextPatrolZ } = playerCollider.resolveXZ(nextPatrolX, nextPatrolZ));
						}
						model.position.x = nextPatrolX;
						model.position.z = nextPatrolZ;
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
 * Resolves and loads every configured animal spawn (`gameplayConfig.js`'s `ANIMAL_CONFIG.SPAWNS`) against a
 * kingdom-seat lookup, in parallel — moved out of `game3d.js` (run 29, DECISIONS.md ADR-0028) to
 * keep that file a thin orchestrator, mirroring `npc.js`'s own `spawnConfiguredNPCs`. A spawn
 * referencing an unknown `seatId` is skipped with a console warning, not thrown — matches
 * `game3d.js`'s prior inline behavior exactly. Wolves were the only animal through run 38; run 39
 * (DECISIONS.md ADR-0047) added a per-spawn `modelUrl` override (default `animalConfig.
 * WOLF_MODEL_URL`, so every pre-existing wolf `SPAWNS` entry is unaffected) and a per-spawn
 * `canFlee` flag (default `true`, same reasoning) for `umit-horse-1` — a rigless/animation-less
 * model that has no walk/flee clips to run and no `patrol` field, so it should never enter the
 * flee/pack-alert branches at all, not just fail to find a matching clip name silently. A "kind"
 * field / per-species lookup table would be cleaner if a 3rd non-wolf-shaped animal shows up, but
 * two per-spawn overrides is still the smaller change for exactly one exception so far — revisit if
 * a 3rd species needs its own knobs.
 * @param {object} options
 * @param {import('../assetLoader.js').AssetLoader} options.assetLoader
 * @param {typeof import('./gameplayConfig.js').ANIMAL_CONFIG} options.animalConfig
 * @param {Map<string, {id: string, x: number, z: number}>} options.seatsById
 * @param {(worldX: number, worldZ: number) => number} options.sampleGroundY
 * @param {{getGroundHeight: (x: number, z: number) => number}} options.groundCollider
 * @param {{resolveXZ: (x: number, z: number) => {x: number, z: number}}} [options.playerCollider]
 *   Forwarded to every `createWolf` call — see that function's own JSDoc.
 * @returns {Promise<Awaited<ReturnType<typeof createWolf>>[]>} Already filtered — no `null` entries.
 */
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
			// Species resolution (run 300+): a spawn naming a `speciesId` takes its model and its clip
			// names from `animalConfig.SPECIES`; a spawn without one keeps the pre-existing wolf-global
			// behavior byte-for-byte, so every legacy wolf entry is unaffected. An unknown `speciesId` is
			// skipped with a warning rather than silently falling back to a wolf model — a mistyped
			// species would otherwise spawn a wolf where a cow was intended, which is far harder to
			// notice than a missing animal plus a console line.
			const species = spawn.speciesId ? animalConfig.SPECIES?.[spawn.speciesId] : null;
			if (spawn.speciesId && !species) {
				console.warn(`[gameplay/animals] Animal spawn "${spawn.id}" references unknown species "${spawn.speciesId}" — skipping.`);
				return null;
			}
			const clips = species?.clips;
			// A species with no `walk` clip (e.g. sheep — genuinely absent in the source file) never
			// patrols, even if the spawn declares a `patrol` line: driving translation with no walk cycle
			// is exactly the sliding-model artifact ADR-0047 avoided for the rigless horse.
			const walkClipName = species ? clips?.walk : animalConfig.WALK_CLIP_NAME;
			const effectiveWaypoints = walkClipName ? patrolWaypoints : undefined;
			const fleeClipName = species ? clips?.flee : animalConfig.FLEE_CLIP_NAME;
			// Same guard on the flee side: no flee clip means no flee/pack-alert branch at all.
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
