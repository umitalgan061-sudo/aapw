#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  PRE_RESOLVED_INSTANCED_ASSET_POLICY,
  attachPreparedPreResolvedInstancedWorldAsset,
  auditPreResolvedInstancedWorldAsset,
  preparePreResolvedInstancedWorldAsset,
} from '../src/3d/world/PreResolvedInstancedAssetPlacement.js';
import { applyNaturalGeologySurfaceMaterial } from '../src/3d/world/naturalGeologySurfaceMaterial.js';

const matrix = new THREE.Matrix4();
const before = [];
const textureData = new Uint8Array([
  80, 72, 66, 255,
  98, 91, 82, 255,
  64, 61, 58, 255,
  116, 104, 91, 255,
]);
const texture = new THREE.DataTexture(textureData, 2, 2, THREE.RGBAFormat);
texture.needsUpdate = true;
texture.name = 'authored-geology-test-map';

const geometry = new THREE.BoxGeometry(2, 1, 3);
const authoredMaterial = new THREE.MeshStandardMaterial({
  color: 0x756b5e,
  map: texture,
  roughness: 0.78,
  metalness: 0,
});
authoredMaterial.name = 'authored-rock-material';
applyNaturalGeologySurfaceMaterial(authoredMaterial, { mode: 'rock' });
const originalCompileHook = authoredMaterial.onBeforeCompile;

const instanced = new THREE.InstancedMesh(geometry, authoredMaterial, 3);
instanced.name = 'shared-placement-test-rocks';
instanced.userData.placementIds = ['rock-a', 'rock-b', 'rock-c'];

const transforms = [
  { x: -18, y: 42.5, z: 11, yaw: 0.25, sx: 7.5, sy: 4.3, sz: 6.1 },
  { x: 23, y: 39.2, z: -8, yaw: 1.17, sx: 5.8, sy: 3.7, sz: 8.2 },
  { x: 41, y: 51.8, z: 27, yaw: 2.48, sx: 9.4, sy: 5.1, sz: 4.9 },
];
const object = new THREE.Object3D();
for (let i = 0; i < transforms.length; i += 1) {
  const t = transforms[i];
  object.position.set(t.x, t.y, t.z);
  object.rotation.set(0, t.yaw, 0);
  object.scale.set(t.sx, t.sy, t.sz);
  object.updateMatrix();
  instanced.setMatrixAt(i, object.matrix);
  before.push([...object.matrix.elements]);
}
instanced.instanceMatrix.needsUpdate = true;

const prepared = preparePreResolvedInstancedWorldAsset(instanced, {
  metadata: {
    id: 'asset:geology:test',
    name: 'Shared placement geology test',
    category: 'natural-geology-hydrated',
    src: 'assets/models/fbx/rocky_terrain_low_poly.glb',
  },
  placementIds: instanced.userData.placementIds,
  placementChecksum: 'placement-checksum-123',
  placementPolicyId: 'natural-geology-test-placement-v1',
  batchMetadata: {
    family: 'rocky-terrain',
    surfaceMode: 'rock',
    sourceMeshIndex: 0,
  },
});

assert.equal(prepared.ok, true, prepared.error || 'preparation failed');
assert.strictEqual(instanced.material, authoredMaterial, 'adapter replaced authored material object');
assert.strictEqual(instanced.material.map, texture, 'adapter replaced authored material map');
assert.strictEqual(instanced.material.onBeforeCompile, originalCompileHook, 'adapter replaced geology weathering shader hook');
assert.equal(instanced.userData.materialReadyForWorld, true, 'shared readiness marker missing');
assert.equal(instanced.userData.preResolvedInstancedAsset.policyId, PRE_RESOLVED_INSTANCED_ASSET_POLICY.id);
assert.equal(instanced.userData.preResolvedInstancedAsset.authoredMaterialPreserved, true);
assert.equal(instanced.userData.preResolvedInstancedAsset.matricesMutated, false);
assert.equal(instanced.userData.worldPlacementManifest.placement.mode, 'pre-resolved-instanced');
assert.equal(instanced.userData.worldPlacementManifest.placement.count, 3);
assert.equal(instanced.userData.worldPlacementManifest.placement.placementChecksum, 'placement-checksum-123');
assert.equal(instanced.userData.worldPlacementManifest.placement.placementPolicyId, 'natural-geology-test-placement-v1');
assert.equal(instanced.userData.worldPlacementManifest.validation.authoredMaterialPreserved, true);
assert.equal(instanced.userData.worldPlacementManifest.validation.finiteInstanceMatrices, true);
assert.equal(instanced.userData.worldPlacementManifest.validation.instanceCount, 3);

