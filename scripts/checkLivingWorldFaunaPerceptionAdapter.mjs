import assert from 'node:assert/strict';
import {
  FAUNA_PERCEPTION_POLICY,
  buildFaunaPerceptionBatch,
  classifyStealthTarget,
  perceiveFauna,
  perceptionContractManifest,
  perceptionReplay,
  planFaunaAlertPropagation,
  summarizePerceptionFacts,
  validatePerceptionFacts,
} from '../src/3d/gameplay/livingWorldFaunaPerceptionAdapter.js';

const frozen = (value, label) => assert.equal(Object.isFrozen(value), true, `${label} must be frozen`);
const observer = (overrides = {}) => ({ id: 'wolf-01', species: 'wolf', position: { x: 0, z: 0 }, fieldOfViewDegrees: 120, sightRangeMeters: 120, hearingRangeMeters: 100, alertness: 0.8, acuity: 0.9, nocturnal: true, ...overrides });
const target = (overrides = {}) => ({ id: 'player-01', kind: 'player', position: { x: 24, z: 0 }, velocityMetersPerSecond: 1, stealth: 0.05, cover: 0, visible: true, noisy: false, noiseLevel: 0, scentStrength: 0.2, lightLevel: 1, freshSeconds: 0, ...overrides });
const context = (overrides = {}) => ({ hour: 23, weather: 'clear', precipitation: 0, fog: 0, wind: 0, light: 0.08, ...overrides });

frozen(FAUNA_PERCEPTION_POLICY, 'policy');
assert.equal(FAUNA_PERCEPTION_POLICY.maxFacts, 48);
const contract = perceptionContractManifest();
frozen(contract, 'contract');
assert.equal(contract.deterministic, true);
assert.equal(contract.mutation, false);
assert.equal(contract.owners.actorRegistry, 'existing');
assert.equal(contract.owners.navigation, 'existing');
assert.equal(contract.owners.material, 'MaterialAssignmentCore');
assert.equal(contract.owners.placement, 'WorldAssetPlacementPipeline');
assert.equal(contract.editorRuntimeImport, false);

const stealth = classifyStealthTarget(target({ stealth: 0.9, cover: 0.8, velocityMetersPerSecond: 0.2 }), context());
frozen(stealth, 'stealth');
assert.ok(stealth.effective > 0.5);
assert.equal(stealth.exposedByMovement, false);
assert.equal(stealth.exposedByNoise, false);
assert.equal(stealth.exposedByLight, false);
const loud = classifyStealthTarget(target({ stealth: 0.1, noisy: true, noiseLevel: 0.9, velocityMetersPerSecond: 4 }), context({ light: 1 }));
assert.equal(loud.exposedByMovement, true);
assert.equal(loud.exposedByNoise, true);
assert.equal(loud.exposedByLight, true);

const detected = perceiveFauna({ observer: observer(), target: target(), context: context(), now: 10 });
frozen(detected, 'detected');
assert.equal(detected.observerId, 'wolf-01');
assert.equal(detected.targetId, 'player-01');
assert.ok(['detect', 'observe', 'investigate'].includes(detected.state));
assert.ok(detected.confidence >= 0 && detected.confidence <= 1);
assert.ok(detected.distanceMeters > 0);
assert.ok(detected.memorySeconds >= 0);

const occluded = perceiveFauna({ observer: observer(), target: target(), context: context(), lineOfSight: () => false, now: 10 });
assert.equal(occluded.visualVisible, false);
const noisy = perceiveFauna({ observer: observer({ acuity: 0.4 }), target: target({ visible: false, noisy: true, noiseLevel: 1, stealth: 0.8 }), context: context({ wind: 0.1 }), now: 20 });
assert.equal(noisy.visualVisible, false);
assert.equal(noisy.heard, true);
assert.ok(noisy.confidence > 0.1);
const far = perceiveFauna({ observer: observer(), target: target({ position: { x: 500, z: 0 } }), context: context(), now: 10 });
assert.equal(far.visualVisible, false);
assert.equal(far.heard, false);

