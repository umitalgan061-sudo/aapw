/**
 * Playable third-person character controller.
 * Reuses the shipped peasant_girl Mixamo mesh/idle/walk/run clips, ground-height contract and
 * settlement collider; sprint/dodge are layered onto that controller rather than a parallel one.
 * @module gameplay/player
 */

import * as THREE from 'three';
import { PLAYER_CONFIG } from './gameplayConfig.js';
import { AssetLoader } from '../assetLoader.js';
import { integrateJumpArc } from '../physics.js';

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
	MAX_COLLISION_STEP_METERS: 0.45,
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export async function createPlayer({
	assetLoader,
	groundCollider,
	playerCollider = null,
	spawn = { x: 0, z: 0 },
}) {
	const model = await assetLoader.loadFBXModel(PLAYER_CONFIG.MODEL_URL, {
		fallbackColor: 0x4a90d9,
		fallbackSize: 1.8,
	});
	AssetLoader.correctMixamoFbxScale(model);

	const mixer = new THREE.AnimationMixer(model);
	/** @type {Record<string, THREE.AnimationAction>} */
	const actions = {};
	for (const [name, url] of Object.entries(PLAYER_CONFIG.ANIMATION_URLS)) {
		const animationObject = await assetLoader.loadFBXModel(url);
		const clip = animationObject.animations[0];
		if (clip) actions[name] = mixer.clipAction(clip);
	}

	const groundY = groundCollider.getGroundHeight(spawn.x, spawn.z);
	model.position.set(spawn.x, groundY, spawn.z);

	let heightAboveGround = 0;
	let velocityY = 0;
	let isGrounded = true;
	let stamina = PLAYER_ACTION_CONFIG.MAX_STAMINA;
	let sprintExhausted = false;
	let regenDelayRemaining = 0;
	let dodgeRemaining = 0;
	let dodgeCooldownRemaining = 0;
	let lastRunPressAge = Infinity;
	let wasRunHeld = false;
	let runIntent = false;
	let hasMovementInput = false;
	let planarSpeedMps = 0;
	let dodgeDirectionX = 0;
	let dodgeDirectionZ = 1;
	let movementState = 'idle';
	let currentActionName = null;
	let lastTelemetryState = '';
	let lastTelemetryStamina = -1;

	function playAction(name, timeScale = 1) {
		const next = actions[name];
		if (!next) return;
		next.setEffectiveTimeScale(timeScale);
		if (currentActionName === name) return;
		next.reset().fadeIn(PLAYER_CONFIG.ANIMATION_CROSSFADE_SECONDS).play();
		if (currentActionName && actions[currentActionName]) {
			actions[currentActionName].fadeOut(PLAYER_CONFIG.ANIMATION_CROSSFADE_SECONDS);
		}
		currentActionName = name;
	}
	playAction('idle');

	function moveBy(directionX, directionZ, speed, delta) {
		const travelMeters = Math.hypot(directionX, directionZ) * speed * delta;
		const steps = playerCollider
			? Math.max(1, Math.ceil(travelMeters / PLAYER_ACTION_CONFIG.MAX_COLLISION_STEP_METERS))
			: 1;
		const stepDelta = steps > 0 ? delta / steps : 0;
		for (let step = 0; step < steps; step += 1) {
			let nextX = model.position.x + directionX * speed * stepDelta;
			let nextZ = model.position.z + directionZ * speed * stepDelta;
			if (playerCollider) ({ x: nextX, z: nextZ } = playerCollider.resolveXZ(nextX, nextZ));
			model.position.x = nextX;
			model.position.z = nextZ;
		}
	}

	function turnToward(directionX, directionZ, delta) {
		const targetYaw = Math.atan2(directionX, directionZ);
		const shortestTarget = model.rotation.y
			+ THREE.MathUtils.euclideanModulo(targetYaw - model.rotation.y + Math.PI, Math.PI * 2)
			- Math.PI;
		model.rotation.y = THREE.MathUtils.lerp(
			model.rotation.y,
			shortestTarget,
			Math.min(1, PLAYER_CONFIG.TURN_RATE_RADIANS_PER_SECOND * delta),
		);
	}

	function spendStamina(amount) {
		stamina = clamp(stamina - amount, 0, PLAYER_ACTION_CONFIG.MAX_STAMINA);
		regenDelayRemaining = PLAYER_ACTION_CONFIG.STAMINA_REGEN_DELAY_SECONDS;
		if (stamina <= 0) sprintExhausted = true;
	}

	function motionSnapshot() {
		return Object.freeze({
			state: movementState,
			stamina: Number(stamina.toFixed(2)),
			maxStamina: PLAYER_ACTION_CONFIG.MAX_STAMINA,
			staminaRatio: Number((stamina / PLAYER_ACTION_CONFIG.MAX_STAMINA).toFixed(4)),
			sprintExhausted,
			runIntent,
			isGrounded,
			canDodge: isGrounded
				&& dodgeRemaining <= 0
				&& dodgeCooldownRemaining <= 0
				&& stamina >= PLAYER_ACTION_CONFIG.DODGE_COST,
			speedMps: Number(planarSpeedMps.toFixed(3)),
			dodgeRemaining: Number(dodgeRemaining.toFixed(3)),
			dodgeCooldownRemaining: Number(dodgeCooldownRemaining.toFixed(3)),
			regenDelayRemaining: Number(regenDelayRemaining.toFixed(3)),
			position: Object.freeze({
				x: Number(model.position.x.toFixed(3)),
				y: Number(model.position.y.toFixed(3)),
				z: Number(model.position.z.toFixed(3)),
			}),
		});
	}

	function publishMotionTelemetry() {
		// Tenths keep HUD/runtime evidence responsive enough to detect sub-point regen changes while
		// still avoiding an unconditional CustomEvent on every idle frame. Dodge is the deliberate
		// exception: its 0.38s burst publishes every frame so position/speed/dodgeRemaining consumers
		// observe the actual high-speed trajectory instead of one frozen first-frame snapshot.
		const staminaBucket = Math.floor(stamina * 10);
		const publishDodgeFrame = movementState === 'dodge';
		if (!publishDodgeFrame && movementState === lastTelemetryState && staminaBucket === lastTelemetryStamina) return;
		lastTelemetryState = movementState;
		lastTelemetryStamina = staminaBucket;
		model.userData.playerMotion = motionSnapshot();
		if (typeof globalThis.dispatchEvent === 'function' && typeof globalThis.CustomEvent === 'function') {
			globalThis.dispatchEvent(new globalThis.CustomEvent('aapw:player-motion', { detail: model.userData.playerMotion }));
		}
	}
	publishMotionTelemetry();
	// `HealthBar` is constructed after `createPlayer` resolves. Re-arm one equivalent first-tick
	// publication so late HUD subscribers receive the full initial snapshot without a direct player
	// reference or a second per-frame polling API.
	lastTelemetryState = '';
	lastTelemetryStamina = -1;

	return {
		object3D: model,
		get stamina() { return stamina; },
		get maxStamina() { return PLAYER_ACTION_CONFIG.MAX_STAMINA; },
		get movementState() { return movementState; },
		get sprintExhausted() { return sprintExhausted; },
		get isDodging() { return dodgeRemaining > 0; },
		getMotionState: motionSnapshot,

		/**
		 * `isRunning` remains the existing Shift/touch-run intent. A quick double press of that same
		 * action while moving performs a stamina-costed dodge, so the shipped game loop/input API does
		 * not need a parallel action framework.
		 */
		update(delta, moveDirectionXZ, isRunning, jumpRequested = false) {
			const dt = Math.max(0, Number.isFinite(delta) ? delta : 0);
			const frameStartX = model.position.x;
			const frameStartZ = model.position.z;
			hasMovementInput = moveDirectionXZ.x !== 0 || moveDirectionXZ.z !== 0;
			runIntent = Boolean(isRunning);
			lastRunPressAge += dt;
			dodgeCooldownRemaining = Math.max(0, dodgeCooldownRemaining - dt);
			regenDelayRemaining = Math.max(0, regenDelayRemaining - dt);
			if (sprintExhausted && stamina >= PLAYER_ACTION_CONFIG.SPRINT_RESTART_STAMINA) sprintExhausted = false;

			const runPressed = runIntent && !wasRunHeld;
			if (
				runPressed
				&& lastRunPressAge <= PLAYER_ACTION_CONFIG.DODGE_DOUBLE_TAP_WINDOW_SECONDS
				&& hasMovementInput
				&& isGrounded
				&& dodgeCooldownRemaining <= 0
				&& stamina >= PLAYER_ACTION_CONFIG.DODGE_COST
			) {
				const length = Math.hypot(moveDirectionXZ.x, moveDirectionXZ.z) || 1;
				dodgeDirectionX = moveDirectionXZ.x / length;
				dodgeDirectionZ = moveDirectionXZ.z / length;
				dodgeRemaining = PLAYER_ACTION_CONFIG.DODGE_DURATION_SECONDS;
				dodgeCooldownRemaining = PLAYER_ACTION_CONFIG.DODGE_COOLDOWN_SECONDS + dodgeRemaining;
				spendStamina(PLAYER_ACTION_CONFIG.DODGE_COST);
				lastRunPressAge = Infinity;
			} else if (runPressed) {
				lastRunPressAge = 0;
			}
			wasRunHeld = runIntent;

			if (dodgeRemaining > 0) {
				dodgeRemaining = Math.max(0, dodgeRemaining - dt);
				moveBy(dodgeDirectionX, dodgeDirectionZ, PLAYER_ACTION_CONFIG.DODGE_SPEED_MPS, dt);
				turnToward(dodgeDirectionX, dodgeDirectionZ, dt);
				movementState = 'dodge';
				playAction('running', PLAYER_ACTION_CONFIG.DODGE_RUN_ANIMATION_TIMESCALE);
			} else if (hasMovementInput) {
				const sprinting = runIntent && isGrounded && !sprintExhausted && stamina > 0;
				const speed = sprinting ? PLAYER_ACTION_CONFIG.SPRINT_SPEED_MPS : PLAYER_CONFIG.WALK_SPEED_MPS;
				moveBy(moveDirectionXZ.x, moveDirectionXZ.z, speed, dt);
				turnToward(moveDirectionXZ.x, moveDirectionXZ.z, dt);
				if (sprinting) {
					spendStamina(PLAYER_ACTION_CONFIG.SPRINT_DRAIN_PER_SECOND * dt);
					movementState = 'sprint';
					playAction('running', 1);
				} else {
					movementState = isGrounded && runIntent && sprintExhausted
						? 'exhausted'
						: (isGrounded ? 'walk' : 'airborne');
					playAction('walking', 1);
				}
			} else {
				movementState = isGrounded ? 'idle' : 'airborne';
				playAction('idle', 1);
			}

			if (dodgeRemaining <= 0 && jumpRequested && isGrounded) {
				velocityY = PLAYER_CONFIG.JUMP_SPEED_MPS;
				isGrounded = false;
			}
			({ heightAboveGroundMeters: heightAboveGround, velocityYMps: velocityY, isGrounded } = integrateJumpArc(
				heightAboveGround,
				velocityY,
				dt,
				PLAYER_CONFIG.GRAVITY_MPS2,
			));
			model.position.y = groundCollider.getGroundHeight(model.position.x, model.position.z) + heightAboveGround;

			// Run intent must keep owning the stamina budget while airborne too. The prior grounded-only
			// guard let a held sprint-jump begin regenerating near the top/end of the arc after the delay.
			if (regenDelayRemaining <= 0 && dodgeRemaining <= 0 && !(runIntent && hasMovementInput)) {
				stamina = clamp(stamina + PLAYER_ACTION_CONFIG.STAMINA_REGEN_PER_SECOND * dt, 0, PLAYER_ACTION_CONFIG.MAX_STAMINA);
			}

			planarSpeedMps = dt > 0
				? Math.hypot(model.position.x - frameStartX, model.position.z - frameStartZ) / dt
				: 0;
			mixer.update(dt);
			publishMotionTelemetry();
		},

		dispose() {
			mixer.stopAllAction();
			AssetLoader.disposeObject3D(model);
		},
	};
}