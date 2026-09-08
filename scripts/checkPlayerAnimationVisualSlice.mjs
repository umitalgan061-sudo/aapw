/**
 * Deterministic Kızıl Ufuk player visual/animation acceptance.
 *
 * This test is intentionally dependency-free. It proves the presentation seam without booting a
 * second gameplay framework: authored asset inventory, fallback ordering, environment response,
 * locomotion blend, ground-contact presentation and duplicate-call suppression.
 */
import assert from 'node:assert/strict';
import {
  PLAYER_ANIMATION_DIRECTOR_VERSION,
  createPlayerAnimationDirector,
  inspectPlayerModelSurfaceEvidence,
  resolvePlayerAnimationIntent,
  resolvePlayerAnimationPresentation,
} from '../src/3d/gameplay/playerAnimationDirector.js';
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
import {
  createEnvironmentalAnimationDirector,
  resolveActionFamily,
  resolveEnvironmentalAnimationProfile,
  resolveGroundContactPresentation,
  resolveLocomotionBlendProfile,
  resolveSurfaceProfile,
  validateEnvironmentalAnimationContext,
} from '../src/3d/gameplay/playerEnvironmentalAnimationProfile.js';

const REQUIRED_PATHS = [
  'assets/animations/peasant_girl/idle.fbx',
  'assets/animations/peasant_girl/running.fbx',
  'assets/animations/peasant_girl/walking.fbx',
].sort();

const OPTIONAL_SEMANTICS = [
  'dodge',
  'guard',
  'heavy-attack',
  'hit-stagger',
  'light-attack',
  'parry',
].sort();

const ACTIONS_FULL = Object.freeze({
  idle: 'idle',
  walking: 'walking',
  running: 'running',
  guard: 'guard',
  parry: 'parry',
  dodge: 'dodge',
  'light-attack': 'light',
  'heavy-attack': 'heavy',
  'hit-stagger': 'stagger',
});

const SURFACES = [
  'snow', 'coldGrassland', 'marsh', 'mountain', 'rockyHills', 'lush',
  'desert', 'steppe', 'arid', 'jungle', 'coast', 'temperate',
];

const STATES = [
  'idle', 'locomotion', 'sprint', 'guard', 'parry', 'dodge',
  'light-attack', 'heavy-attack', 'hit-stagger',
];

function nearlyEqual(a, b, epsilon = 1e-9) {
  assert.ok(Math.abs(Number(a) - Number(b)) <= epsilon, `${a} != ${b}`);
}

function assertFiniteBetween(value, min, max, label) {
  assert.ok(Number.isFinite(Number(value)), `${label} must be finite`);
  assert.ok(Number(value) >= min && Number(value) <= max, `${label} out of bounds: ${value}`);
}

function assertFrozen(value, label) {
  assert.ok(Object.isFrozen(value), `${label} should be frozen`);
}

function testVersionAndExports() {
  assert.equal(PLAYER_ANIMATION_DIRECTOR_VERSION, '2026-09-07-v2');
  assert.equal(typeof createPlayerAnimationDirector, 'function');
  assert.equal(typeof resolvePlayerAnimationIntent, 'function');
  assert.equal(typeof resolvePlayerAnimationPresentation, 'function');
  assert.equal(typeof inspectPlayerModelSurfaceEvidence, 'function');
}

function testAssetCatalogIsHonest() {
  const audit = auditPlayerAnimationCatalog();
  assert.equal(audit.ok, true);
  assert.equal(audit.totalSlots, 9);
  assert.equal(audit.requiredSlots, 3);
  assert.equal(audit.authoredSlots, 3);
  assert.equal(audit.authoredRequiredSlots, 3);
  assert.deepEqual(requiredPlayerAnimationPaths(), REQUIRED_PATHS);
  assert.deepEqual(unavailablePlayerAnimationSlots(), OPTIONAL_SEMANTICS);
  assert.equal(PLAYER_ANIMATION_ASSET_CATALOG.familyId, 'peasant_girl_mixamo_inplace_v1');
  assert.equal(PLAYER_ANIMATION_ASSET_CATALOG.rigFamily, 'mixamo-standard');
  assertFrozen(PLAYER_ANIMATION_ASSET_CATALOG, 'catalog');
}

