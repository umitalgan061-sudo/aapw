/**
 * Static, idling NPCs (FAZ 5 first pass, run 20): reuses `gameplay/player.js`'s FBX-loading and
 * Mixamo-scale-correction pattern for a non-player character standing at a fixed world position and
 * playing a looping idle animation. No AI, pathing, dialogue, or interaction yet — deliberately
 * atomic, see `3D_GAME_PROGRESS.md`'s FAZ 5 roadmap and DECISIONS.md ADR-0019 for why this first
 * slice stops here.
 * @module gameplay/npc
 */

import * as THREE from 'three';
import { AssetLoader } from '../assetLoader.js';

/**
 * Loads one NPC's model and idle clip, places it, and returns a small controller object — same
 * `{object3D, update, dispose}` shape as `gameplay/player.js`'s `createPlayer`, minus movement.
 * @param {object} options
 * @param {import('../assetLoader.js').AssetLoader} options.assetLoader
 * @param {string} options.modelUrl Mixamo T-pose character FBX (must share `peasant_girl`'s skeleton).
 * @param {string} options.idleAnimationUrl Skin-less idle clip FBX (retargets onto any shared-skeleton model).
 * @param {number} options.worldX World-space spawn X, in meters.
 * @param {number} options.worldZ World-space spawn Z, in meters.
 * @param {number} options.groundY World-space Y the NPC's feet rest at — caller-sampled via the
 *   same `physics.js` ground collider (+ sea-level clamp) every other placement system uses, not
 *   computed in here (keeps this module as caller-agnostic about "where" as `player.js` already is
 *   about "which direction" — see `gameplay/README.md`'s Conventions).
 * @param {number} [options.rotationYRadians]
 * @param {string} [options.name] Assigned to the loaded `Object3D` (useful for debugging/tests).
 * @returns {Promise<{object3D: THREE.Object3D, update: (delta: number) => void, dispose: () => void}>}
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
}) {
	const model = await assetLoader.loadFBXModel(modelUrl, { fallbackColor: 0x9c6b30, fallbackSize: 1.8 });
	AssetLoader.correctMixamoFbxScale(model);
	if (name) model.name = name;
	model.position.set(worldX, groundY, worldZ);
	model.rotation.y = rotationYRadians;

	const mixer = new THREE.AnimationMixer(model);
	const idleSource = await assetLoader.loadFBXModel(idleAnimationUrl);
	const idleClip = idleSource.animations[0];
	if (idleClip) mixer.clipAction(idleClip).play();

	return {
		object3D: model,

		/** @param {number} delta Seconds since the last frame — keeps the idle loop animating. */
		update(delta) {
			mixer.update(delta);
		},

		/** Stops the idle action and releases the model's GPU resources. */
		dispose() {
			mixer.stopAllAction();
			AssetLoader.disposeObject3D(model);
		},
	};
}
