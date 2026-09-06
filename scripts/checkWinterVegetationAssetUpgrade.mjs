#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import {
	WINTER_VEGETATION_ASSET_POLICY,
	collectWinterAssetMeshes,
	createWinterAssetNormalization,
	findProceduralWinterMeshes,
	upgradeWinterVegetationAssets,
	validateWinterAsset,
} from '../src/3d/world/winterVegetationAsset.js';

function makeProceduralGroup(count = 2) {
	const group = new THREE.Group();
	const trunk = new THREE.InstancedMesh(
		new THREE.CylinderGeometry(0.2, 0.35, 3.2, 6),
		new THREE.MeshStandardMaterial({ color: 0x4f443b }),
		count,
	);
	const foliage = new THREE.InstancedMesh(
		new THREE.ConeGeometry(2.2, 5.9, 7),
		new THREE.MeshStandardMaterial({ color: 0xcad9d6 }),
		count,
	);
	trunk.name = WINTER_VEGETATION_ASSET_POLICY.proceduralTrunkName;
	foliage.name = WINTER_VEGETATION_ASSET_POLICY.proceduralFoliageName;
	trunk.castShadow = true;
	foliage.receiveShadow = true;
	const first = new THREE.Matrix4().makeTranslation(10, 4, -5);
	const second = new THREE.Matrix4().makeTranslation(-20, 7, 30);
	if (count > 0) {
		trunk.setMatrixAt(0, first);
		foliage.setMatrixAt(0, first);
	}
	if (count > 1) {
		trunk.setMatrixAt(1, second);
		foliage.setMatrixAt(1, second);
	}
	trunk.count = count;
	foliage.count = count;
	group.add(trunk, foliage);
	group.userData.northClimateVegetation = Object.freeze({
		winterTreeCount: count,
		liveRepresentation: 'instanced-procedural-snow-pine',
	});
	return group;
}

function makeValidWinterModel() {
	const root = new THREE.Group();
	const trunk = new THREE.Mesh(
		new THREE.BoxGeometry(0.8, 3.2, 0.8),
		new THREE.MeshStandardMaterial({ color: 0x5a4b42 }),
	);
	trunk.position.y = 1.6;
	const crown = new THREE.Mesh(
		new THREE.ConeGeometry(2.0, 5.5, 7),
		new THREE.MeshStandardMaterial({ color: 0xe5eeee }),
	);
	crown.position.y = 5.25;
	root.add(trunk, crown);
	root.updateMatrixWorld(true);
	return root;
}

function makeMultiMaterialWinterModel() {
	const albedo = new THREE.Texture();
	albedo.offset.set(0.17, 0.23);
	albedo.repeat.set(1.7, 2.3);
	albedo.rotation = 0.19;
	const normal = new THREE.Texture();
	const roughness = new THREE.Texture();
	const bark = new THREE.MeshStandardMaterial({ map: albedo, normalMap: normal, roughnessMap: roughness });
	const snow = new THREE.MeshStandardMaterial({ map: albedo, transparent: true, roughnessMap: roughness });
	const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.9, 4.2, 0.9), [bark, snow]);
	mesh.position.y = 2.1;
	const root = new THREE.Group();
	root.add(mesh);
	root.updateMatrixWorld(true);
	return { root, mesh, albedo, normal, roughness };
}

function makePlaceholder() {
	const mesh = new THREE.Mesh(
		new THREE.BoxGeometry(1, 1, 1),
		new THREE.MeshStandardMaterial({ color: 0xff00ff }),
	);
	mesh.userData.isPlaceholder = true;
	return mesh;
}

function makeWideCluster() {
	const root = new THREE.Group();
	const mesh = new THREE.Mesh(
		new THREE.BoxGeometry(20, 2, 2),
		new THREE.MeshStandardMaterial({ color: 0xffffff }),
	);
	mesh.position.y = 1;
	root.add(mesh);
	root.updateMatrixWorld(true);
	return root;
}

function replacementMeshes(group) {
	return group.children.filter((child) => child.name.startsWith('vegetation-snow-asset-'));
}

{
	const group = makeProceduralGroup(2);
	const source = findProceduralWinterMeshes(group);
	assert.equal(source.trunkMesh?.count, 2);
	assert.equal(source.foliageMesh?.count, 2);
}

