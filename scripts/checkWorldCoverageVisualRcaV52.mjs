import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimePath = path.join(ROOT, 'src/3d/world/worldCoverageVisualRuntimeV52.js');
const policyPath = path.join(ROOT, 'src/3d/world/worldCoverageVisualRuntimeV52Policies.js');
const runtime = fs.readFileSync(runtimePath, 'utf8');
const policy = fs.readFileSync(policyPath, 'utf8');

let checks = 0;
function check(value, message) {
  checks += 1;
  assert.ok(value, message);
}

function forbid(text, message) {
  checks += 1;
  assert.equal(runtime.includes(text), false, message);
}

const P0_RCA = [
  ['rectangular water', ['water', 'stripeSuppression', 'visibleWaterRectangles']],
  ['directional wave repetition', ['WATER_UNIFORM_ALIASES', 'uWaveStrength', 'uSwellStrength']],
  ['cyan material risk', ['cyan-risk', 'colorRiskScore']],
  ['tile-boundary handling', ['frustumCulled', 'worldCoverageVisualV52']],
  ['black background', ['applyBlackSkyFallback', 'fallbackBackground']],
];
for (const [cause, tokens] of P0_RCA) {
  for (const token of tokens) check(runtime.includes(token) || policy.includes(token), `P0 RCA token missing for ${cause}: ${token}`);
}

const P1_RCA = [
  'GEOLOGY_POLICIES',
  'normalStrength',
  'Talus',
  'canonicalHeight',
  'runtime-geometry-normal-present',
];
for (const token of P1_RCA) check(runtime.includes(token) || policy.includes(token), `P1 RCA token missing: ${token}`);

const P2_RCA = [
  'roughness',
  'normalScale',
  'roughnessMap',
  'normalMap',
  'aoMap',
  'authored-imported-materials-preferred',
];
for (const token of P2_RCA) check(runtime.includes(token) || policy.includes(token), `P2 RCA token missing: ${token}`);

const P3_RCA = [
  'v52ScaleJitterApplied',
  'v52YawJitterApplied',
  'frustumCulled',
  'placementValidated',
  'ground-contact-metadata-required',
];
for (const token of P3_RCA) check(runtime.includes(token), `P3 RCA token missing: ${token}`);

const P4_RCA = [
  'classifyWaterKind',
  'worldCoverageVisualV52DepthResponse',
  'stripeSuppression',
  'depthWrite',
];
for (const token of P4_RCA) check(runtime.includes(token) || policy.includes(token), `P4 RCA token missing: ${token}`);

const P5_RCA = [
  'applySceneAtmosphere',
  'horizonLift',
  'fogColor',
  'blackBackgroundThreshold',
];
for (const token of P5_RCA) check(runtime.includes(token) || policy.includes(token), `P5 RCA token missing: ${token}`);

const unsafeGeometryPatterns = [
  /new\s+THREE\.BoxGeometry/, /new\s+THREE\.SphereGeometry/, /new\s+THREE\.ConeGeometry/,
  /new\s+THREE\.CylinderGeometry/, /new\s+THREE\.PlaneGeometry/,
];
for (const expression of unsafeGeometryPatterns) forbid(expression.source, `runtime must not author placeholder geometry: ${expression}`);

const contractStatements = [
  "materialContract: 'MaterialAssignmentCore'",
  "placementContract: 'WorldAssetPlacementPipeline'",
  "materialContract: 'MaterialAssignmentCore',",
  "placementContract: 'WorldAssetPlacementPipeline',",
];
for (const statement of contractStatements) check(runtime.includes(statement) || policy.includes(statement), `shared contract statement missing: ${statement}`);

const budgetStatements = [
  'maxMaterialMutationsPerFrame',
  'maxObjectMutationsPerFrame',
  'rescanIntervalFrames',
  'MAX_SCAN_NODES',
  'MAX_TRACKED_MATERIALS',
  'MAX_TRACKED_OBJECTS',
];
for (const statement of budgetStatements) check(runtime.includes(statement) || policy.includes(statement), `performance budget statement missing: ${statement}`);

const deterministicStatements = [
  'numericHash',
  'deterministicUnit',
  'deterministicRange',
  'numericHash(object)',
  'hash ^ 0x1177',
  'hash ^ 0x55aa',
];
for (const statement of deterministicStatements) check(runtime.includes(statement) || policy.includes(statement), `determinism statement missing: ${statement}`);

const visualFailureWords = ['placeholder', 'floating', 'cyan', 'moiré', 'black sky', 'flat-plastic'];
for (const word of visualFailureWords) {
  check(runtime.toLowerCase().includes(word) || policy.toLowerCase().includes(word), `known visual failure must remain encoded: ${word}`);
}

const acceptanceWords = ['visibleGridSeamsTarget', 'visibleWaterRectanglesTarget', 'obviousWaterMoiréTarget', 'blackSkyTarget', 'floatingVegetationTarget'];
for (const word of acceptanceWords) check(runtime.includes(word), `acceptance target missing: ${word}`);

console.log(`WORLD_COVERAGE_VISUAL_RUNTIME_V52_RCA_OK checks=${checks}`);
