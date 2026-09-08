/**
 * Character surface/material quality acceptance for the shared MaterialAssignmentCore seam.
 */
import assert from 'node:assert/strict';
import {
  TEXTURE_POLICY,
  inspectPlayerSurfaceEvidence,
  scorePlayerSurfaceMaterialDiversity,
  summarizePlayerSurfaceQuality,
} from '../src/3d/gameplay/playerAnimationSurfaceEvidence.js';

function makeMesh(name, material, uv = true) {
  return { name, isMesh: true, material, geometry: { attributes: uv ? { uv: {} } : {} }, userData: {} };
}
function makeRoot(meshes) {
  return { name: 'player', userData: {}, children: meshes, traverse(callback) { callback(this); for (const mesh of meshes) callback(mesh); } };
}
function material(name, paletteId, maps = {}) {
  return { name, userData: { paletteId }, ...Object.fromEntries(Object.entries(maps).map(([field, size]) => [field, { image: { width: size, height: size } }])) };
}

function testMultiSurfaceQuality() {
  const root = makeRoot([
    makeMesh('Skin', material('Skin', 'skin', { map: 512 })),
    makeMesh('Hair', material('Hair', 'hair', { map: 256 })),
    makeMesh('Cloak', material('Cloak', 'cloth', { map: 1024, normalMap: 1024, roughnessMap: 1024 })),
    makeMesh('Boot', material('Boot', 'leather', { map: 512, normalMap: 512 })),
  ]);
  const evidence = inspectPlayerSurfaceEvidence(root);
  assert.equal(evidence.ok, true);
  assert.equal(evidence.surfaceCount, 4);
  assert.equal(evidence.textureBearingSurfaceCount, 4);
  assert.deepEqual(evidence.roleCoverage, ['skin', 'hair', 'cloth', 'leather']);
  assert.equal(evidence.paletteCount, 4);
  assert.equal(evidence.textureQuality.oversizedCount, 0);
  assert.equal(evidence.textureQuality.undersizedCount, 0);
  const diversity = scorePlayerSurfaceMaterialDiversity(evidence);
  assert.ok(diversity.score > 0.9);
  assert.deepEqual(diversity.warnings, []);
  assert.equal(summarizePlayerSurfaceQuality(evidence).visualFailure, false);
}

function testSingleFlatSurfaceIsRisk() {
  const root = makeRoot([makeMesh('Body', material('Body', null))]);
  const evidence = inspectPlayerSurfaceEvidence(root);
  const quality = summarizePlayerSurfaceQuality(evidence);
  assert.equal(quality.visualFailure, true);
  assert.ok(evidence.warnings.includes('single-surface-flat-material-risk'));
  assert.ok(quality.diversityWarnings.includes('insufficient-textured-surfaces'));
}

function testPaletteDuplicationIsWarned() {
  const root = makeRoot([
    makeMesh('Skin', material('Body', 'same', { map: 512 })),
    makeMesh('Cloth', material('Body', 'same', { map: 512 })),
    makeMesh('Boot', material('Body', 'same', { map: 512 })),
  ]);
  const evidence = inspectPlayerSurfaceEvidence(root);
  assert.ok(evidence.warnings.includes('single-palette-multi-surface-risk'));
  const diversity = scorePlayerSurfaceMaterialDiversity(evidence);
  assert.equal(diversity.paletteScore, 0);
  assert.ok(diversity.warnings.includes('palette-diversity-missing'));
}

function testTextureBounds() {
  const root = makeRoot([
    makeMesh('Cloak', material('Cloak', 'cloth', { map: TEXTURE_POLICY.minDimension })),
    makeMesh('Armor', material('Armor', 'metal', { map: TEXTURE_POLICY.maxDimension })),
    makeMesh('Face', material('Face', 'skin', { map: 16 })),
    makeMesh('Hair', material('Hair', 'hair', { map: 4096 })),
  ]);
  const evidence = inspectPlayerSurfaceEvidence(root);
  assert.equal(evidence.textureQuality.undersizedCount, 1);
  assert.equal(evidence.textureQuality.oversizedCount, 1);
  assert.equal(evidence.textureQuality.maxDimension, 4096);
  assert.equal(evidence.textureQuality.minDimension, 16);
  assert.ok(evidence.warnings.includes('undersized-player-texture'));
  assert.ok(evidence.warnings.includes('oversized-player-texture'));
}

function testNoUVIsVisibleButDoesNotInventTextures() {
  const root = makeRoot([makeMesh('Body', material('Body', 'body'), false)]);
  const evidence = inspectPlayerSurfaceEvidence(root);
  assert.equal(evidence.uvMeshCount, 0);
  assert.equal(evidence.textureBearingSurfaceCount, 0);
  assert.equal(evidence.textureQuality.count, 0);
  assert.ok(evidence.warnings.includes('no-authored-texture-slots-observed'));
}

function testDeterminism() {
  const root = makeRoot([
    makeMesh('Skin', material('Skin', 'skin', { map: 512 })),
    makeMesh('Cloak', material('Cloak', 'cloth', { map: 1024 })),
  ]);
  const a = JSON.stringify(inspectPlayerSurfaceEvidence(root));
  const b = JSON.stringify(inspectPlayerSurfaceEvidence(root));
  assert.equal(a, b);
}

const TESTS = [testMultiSurfaceQuality, testSingleFlatSurfaceIsRisk, testPaletteDuplicationIsWarned, testTextureBounds, testNoUVIsVisibleButDoesNotInventTextures, testDeterminism];
for (const test of TESTS) { test(); console.log(`PASS ${test.name}`); }
console.log(`PLAYER_SURFACE_MATERIAL_QUALITY_OK tests=${TESTS.length}`);