for (let i = 0; i < instanced.count; i += 1) {
  instanced.getMatrixAt(i, matrix);
  const after = [...matrix.elements];
  assert.deepEqual(after, before[i], `instance matrix ${i} changed during shared preparation`);
}

const audit = auditPreResolvedInstancedWorldAsset(instanced);
assert.equal(audit.ok, true, `prepared batch audit failed: ${audit.errors.join(',')}`);
assert.equal(audit.instanceCount, 3);
assert.equal(audit.placementPolicyId, 'natural-geology-test-placement-v1');
assert.equal(audit.placementChecksum, 'placement-checksum-123');

const scene = new THREE.Group();
const attached = attachPreparedPreResolvedInstancedWorldAsset(scene, prepared);
assert.equal(attached.ok, true, attached.error || 'shared attach failed');
assert.equal(scene.children.length, 1, 'prepared batch did not attach exactly once');
assert.strictEqual(scene.children[0], instanced, 'shared attachment cloned/replaced the prepared batch');

// Placement IDs are an exact batch contract. A mismatch must fail closed before readiness metadata.
const countMismatch = new THREE.InstancedMesh(geometry, authoredMaterial, 2);
countMismatch.setMatrixAt(0, new THREE.Matrix4());
countMismatch.setMatrixAt(1, new THREE.Matrix4().makeTranslation(1, 0, 0));
const countMismatchResult = preparePreResolvedInstancedWorldAsset(countMismatch, {
  placementIds: ['one-only'],
  placementPolicyId: 'test',
});
assert.equal(countMismatchResult.ok, false);
assert.match(countMismatchResult.error, /placement-count-mismatch/);
assert.notEqual(countMismatch.userData.materialReadyForWorld, true);

// Non-finite matrices cannot reach the attachment gate even if the source material is valid.
const invalidMatrixMesh = new THREE.InstancedMesh(geometry, authoredMaterial, 1);
const invalidMatrix = new THREE.Matrix4();
invalidMatrix.elements[12] = Number.NaN;
invalidMatrixMesh.setMatrixAt(0, invalidMatrix);
const invalidMatrixResult = preparePreResolvedInstancedWorldAsset(invalidMatrixMesh, {
  placementIds: ['bad-matrix'],
});
assert.equal(invalidMatrixResult.ok, false);
assert.match(invalidMatrixResult.error, /non-finite-instance-matrix/);
assert.notEqual(invalidMatrixMesh.userData.materialReadyForWorld, true);

const placeholder = new THREE.InstancedMesh(geometry, authoredMaterial, 1);
placeholder.userData.isPlaceholder = true;
placeholder.setMatrixAt(0, new THREE.Matrix4());
const placeholderResult = preparePreResolvedInstancedWorldAsset(placeholder, {
  placementIds: ['placeholder'],
});
assert.equal(placeholderResult.ok, false);
assert.equal(placeholderResult.error, 'placeholder-model');

const ordinaryMesh = new THREE.Mesh(geometry, authoredMaterial);
const ordinaryResult = preparePreResolvedInstancedWorldAsset(ordinaryMesh);
assert.equal(ordinaryResult.ok, false);
assert.equal(ordinaryResult.error, 'missing-instanced-mesh');

const unattachedScene = new THREE.Group();
const unprepared = new THREE.InstancedMesh(geometry, authoredMaterial, 1);
unprepared.setMatrixAt(0, new THREE.Matrix4());
const unpreparedAttach = attachPreparedPreResolvedInstancedWorldAsset(unattachedScene, {
  ok: true,
  object: unprepared,
});
assert.equal(unpreparedAttach.ok, false);
assert.equal(unpreparedAttach.error, 'instanced-asset-not-prepared');
assert.equal(unattachedScene.children.length, 0);

scene.remove(instanced);
countMismatch.dispose?.();
invalidMatrixMesh.dispose?.();
placeholder.dispose?.();
unprepared.dispose?.();
geometry.dispose();
authoredMaterial.dispose();
texture.dispose();

console.log('[checkPreResolvedInstancedAssetPlacement] PASS');
console.log(JSON.stringify({
  policyId: PRE_RESOLVED_INSTANCED_ASSET_POLICY.id,
  instanceCount: 3,
  authoredMaterialPreserved: true,
  authoredMapPreserved: true,
  exactMatrixParity: true,
  sharedManifest: true,
  sharedAttachmentGate: true,
  negativeFixtures: [
    'placement-count-mismatch',
    'non-finite-instance-matrix',
    'placeholder-model',
    'not-instanced-mesh',
    'unprepared-attach',
  ],
}, null, 2));
