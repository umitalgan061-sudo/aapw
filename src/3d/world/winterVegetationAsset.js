/**
 * Optional real-asset upgrade for the procedural far-north snow pines.
 *
 * The repository keeps vegetation binaries in Git LFS. Some CI/dev checkouts can therefore expose
 * the ~130 byte LFS pointer text instead of the actual GLB. `vegetation.js` must remain immediately
 * renderable in that state, so the procedural snow pine is still the authority for placement,
 * determinism and fallback visuals. This module only replaces its visible geometry after a verified
 * materialized winter GLB has loaded successfully.
 * @module world/winterVegetationAsset
 */

import * as THREE from 'three';
import { AssetLoader } from '../assetLoader.js';

export const WINTER_VEGETATION_ASSET_POLICY = Object.freeze({
	id: 'winter-vegetation-materialized-asset-2026-08-21-v1',
	candidates: Object.freeze([
		'assets/models/vegetation/winter_tree.glb',
		'assets/models/vegetation/dead_trees_with_snow_iEuwXWner0.glb',
	]),
	proceduralTrunkName: 'vegetation-snow-pine-trunks',
	proceduralFoliageName: 'vegetation-snow-pine-foliage',
	targetHeightMeters: 8.6,
	minSourceHeightMeters: 0.05,
	maxHorizontalToHeightRatio: 1.8,
});

const inFlightUpgrades = new WeakMap();

function makeStatus(status, extra = {}) {
	return Object.freeze({
		policyId: WINTER_VEGETATION_ASSET_POLICY.id,
		status,
		...extra,
	});
}

function findNamedChild(group, name) {
	return group?.children?.find((child) => child?.name === name) ?? null;
}

/** Returns the two deterministic procedural meshes whose instance matrices are reused by the GLB. */
export function findProceduralWinterMeshes(group) {
	return {
		trunkMesh: findNamedChild(group, WINTER_VEGETATION_ASSET_POLICY.proceduralTrunkName),
		foliageMesh: findNamedChild(group, WINTER_VEGETATION_ASSET_POLICY.proceduralFoliageName),
	};
}

/** AssetLoader's graceful model fallback is intentionally not considered a successful winter tree. */
export function isPlaceholderWinterAsset(model) {
	if (!model) return true;
	if (model.userData?.isPlaceholder) return true;
	let placeholder = false;
	model.traverse?.((node) => {
		if (node.userData?.isPlaceholder) placeholder = true;
	});
	return placeholder;
}

/**
 * GLTFLoader normally emits one material per primitive. Array-material meshes are rejected here
 * because `disposeVegetation()` historically owns simple Mesh/InstancedMesh resources and should not
 * gain a special disposal contract merely because an optional cosmetic asset loaded.
 */
export function collectWinterAssetMeshes(model) {
	const meshes = [];
	model?.updateMatrixWorld?.(true);
	model?.traverse?.((node) => {
		if (!node?.isMesh || !node.geometry?.getAttribute?.('position') || !node.material) return;
		if (Array.isArray(node.material)) return;
		meshes.push(node);
	});
	return meshes;
}

export function measureWinterAsset(model) {
	model?.updateMatrixWorld?.(true);
	const bounds = new THREE.Box3().setFromObject(model);
	if (bounds.isEmpty()) return null;
	const size = bounds.getSize(new THREE.Vector3());
	const center = bounds.getCenter(new THREE.Vector3());
	const horizontal = Math.max(size.x, size.z);
	const horizontalToHeightRatio = size.y > 0 ? horizontal / size.y : Infinity;
	return { bounds, size, center, horizontalToHeightRatio };
}

function hasFiniteMeasurement(measurement) {
	const values = [
		measurement.size.x,
		measurement.size.y,
		measurement.size.z,
		measurement.center.x,
		measurement.center.y,
		measurement.center.z,
		measurement.bounds.min.x,
		measurement.bounds.min.y,
		measurement.bounds.min.z,
		measurement.bounds.max.x,
		measurement.bounds.max.y,
		measurement.bounds.max.z,
		measurement.horizontalToHeightRatio,
	];
	return values.every(Number.isFinite);
}

