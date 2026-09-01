#!/usr/bin/env node
/**
 * Exact-head lifecycle proof for optional geology GLB hydration.
 *
 * 1) Abort during the asynchronous load must dispose the just-loaded source model and publish no
 *    hydrated batch.
 * 2) Explicit group disposal while a load is still unresolved must immediately free procedural GPU
 *    resources, mark the group dead, and prevent the later load resolution from re-attaching anything.
 */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AssetLoader } from '../src/3d/assetLoader.js';
import {
  disposeNaturalGeology,
  upgradeNaturalGeologyAssets,
} from '../src/3d/world/naturalGeology.js';

const originalFetch = globalThis.fetch;
const originalLoadModel = AssetLoader.prototype.loadModel;

function placement(id = 'proof-rock') {
  return Object.freeze({
    id,
    kind: 'asset-proxy',
    assetFamily: 'rocky-terrain',
    x: 0,
    y: 12,
    z: 0,
    yawRadians: 0,
    tiltRadians: 0,
    tiltAxisRadians: 0,
    scale: Object.freeze({ x: 8, y: 5, z: 7 }),
    volcanic: false,
    valyriaInfluence: 0,
    curvatureMeters: 0,
    heightAboveSeaMeters: 80,
    northness: 0.4,
    southernDryness: 0.3,
  });
}

function makeGroup({ withProxy = false, id = 'proof-rock' } = {}) {
  const entry = placement(id);
  const group = new THREE.Group();
  group.userData.naturalGeology = Object.freeze({ assetState: 'procedural-fallback' });
  group.userData.naturalGeologyPlacements = Object.freeze([entry]);
  group.userData.naturalGeologyDisposed = false;
  let proxyGeometry = null;
  let proxyMaterial = null;
  let proxyGeometryDisposed = false;
  let proxyMaterialDisposed = false;

  if (withProxy) {
    proxyGeometry = new THREE.IcosahedronGeometry(0.5, 1);
    proxyMaterial = new THREE.MeshStandardMaterial({ color: 0x68635a });
    const geometryDispose = proxyGeometry.dispose.bind(proxyGeometry);
    const materialDispose = proxyMaterial.dispose.bind(proxyMaterial);
    proxyGeometry.dispose = () => { proxyGeometryDisposed = true; geometryDispose(); };
    proxyMaterial.dispose = () => { proxyMaterialDisposed = true; materialDispose(); };
    const proxy = new THREE.InstancedMesh(proxyGeometry, proxyMaterial, 1);
    proxy.userData.naturalGeologyKind = 'asset-proxy';
    proxy.userData.naturalGeologyAssetFamily = 'rocky-terrain';
    proxy.userData.placementIds = [id];
    const transform = new THREE.Object3D();
    transform.position.set(entry.x, entry.y, entry.z);
    transform.scale.set(entry.scale.x, entry.scale.y, entry.scale.z);
    transform.updateMatrix();
    proxy.setMatrixAt(0, transform.matrix);
    proxy.instanceMatrix.needsUpdate = true;
    group.add(proxy);
  }

  return {
    group,
    get proxyGeometryDisposed() { return proxyGeometryDisposed; },
    get proxyMaterialDisposed() { return proxyMaterialDisposed; },
  };
}

