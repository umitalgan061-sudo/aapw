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
	const invalid = validateWinterAsset(makeWideCluster());
	assert.equal(invalid.valid, false);
	assert.equal(invalid.reason, 'implausibly-wide-tree');
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

	const replacements = group.children.filter((child) => child.name.startsWith('vegetation-snow-asset-'));
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
	assert.equal(group.children.filter((child) => child.name.startsWith('vegetation-snow-asset-')).length, 0);
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
}

console.log('[checkWinterVegetationAssetUpgrade] PASS: materialized GLB upgrade preserves procedural placement and safe fallback.');
