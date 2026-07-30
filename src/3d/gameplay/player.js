/**
 * The playable character (FAZ 4): loads the base Mixamo mesh + its idle/walking/running clips,
 * handles camera-relative WASD movement with ground-height snapping, and crossfades animation
 * state off real movement speed. See `src/3d/gameplay/README.md` for the module's conventions.
 * @module gameplay/player
 */

import * as THREE from 'three';
import { PLAYER_CONFIG } from '../config.js';
import { AssetLoader } from '../assetLoader.js';

/**
 * Loads the character and its animation clips, and returns a small controller object.
 * @param {object} options
 * @param {import('../assetLoader.js').AssetLoader} options.assetLoader
 * @param {{getGroundHeight: (x: number, z: number) => number}} options.groundCollider `physics.js`'s collider.
 * @param {{resolveXZ: (x: number, z: number) => {x: number, z: number}}} [options.settlementCollider]
 *   `physics.js`'s `createSettlementCollider` (FAZ 3's "Basit ... collider") — optional so this
 *   module still works in any future context with no settlements (e.g. a unit test) without a
 *   caller needing to fabricate one; movement simply isn't blocked by castles when omitted.
 * @param {{x: number, z: number}} [options.spawn] World-space spawn point.
 * @returns {Promise<{
 *   object3D: THREE.Object3D,
 *   update: (delta: number, moveDirectionXZ: {x: number, z: number}, isRunning: boolean) => void,
 *   dispose: () => void,
 * }>}
 */
export async function createPlayer({
	assetLoader,
	groundCollider,
	settlementCollider = null,
	spawn = { x: PLAYER_CONFIG.SPAWN_X_METERS, z: PLAYER_CONFIG.SPAWN_Z_METERS },
}) {
	const model = await assetLoader.loadFBXModel(PLAYER_CONFIG.MODEL_URL, {
		fallbackColor: 0x4a90d9,
		fallbackSize: 1.8,
	});

	// Mixamo FBX exports store geometry in centimeters; correct it here rather than guessing a
	// hardcoded 0.01, so a differently-scaled future character asset still comes out right. Shared
	// with gameplay/npc.js via AssetLoader.correctMixamoFbxScale (added run 20) — see its doc comment.
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

	let currentActionName = null;
	/** Crossfades to `name`'s action; a no-op if it's already the current one or was never loaded. */
	function playAction(name) {
		if (currentActionName === name || !actions[name]) return;
		const next = actions[name];
		next.reset().fadeIn(PLAYER_CONFIG.ANIMATION_CROSSFADE_SECONDS).play();
		if (currentActionName && actions[currentActionName]) {
			actions[currentActionName].fadeOut(PLAYER_CONFIG.ANIMATION_CROSSFADE_SECONDS);
		}
		currentActionName = name;
	}
	playAction('idle');

	return {
		object3D: model,

		/**
		 * @param {number} delta Seconds since the last frame.
		 * @param {{x: number, z: number}} moveDirectionXZ Normalized (or zero) world-space direction
		 *   — already camera-relative, computed by the caller (see this module's doc comment).
		 * @param {boolean} isRunning
		 */
		update(delta, moveDirectionXZ, isRunning) {
			const hasInput = moveDirectionXZ.x !== 0 || moveDirectionXZ.z !== 0;

			if (hasInput) {
				const speed = isRunning ? PLAYER_CONFIG.RUN_SPEED_MPS : PLAYER_CONFIG.WALK_SPEED_MPS;
				let nextX = model.position.x + moveDirectionXZ.x * speed * delta;
				let nextZ = model.position.z + moveDirectionXZ.z * speed * delta;
				if (settlementCollider) {
					({ x: nextX, z: nextZ } = settlementCollider.resolveXZ(nextX, nextZ));
				}
				model.position.x = nextX;
				model.position.z = nextZ;
				model.position.y = groundCollider.getGroundHeight(model.position.x, model.position.z);

				const targetYaw = Math.atan2(moveDirectionXZ.x, moveDirectionXZ.z);
				const turnStep = PLAYER_CONFIG.TURN_RATE_RADIANS_PER_SECOND * delta;
				model.rotation.y = THREE.MathUtils.lerp(
					model.rotation.y,
					// Shortest-path angle lerp: avoids spinning the long way around at the -PI/PI seam.
					model.rotation.y + THREE.MathUtils.euclideanModulo(targetYaw - model.rotation.y + Math.PI, Math.PI * 2) - Math.PI,
					Math.min(1, turnStep),
				);
				playAction(isRunning ? 'running' : 'walking');
			} else {
				playAction('idle');
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
