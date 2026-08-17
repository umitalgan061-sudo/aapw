/**
 * Existing FAZ 5 NPC runtime: real Mixamo FBX characters, optional waypoint patrol, collision-aware
 * ground following, name tags and guard behavior. Population simulation LOD and perception stay
 * inside this established runtime so the game loop and other entity owners keep their contracts.
 * @module gameplay/npc
 */

import * as THREE from 'three';
import { AssetLoader } from '../assetLoader.js';

function easeBlendToward(currentBlend, targetBlend, delta, transitionSeconds) {
	if (transitionSeconds > 0) {
		const step = delta / transitionSeconds;
		if (currentBlend < targetBlend) return Math.min(targetBlend, currentBlend + step);
		if (currentBlend > targetBlend) return Math.max(targetBlend, currentBlend - step);
	}
	return targetBlend;
}

function turnTowardYaw(model, targetYaw, turnRateRadiansPerSecond, delta) {
	const turnStep = turnRateRadiansPerSecond * delta;
	model.rotation.y = THREE.MathUtils.lerp(
		model.rotation.y,
		model.rotation.y + THREE.MathUtils.euclideanModulo(targetYaw - model.rotation.y + Math.PI, Math.PI * 2) - Math.PI,
		Math.min(1, turnStep),
	);
}

function clampSimulationDelta(delta, maxStepSeconds) {
	if (!Number.isFinite(delta) || delta <= 0) return 0;
	return Math.min(delta, maxStepSeconds);
}

function queryNpcLineOfSight(collider, observer, target, maxSamples = 32) {
	if (!collider?.resolveXZ || !target) return { clear: true, samples: 0 };
	const dx = target.x - observer.x;
	const dz = target.z - observer.z;
	const distance = Math.hypot(dx, dz);
	const sampleCount = Math.max(0, Math.min(maxSamples, Math.ceil(distance / 0.5) - 1));
	for (let i = 1; i <= sampleCount; i += 1) {
		const t = i / (sampleCount + 1);
		const x = observer.x + dx * t;
		const z = observer.z + dz * t;
		const resolved = collider.resolveXZ(x, z);
		if (!resolved || Math.hypot(resolved.x - x, resolved.z - z) > 1e-4) return { clear: false, samples: i };
	}
	return { clear: true, samples: sampleCount };
}

export function evaluateNpcGuardAwareness({ observer, target, yawRadians = 0, rangeMeters = 10, lineOfSight = true } = {}) {
	if (!observer || !target || !(rangeMeters > 0)) return { visible: false, distanceMeters: Infinity, reason: 'invalid' };
	const dx = target.x - observer.x;
	const dz = target.z - observer.z;
	const distanceMeters = Math.hypot(dx, dz);
	if (!Number.isFinite(distanceMeters) || distanceMeters > rangeMeters) return { visible: false, distanceMeters, reason: 'range' };
	if (!lineOfSight) return { visible: false, distanceMeters, reason: 'occluded' };
	const closeAwareness = distanceMeters <= Math.max(3.25, rangeMeters * 0.35);
	if (closeAwareness || distanceMeters < 1e-6) return { visible: true, distanceMeters, reason: 'peripheral' };
	const forwardX = Math.sin(yawRadians);
	const forwardZ = Math.cos(yawRadians);
	const dot = Math.max(-1, Math.min(1, (forwardX * dx + forwardZ * dz) / distanceMeters));
	const angleDegrees = Math.acos(dot) * 180 / Math.PI;
	return { visible: angleDegrees <= 60, distanceMeters, reason: angleDegrees <= 60 ? 'vision' : 'behind' };
}