{
	const valid = makeValidWinterModel();
	const validation = validateWinterAsset(valid);
	assert.equal(validation.valid, true);
	assert.equal(collectWinterAssetMeshes(valid).length, 2);
	const normalization = createWinterAssetNormalization(validation.measurement);
	assert.ok(normalization instanceof THREE.Matrix4);
}

{
	const source = makeMultiMaterialWinterModel();
	const validation = validateWinterAsset(source.root);
	assert.equal(validation.valid, true, 'authored multi-material GLB primitives must remain eligible');
	assert.equal(collectWinterAssetMeshes(source.root).length, 1);
	const group = makeProceduralGroup(1);
	const status = await upgradeWinterVegetationAssets(group, {
		assetLoader: { async loadModel() { return source.root; } },
		candidates: [WINTER_VEGETATION_ASSET_POLICY.preferredSnowPineAsset],
		maxAnisotropy: 16,
	});
	assert.equal(status.status, 'active');
	const [replacement] = replacementMeshes(group);
	assert.ok(Array.isArray(replacement.material), 'source material groups must survive instancing');
	assert.equal(replacement.material.length, 2);
	assert.strictEqual(replacement.material[0].map, source.albedo, 'hydration must retain authored texture objects');
	assert.equal(source.albedo.colorSpace, THREE.SRGBColorSpace, 'albedo must decode as sRGB');
	assert.equal(source.normal.colorSpace, THREE.NoColorSpace, 'normal maps must stay linear data');
	assert.equal(source.roughness.colorSpace, THREE.NoColorSpace, 'roughness maps must stay linear data');
	assert.equal(source.albedo.minFilter, THREE.LinearMipmapLinearFilter);
	assert.equal(source.albedo.magFilter, THREE.LinearFilter);
	assert.equal(source.albedo.anisotropy, WINTER_VEGETATION_ASSET_POLICY.maxTextureAnisotropy,
		'renderer capability must be capped to the production texture budget');
	assert.equal(source.albedo.offset.x, 0.17, 'authored UV offset must not be rewritten');
	assert.equal(source.albedo.offset.y, 0.23);
	assert.equal(source.albedo.repeat.x, 1.7, 'authored UV scale must not be rewritten');
	assert.equal(source.albedo.repeat.y, 2.3);
	assert.equal(source.albedo.rotation, 0.19, 'authored UV rotation must not be rewritten');
}

{
	const source = makeValidWinterModel();
	source.children[1].material.map = new THREE.Texture();
	source.children[1].material.transparent = true;
	const group = makeProceduralGroup(2);
	const status = await upgradeWinterVegetationAssets(group, {
		assetLoader: { async loadModel() { return source; } },
		candidates: [WINTER_VEGETATION_ASSET_POLICY.preferredSnowPineAsset],
	});
	assert.equal(status.treeCount, 2, 'foliage density must not add geographic tree placements');
	const density = replacementMeshes(group).find((mesh) => mesh.userData.winterVegetationAsset?.detailLayer);
	assert.ok(density, 'preferred mapped foliage must receive one deterministic inner density layer');
	assert.equal(density.count, 2, 'density layer must reuse the exact authoritative tree matrix count');
	const baseFoliage = replacementMeshes(group).find((mesh) => mesh.name === 'vegetation-snow-asset-1');
	const baseMatrix = new THREE.Matrix4();
	const densityMatrix = new THREE.Matrix4();
	const basePosition = new THREE.Vector3();
	const densityPosition = new THREE.Vector3();
	baseFoliage.getMatrixAt(0, baseMatrix);
	density.getMatrixAt(0, densityMatrix);
	baseMatrix.decompose(basePosition, new THREE.Quaternion(), new THREE.Vector3());
	densityMatrix.decompose(densityPosition, new THREE.Quaternion(), new THREE.Vector3());
	assert.ok(basePosition.distanceTo(densityPosition) < 1e-6,
		'crown density may rotate locally but must not move the canonical tree point');
}

{
	const invalid = validateWinterAsset(makeWideCluster());
	assert.equal(invalid.valid, false);
	assert.equal(invalid.reason, 'implausibly-wide-tree');
}

