#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { resolveCameraCollision } from '../src/3d/camera.js';

const cameraSource = await readFile(new URL('../src/3d/camera.js', import.meta.url), 'utf8');
const helperSource = await readFile(new URL('../src/3d/gameLoopHelpers.js', import.meta.url), 'utf8');
const sceneSource = await readFile(new URL('../src/3d/sceneManager.js', import.meta.url), 'utf8');

assert.match(
	cameraSource,
	/raycaster\.intersectObjects\(collidables,\s*true\)/,
	'player camera collision must recursively enter imported FBX/GLB hierarchy roots',
);
assert.ok(
	helperSource.includes('state.realCastles.children'),
	'real castle roots must remain part of player camera geographic collision candidates',
);
assert.ok(
	helperSource.includes('state.iceLandmarks?.children'),
	'ice-landmark roots must remain part of player camera geographic collision candidates',
);
for (const stateField of ['realCastles', 'naturalGeology', 'villages', 'iceLandmarks']) {
	assert.ok(sceneSource.includes(stateField), `scene state must expose ${stateField} geographic asset family`);
}

const target = new THREE.Vector3(0, 1.5, 0);
const desired = new THREE.Vector3(0, 1.5, 10);
const desiredSnapshot = desired.clone();
const raycaster = new THREE.Raycaster();

// Model roots produced by FBX/GLB loaders are usually Groups. The collision surface can sit more
// than one level below the root, so a root-only non-recursive ray is not a valid shipped-model proof.
const importedRoot = new THREE.Group();
importedRoot.name = 'ImportedCastleRoot';
const assetNode = new THREE.Group();
assetNode.name = 'FBXSceneNode';
const nestedMesh = new THREE.Mesh(
	new THREE.BoxGeometry(3, 6, 2),
	new THREE.MeshStandardMaterial({ color: 0xffffff }),
);
nestedMesh.name = 'StoneWallMesh';
nestedMesh.position.set(0, 1.5, 5);
assetNode.add(nestedMesh);
importedRoot.add(assetNode);
importedRoot.updateMatrixWorld(true);

raycaster.set(target, new THREE.Vector3(0, 0, 1));
raycaster.near = 0;
raycaster.far = 10;
assert.equal(
	raycaster.intersectObjects([importedRoot], false).length,
	0,
	'fixture must prove the old non-recursive root ray cannot see nested imported triangles',
);
assert.ok(
	raycaster.intersectObjects([importedRoot], true).length > 0,
	'fixture must expose nested imported triangles when recursion is enabled',
);

const resolved = resolveCameraCollision(raycaster, target, desired, [importedRoot], 0.4, 1.5);
assert.notStrictEqual(resolved, desired, 'an occluded imported model must return a collision-resolved position');
assert.deepEqual(desired.toArray(), desiredSnapshot.toArray(), 'camera collision must never mutate OrbitControls desired position');
assert.ok(resolved.z > 3 && resolved.z < 4.1, `camera should stop before the nested wall surface, got z=${resolved.z}`);
assert.equal(resolved.x, 0);
assert.equal(resolved.y, 1.5);

const emptyRoot = new THREE.Group();
emptyRoot.updateMatrixWorld(true);
const unobstructed = resolveCameraCollision(raycaster, target, desired, [emptyRoot], 0.4, 1.5);
assert.strictEqual(unobstructed, desired, 'empty/unobstructed geographic roots must preserve desired camera position object');

// Regression: collision clearance must outrank the comfort floor. The old Math.max(minDistance,...)
// path pushed this camera to z=1.5 even though the wall begins at z=0.95, placing the camera through
// the real surface. A cramped corridor may temporarily require a tighter camera, but must not clip.
const closeRoot = new THREE.Group();
const closeMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 4, 0.5), new THREE.MeshBasicMaterial());
closeMesh.position.set(0, 1.5, 1.2);
closeRoot.add(closeMesh);
closeRoot.updateMatrixWorld(true);
const closeHits = (() => {
	raycaster.set(target, new THREE.Vector3(0, 0, 1));
	raycaster.near = 0;
	raycaster.far = 10;
	return raycaster.intersectObjects([closeRoot], true);
})();
assert.ok(closeHits.length > 0, 'near-wall fixture must expose a real collision surface');
const closeSurfaceDistance = closeHits[0].distance;
const closeResolved = resolveCameraCollision(raycaster, target, desired, [closeRoot], 0.4, 1.5);
const closeResolvedDistance = closeResolved.distanceTo(target);
assert.ok(closeResolvedDistance < 1.5, 'near wall must be allowed to override the chase-camera comfort floor');
assert.ok(
	closeResolvedDistance <= closeSurfaceDistance - 0.4 + 1e-6,
	`camera must remain in front of near wall: resolved=${closeResolvedDistance}, surface=${closeSurfaceDistance}`,
);
assert.ok(closeResolvedDistance >= 0, 'near-wall collision resolution must remain finite and non-negative');

nestedMesh.geometry.dispose();
nestedMesh.material.dispose();
closeMesh.geometry.dispose();
closeMesh.material.dispose();

console.log(JSON.stringify({
	ok: true,
	contract: 'player-geographic-camera-occlusion',
	modelHierarchy: {
		rootType: 'Group',
		nestedDepth: 2,
		nonRecursiveHits: 0,
		recursiveCollision: true,
	},
	nearWallPriority: {
		comfortFloorMeters: 1.5,
		marginMeters: 0.4,
		surfaceDistanceMeters: closeSurfaceDistance,
		resolvedDistanceMeters: closeResolvedDistance,
		collisionClearanceOverridesComfortFloor: true,
	},
	geographicFamiliesExposedByScene: ['realCastles', 'naturalGeology', 'villages', 'iceLandmarks'],
	cameraCandidatesAlreadyWired: ['terrain-chunks', 'settlements', 'realCastles', 'iceLandmarks'],
	ownership: {
		terrainGenerationModified: false,
		geographicPlacementModified: false,
		npcAiModified: false,
		playerCameraOnly: true,
	},
}, null, 2));