const batch = buildFaunaPerceptionBatch({
  observers: [observer({ id: 'wolf-02' }), observer({ id: 'wolf-01' })],
  targets: [target({ id: 'deer-02', kind: 'deer' }), target({ id: 'player-01' })],
  context: context(), now: 30,
});
frozen(batch, 'batch');
assert.equal(batch.length, 4);
assert.equal(validatePerceptionFacts(batch).ok, true);
const summary = summarizePerceptionFacts(batch);
frozen(summary, 'summary');
assert.equal(summary.total, 4);
assert.ok(summary.maxConfidence >= 0 && summary.maxConfidence <= 1);

const reordered = buildFaunaPerceptionBatch({
  observers: [observer({ id: 'wolf-01' }), observer({ id: 'wolf-02' })],
  targets: [target({ id: 'player-01' }), target({ id: 'deer-02', kind: 'deer' })],
  context: context(), now: 30,
});
assert.deepEqual(batch, reordered);

const alerts = planFaunaAlertPropagation({
  facts: batch,
  actors: [
    { id: 'wolf-01', position: { x: 0, z: 0 }, alertness: 1 },
    { id: 'wolf-02', position: { x: 20, z: 0 }, alertness: 0.7 },
    { id: 'wolf-03', position: { x: 100, z: 0 }, alertness: 1 },
  ],
  now: 31,
});
frozen(alerts, 'alerts');
assert.ok(alerts.length <= FAUNA_PERCEPTION_POLICY.maxFacts);
assert.ok(alerts.every((signal) => signal.confidence >= 0 && signal.confidence <= 1));

const replayInput = [
  { observers: [observer()], targets: [target()], context: context(), now: 0 },
  { observers: [observer()], targets: [target({ id: 'deer-01', kind: 'deer' })], context: context({ hour: 12, light: 1 }), now: 10 },
];
const replay = perceptionReplay(replayInput);
const replayAgain = perceptionReplay(replayInput);
frozen(replay, 'replay');
assert.equal(replay.count, 2);
assert.deepEqual(replay, replayAgain);

const invalid = validatePerceptionFacts([{ id: 'broken', observerId: '', targetId: '', state: 'bad', confidence: 2, memorySeconds: -1 }]);
assert.equal(invalid.ok, false);
assert.ok(invalid.errors.length >= 4);
const malformed = perceiveFauna({ observer: { id: null, position: null, alertness: NaN, acuity: Infinity }, target: { id: null, position: null, stealth: NaN, cover: Infinity }, context: { hour: NaN, fog: Infinity, precipitation: NaN }, now: Infinity });
frozen(malformed, 'malformed');
assert.ok(malformed.confidence >= 0 && malformed.confidence <= 1);
assert.equal(validatePerceptionFacts([malformed]).ok, true);

const capped = buildFaunaPerceptionBatch({
  observers: Array.from({ length: 100 }, (_, index) => observer({ id: `observer-${index}` })),
  targets: Array.from({ length: 100 }, (_, index) => target({ id: `target-${index}` })),
  context: context(), now: 50,
});
assert.ok(capped.length <= FAUNA_PERCEPTION_POLICY.maxFacts);
assert.deepEqual(planFaunaAlertPropagation({ facts: [], actors: [], now: 1 }), []);

const hidden = buildFaunaPerceptionBatch({
  observers: [observer({ id: 'owl', nocturnal: true })],
  targets: [target({ id: 'hidden', visible: false, cover: 1, stealth: 1, noisy: true, noiseLevel: 0.2 })],
  context: context({ fog: 0.8, light: 0.02 }), now: 100,
});
assert.equal(hidden.length, 1);
assert.equal(hidden[0].visualVisible, false);
assert.equal(validatePerceptionFacts(hidden).ok, true);

console.log('LIVING_WORLD_FAUNA_PERCEPTION_ADAPTER_OK');