function testAssetCompleteness() {
  const score = scoreAnimationAssetCompleteness();
  nearlyEqual(score.requiredRatio, 1);
  nearlyEqual(score.overallRatio, 1 / 3);
  assert.equal(score.combatOptionalSlots, 6);
}

function testHydrationEvidence() {
  const hydrated = buildPlayerAnimationAvailability({ hydratedPaths: REQUIRED_PATHS });
  assert.deepEqual(hydrated.requiredMissing, []);
  assert.equal(hydrated.assets.filter((a) => a.loadable).length, 3);
  const missing = buildPlayerAnimationAvailability({ hydratedPaths: REQUIRED_PATHS.slice(0, 2) });
  assert.equal(missing.requiredMissing.length, 1);
  const evidence = buildPlayerAnimationProvenanceEvidence({
    hydratedPaths: REQUIRED_PATHS,
    mainSha: 'live-main',
    headSha: 'candidate-head',
  });
  assert.equal(evidence.allRequiredHydrated, true);
  assert.equal(evidence.hydratedModel, false);
  assert.equal(evidence.mainSha, 'live-main');
  assert.equal(evidence.headSha, 'candidate-head');
}

function testLoadPlanWithRealActionMap() {
  const plan = getPlayerAnimationLoadPlan({ availableActions: { idle: 'idle', walking: 'walking', running: 'running' } });
  assert.equal(plan.length, 9);
  const map = new Map(plan.map((entry) => [entry.semantic, entry]));
  assert.equal(map.get('idle').action, 'idle');
  assert.equal(map.get('locomotion').action, 'walking');
  assert.equal(map.get('sprint').action, 'running');
  for (const semantic of OPTIONAL_SEMANTICS) {
    assert.equal(map.get(semantic).fallback, true);
    assert.ok(map.get(semantic).action);
  }
}

function testIntentPriorityMatrix() {
  const common = { availableActions: ACTIONS_FULL };
  assert.equal(resolvePlayerAnimationIntent({ ...common }).semanticState, 'idle');
  assert.equal(resolvePlayerAnimationIntent({ ...common, planarSpeedMps: 3.2 }).semanticState, 'locomotion');
  assert.equal(resolvePlayerAnimationIntent({ ...common, planarSpeedMps: 6.5 }).semanticState, 'sprint');
  assert.equal(resolvePlayerAnimationIntent({ ...common, guarding: true }).semanticState, 'guard');
  assert.equal(resolvePlayerAnimationIntent({ ...common, attackKind: 'light' }).semanticState, 'light-attack');
  assert.equal(resolvePlayerAnimationIntent({ ...common, attackKind: 'heavy' }).semanticState, 'heavy-attack');
  assert.equal(resolvePlayerAnimationIntent({ ...common, dodgeRemaining: 0.1 }).semanticState, 'dodge');
  assert.equal(resolvePlayerAnimationIntent({ ...common, hitStaggerRemaining: 0.1 }).semanticState, 'hit-stagger');
  const overlapping = resolvePlayerAnimationIntent({
    ...common,
    planarSpeedMps: 6.5,
    runIntent: true,
    guarding: true,
    attackKind: 'heavy',
    dodgeRemaining: 0.1,
    hitStaggerRemaining: 0.1,
  });
  assert.equal(overlapping.semanticState, 'hit-stagger');
}

function testIntentFallbackWithoutCombatClips() {
  const actions = { idle: 'idle', walking: 'walk', running: 'run' };
  const states = [
    ['guard', { guarding: true }],
    ['dodge', { dodgeRemaining: 0.2 }],
    ['light-attack', { attackKind: 'light' }],
    ['heavy-attack', { attackKind: 'heavy' }],
    ['hit-stagger', { hitStaggerRemaining: 0.2 }],
  ];
  for (const [label, state] of states) {
    const result = resolvePlayerAnimationIntent({ ...state, availableActions: actions });
    assert.equal(result.fallback, true, `${label} should expose fallback`);
    assert.ok(['idle', 'locomotion', 'sprint'].includes(result.resolvedSemanticState), `${label} fallback`);
  }
}

