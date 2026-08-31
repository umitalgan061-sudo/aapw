#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
	WINTER_VEGETATION_ASSET_POLICY,
	upgradeWinterVegetationAssets,
} from '../src/3d/world/winterVegetationAsset.js';

function makeProceduralWinterGroup() {
	const group = new THREE.Group();
	const trunk = new THREE.InstancedMesh(
		new THREE.CylinderGeometry(0.2, 0.35, 3.2, 6),
		new THREE.MeshStandardMaterial({ color: 0x4f443b }),
		1,
	);
	const foliage = new THREE.InstancedMesh(
		new THREE.ConeGeometry(2.2, 5.9, 7),
		new THREE.MeshStandardMaterial({ color: 0xdce8ea }),
		1,
	);
	trunk.name = WINTER_VEGETATION_ASSET_POLICY.proceduralTrunkName;
	foliage.name = WINTER_VEGETATION_ASSET_POLICY.proceduralFoliageName;
	const placement = new THREE.Matrix4()
		.makeRotationY(Math.PI / 3)
		.setPosition(new THREE.Vector3(12, 5, -18));
	trunk.setMatrixAt(0, placement);
	foliage.setMatrixAt(0, placement);
	trunk.count = 1;
	foliage.count = 1;
	group.add(trunk, foliage);
	group.userData.northClimateVegetation = Object.freeze({
		winterTreeCount: 1,
		liveRepresentation: 'instanced-procedural-snow-pine',
	});
	return group;
}

function makeSharedTextureWinterModel() {
	const texture = new THREE.Texture();
	texture.name = 'winter-shared-albedo';
	const material = new THREE.MeshStandardMaterial({
		color: 0xe8f0ef,
		map: texture,
		roughness: 0.92,
	});
	const trunkGeometry = new THREE.BoxGeometry(0.75, 3.1, 0.75);
	const crownGeometry = new THREE.ConeGeometry(2.0, 5.4, 8);
	const trunk = new THREE.Mesh(trunkGeometry, material);
	const crown = new THREE.Mesh(crownGeometry, material);
	trunk.position.y = 1.55;
	crown.position.y = 5.0;
	const model = new THREE.Group();
	model.add(trunk, crown);
	model.updateMatrixWorld(true);
	return { model, texture, material, trunkGeometry, crownGeometry };
}

const group = makeProceduralWinterGroup();
const source = makeSharedTextureWinterModel();
let sourceMaterialDisposeCount = 0;
let sharedTextureDisposeCount = 0;
const originalSourceMaterialDispose = source.material.dispose.bind(source.material);
const originalTextureDispose = source.texture.dispose.bind(source.texture);
source.material.dispose = () => {
	sourceMaterialDisposeCount++;
	originalSourceMaterialDispose();
};
source.texture.dispose = () => {
	sharedTextureDisposeCount++;
	originalTextureDispose();
};

const status = await upgradeWinterVegetationAssets(group, {
	assetLoader: { async loadModel() { return source.model; } },
	candidates: ['materialized-shared-resource.glb'],
});
assert.equal(status.status, 'active');
assert.equal(status.meshCount, 2);
assert.equal(sourceMaterialDisposeCount, 1,
	'a shared source material must be disposed exactly once after replacement clones are created');
assert.equal(sharedTextureDisposeCount, 0,
	'disposing the source material must not dispose a texture still owned by replacement materials');

const replacements = group.children.filter((child) => child.name.startsWith('vegetation-snow-asset-'));
assert.equal(replacements.length, 2);
assert.strictEqual(replacements[0].geometry, source.trunkGeometry,
	'first replacement must reuse the loaded GLB geometry rather than duplicate vertex buffers');
assert.strictEqual(replacements[1].geometry, source.crownGeometry,
	'second replacement must reuse the loaded GLB geometry rather than duplicate vertex buffers');
assert.notStrictEqual(replacements[0].material, source.material,
	'replacement materials must be independent clones so the source scene can release its material');
assert.notStrictEqual(replacements[1].material, source.material);
assert.strictEqual(replacements[0].material.map, source.texture,
	'material clones should share the already-loaded texture object');
assert.strictEqual(replacements[1].material.map, source.texture);

replacements[0].material.dispose();
assert.equal(sharedTextureDisposeCount, 1,
	'the first replacement disposal must release the shared texture');
replacements[1].material.dispose();
assert.equal(sharedTextureDisposeCount, 1,
	'the second replacement disposal must not release the same shared texture twice');

source.trunkGeometry.dispose();
source.crownGeometry.dispose();
for (const child of group.children) {
	if (child.name.startsWith('vegetation-snow-asset-')) continue;
	child.geometry?.dispose();
	child.material?.dispose();
}

console.log('[checkWinterVegetationResourceOwnership] PASS: shared GLB materials/textures have single-owner disposal semantics.');
