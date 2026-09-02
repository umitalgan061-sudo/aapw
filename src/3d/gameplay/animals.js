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
import { evaluateConfiguredFaunaRoute, prepareConfiguredAnimalWorldAsset } from './faunaWorldPlacement.js';

const MAX_WILDLIFE_SIMULATION_STEP_SECONDS = 0.1;
const DEFAULT_FLEE_RELEASE_MARGIN_METERS = 3;
const MAX_PACK_ALERT_SAMPLES_PER_TICK = 32;

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
 * @param {string} [options.worldPlacementSpeciesId] When set by configured-fauna spawning, routes
 *   the hydrated GLB through the shared material + geographic placement contract before scene add.
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
 *   required (along with `groundCollider` and a non-null finite `fleeTriggerRadiusMeters`) for flee to
 *   activate.
 * @param {number} [options.fleeTriggerRadiusMeters] A wolf within this finite non-negative distance
 *   of the `playerPosition` passed to `update()` overrides idle/patrol and runs directly away.
 *   `null`/`undefined` or malformed values disable flee entirely (static/patrol-only animal).
 * @param {number} [options.fleeReleaseMarginMeters] Extra distance beyond the trigger radius that
 *   an already-fleeing wolf must clear before it may return to patrol. Prevents boundary jitter.
 * @param {number} [options.fleeSpeedMps]
 * @param {number} [options.packAlertRadiusMeters] A wolf not yet within `fleeTriggerRadiusMeters` of
 *   the player still flees if a packmate within this finite non-negative distance is already fleeing
 *   (`update()`'s `packmateFleePositions` argument) — see DECISIONS.md ADR-0029. `null`/`undefined`
 *   or malformed values disable pack awareness.
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
	worldPlacementSpeciesId = null,
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
	if (worldPlacementSpeciesId) {
		const prepared = prepareConfiguredAnimalWorldAsset(model, {
			speciesId: worldPlacementSpeciesId,
			assetId: name,
			modelUrl,
			worldX,
			worldZ,
			rotationYRadians,
			groundCollider,
		});
		if (!prepared.ok) {
			AssetLoader.disposeObject3D(model);
			const error = new Error(`configured fauna world placement failed: ${prepared.error ?? 'unknown'}`);
			error.code = 'configured-fauna-world-placement';
			throw error;
		}
	} else {
		model.position.set(worldX, groundY, worldZ);
		model.rotation.y = rotationYRadians;
	}

	const mixer = new THREE.AnimationMixer(model);
	const idleClip = THREE.AnimationClip.findByName(model.animations, idleClipName);
	const idleAction = idleClip ? mixer.clipAction(idleClip) : null;
	const isPatrolling = Boolean(patrolWaypoints && patrolWaypoints.length > 0 && groundCollider && walkClipName);
	let walkAction = null;
	if (isPatrolling) {
		const walkClip = THREE.AnimationClip.findByName(model.animations, walkClipName);
		if (walkClip) walkAction = mixer.clipAction(walkClip);
	}

	const safeFleeTriggerRadiusMeters = Number.isFinite(fleeTriggerRadiusMeters) && fleeTriggerRadiusMeters >= 0
		? fleeTriggerRadiusMeters
		: null;
	const safePackAlertRadiusMeters = Number.isFinite(packAlertRadiusMeters) && packAlertRadiusMeters >= 0
		? packAlertRadiusMeters
		: null;
	const canFlee = Boolean(groundCollider && fleeClipName && safeFleeTriggerRadiusMeters != null);
	const releaseMarginMeters = Number.isFinite(fleeReleaseMarginMeters)
		? Math.max(0, Math.min(12, fleeReleaseMarginMeters))
		: DEFAULT_FLEE_RELEASE_MARGIN_METERS;
	const fleeReleaseRadiusMeters = canFlee ? safeFleeTriggerRadiusMeters + releaseMarginMeters : 0;
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
	model.userData.wildlifeFlee = Object.freeze({ phase: isPatrolling ? 'patrol' : 'idle', direct: false, pack: false, recovering: false, distanceMeters: null, triggerRadiusMeters: safeFleeTriggerRadiusMeters, releaseRadiusMeters: canFlee ? fleeReleaseRadiusMeters : null });

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
			const directThreat = canFlee && distanceFromPlayer < safeFleeTriggerRadiusMeters;
			let isFleeingFromPack = false;
			let packThreatDx = 0;
			let packThreatDz = 0;
			let nearestPackThreatDistance = Infinity;
			let nearestPackThreatX = Infinity;
			let nearestPackThreatZ = Infinity;
			if (canFlee && !directThreat && safePackAlertRadiusMeters != null && packmateFleePositions != null) {
				let packIterator = null;
				try {
					const iteratorFactory = packmateFleePositions[Symbol.iterator];
					if (typeof iteratorFactory === 'function') packIterator = iteratorFactory.call(packmateFleePositions);
				} catch {
					packIterator = null;
				}
				let packSamplesScanned = 0;
				let packIteratorCompleted = false;
				while (packIterator && packSamplesScanned < MAX_PACK_ALERT_SAMPLES_PER_TICK) {
					let nextPackmate;
					try {
						nextPackmate = packIterator.next();
					} catch {
						break;
					}
					let packmatePosition;
					try {
						if (!nextPackmate || nextPackmate.done) {
							packIteratorCompleted = true;
							break;
						}
						packSamplesScanned += 1;
						packmatePosition = nextPackmate.value;
					} catch {
						break;
					}
					let packmateX;
					let packmateZ;
					try {
						packmateX = packmatePosition?.x;
						packmateZ = packmatePosition?.z;
					} catch {
						continue;
					}
					if (!Number.isFinite(packmateX) || !Number.isFinite(packmateZ)) continue;
					const dx = model.position.x - packmateX;
					const dz = model.position.z - packmateZ;
					const distance = Math.hypot(dx, dz);
					const distanceDelta = distance - nearestPackThreatDistance;
					const isCloser = distanceDelta < -1e-9;
					const isStableTie = Math.abs(distanceDelta) <= 1e-9
						&& (packmateX < nearestPackThreatX
							|| (packmateX === nearestPackThreatX && packmateZ < nearestPackThreatZ));
					if (distance < safePackAlertRadiusMeters && (isCloser || isStableTie)) {
						isFleeingFromPack = true;
						packThreatDx = dx;
						packThreatDz = dz;
						nearestPackThreatDistance = distance;
						nearestPackThreatX = packmateX;
						nearestPackThreatZ = packmateZ;
					}
				}
				if (packIterator && !packIteratorCompleted) {
					try {
						const iteratorReturn = packIterator.return;
						if (typeof iteratorReturn === 'function') iteratorReturn.call(packIterator);
					} catch {}
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
				triggerRadiusMeters: safeFleeTriggerRadiusMeters,
				releaseRadiusMeters: canFlee ? fleeReleaseRadiusMeters : null,
			});

			if (currentlyFleeing && simulationDelta > 0) {
				const usePackThreatVector = isFleeingFromPack && !directThreat;
				const separationDx = usePackThreatVector ? packThreatDx : dxFromPlayer;
				const separationDz = usePackThreatVector ? packThreatDz : dzFromPlayer;
				const separationDistance = usePackThreatVector ? nearestPackThreatDistance : distanceFromPlayer;
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

/**
 * Resolve one configured animal's initial terrain-relative placement without allowing malformed
 * coordinates or a transient terrain-provider failure to poison the whole parallel fauna batch.
 * Per-frame patrol/flee movement keeps using `tryCommitGroundedMove`, which already fails closed on
 * invalid collider or ground samples.
 */
export function resolveConfiguredAnimalSpawnGround({ spawn, seat, sampleGroundY } = {}) {
	const worldX = seat?.x + spawn?.offsetXMeters;
	const worldZ = seat?.z + spawn?.offsetZMeters;
	if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) {
		return { ok: false, reason: 'non-finite-position' };
	}
	let groundY;
	try {
		groundY = sampleGroundY(worldX, worldZ);
	} catch (error) {
		return { ok: false, reason: 'ground-sample-error', error };
	}
	if (!Number.isFinite(groundY)) return { ok: false, reason: 'non-finite-ground' };
	return { ok: true, worldX, worldZ, groundY };
}

export async function spawnConfiguredAnimals({ assetLoader, animalConfig, seatsById, sampleGroundY, groundCollider, playerCollider }) {
	const animals = await Promise.all(
		animalConfig.SPAWNS.map(async (spawn) => {
			const seat = seatsById.get(spawn.seatId);
			if (!seat) {
				console.warn(`[gameplay/animals] Animal spawn "${spawn.id}" references unknown seat "${spawn.seatId}" — skipping.`);
				return null;
			}
			const species = spawn.speciesId ? animalConfig.SPECIES?.[spawn.speciesId] : null;
			if (spawn.speciesId && !species) {
				console.warn(`[gameplay/animals] Animal spawn "${spawn.id}" references unknown species "${spawn.speciesId}" — skipping.`);
				return null;
			}
			const placement = resolveConfiguredAnimalSpawnGround({ spawn, seat, sampleGroundY });
			if (!placement.ok) {
				console.warn(`[gameplay/animals] Animal spawn "${spawn.id}" has unsafe initial placement (${placement.reason}) — skipping.`, placement.error ?? '');
				return null;
			}
			const { worldX, worldZ, groundY } = placement;
			const clips = species?.clips;
			const walkClipName = species ? clips?.walk : animalConfig.WALK_CLIP_NAME;
			const speciesId = spawn.speciesId ?? 'wolf';
			const patrolTarget = spawn.patrol && walkClipName
				? { x: seat.x + spawn.patrol.toOffsetXMeters, z: seat.z + spawn.patrol.toOffsetZMeters }
				: null;
			const patrolPlacement = patrolTarget
				? evaluateConfiguredFaunaRoute(speciesId, { x: worldX, z: worldZ }, patrolTarget, groundCollider)
				: null;
			const effectiveWaypoints = patrolPlacement?.ok
				? [{ x: worldX, z: worldZ }, patrolTarget]
				: undefined;
			if (patrolTarget && !patrolPlacement?.ok) {
				console.warn(`[gameplay/animals] Animal spawn "${spawn.id}" patrol route rejected by habitat placement (${patrolPlacement?.error ?? 'unknown'}) — keeping safe spawn without patrol.`);
			}
			const fleeClipName = species ? clips?.flee : animalConfig.FLEE_CLIP_NAME;
			const canFlee = spawn.canFlee !== false && Boolean(fleeClipName);
			try {
				const controller = await createWolf({
					assetLoader,
					modelUrl: species?.modelUrl ?? spawn.modelUrl ?? animalConfig.WOLF_MODEL_URL,
					idleClipName: species ? clips?.idle : animalConfig.IDLE_CLIP_NAME,
					stripChildNames: species ? (species.stripChildNames ?? []) : animalConfig.STRIP_CHILD_NAMES,
					worldX,
					worldZ,
					groundY,
					rotationYRadians: spawn.rotationYRadians,
					name: spawn.id,
					worldPlacementSpeciesId: speciesId,
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
				const targetGeography = patrolPlacement?.targetHabitat?.geography;
				controller.object3D.userData.faunaPatrolPlacement = Object.freeze({
					enabled: Boolean(effectiveWaypoints),
					target: patrolTarget ? Object.freeze({ ...patrolTarget }) : null,
					error: patrolTarget && !patrolPlacement?.ok ? (patrolPlacement?.error ?? 'unknown') : null,
					biome: targetGeography?.surface?.biome ?? patrolPlacement?.geography?.surface?.biome ?? null,
					slopeDegrees: Number.isFinite(targetGeography?.surface?.slopeDegrees)
						? Number(targetGeography.surface.slopeDegrees.toFixed(3))
						: null,
					routeSampleCount: patrolPlacement?.routeSampleCount ?? 0,
					routeDistanceMeters: Number.isFinite(patrolPlacement?.distanceMeters)
						? Number(patrolPlacement.distanceMeters.toFixed(3))
						: null,
					failedRouteSampleIndex: patrolPlacement?.routeSampleIndex ?? null,
				});
				return controller;
			} catch (error) {
				if (error?.code !== 'configured-fauna-world-placement') throw error;
				console.warn(`[gameplay/animals] Animal spawn "${spawn.id}" rejected by geographic/material placement (${error.message}) — skipping.`);
				return null;
			}
		}),
	);
	return animals.filter(Boolean);
}
