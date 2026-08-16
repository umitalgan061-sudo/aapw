/**
 * Playable third-person character controller.
 * Reuses the shipped peasant_girl Mixamo mesh/idle/walk/run clips, ground-height contract and
 * settlement collider; sprint/dodge are layered onto that controller rather than a parallel one.
 * @module gameplay/player
 */

import * as THREE from 'three';
import { PLAYER_CONFIG } from './gameplayConfig.js';
import { PLAYER_ACTION_CONFIG } from './playerActionConfig.js';
import { AssetLoader } from '../assetLoader.js';
import { integrateJumpArc } from '../physics.js';

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
	let regenDelayRemaining = 0;
	let dodgeRemaining = 0;
	let dodgeCooldownRemaining = 0;
	let lastRunPressAge = Infinity;
	let wasRunHeld = false;
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
		let nextX = model.position.x + directionX * speed * delta;
		let nextZ = model.position.z + directionZ * speed * delta;
		if (playerCollider) ({ x: nextX, z: nextZ } = playerCollider.resolveXZ(nextX, nextZ));
		model.position.x = nextX;
		model.position.z = nextZ;
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
	}

	function motionSnapshot() {
		return Object.freeze({
			state: movementState,
			stamina: Number(stamina.toFixed(2)),
			isGrounded,
			dodgeRemaining: Number(dodgeRemaining.toFixed(3)),
			position: Object.freeze({
				x: Number(model.position.x.toFixed(3)),
				y: Number(model.position.y.toFixed(3)),
				z: Number(model.position.z.toFixed(3)),
			}),
		});
	}

	function publishMotionTelemetry() {
		const staminaBucket = Math.floor(stamina);
		if (movementState === lastTelemetryState && staminaBucket === lastTelemetryStamina) return;
		lastTelemetryState = movementState;
		lastTelemetryStamina = staminaBucket;
		model.userData.playerMotion = motionSnapshot();
		if (typeof globalThis.dispatchEvent === 'function' && typeof globalThis.CustomEvent === 'function') {
			globalThis.dispatchEvent(new globalThis.CustomEvent('aapw:player-motion', { detail: model.userData.playerMotion }));
		}
	}
	publishMotionTelemetry();

	return {
		object3D: model,
		get stamina() { return stamina; },
		get movementState() { return movementState; },
		getMotionState: motionSnapshot,

		/**
		 * `isRunning` remains the existing Shift/touch-run intent. A quick double press of that same
		 * action while moving performs a stamina-costed dodge, so the shipped game loop/input API does
		 * not need a parallel action framework.
		 */
		update(delta, moveDirectionXZ, isRunning, jumpRequested = false) {
			const dt = Math.max(0, Number.isFinite(delta) ? delta : 0);
			const hasInput = moveDirectionXZ.x !== 0 || moveDirectionXZ.z !== 0;
			lastRunPressAge += dt;
			dodgeCooldownRemaining = Math.max(0, dodgeCooldownRemaining - dt);
			regenDelayRemaining = Math.max(0, regenDelayRemaining - dt);

			const runPressed = Boolean(isRunning) && !wasRunHeld;
			if (
				runPressed
				&& lastRunPressAge <= PLAYER_ACTION_CONFIG.DODGE_DOUBLE_TAP_WINDOW_SECONDS
				&& hasInput
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
			wasRunHeld = Boolean(isRunning);

			if (dodgeRemaining > 0) {
				dodgeRemaining = Math.max(0, dodgeRemaining - dt);
				moveBy(dodgeDirectionX, dodgeDirectionZ, PLAYER_ACTION_CONFIG.DODGE_SPEED_MPS, dt);
				turnToward(dodgeDirectionX, dodgeDirectionZ, dt);
				movementState = 'dodge';
				playAction('running', PLAYER_ACTION_CONFIG.DODGE_RUN_ANIMATION_TIMESCALE);
			} else if (hasInput) {
				const sprinting = Boolean(isRunning) && isGrounded && stamina > 0;
				const speed = sprinting ? PLAYER_ACTION_CONFIG.SPRINT_SPEED_MPS : PLAYER_CONFIG.WALK_SPEED_MPS;
				moveBy(moveDirectionXZ.x, moveDirectionXZ.z, speed, dt);
				turnToward(moveDirectionXZ.x, moveDirectionXZ.z, dt);
				if (sprinting) {
					spendStamina(PLAYER_ACTION_CONFIG.SPRINT_DRAIN_PER_SECOND * dt);
					movementState = 'sprint';
					playAction('running', 1);
				} else {
					movementState = isGrounded ? 'walk' : 'airborne';
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

			if (regenDelayRemaining <= 0 && dodgeRemaining <= 0 && !(Boolean(isRunning) && hasInput && isGrounded)) {
				stamina = clamp(stamina + PLAYER_ACTION_CONFIG.STAMINA_REGEN_PER_SECOND * dt, 0, PLAYER_ACTION_CONFIG.MAX_STAMINA);
			}

			mixer.update(dt);
			publishMotionTelemetry();
		},

		dispose() {
			mixer.stopAllAction();
			AssetLoader.disposeObject3D(model);
		},
	};
}
