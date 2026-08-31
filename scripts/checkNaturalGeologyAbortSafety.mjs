#!/usr/bin/env node
/** Exact-head lifecycle proof: an abort during GLB loading must not mutate the disposed geology group. */
import * as THREE from 'three';
import { AssetLoader } from '../src/3d/assetLoader.js';
import { upgradeNaturalGeologyAssets } from '../src/3d/world/naturalGeology.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const controller = new AbortController();
const group = new THREE.Group();
group.userData.naturalGeology = Object.freeze({ assetState: 'procedural-fallback' });
group.userData.naturalGeologyPlacements = Object.freeze([
  Object.freeze({ id: 'abort-proof-rock', kind: 'asset-proxy', assetFamily: 'rocky-terrain' }),
]);

const loadedModel = new THREE.Group();
const geometry = new THREE.BoxGeometry(1, 1, 1);
const material = new THREE.MeshStandardMaterial({ color: 0x665f56 });
loadedModel.add(new THREE.Mesh(geometry, material));

let geometryDisposed = false;
let materialDisposed = false;
const disposeGeometry = geometry.dispose.bind(geometry);
const disposeMaterial = material.dispose.bind(material);
geometry.dispose = () => { geometryDisposed = true; disposeGeometry(); };
material.dispose = () => { materialDisposed = true; disposeMaterial(); };

const originalFetch = globalThis.fetch;
const originalLoadModel = AssetLoader.prototype.loadModel;
let loadCalls = 0;

try {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: new Headers({
      'content-length': '4096',
      'content-type': 'model/gltf-binary',
    }),
  });
  AssetLoader.prototype.loadModel = async () => {
    loadCalls += 1;
    controller.abort();
    return loadedModel;
  };

  const result = await upgradeNaturalGeologyAssets(group, {
    signal: controller.signal,
    isMobileClass: false,
  });

  assert(loadCalls === 1, `expected one GLB load before abort, got ${loadCalls}`);
  assert(controller.signal.aborted, 'test did not trigger the abort signal');
  assert(geometryDisposed, 'aborted loaded geometry was not disposed');
  assert(materialDisposed, 'aborted loaded material was not disposed');
  assert(group.children.length === 0, `aborted hydration mutated group with ${group.children.length} child(ren)`);
  assert(result.activeFamilyCount === 0, `aborted hydration reported ${result.activeFamilyCount} active family/families`);
  assert(result.hydratedPlacementCount === 0, `aborted hydration reported ${result.hydratedPlacementCount} hydrated placement(s)`);
  assert(result.families?.[0]?.status === 'aborted', `primary family status was ${result.families?.[0]?.status}`);
  assert(result.families?.[1]?.status === 'aborted', `secondary family status was ${result.families?.[1]?.status}`);

  console.log('[checkNaturalGeologyAbortSafety] PASS');
  console.log(JSON.stringify({
    status: result.status,
    activeFamilyCount: result.activeFamilyCount,
    hydratedPlacementCount: result.hydratedPlacementCount,
    familyStatuses: result.families.map((family) => family.status),
    disposed: { geometry: geometryDisposed, material: materialDisposed },
    groupChildren: group.children.length,
  }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
  AssetLoader.prototype.loadModel = originalLoadModel;
}
