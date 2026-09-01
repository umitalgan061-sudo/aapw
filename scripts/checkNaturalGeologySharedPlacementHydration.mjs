#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AssetLoader } from '../src/3d/assetLoader.js';
import { NATURAL_GEOLOGY_RENDER_POLICY, upgradeNaturalGeologyAssets } from '../src/3d/world/naturalGeology.js';
import { NATURAL_GEOLOGY_PLACEMENT_POLICY } from '../src/3d/world/naturalGeologyPlacement.js';
import { PRE_RESOLVED_INSTANCED_ASSET_POLICY, auditPreResolvedInstancedWorldAsset } from '../src/3d/world/PreResolvedInstancedAssetPlacement.js';
const originalFetch = globalThis.fetch;
const originalLoadModel = AssetLoader.prototype.loadModel;
const object = new THREE.Object3D();
const matrix = new THREE.Matrix4();
const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scale = new THREE.Vector3();

function placement(id, x, z, extra = {}) {
  return Object.freeze({ id, kind: 'asset-proxy', assetFamily: 'rocky-terrain', x, y: 20 + x * 0.03, z,
    yawRadians: 0.3 + x * 0.01, tiltRadians: 0.05, tiltAxisRadians: 1.1,
    scale: Object.freeze({ x: 8, y: 5, z: 7 }), volcanic: false, valyriaInfluence: 0,
    curvatureMeters: 0.3, heightAboveSeaMeters: 75, northness: 0.3, southernDryness: 0.2, ...extra });
}

function proxyFor(placements) {
  const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.5, 1), new THREE.MeshStandardMaterial({ color: 0x68635a }), placements.length);
  mesh.name = 'natural-geology-asset-proxy'; mesh.userData.naturalGeologyKind = 'asset-proxy';
  mesh.userData.placementIds = placements.map((p) => p.id);
  placements.forEach((p, i) => { object.position.set(p.x, p.y, p.z); object.rotation.set(0, p.yawRadians, 0); object.scale.set(p.scale.x, p.scale.y, p.scale.z); object.updateMatrix(); mesh.setMatrixAt(i, object.matrix); });
  mesh.instanceMatrix.needsUpdate = true; return mesh;
}

function sourceModel(texture) {
  const group = new THREE.Group();
  const geometry = new THREE.DodecahedronGeometry(2.5, 0); geometry.translate(1.2, 1.8, -0.7);
  const material = new THREE.MeshStandardMaterial({ color: 0x756c60, roughness: 0.72, map: texture }); material.name = 'authored-hydrated-rock';
  const mesh = new THREE.Mesh(geometry, material); mesh.rotation.set(0.04, 0.12, -0.03); group.add(mesh); group.updateMatrixWorld(true);
  return { group, geometry, material };
}

function texture() {
  const t = new THREE.DataTexture(new Uint8Array([82,76,68,255,106,98,88,255,63,60,57,255,128,115,101,255]), 2, 2, THREE.RGBAFormat);
  t.needsUpdate = true; return t;
}

function groupFor(placements) {
  const group = new THREE.Group();
  group.userData.naturalGeology = Object.freeze({ policyId: NATURAL_GEOLOGY_RENDER_POLICY.id, placementPolicyId: NATURAL_GEOLOGY_PLACEMENT_POLICY.id, assetState: 'procedural-fallback' });
  group.userData.naturalGeologyPlacements = Object.freeze(placements);
  const proxy = proxyFor(placements); group.add(proxy); return { group, proxy };
}

function instanceScale(mesh, index) {
  mesh.getMatrixAt(index, matrix); matrix.decompose(pos, quat, scale); return scale.clone();
}

function disposeFixture(f) {
  for (const child of f.group.children) if (child.isInstancedMesh && child !== f.proxy) child.material?.dispose?.();
  f.proxy.geometry.dispose(); f.proxy.material.dispose(); f.loaded.geometry.dispose(); f.loaded.material.dispose(); f.texture.dispose(); f.group.clear();
}

