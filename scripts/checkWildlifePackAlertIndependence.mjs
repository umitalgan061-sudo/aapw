import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import * as THREE from '../src/3d/vendor/three/three.module.js';

const sourcePath = new URL('../src/3d/gameplay/animals.js', import.meta.url);
const harnessPath = new URL('../src/3d/gameplay/.pack-alert-animals-harness.mjs', import.meta.url);
const source = await readFile(sourcePath, 'utf8');
const faunaWorldPlacementImport = "import { evaluateConfiguredFaunaRoute, prepareConfiguredAnimalWorldAsset } from './faunaWorldPlacement.js';";
const harnessSource = source
  .replace("from 'three'", "from '../vendor/three/three.module.js'")
  .replace("import { AssetLoader } from '../assetLoader.js';", 'const AssetLoader = { disposeObject3D() {} };')
  .replace(faunaWorldPlacementImport, 'const evaluateConfiguredFaunaRoute = () => ({ ok: true }); const prepareConfiguredAnimalWorldAsset = () => ({ ok: true });');
assert.notEqual(harnessSource, source, 'expected animals.js to use the shipped bare Three import');
assert(!harnessSource.includes("from 'three'"), 'test harness must resolve Three through the shipped vendor module');
assert(!harnessSource.includes("from '../assetLoader.js'"), 'test harness must not re-enter AssetLoader bare-Three imports');
assert(!harnessSource.includes("from './faunaWorldPlacement.js'"), 'pack harness must not re-enter geographic-placement bare-Three imports');
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

function createTestWolf(overrides = {}) {
  return createWolf({
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
    ...overrides,
  });
}

const wolf = await createTestWolf();

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

const finiteDistantPlayerPackWolf = await createTestWolf();
finiteDistantPlayerPackWolf.update(3, { x: 0, z: -20 }, [{ x: -2, z: 0 }]);
assert.equal(finiteDistantPlayerPackWolf.object3D.userData.wildlifeFlee.phase, 'pack-flee');
assert.equal(finiteDistantPlayerPackWolf.object3D.userData.wildlifeFlee.direct, false);
assert.equal(finiteDistantPlayerPackWolf.object3D.userData.wildlifeFlee.pack, true);
assert(
  Math.abs(finiteDistantPlayerPackWolf.object3D.position.x - 0.45) < 1e-9
    && Math.abs(finiteDistantPlayerPackWolf.object3D.position.z) < 1e-9,
  'pack alerts must flee from the alerting packmate even when a finite non-direct player sample exists',
);
finiteDistantPlayerPackWolf.dispose();

const malformedPayloadWolf = await createTestWolf();
assert.doesNotThrow(
  () => malformedPayloadWolf.update(0.1, undefined, { x: 1, z: 1 }),
  'non-iterable pack payloads must fail closed instead of aborting the fauna tick',
);
assert.equal(malformedPayloadWolf.object3D.userData.wildlifeFlee.pack, false);
assert.equal(malformedPayloadWolf.object3D.userData.wildlifeFlee.direct, false);
assert(Number.isFinite(malformedPayloadWolf.object3D.position.x) && Number.isFinite(malformedPayloadWolf.object3D.position.z));
malformedPayloadWolf.dispose();

const malformedDirectRadiusWolf = await createTestWolf({ fleeTriggerRadiusMeters: Infinity });
malformedDirectRadiusWolf.update(0.1, { x: 0, z: -1 }, [{ x: 0, z: -1 }]);
assert.equal(malformedDirectRadiusWolf.object3D.userData.wildlifeFlee.direct, false, 'non-finite direct radius must fail closed');
assert.equal(malformedDirectRadiusWolf.object3D.userData.wildlifeFlee.pack, false, 'invalid direct radius must disable flee state entirely');
assert.equal(malformedDirectRadiusWolf.object3D.userData.wildlifeFlee.triggerRadiusMeters, null);
assert(Number.isFinite(malformedDirectRadiusWolf.object3D.position.x) && Number.isFinite(malformedDirectRadiusWolf.object3D.position.z));
malformedDirectRadiusWolf.dispose();

