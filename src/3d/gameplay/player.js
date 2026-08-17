/**
 * Playable third-person character controller.
 * Reuses the shipped peasant_girl idle/walk/run family, real ground/collider contracts and the
 * existing stamina/dodge controller. Guard/parry are additional states here, not a second combat
 * framework or a synthetic attack-animation system.
 * @module gameplay/player
 */

import * as THREE from 'three';
import { PLAYER_CONFIG } from './gameplayConfig.js';
import { AssetLoader } from '../assetLoader.js';
import { integrateJumpArc } from '../physics.js';
import { gameEvents } from '../eventBus.js';
import { EVENTS } from '../config.js';

const PLAYER_ACTION_CONFIG = Object.freeze({
	MAX_STAMINA: 100,
	SPRINT_SPEED_MPS: 8.2,
	SPRINT_DRAIN_PER_SECOND: 24,
	SPRINT_RESTART_STAMINA: 20,
	STAMINA_REGEN_PER_SECOND: 19,
	STAMINA_REGEN_DELAY_SECONDS: 0.65,
	DODGE_DOUBLE_TAP_WINDOW_SECONDS: 0.6,
	DODGE_COST: 28,
	DODGE_DURATION_SECONDS: 0.38,
	DODGE_SPEED_MPS: 10.5,
	DODGE_COOLDOWN_SECONDS: 0.22,
	DODGE_RUN_ANIMATION_TIMESCALE: 1.45,
	GUARD_DRAIN_PER_SECOND: 11,
	GUARD_MOVE_SPEED_MULTIPLIER: 0.5,
	GUARD_DAMAGE_MULTIPLIER: 0.4,
	GUARD_STAMINA_DAMAGE_RATIO: 0.35,
	PARRY_WINDOW_SECONDS: 0.16,
	PARRY_STAMINA_COST: 8,
	PARRY_FEEDBACK_SECONDS: 0.18,
	MAX_COLLISION_STEP_METERS: 0.45,
	MAX_FRAME_DELTA_SECONDS: 0.1,
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export async function createPlayer({ assetLoader, groundCollider, playerCollider = null, spawn = { x: 0, z: 0 } }) {
	const model = await assetLoader.loadFBXModel(PLAYER_CONFIG.MODEL_URL, { fallbackColor: 0x4a90d9, fallbackSize: 1.8 });
	AssetLoader.correctMixamoFbxScale(model);
	const mixer = new THREE.AnimationMixer(model);
	const actions = {};
	for (const [name, url] of Object.entries(PLAYER_CONFIG.ANIMATION_URLS)) {
		const animationObject = await assetLoader.loadFBXModel(url);
		const clip = animationObject.animations[0];
		if (clip) actions[name] = mixer.clipAction(clip);
	}
	const groundY = groundCollider.getGroundHeight(spawn.x, spawn.z);
	model.position.set(spawn.x, groundY, spawn.z);
	let heightAboveGround = 0, velocityY = 0, isGrounded = true;
	let stamina = PLAYER_ACTION_CONFIG.MAX_STAMINA, sprintExhausted = false, regenDelayRemaining = 0;
	let dodgeRemaining = 0, dodgeCooldownRemaining = 0, lastRunPressAge = Infinity, wasRunHeld = false;
	let runIntent = false, hasMovementInput = false, planarSpeedMps = 0, dodgeDirectionX = 0, dodgeDirectionZ = 1;
	let guarding = false, wasGuardHeld = false, parryWindowRemaining = 0, parryFeedbackRemaining = 0;
	let lastDefenseResult = 'none';
	let movementState = 'idle', currentActionName = null, lastTelemetryState = '', lastTelemetryStamina = -1;

	function playAction(name, timeScale = 1) {
		const next = actions[name]; if (!next) return; next.setEffectiveTimeScale(timeScale); if (currentActionName === name) return;
		next.reset().fadeIn(PLAYER_CONFIG.ANIMATION_CROSSFADE_SECONDS).play();
		if (currentActionName && actions[currentActionName]) actions[currentActionName].fadeOut(PLAYER_CONFIG.ANIMATION_CROSSFADE_SECONDS);
		currentActionName = name;
	}
	playAction('idle');

	function moveBy(directionX, directionZ, speed, delta) {
		const travelMeters = Math.hypot(directionX, directionZ) * speed * delta;
		const steps = playerCollider ? Math.max(1, Math.ceil(travelMeters / PLAYER_ACTION_CONFIG.MAX_COLLISION_STEP_METERS)) : 1;
		const stepDelta = steps > 0 ? delta / steps : 0;
		for (let step = 0; step < steps; step += 1) {
			let nextX = model.position.x + directionX * speed * stepDelta, nextZ = model.position.z + directionZ * speed * stepDelta;
			if (playerCollider) ({ x: nextX, z: nextZ } = playerCollider.resolveXZ(nextX, nextZ));
			model.position.x = nextX; model.position.z = nextZ;
		}
	}
	function turnToward(directionX, directionZ, delta) {
		const targetYaw = Math.atan2(directionX, directionZ);
		const shortestTarget = model.rotation.y + THREE.MathUtils.euclideanModulo(targetYaw - model.rotation.y + Math.PI, Math.PI * 2) - Math.PI;
		model.rotation.y = THREE.MathUtils.lerp(model.rotation.y, shortestTarget, Math.min(1, PLAYER_CONFIG.TURN_RATE_RADIANS_PER_SECOND * delta));
	}
	function spendStamina(amount) {
		stamina = clamp(stamina - amount, 0, PLAYER_ACTION_CONFIG.MAX_STAMINA);
		regenDelayRemaining = PLAYER_ACTION_CONFIG.STAMINA_REGEN_DELAY_SECONDS;
		if (stamina <= 0) sprintExhausted = true;
	}
	function canStartDodge() {
		return !guarding && hasMovementInput && isGrounded && dodgeRemaining <= 0 && dodgeCooldownRemaining <= 0 && stamina >= PLAYER_ACTION_CONFIG.DODGE_COST;
	}
	function startDodge(moveDirectionXZ) {
		const length = Math.hypot(moveDirectionXZ.x, moveDirectionXZ.z) || 1;
		dodgeDirectionX = moveDirectionXZ.x / length; dodgeDirectionZ = moveDirectionXZ.z / length;
		dodgeRemaining = PLAYER_ACTION_CONFIG.DODGE_DURATION_SECONDS;
		dodgeCooldownRemaining = PLAYER_ACTION_CONFIG.DODGE_COOLDOWN_SECONDS + dodgeRemaining;
		spendStamina(PLAYER_ACTION_CONFIG.DODGE_COST); lastRunPressAge = Infinity;
	}
	function motionSnapshot() {
		return Object.freeze({
			state: movementState, stamina: Number(stamina.toFixed(2)), maxStamina: PLAYER_ACTION_CONFIG.MAX_STAMINA,
			staminaRatio: Number((stamina / PLAYER_ACTION_CONFIG.MAX_STAMINA).toFixed(4)), sprintExhausted, runIntent,
			guarding, parryWindowRemaining: Number(parryWindowRemaining.toFixed(3)), defenseResult: lastDefenseResult,
			isGrounded, canDodge: !guarding && isGrounded && dodgeRemaining <= 0 && dodgeCooldownRemaining <= 0 && stamina >= PLAYER_ACTION_CONFIG.DODGE_COST,
			speedMps: Number(planarSpeedMps.toFixed(3)), dodgeRemaining: Number(dodgeRemaining.toFixed(3)),
			dodgeCooldownRemaining: Number(dodgeCooldownRemaining.toFixed(3)), regenDelayRemaining: Number(regenDelayRemaining.toFixed(3)),
			position: Object.freeze({ x: Number(model.position.x.toFixed(3)), y: Number(model.position.y.toFixed(3)), z: Number(model.position.z.toFixed(3)) }),
		});
	}
	function publishMotionTelemetry(force = false) {
		const staminaBucket = Math.floor(stamina * 10), transient = movementState === 'dodge' || movementState === 'parry';
		if (!force && !transient && movementState === lastTelemetryState && staminaBucket === lastTelemetryStamina) return;
		lastTelemetryState = movementState; lastTelemetryStamina = staminaBucket; model.userData.playerMotion = motionSnapshot();
		if (typeof globalThis.dispatchEvent === 'function' && typeof globalThis.CustomEvent === 'function') globalThis.dispatchEvent(new globalThis.CustomEvent('aapw:player-motion', { detail: model.userData.playerMotion }));
	}

	// Player is constructed before createHealthState in game3d.js, so this adapter runs first on the
	// shared EventBus and transforms the same serializable damage payload the generic health state
	// then consumes. NPC/dragon producers remain untouched.
	function onIncomingDamage(payload) {
		const rawAmount = payload?.amount;
		if (typeof rawAmount !== 'number' || !(rawAmount > 0) || !isGrounded) return;
		if (parryWindowRemaining > 0 && stamina >= PLAYER_ACTION_CONFIG.PARRY_STAMINA_COST) {
			spendStamina(PLAYER_ACTION_CONFIG.PARRY_STAMINA_COST);
			parryWindowRemaining = 0; parryFeedbackRemaining = PLAYER_ACTION_CONFIG.PARRY_FEEDBACK_SECONDS;
			movementState = 'parry'; lastDefenseResult = 'parry';
			payload.rawAmount = rawAmount; payload.blockedAmount = rawAmount; payload.amount = 0; payload.mitigation = 'parry';
			publishMotionTelemetry(true); return;
		}
		if (!guarding || stamina <= 0) return;
		const reducedAmount = Number((rawAmount * PLAYER_ACTION_CONFIG.GUARD_DAMAGE_MULTIPLIER).toFixed(4));
		const blockedAmount = rawAmount - reducedAmount;
		spendStamina(blockedAmount * PLAYER_ACTION_CONFIG.GUARD_STAMINA_DAMAGE_RATIO);
		lastDefenseResult = 'guard';
		payload.rawAmount = rawAmount; payload.blockedAmount = blockedAmount; payload.amount = reducedAmount; payload.mitigation = 'guard';
		publishMotionTelemetry(true);
	}
	gameEvents.on(EVENTS.PLAYER_DAMAGED, onIncomingDamage);

	publishMotionTelemetry(); lastTelemetryState = ''; lastTelemetryStamina = -1;
	return {
		object3D: model,
		get stamina() { return stamina; }, get maxStamina() { return PLAYER_ACTION_CONFIG.MAX_STAMINA; },
		get movementState() { return movementState; }, get sprintExhausted() { return sprintExhausted; },
		get isDodging() { return dodgeRemaining > 0; }, get isGuarding() { return guarding; }, getMotionState: motionSnapshot,
		update(delta, moveDirectionXZ, isRunning, jumpRequested = false) {
			const dt = clamp(Number.isFinite(delta) ? delta : 0, 0, PLAYER_ACTION_CONFIG.MAX_FRAME_DELTA_SECONDS), frameStartX = model.position.x, frameStartZ = model.position.z;
			hasMovementInput = moveDirectionXZ.x !== 0 || moveDirectionXZ.z !== 0; runIntent = Boolean(isRunning);
			lastRunPressAge += dt; dodgeCooldownRemaining = Math.max(0, dodgeCooldownRemaining - dt); regenDelayRemaining = Math.max(0, regenDelayRemaining - dt);
			parryWindowRemaining = Math.max(0, parryWindowRemaining - dt); parryFeedbackRemaining = Math.max(0, parryFeedbackRemaining - dt);
			if (sprintExhausted && stamina >= PLAYER_ACTION_CONFIG.SPRINT_RESTART_STAMINA) sprintExhausted = false;

			const guardIntent = Boolean(moveDirectionXZ.guarding), guardPressed = guardIntent && !wasGuardHeld;
			guarding = guardIntent && isGrounded && dodgeRemaining <= 0 && stamina > 0;
			if (guardPressed && guarding && stamina >= PLAYER_ACTION_CONFIG.PARRY_STAMINA_COST) parryWindowRemaining = PLAYER_ACTION_CONFIG.PARRY_WINDOW_SECONDS;
			wasGuardHeld = guardIntent;
			const runPressed = runIntent && !wasRunHeld, runJumpDodgeRequested = Boolean(jumpRequested) && runIntent;
			if (canStartDodge() && (runJumpDodgeRequested || (runPressed && lastRunPressAge <= PLAYER_ACTION_CONFIG.DODGE_DOUBLE_TAP_WINDOW_SECONDS))) startDodge(moveDirectionXZ); else if (runPressed) lastRunPressAge = 0;
			wasRunHeld = runIntent;

			if (dodgeRemaining > 0) {
				dodgeRemaining = Math.max(0, dodgeRemaining - dt); moveBy(dodgeDirectionX, dodgeDirectionZ, PLAYER_ACTION_CONFIG.DODGE_SPEED_MPS, dt); turnToward(dodgeDirectionX, dodgeDirectionZ, dt); movementState = 'dodge'; playAction('running', PLAYER_ACTION_CONFIG.DODGE_RUN_ANIMATION_TIMESCALE);
			} else if (parryFeedbackRemaining > 0) {
				movementState = 'parry'; playAction('idle', 1);
			} else if (guarding) {
				spendStamina(PLAYER_ACTION_CONFIG.GUARD_DRAIN_PER_SECOND * dt);
				if (hasMovementInput) {
					moveBy(moveDirectionXZ.x, moveDirectionXZ.z, PLAYER_CONFIG.WALK_SPEED_MPS * PLAYER_ACTION_CONFIG.GUARD_MOVE_SPEED_MULTIPLIER, dt);
					turnToward(moveDirectionXZ.x, moveDirectionXZ.z, dt); playAction('walking', 0.65);
				} else playAction('idle', 1);
				movementState = 'guard';
			} else if (hasMovementInput) {
				const sprinting = runIntent && isGrounded && !sprintExhausted && stamina > 0, speed = sprinting ? PLAYER_ACTION_CONFIG.SPRINT_SPEED_MPS : PLAYER_CONFIG.WALK_SPEED_MPS;
				moveBy(moveDirectionXZ.x, moveDirectionXZ.z, speed, dt); turnToward(moveDirectionXZ.x, moveDirectionXZ.z, dt);
				if (sprinting) { spendStamina(PLAYER_ACTION_CONFIG.SPRINT_DRAIN_PER_SECOND * dt); movementState = 'sprint'; playAction('running', 1); }
				else { movementState = isGrounded && runIntent && sprintExhausted ? 'exhausted' : (isGrounded ? 'walk' : 'airborne'); playAction('walking', 1); }
			} else { movementState = isGrounded ? 'idle' : 'airborne'; playAction('idle', 1); }

			if (dodgeRemaining <= 0 && !guarding && jumpRequested && isGrounded) { velocityY = PLAYER_CONFIG.JUMP_SPEED_MPS; isGrounded = false; }
			({ heightAboveGroundMeters: heightAboveGround, velocityYMps: velocityY, isGrounded } = integrateJumpArc(heightAboveGround, velocityY, dt, PLAYER_CONFIG.GRAVITY_MPS2));
			model.position.y = groundCollider.getGroundHeight(model.position.x, model.position.z) + heightAboveGround;
			if (dodgeRemaining <= 0 && parryFeedbackRemaining <= 0) {
				if (!isGrounded) { guarding = false; movementState = 'airborne'; }
				else if (movementState === 'airborne') movementState = hasMovementInput ? (runIntent && sprintExhausted ? 'exhausted' : 'walk') : 'idle';
			}
			if (regenDelayRemaining <= 0 && dodgeRemaining <= 0 && !guarding && !(runIntent && hasMovementInput)) stamina = clamp(stamina + PLAYER_ACTION_CONFIG.STAMINA_REGEN_PER_SECOND * dt, 0, PLAYER_ACTION_CONFIG.MAX_STAMINA);
			planarSpeedMps = dt > 0 ? Math.hypot(model.position.x - frameStartX, model.position.z - frameStartZ) / dt : 0;
			mixer.update(dt); publishMotionTelemetry();
		},
		dispose() { gameEvents.off(EVENTS.PLAYER_DAMAGED, onIncomingDamage); mixer.stopAllAction(); AssetLoader.disposeObject3D(model); },
	};
}
