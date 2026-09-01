#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AssetLoader } from '../src/3d/assetLoader.js';
import {
  NATURAL_GEOLOGY_RENDER_POLICY,
  upgradeNaturalGeologyAssets,
} from '../src/3d/world/naturalGeology.js';
import { NATURAL_GEOLOGY_PLACEMENT_POLICY } from '../src/3d/world/naturalGeologyPlacement.js';
import {
  PRE_RESOLVED_INSTANCED_ASSET_POLICY,
  auditPreResolvedInstancedWorldAsset,
} from '../src/3d/world/PreResolvedInstancedAssetPlacement.js';

const originalFetch = globalThis.fetch;
const originalLoadModel = AssetLoader.prototype.loadModel;
const object = new THREE.Object3D();
const colorA = new THREE.Color();
const colorB = new THREE.Color();

function placement(id, family, x, z, extra = {}) {
  return Object.freeze({
    id,
    kind: 'asset-proxy',
    assetFamily: family,
    x,
    y: 20 + x * 0.03,
    z,
    yawRadians: 0.3 + x * 0.01,
    tiltRadians: 0.05,
    tiltAxisRadians: 1.1,
    scale: Object.freeze({ x: 8, y: 5, z: 7 }),
    volcanic: false,
    valyriaInfluence: 0,
    curvatureMeters: 0.3,
    heightAboveSeaMeters: 75 + x * 0.4,
    northness: family === 'rocky-terrain' ? 0.72 : 0.12,
    southernDryness: family === 'desert-rocks' ? 0.82 : 0.22,
    ...extra,
  });
}