const malformedPackRadiusWolf = await createTestWolf({ packAlertRadiusMeters: Infinity });
malformedPackRadiusWolf.update(0.1, undefined, [{ x: 0, z: -1 }]);
assert.equal(malformedPackRadiusWolf.object3D.userData.wildlifeFlee.pack, false, 'non-finite pack radius must disable pack awareness');
assert.equal(malformedPackRadiusWolf.object3D.userData.wildlifeFlee.direct, false);
malformedPackRadiusWolf.dispose();

const negativeRadiusWolf = await createTestWolf({ fleeTriggerRadiusMeters: -1, packAlertRadiusMeters: -1 });
negativeRadiusWolf.update(0.1, { x: 0, z: 0 }, [{ x: 0, z: 0 }]);
assert.equal(negativeRadiusWolf.object3D.userData.wildlifeFlee.direct, false, 'negative direct radius must fail closed');
assert.equal(negativeRadiusWolf.object3D.userData.wildlifeFlee.pack, false, 'negative pack radius must fail closed');
assert.equal(negativeRadiusWolf.object3D.userData.wildlifeFlee.triggerRadiusMeters, null);
negativeRadiusWolf.dispose();

const setBackedPackWolf = await createTestWolf();
const setBackedPack = new Set([
  { x: 0, z: -2 },
  { x: Number.NaN, z: 0 },
]);
setBackedPackWolf.update(3, undefined, setBackedPack);
assert.equal(setBackedPackWolf.object3D.userData.wildlifeFlee.phase, 'pack-flee');
assert.equal(setBackedPackWolf.object3D.userData.wildlifeFlee.pack, true);
assert.equal(setBackedPackWolf.object3D.userData.wildlifeFlee.direct, false);
assert(
  Math.abs(setBackedPackWolf.object3D.position.x) < 1e-9
    && Math.abs(setBackedPackWolf.object3D.position.z - 0.45) < 1e-9,
  'Set-backed pack aggregators must preserve bounded player-independent flee without array materialization',
);
setBackedPackWolf.dispose();

const boundedScanWolf = await createTestWolf();
let boundedScanReads = 0;
const infinitePackSource = {
  [Symbol.iterator]() {
    return {
      next() {
        boundedScanReads += 1;
        return { value: boundedScanReads === 1 ? { x: 0, z: -2 } : { x: 100, z: 100 }, done: false };
      },
    };
  },
};
assert.doesNotThrow(
  () => boundedScanWolf.update(3, undefined, infinitePackSource),
  'an infinite pack adapter must be bounded by the per-tick sample budget',
);
assert.equal(boundedScanReads, 32, 'pack scanning must consume at most 32 iterator samples per wildlife tick');
assert.equal(boundedScanWolf.object3D.userData.wildlifeFlee.phase, 'pack-flee');
assert.equal(boundedScanWolf.object3D.userData.wildlifeFlee.pack, true);
assert(Number.isFinite(boundedScanWolf.object3D.position.x) && Number.isFinite(boundedScanWolf.object3D.position.z));
boundedScanWolf.dispose();

const faultingPackWolf = await createTestWolf();
let faultingPackReads = 0;
const faultingPackSource = {
  [Symbol.iterator]() {
    return {
      next() {
        faultingPackReads += 1;
        throw new Error('adapter failure must fail closed inside group-AI sensing');
      },
    };
  },
};
assert.doesNotThrow(
  () => faultingPackWolf.update(0.1, undefined, faultingPackSource),
  'faulting iterable pack adapters must fail closed instead of aborting the fauna tick',
);
assert.equal(faultingPackReads, 1);
assert.equal(faultingPackWolf.object3D.userData.wildlifeFlee.pack, false);
assert(Number.isFinite(faultingPackWolf.object3D.position.x) && Number.isFinite(faultingPackWolf.object3D.position.z));
faultingPackWolf.dispose();

