import * as THREE from 'three';

const ASSET_URL = '/assets/models/vegetation/birch_trees_R7qMWzb7nk.glb';
const COMPONENTS = Object.freeze(['BirchTree_3', 'BirchTree_5', 'BirchTree_4', 'BirchTree_1', 'BirchTree_2']);
const TARGET_HEIGHT_METERS = 5.8;

function fallback(group, reason, extra = {}) {
	const status = Object.freeze({ status: 'procedural-fallback', reason, ...extra });
	if (group?.userData) group.userData.temperateBroadleafAssetUpgrade = status;
	return status;
}

function cloneMaterialForVegetation(source, disposedTextures) {
	const material = source.clone();
	const dispose = material.dispose.bind(material);
	material.dispose = () => {
		for (const value of Object.values(material)) if (value?.isTexture && !disposedTextures.has(value)) { disposedTextures.add(value); value.dispose(); }
		dispose();
	};
	return material;
}

export async function upgradeTemperateBroadleafAssets(group, { signal } = {}) {
	const sourceTrunk = group?.getObjectByName?.('vegetation-round-trunks');
	const sourceFoliage = group?.getObjectByName?.('vegetation-round-foliage');
	if (!sourceTrunk || !sourceFoliage || sourceTrunk.count <= 0) return fallback(group, 'no-broadleaf-trees');
	if (globalThis.matchMedia?.('(pointer: coarse)')?.matches) return fallback(group, 'mobile-lod-preserved');
	if (signal?.aborted) return fallback(group, 'abort-signal');

	let response;
	try { response = await fetch(ASSET_URL, { method: 'HEAD', cache: 'no-store', signal }); }
	catch { return fallback(group, signal?.aborted ? 'abort-signal' : 'head-failed'); }
	const contentLength = Number(response.headers.get('content-length'));
	if (!response.ok || (Number.isFinite(contentLength) && contentLength > 0 && contentLength < 512)) {
		return fallback(group, 'asset-unavailable-or-pointer', { contentLength });
	}

	const [{ AssetLoader }, materialCore] = await Promise.all([
		import('../assetLoader.js'), import('../materials/MaterialAssignmentCore.js'),
	]);
	const model = await new AssetLoader().loadModel(ASSET_URL);
	if (signal?.aborted) { AssetLoader.disposeObject3D(model); return fallback(group, 'abort-signal'); }
	if (model.userData?.isPlaceholder) { AssetLoader.disposeObject3D(model); return fallback(group, 'placeholder'); }
	model.updateMatrixWorld(true);

	const components = COMPONENTS.map((name) => model.getObjectByName(name));
	if (components.some((component) => !component)) {
		AssetLoader.disposeObject3D(model);
		return fallback(group, 'missing-qualified-component');
	}

	const manifests = [], addedMeshes = [], disposedTextures = new Set();
	const treeMatrix = new THREE.Matrix4(), finalMatrix = new THREE.Matrix4();
	for (let variantIndex = 0; variantIndex < components.length; variantIndex++) {
		const component = components[variantIndex];
		const validation = materialCore.validateMaterialAssignment(component);
		if (!validation.ok || validation.meshCount < 2) {
			AssetLoader.disposeObject3D(model);
			return fallback(group, 'shared-material-validation-failed', { component: COMPONENTS[variantIndex] });
		}
		const variantCount = Math.ceil((sourceTrunk.count - variantIndex) / components.length);
		if (variantCount <= 0) continue;
		manifests.push(materialCore.createMaterialManifest(component, {
			metadata: { id: `temperate-birch:${COMPONENTS[variantIndex]}`, category: 'vegetation', src: ASSET_URL.slice(1) },
			placement: { strategy: 'reuse-round-instance-matrix-modulo', variantIndex, variantCount },
		}));

		const bounds = new THREE.Box3().setFromObject(component);
		const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
		const s = TARGET_HEIGHT_METERS / size.y;
		const normalization = new THREE.Matrix4().makeScale(s, s, s)
			.multiply(new THREE.Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z));
		component.traverse((assetMesh) => {
			if (!assetMesh?.isMesh || !assetMesh.material) return;
			const material = cloneMaterialForVegetation(assetMesh.material, disposedTextures);
			const instanced = new THREE.InstancedMesh(assetMesh.geometry, material, variantCount);
			instanced.name = `vegetation-birch-asset-${variantIndex}-${addedMeshes.length}`;
			instanced.castShadow = sourceTrunk.castShadow || sourceFoliage.castShadow;
			instanced.receiveShadow = sourceTrunk.receiveShadow || sourceFoliage.receiveShadow;
			let targetIndex = 0;
			for (let sourceIndex = variantIndex; sourceIndex < sourceTrunk.count; sourceIndex += components.length) {
				sourceTrunk.getMatrixAt(sourceIndex, treeMatrix);
				instanced.setMatrixAt(targetIndex++, finalMatrix.copy(treeMatrix).multiply(normalization).multiply(assetMesh.matrixWorld));
			}
			instanced.count = targetIndex; instanced.instanceMatrix.needsUpdate = true;
			group.add(instanced); addedMeshes.push(instanced);
		});
	}

	for (const component of components) component.traverse((node) => { if (node?.isMesh) node.material?.dispose(); });
	sourceTrunk.visible = false; sourceFoliage.visible = false;
	const status = Object.freeze({
		status: 'active', assetUrl: ASSET_URL.slice(1), treeCount: sourceTrunk.count,
		variantCount: components.length, meshCount: addedMeshes.length, manifests: Object.freeze(manifests),
	});
	group.userData.temperateBroadleafAssetUpgrade = status;
	return status;
}