function moveNpcToward(model, target, speedMps, delta, groundCollider, playerCollider, turnRateRadiansPerSecond, arrivalRadius = 0.7) {
	const dx = target.x - model.position.x;
	const dz = target.z - model.position.z;
	const distance = Math.hypot(dx, dz);
	if (!(distance > arrivalRadius)) return false;
	const step = Math.min(distance, Math.max(0, speedMps) * delta);
	let nextX = model.position.x + dx / distance * step;
	let nextZ = model.position.z + dz / distance * step;
	if (playerCollider?.resolveXZ) ({ x: nextX, z: nextZ } = playerCollider.resolveXZ(nextX, nextZ));
	model.position.x = nextX;
	model.position.z = nextZ;
	if (groundCollider?.getGroundHeight) model.position.y = groundCollider.getGroundHeight(nextX, nextZ);
	turnTowardYaw(model, Math.atan2(dx, dz), turnRateRadiansPerSecond, delta);
	return true;
}

export function deterministicNpcPhaseSeconds(id, intervalSeconds) {
	if (!(intervalSeconds > 0)) return 0;
	let hash = 2166136261;
	for (const char of String(id ?? 'npc')) {
		hash ^= char.charCodeAt(0);
		hash = Math.imul(hash, 16777619) >>> 0;
	}
	hash ^= hash >>> 16;
	hash = Math.imul(hash, 0x7feb352d) >>> 0;
	hash ^= hash >>> 15;
	hash = Math.imul(hash, 0x846ca68b) >>> 0;
	hash = (hash ^ (hash >>> 16)) >>> 0;
	return (hash / 0x100000000) * intervalSeconds;
}

export function createNpcSimulationLod({
	id,
	nearRadiusMeters = 90,
	farIntervalSeconds = 0.25,
	distantRadiusMeters = 240,
	distantIntervalSeconds = 1,
	maxStepSeconds = 0.25,
	hysteresisMeters = 12,
	distantHysteresisMeters = 30,
} = {}) {
	if (!(nearRadiusMeters > 0)) throw new Error('nearRadiusMeters must be > 0');
	if (!(farIntervalSeconds > 0)) throw new Error('farIntervalSeconds must be > 0');
	if (!(distantRadiusMeters > nearRadiusMeters)) throw new Error('distantRadiusMeters must exceed nearRadiusMeters');
	if (!(distantIntervalSeconds >= farIntervalSeconds)) throw new Error('distantIntervalSeconds must be >= farIntervalSeconds');
	if (!(maxStepSeconds > 0)) throw new Error('maxStepSeconds must be > 0');
	if (!(hysteresisMeters >= 0)) throw new Error('hysteresisMeters must be >= 0');
	if (!(distantHysteresisMeters >= 0)) throw new Error('distantHysteresisMeters must be >= 0');
	const farPhaseSeconds = deterministicNpcPhaseSeconds(id, farIntervalSeconds);
	const distantPhaseSeconds = deterministicNpcPhaseSeconds(`${id}:distant`, distantIntervalSeconds);
	let farAccumulatedSeconds = farPhaseSeconds;
	let distantAccumulatedSeconds = distantPhaseSeconds;
	let pendingSimulationSeconds = 0;
	let tier = 'near';
	let nearLatched = true;
	let distantLatched = false;
	return {
		step(delta, distanceToPlayer, urgent = false) {
			const boundedDelta = clampSimulationDelta(delta, maxStepSeconds);
			const finiteDistance = Number.isFinite(distanceToPlayer);
			if (urgent) {
				nearLatched = true;
				distantLatched = false;
			} else if (!finiteDistance) {
				nearLatched = false;
				distantLatched = true;
			} else if (nearLatched) {
				nearLatched = distanceToPlayer <= nearRadiusMeters + hysteresisMeters;
			} else {
				nearLatched = distanceToPlayer <= nearRadiusMeters;
			}
			if (nearLatched) {
				farAccumulatedSeconds = farPhaseSeconds;
				distantAccumulatedSeconds = distantPhaseSeconds;
				pendingSimulationSeconds = 0;
				tier = urgent ? 'urgent' : 'near';
				return boundedDelta;
			}
			pendingSimulationSeconds = Math.min(maxStepSeconds, pendingSimulationSeconds + boundedDelta);
			if (finiteDistance) {
				if (distantLatched) distantLatched = distanceToPlayer > distantRadiusMeters - distantHysteresisMeters;
				else distantLatched = distanceToPlayer > distantRadiusMeters + distantHysteresisMeters;
			}
			if (distantLatched) {
				if (tier !== 'distant' && tier !== 'bootstrap') distantAccumulatedSeconds = distantPhaseSeconds;
				tier = finiteDistance ? 'distant' : 'bootstrap';
				farAccumulatedSeconds = farPhaseSeconds;
				distantAccumulatedSeconds = Math.min(distantIntervalSeconds, distantAccumulatedSeconds + boundedDelta);
				if (distantAccumulatedSeconds + Number.EPSILON < distantIntervalSeconds) return 0;
				distantAccumulatedSeconds = 0;
				const simulationDelta = pendingSimulationSeconds;
				pendingSimulationSeconds = 0;
				return simulationDelta;
			}
			if (tier !== 'far') farAccumulatedSeconds = farPhaseSeconds;
			tier = 'far';
			distantAccumulatedSeconds = distantPhaseSeconds;
			farAccumulatedSeconds = Math.min(farIntervalSeconds, farAccumulatedSeconds + boundedDelta);
			if (farAccumulatedSeconds + Number.EPSILON < farIntervalSeconds) return 0;
			farAccumulatedSeconds = 0;
			const simulationDelta = pendingSimulationSeconds;
			pendingSimulationSeconds = 0;
			return simulationDelta;
		},
		get tier() { return tier; },
	};
}

