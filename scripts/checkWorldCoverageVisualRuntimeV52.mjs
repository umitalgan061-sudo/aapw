import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from '../src/3d/vendor/three/three.module.js';
import {
  WORLD_COVERAGE_VISUAL_RUNTIME_V52,
  WORLD_COVERAGE_VISUAL_RUNTIME_V52_VERSION,
  WORLD_COVERAGE_VISUAL_RUNTIME_V52_ACCEPTANCE,
  classifyWorldCoverageVisualObject,
  createWorldCoverageVisualRuntimeV52Report,
  evaluateWorldCoverageVisualObject,
  getWorldCoverageVisualRuntimeV52Manifest,
  updateWorldCoverageVisualRuntimeV52,
} from '../src/3d/world/worldCoverageVisualRuntimeV52.js';
import {
  V52_ACCEPTANCE,
  WORLD_COVERAGE_VISUAL_V52_CONTRACT,
  classifyWaterKind,
  deterministicRange,
  deterministicUnit,
  normalizeVisualFamily,
  surfacePolicyFor,
  tierForDistance,
} from '../src/3d/world/worldCoverageVisualRuntimeV52Policies.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME = path.join(ROOT, 'src/3d/world/worldCoverageVisualRuntimeV52.js');
const POLICIES = path.join(ROOT, 'src/3d/world/worldCoverageVisualRuntimeV52Policies.js');
const HTML = path.join(ROOT, 'game3d.html');

let checks = 0;
function check(condition, message) {
  checks += 1;
  assert.ok(condition, message);
}

function equal(actual, expected, message) {
  checks += 1;
  assert.deepEqual(actual, expected, message);
}

function finite(value, message) {
  checks += 1;
  assert.ok(Number.isFinite(value), message);
}

function makeMesh({ name = 'terrain-ground', family, materialColor = [0.4, 0.42, 0.22], y = 10 } = {}) {
  const geometry = new THREE.BoxGeometry(8, 2, 8);
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(...materialColor),
    roughness: 0.72,
    metalness: 0.1,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.userData.worldVisualFamily = family;
  mesh.userData.grounded = true;
  mesh.userData.placementValidated = true;
  mesh.position.set(0, y, 0);
  return mesh;
}

const runtimeSource = fs.readFileSync(RUNTIME, 'utf8');
const policySource = fs.readFileSync(POLICIES, 'utf8');
const htmlSource = fs.readFileSync(HTML, 'utf8');

check(runtimeSource.includes("MaterialAssignmentCore"), 'runtime must declare the shared material contract');
check(runtimeSource.includes("WorldAssetPlacementPipeline"), 'runtime must declare the shared placement contract');
check(!runtimeSource.includes("EditorMaterialStudio"), 'runtime must not import EditorMaterialStudio');
check(!runtimeSource.includes("EditorAutoTexture"), 'runtime must not import editor material tooling');
check(runtimeSource.includes('geometryAuthoringForbidden'), 'runtime must state geometry authoring boundary');
check(runtimeSource.includes('canonicalGeography'), 'runtime must keep canonical geography provenance explicit');
check(policySource.includes('P0'), 'policy source must retain P0 acceptance vocabulary');
check(policySource.includes('P1'), 'policy source must retain P1 acceptance vocabulary');
check(policySource.includes('P2'), 'policy source must retain P2 acceptance vocabulary');
check(policySource.includes('P3'), 'policy source must retain P3 acceptance vocabulary');
check(policySource.includes('P4'), 'policy source must retain P4 acceptance vocabulary');
check(policySource.includes('P5'), 'policy source must retain P5 acceptance vocabulary');
check(htmlSource.includes('./src/3d/world/worldCoverageVisualRuntimeV52.js'), 'game3d.html must load the v52 runtime pass');
check(htmlSource.indexOf('./src/3d/world/worldCoverageVisualRuntimeV52.js') < htmlSource.indexOf('./src/3d/game3d.js'), 'v52 runtime must install before game3d init');

check(WORLD_COVERAGE_VISUAL_RUNTIME_V52.endsWith('v52'), 'runtime id must be v52');
equal(WORLD_COVERAGE_VISUAL_RUNTIME_V52_VERSION, 52, 'runtime version must be 52');
equal(WORLD_COVERAGE_VISUAL_RUNTIME_V52_ACCEPTANCE.visibleGridSeamsTarget, 0, 'grid seam target');
equal(WORLD_COVERAGE_VISUAL_RUNTIME_V52_ACCEPTANCE.visibleWaterRectanglesTarget, 0, 'water rectangle target');
equal(WORLD_COVERAGE_VISUAL_RUNTIME_V52_ACCEPTANCE.obviousWaterMoiréTarget, 0, 'water moire target');
equal(WORLD_COVERAGE_VISUAL_RUNTIME_V52_ACCEPTANCE.blackSkyTarget, 0, 'black sky target');

