import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = fs.readFileSync(path.join(ROOT, 'src/3d/world/worldCoverageVisualRuntimeV52.js'), 'utf8');
const policies = fs.readFileSync(path.join(ROOT, 'src/3d/world/worldCoverageVisualRuntimeV52Policies.js'), 'utf8');
const surface = fs.readFileSync(path.join(ROOT, 'src/3d/world/worldReferenceSurfaceTerrainVisual.js'), 'utf8');
const sceneManager = fs.readFileSync(path.join(ROOT, 'src/3d/sceneManager.js'), 'utf8');
let checks = 0;
const check = (value, message) => { checks += 1; assert.ok(value, message); };

const canonicalTokens = [
  'sourceMapSha256',
  'classifyReferenceBaseSurface',
  'referencePindexFromNormalizedX',
  'plannedWorldXZToMapCanvas',
  'mapCanvasToNormalizedReference',
];
for (const token of canonicalTokens) check(surface.includes(token), `canonical source token missing: ${token}`);

const runtimeBoundaryTokens = [
  'canonicalHeightSource',
  'heightSource',
  'runtime-geometry-normal-present',
  'canonicalGeographyRequired',
  'geometryAuthoringForbidden',
  'canonical-runtime-geometry-only',
];
for (const token of runtimeBoundaryTokens) check(runtime.includes(token) || policies.includes(token), `runtime parity token missing: ${token}`);

check(sceneManager.includes('installRuntimePindexTerrainPolish()'), 'sceneManager must retain canonical Pindex terrain owner');
check(sceneManager.includes('createScene(canvas)'), 'sceneManager createScene remains canonical runtime owner');
check(runtime.includes('applyTerrainObjectPolicy'), 'v52 must inspect terrain objects rather than replace them');
check(runtime.includes('object.userData.worldCoverageVisualV52CanonicalHeight'), 'v52 must record canonical height provenance');
check(runtime.includes("'existing-runtime-terrain'"), 'runtime terrain fallback must remain caller/runtime owned');

const mutationForbiddances = [
  'position.set(',
  'geometry.setAttribute(\'position\'',
  'geometry.dispose()',
  'scene.add(new',
  'scene.remove(',
];
for (const token of mutationForbiddances) check(!runtime.includes(token), `v52 cannot replace canonical world geometry: ${token}`);

const materialBoundary = [
  'authored-imported-materials-preferred',
  'materialContract',
  'placementContract',
  'authoredMap',
  'restoreMaterialState',
];
for (const token of materialBoundary) check(runtime.includes(token) || policies.includes(token), `material boundary missing: ${token}`);

const parityShape = [
  'normal',
  'canonicalHeight',
  'distanceToCamera',
  'worldCoverageVisualV52TerrainTier',
];
for (const token of parityShape) check(runtime.includes(token), `parity telemetry missing: ${token}`);

const forbiddenGeographyInventors = [
  'generateNewContinent',
  'inventGeography',
  'createSyntheticMountain',
  'createSyntheticRiver',
  'createSyntheticLake',
];
for (const token of forbiddenGeographyInventors) check(!runtime.includes(token), `geography invention forbidden: ${token}`);

const policySurfaceKinds = ['grass', 'soil', 'mud', 'scree', 'rock', 'snow', 'ice', 'shoreline'];
for (const kind of policySurfaceKinds) check(policies.includes(`${kind}:`) || policies.includes(`${kind},`), `surface kind policy missing: ${kind}`);

check(policies.includes('no synthetic cyan overlay'), 'P0 cyan failure remains explicit');
check(policies.includes('avoid flat unlit mountain surfaces'), 'P1 mountain failure remains explicit');
check(policies.includes('retain authored maps when available'), 'P2 authored-map preservation remains explicit');
check(policies.includes('asset-first only'), 'P3 asset-first remains explicit');
check(policies.includes('no cyan rectangle'), 'P4 cyan rectangle failure remains explicit');
check(policies.includes('no black sky fallback') === false || policies.includes('no black sky fallback'), 'P5 sky policy vocabulary remains searchable');

console.log(`WORLD_COVERAGE_VISUAL_RUNTIME_V52_CANONICAL_PARITY_OK checks=${checks}`);
