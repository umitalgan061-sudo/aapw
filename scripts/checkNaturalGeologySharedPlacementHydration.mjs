#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AssetLoader } from '../src/3d/assetLoader.js';
import {
  NATURAL_GEOLOGY_RENDER_POLICY,
  upgradeNaturalGeologyAssets,
} from '../src/3d/world/naturalGeology.js';
import {
  PRE_RESOLVED_INSTANCED_ASSET_POLICY,
  auditPreResolvedInstancedWorldAsset,
} from '../src/3d/world/PreResolvedInstancedAssetPlacement.js';

const originalFetch = globalThis.fetch;
const originalLoadModel = AssetLoader.prototype.loadModel;

function makePlacement(id, x, z, overrides = {}) {
  return Object.freeze({
    id,
    kind: 'asset-proxy',
    assetFamily: 'rocky-terrain',
    x,
    y: 18 + x * 0.04 - z * 0.03,
    z,
    yawRadians: 0.3 + x * 0.007,
    tiltRadians: 0.06,
    tiltAxisRadians: 1.2,
    scale: Object.freeze({ x: 9.2, y: 5.7, z: 7.4 }),
    volcanic: false,
    valyriaInfluence: 0,
    curvatureMeters: 0.4,
    heightAboveSeaMeters: 75,
    northness: 0.3,
    southernDryness: 0.2,
    ...overrides,
  });
}

