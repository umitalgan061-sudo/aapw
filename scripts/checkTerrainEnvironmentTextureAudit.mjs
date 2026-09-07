import assert from 'node:assert/strict';
import * as THREE from 'three';
import { auditEnvironmentObject, auditScalarPbrRange, environmentTextureQualityScore, materialTextureCompleteness } from '../src/3d/world/terrainEnvironmentTextureAudit.js';

const barkTexture = new THREE.DataTexture(new Uint8Array([120, 100, 80, 255]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
barkTexture.needsUpdate = true;
const barkNormal = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
barkNormal.needsUpdate = true;
const bark = new THREE.MeshStandardMaterial({ name: 'BirchTree_Bark', map: barkTexture, normalMap: barkNormal, roughness: 0.91, metalness: 0 });
const leaves = new THREE.MeshStandardMaterial({ name: 'BirchTree_Leaves', color: 0x44662b, roughness: 0.84, metalness: 0, transparent: true, alphaTest: 0.35 });
const root = new THREE.Group();
const trunk = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), bark); trunk.userData.generatedByTextureFactory = true;
const crown = new THREE.Mesh(new THREE.SphereGeometry(1, 4, 3), leaves); crown.userData.generatedByTextureFactory = true;
root.add(trunk, crown);

const audit = auditEnvironmentObject(root, { asset: { id: 'birch-r7', src: 'assets/models/vegetation/birch_trees_R7qMWzb7nk.glb', family: 'tree', pbr: ['bark', 'leaves'] } });
assert.equal(audit.ok, true);
assert.equal(audit.surfaces.length >= 2, true);
assert.ok(environmentTextureQualityScore(audit) > 0.4);
assert.ok(materialTextureCompleteness(audit.surfaces[0], audit.surfaces[0].inferredRole) > 0);
assert.equal(auditScalarPbrRange({ roughness: 0.91, metalness: 0, normalStrength: 0.68 }).ok, true);
assert.equal(auditScalarPbrRange({ roughness: 1.2, metalness: 0 }).ok, false);

root.traverse((object) => {
  if (object.isMesh) object.geometry.dispose();
});
for (const material of [bark, leaves]) material.dispose();
barkTexture.dispose();
barkNormal.dispose();
console.log(JSON.stringify({ ok: true, surfaces: audit.surfaces.length, quality: environmentTextureQualityScore(audit) }));