equal(normalizeVisualFamily('TREE_FIR'), 'vegetation', 'fir must classify vegetation');
equal(normalizeVisualFamily('river-water-surface'), 'water', 'river water must classify water');
equal(normalizeVisualFamily('castle-wall'), 'settlement', 'castle wall must classify settlement');
equal(normalizeVisualFamily('mountain-ridge-cliff'), 'geology', 'ridge cliff must classify geology');
equal(normalizeVisualFamily('mud-track-road'), 'terrain', 'terrain token precedence remains safe');
equal(normalizeVisualFamily('stone bridge'), 'geology', 'stone must not silently become road family when geology token wins');
equal(normalizeVisualFamily('road bridge'), 'road', 'road bridge must remain road family');
equal(normalizeVisualFamily(''), 'unknown', 'empty family is unknown');
equal(normalizeVisualFamily(null), 'unknown', 'null family is unknown');

equal(classifyWaterKind('great river'), 'river', 'river kind');
equal(classifyWaterKind('lake north'), 'lake', 'lake kind');
equal(classifyWaterKind('open ocean'), 'sea', 'sea kind');
equal(classifyWaterKind('canal-like water'), 'generic', 'generic water kind');

const seeds = [0, 1, 2, 3, 17, 37, 53, 99, 101, 1001, 65535, 4294967295];
for (const seed of seeds) {
  const value = deterministicUnit(seed);
  finite(value, `deterministic unit should be finite for seed ${seed}`);
  check(value >= 0 && value <= 1, `deterministic unit must remain [0,1] for seed ${seed}`);
  equal(deterministicUnit(seed), deterministicUnit(seed), `seed ${seed} must be stable`);
  const range = deterministicRange(seed, -2, 3);
  finite(range, `deterministic range should be finite for seed ${seed}`);
  check(range >= -2 && range <= 3, `deterministic range bounds for seed ${seed}`);
}

const tierCases = [
  [0, 'near'],
  [50, 'near'],
  [1599, 'near'],
  [1600, 'near'],
  [1601, 'mid'],
  [5199, 'mid'],
  [5200, 'mid'],
  [5201, 'far'],
  [10999, 'far'],
  [11000, 'far'],
  [11001, 'extreme'],
  [17000, 'extreme'],
  [17001, 'extreme'],
  [Infinity, 'near'],
];
for (const [distance, expected] of tierCases) equal(tierForDistance(distance), expected, `tier ${distance}`);

check(surfacePolicyFor('terrain', { surface: 'grass' }) !== null, 'grass surface policy');
check(surfacePolicyFor('terrain', { surface: 'snow' }) !== null, 'snow surface policy');
check(surfacePolicyFor('terrain', { surface: 'scree' }) !== null, 'scree surface policy');
check(surfacePolicyFor('water', { name: 'sea-water' }) !== null, 'sea policy');
check(surfacePolicyFor('water', { name: 'lake-water' }) !== null, 'lake policy');
check(surfacePolicyFor('water', { name: 'river-water' }) !== null, 'river policy');
check(surfacePolicyFor('geology', { kind: 'cliff' }) !== null, 'cliff policy');
check(surfacePolicyFor('road', { kind: 'path' }) !== null, 'path policy');
check(surfacePolicyFor('settlement', { kind: 'house' }) === null, 'settlement has no false surface material policy');

const familyCases = [
  ['terrain-ground', 'terrain'],
  ['world-water-sea', 'water'],
  ['river-flow', 'water'],
  ['pine-conifer', 'vegetation'],
  ['oak-tree', 'vegetation'],
  ['forest-shrub', 'vegetation'],
  ['grass-meadow', 'terrain'],
  ['mountain-cliff', 'geology'],
  ['ridge-rock', 'geology'],
  ['scree-talus', 'geology'],
  ['main-road', 'road'],
  ['stone-bridge', 'geology'],
  ['castle-wall', 'settlement'],
  ['village-house', 'settlement'],
  ['aurora-sky', 'sky'],
];
for (const [name, expectedFamily] of familyCases) {
  const object = makeMesh({ name });
  const result = classifyWorldCoverageVisualObject(object);
  equal(result.family, expectedFamily, `${name} family`);
}

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 30000);
camera.position.set(0, 100, 180);

const terrain = makeMesh({ name: 'terrain-ground', family: 'terrain' });
const water = makeMesh({ name: 'sea-water', family: 'water', materialColor: [0.08, 0.76, 0.85], y: 0 });
water.userData.waterKind = 'sea';
water.userData.waterSurfaceAreaMeters = 90000000;
const tree = makeMesh({ name: 'tree-pine', family: 'vegetation', materialColor: [0.20, 0.38, 0.15] });
tree.userData.assetId = 'env/tree/pine';
tree.userData.grounded = true;
const cliff = makeMesh({ name: 'mountain-cliff', family: 'geology', materialColor: [0.44, 0.42, 0.38] });
cliff.userData.kind = 'cliff';
const road = makeMesh({ name: 'road-main', family: 'road', materialColor: [0.35, 0.31, 0.25] });
const house = makeMesh({ name: 'settlement-house', family: 'settlement', materialColor: [0.55, 0.30, 0.17] });

