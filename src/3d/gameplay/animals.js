/**
 * Wild animals (FAZ 6, first pass — wolf only). Static/idling, same starting scope
 * `gameplay/npc.js` itself had in run 20 before patrol/name-tags landed later: no AI, pathing, or
 * player-awareness yet, just a real rigged model standing in the world with a looping idle clip.
 * @module gameplay/animals
 */

import * as THREE from 'three';
import { AssetLoader } from '../assetLoader.js';

/**
 * Removes any direct child of `object3D` whose name is in `names`, disposing its GPU resources.
 * Used to strip the wolf glTF's bundled non-skinned "Circle" ground-shadow-catcher disc — see
 * `config.js`'s `ANIMAL_CONFIG.STRIP_CHILD_NAMES` doc comment for why it exists in the source file.
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
 * @returns {Promise<{object3D: THREE.Object3D, update: (delta: number) => void, dispose: () => void}>}
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
}) {
	const model = await assetLoader.loadModel(modelUrl, { fallbackColor: 0x5a5148, fallbackSize: 1.2 });
	stripNamedChildren(model, stripChildNames);
	if (name) model.name = name;
	model.position.set(worldX, groundY, worldZ);
	model.rotation.y = rotationYRadians;

	const mixer = new THREE.AnimationMixer(model);
	const idleClip = THREE.AnimationClip.findByName(model.animations, idleClipName);
	if (idleClip) mixer.clipAction(idleClip).play();

	return {
		object3D: model,

		/** @param {number} delta Seconds since the last frame. */
		update(delta) {
			mixer.update(delta);
		},

		/** Stops all animation actions and releases the model's GPU resources. */
		dispose() {
			mixer.stopAllAction();
			AssetLoader.disposeObject3D(model);
		},
	};
}