function testTimeScaleBounds() {
  assert.equal(resolvePlayerAnimationIntent({ planarSpeedMps: 0, availableActions: ACTIONS_FULL }).timeScale, 1);
  assert.equal(resolvePlayerAnimationIntent({ planarSpeedMps: 6.5, availableActions: ACTIONS_FULL }).timeScale, 1);
  assert.equal(resolvePlayerAnimationIntent({ planarSpeedMps: 40, availableActions: ACTIONS_FULL, runIntent: true }).timeScale, 1.35);
  assert.equal(resolvePlayerAnimationIntent({ planarSpeedMps: -12, availableActions: ACTIONS_FULL }).speedMps, 0);
  assert.equal(resolvePlayerAnimationIntent({ planarSpeedMps: Number.NaN, availableActions: ACTIONS_FULL }).speedMps, 0);
}

function testSurfaceProfilesAreBoundedAndDeterministic() {
  for (const surface of SURFACES) {
    const first = resolveSurfaceProfile(surface);
    const second = resolveSurfaceProfile(surface);
    assert.deepEqual(first, second);
    assertFiniteBetween(first.traction, 0, 1, `${surface}.traction`);
    assertFiniteBetween(first.strideFactor, 0.8, 1.01, `${surface}.strideFactor`);
    assertFiniteBetween(first.footPlant, 0.3, 1, `${surface}.footPlant`);
    assertFiniteBetween(first.leanFactor, 0.7, 1.3, `${surface}.leanFactor`);
    assertFiniteBetween(first.combatReadiness, 0.7, 1, `${surface}.combatReadiness`);
    assertFrozen(first, `${surface} profile`);
  }
}

function testEveryEnvironmentStateCombination() {
  const slopeBySurface = {
    snow: 24, coldGrassland: 12, marsh: 8, mountain: 32, rockyHills: 28, lush: 6,
    desert: 4, steppe: 10, arid: 7, jungle: 16, coast: 10, temperate: 5,
  };
  for (const surface of SURFACES) {
    for (const state of STATES) {
      const context = {
        profileKey: surface,
        slopeDegrees: slopeBySurface[surface],
        moisture: surface === 'marsh' || surface === 'jungle' ? 0.8 : 0.25,
        snowCover: surface === 'snow' ? 0.9 : 0,
        waterSignal: surface === 'coast' || surface === 'marsh' ? 0.7 : 0.1,
        reliefSignal: ['mountain', 'rockyHills'].includes(surface) ? 0.8 : 0.2,
        groundDeltaLeftMeters: -0.05,
        groundDeltaRightMeters: 0.08,
        carryWeight: state.includes('attack') ? 0.55 : 0.2,
        weaponWeight: state.includes('attack') ? 0.5 : 0.15,
        planarSpeedMps: state === 'sprint' ? 6.5 : state === 'locomotion' ? 3.2 : 0,
      };
      const first = resolveEnvironmentalAnimationProfile(context, state);
      const second = resolveEnvironmentalAnimationProfile(context, state);
      assert.deepEqual(first, second, `${surface}/${state} must be deterministic`);
      assertFiniteBetween(first.playbackRate, 0.78, 1.28, `${surface}/${state} playbackRate`);
      assertFiniteBetween(first.footPlantWeight, 0.34, 1, `${surface}/${state} footPlantWeight`);
      assertFiniteBetween(first.leanMagnitude, 0, 0.16, `${surface}/${state} leanMagnitude`);
      assert.ok([-1, 0, 1].includes(first.leanDirection));
      assertFiniteBetween(first.stepConfidence, 0, 1, `${surface}/${state} confidence`);
      assertFiniteBetween(first.combatReadiness, 0, 1, `${surface}/${state} readiness`);
      assert.equal(resolveActionFamily(state), first.actionFamily);
      assertFrozen(first, `${surface}/${state}`);
    }
  }
}

