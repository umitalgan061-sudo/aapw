/**
 * Blend diagnostic acceptance for the existing player animation presentation seam.
 */
import assert from 'node:assert/strict';
import {
  DEFAULT_THRESHOLDS,
  auditAnimationBlendContract,
  buildAnimationBlendDiagnostics,
  buildPlayerAnimationBlendContract,
  classifyAnimationBlendState,
  resolveAnimationTransitionWindow,
} from '../src/3d/gameplay/playerAnimationBlendDiagnostics.js';

function testClassification() {
  assert.equal(classifyAnimationBlendState({ planarSpeedMps: 0 }).expectedState, 'idle');
  assert.equal(classifyAnimationBlendState({ planarSpeedMps: 3.2 }).expectedState, 'locomotion');
  assert.equal(classifyAnimationBlendState({ planarSpeedMps: 6.5 }).expectedState, 'sprint');
  assert.equal(classifyAnimationBlendState({ guarding: true }).expectedState, 'guard');
  assert.equal(classifyAnimationBlendState({ attackKind: 'light' }).expectedState, 'light-attack');
  assert.equal(classifyAnimationBlendState({ attackKind: 'heavy' }).expectedState, 'heavy-attack');
}

function testThresholdsAreBounded() {
  assert.equal(DEFAULT_THRESHOLDS.idleSpeedMps, 0.15);
  assert.equal(DEFAULT_THRESHOLDS.sprintSpeedMps, 5.6);
  assert.ok(DEFAULT_THRESHOLDS.attackInterruptSeconds > DEFAULT_THRESHOLDS.defenseInterruptSeconds);
}

function testWeightsNormalize() {
  const contract = buildPlayerAnimationBlendContract({
    primaryState: 'locomotion', primaryWeight: 3, secondaryState: 'sprint', secondaryWeight: 1,
    environmentalConfidence: 0.8, footPlantWeight: 0.92, combatReadiness: 0.9,
    locomotion: { walkWeight: 0.25, runWeight: 0.75 },
  });
  const sum = Object.values(contract.normalizedWeights).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 0.00001);
  assert.equal(contract.dominantState, 'locomotion');
  assert.equal(contract.locomotionWeights.walking, 0.25);
  assert.equal(contract.locomotionWeights.running, 0.75);
}

function testNoWeightsDefaultsToIdle() {
  const contract = buildPlayerAnimationBlendContract({ primaryWeight: 0, secondaryWeight: 0 });
  assert.deepEqual(contract.normalizedWeights, { idle: 1 });
  assert.equal(contract.dominantState, 'idle');
}

function testProtectedAttackWindow() {
  const early = resolveAnimationTransitionWindow({ fromState: 'heavy-attack', toState: 'dodge', normalizedTime: 0.05, canInterrupt: true, environmentConfidence: 1 });
  assert.equal(early.protectedWindow, true); assert.equal(early.permitted, false);
  const late = resolveAnimationTransitionWindow({ fromState: 'heavy-attack', toState: 'dodge', normalizedTime: 0.8, canInterrupt: true, environmentConfidence: 1 });
  assert.equal(late.protectedWindow, false); assert.equal(late.permitted, true);
}

function testDefenseWindowIsShorter() {
  const early = resolveAnimationTransitionWindow({ fromState: 'guard', toState: 'dodge', normalizedTime: 0.03, canInterrupt: true });
  assert.equal(early.protectedWindow, true);
  const late = resolveAnimationTransitionWindow({ fromState: 'guard', toState: 'dodge', normalizedTime: 0.2, canInterrupt: true });
  assert.equal(late.permitted, true);
}

function testSameGroupCrossfadeIsShorter() {
  const same = resolveAnimationTransitionWindow({ fromState: 'locomotion', toState: 'sprint' });
  const cross = resolveAnimationTransitionWindow({ fromState: 'locomotion', toState: 'heavy-attack' });
  assert.ok(same.crossfadeSeconds < cross.crossfadeSeconds);
}

function testEnvironmentConfidenceOnlySoftensCrossfade() {
  const confident = resolveAnimationTransitionWindow({ fromState: 'locomotion', toState: 'heavy-attack', environmentConfidence: 1 });
  const uncertain = resolveAnimationTransitionWindow({ fromState: 'locomotion', toState: 'heavy-attack', environmentConfidence: 0 });
  assert.ok(uncertain.crossfadeSeconds >= confident.crossfadeSeconds);
}

function testAuditAcceptsValidContract() {
  const contract = buildPlayerAnimationBlendContract({ primaryState: 'heavy-attack', primaryWeight: 1, environmentalConfidence: 1, footPlantWeight: 0.9, combatReadiness: 0.8 });
  const audit = auditAnimationBlendContract(contract);
  assert.equal(audit.ok, true); assert.deepEqual(audit.errors, []);
}

function testAuditRejectsInvalidWeights() {
  const audit = auditAnimationBlendContract({
    normalizedWeights: { heavy: 2, idle: -0.5 }, environmentalConfidence: 0.5, footPlantWeight: 0.7, combatReadiness: 0.7,
  });
  assert.equal(audit.ok, false);
  assert.ok(audit.errors.includes('weights-do-not-sum-to-one'));
  assert.ok(audit.errors.includes('weight-out-of-range:heavy'));
  assert.ok(audit.errors.includes('weight-out-of-range:idle'));
}

function testCombinedDiagnosticIsDeterministic() {
  const input = {
    semanticState: 'locomotion', planarSpeedMps: 4.4, runIntent: false, environmentalConfidence: 0.82,
    footPlantWeight: 0.84, combatReadiness: 0.92, primaryState: 'locomotion', primaryWeight: 0.7,
    secondaryState: 'sprint', secondaryWeight: 0.3, locomotion: { walkWeight: 0.42, runWeight: 0.58 },
    fromState: 'locomotion', toState: 'sprint', normalizedTime: 0.4,
  };
  assert.deepEqual(buildAnimationBlendDiagnostics(input), buildAnimationBlendDiagnostics(input));
}

function testExtremeInputsStayBounded() {
  const diagnostic = buildAnimationBlendDiagnostics({
    semanticState: 'heavy-attack', planarSpeedMps: Number.POSITIVE_INFINITY, environmentalConfidence: -50,
    footPlantWeight: 50, combatReadiness: 50, primaryWeight: 999, secondaryState: 'dodge', secondaryWeight: -999, normalizedTime: 99,
  });
  assert.equal(diagnostic.audit.ok, true);
  assert.ok(diagnostic.contract.environmentalConfidence >= 0 && diagnostic.contract.environmentalConfidence <= 1);
  assert.ok(diagnostic.contract.footPlantWeight >= 0.34 && diagnostic.contract.footPlantWeight <= 1);
  assert.ok(diagnostic.contract.combatReadiness >= 0 && diagnostic.contract.combatReadiness <= 1);
  assert.ok(diagnostic.transition.normalizedTime <= 1);
}

const TESTS = [testClassification, testThresholdsAreBounded, testWeightsNormalize, testNoWeightsDefaultsToIdle, testProtectedAttackWindow, testDefenseWindowIsShorter, testSameGroupCrossfadeIsShorter, testEnvironmentConfidenceOnlySoftensCrossfade, testAuditAcceptsValidContract, testAuditRejectsInvalidWeights, testCombinedDiagnosticIsDeterministic, testExtremeInputsStayBounded];
for (const test of TESTS) { test(); console.log(`PASS ${test.name}`); }
console.log(`PLAYER_ANIMATION_BLEND_DIAGNOSTICS_OK tests=${TESTS.length}`);
