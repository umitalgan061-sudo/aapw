import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(ROOT, 'src/3d/world/worldCoverageVisualRuntimeV52.js'), 'utf8');
const policy = fs.readFileSync(path.join(ROOT, 'src/3d/world/worldCoverageVisualRuntimeV52Policies.js'), 'utf8');
let checks = 0;
const check = (condition, message) => { checks += 1; assert.ok(condition, message); };

const assetFirstWords = [
  'asset-first only',
  'authored-imported-materials-preferred',
  'canonical-runtime-geometry-only',
  'placementValidated',
  'grounded',
  'waterDistanceMeters',
  'slopeDegrees',
  'moisture',
];
for (const token of assetFirstWords) check(source.includes(token) || policy.includes(token), `asset-first token: ${token}`);

const forbiddenProceduralProps = [
  'new THREE.BoxGeometry',
  'new THREE.ConeGeometry',
  'new THREE.SphereGeometry',
  'new THREE.CylinderGeometry',
  'new THREE.PlaneGeometry',
  'new THREE.CapsuleGeometry',
];
for (const token of forbiddenProceduralProps) check(!source.includes(token), `procedural prop forbidden: ${token}`);

const materialPreservationWords = [
  'material.map',
  'material.normalMap',
  'material.roughnessMap',
  'material.metalnessMap',
  'material.aoMap',
  'authoredMap',
  'restoreMaterialState',
];
for (const token of materialPreservationWords) check(source.includes(token), `material preservation token: ${token}`);

const familyPolicies = ['terrain', 'water', 'vegetation', 'geology', 'road', 'settlement', 'sky'];
for (const family of familyPolicies) check(policy.includes(family), `family policy: ${family}`);

const waterPolicies = ['sea', 'lake', 'river', 'generic'];
for (const kind of waterPolicies) check(policy.includes(`${kind}:`), `water policy: ${kind}`);

const semanticMetadata = [
  'worldCoverageVisualV52PlacementBoundary',
  'materialContract',
  'placementContract',
  'assetId',
  'placementValidated',
  'surface',
  'slopeDegrees',
  'moisture',
  'waterDistanceMeters',
  'grounded',
];
for (const token of semanticMetadata) check(source.includes(token), `semantic metadata: ${token}`);

check(!source.includes('/editor/EditorMaterialStudio'), 'editor material UI import is forbidden');
check(!source.includes('/editor/EditorAutoTexture'), 'editor material automation import is forbidden');
check(!source.includes('EditorMaterialStudio.js'), 'editor material studio source string is forbidden');

console.log(`WORLD_COVERAGE_VISUAL_RUNTIME_V52_ASSET_CONTRACT_OK checks=${checks}`);