function testEnvironmentMonotonicSignals() {
  const dry = resolveEnvironmentalAnimationProfile({ profileKey: 'temperate', planarSpeedMps: 3.2 }, 'locomotion');
  const wet = resolveEnvironmentalAnimationProfile({ profileKey: 'temperate', moisture: 1, waterSignal: 0.8, planarSpeedMps: 3.2 }, 'locomotion');
  const snowy = resolveEnvironmentalAnimationProfile({ profileKey: 'snow', moisture: 0.3, snowCover: 1, planarSpeedMps: 3.2 }, 'locomotion');
  assert.ok(wet.footPlantWeight >= dry.footPlantWeight);
  assert.ok(snowy.footPlantWeight >= dry.footPlantWeight);
  assert.ok(snowy.stepConfidence <= dry.stepConfidence);
}

function testSurfaceIdentitySeparatesGeographies() {
  const snow = resolveEnvironmentalAnimationProfile({ profileKey: 'snow', planarSpeedMps: 3.2 }, 'locomotion');
  const desert = resolveEnvironmentalAnimationProfile({ profileKey: 'desert', planarSpeedMps: 3.2 }, 'locomotion');
  const marsh = resolveEnvironmentalAnimationProfile({ profileKey: 'marsh', planarSpeedMps: 3.2 }, 'locomotion');
  assert.notEqual(snow.surfaceProfile, desert.surfaceProfile);
  assert.notEqual(marsh.surfaceProfile, desert.surfaceProfile);
  assert.ok(snow.footPlantWeight > desert.footPlantWeight);
  assert.ok(marsh.traction < desert.traction);
}

function testLoadResponseIsBounded() {
  const baseline = resolveEnvironmentalAnimationProfile({ profileKey: 'temperate', planarSpeedMps: 3.2 }, 'locomotion');
  const loaded = resolveEnvironmentalAnimationProfile({ profileKey: 'temperate', planarSpeedMps: 3.2, carryWeight: 1, weaponWeight: 1 }, 'locomotion');
  assert.ok(loaded.playbackRate <= baseline.playbackRate);
  assert.ok(loaded.loadPenalty >= baseline.loadPenalty);
  assertFiniteBetween(loaded.playbackRate, 0.78, 1.28, 'loaded playback');
}

function testLocomotionBlendBoundaries() {
  const idle = resolveLocomotionBlendProfile({ planarSpeedMps: 0 });
  assert.equal(idle.walkWeight, 1); assert.equal(idle.runWeight, 0); assert.equal(idle.gaitT, 0);
  const walk = resolveLocomotionBlendProfile({ planarSpeedMps: 3.2 });
  assert.equal(walk.walkWeight, 1); assert.equal(walk.runWeight, 0);
  const midpoint = resolveLocomotionBlendProfile({ planarSpeedMps: 4.85 });
  assert.ok(midpoint.walkWeight > 0); assert.ok(midpoint.runWeight > 0); nearlyEqual(midpoint.walkWeight + midpoint.runWeight, 1);
  const run = resolveLocomotionBlendProfile({ planarSpeedMps: 6.5 });
  assert.equal(run.walkWeight, 0); assert.equal(run.runWeight, 1); assert.equal(run.gaitT, 1);
  const overspeed = resolveLocomotionBlendProfile({ planarSpeedMps: 999 });
  assert.equal(overspeed.gaitT, 1); assert.equal(overspeed.runWeight, 1);
}

function testGroundContactPresentation() {
  const neutral = resolveGroundContactPresentation({});
  assert.equal(neutral.leftFootCorrectionMeters, 0);
  assert.equal(neutral.rightFootCorrectionMeters, 0);
  assert.equal(neutral.contactConfidence, 1);
  const uneven = resolveGroundContactPresentation({ leftFootGroundDeltaMeters: 0.2, rightFootGroundDeltaMeters: -0.15, pelvisGroundDeltaMeters: 0.04 });
  assert.ok(uneven.leftFootCorrectionMeters < 0);
  assert.ok(uneven.rightFootCorrectionMeters > 0);
  assert.ok(uneven.asymmetry < 0);
  assert.ok(uneven.contactConfidence < 1);
  const absurd = resolveGroundContactPresentation({ leftFootGroundDeltaMeters: 9, rightFootGroundDeltaMeters: -9, pelvisGroundDeltaMeters: 9 });
  assertFiniteBetween(absurd.contactConfidence, 0, 1, 'absurd contact confidence');
  assert.ok(Math.abs(absurd.leftFootCorrectionMeters) <= 0.5);
  assert.ok(Math.abs(absurd.rightFootCorrectionMeters) <= 0.5);
  assert.ok(Math.abs(absurd.pelvisCorrectionMeters) <= 0.35);
}