function proxyFor(placements, family, mode = 'rock') {
  const mesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(0.5, 1),
    new THREE.MeshStandardMaterial({ color: 0x68635a }),
    placements.length,
  );
  mesh.name = `natural-geology-asset-proxy-${family}-${mode}`;
  mesh.userData.naturalGeologyKind = 'asset-proxy';
  mesh.userData.naturalGeologyAssetFamily = family;
  mesh.userData.naturalGeologySurfaceMode = mode;
  mesh.userData.placementIds = placements.map((entry) => entry.id);
  placements.forEach((entry, index) => {
    object.position.set(entry.x, entry.y, entry.z);
    object.rotation.set(0, entry.yawRadians, 0);
    object.scale.set(entry.scale.x, entry.scale.y, entry.scale.z);
    object.updateMatrix();
    mesh.setMatrixAt(index, object.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

function sourceModel(texture) {
  const group = new THREE.Group();
  const geometry = new THREE.DodecahedronGeometry(2.5, 0);
  geometry.translate(1.2, 1.8, -0.7);
  const material = new THREE.MeshStandardMaterial({ color: 0x756c60, roughness: 0.72, map: texture });
  material.name = 'authored-hydrated-rock';
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.set(0.04, 0.12, -0.03);
  group.add(mesh);
  group.updateMatrixWorld(true);
  return { group, geometry, material };
}

function texture() {
  const result = new THREE.DataTexture(
    new Uint8Array([
      82, 76, 68, 255,
      106, 98, 88, 255,
      63, 60, 57, 255,
      128, 115, 101, 255,
    ]),
    2,
    2,
    THREE.RGBAFormat,
  );
  result.needsUpdate = true;
  return result;
}

function groupFor(placements) {
  const group = new THREE.Group();
  group.userData.naturalGeology = Object.freeze({
    policyId: NATURAL_GEOLOGY_RENDER_POLICY.id,
    placementPolicyId: NATURAL_GEOLOGY_PLACEMENT_POLICY.id,
    assetState: 'procedural-fallback',
  });
  group.userData.naturalGeologyPlacements = Object.freeze(placements);
  group.userData.naturalGeologyDisposed = false;

  const grouped = new Map();
  for (const entry of placements) {
    const mode = entry.volcanic ? 'volcanic' : entry.assetFamily === 'desert-rocks' || entry.southernDryness > 0.69 ? 'arid' : 'rock';
    const key = `${entry.assetFamily}:${mode}`;
    if (!grouped.has(key)) grouped.set(key, { family: entry.assetFamily, mode, placements: [] });
    grouped.get(key).placements.push(entry);
  }
  const proxies = [];
  for (const batch of grouped.values()) {
    const proxy = proxyFor(batch.placements, batch.family, batch.mode);
    proxies.push(proxy);
    group.add(proxy);
  }
  return { group, proxies };
}

function findProxy(group, family) {
  return group.children.find((child) => child.isInstancedMesh
    && child.userData?.naturalGeologyKind === 'asset-proxy'
    && child.userData?.naturalGeologyAssetFamily === family);
}

function disposeFixture(fixture) {
  const geometries = new Set();
  const materials = new Set();
  fixture.group.traverse((node) => {
    if (node.geometry && !geometries.has(node.geometry)) {
      geometries.add(node.geometry);
      node.geometry.dispose();
    }
    const list = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
    for (const material of list) {
      if (materials.has(material)) continue;
      materials.add(material);
      material.dispose();
    }
  });
  fixture.loaded?.geometry?.dispose?.();
  fixture.loaded?.material?.dispose?.();
  fixture.texture?.dispose?.();
  fixture.group.clear();
}

try {
  const primaryPlacements = [
    placement('rock-a', 'rocky-terrain', -35, 14),
    placement('rock-b', 'rocky-terrain', 22, -18, { yawRadians: 1.48, heightAboveSeaMeters: 260 }),
  ];
  const desertPlacements = [
    placement('desert-a', 'desert-rocks', 41, 31, { southernDryness: 0.92, heightAboveSeaMeters: 115 }),
  ];
  const active = {
    ...groupFor([...primaryPlacements, ...desertPlacements]),
    texture: texture(),
  };
  active.loaded = sourceModel(active.texture);
  const authoredMap = active.loaded.material.map;

  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    headers: new Headers({
      'content-length': String(url === NATURAL_GEOLOGY_RENDER_POLICY.primaryRockAsset ? 4096 : 128),
      'content-type': 'model/gltf-binary',
    }),
  });
  AssetLoader.prototype.loadModel = async (url) => {
    assert.equal(url, NATURAL_GEOLOGY_RENDER_POLICY.primaryRockAsset);
    return active.loaded.group;
  };

  active.result = await upgradeNaturalGeologyAssets(active.group, { isMobileClass: false });
  assert.equal(active.result.status, 'active');
  assert.equal(active.result.activeFamilyCount, 1);
  assert.equal(active.result.hydratedPlacementCount, 2);
  const primary = active.result.families[0];
  const southern = active.result.families[1];
  assert.equal(primary.status, 'active');
  assert.equal(southern.status, 'procedural-fallback');
  assert.equal(southern.reason, 'lfs-pointer');
  assert.equal(primary.sharedPlacementPolicyId, PRE_RESOLVED_INSTANCED_ASSET_POLICY.id);
  assert.equal(primary.preparedBatchCount, primary.manifestCount);
  assert(primary.preparedBatchCount > 0);
  assert.equal(primary.removedProxyInstanceCount, primaryPlacements.length);
  assert(primary.removedProxyMeshCount >= 1);
  assert.equal(primary.hydratedInstanceTintStrength, NATURAL_GEOLOGY_RENDER_POLICY.hydratedInstanceTintStrength);

  assert.equal(findProxy(active.group, 'rocky-terrain'), undefined, 'successful primary proxy family remained in the scene');
  const desertProxy = findProxy(active.group, 'desert-rocks');
  assert(desertProxy, 'failed southern family lost its procedural fallback');
  assert.equal(desertProxy.count, desertPlacements.length);

  const batches = active.group.children.filter((child) => child.name.startsWith('natural-geology-hydrated-rocky-terrain-'));
  assert(batches.length > 0);
  for (const batch of batches) {
    assert.equal(batch.count, primaryPlacements.length);
    assert.equal(batch.userData.materialReadyForWorld, true);
    assert.strictEqual(batch.material.map, authoredMap);
    assert(batch.instanceColor, 'hydrated batch lost deterministic instance tint');
    const manifest = batch.userData.worldPlacementManifest;
    assert.equal(manifest.validation.authoredMaterialPreserved, true);
    assert.equal(manifest.validation.finiteInstanceMatrices, true);
    assert.equal(manifest.placement.count, primaryPlacements.length);
    assert.equal(manifest.placement.placementPolicyId, NATURAL_GEOLOGY_PLACEMENT_POLICY.id);
    assert.equal(manifest.placement.placementIdsPresent, true);
    const audit = auditPreResolvedInstancedWorldAsset(batch);
    assert.equal(audit.ok, true, audit.errors.join(','));

    batch.getColorAt(0, colorA);
    batch.getColorAt(1, colorB);
    const tintDistance = Math.hypot(colorA.r - colorB.r, colorA.g - colorB.g, colorA.b - colorB.b);
    assert(tintDistance > 0.001, 'hydrated clones received identical instance tint');
    for (const channel of [colorA.r, colorA.g, colorA.b, colorB.r, colorB.g, colorB.b]) {
      assert(channel > 0.75 && channel <= 1.0, `hydrated tint overrode authored albedo too aggressively: ${channel}`);
    }
  }

  const badPlacements = [
    placement('good', 'rocky-terrain', 5, 7),
    placement('bad', 'rocky-terrain', 18, 15, { scale: Object.freeze({ x: Number.NaN, y: 5, z: 7 }) }),
  ];
  const fallback = { ...groupFor(badPlacements), texture: texture() };
  fallback.loaded = sourceModel(fallback.texture);
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-length': '4096', 'content-type': 'model/gltf-binary' }),
  });
  AssetLoader.prototype.loadModel = async () => fallback.loaded.group;
  fallback.result = await upgradeNaturalGeologyAssets(fallback.group, { isMobileClass: false });
  assert.equal(fallback.result.status, 'procedural-fallback');
  assert.equal(fallback.result.activeFamilyCount, 0);
  assert.equal(fallback.result.hydratedPlacementCount, 0);
  assert.match(fallback.result.families[0].reason, /shared-placement:non-finite-instance-matrix/);
  assert.equal(fallback.group.children.filter((child) => child.name.startsWith('natural-geology-hydrated-')).length, 0);
  assert(findProxy(fallback.group, 'rocky-terrain'), 'transaction rollback removed procedural fallback');

  console.log('[checkNaturalGeologySharedPlacementHydration] PASS');
  console.log(JSON.stringify({
    rendererPolicyId: NATURAL_GEOLOGY_RENDER_POLICY.id,
    sharedPolicyId: PRE_RESOLVED_INSTANCED_ASSET_POLICY.id,
    placementPolicyId: NATURAL_GEOLOGY_PLACEMENT_POLICY.id,
    active: {
      hydratedPlacementCount: active.result.hydratedPlacementCount,
      preparedBatchCount: primary.preparedBatchCount,
      authoredMapPreserved: true,
      hydratedInstanceTint: true,
      removedProxyMeshCount: primary.removedProxyMeshCount,
      removedProxyInstanceCount: primary.removedProxyInstanceCount,
      failedFamilyFallbackPreserved: true,
    },
    rollback: {
      reason: fallback.result.families[0].reason,
      proceduralProxyPreserved: true,
    },
  }, null, 2));

  disposeFixture(active);
  disposeFixture(fallback);
} finally {
  globalThis.fetch = originalFetch;
  AssetLoader.prototype.loadModel = originalLoadModel;
}