function makeLoadedModel() {
  const group = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({ color: 0x665f56 });
  group.add(new THREE.Mesh(geometry, material));
  let geometryDisposed = false;
  let materialDisposed = false;
  const disposeGeometry = geometry.dispose.bind(geometry);
  const disposeMaterial = material.dispose.bind(material);
  geometry.dispose = () => { geometryDisposed = true; disposeGeometry(); };
  material.dispose = () => { materialDisposed = true; disposeMaterial(); };
  return {
    group,
    get geometryDisposed() { return geometryDisposed; },
    get materialDisposed() { return materialDisposed; },
  };
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

  // Case 1: an external lifecycle signal aborts while AssetLoader resolves a source model.
  const abortController = new AbortController();
  const abortFixture = makeGroup();
  const abortedModel = makeLoadedModel();
  let abortLoadCalls = 0;
  AssetLoader.prototype.loadModel = async () => {
    abortLoadCalls += 1;
    abortController.abort();
    return abortedModel.group;
  };

  const abortedResult = await upgradeNaturalGeologyAssets(abortFixture.group, {
    signal: abortController.signal,
    isMobileClass: false,
  });
  assert.equal(abortLoadCalls, 1);
  assert.equal(abortController.signal.aborted, true);
  assert.equal(abortedModel.geometryDisposed, true, 'aborted loaded geometry was not disposed');
  assert.equal(abortedModel.materialDisposed, true, 'aborted loaded material was not disposed');
  assert.equal(abortFixture.group.children.length, 0, 'abort path published a hydrated child');
  assert.equal(abortedResult.activeFamilyCount, 0);
  assert.equal(abortedResult.hydratedPlacementCount, 0);
  assert.equal(abortedResult.families?.[0]?.status, 'aborted');
  assert.equal(abortedResult.families?.[1]?.status, 'aborted');

  // Case 2: explicit disposal wins the race even when no external AbortSignal is supplied.
  const disposeFixture = makeGroup({ withProxy: true, id: 'dispose-race-rock' });
  const lateModel = makeLoadedModel();
  let resolveLateLoad;
  let lateLoadCalls = 0;
  const lateLoadPromise = new Promise((resolve) => { resolveLateLoad = resolve; });
  AssetLoader.prototype.loadModel = async () => {
    lateLoadCalls += 1;
    return lateLoadPromise;
  };

  const lateTask = upgradeNaturalGeologyAssets(disposeFixture.group, { isMobileClass: false });
  // Let preflight resolve and AssetLoader.loadModel become the awaited operation.
  for (let i = 0; i < 8 && lateLoadCalls === 0; i += 1) await Promise.resolve();
  assert.equal(lateLoadCalls, 1, 'deferred hydration never entered AssetLoader');

  disposeNaturalGeology(disposeFixture.group);
  assert.equal(disposeFixture.group.userData.naturalGeologyDisposed, true);
  assert.equal(disposeFixture.group.children.length, 0, 'dispose did not clear procedural geology immediately');
  assert.equal(disposeFixture.proxyGeometryDisposed, true, 'dispose leaked procedural proxy geometry');
  assert.equal(disposeFixture.proxyMaterialDisposed, true, 'dispose leaked procedural proxy material');

  resolveLateLoad(lateModel.group);
  const lateResult = await lateTask;
  assert.equal(lateModel.geometryDisposed, true, 'late loaded geometry survived disposed-group guard');
  assert.equal(lateModel.materialDisposed, true, 'late loaded material survived disposed-group guard');
  assert.equal(disposeFixture.group.children.length, 0, 'late hydration re-attached into disposed geology group');
  assert.equal(lateResult.status, 'disposed-group');
  assert.equal(lateResult.activeFamilyCount, 0);
  assert.equal(lateResult.hydratedPlacementCount, 0);

  const repeatDisposeChildren = disposeFixture.group.children.length;
  disposeNaturalGeology(disposeFixture.group);
  assert.equal(disposeFixture.group.children.length, repeatDisposeChildren, 'dispose was not idempotent');

  console.log('[checkNaturalGeologyAbortSafety] PASS');
  console.log(JSON.stringify({
    abortDuringLoad: {
      status: abortedResult.status,
      familyStatuses: abortedResult.families.map((family) => family.status),
      loadedSourceDisposed: abortedModel.geometryDisposed && abortedModel.materialDisposed,
      groupChildren: abortFixture.group.children.length,
    },
    explicitDisposeRace: {
      status: lateResult.status,
      proceduralResourcesDisposed: disposeFixture.proxyGeometryDisposed && disposeFixture.proxyMaterialDisposed,
      lateSourceDisposed: lateModel.geometryDisposed && lateModel.materialDisposed,
      groupChildren: disposeFixture.group.children.length,
      idempotent: true,
    },
  }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
  AssetLoader.prototype.loadModel = originalLoadModel;
}
