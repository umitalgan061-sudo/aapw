/**
 * Runtime evidence contract for the existing player animation setup.
 */
import assert from 'node:assert/strict';
import {
  auditPlayerRuntimeActionCoverage,
  buildPlayerRuntimeAnimationManifest,
  inspectPlayerRuntimeAnimationSetup,
  isFiniteAnimationManifest,
} from '../src/3d/gameplay/playerAnimationRuntimeEvidence.js';

function nodeRoot(meshes = []) {
  return { userData: {}, traverse(callback) { callback(this); for (const mesh of meshes) callback(mesh); } };
}
function mesh(name, material) {
  return { name, isMesh: true, material, geometry: { attributes: { uv: {} } }, userData: {} };
}
function action(duration, tracks = 3) {
  return { enabled: true, weight: 1, timeScale: 1, _clip: { duration, tracks: Array.from({ length: tracks }, (_, index) => ({ name: `track-${index}` })) } };
}

function testHealthySetup() {
  const model = nodeRoot([
    mesh('Skin', { name: 'Skin', map: { image: { width: 512, height: 512 } }, userData: {} }),
    mesh('Cloth', { name: 'Cloth', normalMap: { image: { width: 1024, height: 1024 } }, userData: {} }),
  ]);
  const setup = inspectPlayerRuntimeAnimationSetup({ model, mixer: {}, actions: { idle: action(2.2), walking: action(1.1), running: action(0.95) } });
  assert.equal(setup.ok, true);
  assert.equal(setup.actionCount, 3);
  assert.deepEqual(setup.actionNames, ['idle', 'running', 'walking']);
  assert.equal(setup.fallbackCoverage.length, 9);
  assert.equal(setup.surfaceEvidence.textureBearingSurfaceCount, 2);
}

function testBadClipFailsClosed() {
  const setup = inspectPlayerRuntimeAnimationSetup({
    model: nodeRoot([mesh('Body', { name: 'Body', userData: {} })]), mixer: {},
    actions: { idle: action(0, 0), walking: action(1), running: action(1) },
  });
  assert.equal(setup.ok, false);
  assert.ok(setup.errors.some((error) => error.includes('invalid-duration:idle')));
  assert.ok(setup.errors.some((error) => error.includes('no-tracks:idle')));
}

function testMissingModelAndMixerFail() {
  const setup = inspectPlayerRuntimeAnimationSetup({ actions: {} });
  assert.equal(setup.ok, false);
  assert.ok(setup.errors.includes('player-model-missing'));
  assert.ok(setup.errors.includes('animation-mixer-missing'));
}

function testCoverageRequiresRuntimeActions() {
  const coverage = auditPlayerRuntimeActionCoverage({ idle: {}, walking: {}, running: {} });
  assert.equal(coverage.ok, true);
  assert.deepEqual(coverage.optionalMissing, ['dodge', 'guard', 'heavy-attack', 'hit-stagger', 'light-attack', 'parry']);
  const broken = auditPlayerRuntimeActionCoverage({ idle: {} });
  assert.equal(broken.ok, false);
  assert.ok(broken.errors.includes('missing-walking-action'));
  assert.ok(broken.errors.includes('missing-running-action'));
}

function testManifestStable() {
  const setup = inspectPlayerRuntimeAnimationSetup({
    model: nodeRoot([mesh('Body', { name: 'Body', map: { image: { width: 256, height: 256 } }, userData: {} })]),
    mixer: {}, actions: { idle: action(1), walking: action(1), running: action(1) },
  });
  const a = buildPlayerRuntimeAnimationManifest(setup, { headSha: 'h', mainSha: 'm' });
  const b = buildPlayerRuntimeAnimationManifest(setup, { headSha: 'h', mainSha: 'm' });
  assert.deepEqual(a, b);
  assert.equal(isFiniteAnimationManifest(a), true);
  assert.equal(a.headSha, 'h');
  assert.equal(a.mainSha, 'm');
}

function testMalformedManifestFailsShapeCheck() {
  assert.equal(isFiniteAnimationManifest(null), false);
  assert.equal(isFiniteAnimationManifest({}), false);
  assert.equal(isFiniteAnimationManifest({ ok: true, actionNames: [], errors: [], warnings: [], fallbackCoverage: [{ authored: 4, fallback: 'x', action: 1 }] }), false);
}

const TESTS = [testHealthySetup, testBadClipFailsClosed, testMissingModelAndMixerFail, testCoverageRequiresRuntimeActions, testManifestStable, testMalformedManifestFailsShapeCheck];
for (const test of TESTS) { test(); console.log(`PASS ${test.name}`); }
console.log(`PLAYER_ANIMATION_RUNTIME_EVIDENCE_CONTRACT_OK tests=${TESTS.length}`);