function testInvalidEnvironmentContextIsVisible() {
  const result = validateEnvironmentalAnimationContext({ slopeDegrees: Number.NaN, moisture: Number.POSITIVE_INFINITY, snowCover: 0.2 });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('non-finite-slope'));
  assert.ok(result.errors.includes('non-finite-moisture'));
  assertFiniteBetween(result.normalized.slopeDegrees, 0, 89, 'normalized slope');
  assertFiniteBetween(result.normalized.moisture, 0, 1, 'normalized moisture');
}

function testPresentationContainsEntireSeam() {
  const presentation = resolvePlayerAnimationPresentation({
    planarSpeedMps: 3.2,
    availableActions: ACTIONS_FULL,
    environment: { profileKey: 'mountain', slopeDegrees: 25, moisture: 0.32, snowCover: 0.1, waterSignal: 0, reliefSignal: 0.7 },
    leftFootGroundDeltaMeters: 0.08,
    rightFootGroundDeltaMeters: -0.05,
    pelvisGroundDeltaMeters: 0.01,
  });
  assert.equal(presentation.version, PLAYER_ANIMATION_DIRECTOR_VERSION);
  assert.equal(presentation.semanticState, 'locomotion');
  assert.equal(presentation.action, 'walking');
  assert.equal(presentation.environmental.surfaceProfile, 'mountain');
  assert.equal(presentation.blend.runWeight, 0);
  assert.ok(presentation.contact.contactConfidence < 1);
}

function testPresentationDeterminismAcrossRepeatedInputs() {
  const input = {
    planarSpeedMps: 5.5,
    runIntent: true,
    availableActions: ACTIONS_FULL,
    environment: { profileKey: 'rockyHills', slopeDegrees: 29, moisture: 0.15, snowCover: 0, waterSignal: 0.02, reliefSignal: 0.9, carryWeight: 0.4, weaponWeight: 0.7 },
    leftFootGroundDeltaMeters: 0.04,
    rightFootGroundDeltaMeters: -0.03,
  };
  assert.deepEqual(resolvePlayerAnimationPresentation(input), resolvePlayerAnimationPresentation(input));
}

function testDirectorSuppressesDuplicateAnimationCalls() {
  const calls = []; const presentationCalls = [];
  const director = createPlayerAnimationDirector({ actions: ACTIONS_FULL, playAction: (...args) => calls.push(args), onPresentation: (value) => presentationCalls.push(value) });
  const a = director.update({ planarSpeedMps: 3.2 });
  const b = director.update({ planarSpeedMps: 3.2 });
  const c = director.update({ attackKind: 'light' });
  const d = director.update({ attackKind: 'light' });
  assert.equal(a.action, 'walking'); assert.equal(b.action, 'walking'); assert.equal(c.action, 'light'); assert.equal(d.action, 'light');
  assert.deepEqual(calls, [['walking', 1], ['light', 1]]);
  assert.equal(presentationCalls.length, 2);
}

function testDirectorEmitsPresentationForEnvironmentalChangeWithoutReplayingClip() {
  const calls = []; const presentationCalls = [];
  const director = createPlayerAnimationDirector({ actions: ACTIONS_FULL, playAction: (...args) => calls.push(args), onPresentation: (value) => presentationCalls.push(value) });
  director.update({ planarSpeedMps: 3.2, environment: { profileKey: 'temperate' } });
  director.update({ planarSpeedMps: 3.2, environment: { profileKey: 'snow', snowCover: 0.8 } });
  assert.equal(calls.length, 1);
  assert.equal(presentationCalls.length, 2);
  assert.equal(presentationCalls[0].action, 'walking');
  assert.equal(presentationCalls[1].environmental.surfaceProfile, 'snow');
}