const scene = new THREE.Scene();
scene.background = new THREE.Color(0, 0, 0);
scene.add(terrain, water, tree, cliff, road, house);
scene.userData.activeCamera = camera;

const manifestBefore = getWorldCoverageVisualRuntimeV52Manifest(scene);
check(manifestBefore === null, 'manifest must be absent before the first runtime update');
const manifestAfter = updateWorldCoverageVisualRuntimeV52(scene, camera);
check(manifestAfter !== null, 'manifest must exist after runtime update');
check(scene.userData.worldCoverageVisualV52Manifest !== null, 'manifest must be mirrored to scene userData');
check(scene.userData.worldCoverageVisualV52BlackSkyFallback === true, 'pure-black scene background must receive readable fallback');
check(scene.userData.worldCoverageVisualRuntimeV52.installed === true, 'scene install marker');
check(terrain.userData.worldCoverageVisualV52?.materialContract === 'MaterialAssignmentCore', 'terrain material contract marker');
check(terrain.userData.worldCoverageVisualV52?.placementContract === 'WorldAssetPlacementPipeline', 'terrain placement contract marker');
check(water.userData.worldCoverageVisualV52WaterKind === 'sea', 'water semantic kind marker');
check(tree.userData.v52ScaleJitterApplied !== undefined, 'vegetation receives deterministic scale variation');
check(tree.userData.v52YawJitterApplied !== undefined, 'vegetation receives deterministic yaw variation');
check(tree.frustumCulled === true, 'vegetation frustum culling');
check(cliff.frustumCulled === true, 'geology frustum culling');
check(road.frustumCulled === true, 'road frustum culling');
check(house.frustumCulled === true, 'settlement frustum culling');
check(water.frustumCulled === true, 'water frustum culling');
check(terrain.frustumCulled === true, 'terrain frustum culling');

check(terrain.material.roughness >= 0.80, 'terrain must remain visibly rough rather than plastic');
check(cliff.material.roughness >= 0.90, 'geology must remain rough');
check(water.material.roughness >= 0.22, 'water must avoid mirror-like moire amplification');
check(water.material.metalness <= 0.06, 'water metalness remains physically low');
check(tree.material.roughness >= 0.70, 'vegetation must not read as glossy plastic');
check(road.material.roughness >= 0.80, 'road must not read as synthetic ribbon');
check(house.material.metalness <= 0.08, 'settlement metalness must remain low by default');

const terrainEvaluation = evaluateWorldCoverageVisualObject(terrain, camera);
const waterEvaluation = evaluateWorldCoverageVisualObject(water, camera);
const treeEvaluation = evaluateWorldCoverageVisualObject(tree, camera);
const cliffEvaluation = evaluateWorldCoverageVisualObject(cliff, camera);
const roadEvaluation = evaluateWorldCoverageVisualObject(road, camera);
const houseEvaluation = evaluateWorldCoverageVisualObject(house, camera);
for (const evaluation of [terrainEvaluation, waterEvaluation, treeEvaluation, cliffEvaluation, roadEvaluation, houseEvaluation]) {
  finite(evaluation.distanceMeters, `${evaluation.family} distance must be finite`);
  check(['near', 'mid', 'far', 'extreme'].includes(evaluation.tier), `${evaluation.family} tier must be valid`);
}
check(waterEvaluation.family === 'water', 'water evaluation family');
check(treeEvaluation.family === 'vegetation', 'tree evaluation family');
check(cliffEvaluation.family === 'geology', 'cliff evaluation family');
check(roadEvaluation.family === 'road', 'road evaluation family');
check(houseEvaluation.family === 'settlement', 'house evaluation family');

const report = createWorldCoverageVisualRuntimeV52Report(scene, camera);
check(report.objectCount >= 6, 'report must include scene objects');
check(report.materialCount >= 6, 'report must include scene materials');
check(report.familyCounts.terrain >= 1, 'report terrain family');
check(report.familyCounts.water >= 1, 'report water family');
check(report.familyCounts.vegetation >= 1, 'report vegetation family');
check(report.familyCounts.geology >= 1, 'report geology family');
check(report.familyCounts.road >= 1, 'report road family');
check(report.familyCounts.settlement >= 1, 'report settlement family');
check(report.contract.materialContract === 'MaterialAssignmentCore', 'report material contract');
check(report.contract.placementContract === 'WorldAssetPlacementPipeline', 'report placement contract');

