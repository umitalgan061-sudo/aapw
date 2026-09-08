/**
 * Executable asset-first contract for the existing player animation family.
 *
 * The repository currently authors only idle/walking/running for peasant_girl. Combat semantics
 * remain represented by deterministic fallbacks until authored clips are actually added. This
 * checker deliberately treats a Git-LFS pointer as unavailable input rather than a usable asset.
 *
 * @module scripts/checkPlayerAnimationAssetContract
 */
import assert from 'node:assert/strict';
import {
  PLAYER_ANIMATION_ASSET_CATALOG,
  auditPlayerAnimationCatalog,
  buildPlayerAnimationAvailability,
  buildPlayerAnimationProvenanceEvidence,
  getPlayerAnimationLoadPlan,
  requiredPlayerAnimationPaths,
  scoreAnimationAssetCompleteness,
  unavailablePlayerAnimationSlots,
} from '../src/3d/gameplay/playerAnimationAssetCatalog.js';

const EXPECTED_REQUIRED = [
  'assets/animations/peasant_girl/idle.fbx',
  'assets/animations/peasant_girl/running.fbx',
  'assets/animations/peasant_girl/walking.fbx',
].sort();

const EXPECTED_OPTIONAL_MISSING = [
  'dodge', 'guard', 'heavy-attack', 'hit-stagger', 'light-attack', 'parry',
].sort();

function testCatalogShape() {
  const audit = auditPlayerAnimationCatalog();
  assert.equal(audit.ok, true);
  assert.equal(audit.requiredSlots, 3);
  assert.equal(audit.authoredRequiredSlots, 3);
  assert.deepEqual(requiredPlayerAnimationPaths(), EXPECTED_REQUIRED);
  assert.deepEqual(unavailablePlayerAnimationSlots(), EXPECTED_OPTIONAL_MISSING);
  assert.equal(PLAYER_ANIMATION_ASSET_CATALOG.familyId, 'peasant_girl_mixamo_inplace_v1');
  assert.equal(PLAYER_ANIMATION_ASSET_CATALOG.rigFamily, 'mixamo-standard');
}

function testCompleteness() {
  const score = scoreAnimationAssetCompleteness();
  assert.equal(score.totalSlots, 9);
  assert.equal(score.authoredSlots, 3);
  assert.equal(score.requiredSlots, 3);
  assert.equal(score.authoredRequiredSlots, 3);
  assert.equal(score.requiredRatio, 1);
  assert.equal(score.overallRatio, 1 / 3);
  assert.equal(score.combatOptionalSlots, 6);
}

function testAvailability() {
  const availability = buildPlayerAnimationAvailability({ hydratedPaths: EXPECTED_REQUIRED });
  assert.deepEqual(availability.requiredMissing, []);
  assert.deepEqual(availability.optionalMissing, []);
  assert.equal(availability.assets.filter((asset) => asset.loadable).length, 3);
  assert.equal(availability.assets.filter((asset) => asset.required && asset.hydrated).length, 3);
}

function testMissingRequiredPathFailsClosed() {
  const availability = buildPlayerAnimationAvailability({ hydratedPaths: [EXPECTED_REQUIRED[0], EXPECTED_REQUIRED[2]] });
  assert.deepEqual(availability.requiredMissing, [EXPECTED_REQUIRED[1]]);
}

function testNoPointerCanBeDeclaredHydrated() {
  const evidence = buildPlayerAnimationProvenanceEvidence({ hydratedPaths: EXPECTED_REQUIRED, mainSha: 'main-test', headSha: 'head-test' });
  assert.equal(evidence.allRequiredHydrated, true);
  assert.equal(evidence.mainSha, 'main-test');
  assert.equal(evidence.headSha, 'head-test');
  assert.equal(evidence.hydratedModel, false);
}

function testLoadPlanFallsBack() {
  const actions = { idle: 'idle', walking: 'walk', running: 'run' };
  const plan = getPlayerAnimationLoadPlan({ availableActions: actions });
  const bySemantic = new Map(plan.map((entry) => [entry.semantic, entry]));
  assert.equal(bySemantic.get('idle').action, 'idle');
  assert.equal(bySemantic.get('locomotion').action, 'walk');
  assert.equal(bySemantic.get('sprint').action, 'run');
  for (const semantic of EXPECTED_OPTIONAL_MISSING) {
    assert.equal(bySemantic.get(semantic).fallback, true);
    assert.ok(['idle', 'locomotion'].includes(bySemantic.get(semantic).resolvedSemantic));
  }
}

function testMalformedCatalogIsRejected() {
  const bad = {
    ...PLAYER_ANIMATION_ASSET_CATALOG,
    clips: {
      ...PLAYER_ANIMATION_ASSET_CATALOG.clips,
      idle: { ...PLAYER_ANIMATION_ASSET_CATALOG.clips.idle, authored: true, path: null },
      walking: { ...PLAYER_ANIMATION_ASSET_CATALOG.clips.walking, required: true, authored: false },
    },
  };
  const audit = auditPlayerAnimationCatalog(bad);
  assert.equal(audit.ok, false);
  assert.ok(audit.errors.includes('required-idle-missing'));
  assert.ok(audit.errors.includes('required-walking-missing'));
}

function testDeterministicSerialization() {
  const a = JSON.stringify(scoreAnimationAssetCompleteness());
  const b = JSON.stringify(scoreAnimationAssetCompleteness());
  assert.equal(a, b);
}

testCatalogShape();
testCompleteness();
testAvailability();
testMissingRequiredPathFailsClosed();
testNoPointerCanBeDeclaredHydrated();
testLoadPlanFallsBack();
testMalformedCatalogIsRejected();
testDeterministicSerialization();
console.log('PLAYER_ANIMATION_ASSET_CONTRACT_OK');
console.log(`PLAYER_ANIMATION_REQUIRED=${EXPECTED_REQUIRED.length}`);
console.log(`PLAYER_ANIMATION_OPTIONAL_MISSING=${EXPECTED_OPTIONAL_MISSING.length}`);