function testDirectorResetIsDeterministic() {
  const calls = [];
  const director = createPlayerAnimationDirector({ actions: ACTIONS_FULL, playAction: (...args) => calls.push(args) });
  director.update({ planarSpeedMps: 3.2 }); director.update({ planarSpeedMps: 3.2 });
  assert.equal(calls.length, 1); director.reset(); director.update({ planarSpeedMps: 3.2 }); assert.equal(calls.length, 2);
}

function testDirectorRequiresCallback() {
  assert.throws(() => createPlayerAnimationDirector({ actions: ACTIONS_FULL }), /playAction callback is required/);
}

function testSemanticStateFamilyMapping() {
  const expected = new Map([
    ['idle', 'idle'], ['locomotion', 'locomotion'], ['sprint', 'locomotion'], ['guard', 'defense'], ['parry', 'defense'],
    ['dodge', 'evasion'], ['light-attack', 'attack'], ['heavy-attack', 'attack'], ['hit-stagger', 'reaction'],
  ]);
  for (const [state, family] of expected) assert.equal(resolveActionFamily(state), family);
}

function testEnvironmentDirectorCaching() {
  const updates = []; let contextCalls = 0;
  const director = createEnvironmentalAnimationDirector({
    resolveContext: (frameContext) => { contextCalls += 1; return frameContext.environment; },
    onUpdate: (profile) => updates.push(profile),
  });
  director.update('locomotion', { environment: { profileKey: 'temperate', planarSpeedMps: 3.2 } });
  director.update('locomotion', { environment: { profileKey: 'temperate', planarSpeedMps: 3.2 } });
  director.update('locomotion', { environment: { profileKey: 'snow', snowCover: 1, planarSpeedMps: 3.2 } });
  assert.equal(contextCalls, 3); assert.equal(updates.length, 2); assert.equal(updates[1].surfaceProfile, 'snow');
  director.reset(); director.update('locomotion', { environment: { profileKey: 'snow', snowCover: 1, planarSpeedMps: 3.2 } }); assert.equal(updates.length, 3);
}

function testCatalogSerializationIsStable() {
  const snapshots = Array.from({ length: 5 }, () => JSON.stringify({
    audit: auditPlayerAnimationCatalog(), score: scoreAnimationAssetCompleteness(), required: requiredPlayerAnimationPaths(), optional: unavailablePlayerAnimationSlots(),
  }));
  for (const snapshot of snapshots) assert.equal(snapshot, snapshots[0]);
}

function testBadCatalogCannotPassRequiredAudit() {
  const malformed = structuredClone(PLAYER_ANIMATION_ASSET_CATALOG);
  malformed.clips = { ...malformed.clips, idle: { ...malformed.clips.idle, path: null, authored: true }, walking: { ...malformed.clips.walking, authored: false } };
  const audit = auditPlayerAnimationCatalog(malformed);
  assert.equal(audit.ok, false);
  assert.ok(audit.errors.some((error) => error.includes('idle')));
  assert.ok(audit.errors.some((error) => error.includes('walking')));
}

function testOptionalCombatSlotsStayExplicit() {
  for (const semantic of OPTIONAL_SEMANTICS.filter((value) => value !== 'parry')) {
    const result = resolvePlayerAnimationIntent({
      availableActions: { idle: 'idle', walking: 'walk', running: 'run' },
      ...(semantic === 'guard' ? { guarding: true } : {}),
      ...(semantic === 'dodge' ? { dodgeRemaining: 0.2 } : {}),
      ...(semantic === 'light-attack' ? { attackKind: 'light' } : {}),
      ...(semantic === 'heavy-attack' ? { attackKind: 'heavy' } : {}),
      ...(semantic === 'hit-stagger' ? { hitStaggerRemaining: 0.2 } : {}),
    });
    assert.ok(result.action, `${semantic} must still have a runtime fallback action`);
    assert.ok(result.fallback || result.authoredAsset, `${semantic} must be auditable`);
  }
}

