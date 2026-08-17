/**
 * Existing FAZ 5 NPC runtime: real Mixamo FBX characters, optional waypoint patrol, collision-aware
 * ground following, name tags and the guard combat-stance proximity cue. Population simulation LOD
 * stays inside this established runtime so the game loop, offline shell and other entity owners keep
 * their existing contracts without a second NPC framework or a new runtime module edge.
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
	hash ^= hash >>> 16;
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
				// During bootstrap/menu frames there is no authoritative player position yet.
				// Treat that population as dormant instead of accidentally running every NPC full-rate.
				nearLatched = false;
				distantLatched = true;
			} else if (nearLatched) {
				nearLatched = distanceToPlayer <= nearRadiusMeters + hysteresisMeters;
			} else {
				nearLatched = distanceToPlayer <= nearRadiusMeters;
			}
			if (nearLatched) {
				// Keep each NPC's deterministic phase armed while it is full-rate. If a camera/player
				// teleport pushes a whole crowd out of range on one frame, they must not all wake together.
				farAccumulatedSeconds = farPhaseSeconds;
				distantAccumulatedSeconds = distantPhaseSeconds;
				pendingSimulationSeconds = 0;
				tier = urgent ? 'urgent' : 'near';
				return boundedDelta;
			}

			pendingSimulationSeconds = Math.min(maxStepSeconds, pendingSimulationSeconds + boundedDelta);
			if (finiteDistance) {
				if (distantLatched) {
					distantLatched = distanceToPlayer > distantRadiusMeters - distantHysteresisMeters;
				} else {
					distantLatched = distanceToPlayer > distantRadiusMeters + distantHysteresisMeters;
				}
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
	let alertBlend = 0;
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
			let isAlert = false;
			if (combatStanceEnabled) {
				isAlert = hasPlayerPosition && distanceToPlayer <= combatStanceTriggerRadiusMeters;
				alertBlend = easeBlendToward(alertBlend, isAlert ? 1 : 0, simulationDelta, combatStanceTransitionSeconds);
				if (idleAction) idleAction.timeScale = 1 + (combatStanceIdleTimeScale - 1) * alertBlend;
				model.userData.combatStanceBlend = alertBlend;
			}
			if (isAlert) {
				const dx = playerPosition.x - model.position.x;
				const dz = playerPosition.z - model.position.z;
				if (dx !== 0 || dz !== 0) turnTowardYaw(model, Math.atan2(dx, dz), turnRateRadiansPerSecond, simulationDelta);
				playAction(idleAction);
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
			groundCollider: patrolWaypoints ? groundCollider : undefined,
			playerCollider: patrolWaypoints ? playerCollider : undefined,
			walkAnimationUrl: patrolWaypoints ? npcConfig.WALK_ANIMATION_URL : undefined,
			patrolWaypoints,
			speedMps: npcConfig.PATROL_SPEED_MPS,
			pauseSeconds: npcConfig.PATROL_PAUSE_SECONDS,
			combatStanceTriggerRadiusMeters: npcConfig.COMBAT_STANCE_TRIGGER_RADIUS_METERS,
			combatStanceIdleTimeScale: npcConfig.COMBAT_STANCE_IDLE_TIME_SCALE,
			combatStanceTransitionSeconds: npcConfig.COMBAT_STANCE_TRANSITION_SECONDS,
			turnRateRadiansPerSecond: npcConfig.PATROL_TURN_RATE_RADIANS_PER_SECOND,
			simulationLodEnabled: true,
			simulationLodBootstrapDormant: true,
		});
	}));
	return npcs.filter(Boolean);
}