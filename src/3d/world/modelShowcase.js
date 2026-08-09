/**
 * Static owner-model showcase near the initial player spawn.
 *
 * The original character, dragon, wyvern, and throne files remain untouched as provenance assets.
 * This module loads their decimated `_runtime.glb` counterparts, normalizes every source to a
 * predictable world-space size, and places the complete collection between the initial player and
 * the Umit settlement. The models are intentionally static: none of these files contains a rig or
 * animation clips, so routing them through the Mixamo NPC or flying-dragon controllers would imply
 * capabilities the assets do not have.
 * @module world/modelShowcase
 */

import * as THREE from 'three';
import { AssetLoader } from '../assetLoader.js';

/**
 * Offsets are relative to `PLAYER_CONFIG`'s resolved `spawnWorld`. The two people form the front
 * pair, the throne sits directly behind them, and the five creatures form a wider back row. Every
 * entry stays within the default third-person camera's 40m maximum orbit distance.
 */
export const MODEL_SHOWCASE_ASSIGNMENTS = Object.freeze([
	Object.freeze({
		id: 'showcase-casual-confidence',
		modelUrl: 'assets/models/characters/casual_confidence_runtime.glb',
		offsetXMeters: -5,
		offsetZMeters: -9,
		targetMaxDimensionMeters: 2,
		rotationYRadians: Math.PI,
	}),
	Object.freeze({
		id: 'showcase-elven-warrior',
		modelUrl: 'assets/models/characters/elven_warrior_runtime.glb',
		offsetXMeters: 5,
		offsetZMeters: -9,
		targetMaxDimensionMeters: 2,
		rotationYRadians: Math.PI,
	}),
	Object.freeze({
		id: 'showcase-iron-throne',
		modelUrl: 'assets/models/props/iron_throne/iron_throne_textured_runtime.glb',
		offsetXMeters: 0,
		offsetZMeters: -14,
		targetMaxDimensionMeters: 4.2,
		rotationYRadians: Math.PI,
	}),
	Object.freeze({
		id: 'showcase-storm-dragon',
		modelUrl: 'assets/models/creatures/dragons/storm_dragon_textured_runtime.glb',
		offsetXMeters: -20,
		offsetZMeters: -21,
		targetMaxDimensionMeters: 7.5,
		rotationYRadians: 0.28,
	}),
	Object.freeze({
		id: 'showcase-verdant-dragon',
		modelUrl: 'assets/models/creatures/dragons/verdant_dragon_textured_runtime.glb',
		offsetXMeters: -10,
		offsetZMeters: -20,
		targetMaxDimensionMeters: 7.5,
		rotationYRadians: 0.14,
	}),
	Object.freeze({
		id: 'showcase-frostwing-dragon',
		modelUrl: 'assets/models/creatures/dragons/frostwing_dragon_textured_runtime.glb',
		offsetXMeters: 0,
		offsetZMeters: -22,
		targetMaxDimensionMeters: 7.5,
		rotationYRadians: 0,
		liftMeters: 5,
	}),
	Object.freeze({
		id: 'showcase-golden-ember-dragon',
		modelUrl: 'assets/models/creatures/dragons/golden_ember_dragon_textured_runtime.glb',
		offsetXMeters: 10,
		offsetZMeters: -20,
		targetMaxDimensionMeters: 7.5,
		rotationYRadians: -0.14,
	}),
	Object.freeze({
		id: 'showcase-obsidian-wyvern',
		modelUrl: 'assets/models/creatures/dragons/obsidian_wyvern_textured_runtime.glb',
		offsetXMeters: 20,
		offsetZMeters: -21,
		targetMaxDimensionMeters: 7.5,
		rotationYRadians: -0.28,
		liftMeters: 5,
	}),
]);

/**
 * Scales, horizontally centers, and ground-aligns one loaded model around its requested world point.
 * The bounding box is recomputed after rotation and scale, so sources with different local origins
 * or axis-aligned extents all land with their real lowest rendered vertex on terrain.
 * @param {THREE.Object3D} model
 * @param {object} placement
 * @param {number} placement.worldX
 * @param {number} placement.worldZ
 * @param {number} placement.groundY
 * @param {number} placement.targetMaxDimensionMeters
 * @param {number} placement.rotationYRadians
 * @param {number} [placement.liftMeters] Additional height for flight-pose models.
 */
