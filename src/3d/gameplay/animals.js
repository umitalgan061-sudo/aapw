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
import { mapToWorldXZ } from '../world/settlements.js';
import { WORLD_SCALE } from '../config.js';

const MAX_WILDLIFE_SIMULATION_STEP_SECONDS = 0.1;
const DEFAULT_FLEE_RELEASE_MARGIN_METERS = 3;

function boundedWildlifeDelta(delta) {
	if (!Number.isFinite(delta) || delta <= 0) return 0;
	return Math.min(delta, MAX_WILDLIFE_SIMULATION_STEP_SECONDS);
}

/**
 * Removes any descendant of `object3D` whose name is in `names`, disposing its GPU resources.
 *
 * Originally this swept only the root's direct children, which was enough for the one thing it was
 * written for: the wolf glTF's bundled "Circle" ground-shadow-catcher disc, which sits at the root
 * beside the armature. Run 377 needed to reach the same file's `Wolf2_fur__fella3_jpg_001_0` mesh,
 * which hangs off `Armature_0` a level down — a direct-children sweep silently did nothing, and the
 * mesh went on rendering. It sweeps the whole subtree now. Only names a caller explicitly lists are
 * removed, so reaching deeper cannot take anything a caller did not ask for.
 *
 * See `gameplay/gameplayConfig.js`'s `ANIMAL_CONFIG.STRIP_CHILD_NAMES` for why this exists at all.
 * @param {THREE.Object3D} object3D
 * @param {string[]} names
 */
function stripNamedChildren(object3D, names) {
	if (!names.length) return;
	const doomed = [];
	object3D.traverse((node) => {
		if (names.includes(node.name)) doomed.push(node);
	});
	for (const node of doomed) {
		node.parent?.remove(node);
		AssetLoader.disposeObject3D(node);
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
	/**
	 * Run 407 — the reactive branch runs *toward* the player instead of away.
	 *
	 * Owner request for the Doom of Valyria: "Onlar vahşi olsunlar ve herkese saldırgan olsunlar."
	 * Everything else about the branch is deliberately shared with fleeing rather than duplicated —
	 * same trigger radius, same pack alert, same grounded-move commit, same gait fallback — because a
	 * charge and a bolt are the same movement with the opposite sign, and forking the code would have
	 * given the two behaviours separate collision and terrain handling to drift apart.
	 */
	aggressive = false,
	/** How close a charging animal may get before it stops closing, so it presses the player rather
	 * than walking through them. Mirrors the standoff `creatureBrain.js` keeps for the same reason. */
	aggressiveStandoffMeters = 2.2,
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

// Run 407: the reactive branch is gated on *reacting*, not on having a flee clip.
	//
	// This read `fleeClipName && fleeTriggerRadiusMeters != null`, which is right for an animal that
	// bolts and wrong for one that charges: the magma hound ships `Idle` and `Walk` and no flee clip, so
	// with the old gate `directThreat` was permanently false and the pack stood still while the player
	// walked through it. Measured before the fix — player placed 20 m away, 3 s of simulation stepped:
	// distance 20.00 m -> 20.00 m, i.e. it never moved. The one clip-dependent use downstream
	// (`playAction(fleeAction ?? walkAction ?? idleAction)`) already falls back on its own.
	const canFlee = Boolean(groundCollider && fleeTriggerRadiusMeters != null && (fleeClipName || aggressive));
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
			if (canFlee && !directThreat && hasFinitePlayerPosition && packAlertRadiusMeters != null && packmateFleePositions) {
				for (const packmatePosition of packmateFleePositions) {
					if (!Number.isFinite(packmatePosition?.x) || !Number.isFinite(packmatePosition?.z)) continue;
					const dx = model.position.x - packmatePosition.x;
					const dz = model.position.z - packmatePosition.z;
					if (Math.hypot(dx, dz) < packAlertRadiusMeters) {
						isFleeingFromPack = true;
						break;
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

			if (currentlyFleeing && simulationDelta > 0 && aggressive && distanceFromPlayer <= aggressiveStandoffMeters) {
				// Closed the distance: hold and face the player rather than pushing through them.
				turnToward(Math.atan2(playerPosition.x - model.position.x, playerPosition.z - model.position.z), simulationDelta);
				playAction(idleAction ?? walkAction);
			} else if (currentlyFleeing && simulationDelta > 0) {
				const hasSeparationVector = distanceFromPlayer > 1e-6;
				// `dxFromPlayer` points from the player to the animal, so the unmodified vector runs
				// away. An aggressive animal takes the same vector with the opposite sign.
				const towardSign = aggressive ? -1 : 1;
				const dirX = hasSeparationVector ? towardSign * dxFromPlayer / distanceFromPlayer : Math.sin(model.rotation.y);
				const dirZ = hasSeparationVector ? towardSign * dzFromPlayer / distanceFromPlayer : Math.cos(model.rotation.y);
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
			// Run 407: a spawn may anchor to a point on the owner map instead of a kingdom seat. Valyria
			// is a region, not a castle, and every existing anchor was a seat id — so placing anything in
			// the Doom was impossible through this config at all. `mapAnchor` carries normalized owner-map
			// coordinates and resolves through the same `mapToWorldXZ` the seats themselves use, so the two
			// anchor kinds land in one coordinate space rather than two.
			const anchor = spawn.mapAnchor
				? mapToWorldXZ(spawn.mapAnchor.nx, spawn.mapAnchor.ny, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT)
				: seatsById.get(spawn.seatId);
			if (!anchor) {
				console.warn(`[gameplay/animals] Animal spawn "${spawn.id}" references unknown seat "${spawn.seatId}" — skipping.`);
				return null;
			}
			const seat = anchor;
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
			// Run 407: an aggressive species reacts to the player with no flee clip at all. The magma
			// hound ships `Idle` and `Walk` and nothing else, so gating the reactive branch on a flee
			// clip alone (as `canFlee` does) would have left it standing still while the player walked
			// through the pack.
			const isAggressive = species?.aggressive === true;
			const canReact = canFlee || isAggressive;
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
				fleeTriggerRadiusMeters: canReact
					? (isAggressive ? (species.chargeTriggerRadiusMeters ?? animalConfig.FLEE_TRIGGER_RADIUS_METERS) : animalConfig.FLEE_TRIGGER_RADIUS_METERS)
					: undefined,
				fleeSpeedMps: isAggressive ? (species.chargeSpeedMps ?? animalConfig.FLEE_SPEED_MPS) : animalConfig.FLEE_SPEED_MPS,
				aggressive: isAggressive,
				packAlertRadiusMeters: canFlee ? animalConfig.PACK_ALERT_RADIUS_METERS : undefined,
			});
		}),
	);
	return animals.filter(Boolean);
}