function testSlopeResponseDoesNotExplode() {
  const samples = [0, 1, 5, 15, 30, 45, 60, 89]; let previousLean = 0;
  for (const slope of samples) {
    const profile = resolveEnvironmentalAnimationProfile({ profileKey: 'mountain', slopeDegrees: slope, groundDeltaLeftMeters: -0.1, groundDeltaRightMeters: 0.1, reliefSignal: 1, planarSpeedMps: 3.2 }, 'locomotion');
    assertFiniteBetween(profile.leanMagnitude, 0, 0.16, `slope ${slope} lean`);
    assertFiniteBetween(profile.stepConfidence, 0, 1, `slope ${slope} confidence`);
    assert.ok(profile.leanMagnitude >= previousLean - 0.001); previousLean = profile.leanMagnitude;
  }
}

function testCameraMismatchOnlySoftensConfidence() {
  const aligned = resolveEnvironmentalAnimationProfile({ profileKey: 'temperate', cameraHeadingMismatch: 0, planarSpeedMps: 3.2 }, 'locomotion');
  const misaligned = resolveEnvironmentalAnimationProfile({ profileKey: 'temperate', cameraHeadingMismatch: 1, planarSpeedMps: 3.2 }, 'locomotion');
  assert.ok(misaligned.stepConfidence <= aligned.stepConfidence);
  assert.ok(misaligned.playbackRate <= aligned.playbackRate);
}

function testCombatPresentationIsNotLostOnHardSurface() {
  for (const state of ['guard', 'light-attack', 'heavy-attack', 'dodge']) {
    const presentation = resolvePlayerAnimationPresentation({
      attackKind: state === 'light-attack' ? 'light' : state === 'heavy-attack' ? 'heavy' : 'none',
      guarding: state === 'guard',
      dodgeRemaining: state === 'dodge' ? 0.2 : 0,
      planarSpeedMps: state === 'dodge' ? 6 : 0,
      availableActions: ACTIONS_FULL,
      environment: { profileKey: 'rockyHills', slopeDegrees: 40, moisture: 0.05, reliefSignal: 1 },
    });
    assert.ok(presentation.environmental.combatReadiness >= 0);
    assert.ok(presentation.environmental.playbackRate >= 0.78);
    assert.ok(presentation.action);
  }
}

function testGroundContactPresentationIsPure() {
  const input = { leftFootGroundDeltaMeters: 0.12, rightFootGroundDeltaMeters: -0.07, pelvisGroundDeltaMeters: 0.02 };
  assert.deepEqual(resolveGroundContactPresentation(input), resolveGroundContactPresentation(input));
}

function testNoNaNPropagationAcrossFullPresentation() {
  const presentation = resolvePlayerAnimationPresentation({
    planarSpeedMps: Number.NaN,
    environment: { profileKey: 'not-a-real-biome', slopeDegrees: Number.NaN, moisture: Number.POSITIVE_INFINITY, snowCover: Number.NaN, waterSignal: Number.NaN, reliefSignal: Number.NaN },
    leftFootGroundDeltaMeters: Number.NaN, rightFootGroundDeltaMeters: Number.POSITIVE_INFINITY, pelvisGroundDeltaMeters: Number.NaN,
    availableActions: ACTIONS_FULL,
  });
  assert.ok(presentation.action);
  assertFiniteBetween(presentation.environmental.playbackRate, 0.78, 1.28, 'NaN-safe playback');
  assertFiniteBetween(presentation.environmental.footPlantWeight, 0.34, 1, 'NaN-safe footplant');
  assertFiniteBetween(presentation.environmental.stepConfidence, 0, 1, 'NaN-safe confidence');
  assertFiniteBetween(presentation.contact.contactConfidence, 0, 1, 'NaN-safe contact');
}