function createNameTagSprite(text, widthMeters, heightMeters) {
	const canvas = document.createElement('canvas');
	canvas.width = 512;
	canvas.height = 128;
	const ctx = canvas.getContext('2d');
	ctx.fillStyle = 'rgba(12, 9, 6, 0.6)';
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.font = 'bold 52px Georgia, serif';
	ctx.fillStyle = '#f0d9a0';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText(text, canvas.width / 2, canvas.height / 2);
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
	const sprite = new THREE.Sprite(material);
	sprite.scale.set(widthMeters, heightMeters, 1);
	return sprite;
}

export async function createNPC({
	assetLoader,
	modelUrl,
	idleAnimationUrl,
	worldX,
	worldZ,
	groundY,
	rotationYRadians = 0,
	name,
	displayName,
	nameTagWidthMeters = 2.4,
	nameTagHeightMeters = 0.6,
	nameTagVerticalOffsetMeters = 2.1,
	groundCollider,
	playerCollider = null,
	walkAnimationUrl,
	patrolWaypoints,
	speedMps = 1.4,
	pauseSeconds = 3,
	turnRateRadiansPerSecond = 4,
	combatStanceTriggerRadiusMeters,
	combatStanceIdleTimeScale = 1.5,
	combatStanceTransitionSeconds = 0.3,
	perceptionEnabled = false,
	simulationLodEnabled = false,
	simulationLodNearRadiusMeters = 90,
	simulationLodFarIntervalSeconds = 0.25,
	simulationLodDistantRadiusMeters = 240,
	simulationLodDistantIntervalSeconds = 1,
	simulationLodMaxStepSeconds = 0.25,
	simulationLodBootstrapDormant = false,
}) {
	const model = await assetLoader.loadFBXModel(modelUrl, { fallbackColor: 0x9c6b30, fallbackSize: 1.8 });
	AssetLoader.correctMixamoFbxScale(model);
	if (name) model.name = name;
	model.position.set(worldX, groundY, worldZ);
	model.rotation.y = rotationYRadians;
	const homePosition = Object.freeze({ x: worldX, z: worldZ });
	if (displayName) {
		const inverseParentScale = model.scale.x !== 0 ? 1 / model.scale.x : 1;
		const nameTag = createNameTagSprite(displayName, nameTagWidthMeters * inverseParentScale, nameTagHeightMeters * inverseParentScale);
		nameTag.position.set(0, nameTagVerticalOffsetMeters * inverseParentScale, 0);
		model.add(nameTag);
	}
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
	function playAction(action) {
		if (currentAction === action || !action) return;
		action.reset().fadeIn(0.25).play();
		if (currentAction) currentAction.fadeOut(0.25);
		currentAction = action;
	}
	playAction(idleAction);
	let waypointIndex = 0;
	let pauseTimer = 0;
	const combatStanceEnabled = combatStanceTriggerRadiusMeters != null;
	const combatEngageRadiusMeters = combatStanceEnabled
		? Math.max(1.5, Math.min(3.5, combatStanceTriggerRadiusMeters * 0.35))
		: 0;
	let alertBlend = 0;
	let suspicion = 0;
	let lastKnownPlayer = null;
	let investigationRemaining = 0;
	let previousPlayerPosition = null;
	const simulationLod = createNpcSimulationLod({
		id: name ?? displayName ?? modelUrl,
		nearRadiusMeters: simulationLodNearRadiusMeters,
		farIntervalSeconds: simulationLodFarIntervalSeconds,
		distantRadiusMeters: simulationLodDistantRadiusMeters,
		distantIntervalSeconds: simulationLodDistantIntervalSeconds,
		maxStepSeconds: simulationLodMaxStepSeconds,
	});
	model.userData.simulationLodTier = 'near';
	model.userData.simulationTicks = 0;
	model.userData.simulationSkippedTicks = 0;
	model.userData.combatStanceBlend = 0;
	return {
		object3D: model,
		displayName: displayName ?? null,
		update(delta, playerPosition) {
			const hasPlayerPosition = Boolean(playerPosition);
			const distanceToPlayer = hasPlayerPosition
				? Math.hypot(model.position.x - playerPosition.x, model.position.z - playerPosition.z)
				: (simulationLodBootstrapDormant ? Infinity : 0);
			let playerSpeedMps = 0;
			if (hasPlayerPosition && previousPlayerPosition && delta > 1e-4) {
				playerSpeedMps = Math.min(12, Math.hypot(playerPosition.x - previousPlayerPosition.x, playerPosition.z - previousPlayerPosition.z) / delta);
			}
			previousPlayerPosition = hasPlayerPosition ? { x: playerPosition.x, z: playerPosition.z } : null;
			const urgent = hasPlayerPosition && combatStanceEnabled && distanceToPlayer <= combatStanceTriggerRadiusMeters;
			const simulationDelta = simulationLodEnabled
				? simulationLod.step(delta, distanceToPlayer, urgent)
				: clampSimulationDelta(delta, simulationLodMaxStepSeconds);
			model.userData.simulationLodTier = simulationLodEnabled ? simulationLod.tier : 'near';
			if (simulationDelta <= 0) {
				model.userData.simulationSkippedTicks += 1;
				return;
			}
			model.userData.simulationTicks += 1;
			let perceptionIntent = 'patrol';
			let awareness = { visible: false, distanceMeters: distanceToPlayer, reason: 'disabled' };
			let los = { clear: true, samples: 0 };
			let heard = false;
			if (perceptionEnabled && combatStanceEnabled && hasPlayerPosition) {
				if (distanceToPlayer <= combatStanceTriggerRadiusMeters) los = queryNpcLineOfSight(playerCollider, model.position, playerPosition);
				awareness = evaluateNpcGuardAwareness({ observer: model.position, target: playerPosition, yawRadians: model.rotation.y, rangeMeters: combatStanceTriggerRadiusMeters, lineOfSight: los.clear });
				const noiseStrength = Math.max(0, Math.min(1, (playerSpeedMps - 1.5) / 5.5));
				heard = !awareness.visible && noiseStrength > 0 && distanceToPlayer <= Math.max(4, combatStanceTriggerRadiusMeters * 0.8) * noiseStrength;
				if (awareness.visible) {
					suspicion = Math.min(1, suspicion + simulationDelta / 0.22);
					lastKnownPlayer = { x: playerPosition.x, z: playerPosition.z };
					investigationRemaining = Math.max(investigationRemaining, 2 + distanceToPlayer / Math.max(0.25, speedMps * 0.85));
				} else if (heard) {
					suspicion = Math.min(1, suspicion + 0.18 * noiseStrength);
					lastKnownPlayer = { x: playerPosition.x, z: playerPosition.z };
					investigationRemaining = Math.max(investigationRemaining, 1.25 + distanceToPlayer / Math.max(0.25, speedMps * 0.85));
				} else {
					suspicion = Math.max(0, suspicion - simulationDelta / 1.0);
					investigationRemaining = Math.max(0, investigationRemaining - simulationDelta);
				}
				if (awareness.visible && suspicion >= 0.72) {
					perceptionIntent = distanceToPlayer > combatEngageRadiusMeters ? 'chase' : 'combat';
				} else if (awareness.visible) {
					perceptionIntent = 'observe';
				} else {
					perceptionIntent = lastKnownPlayer && investigationRemaining > 0 ? 'investigate' : 'patrol';
				}
				model.userData.npcPerception = {
					intent: perceptionIntent,
					suspicion: Number(suspicion.toFixed(3)),
					reason: heard ? 'hearing' : awareness.reason,
					heard,
					lineOfSight: los.clear,
					lineOfSightSamples: los.samples,
					engageRadiusMeters: Number(combatEngageRadiusMeters.toFixed(3)),
					investigationRemaining: Number(investigationRemaining.toFixed(3)),
					lastKnown: lastKnownPlayer ? { ...lastKnownPlayer } : null,
				};
			}
			let isAlert = false;
			if (combatStanceEnabled) {
				isAlert = perceptionEnabled ? perceptionIntent === 'combat' : hasPlayerPosition && distanceToPlayer <= combatStanceTriggerRadiusMeters;
				alertBlend = easeBlendToward(alertBlend, isAlert ? 1 : 0, simulationDelta, combatStanceTransitionSeconds);
				if (idleAction) idleAction.timeScale = 1 + (combatStanceIdleTimeScale - 1) * alertBlend;
				model.userData.combatStanceBlend = alertBlend;
			}
			if (isAlert || (perceptionEnabled && perceptionIntent === 'observe')) {
				const dx = playerPosition.x - model.position.x;
				const dz = playerPosition.z - model.position.z;
				if (dx !== 0 || dz !== 0) turnTowardYaw(model, Math.atan2(dx, dz), turnRateRadiansPerSecond, simulationDelta);
				playAction(idleAction);
			} else if (perceptionEnabled && perceptionIntent === 'chase' && playerPosition) {
				const moved = moveNpcToward(model, playerPosition, speedMps * 1.35, simulationDelta, groundCollider, playerCollider, turnRateRadiansPerSecond, combatEngageRadiusMeters);
				playAction(moved ? (walkAction || idleAction) : idleAction);
			} else if (perceptionEnabled && perceptionIntent === 'investigate' && lastKnownPlayer) {
				const moved = moveNpcToward(model, lastKnownPlayer, speedMps * 0.85, simulationDelta, groundCollider, playerCollider, turnRateRadiansPerSecond);
				playAction(moved ? (walkAction || idleAction) : idleAction);
			} else if (isPatrolling) {
				if (pauseTimer > 0) {
					pauseTimer -= simulationDelta;
					playAction(idleAction);
				} else {
					const target = patrolWaypoints[waypointIndex % patrolWaypoints.length];
					const dx = target.x - model.position.x;
					const dz = target.z - model.position.z;
					const distance = Math.hypot(dx, dz);
					const step = speedMps * simulationDelta;
					if (distance <= step) {
						let targetX = target.x;
						let targetZ = target.z;
						if (playerCollider) ({ x: targetX, z: targetZ } = playerCollider.resolveXZ(targetX, targetZ));
						model.position.x = targetX;
						model.position.z = targetZ;
						model.position.y = groundCollider.getGroundHeight(targetX, targetZ);
						waypointIndex += 1;
						pauseTimer = pauseSeconds;
						playAction(idleAction);
					} else {
						let nextX = model.position.x + (dx / distance) * step;
						let nextZ = model.position.z + (dz / distance) * step;
						if (playerCollider) ({ x: nextX, z: nextZ } = playerCollider.resolveXZ(nextX, nextZ));
						model.position.x = nextX;
						model.position.z = nextZ;
						model.position.y = groundCollider.getGroundHeight(model.position.x, model.position.z);
						turnTowardYaw(model, Math.atan2(dx, dz), turnRateRadiansPerSecond, simulationDelta);
						playAction(walkAction);
					}
				}
			} else if (perceptionEnabled && Math.hypot(model.position.x - homePosition.x, model.position.z - homePosition.z) > 0.2) {
				const moved = moveNpcToward(model, homePosition, speedMps * 0.8, simulationDelta, groundCollider, playerCollider, turnRateRadiansPerSecond, 0.2);
				playAction(moved ? (walkAction || idleAction) : idleAction);
			}
			mixer.update(simulationDelta);
		},
		dispose() {
			mixer.stopAllAction();
			AssetLoader.disposeObject3D(model);
		},
	};
}

