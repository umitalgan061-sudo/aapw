#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  applyCastleMaterialFidelity,
  CASTLE_MATERIAL_FIDELITY_POLICY,
  hasAuthoredCastlePbr,
} from '../src/3d/world/castleMaterialFidelity.js';

function texture(name) {
  const value = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1, THREE.RGBAFormat);
  value.name = name;
  value.needsUpdate = true;
  return value;
}

function sourceCastle() {
  const root = new THREE.Group();
  root.name = 'castle-fixture';
  const authoredMap = texture('authored-albedo');
  const authoredNormal = texture('authored-normal');
  const authoredRoughness = texture('authored-roughness');
  const authored = new THREE.MeshStandardMaterial({ color: 0xd8d0c0, roughness: 0.55, metalness: 0.05 });
  authored.name = 'authored-pbr-material';
  authored.map = authoredMap;
  authored.normalMap = authoredNormal;
  authored.roughnessMap = authoredRoughness;
  const flat = new THREE.MeshStandardMaterial({ color: 0x77736c, roughness: 0.8 });
  flat.name = 'flat-export-material';
  const geometry = new THREE.BoxGeometry(2, 3, 2);
  const authoredMesh = new THREE.Mesh(geometry, authored);
  authoredMesh.name = 'authored-wall';
  const fallbackMesh = new THREE.Mesh(geometry, flat);
  fallbackMesh.name = 'flat-tower';
  fallbackMesh.position.x = 4;
  root.add(authoredMesh, fallbackMesh);
  return { root, geometry, authored, flat, authoredMap, authoredNormal, authoredRoughness };
}

function generatedStone() {
  const material = new THREE.MeshStandardMaterial({ color: 0x888078, roughness: 0.91 });
  material.map = texture('generated-stone-albedo');
  material.normalMap = texture('generated-stone-normal');
  material.userData.generatedByTextureFactory = true;
  return material;
}

const northern = sourceCastle();
assert.equal(hasAuthoredCastlePbr(northern.authored), true);
assert.equal(hasAuthoredCastlePbr(northern.flat), false);
const originalColor = northern.authored.color.clone();
const northernResult = applyCastleMaterialFidelity(northern.root, {
  seatId: 'jon',
  assetId: 'castle-icebound-fixture',
  src: 'fixture://icebound.glb',
  profileId: 'arctic',
  stoneColorHex: 0xa9b7c4,
  createFallbackMaterial: generatedStone,
});
assert.equal(northernResult.ok, true);
assert.equal(northernResult.authoredMaterialCount, 1);
assert.equal(northernResult.generatedFallbackCount, 1);
assert.deepEqual(northernResult.preservedMapSlots, ['map', 'normalMap', 'roughnessMap']);
assert.equal(northernResult.validation.ok, true);
assert.equal(northernResult.manifest.asset.id, 'castle-icebound-fixture');
assert.equal(northern.root.userData.castleMaterialFidelity.policyId, CASTLE_MATERIAL_FIDELITY_POLICY.id);

const northernAuthoredMesh = northern.root.children[0];
const northernFallbackMesh = northern.root.children[1];
assert.notEqual(northernAuthoredMesh.material, northern.authored, 'authored material must be per-seat clone');
assert.equal(northernAuthoredMesh.material.map, northern.authoredMap, 'authored albedo texture identity must survive');
assert.equal(northernAuthoredMesh.material.normalMap, northern.authoredNormal, 'authored normal texture identity must survive');
assert.equal(northernAuthoredMesh.material.roughnessMap, northern.authoredRoughness, 'authored roughness texture identity must survive');
assert.equal(northern.authored.color.equals(originalColor), true, 'source material must remain immutable');
assert.equal(northernAuthoredMesh.material.userData.castleMaterialFidelity.source, 'authored-pbr');
assert.equal(northernFallbackMesh.material.userData.castleMaterialFidelity.source, 'generated-stone-fallback');
assert.ok(northernFallbackMesh.material.map?.isTexture, 'untextured export must retain generated stone fallback');

const southern = sourceCastle();
const southernResult = applyCastleMaterialFidelity(southern.root, {
  seatId: 'doran',
  assetId: 'castle-brickstone-fixture',
  src: 'fixture://brickstone.glb',
  profileId: 'arid',
  stoneColorHex: 0xa8825e,
  createFallbackMaterial: generatedStone,
});
assert.equal(southernResult.ok, true);
assert.notDeepEqual(
  southern.root.children[0].material.color.toArray(),
  northern.root.children[0].material.color.toArray(),
  'regional surface profiles must not collapse reused authored materials to one tint',
);
assert.notEqual(
  southern.root.children[0].material,
  northern.root.children[0].material,
  'different seats must never share mutable material instances',
);
assert.equal(southern.root.children[0].geometry, northern.root.children[0].geometry, false, 'fixture geometries are intentionally independent');

const sharedGeometry = new THREE.BoxGeometry(1, 1, 1);
const sharedSource = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, map: texture('shared-authored') });
const seatA = new THREE.Group(); seatA.add(new THREE.Mesh(sharedGeometry, sharedSource));
const seatB = new THREE.Group(); seatB.add(new THREE.Mesh(sharedGeometry, sharedSource));
applyCastleMaterialFidelity(seatA, { seatId: 'ziya', profileId: 'fertile', stoneColorHex: 0x93917f, createFallbackMaterial: generatedStone });
applyCastleMaterialFidelity(seatB, { seatId: 'berk', profileId: 'fertile', stoneColorHex: 0x969483, createFallbackMaterial: generatedStone });
assert.equal(seatA.children[0].geometry, seatB.children[0].geometry, 'material isolation must not duplicate shared geometry');
assert.notEqual(seatA.children[0].material, seatB.children[0].material, 'shared castle geometry must still get seat-local materials');
assert.equal(seatA.children[0].material.map, seatB.children[0].material.map, 'seat-local material clones must share immutable authored texture objects');

console.log('Castle material fidelity PASS');
