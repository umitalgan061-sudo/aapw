import * as THREE from 'three';
import { createCreatureRig, CREATURE_BODY_PLANS, applyCreatureGait, resetCreatureGaitPose } from './creatureRig.js';

const DEFAULT_TURN_RATE_RADIANS_PER_SECOND = 4;
const CREATURE_SOCIAL_WANDER_RADIUS_FACTOR = 0.38;

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
		wanderRadiusMeters: 12, wanderSpeedMps: 2, wanderPauseSeconds: 5,
		reactiveDirection: 'away', reactiveTriggerRadiusMeters: 12, reactiveSpeedMps: 9,
		packAlertRadiusMeters: 20,
	}),
	fil: Object.freeze({
		wanderRadiusMeters: 10, wanderSpeedMps: 0.8, wanderPauseSeconds: 6,
		reactiveDirection: 'away', reactiveTriggerRadiusMeters: 8, reactiveSpeedMps: 1.8,
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

function hashSeedString(text) {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

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
	if (!profile) throw new Error(`[gameplay/creatureBrain] no CREATURE_BEHAVIOR_PROFILES entry for species "${speciesId}"`);
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
	const rng = mulberry32(hashSeedString(spawnId) ^ 0x42524e00);
	const wanderCenter = socialCohesionEnabled ? { x: socialAnchorX, z: socialAnchorZ } : { x: worldX, z: worldZ };
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
	let flightPhase = 'grounded';
	let flightAltitudeMeters = 0;
	let flightHeadingX = 0;
	let flightHeadingZ = 1;
	let flightElapsedSeconds = 0;

	function turnToward(targetYaw, delta) {
		const turnStep = DEFAULT_TURN_RATE_RADIANS_PER_SECOND * delta;
		object3D.rotation.y += (((targetYaw - object3D.rotation.y + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI) * Math.min(1, turnStep);
	}

	function pickNewWanderTarget() {
		const angle = rng() * Math.PI * 2;
		const radius = idleWanderRadiusMeters * Math.sqrt(rng());
		wanderTarget = { x: wanderCenter.x + Math.cos(angle) * radius, z: wanderCenter.z + Math.sin(angle) * radius };
	}

	function reactiveDirection(dx, dz, distance, sign = 1) {
		const hasSeparationVector = Number.isFinite(distance) && distance > 1e-6;
		const fallbackYaw = Number.isFinite(object3D.rotation.y) ? object3D.rotation.y : 0;
		return {
			x: (hasSeparationVector ? dx / distance : Math.sin(fallbackYaw)) * sign,
			z: (hasSeparationVector ? dz / distance : Math.cos(fallbackYaw)) * sign,
		};
	}

	function tryCommitGroundedMove(candidateX, candidateZ, minimumDistanceX = null, minimumDistanceZ = null, minimumDistanceMeters = 0) {
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
			if (Number.isFinite(minimumDistanceX) && Number.isFinite(minimumDistanceZ) && minimumDistanceMeters > 0) {
				const resolvedDistance = Math.hypot(resolvedX - minimumDistanceX, resolvedZ - minimumDistanceZ);
				if (!Number.isFinite(resolvedDistance) || resolvedDistance < minimumDistanceMeters - 1e-6) return false;
			}
			const resolvedY = groundCollider.getGroundHeight(resolvedX, resolvedZ);
			if (!Number.isFinite(resolvedY)) return false;
			object3D.position.set(resolvedX, resolvedY, resolvedZ);
			return true;
		} catch {
			return false;
		}
	}

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
			if (profile.reactiveDirection === 'toward' && distanceFromPlayer <= (profile.reactiveStopDistanceMeters ?? 0)) reactingDirectly = false;

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
			}

			currentlyReacting = reactingDirectly || reactingFromHerd;
			let isMoving = false;

			if (isFlightSpecies) {
				if (flightPhase === 'grounded') {
					if (currentlyReacting) {
						const heading = reactiveDirection(dxFromPlayer, dzFromPlayer, distanceFromPlayer);
						const nextAltitude = Math.min(profile.flightAltitudeMeters, profile.takeoffClimbMps * delta);
						const nextX = object3D.position.x + heading.x * profile.reactiveSpeedMps * delta;
						const nextZ = object3D.position.z + heading.z * profile.reactiveSpeedMps * delta;
						if (tryCommitFlightMove(nextX, nextZ, nextAltitude)) {
							flightHeadingX = heading.x;
							flightHeadingZ = heading.z;
							flightAltitudeMeters = nextAltitude;
							flightElapsedSeconds = delta;
							flightPhase = nextAltitude >= profile.flightAltitudeMeters ? 'cruising' : 'climbing';
							turnToward(Math.atan2(flightHeadingX, flightHeadingZ), delta);
							isMoving = true;
						}
					} else isMoving = stepGroundWander(delta);
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
					const nextElapsedSeconds = flightElapsedSeconds + delta;
					const nextX = object3D.position.x + flightHeadingX * profile.reactiveSpeedMps * delta;
					const nextZ = object3D.position.z + flightHeadingZ * profile.reactiveSpeedMps * delta;
					let nextAltitude = flightAltitudeMeters;
					let nextPhase = flightPhase;
					if (flightPhase === 'climbing') {
						nextAltitude = Math.min(profile.flightAltitudeMeters, flightAltitudeMeters + profile.takeoffClimbMps * delta);
						if (nextAltitude >= profile.flightAltitudeMeters) nextPhase = 'cruising';
					} else if (nextElapsedSeconds >= profile.flightDurationSeconds) nextPhase = 'landing';
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
				} else if (wasMoving) resetCreatureGaitPose(rig);
				wasMoving = isMoving;
				return;
			}

			if (currentlyReacting) {
				const sign = profile.reactiveDirection === 'toward' ? -1 : 1;
				const direction = reactiveDirection(dxFromPlayer, dzFromPlayer, distanceFromPlayer, sign);
				const requestedStep = profile.reactiveSpeedMps * delta;
				const stopDistance = profile.reactiveDirection === 'toward' ? Math.max(0, profile.reactiveStopDistanceMeters ?? 0) : 0;
				const step = profile.reactiveDirection === 'toward'
					? Math.min(requestedStep, Math.max(0, distanceFromPlayer - stopDistance))
					: requestedStep;
				const nextX = object3D.position.x + direction.x * step;
				const nextZ = object3D.position.z + direction.z * step;
				const guardFriendlyStop = profile.reactiveDirection === 'toward' && playerPosition;
				if (step > 0 && tryCommitGroundedMove(
					nextX,
					nextZ,
					guardFriendlyStop ? playerPosition.x : null,
					guardFriendlyStop ? playerPosition.z : null,
					guardFriendlyStop ? stopDistance : 0,
				)) {
					turnToward(Math.atan2(direction.x, direction.z), delta);
					isMoving = true;
				}
			} else isMoving = stepGroundWander(delta);

			if (isMoving) {
				gaitClockSeconds += delta;
				applyCreatureGait(rig, { gaitName: currentlyReacting ? plan.alertGait : plan.restGait, elapsedSeconds: gaitClockSeconds });
			} else if (wasMoving) resetCreatureGaitPose(rig);
			wasMoving = isMoving;
		},
		dispose() {
			rig.dispose();
		},
	};
}

export function spawnConfiguredCreatures({ spawns, groundCollider, playerCollider, mulberry32 }) {
	const beings = [];
	for (const spawn of spawns) {
		if (!spawn || typeof spawn.id !== 'string' || spawn.id.length === 0 || !CREATURE_BEHAVIOR_PROFILES[spawn.speciesId]) {
			console.warn(`[gameplay/creatureBrain] configured spawn has invalid identity/species — skipping.`);
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
		beings.push(createCreatureBeing({
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
		}));
	}
	return beings;
}