{
	const nonFinite = makeValidWinterModel();
	nonFinite.scale.x = Number.NaN;
	nonFinite.updateMatrixWorld(true);
	const validation = validateWinterAsset(nonFinite);
	assert.equal(validation.valid, false);
	assert.equal(validation.reason, 'non-finite-bounds');
}

{
	const group = makeProceduralGroup(2);
	const attempts = [];
	const loader = {
		async loadModel(url) {
			attempts.push(url);
			return attempts.length === 1 ? makePlaceholder() : makeValidWinterModel();
		},
	};
	const status = await upgradeWinterVegetationAssets(group, {
		assetLoader: loader,
		candidates: ['pointer.glb', 'materialized.glb'],
	});
	assert.equal(status.status, 'active');
	assert.equal(status.assetUrl, 'materialized.glb');
	assert.equal(status.attemptedAssets, 2);
	assert.equal(status.rejected[0].reason, 'placeholder');
	assert.deepEqual(attempts, ['pointer.glb', 'materialized.glb']);

	const { trunkMesh, foliageMesh } = findProceduralWinterMeshes(group);
	assert.equal(trunkMesh.visible, false, 'procedural trunk should hide only after successful upgrade');
	assert.equal(foliageMesh.visible, false, 'procedural foliage should hide only after successful upgrade');
	assert.equal(group.userData.northClimateVegetation.liveRepresentation, 'materialized-instanced-winter-glb');

	const replacements = replacementMeshes(group);
	assert.equal(replacements.length, 2, 'both GLB primitives should remain visible through instancing');
	for (const replacement of replacements) {
		assert.equal(replacement.count, 2);
		assert.equal(replacement.castShadow, true);
		assert.equal(replacement.receiveShadow, true);
	}

	const p0 = new THREE.Vector3();
	const p1 = new THREE.Vector3();
	const matrix = new THREE.Matrix4();
	replacements[0].getMatrixAt(0, matrix);
	matrix.decompose(p0, new THREE.Quaternion(), new THREE.Vector3());
	replacements[0].getMatrixAt(1, matrix);
	matrix.decompose(p1, new THREE.Quaternion(), new THREE.Vector3());
	assert.ok(Math.abs((p1.x - p0.x) + 30) < 1e-6, 'asset instances must preserve deterministic X separation');
	assert.ok(Math.abs((p1.y - p0.y) - 3) < 1e-6, 'asset instances must preserve deterministic Y separation');
	assert.ok(Math.abs((p1.z - p0.z) - 35) < 1e-6, 'asset instances must preserve deterministic Z separation');

	let unexpectedLoads = 0;
	const repeatedStatus = await upgradeWinterVegetationAssets(group, {
		assetLoader: { async loadModel() { unexpectedLoads++; throw new Error('must not reload active upgrade'); } },
	});
	assert.strictEqual(repeatedStatus, status, 'active status should be stable and idempotent');
	assert.equal(unexpectedLoads, 0);
	assert.equal(replacementMeshes(group).length, 2, 'idempotent call must not duplicate replacement meshes');
}

{
	const group = makeProceduralGroup(1);
	const model = makeValidWinterModel();
	let sourceMaterialDisposals = 0;
	model.traverse((node) => {
		if (!node.isMesh) return;
		const originalDispose = node.material.dispose.bind(node.material);
		node.material.dispose = () => {
			sourceMaterialDisposals++;
			originalDispose();
		};
	});
	const status = await upgradeWinterVegetationAssets(group, {
		assetLoader: { async loadModel() { return model; } },
		candidates: ['materialized.glb'],
	});
	assert.equal(status.status, 'active');
	assert.equal(sourceMaterialDisposals, 2, 'source scene materials must be released after cloned instance materials exist');
	assert.equal(replacementMeshes(group).length, 2);
}

{
	const group = makeProceduralGroup(1);
	let resolveModel;
	let loadCalls = 0;
	const deferredModel = new Promise((resolve) => { resolveModel = resolve; });
	const loader = {
		async loadModel() {
			loadCalls++;
			return deferredModel;
		},
	};
	const firstPromise = upgradeWinterVegetationAssets(group, { assetLoader: loader, candidates: ['winter.glb'] });
	const secondPromise = upgradeWinterVegetationAssets(group, { assetLoader: loader, candidates: ['winter.glb'] });
	assert.strictEqual(firstPromise, secondPromise, 're-entrant callers must share one in-flight upgrade promise');
	assert.equal(loadCalls, 1, 'concurrent callers must not issue duplicate GLB requests');
	resolveModel(makeValidWinterModel());
	const [firstStatus, secondStatus] = await Promise.all([firstPromise, secondPromise]);
	assert.strictEqual(firstStatus, secondStatus);
	assert.equal(firstStatus.status, 'active');
	assert.equal(replacementMeshes(group).length, 2, 'one source model must yield one replacement set');
}