try {
  globalThis.fetch = async () => ({ ok: true, status: 200, headers: new Headers({ 'content-length': '4096', 'content-type': 'model/gltf-binary' }) });

  const activePlacements = [placement('a', -35, 14), placement('b', 22, -18, { yawRadians: 1.48 })];
  const active = { ...groupFor(activePlacements), texture: texture() }; active.loaded = sourceModel(active.texture);
  const authoredMap = active.loaded.material.map;
  AssetLoader.prototype.loadModel = async (url) => { assert.equal(url, NATURAL_GEOLOGY_RENDER_POLICY.primaryRockAsset); return active.loaded.group; };
  active.result = await upgradeNaturalGeologyAssets(active.group, { isMobileClass: false });
  assert.equal(active.result.status, 'active'); assert.equal(active.result.activeFamilyCount, 1); assert.equal(active.result.hydratedPlacementCount, 2);
  const family = active.result.families[0]; assert.equal(family.status, 'active'); assert.equal(family.sharedPlacementPolicyId, PRE_RESOLVED_INSTANCED_ASSET_POLICY.id);
  assert.equal(family.preparedBatchCount, family.manifestCount); assert(family.preparedBatchCount > 0); assert.equal(active.result.families[1].status, 'unused');
  const batches = active.group.children.filter((c) => c.name.startsWith('natural-geology-hydrated-rocky-terrain-')); assert(batches.length > 0);
  for (const batch of batches) {
    assert.equal(batch.count, 2); assert.equal(batch.userData.materialReadyForWorld, true); assert.strictEqual(batch.material.map, authoredMap);
    const manifest = batch.userData.worldPlacementManifest; assert.equal(manifest.validation.authoredMaterialPreserved, true); assert.equal(manifest.validation.finiteInstanceMatrices, true);
    assert.equal(manifest.placement.count, 2); assert.equal(manifest.placement.placementPolicyId, NATURAL_GEOLOGY_PLACEMENT_POLICY.id); assert.equal(manifest.placement.placementIdsPresent, true);
    const audit = auditPreResolvedInstancedWorldAsset(batch); assert.equal(audit.ok, true, audit.errors.join(','));
  }
  for (let i = 0; i < active.proxy.count; i += 1) assert(instanceScale(active.proxy, i).lengthSq() < 1e-16, `proxy ${i} stayed visible`);

  const badPlacements = [placement('good', 5, 7), placement('bad', 18, 15, { scale: Object.freeze({ x: Number.NaN, y: 5, z: 7 }) })];
  const fallback = { ...groupFor(badPlacements), texture: texture() }; fallback.loaded = sourceModel(fallback.texture);
  AssetLoader.prototype.loadModel = async () => fallback.loaded.group;
  fallback.result = await upgradeNaturalGeologyAssets(fallback.group, { isMobileClass: false });
  assert.equal(fallback.result.status, 'procedural-fallback'); assert.equal(fallback.result.activeFamilyCount, 0); assert.equal(fallback.result.hydratedPlacementCount, 0);
  assert.match(fallback.result.families[0].reason, /shared-placement:non-finite-instance-matrix/);
  assert.equal(fallback.group.children.filter((c) => c.name.startsWith('natural-geology-hydrated-')).length, 0);
  assert(instanceScale(fallback.proxy, 0).lengthSq() > 1, 'rollback hid procedural proxy');

  console.log('[checkNaturalGeologySharedPlacementHydration] PASS');
  console.log(JSON.stringify({ rendererPolicyId: NATURAL_GEOLOGY_RENDER_POLICY.id, sharedPolicyId: PRE_RESOLVED_INSTANCED_ASSET_POLICY.id,
    placementPolicyId: NATURAL_GEOLOGY_PLACEMENT_POLICY.id,
    active: { hydratedPlacementCount: active.result.hydratedPlacementCount, preparedBatchCount: family.preparedBatchCount, authoredMapPreserved: true, proxySuppressionAfterAttach: true },
    rollback: { reason: fallback.result.families[0].reason, proceduralProxyPreserved: true } }, null, 2));

  disposeFixture(active); disposeFixture(fallback);
} finally {
  globalThis.fetch = originalFetch;
  AssetLoader.prototype.loadModel = originalLoadModel;
}