export function validateWinterAsset(model, policy = WINTER_VEGETATION_ASSET_POLICY) {
	if (isPlaceholderWinterAsset(model)) return { valid: false, reason: 'placeholder' };
	const meshes = collectWinterAssetMeshes(model);
	if (meshes.length === 0) return { valid: false, reason: 'no-renderable-mesh' };
	const measurement = measureWinterAsset(model);
	if (!measurement) return { valid: false, reason: 'empty-bounds' };
	if (!hasFiniteMeasurement(measurement)) return { valid: false, reason: 'non-finite-bounds' };
	if (measurement.size.y < policy.minSourceHeightMeters) return { valid: false, reason: 'degenerate-height' };
	if (measurement.horizontalToHeightRatio > policy.maxHorizontalToHeightRatio) {
		return { valid: false, reason: 'implausibly-wide-tree' };
	}
	return { valid: true, meshes, measurement };
}

/** Maps the loaded model to an upright, ground-based 8.6 m reference tree before tree-local scale. */
export function createWinterAssetNormalization(measurement, targetHeightMeters = WINTER_VEGETATION_ASSET_POLICY.targetHeightMeters) {
	const scale = targetHeightMeters / measurement.size.y;
	const translateToBase = new THREE.Matrix4().makeTranslation(
		-measurement.center.x,
		-measurement.bounds.min.y,
		-measurement.center.z,
	);
	return new THREE.Matrix4().makeScale(scale, scale, scale).multiply(translateToBase);
}

function cloneMaterialWithTextureCleanup(sourceMaterial, disposedTextures) {
	const material = sourceMaterial.clone();
	const originalDispose = material.dispose.bind(material);
	material.dispose = function disposeWinterAssetMaterial() {
		for (const key of Object.keys(material)) {
			const value = material[key];
			if (!value?.isTexture || disposedTextures.has(value)) continue;
			disposedTextures.add(value);
			value.dispose();
		}
		originalDispose();
	};
	return material;
}

function disposeRejectedModel(model) {
	if (!model) return;
	AssetLoader.disposeObject3D(model);
}

/**
 * Replacement meshes reuse the source geometries and textures, but not the source materials.
 * Material.dispose() does not dispose textures in Three.js, so releasing these now is safe and
 * prevents a successfully loaded source scene from retaining needless GPU material programs.
 */
function disposeSourceMaterials(modelMeshes) {
	const disposedMaterials = new Set();
	for (const mesh of modelMeshes) {
		const material = mesh.material;
		if (!material || disposedMaterials.has(material)) continue;
		disposedMaterials.add(material);
		material.dispose();
	}
}

function applyWinterAssetInstances({ group, sourceMesh, sourceFoliageMesh, modelMeshes, normalization, assetUrl }) {
	const count = sourceMesh.count;
	const treeMatrix = new THREE.Matrix4();
	const finalMatrix = new THREE.Matrix4();
	const addedMeshes = [];
	const disposedTextures = new Set();

	for (let meshIndex = 0; meshIndex < modelMeshes.length; meshIndex++) {
		const sourceAssetMesh = modelMeshes[meshIndex];
		const material = cloneMaterialWithTextureCleanup(sourceAssetMesh.material, disposedTextures);
		const instanced = new THREE.InstancedMesh(sourceAssetMesh.geometry, material, count);
		instanced.name = `vegetation-snow-asset-${meshIndex}`;
		instanced.instanceMatrix.setUsage(THREE.StaticDrawUsage);
		instanced.castShadow = sourceMesh.castShadow || sourceFoliageMesh.castShadow;
		instanced.receiveShadow = sourceMesh.receiveShadow || sourceFoliageMesh.receiveShadow;
		instanced.userData.winterVegetationAsset = Object.freeze({ assetUrl, meshIndex });

		for (let instanceIndex = 0; instanceIndex < count; instanceIndex++) {
			sourceMesh.getMatrixAt(instanceIndex, treeMatrix);
			finalMatrix.copy(treeMatrix).multiply(normalization).multiply(sourceAssetMesh.matrixWorld);
			instanced.setMatrixAt(instanceIndex, finalMatrix);
		}
		instanced.instanceMatrix.needsUpdate = true;
		group.add(instanced);
		addedMeshes.push(instanced);
	}
	return addedMeshes;
}

function markNorthClimateRepresentation(group, assetUrl, meshCount, treeCount) {
	const previous = group.userData.northClimateVegetation ?? {};
	group.userData.northClimateVegetation = Object.freeze({
		...previous,
		liveRepresentation: 'materialized-instanced-winter-glb',
		winterAssetUrl: assetUrl,
		winterAssetMeshCount: meshCount,
		winterAssetTreeCount: treeCount,
	});
}