{
	const group = makeProceduralGroup(1);
	const controller = new AbortController();
	controller.abort();
	let loadCalls = 0;
	const status = await upgradeWinterVegetationAssets(group, {
		assetLoader: { async loadModel() { loadCalls++; return makeValidWinterModel(); } },
		candidates: ['winter.glb'],
		signal: controller.signal,
	});
	assert.equal(status.status, 'cancelled');
	assert.equal(loadCalls, 0, 'pre-aborted scene must not start a GLB request');
	const { trunkMesh, foliageMesh } = findProceduralWinterMeshes(group);
	assert.equal(trunkMesh.visible, true);
	assert.equal(foliageMesh.visible, true);
}

{
	const group = makeProceduralGroup(1);
	const controller = new AbortController();
	const model = makeValidWinterModel();
	let disposedGeometries = 0;
	model.traverse((node) => {
		if (!node.isMesh) return;
		const originalDispose = node.geometry.dispose.bind(node.geometry);
		node.geometry.dispose = () => {
			disposedGeometries++;
			originalDispose();
		};
	});
	let resolveModel;
	const pendingModel = new Promise((resolve) => { resolveModel = resolve; });
	const statusPromise = upgradeWinterVegetationAssets(group, {
		assetLoader: { async loadModel() { return pendingModel; } },
		candidates: ['winter.glb'],
		signal: controller.signal,
	});
	controller.abort();
	resolveModel(model);
	const status = await statusPromise;
	assert.equal(status.status, 'cancelled');
	assert.equal(disposedGeometries, 2, 'asset resolving after teardown must be disposed immediately');
	assert.equal(replacementMeshes(group).length, 0, 'cancelled upgrade must not attach detached meshes');
	const { trunkMesh, foliageMesh } = findProceduralWinterMeshes(group);
	assert.equal(trunkMesh.visible, true);
	assert.equal(foliageMesh.visible, true);
}

{
	const group = makeProceduralGroup(1);
	const status = await upgradeWinterVegetationAssets(group, {
		assetLoader: { async loadModel() { return makePlaceholder(); } },
		candidates: ['pointer-a.glb', 'pointer-b.glb'],
	});
	assert.equal(status.status, 'procedural-fallback');
	assert.equal(status.attemptedAssets, 2);
	const { trunkMesh, foliageMesh } = findProceduralWinterMeshes(group);
	assert.equal(trunkMesh.visible, true);
	assert.equal(foliageMesh.visible, true);
	assert.equal(replacementMeshes(group).length, 0);
}

{
	const group = makeProceduralGroup(0);
	let loadCalls = 0;
	const status = await upgradeWinterVegetationAssets(group, {
		assetLoader: { async loadModel() { loadCalls++; return makeValidWinterModel(); } },
	});
	assert.equal(status.status, 'no-winter-trees');
	assert.equal(loadCalls, 0, 'south-only/empty scenes must not pay for a winter GLB request');
}

{
	const sceneManagerSource = await readFile(new URL('../src/3d/sceneManager.js', import.meta.url), 'utf8');
	assert.match(sceneManagerSource, /upgradeWinterVegetationAssets/,
		'sceneManager must wire the optional materialized winter asset upgrade into the live world');
	assert.match(sceneManagerSource, /winterVegetationAsset\.js/,
		'sceneManager must import the dedicated winter vegetation asset module');
	assert.match(sceneManagerSource, /maxAnisotropy:\s*renderer\.capabilities\.getMaxAnisotropy\(\)/,
		'sceneManager must pass live renderer filtering capability to hydrated winter textures');
}

console.log('[checkWinterVegetationAssetUpgrade] PASS: materialized GLB upgrade preserves placement, hydrated multi-material texture fidelity, lifecycle safety and fallback.');