function testPlayerSurfaceEvidenceDelegatesToSharedCore() {
  const skin = { name: 'SkinMesh', isMesh: true, material: { name: 'Skin', userData: {}, map: { image: { width: 512, height: 512 } } }, geometry: { attributes: { uv: {} } }, userData: {} };
  const hair = { name: 'HairMesh', isMesh: true, material: { name: 'Hair', userData: {}, normalMap: { image: { width: 256, height: 256 } } }, geometry: { attributes: { uv: {} } }, userData: {} };
  const cloth = { name: 'CloakMesh', isMesh: true, material: { name: 'Cloth', userData: {}, map: { image: { width: 1024, height: 1024 } }, roughnessMap: { image: { width: 1024, height: 1024 } } }, geometry: { attributes: { uv: {} } }, userData: {} };
  const root = { name: 'player', userData: {}, children: [skin, hair, cloth], traverse(callback) { callback(this); callback(skin); callback(hair); callback(cloth); } };
  const result = inspectPlayerModelSurfaceEvidence(root, { id: 'peasant_girl', src: 'assets/models/characters/peasant_girl.fbx' });
  assert.equal(result.evidence.ok, true); assert.equal(result.evidence.meshCount, 3); assert.equal(result.evidence.surfaceCount, 3); assert.equal(result.evidence.textureBearingSurfaceCount, 3);
  assert.ok(result.quality.layered); assert.equal(result.quality.visualFailure, false); assert.equal(result.manifest.playerAssetId, 'peasant_girl');
}

function testFlatPlayerSurfaceIsFlaggedAsVisualRisk() {
  const mesh = { name: 'Body', isMesh: true, material: { name: 'Body', userData: {} }, geometry: { attributes: {} }, userData: {} };
  const root = { name: 'flat', userData: {}, children: [mesh], traverse(callback) { callback(this); callback(mesh); } };
  const result = inspectPlayerModelSurfaceEvidence(root, { id: 'flat-player', src: 'flat.fbx' });
  assert.equal(result.evidence.meshCount, 1); assert.equal(result.evidence.textureBearingSurfaceCount, 0); assert.equal(result.quality.layered, false); assert.equal(result.quality.textured, false); assert.equal(result.quality.visualFailure, true);
}

function testPublicAPIDoesNotMutateInputMaps() {
  const actions = { ...ACTIONS_FULL }; const environment = { profileKey: 'temperate', planarSpeedMps: 3.2 };
  const beforeActions = JSON.stringify(actions); const beforeEnvironment = JSON.stringify(environment);
  resolvePlayerAnimationPresentation({ availableActions: actions, environment, planarSpeedMps: 3.2 });
  assert.equal(JSON.stringify(actions), beforeActions); assert.equal(JSON.stringify(environment), beforeEnvironment);
}

const TESTS = [
  testVersionAndExports, testAssetCatalogIsHonest, testAssetCompleteness, testHydrationEvidence, testLoadPlanWithRealActionMap,
  testIntentPriorityMatrix, testIntentFallbackWithoutCombatClips, testTimeScaleBounds, testSurfaceProfilesAreBoundedAndDeterministic,
  testEveryEnvironmentStateCombination, testEnvironmentMonotonicSignals, testSurfaceIdentitySeparatesGeographies, testLoadResponseIsBounded,
  testLocomotionBlendBoundaries, testGroundContactPresentation, testInvalidEnvironmentContextIsVisible, testPresentationContainsEntireSeam,
  testPresentationDeterminismAcrossRepeatedInputs, testDirectorSuppressesDuplicateAnimationCalls, testDirectorEmitsPresentationForEnvironmentalChangeWithoutReplayingClip,
  testDirectorResetIsDeterministic, testDirectorRequiresCallback, testSemanticStateFamilyMapping, testEnvironmentDirectorCaching,
  testCatalogSerializationIsStable, testBadCatalogCannotPassRequiredAudit, testOptionalCombatSlotsStayExplicit, testSlopeResponseDoesNotExplode,
  testCameraMismatchOnlySoftensConfidence, testCombatPresentationIsNotLostOnHardSurface, testGroundContactPresentationIsPure,
  testNoNaNPropagationAcrossFullPresentation, testPlayerSurfaceEvidenceDelegatesToSharedCore, testFlatPlayerSurfaceIsFlaggedAsVisualRisk,
  testPublicAPIDoesNotMutateInputMaps,
];

let passed = 0;
for (const test of TESTS) { test(); passed += 1; console.log(`PASS ${test.name}`); }
console.log(`PLAYER_ANIMATION_VISUAL_SLICE_CONTRACT_OK tests=${passed}`);
