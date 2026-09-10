import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let checks = 0;
const check = (value, message) => { checks += 1; assert.ok(value, message); };

const runtime = fs.readFileSync(path.join(ROOT, 'src/3d/world/worldCoverageVisualRuntimeV52.js'), 'utf8');
const policies = fs.readFileSync(path.join(ROOT, 'src/3d/world/worldCoverageVisualRuntimeV52Policies.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'game3d.html'), 'utf8');

const canonicalFiles = [
  'src/3d/world/worldReferenceSurfaceTerrainVisual.js',
  'src/3d/world/worldReferenceSurfacePindexes.js',
  'src/3d/world/worldReferenceAlignment.js',
  'src/3d/world/worldReferenceMigrationPlan.js',
  'src/3d/world/chunkManager.js',
  'src/3d/world/water.js',
  'src/3d/world/rivers.js',
  'src/3d/world/vegetation.js',
  'src/3d/world/roads.js',
];
for (const relative of canonicalFiles) check(fs.existsSync(path.join(ROOT, relative)), `canonical runtime source exists: ${relative}`);

const assetRoots = [
  'assets/models/env',
  'assets/models/vegetation',
  'assets/models/props',
  'assets/models/fbx',
  'assets/textures',
  'assets/shaders',
  'assets/particles',
  'assets/skyboxes',
  'assets/audio',
];
const presentRoots = assetRoots.filter((relative) => fs.existsSync(path.join(ROOT, relative)));
check(presentRoots.length >= 1, 'at least one asset root must exist');
for (const relative of presentRoots) check(fs.statSync(path.join(ROOT, relative)).isDirectory(), `asset root is directory: ${relative}`);

const forbiddenGeneratedGeometry = [
  'BoxGeometry', 'ConeGeometry', 'SphereGeometry', 'CylinderGeometry', 'PlaneGeometry',
];
for (const token of forbiddenGeneratedGeometry) check(!runtime.includes(token), `runtime must not create placeholder geometry: ${token}`);

const forbiddenAssetOverwriteWords = ['writeFileSync(.*assets/models', 'rmSync(.*assets/models', 'unlinkSync(.*assets/models'];
for (const pattern of forbiddenAssetOverwriteWords) check(!new RegExp(pattern).test(runtime), `runtime must not overwrite authored assets: ${pattern}`);

const requiredBoundaryTokens = [
  'authored-imported-materials-preferred',
  'canonical-runtime-geometry-only',
  'materialContract',
  'placementContract',
  'placementValidated',
  'grounded',
  'waterDistanceMeters',
  'slopeDegrees',
  'moisture',
];
for (const token of requiredBoundaryTokens) check(runtime.includes(token) || policies.includes(token), `placement/material boundary token: ${token}`);

const runtimeHooks = [
  'THREE.WebGLRenderer?.prototype',
  'prototype.render',
  'originalRender.call(this, scene, camera, ...rest)',
  'updateWorldCoverageVisualRuntimeV52(scene, camera)',
];
for (const token of runtimeHooks) check(runtime.includes(token), `runtime hook token: ${token}`);

check(html.includes("import './src/3d/world/worldCoverageVisualRuntimeV52.js';"), 'game3d entry loads v52');
check(html.indexOf("import './src/3d/world/worldCoverageVisualRuntimeV52.js';") < html.indexOf("import { initGame3D }"), 'v52 hook executes before scene initialization');

const semanticFamilies = ['terrain', 'water', 'vegetation', 'geology', 'road', 'settlement', 'sky'];
for (const family of semanticFamilies) check(policies.includes(family), `semantic family encoded: ${family}`);

const waterKinds = ['sea', 'lake', 'river', 'generic'];
for (const kind of waterKinds) check(policies.includes(`${kind}:`), `water kind encoded: ${kind}`);

const visualPriorities = [
  'rectangular water block',
  'directional water stripe',
  'canonical height provenance',
  'macro breakup',
  'asset-first only',
  'deep-to-shallow color response',
  'non-black horizon',
];
for (const phrase of visualPriorities) check(runtime.includes(phrase) || policies.includes(phrase), `visual priority encoded: ${phrase}`);

console.log(`WORLD_COVERAGE_VISUAL_RUNTIME_V52_SOURCE_COVERAGE_OK checks=${checks}`);