function markCancelled(group, treeCount, attemptedAssets, reason = 'abort-signal') {
	const status = makeStatus('cancelled', { treeCount, attemptedAssets, reason });
	if (group?.userData) group.userData.winterVegetationAssetUpgrade = status;
	return status;
}

async function performWinterVegetationAssetUpgrade(group, {
	assetLoader,
	candidates,
	targetHeightMeters,
	signal,
}) {
	const { trunkMesh, foliageMesh } = findProceduralWinterMeshes(group);
	if (!trunkMesh || !foliageMesh || trunkMesh.count <= 0) {
		const status = makeStatus('no-winter-trees', { attemptedAssets: 0 });
		if (group?.userData) group.userData.winterVegetationAssetUpgrade = status;
		return status;
	}

	if (signal?.aborted) return markCancelled(group, trunkMesh.count, 0);

	group.userData.winterVegetationAssetUpgrade = makeStatus('loading', {
		treeCount: trunkMesh.count,
		attemptedAssets: 0,
	});

	const rejected = [];
	for (const assetUrl of candidates) {
		if (signal?.aborted) return markCancelled(group, trunkMesh.count, rejected.length);

		let model;
		try {
			model = await assetLoader.loadModel(assetUrl, { fallbackColor: 0xdce8ea, fallbackSize: 1 });
		} catch (error) {
			if (signal?.aborted) return markCancelled(group, trunkMesh.count, rejected.length);
			rejected.push(Object.freeze({ assetUrl, reason: 'loader-threw' }));
			continue;
		}

		if (signal?.aborted) {
			disposeRejectedModel(model);
			return markCancelled(group, trunkMesh.count, rejected.length + 1);
		}

		const validation = validateWinterAsset(model);
		if (!validation.valid) {
			rejected.push(Object.freeze({ assetUrl, reason: validation.reason }));
			disposeRejectedModel(model);
			continue;
		}

		const normalization = createWinterAssetNormalization(validation.measurement, targetHeightMeters);
		const addedMeshes = applyWinterAssetInstances({
			group,
			sourceMesh: trunkMesh,
			sourceFoliageMesh: foliageMesh,
			modelMeshes: validation.meshes,
			normalization,
			assetUrl,
		});
		disposeSourceMaterials(validation.meshes);

		trunkMesh.visible = false;
		foliageMesh.visible = false;
		markNorthClimateRepresentation(group, assetUrl, addedMeshes.length, trunkMesh.count);
		const status = makeStatus('active', {
			assetUrl,
			treeCount: trunkMesh.count,
			meshCount: addedMeshes.length,
			attemptedAssets: rejected.length + 1,
			rejected: Object.freeze(rejected),
		});
		group.userData.winterVegetationAssetUpgrade = status;
		return status;
	}

	const status = makeStatus('procedural-fallback', {
		treeCount: trunkMesh.count,
		attemptedAssets: rejected.length,
		rejected: Object.freeze(rejected),
	});
	group.userData.winterVegetationAssetUpgrade = status;
	return status;
}

/**
 * Attempts each known winter GLB in order. Pointer-only/corrupt/missing/implausible assets are
 * rejected and the already-visible procedural snow pines remain untouched. On success, every GLB
 * primitive is instanced using the exact deterministic snow-pine matrices; the procedural pair is
 * only hidden after all replacement meshes are ready. Re-entrant callers share one in-flight load,
 * and an optional AbortSignal can cancel a page that is tearing down without leaving detached meshes.
 */
export function upgradeWinterVegetationAssets(group, {
	assetLoader = new AssetLoader(),
	candidates = WINTER_VEGETATION_ASSET_POLICY.candidates,
	targetHeightMeters = WINTER_VEGETATION_ASSET_POLICY.targetHeightMeters,
	signal,
} = {}) {
	if (!group?.userData) return Promise.resolve(makeStatus('invalid-group', { attemptedAssets: 0 }));
	const existing = group.userData.winterVegetationAssetUpgrade;
	if (['active', 'procedural-fallback', 'no-winter-trees', 'cancelled'].includes(existing?.status)) {
		return Promise.resolve(existing);
	}

	const inFlight = inFlightUpgrades.get(group);
	if (inFlight) return inFlight;

	const promise = performWinterVegetationAssetUpgrade(group, {
		assetLoader,
		candidates,
		targetHeightMeters,
		signal,
	}).finally(() => {
		if (inFlightUpgrades.get(group) === promise) inFlightUpgrades.delete(group);
	});
	inFlightUpgrades.set(group, promise);
	return promise;
}