const scene2 = new THREE.Scene();
scene2.background = new THREE.Color(0.045, 0.07, 0.10);
const repeatedTrees = [];
for (let index = 0; index < 48; index += 1) {
  const item = makeMesh({ name: `forest-tree-${index}`, family: 'vegetation', y: 12 + index % 3 });
  item.userData.assetId = `env/forest/tree-${index % 4}`;
  item.userData.grounded = true;
  item.position.set((index % 12) * 70 - 350, item.position.y, Math.floor(index / 12) * 85 - 170);
  scene2.add(item);
  repeatedTrees.push(item);
}
const camera2 = new THREE.PerspectiveCamera(55, 1, 0.1, 30000);
camera2.position.set(0, 120, 100);
updateWorldCoverageVisualRuntimeV52(scene2, camera2);
const scaleSamples = repeatedTrees.map((item) => item.userData.v52ScaleJitterApplied);
const yawSamples = repeatedTrees.map((item) => item.userData.v52YawJitterApplied);
check(new Set(scaleSamples).size > 1, 'forest scale variation must contain more than one deterministic value');
check(new Set(yawSamples).size > 1, 'forest yaw variation must contain more than one deterministic value');
for (const value of scaleSamples) {
  finite(value, 'forest scale factor must be finite');
  check(value > 0.7 && value < 1.3, 'forest scale must remain natural');
}

const authoredMapMaterial = new THREE.MeshStandardMaterial({
  color: 0x556644,
  roughness: 0.8,
  metalness: 0.02,
});
authoredMapMaterial.map = { isTexture: true };
const authoredMesh = new THREE.Mesh(new THREE.BoxGeometry(4, 1, 4), authoredMapMaterial);
authoredMesh.name = 'terrain-authored-material';
authoredMesh.userData.worldVisualFamily = 'terrain';
authoredMesh.userData.grounded = true;
const authoredScene = new THREE.Scene();
authoredScene.add(authoredMesh);
updateWorldCoverageVisualRuntimeV52(authoredScene, camera2);
check(authoredMesh.material.map?.isTexture === true, 'authored terrain map must be preserved');
check(authoredMesh.material.vertexColors !== true, 'runtime pass must not force vertexColors on an unrelated authored map');

const invalidVegetation = makeMesh({ name: 'floating-tree', family: 'vegetation' });
invalidVegetation.userData.grounded = false;
invalidVegetation.userData.positionValidated = false;
const invalidScene = new THREE.Scene();
invalidScene.add(invalidVegetation);
updateWorldCoverageVisualRuntimeV52(invalidScene, camera2);
check(invalidVegetation.userData.worldCoverageVisualV52PlacementReview === 'ground-contact-metadata-required', 'unvalidated vegetation must be flagged');
check(invalidVegetation.frustumCulled === true, 'unvalidated vegetation remains safely culled');

const waterScene = new THREE.Scene();
const stripedWater = makeMesh({ name: 'lake-water-surface', family: 'water', materialColor: [0.65, 0.98, 1], y: 0 });
stripedWater.userData.waterKind = 'lake';
stripedWater.userData.shaderUniforms = {
  uNormalStrength: 1,
  uWaveStrength: 1,
  uFlowStrength: 1,
};
waterScene.add(stripedWater);
updateWorldCoverageVisualRuntimeV52(waterScene, camera2);
check(stripedWater.material.roughness >= 0.25, 'lake material roughness should be damped against moire');
check(stripedWater.material.emissive?.r === 0 || stripedWater.material.emissive === undefined, 'water emissive should not become neon');
check(stripedWater.userData.worldCoverageVisualV52DepthResponse !== undefined, 'water depth response marker');

for (const key of Object.keys(V52_ACCEPTANCE)) {
  check(V52_ACCEPTANCE[key] !== undefined, `acceptance key ${key} must be defined`);
}

const manifest = getWorldCoverageVisualRuntimeV52Manifest(scene);
check(manifest?.policyId === WORLD_COVERAGE_VISUAL_RUNTIME_V52, 'live manifest policy id');
check(manifest?.version === WORLD_COVERAGE_VISUAL_RUNTIME_V52_VERSION, 'live manifest version');
check(Array.isArray(manifest?.evidenceSamples), 'manifest evidence samples');
check(manifest?.visualTargets?.p0 === true, 'P0 visual target');
check(manifest?.visualTargets?.p1 === true, 'P1 visual target');
check(manifest?.visualTargets?.p2 === true, 'P2 visual target');
check(manifest?.visualTargets?.p3 === true, 'P3 visual target');
check(manifest?.visualTargets?.p4 === true, 'P4 visual target');
check(manifest?.visualTargets?.p5 === true, 'P5 visual target');

console.log(`WORLD_COVERAGE_VISUAL_RUNTIME_V52_OK checks=${checks}`);