function makeProxy(placements) {
  const geometry = new THREE.IcosahedronGeometry(0.5, 1);
  const material = new THREE.MeshStandardMaterial({ color: 0x68635a, roughness: 0.96 });
  const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
  mesh.name = 'natural-geology-asset-proxy';
  mesh.userData.naturalGeologyKind = 'asset-proxy';
  mesh.userData.placementIds = placements.map((placement) => placement.id);
  const object = new THREE.Object3D();
  placements.forEach((placement, index) => {
    object.position.set(placement.x, placement.y, placement.z);
    object.rotation.set(0, placement.yawRadians, 0);
    object.scale.set(placement.scale.x, placement.scale.y, placement.scale.z);
    object.updateMatrix();
    mesh.setMatrixAt(index, object.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

function instanceScale(mesh, index) {
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  mesh.getMatrixAt(index, matrix);
  matrix.decompose(position, quaternion, scale);
  return scale;
}

function createHydratedModel(texture) {
  const group = new THREE.Group();
  const geometry = new THREE.DodecahedronGeometry(2.5, 0);
  geometry.translate(1.2, 1.8, -0.7);
  const material = new THREE.MeshStandardMaterial({
    color: 0x756c60,
    roughness: 0.72,
    metalness: 0,
    map: texture,
  });
  material.name = 'authored-hydrated-rock';
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'hydrated-rock-source';
  mesh.rotation.set(0.04, 0.12, -0.03);
  group.add(mesh);
  group.updateMatrixWorld(true);
  return { group, mesh, geometry, material };
}

function makeTexture() {
  const pixels = new Uint8Array([
    82, 76, 68, 255,
    106, 98, 88, 255,
    63, 60, 57, 255,
    128, 115, 101, 255,
  ]);
  const texture = new THREE.DataTexture(pixels, 2, 2, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.name = 'hydrated-authored-map';
  return texture;
}

async function activeHydrationFixture() {
  const placements = [
    makePlacement('hydrated-a', -35, 14),
    makePlacement('hydrated-b', 22, -18, { yawRadians: 1.48, southernDryness: 0.15 }),
  ];
  const group = new THREE.Group();
  group.name = 'natural-geology-active-fixture';
  group.userData.naturalGeology = Object.freeze({
    policyId: NATURAL_GEOLOGY_RENDER_POLICY.id,
    placementPolicyId: 'natural-geology-fixture-placement-v1',
    placementChecksum: 'fixture-whole-checksum',
    assetState: 'procedural-fallback',
  });
  group.userData.naturalGeologyPlacements = Object.freeze(placements);
  const proxy = makeProxy(placements);
  group.add(proxy);

  const texture = makeTexture();
  const loaded = createHydratedModel(texture);
  const authoredMap = loaded.material.map;
  let loadCalls = 0;

  AssetLoader.prototype.loadModel = async (url) => {
    loadCalls += 1;
    assert.equal(url, NATURAL_GEOLOGY_RENDER_POLICY.primaryRockAsset);
    return loaded.group;
  };

  const result = await upgradeNaturalGeologyAssets(group, { isMobileClass: false });
  assert.equal(loadCalls, 1);
  assert.equal(result.status, 'active');
  assert.equal(result.activeFamilyCount, 1);
  assert.equal(result.hydratedPlacementCount, placements.length);
  assert.equal(result.families[0].status, 'active');
  assert.equal(result.families[0].sharedPlacementPolicyId, PRE_RESOLVED_INSTANCED_ASSET_POLICY.id);
  assert(result.families[0].preparedBatchCount >= 1);
  assert.equal(result.families[0].manifestCount, result.families[0].preparedBatchCount);
  assert.equal(result.families[1].status, 'unused');

  const hydrated = group.children.filter((child) => child.name.startsWith('natural-geology-hydrated-rocky-terrain-'));
  assert(hydrated.length >= 1, 'no hydrated batches attached');
  for (const batch of hydrated) {
    assert(batch.isInstancedMesh);
    assert.equal(batch.count, placements.length);
    assert.equal(batch.userData.materialReadyForWorld, true);
    assert.equal(batch.userData.preResolvedInstancedAsset.policyId, PRE_RESOLVED_INSTANCED_ASSET_POLICY.id);
    assert.equal(batch.userData.worldPlacementManifest.validation.authoredMaterialPreserved, true);
    assert.equal(batch.userData.worldPlacementManifest.validation.finiteInstanceMatrices, true);
    assert.equal(batch.userData.worldPlacementManifest.placement.count, placements.length);
    assert.equal(batch.userData.worldPlacementManifest.placement.placementPolicyId, 'natural-geology-fixture-placement-v1');
    assert.equal(batch.userData.worldPlacementManifest.placement.placementIdsPresent, true);
    assert.strictEqual(batch.material.map, authoredMap, 'hydrated authored GLB map was replaced');
    const audit = auditPreResolvedInstancedWorldAsset(batch);
    assert.equal(audit.ok, true, audit.errors.join(','));
  }

  // Proxy suppression must happen only after the real batches were prepared, audited and attached.
  for (let index = 0; index < proxy.count; index += 1) {
    const scale = instanceScale(proxy, index);
    assert(scale.lengthSq() < 1e-16, `proxy ${index} remained visible after active hydration`);
  }

  // Instancing is preserved: two placements do not become two separate Mesh objects.
  assert(hydrated.every((batch) => batch.count === 2));
  assert(hydrated.length <= NATURAL_GEOLOGY_RENDER_POLICY.maximumHydratedPrimitiveCount);

  return {
    group,
    proxy,
    texture,
    loaded,
    result,
    hydrated,
  };
}

async function fallbackTransactionFixture() {
  // A non-finite scale produces a non-finite instance matrix. Shared preparation must fail closed and
  // the existing procedural proxy must remain visible instead of publishing a half-hydrated family.
  const placements = [
    makePlacement('fallback-a', 5, 7),
    makePlacement('fallback-bad', 18, 15, {
      scale: Object.freeze({ x: Number.NaN, y: 5.2, z: 7.1 }),
    }),
  ];
  const group = new THREE.Group();
  group.name = 'natural-geology-fallback-fixture';
  group.userData.naturalGeology = Object.freeze({
    policyId: NATURAL_GEOLOGY_RENDER_POLICY.id,
    placementPolicyId: 'natural-geology-fixture-placement-v1',
    assetState: 'procedural-fallback',
  });
  group.userData.naturalGeologyPlacements = Object.freeze(placements);
  const proxy = makeProxy(placements);
  group.add(proxy);

  const texture = makeTexture();
  const loaded = createHydratedModel(texture);
  AssetLoader.prototype.loadModel = async () => loaded.group;

  const result = await upgradeNaturalGeologyAssets(group, { isMobileClass: false });
  assert.equal(result.status, 'procedural-fallback');
  assert.equal(result.activeFamilyCount, 0);
  assert.equal(result.hydratedPlacementCount, 0);
  assert.equal(result.families[0].status, 'procedural-fallback');
  assert.match(result.families[0].reason, /shared-placement:non-finite-instance-matrix/);
  assert.equal(group.children.filter((child) => child.name.startsWith('natural-geology-hydrated-')).length, 0);

  // The valid proxy is still present at its original non-zero scale; no proxy is hidden on rollback.
  const scale0 = instanceScale(proxy, 0);
  assert(scale0.lengthSq() > 1, 'transaction failure incorrectly hid procedural proxy');

  return { group, proxy, texture, loaded, result };
}

try {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: new Headers({
      'content-length': '4096',
      'content-type': 'model/gltf-binary',
    }),
  });

  const active = await activeHydrationFixture();
  // Do not dispose the source texture until the hydrated cloned materials have been inspected: the
  // core contract deliberately preserves the authored map reference instead of replacing it.
  active.group.clear();
  for (const batch of active.hydrated) batch.material.dispose();
  active.loaded.geometry.dispose();
  active.loaded.material.dispose();
  active.texture.dispose();
  active.proxy.geometry.dispose();
  active.proxy.material.dispose();

  const fallback = await fallbackTransactionFixture();
  fallback.loaded.geometry.dispose();
  fallback.loaded.material.dispose();
  fallback.texture.dispose();
  fallback.proxy.geometry.dispose();
  fallback.proxy.material.dispose();

  console.log('[checkNaturalGeologySharedPlacementHydration] PASS');
  console.log(JSON.stringify({
    rendererPolicyId: NATURAL_GEOLOGY_RENDER_POLICY.id,
    sharedPolicyId: PRE_RESOLVED_INSTANCED_ASSET_POLICY.id,
    active: {
      activeFamilyCount: active.result.activeFamilyCount,
      hydratedPlacementCount: active.result.hydratedPlacementCount,
      preparedBatchCount: active.result.families[0].preparedBatchCount,
      manifestCount: active.result.families[0].manifestCount,
      authoredMapPreserved: true,
      proxySuppressionAfterAttach: true,
    },
    rollback: {
      status: fallback.result.status,
      reason: fallback.result.families[0].reason,
      hydratedChildren: 0,
      proceduralProxyPreserved: true,
    },
  }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
  AssetLoader.prototype.loadModel = originalLoadModel;
}
