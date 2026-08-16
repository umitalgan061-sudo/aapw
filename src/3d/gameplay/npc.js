import * as THREE from 'three';
import { AssetLoader } from '../assetLoader.js';
import { createGuardPerception, queryColliderLineOfSight } from './npcPerception.js';

function easeBlendToward(currentBlend, targetBlend, delta, transitionSeconds) {
	if (transitionSeconds > 0) {
		const step = delta / transitionSeconds;
		if (currentBlend < targetBlend) return Math.min(targetBlend, currentBlend + step);
		if (currentBlend > targetBlend) return Math.max(targetBlend, currentBlend - step);
		return currentBlend;
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

function moveTowardXZ({ model, target, speedMps, delta, groundCollider, playerCollider, turnRateRadiansPerSecond, arrivalRadiusMeters = 0.65 }) {
	const dx = Number(target.x) - model.position.x;
	const dz = Number(target.z) - model.position.z;
	const distance = Math.hypot(dx, dz);
	if (!Number.isFinite(distance) || distance <= arrivalRadiusMeters) {
		return { reached: true, moved: false, distanceMeters: distance };
	}
	const step = Math.min(distance, Math.max(0, speedMps) * Math.max(0, delta));
	let nextX = model.position.x + (dx / distance) * step;
	let nextZ = model.position.z + (dz / distance) * step;
	if (playerCollider?.resolveXZ) ({ x: nextX, z: nextZ } = playerCollider.resolveXZ(nextX, nextZ));
	const moved = Math.hypot(nextX - model.position.x, nextZ - model.position.z) > 1e-6;
	model.position.x = nextX;
	model.position.z = nextZ;
	if (groundCollider?.getGroundHeight) model.position.y = groundCollider.getGroundHeight(nextX, nextZ);
	turnTowardYaw(model, Math.atan2(dx, dz), turnRateRadiansPerSecond, delta);
	return { reached: distance <= arrivalRadiusMeters + step, moved, distanceMeters: distance };
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

/**
 * Existing FBX/idle/walk NPC controller with bounded guard perception. The controller reuses the
 * world's composed X/Z collider as a LOS query, remembers the last visible player position, performs
 * a short investigation/search, then resumes its interrupted patrol (or returns a static guard home).
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
}) {
	const model = await assetLoader.loadFBXModel(modelUrl, { fallbackColor: 0x9c6b30, fallbackSize: 1.8 });
	AssetLoader.correctMixamoFbxScale(model);
	if (name) model.name = name;
	model.position.set(worldX, groundY, worldZ);
	model.rotation.y = rotationYRadians;
	const homePosition = Object.freeze({ x: worldX, z: worldZ });

	if (displayName) {
		const inverseParentScale = model.scale.x !== 0 ? 1 / model.scale.x : 1;
		const tag = createNameTagSprite(displayName, nameTagWidthMeters * inverseParentScale, nameTagHeightMeters * inverseParentScale);
		tag.position.set(0, nameTagVerticalOffsetMeters * inverseParentScale, 0);
		model.add(tag);
	}

	const mixer = new THREE.AnimationMixer(model);
	const idleSource = await assetLoader.loadFBXModel(idleAnimationUrl);
	const idleAction = idleSource.animations[0] ? mixer.clipAction(idleSource.animations[0]) : null;
	const isPatrolling = Boolean(patrolWaypoints?.length && groundCollider && walkAnimationUrl);
	let walkAction = null;
	if (walkAnimationUrl) {
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
	const investigationSearchSeconds = 1.25;
	const investigationSpeedMps = Math.max(0.25, speedMps * 0.85);
	const perception = combatStanceEnabled
		? createGuardPerception({
			visionRangeMeters: combatStanceTriggerRadiusMeters,
			fieldOfViewDegrees: 120,
			peripheralRadiusMeters: Math.min(3.25, combatStanceTriggerRadiusMeters * 0.4),
			acquireSeconds: 0.22,
			memorySeconds: 2.0,
			investigationSpeedMps,
			searchSeconds: investigationSearchSeconds,
			alertThreshold: 0.72,
		})
		: null;
	let alertBlend = 0;
	let searchYawBase = null;

	return {
		object3D: model,
		displayName: displayName ?? null,

		update(delta, playerPosition) {
			let perceptionState = null;
			let lineOfSight = { clear: true, samples: 0, reason: 'disabled', blockedAt: null };
			if (perception) {
				const targetDistance = playerPosition
					? Math.hypot(Number(playerPosition.x) - model.position.x, Number(playerPosition.z) - model.position.z)
					: Infinity;
				if (playerPosition && targetDistance <= combatStanceTriggerRadiusMeters) {
					lineOfSight = queryColliderLineOfSight({ collider: playerCollider, observer: model.position, target: playerPosition });
				}
				perceptionState = perception.update({
					observer: model.position,
					target: playerPosition,
					yawRadians: model.rotation.y,
					deltaSeconds: delta,
					hasLineOfSight: lineOfSight.clear,
				});
				const combatAlert = perceptionState.intent === 'alert';
				alertBlend = easeBlendToward(alertBlend, combatAlert ? 1 : 0, delta, combatStanceTransitionSeconds);
				if (idleAction) idleAction.timeScale = 1 + (combatStanceIdleTimeScale - 1) * alertBlend;
				model.userData.combatStanceBlend = alertBlend;
				model.userData.npcPerception = {
					alerted: perceptionState.alerted,
					intent: perceptionState.intent,
					suspicion: Number(perceptionState.suspicion.toFixed(4)),
					reason: perceptionState.reason,
					distanceMeters: Number.isFinite(perceptionState.distanceMeters) ? Number(perceptionState.distanceMeters.toFixed(3)) : null,
					lineOfSight: lineOfSight.clear,
					lineOfSightSamples: lineOfSight.samples,
					investigationRemaining: Number(perceptionState.investigationRemaining.toFixed(3)),
					lastSeen: perceptionState.lastSeen ? { ...perceptionState.lastSeen } : null,
				};
			}

			const isTracking = perceptionState?.intent === 'alert' || perceptionState?.intent === 'observe';
			const isInvestigating = perceptionState?.intent === 'investigate' && perceptionState.lastSeen;
			if (isTracking && playerPosition) {
				searchYawBase = null;
				const dx = playerPosition.x - model.position.x;
				const dz = playerPosition.z - model.position.z;
				if (dx !== 0 || dz !== 0) turnTowardYaw(model, Math.atan2(dx, dz), turnRateRadiansPerSecond, delta);
				playAction(idleAction);
			} else if (isInvestigating) {
				const target = perceptionState.lastSeen;
				const dx = target.x - model.position.x;
				const dz = target.z - model.position.z;
				const distance = Math.hypot(dx, dz);
				if (searchYawBase == null) searchYawBase = distance > 1e-6 ? Math.atan2(dx, dz) : model.rotation.y;
				if (distance > 0.75) {
					const movement = moveTowardXZ({
						model,
						target,
						speedMps: investigationSpeedMps,
						delta,
						groundCollider,
						playerCollider,
						turnRateRadiansPerSecond,
						arrivalRadiusMeters: 0.75,
					});
					playAction(movement.moved ? (walkAction || idleAction) : idleAction);
				} else {
					const searchProgress = 1 - Math.min(1, perceptionState.investigationRemaining / investigationSearchSeconds);
					const sweepRadians = Math.sin(searchProgress * Math.PI * 3) * (Math.PI / 5);
					turnTowardYaw(model, searchYawBase + sweepRadians, turnRateRadiansPerSecond * 0.65, delta);
					playAction(idleAction);
				}
			} else if (isPatrolling) {
				searchYawBase = null;
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
						if (playerCollider?.resolveXZ) ({ x: targetX, z: targetZ } = playerCollider.resolveXZ(targetX, targetZ));
						model.position.x = targetX;
						model.position.z = targetZ;
						model.position.y = groundCollider.getGroundHeight(targetX, targetZ);
						waypointIndex += 1;
						pauseTimer = pauseSeconds;
						playAction(idleAction);
					} else {
						let nextX = model.position.x + (dx / distance) * step;
						let nextZ = model.position.z + (dz / distance) * step;
						if (playerCollider?.resolveXZ) ({ x: nextX, z: nextZ } = playerCollider.resolveXZ(nextX, nextZ));
						model.position.x = nextX;
						model.position.z = nextZ;
						model.position.y = groundCollider.getGroundHeight(model.position.x, model.position.z);
						turnTowardYaw(model, Math.atan2(dx, dz), turnRateRadiansPerSecond, delta);
						playAction(walkAction);
					}
				}
			} else if (!isPatrolling && Math.hypot(model.position.x - homePosition.x, model.position.z - homePosition.z) > 0.2) {
				searchYawBase = null;
				const movement = moveTowardXZ({
					model,
					target: homePosition,
					speedMps: speedMps * 0.8,
					delta,
					groundCollider,
					playerCollider,
					turnRateRadiansPerSecond,
					arrivalRadiusMeters: 0.2,
				});
				playAction(movement.moved ? (walkAction || idleAction) : idleAction);
			} else {
				searchYawBase = null;
				playAction(idleAction);
			}
			mixer.update(delta);
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
			walkAnimationUrl: npcConfig.WALK_ANIMATION_URL,
			patrolWaypoints,
			speedMps: npcConfig.PATROL_SPEED_MPS,
			pauseSeconds: npcConfig.PATROL_PAUSE_SECONDS,
			combatStanceTriggerRadiusMeters: npcConfig.COMBAT_STANCE_TRIGGER_RADIUS_METERS,
			combatStanceIdleTimeScale: npcConfig.COMBAT_STANCE_IDLE_TIME_SCALE,
			combatStanceTransitionSeconds: npcConfig.COMBAT_STANCE_TRANSITION_SECONDS,
			turnRateRadiansPerSecond: npcConfig.PATROL_TURN_RATE_RADIANS_PER_SECOND,
		});
	}));
	return npcs.filter(Boolean);
}
