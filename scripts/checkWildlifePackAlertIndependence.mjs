import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import * as THREE from '../src/3d/vendor/three/three.module.js';

const sourcePath = new URL('../src/3d/gameplay/animals.js', import.meta.url);
const harnessPath = new URL('../src/3d/gameplay/.pack-alert-animals-harness.mjs', import.meta.url);
const source = await readFile(sourcePath, 'utf8');
const harnessSource = source
  .replace("from 'three'", "from '../vendor/three/three.module.js'")
  .replace("import { AssetLoader } from '../assetLoader.js';", 'const AssetLoader = { disposeObject3D() {} };');
assert.notEqual(harnessSource, source, 'expected animals.js to use the shipped bare Three import');
assert(!harnessSource.includes("from 'three'"), 'test harness must resolve Three through the shipped vendor module');
assert(!harnessSource.includes("from '../assetLoader.js'"), 'test harness must not re-enter AssetLoader bare-Three imports');
await writeFile(harnessPath, harnessSource, 'utf8');
let createWolf;
try {
  ({ createWolf } = await import(`${pathToFileURL(harnessPath.pathname).href}?pack-alert=${Date.now()}`));
} finally {
  await unlink(harnessPath).catch(() => {});
}

function makeModel() {
  const root = new THREE.Group();
  root.animations = [
    new THREE.AnimationClip('Idle', 1, []),
    new THREE.AnimationClip('Walk', 1, []),
    new THREE.AnimationClip('Run', 1, []),
  ];
  return root;
}

const assetLoader = { async loadModel() { return makeModel(); } };
const groundCollider = {
  getGroundHeight(x, z) {
    assert(Number.isFinite(x) && Number.isFinite(z));
    return 0;
  },
};

const wolf = await createWolf({
  assetLoader,
  modelUrl: 'test-wolf.glb',
  idleClipName: 'Idle',
  walkClipName: 'Walk',
  fleeClipName: 'Run',
  worldX: 0,
  worldZ: 0,
  groundY: 0,
  groundCollider,
  patrolWaypoints: [{ x: 0, z: 0 }, { x: 5, z: 0 }],
  fleeTriggerRadiusMeters: 6,
  fleeSpeedMps: 4.5,
  packAlertRadiusMeters: 5,
});

wolf.update(3, undefined, [
  { x: 0, z: -3 },
  { x: -1, z: 0 },
  { x: Number.NaN, z: 0 },
]);
assert.equal(wolf.isFleeing, true);
assert.equal(wolf.object3D.userData.wildlifeFlee.phase, 'pack-flee');
assert.equal(wolf.object3D.userData.wildlifeFlee.pack, true);
assert.equal(wolf.object3D.userData.wildlifeFlee.direct, false);
assert.equal(wolf.object3D.userData.wildlifeFlee.distanceMeters, null);
assert(Math.abs(wolf.object3D.position.x - 0.45) < 1e-9, `expected bounded +X pack flee, got ${wolf.object3D.position.x}`);
assert(Math.abs(wolf.object3D.position.z) < 1e-9, `nearest packmate should define direction, got z=${wolf.object3D.position.z}`);

const before = wolf.object3D.position.clone();
wolf.update(0.1, undefined, [{ x: Infinity, z: 0 }, { x: 0, z: Number.NaN }]);
assert(Number.isFinite(wolf.object3D.position.x) && Number.isFinite(wolf.object3D.position.z));
assert.equal(wolf.object3D.userData.wildlifeFlee.pack, false);
assert.equal(wolf.object3D.position.distanceTo(before) > 0, true, 'patrol may resume after alarm disappears');

wolf.dispose();
console.log('Wildlife pack-alert independence: PASS');
