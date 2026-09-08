#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  WIND_GRASS_LIFECYCLE_POLICY,
  createWindGrassRun180,
  disposeWindGrassRun180,
} from '../src/3d/world/windGrass.js';
import { disposeVegetation } from '../src/3d/world/vegetation.js';

const ROOT = resolve(import.meta.dirname, '..');
const source = readFileSync(resolve(ROOT, 'src/3d/world/windGrass.js'), 'utf8');
const vegetationSource = readFileSync(resolve(ROOT, 'src/3d/world/vegetation.js'), 'utf8');

assert.equal(WIND_GRASS_LIFECYCLE_POLICY.moduleOwnsGpuResources, true);
assert.equal(WIND_GRASS_LIFECYCLE_POLICY.idempotentDispose, true);
assert.equal(WIND_GRASS_LIFECYCLE_POLICY.pagehideCleanup, true);
assert.equal(WIND_GRASS_LIFECYCLE_POLICY.clearsRenderCallback, true);

assert(vegetationSource.includes("import { disposeWindGrassRun180 } from './windGrass.js';")
  && vegetationSource.includes('disposeWindGrassRun180(grass);'),
'vegetation teardown bypassed the wind-grass resource owner');

for (const snippet of [
  'export function disposeWindGrassRun180',
  'node.onBeforeRender = null',
  "window.removeEventListener('pagehide', pagehideHandler)",
  "window.addEventListener('pagehide', pagehideHandler, { once: true })",
  'moduleOwnsGpuResources: true',
  'idempotentDispose: true',
]) {
  assert(source.includes(snippet), `wind-grass lifecycle source contract lost: ${snippet}`);
}

const created = createWindGrassRun180({
  sampleHeightMeters: () => 36,
  seaLevelMeters: 0,
  seed: 424242,
  seats: [],
  roadEdges: [],
  isMobileClass: true,
  centerX: 0,
  centerZ: 0,
});

assert(created.group);
assert(created.mesh);
assert.equal(created.group.children.length, 1);
assert.equal(created.group.userData.windGrassLifecycle.disposed, false);
assert.equal(created.group.userData.windGrassLifecycle.policyId, WIND_GRASS_LIFECYCLE_POLICY.id);
assert.equal(typeof created.mesh.onBeforeRender, 'function');
assert(created.mesh.geometry);
assert(created.mesh.material);

let geometryDisposals = 0;
let materialDisposals = 0;
const originalGeometryDispose = created.mesh.geometry.dispose.bind(created.mesh.geometry);
const originalMaterialDispose = created.mesh.material.dispose.bind(created.mesh.material);
created.mesh.geometry.dispose = () => {
  geometryDisposals += 1;
  originalGeometryDispose();
};
created.mesh.material.dispose = () => {
  materialDisposals += 1;
  originalMaterialDispose();
};

disposeWindGrassRun180(created.group);

assert.equal(geometryDisposals, 1, 'grass geometry must be disposed exactly once');
assert.equal(materialDisposals, 1, 'grass material must be disposed exactly once');
assert.equal(created.mesh.onBeforeRender, null, 'render callback kept a disposed grass material alive');
assert.equal(created.group.children.length, 0, 'disposed wind-grass group retained render children');
assert.equal(created.group.userData.windGrassLifecycle.disposed, true);
assert.equal(created.group.userData.windGrassLifecycle.geometryCount, 1);
assert.equal(created.group.userData.windGrassLifecycle.materialCount, 1);

// A second teardown path is expected in real browser lifecycles (manual cleanup + pagehide). It must
// not dispose shared GPU objects twice or mutate the already-recorded ownership summary.
const summary = created.group.userData.windGrassLifecycle;
disposeWindGrassRun180(created.group);
assert.equal(geometryDisposals, 1);
assert.equal(materialDisposals, 1);
assert.equal(created.group.userData.windGrassLifecycle, summary);

const integrated = createWindGrassRun180({
  sampleHeightMeters: () => 36,
  seaLevelMeters: 0,
  seed: 818181,
  seats: [],
  roadEdges: [],
  isMobileClass: true,
  centerX: 0,
  centerZ: 0,
});
const vegetationOwner = new THREE.Group();
vegetationOwner.add(integrated.group);
vegetationOwner.userData.run180GrassGroup = integrated.group;
disposeVegetation(vegetationOwner);
assert.equal(integrated.group.userData.windGrassLifecycle.disposed, true,
  'vegetation teardown did not invoke the wind-grass owner');
assert.equal(integrated.mesh.onBeforeRender, null,
  'vegetation teardown retained the grass render callback');
assert.equal(integrated.group.children.length, 0,
  'vegetation teardown retained grass render children');

console.log('[checkWindGrassLifecycle] PASS');
console.log(JSON.stringify({
  policyId: WIND_GRASS_LIFECYCLE_POLICY.id,
  geometryDisposals,
  materialDisposals,
  idempotent: true,
  pagehideCleanup: true,
  renderCallbackCleared: true,
}, null, 2));