export function normalizeShowcaseModel(model, {
	worldX,
	worldZ,
	groundY,
	targetMaxDimensionMeters,
	rotationYRadians,
	liftMeters = 0,
}) {
	model.rotation.y = rotationYRadians;
	model.updateMatrixWorld(true);
	const sourceBounds = new THREE.Box3().setFromObject(model);
	const sourceSize = sourceBounds.getSize(new THREE.Vector3());
	const sourceMaxDimension = Math.max(sourceSize.x, sourceSize.y, sourceSize.z);
	if (!Number.isFinite(sourceMaxDimension) || sourceMaxDimension <= 0) {
		throw new Error('Showcase model has no finite, non-zero rendered bounds.');
	}

	model.scale.multiplyScalar(targetMaxDimensionMeters / sourceMaxDimension);
	model.updateMatrixWorld(true);
	const scaledBounds = new THREE.Box3().setFromObject(model);
	const scaledCenter = scaledBounds.getCenter(new THREE.Vector3());
	model.position.x += worldX - scaledCenter.x;
	model.position.y += groundY + liftMeters - scaledBounds.min.y;
	model.position.z += worldZ - scaledCenter.z;
	model.updateMatrixWorld(true);
}

/**
 * Loads and places every configured static model around an anchor point.
 * @param {object} options
 * @param {import('../assetLoader.js').AssetLoader} options.assetLoader
 * @param {{x: number, z: number}} options.anchor Initial player spawn in world meters.
 * @param {(worldX: number, worldZ: number) => number} options.sampleGroundY
 * @returns {Promise<{object3D: THREE.Group, models: THREE.Object3D[], dispose: () => void}>}
 */
export async function spawnModelShowcase({ assetLoader, anchor, sampleGroundY }) {
	const group = new THREE.Group();
	group.name = 'owner-model-showcase';
	const loadedModels = await Promise.all(MODEL_SHOWCASE_ASSIGNMENTS.map(async (assignment) => {
		const worldX = anchor.x + assignment.offsetXMeters;
		const worldZ = anchor.z + assignment.offsetZMeters;
		let model = null;
		try {
			model = await assetLoader.loadModel(assignment.modelUrl, {
				fallbackColor: 0xff00ff,
				fallbackSize: 1,
			});
			let isPlaceholder = false;
			model.traverse((node) => { isPlaceholder ||= node.userData.isPlaceholder === true; });
			if (isPlaceholder) throw new Error('AssetLoader returned a placeholder instead of the requested GLB.');
			model.name = assignment.id;
			model.userData.showcaseAssetUrl = assignment.modelUrl;
			model.userData.showcaseGroundY = sampleGroundY(worldX, worldZ);
			model.userData.showcaseLiftMeters = assignment.liftMeters ?? 0;
			model.traverse((node) => {
				if (!node.isMesh) return;
				node.castShadow = true;
				node.receiveShadow = true;
			});
			normalizeShowcaseModel(model, {
				worldX,
				worldZ,
				groundY: model.userData.showcaseGroundY,
				targetMaxDimensionMeters: assignment.targetMaxDimensionMeters,
				rotationYRadians: assignment.rotationYRadians,
				liftMeters: model.userData.showcaseLiftMeters,
			});
			group.add(model);
			return model;
		} catch (error) {
			if (model) AssetLoader.disposeObject3D(model);
			console.warn(`[world/modelShowcase] Skipping "${assignment.id}" after placement failed.`, error);
			return null;
		}
	}));
	const models = loadedModels.filter(Boolean);

	let disposed = false;
	return {
		object3D: group,
		models,
		dispose() {
			if (disposed) return;
			disposed = true;
			group.parent?.remove(group);
			AssetLoader.disposeObject3D(group);
		},
	};
}
