import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import * as THREE from '../src/3d/vendor/three/three.module.js';

const sourcePath = new URL('../src/3d/gameplay/animals.js', import.meta.url);
const harnessPath = new URL('../src/3d/gameplay/.pack-cleanup-animals-harness.mjs', import.meta.url);
const source = await readFile(sourcePath, 'utf8');
const harness = source
  .replace("from 'three'", "from '../vendor/three/three.module.js'")
  .replace("import { AssetLoader } from '../assetLoader.js';", 'const AssetLoader = { disposeObject3D() {} };');
await writeFile(harnessPath, harness, 'utf8');
let createWolf;
try {
  ({ createWolf } = await import(`${pathToFileURL(harnessPath.pathname).href}?cleanup=${Date.now()}`));
} finally {
  await unlink(harnessPath).catch(() => {});
}

const assetLoader = { async loadModel() {
  const root = new THREE.Group();
  root.animations = [new THREE.AnimationClip('Idle', 1, []), new THREE.AnimationClip('Walk', 1, []), new THREE.AnimationClip('Run', 1, [])];
  return root;
} };
const wolf = await createWolf({
  assetLoader, modelUrl: 'test-wolf.glb', idleClipName: 'Idle', walkClipName: 'Walk', fleeClipName: 'Run',
  worldX: 0, worldZ: 0, groundY: 0, groundCollider: { getGroundHeight() { return 0; } },
  patrolWaypoints: [{ x: 0, z: 0 }, { x: 5, z: 0 }], fleeTriggerRadiusMeters: 6, fleeSpeedMps: 4.5, packAlertRadiusMeters: 5,
});
let reads = 0;
let closes = 0;
const boundedSource = {
  [Symbol.iterator]() {
    return {
      next() { reads += 1; return { done: false, value: reads === 1 ? { x: 0, z: -2 } : { x: 100, z: 100 } }; },
      return() { closes += 1; return { done: true }; },
    };
  },
};
assert.doesNotThrow(() => wolf.update(3, undefined, boundedSource));
assert.equal(reads, 32, 'pack sensing must stop at the per-tick sample budget');
assert.equal(closes, 1, 'bounded pack sensing must close its iterator exactly once');
assert.equal(wolf.object3D.userData.wildlifeFlee.phase, 'pack-flee');
assert(Number.isFinite(wolf.object3D.position.x) && Number.isFinite(wolf.object3D.position.z));
let naturalReturnReads = 0;
const naturalSource = { [Symbol.iterator]() { let index = 0; return { next() { index += 1; return index === 1 ? { done: false, value: { x: 0, z: -2 } } : { done: true }; }, get return() { naturalReturnReads += 1; throw new Error('natural return getter'); } }; } };
assert.doesNotThrow(() => wolf.update(3, undefined, naturalSource));
assert.equal(naturalReturnReads, 0, 'naturally exhausted pack iterators must not inspect return cleanup');
const faultingReturnGetter = { [Symbol.iterator]() { return { next() { return { done: false, value: { x: 100, z: 100 } }; }, get return() { throw new Error('return getter'); } }; } };
const faultingReturnCall = { [Symbol.iterator]() { return { next() { return { done: false, value: { x: 100, z: 100 } }; }, return() { throw new Error('return call'); } }; } };
assert.doesNotThrow(() => wolf.update(3, undefined, faultingReturnGetter));
assert.doesNotThrow(() => wolf.update(3, undefined, faultingReturnCall));
assert(Number.isFinite(wolf.object3D.position.x) && Number.isFinite(wolf.object3D.position.z));
wolf.dispose();
console.log('Wildlife pack iterator cleanup: PASS');