export async function spawnConfiguredNPCs({ assetLoader, npcConfig, seatsById, sampleGroundY, groundCollider, playerCollider }) {
	const npcs = await Promise.all(npcConfig.SPAWNS.map(async (spawn) => {
		const seat = seatsById.get(spawn.seatId);
		if (!seat) {
			console.warn(`[gameplay/npc] NPC spawn "${spawn.id}" references unknown seat "${spawn.seatId}" — skipping.`);
			return null;
		}
		const worldX = seat.x + spawn.offsetXMeters;
		const worldZ = seat.z + spawn.offsetZMeters;
		const groundY = sampleGroundY(worldX, worldZ);
		const patrolWaypoints = spawn.patrol ? [
			{ x: worldX, z: worldZ },
			{ x: seat.x + spawn.patrol.toOffsetXMeters, z: seat.z + spawn.patrol.toOffsetZMeters },
		] : undefined;
		return createNPC({
			assetLoader,
			modelUrl: spawn.modelUrl,
			idleAnimationUrl: npcConfig.IDLE_ANIMATION_URL,
			worldX,
			worldZ,
			groundY,
			rotationYRadians: spawn.rotationYRadians,
			name: spawn.id,
			displayName: spawn.displayName,
			nameTagWidthMeters: npcConfig.NAME_TAG_WIDTH_METERS,
			nameTagHeightMeters: npcConfig.NAME_TAG_HEIGHT_METERS,
			nameTagVerticalOffsetMeters: npcConfig.NAME_TAG_VERTICAL_OFFSET_METERS,
			groundCollider,
			playerCollider,
			walkAnimationUrl: patrolWaypoints ? npcConfig.WALK_ANIMATION_URL : undefined,
			patrolWaypoints,
			speedMps: npcConfig.PATROL_SPEED_MPS,
			pauseSeconds: npcConfig.PATROL_PAUSE_SECONDS,
			combatStanceTriggerRadiusMeters: npcConfig.COMBAT_STANCE_TRIGGER_RADIUS_METERS,
			combatStanceIdleTimeScale: npcConfig.COMBAT_STANCE_IDLE_TIME_SCALE,
			combatStanceTransitionSeconds: npcConfig.COMBAT_STANCE_TRANSITION_SECONDS,
			turnRateRadiansPerSecond: npcConfig.PATROL_TURN_RATE_RADIANS_PER_SECOND,
			perceptionEnabled: true,
			simulationLodEnabled: true,
			simulationLodBootstrapDormant: true,
		});
	}));
	return npcs.filter(Boolean);
}