const faultingResultWolf = await createTestWolf();
const faultingResultSource = {
  [Symbol.iterator]() {
    return {
      next() {
        return Object.defineProperty({}, 'done', {
          get() { throw new Error('iterator-result getters must fail closed'); },
        });
      },
    };
  },
};
assert.doesNotThrow(
  () => faultingResultWolf.update(0.1, undefined, faultingResultSource),
  'faulting iterator-result getters must not abort the fauna tick',
);
assert.equal(faultingResultWolf.object3D.userData.wildlifeFlee.pack, false);
faultingResultWolf.dispose();

const faultingCoordinateWolf = await createTestWolf();
let faultingCoordinateReads = 0;
const faultingCoordinateSource = {
  [Symbol.iterator]() {
    return {
      next() {
        faultingCoordinateReads += 1;
        if (faultingCoordinateReads === 1) {
          return { done: false, value: { get x() { throw new Error('sample getter failure'); }, z: 0 } };
        }
        if (faultingCoordinateReads === 2) return { done: false, value: { x: 0, z: -2 } };
        return { done: true };
      },
    };
  },
};
assert.doesNotThrow(
  () => faultingCoordinateWolf.update(3, undefined, faultingCoordinateSource),
  'one faulting pack sample must be skipped without hiding a later finite threat',
);
assert.equal(faultingCoordinateReads, 3);
assert.equal(faultingCoordinateWolf.object3D.userData.wildlifeFlee.phase, 'pack-flee');
assert.equal(faultingCoordinateWolf.object3D.userData.wildlifeFlee.pack, true);
assert(Math.abs(faultingCoordinateWolf.object3D.position.z - 0.45) < 1e-9);
faultingCoordinateWolf.dispose();

const directThreatWolf = await createTestWolf();
let directThreatPackIteratorGets = 0;
let directThreatPackReads = 0;
const unboundedPackSource = {};
Object.defineProperty(unboundedPackSource, Symbol.iterator, {
  get() {
    directThreatPackIteratorGets += 1;
    return function iteratorFactory() {
      return {
        next() {
          directThreatPackReads += 1;
          throw new Error('direct player threat must short-circuit pack iteration');
        },
      };
    };
  },
});
assert.doesNotThrow(
  () => directThreatWolf.update(3, { x: 0, z: -1 }, unboundedPackSource),
  'direct player threat must not consume an unbounded or faulting pack source',
);
assert.equal(directThreatPackIteratorGets, 0, 'direct player threat should not even resolve the pack iterator');
assert.equal(directThreatPackReads, 0, 'direct player threat should perform zero pack iterator reads');
assert.equal(directThreatWolf.object3D.userData.wildlifeFlee.phase, 'flee');
assert.equal(directThreatWolf.object3D.userData.wildlifeFlee.direct, true);
assert.equal(directThreatWolf.object3D.userData.wildlifeFlee.pack, false);
assert(directThreatWolf.object3D.position.z > 0, 'direct threat should still move the wolf away from the player');
directThreatWolf.dispose();

const tiedPackmates = [
  { x: 0, z: -2 },
  { x: -2, z: 0 },
];
const tieForward = await createTestWolf();
tieForward.update(3, undefined, tiedPackmates);
const forwardPosition = tieForward.object3D.position.clone();
tieForward.dispose();
const tieReverse = await createTestWolf();
tieReverse.update(3, undefined, [...tiedPackmates].reverse());
const reversePosition = tieReverse.object3D.position.clone();
tieReverse.dispose();
assert(forwardPosition.distanceTo(reversePosition) < 1e-9, 'equal-distance pack threats must resolve deterministically independent of iteration order');

console.log('Wildlife pack alert independence: PASS');
