import assert from 'node:assert/strict';
import * as THREE from '../src/3d/vendor/three/three.module.js';
import {
  classifyWorldCoverageVisualObject,
  evaluateWorldCoverageVisualObject,
} from '../src/3d/world/worldCoverageVisualRuntimeV52.js';
import {
  deterministicRange,
  deterministicUnit,
  tierForDistance,
} from '../src/3d/world/worldCoverageVisualRuntimeV52Policies.js';

let checks = 0;
const check = (value, message) => { checks += 1; assert.ok(value, message); };
const equal = (a, b, message) => { checks += 1; assert.deepEqual(a, b, message); };

const seeds = Array.from({ length: 64 }, (_, index) => index * 7919);
for (const seed of seeds) {
  const a = deterministicUnit(seed);
  const b = deterministicUnit(seed);
  equal(a, b, `unit determinism ${seed}`);
  check(a >= 0 && a <= 1, `unit bounds ${seed}`);
  const rangeA = deterministicRange(seed, 0.8, 1.2);
  const rangeB = deterministicRange(seed, 0.8, 1.2);
  equal(rangeA, rangeB, `range determinism ${seed}`);
  check(rangeA >= 0.8 && rangeA <= 1.2, `range bounds ${seed}`);
}

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 50000);
camera.position.set(100, 120, 180);
const families = [
  ['terrain-ground', 'terrain'],
  ['sea-water', 'water'],
  ['river-channel', 'water'],
  ['pine-tree', 'vegetation'],
  ['forest-shrub', 'vegetation'],
  ['mountain-cliff', 'geology'],
  ['ridge-scree', 'geology'],
  ['road-main', 'road'],
  ['castle-wall', 'settlement'],
  ['sky-aurora', 'sky'],
];
for (const [name, family] of families) {
  const object = { name, userData: { worldVisualFamily: family }, position: { x: 0, y: 0, z: 0 } };
  const first = classifyWorldCoverageVisualObject(object);
  const second = classifyWorldCoverageVisualObject(object);
  equal(first, second, `classification determinism ${name}`);
  equal(first.family, family, `classification family ${name}`);
}

const evaluationObjects = families.map(([name, family], index) => ({
  name,
  uuid: `det-${index}`,
  userData: { worldVisualFamily: family },
  position: { x: index * 50, y: 0, z: index * -30 },
}));
for (const object of evaluationObjects) {
  const first = evaluateWorldCoverageVisualObject(object, camera);
  const second = evaluateWorldCoverageVisualObject(object, camera);
  equal(first.family, second.family, `evaluation family determinism ${object.name}`);
  equal(first.tier, second.tier, `evaluation tier determinism ${object.name}`);
  equal(first.distanceMeters, second.distanceMeters, `evaluation distance determinism ${object.name}`);
  equal(first.risks, second.risks, `evaluation risk determinism ${object.name}`);
}

const tierBoundaryCases = [
  [0, 'near'], [1600, 'near'], [1601, 'mid'], [5200, 'mid'], [5201, 'far'], [11000, 'far'], [11001, 'extreme'],
];
for (const [distance, tier] of tierBoundaryCases) equal(tierForDistance(distance), tier, `tier boundary ${distance}`);

const syntheticObjects = Array.from({ length: 96 }, (_, index) => ({
  name: `forest-tree-${index}`,
  uuid: `forest-${index}`,
  userData: { worldVisualFamily: 'vegetation', grounded: true, placementValidated: true },
  position: { x: index * 17, y: 0, z: index * -11 },
}));
const deterministicPairs = syntheticObjects.map((object) => {
  const first = evaluateWorldCoverageVisualObject(object, camera);
  const second = evaluateWorldCoverageVisualObject(object, camera);
  return [first.tier, second.tier];
});
for (const [first, second] of deterministicPairs) equal(first, second, 'batch tier determinism');

console.log(`WORLD_COVERAGE_VISUAL_RUNTIME_V52_DETERMINISM_OK checks=${checks}`);
